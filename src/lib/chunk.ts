// Deterministische chunker voor de AI-knipper (voortschrijdend knippen).
//
// Bij import wordt de ruwe PDF-tekst hier — zonder AI — in chunks gehakt. Elke chunk wordt
// later, tijdens het lezen, door de AI-knipper (/api/segment) opgeschoond en in leer-eenheden
// geknipt. Regels:
//  - snap op paragraafgrens (dubbele newline, zoals cleanText die achterlaat);
//  - vul een chunk tot ~MAX_CHUNK_CHARS tekens, dan breken (niet meer in één keer pakken);
//  - HARDE breuk bij elke hoofdstuk-start, zodat de AI nooit over een hoofdstukgrens knipt en
//    `chapter.startChunk` exact klopt.

import { cleanText, PAGE_MARK } from './sentences'
import type { Chapter } from './storage'
import type { RawChapter } from './pdf'

/** Streefgrootte van een chunk in tekens (paragraafgrens mag hem iets overschrijden). */
export const MAX_CHUNK_CHARS = 800

export interface BuiltChunks {
  rawChunks: string[]
  chapters: Chapter[]
  /** Ruwe tekstlengte (na opschoning), voor de voortgangsraming. */
  rawLength: number
}

/** Splitst een te grote paragraaf ruwweg op zinseinden en pakt die tot ~maxChars per stuk.
 *  (Grof mag: de AI herknipt de chunk toch; dit voorkomt alleen te grote losse chunks.) */
function splitLongParagraph(text: string, maxChars: number): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]+|\S[^.!?…]*$/g) ?? [text]
  const out: string[] = []
  let buf = ''
  for (const raw of sentences) {
    const piece = raw.trim()
    if (!piece) continue
    if (buf && buf.length + 1 + piece.length > maxChars) {
      out.push(buf)
      buf = ''
    }
    buf = buf ? buf + ' ' + piece : piece
    if (buf.length >= maxChars) {
      out.push(buf)
      buf = ''
    }
  }
  if (buf) out.push(buf)
  return out.length ? out : [text]
}

/**
 * Hakt de ruwe (PAGE_MARK-bevattende) boektekst in chunks + bepaalt per hoofdstuk in welke
 * chunk het begint. Doet géén AI-werk; front-matter wordt hier bewust NIET weggeknipt (de
 * AI-knipper gooit die per chunk weg, en de app start bij het eerste hoofdstuk).
 */
export function buildChunks(
  rawText: string,
  rawChapters: RawChapter[],
  maxChars = MAX_CHUNK_CHARS,
): BuiltChunks {
  const clean = cleanText(rawText) // PAGE_MARK blijft bewaard, paragrafen = \n\n

  // Strip de paginamarkers en onthoud waar elke pagina begint (offset in de schone tekst).
  let stripped = ''
  const pageStart: number[] = []
  for (const ch of clean) {
    if (ch === PAGE_MARK) pageStart.push(stripped.length)
    else stripped += ch
  }

  // Paragrafen met hun startoffset.
  const paras: { text: string; start: number }[] = []
  const sepRe = /\n{2,}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = sepRe.exec(stripped))) {
    const t = stripped.slice(last, m.index).trim()
    if (t) paras.push({ text: t, start: last })
    last = sepRe.lastIndex
  }
  const tail = stripped.slice(last).trim()
  if (tail) paras.push({ text: tail, start: last })

  // Hoofdstuk-startoffsets (via pagina -> offset), oplopend.
  const chapterOffsets = rawChapters
    .map((c) => ({ title: c.title, offset: pageStart[c.page] ?? -1 }))
    .filter((c) => c.offset >= 0)
    .sort((a, b) => a.offset - b.offset)

  const rawChunks: string[] = []
  const chapters: Chapter[] = []
  let cur = ''
  let ci = 0 // volgende nog te plaatsen hoofdstuk

  const flush = () => {
    const t = cur.trim()
    if (t) rawChunks.push(t)
    cur = ''
  }

  // Plaats elk hoofdstuk waarvan de start op/voor deze paragraaf ligt, op de chunk die hier begint.
  const placeChaptersAt = (paraStart: number, chunkIndex: number) => {
    while (ci < chapterOffsets.length && paraStart >= chapterOffsets[ci].offset) {
      chapters.push({ title: chapterOffsets[ci].title, startChunk: chunkIndex })
      ci++
    }
  }

  for (const para of paras) {
    const overflow = cur !== '' && cur.length + 2 + para.text.length > maxChars
    const chapterHere = ci < chapterOffsets.length && para.start >= chapterOffsets[ci].offset
    if (cur !== '' && (overflow || chapterHere)) flush()

    if (para.text.length > maxChars) {
      // Te grote paragraaf: eigen chunk(s). Eventueel hoofdstuk landt op de eerste ervan.
      if (cur !== '') flush()
      placeChaptersAt(para.start, rawChunks.length)
      for (const piece of splitLongParagraph(para.text, maxChars)) rawChunks.push(piece)
      continue
    }

    if (cur === '') placeChaptersAt(para.start, rawChunks.length)
    cur = cur ? cur + '\n\n' + para.text : para.text
  }
  flush()

  return { rawChunks, chapters, rawLength: stripped.length }
}
