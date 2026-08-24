// EPUB-tekst + hoofdstukken extraheren in de browser (default formaat).
// EPUB = ZIP met XHTML-documenten (spine = leesvolgorde) + een nav.xhtml (EPUB3) of
// toc.ncx (EPUB2) voor de hoofdstukken.
//
// - Uitpakken met jszip. XHTML -> tekst met de native DOMParser. Splitsen doet sentences.ts.
// - Vóór elk spine-document zetten we een PAGE_MARK, zodat buildSentences() hoofdstuk->zin
//   kan koppelen (marker-index k == spine-document-index k), net als bij de PDF.

import JSZip from 'jszip'
import { PAGE_MARK } from './sentences'
import type { ExtractedBook, RawChapter } from './pdf'

/** Normaliseert een relatief pad (verwerkt ./ en ../) t.o.v. een basismap. */
function resolvePath(base: string, href: string): string {
  const path = base + href.split('#')[0].split('?')[0]
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

/** XHTML -> platte tekst, met blok-einden als regelovergang zodat woorden niet plakken. */
function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\/(p|div|h[1-6]|li|br|section|article|blockquote|tr)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html')
  return doc.body?.textContent ?? ''
}

export async function extractEpubBook(file: File): Promise<ExtractedBook> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  // 1) container.xml -> pad naar de .opf
  const container = await zip.file('META-INF/container.xml')?.async('string')
  const opfPath = container ? /full-path="([^"]+)"/.exec(container)?.[1] : undefined
  if (!opfPath) throw new Error('Geen geldige EPUB (container.xml/opf ontbreekt).')
  const opfDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]*$/, '/') : ''
  const opf = (await zip.file(opfPath)?.async('string')) ?? ''

  // 2) manifest (id -> {href, props}), spine-volgorde, nav-item, ncx
  const manifest: Record<string, { href: string; props: string }> = {}
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const tag = m[0]
    const id = /id="([^"]+)"/.exec(tag)?.[1]
    const href = /href="([^"]+)"/.exec(tag)?.[1]
    const props = /properties="([^"]*)"/.exec(tag)?.[1] ?? ''
    if (id && href) manifest[id] = { href, props }
  }
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => m[1])
  const navItem = Object.values(manifest).find((it) => it.props.split(/\s+/).includes('nav'))
  const ncxId = /<spine\b[^>]*\btoc="([^"]+)"/.exec(opf)?.[1]

  // 3) tekst per spine-document + pad -> document-index
  let text = ''
  const pathToDoc: Record<string, number> = {}
  let docIndex = 0
  for (const id of spine) {
    const item = manifest[id]
    if (!item) continue
    const path = resolvePath(opfDir, item.href)
    const f = zip.file(path)
    if (!f) continue
    pathToDoc[path] = docIndex
    text += PAGE_MARK + htmlToText(await f.async('string')) + '\n\n'
    docIndex++
  }

  // 4) hoofdstukken: nav.xhtml (EPUB3) of toc.ncx (EPUB2)
  const chapters: RawChapter[] = []
  const seen = new Set<number>()
  const addChapter = (title: string, href: string) => {
    const path = resolvePath(opfDir, href)
    const doc = pathToDoc[path]
    if (doc != null && title.trim() && !seen.has(doc)) {
      seen.add(doc)
      chapters.push({ title: title.trim(), page: doc })
    }
  }

  if (navItem) {
    const nav = (await zip.file(resolvePath(opfDir, navItem.href))?.async('string')) ?? ''
    const navDir = navItem.href.includes('/') ? navItem.href.replace(/\/[^/]*$/, '/') : ''
    const tocBlock = /<nav[^>]*epub:type="toc"[\s\S]*?<\/nav>/i.exec(nav)?.[0] ?? nav
    const doc = new DOMParser().parseFromString(tocBlock, 'text/html')
    for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href') ?? ''
      addChapter(a.textContent ?? '', navDir + href) // nav-hrefs zijn relatief t.o.v. nav
    }
  } else if (ncxId && manifest[ncxId]) {
    const ncxHref = manifest[ncxId].href
    const ncxDir = ncxHref.includes('/') ? ncxHref.replace(/\/[^/]*$/, '/') : ''
    const ncx = (await zip.file(resolvePath(opfDir, ncxHref))?.async('string')) ?? ''
    const doc = new DOMParser().parseFromString(ncx, 'text/xml')
    for (const np of Array.from(doc.getElementsByTagName('navPoint'))) {
      const label = np.getElementsByTagName('text')[0]?.textContent ?? ''
      const src = np.getElementsByTagName('content')[0]?.getAttribute('src') ?? ''
      if (src) addChapter(label, ncxDir + src)
    }
  }

  chapters.sort((a, b) => a.page - b.page)
  return { text, chapters }
}
