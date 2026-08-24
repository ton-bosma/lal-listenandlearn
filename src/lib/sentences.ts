// Ruwe PDF-tekst opschonen en in zinnen splitsen (Fase 4).
// - Opschoning = een paar regels regex (afbreekstreepjes, witruimte, alineagrenzen).
// - Splitsen = native Intl.Segmenter (taalbewust, Unicode-standaard) — geen dependency.
// - Paginamarkers (PAGE_MARK) worden door pdf.ts vóór elke pagina ingevoegd, zodat we
//   hoofdstuk->zin kunnen koppelen. Ze worden hier uit de zinnen gestript.

/** Onzichtbare marker (private-use codepoint) die een paginagrens aangeeft. */
export const PAGE_MARK = ''

const PARA = '' // tijdelijke marker voor een alineagrens

/** Herstelt afgebroken woorden, voegt losse regels binnen een alinea samen,
 *  en behoudt alineagrenzen (dubbele newline). PAGE_MARK blijft bewaard. */
export function cleanText(raw: string): string {
  return raw
    .replace(/([\p{L}])-\n([\p{L}])/gu, '$1$2') // woord-\nvervolg -> woordvervolg
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, PARA) // alineagrens even parkeren
    .replace(/\n/g, ' ') // losse regels -> spatie
    .replace(new RegExp(PARA, 'g'), '\n\n')
    .replace(/ +\n/g, '\n')
    .trim()
}

// Intl.Segmenter is native (Chrome/Node) maar zit niet in de TS-lib van ons target;
// daarom een kleine lokale typering i.p.v. de hele lib op te hogen.
type SegmenterCtor = new (
  locale: string,
  options: { granularity: 'sentence' | 'word' | 'grapheme' },
) => { segment: (input: string) => Iterable<{ segment: string }> }

const isSentence = (s: string) => s.length > 1 && !/^\d+$/.test(s) // geen losse paginanummers

/**
 * Splitst opgeschoonde Spaanse tekst in zinnen én geeft per pagina terug bij welke
 * zin-index die pagina begint (via de PAGE_MARK-tellingen).
 */
export function buildSentences(raw: string): { sentences: string[]; pageStartSentence: number[] } {
  const clean = cleanText(raw)
  const Segmenter = (Intl as unknown as { Segmenter: SegmenterCtor }).Segmenter
  const seg = new Segmenter('es', { granularity: 'sentence' })
  const markRe = new RegExp(PAGE_MARK, 'g')

  const sentences: string[] = []
  const pageStartSentence: number[] = []
  let pending = 0 // markers die nog aan de eerstvolgende echte zin toegewezen moeten worden

  for (const { segment } of seg.segment(clean)) {
    const markers = (segment.match(markRe) || []).length
    const cleaned = segment.replace(markRe, '').trim()
    if (isSentence(cleaned)) {
      const idx = sentences.length
      for (let m = 0; m < pending + markers; m++) pageStartSentence.push(idx)
      pending = 0
      sentences.push(cleaned)
    } else {
      pending += markers // lege/gefilterde stukjes (bijv. lege pagina's) doorschuiven
    }
  }
  // Pagina's na de laatste echte zin -> naar de laatste zin.
  const lastIdx = Math.max(0, sentences.length - 1)
  for (let m = 0; m < pending; m++) pageStartSentence.push(lastIdx)

  return { sentences, pageStartSentence }
}
