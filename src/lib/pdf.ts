// PDF-tekst + hoofdstukken extraheren in de browser met pdfjs-dist (Fase 4).
// De worker-URL wordt via Vite's "?url" geleverd, zodat pdfjs zijn worker vindt.

import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PAGE_MARK } from './sentences'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

// Alleen de velden die we gebruiken uit een tekst-item.
interface TextItemLike {
  str?: string
  hasEOL?: boolean
}

/** Een hoofdstuk uit de PDF-outline, met de 0-based pagina waar het begint. */
export interface RawChapter {
  title: string
  page: number
}

export interface ExtractedBook {
  /** Volledige tekst met een PAGE_MARK vóór elke pagina (voor hoofdstuk->zin mapping). */
  text: string
  /** Hoofdstukken uit de bladwijzers; leeg als de PDF geen outline heeft. */
  chapters: RawChapter[]
}

/** Herleidt een outline-bestemming naar een 0-based pagina-index. */
async function resolvePageIndex(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const resolved = typeof dest === 'string' ? await doc.getDestination(dest) : (dest as unknown[] | null)
    const ref = Array.isArray(resolved) ? resolved[0] : null
    if (!ref) return null
    return await doc.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])
  } catch {
    return null
  }
}

/** Haalt tekst (met paginamarkers) én hoofdstukken uit een PDF-bestand. */
export async function extractPdfBook(file: File): Promise<ExtractedBook> {
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise

  let text = ''
  for (let p = 1; p <= doc.numPages; p++) {
    text += PAGE_MARK // markeer paginastart (marker-index k == pagina-index k)
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    for (const item of content.items as TextItemLike[]) {
      text += item.str ?? ''
      if (item.hasEOL) text += '\n'
    }
    text += '\n\n' // paginagrens
  }

  const chapters: RawChapter[] = []
  try {
    const outline = await doc.getOutline()
    if (outline) {
      for (const item of outline) {
        const title = typeof item.title === 'string' ? item.title.trim() : ''
        if (!title) continue
        const page = await resolvePageIndex(doc, item.dest)
        if (page != null) chapters.push({ title, page })
      }
    }
  } catch {
    // geen/kapotte outline -> gewoon geen hoofdstukken
  }

  return { text, chapters }
}
