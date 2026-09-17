// Leesbron voor beide knip-modi, achter één interface (zodat App.tsx niet per modus hoeft te
// vertakken).
//
//  - Deterministisch: `book.sentences` is de volledige platte lijst; `index` loopt eroverheen.
//  - AI (voortschrijdend): we houden een VENSTER van aaneengesloten, al-geknipte chunks bij.
//    `sentences` = de eenheden van die chunks achter elkaar; `index` is een platte positie
//    binnen het venster. Bij de laatste eenheid van het venster laden we de volgende chunk
//    (en zetten de daaropvolgende alvast klaar); een hoofdstuk-sprong reset het venster naar
//    alleen de doel-chunk. Lege chunks (front-matter/rommel) worden bij het laden overgeslagen.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Book, Progress } from './storage'
import { addSection, loadProgress, saveBook, saveProgress } from './storage'
import { detectStoryStart, ensureUnits } from './aisegment'

/** Sentinel: nog geen enkel boek geïnitialiseerd (te onderscheiden van een echte `null`-inhoud). */
const NO_CONTENT = Symbol('no-content')

/** Wat de dropdown nodig heeft: een titel + of die door de AI verzonnen is. */
export interface ReaderChapter {
  title: string
  generated?: boolean
}

interface View {
  sentences: string[]
  chunks: number[] // chunk-indices in het venster (AI); leeg bij deterministisch
  counts: number[] // aantal eenheden per venster-chunk (AI)
}

export interface Reader {
  sentences: string[]
  index: number
  sentence: string
  prevSentence: string
  nextSentence: string
  /** Verandert bij elke echte positiewissel — gebruik als effect-dependency i.p.v. `index`. */
  pos: string
  chapters: ReaderChapter[]
  currentChapter: number
  hasPrev: boolean
  hasNext: boolean
  /** Zin-teller. In AI-modus een raming (`approx`), want niet het hele boek is geknipt. */
  progress: { approx: boolean; current: number; total: number }
  loading: boolean
  error: string | null
  goPrev: () => void
  goNext: () => void
  jumpToChapter: (i: number) => void
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Een chunk is "bekend leeg" als hij al verwerkt is en 0 eenheden opleverde (front-matter/rommel). */
function knownEmpty(units: (string[] | null)[] | undefined, j: number): boolean {
  const u = units?.[j]
  return Array.isArray(u) && u.length === 0
}

/** Harde ondergrens: de chunk waar het verhaal begint (front-matter ervoor overslaan). Eénmalig
 *  door de AI over de opening bepaald (book.storyStart) — generiek, niet via outline/hoofdstuk. */
function floorChunk(book: Book | null): number {
  return book?.mode === 'ai' ? book.storyStart ?? 0 : 0
}

/** De opening-chunks (ruim venster, ~5000 tekens) waarover de AI de verhaalstart bepaalt. */
function openingChunks(book: Book): string[] {
  const raw = book.rawChunks ?? []
  const out: string[] = []
  let chars = 0
  for (const c of raw) {
    out.push(c)
    chars += c.length
    if (chars >= 5000 && out.length >= 3) break
  }
  return out
}

/** Vind bij een platte index de venster-chunk (bucket) en de eenheid-positie daarbinnen. */
function locate(view: View, index: number): { bucket: number; unit: number } {
  let acc = 0
  for (let b = 0; b < view.counts.length; b++) {
    if (index < acc + view.counts[b]) return { bucket: b, unit: index - acc }
    acc += view.counts[b]
  }
  return { bucket: Math.max(0, view.counts.length - 1), unit: 0 }
}

export function useReader(
  book: Book | null,
  setBook: (b: Book) => void,
  demoSentences: string[],
): Reader {
  const [view, setView] = useState<View>({ sentences: demoSentences, chunks: [], counts: [] })
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const bookRef = useRef(book)
  bookRef.current = book
  const viewRef = useRef(view)
  viewRef.current = view
  const indexRef = useRef(index)
  indexRef.current = index
  const busyRef = useRef(false)
  // Bewaarde leespositie één keer vastpinnen, vóór het save-effect 'm kan overschrijven. Zo
  // overleeft het hervatten StrictMode's dubbele mount (die anders een wegwerp-vlag zou slopen).
  const resumeRef = useRef<Progress | null>(null)
  if (resumeRef.current === null) resumeRef.current = loadProgress()
  // Inhoud-identiteit van het laatst geïnitialiseerde boek. Zelfde inhoud opnieuw = hervatten
  // (o.a. StrictMode-remount); écht andere inhoud = nieuw boek, vooraan beginnen.
  const lastContentRef = useRef<unknown>(NO_CONTENT)

  const isAi = book?.mode === 'ai'

  // --- Laad-helpers (AI): vind de eerstvolgende NIET-lege chunk vanaf `from`, vooruit of terug.
  // Retourneert het bijgewerkte boek (cache gevuld) plus de gevonden chunk + eenheden (of null).
  async function loadDir(
    startBook: Book,
    from: number,
    dir: 1 | -1,
    floor = 0,
  ): Promise<{ book: Book; chunk: number; units: string[] | null }> {
    let b = startBook
    const total = b.rawChunks?.length ?? 0
    for (let i = from; i >= floor && i < total; i += dir) {
      const r = await ensureUnits(b, i)
      b = r.book
      if (r.units.length > 0) return { book: b, chunk: i, units: r.units }
    }
    return { book: b, chunk: -1, units: null }
  }

  // Zet de eerstvolgende chunk alvast klaar (best-effort), gemerged in het meest recente boek.
  const prefetch = useCallback(
    async (b: Book, chunk: number) => {
      if (!b.rawChunks || chunk < 0 || chunk >= b.rawChunks.length) return
      if (Array.isArray(b.units?.[chunk])) return
      try {
        const r = await ensureUnits(b, chunk)
        const latest = bookRef.current
        if (!latest?.rawChunks || Array.isArray(latest.units?.[chunk])) return
        const nextUnits = (latest.units ?? latest.rawChunks.map(() => null)).slice()
        nextUnits[chunk] = r.units
        let merged: Book = { ...latest, units: nextUnits }
        const sec = (r.book.sections ?? []).find((s) => s.chunk === chunk)
        if (sec) merged = addSection(merged, sec)
        setBook(merged)
        saveBook(merged)
      } catch {
        // stil: prefetch is best-effort; goNext laadt desnoods alsnog.
      }
    },
    [setBook],
  )

  // --- (Her)initialiseren wanneer er een ander boek geladen wordt.
  const contentRef = book?.rawChunks ?? book?.sentences ?? null
  useEffect(() => {
    const b = bookRef.current
    // Zelfde inhoud opnieuw initialiseren (o.a. StrictMode-remount) = hervatten; alleen écht
    // andere inhoud telt als een nieuw geladen boek en begint vooraan.
    const isNewBook = lastContentRef.current !== NO_CONTENT && lastContentRef.current !== contentRef
    lastContentRef.current = contentRef
    const prog: Progress = isNewBook
      ? { index: 0, chunk: undefined, unit: undefined }
      : resumeRef.current!
    setError(null)

    if (!b || b.mode !== 'ai') {
      const s = b?.sentences ?? demoSentences
      const start = prog.index >= 0 && prog.index < s.length ? prog.index : 0
      setView({ sentences: s, chunks: [], counts: [] })
      setIndex(start)
      return
    }

    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        let bb = b
        // Vloer = de chunk waar het verhaal begint. Eénmalig door de AI bepalen over de opening
        // (ruim venster) en op het boek cachen; front-matter ervóór wordt overgeslagen.
        let floor = bb.storyStart
        if (floor == null) {
          floor = await detectStoryStart(openingChunks(bb))
          if (cancelled) return
          bb = { ...bb, storyStart: floor }
        }
        const total = bb.rawChunks?.length ?? 0
        // Hervatten -> bewaarde chunk (nooit onder de vloer); anders bij de vloer beginnen.
        const resume =
          !isNewBook && typeof prog.chunk === 'number' && prog.chunk >= floor && prog.chunk < total
        const startChunk = resume ? (prog.chunk as number) : floor
        const r = await loadDir(bb, startChunk, 1)
        if (cancelled) return
        if (r.units) {
          setView({ sentences: r.units, chunks: [r.chunk], counts: [r.units.length] })
          const wantUnit =
            !isNewBook && prog.chunk === r.chunk && typeof prog.unit === 'number' && prog.unit < r.units.length
              ? prog.unit
              : 0
          setIndex(wantUnit)
          void prefetch(r.book, r.chunk + 1)
        } else {
          setView({ sentences: [], chunks: [], counts: [] })
          setIndex(0)
        }
        setBook(r.book)
        saveBook(r.book)
      } catch (e) {
        if (!cancelled) setError(errText(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentRef])

  // --- Navigatie.
  const goNext = useCallback(() => {
    if (busyRef.current) return
    const b = bookRef.current
    const v = viewRef.current
    const i = indexRef.current
    if (!b || b.mode !== 'ai') {
      if (i < v.sentences.length - 1) setIndex(i + 1)
      return
    }
    if (i + 1 < v.sentences.length) {
      setIndex(i + 1)
      return
    }
    const lastChunk = v.chunks[v.chunks.length - 1] ?? -1
    busyRef.current = true
    setLoading(true)
    setError(null)
    loadDir(b, lastChunk + 1, 1)
      .then((r) => {
        if (r.units) {
          setView({
            sentences: [...v.sentences, ...r.units],
            chunks: [...v.chunks, r.chunk],
            counts: [...v.counts, r.units.length],
          })
          setIndex(v.sentences.length)
          void prefetch(r.book, r.chunk + 1)
        }
        setBook(r.book)
        saveBook(r.book)
      })
      .catch((e) => setError(errText(e)))
      .finally(() => {
        busyRef.current = false
        setLoading(false)
      })
  }, [prefetch, setBook])

  const goPrev = useCallback(() => {
    if (busyRef.current) return
    const b = bookRef.current
    const v = viewRef.current
    const i = indexRef.current
    if (!b || b.mode !== 'ai') {
      if (i > 0) setIndex(i - 1)
      return
    }
    if (i > 0) {
      setIndex(i - 1)
      return
    }
    const floor = b.storyStart ?? 0
    const firstChunk = v.chunks[0] ?? 0
    if (firstChunk <= floor) return
    busyRef.current = true
    setLoading(true)
    setError(null)
    loadDir(b, firstChunk - 1, -1, floor)
      .then((r) => {
        if (r.units) {
          setView({
            sentences: [...r.units, ...v.sentences],
            chunks: [r.chunk, ...v.chunks],
            counts: [r.units.length, ...v.counts],
          })
          setIndex(r.units.length - 1)
        }
        setBook(r.book)
        saveBook(r.book)
      })
      .catch((e) => setError(errText(e)))
      .finally(() => {
        busyRef.current = false
        setLoading(false)
      })
  }, [setBook])

  const jumpToChapter = useCallback(
    (ci: number) => {
      if (busyRef.current) return
      const b = bookRef.current
      if (!b) return
      if (b.mode !== 'ai') {
        const chapter = b.chapters?.[ci]
        if (!chapter) return
        const start = chapter.start ?? 0
        if (start >= 0 && start < viewRef.current.sentences.length) setIndex(start)
        return
      }
      const sec = b.sections?.[ci]
      if (!sec) return
      busyRef.current = true
      setLoading(true)
      setError(null)
      loadDir(b, sec.chunk, 1)
        .then((r) => {
          if (r.units) {
            setView({ sentences: r.units, chunks: [r.chunk], counts: [r.units.length] })
            // Sprong landt op de eenheid waar de sectie begint (mits het de bedoelde chunk is).
            setIndex(r.chunk === sec.chunk ? Math.min(sec.unit, r.units.length - 1) : 0)
            void prefetch(r.book, r.chunk + 1)
          }
          setBook(r.book)
          saveBook(r.book)
        })
        .catch((e) => setError(errText(e)))
        .finally(() => {
          busyRef.current = false
          setLoading(false)
        })
    },
    [prefetch, setBook],
  )

  // --- Afgeleide waarden.
  const loc = locate(view, index)
  const currentChunk = isAi ? view.chunks[loc.bucket] ?? 0 : -1
  const pos = isAi ? `${currentChunk}:${loc.unit}` : `d${index}`

  // Dropdown: in AI-modus de progressief ontdekte secties; deterministisch de outline-hoofdstukken.
  const chapters: ReaderChapter[] = isAi
    ? (book?.sections ?? []).map((s) => ({ title: s.title, generated: s.generated }))
    : (book?.chapters ?? []).map((c) => ({ title: c.title }))

  let currentChapter = -1
  if (isAi) {
    const secs = book?.sections ?? []
    for (let c = 0; c < secs.length; c++) {
      const s = secs[c]
      if (s.chunk < currentChunk || (s.chunk === currentChunk && s.unit <= loc.unit)) currentChapter = c
    }
  } else {
    const chs = book?.chapters ?? []
    for (let c = 0; c < chs.length; c++) if ((chs[c].start ?? -1) <= index) currentChapter = c
  }

  // Prev/Next kijken naar écht bereikbare inhoud: een chunk vóór/na het venster die niet
  // bekend-leeg is (nog niet verwerkte chunks tellen als "mogelijk inhoud"). Zo staat "Vorige"
  // niet aan als er vóór alleen lege front-matter-chunks liggen.
  const floor = floorChunk(book)
  const base = view.chunks[0] ?? 0
  const lastChunk = view.chunks[view.chunks.length - 1] ?? -1
  const total = book?.rawChunks?.length ?? 0
  let contentBefore = false
  let contentAfter = false
  if (isAi && book) {
    for (let j = floor; j < base; j++) if (!knownEmpty(book.units, j)) { contentBefore = true; break }
    for (let j = lastChunk + 1; j < total; j++) if (!knownEmpty(book.units, j)) { contentAfter = true; break }
  }
  const hasPrev = isAi ? index > 0 || contentBefore : index > 0
  const hasNext = isAi
    ? index < view.sentences.length - 1 || contentAfter
    : index < view.sentences.length - 1

  // Zin-teller: exact bij deterministisch, geraamd in AI-modus (rawLength / gem. eenheidslengte).
  let progress: { approx: boolean; current: number; total: number }
  if (isAi && book) {
    const raw = book.rawChunks ?? []
    // Bekend-lege chunks (front-matter/rommel) tellen niet mee, zodat de teller bij de eerste
    // verhaalzin op ~1 begint i.p.v. de weggeknipte front-matter mee te rekenen.
    let totalChars = 0
    let charsBefore = 0
    for (let j = floor; j < raw.length; j++) {
      if (knownEmpty(book.units, j)) continue
      totalChars += raw[j].length
      if (j < currentChunk) charsBefore += raw[j].length
    }
    let sumLen = 0
    let n = 0
    for (const u of book.units ?? []) {
      if (Array.isArray(u)) for (const s of u) { sumLen += s.length; n++ }
    }
    const avg = n > 0 ? sumLen / n : 60
    const estTotal = Math.max(1, Math.round(totalChars / avg))
    const estCurrent = Math.min(estTotal, Math.round(charsBefore / avg) + loc.unit + 1)
    progress = { approx: true, current: estCurrent, total: estTotal }
  } else {
    progress = { approx: false, current: index + 1, total: view.sentences.length }
  }

  // Voortgang bewaren bij elke positiewissel.
  useEffect(() => {
    if (isAi) saveProgress({ index: 0, chunk: currentChunk, unit: loc.unit })
    else saveProgress({ index })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos])

  // Vooruit werken (1 chunk): zodra je op de (voor)laatste eenheid van het geladen venster staat
  // — dus terwijl je die zin luistert — de volgende chunk alvast laten knippen, zodat "Volgende"
  // aan de grens niet hoeft te wachten. Dedup zit in segmentChunk, dus dubbel triggeren kan geen kwaad.
  useEffect(() => {
    if (!isAi) return
    const v = viewRef.current
    if (index < v.sentences.length - 2) return
    const b = bookRef.current
    if (!b) return
    const lc = v.chunks[v.chunks.length - 1] ?? -1
    void prefetch(b, lc + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos])

  return {
    sentences: view.sentences,
    index,
    sentence: view.sentences[index] ?? '',
    prevSentence: view.sentences[index - 1] ?? '',
    nextSentence: view.sentences[index + 1] ?? '',
    pos,
    chapters,
    currentChapter,
    hasPrev,
    hasNext,
    progress,
    loading,
    error,
    goPrev,
    goNext,
    jumpToChapter,
  }
}
