// Client-kant van de AI-knipper: één chunk laten opschonen + knippen door de backend,
// met de uitkomst gecachet in het boek (book.units[i]). De server cachet óók per chunk-hash,
// dus dit is puur om niet twee keer dezelfde call te doen binnen één sessie/boek.

import { type Book, addSection } from './storage'

/** Sectie zoals de server 'm teruggeeft (eenheid-index binnen de chunk). */
interface SegmentSection {
  title: string
  generated: boolean
  unit: number
}

/**
 * Bepaalt éénmalig (via de AI, over de opening-chunks samen) bij welke chunk het verhaal begint;
 * alles ervoor is front-matter. Generiek: geen afhankelijkheid van outline/hoofdstuknummers.
 * Geeft een chunk-index binnen `chunks`. Bij twijfel/fout: 0 (niets overslaan) — lezen mag nooit
 * hierop blokkeren.
 */
export async function detectStoryStart(chunks: string[]): Promise<number> {
  if (chunks.length === 0) return 0
  try {
    const res = await fetch('/api/story-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunks }),
    })
    if (!res.ok) return 0
    const json = (await res.json()) as { index?: unknown }
    const idx = json.index
    if (typeof idx === 'number' && Number.isFinite(idx) && idx >= 0 && idx < chunks.length) {
      return Math.floor(idx)
    }
  } catch {
    // stil: val terug op 0 (niets overslaan)
  }
  return 0
}

type SegmentResult = { units: string[]; section?: SegmentSection }

// In-flight dedup: als dezelfde chunk (zelfde text+next) al onderweg is, delen alle aanroepers
// dezelfde belofte — zo knipt de prefetch én een gelijktijdige "Volgende" niet dubbel.
const inFlight = new Map<string, Promise<SegmentResult>>()

/**
 * Stuurt de ruwe tekst van één chunk (+ de volgende chunk als context) naar /api/segment en
 * geeft de leer-eenheden terug, plus een sectie als deze chunk er een nieuwe start.
 */
export async function segmentChunk(text: string, next: string): Promise<SegmentResult> {
  const key = `${text}␞${next}`
  const running = inFlight.get(key)
  if (running) return running

  const promise = (async (): Promise<SegmentResult> => {
    const res = await fetch('/api/segment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, next }),
    })
    if (!res.ok) throw new Error(`segment: HTTP ${res.status}`)
    const json = (await res.json()) as { units?: unknown; section?: unknown }
    if (!Array.isArray(json.units)) throw new Error('segment: ongeldig antwoord')
    const units = json.units.filter((u): u is string => typeof u === 'string' && u.trim() !== '')

    let section: SegmentSection | undefined
    const s = json.section as Record<string, unknown> | undefined
    if (s && typeof s.title === 'string' && s.title.trim() !== '' && typeof s.unit === 'number') {
      section = { title: s.title, generated: !!s.generated, unit: Math.max(0, Math.floor(s.unit)) }
    }
    return { units, section }
  })()

  inFlight.set(key, promise)
  try {
    return await promise
  } finally {
    inFlight.delete(key)
  }
}

/**
 * Zorgt dat `book.units[i]` gevuld is. Muteert het boek niet: bij een fetch levert het een
 * nieuw boek-object met een bijgewerkte `units`-array (rawChunks blijft dezelfde referentie,
 * zodat de reader dit als cache-update herkent en niet als een nieuw boek).
 * `null` = nog niet verwerkt; `[]` = verwerkt maar leeg (front-matter/rommel).
 */
export async function ensureUnits(book: Book, i: number): Promise<{ book: Book; units: string[] }> {
  const cached = book.units?.[i]
  if (Array.isArray(cached)) return { book, units: cached }
  const raw = book.rawChunks?.[i]
  if (raw == null) return { book, units: [] }
  const next = book.rawChunks?.[i + 1] ?? ''
  const { units, section } = await segmentChunk(raw, next)
  const base = book.units ?? book.rawChunks!.map(() => null)
  const nextUnits = base.slice()
  nextUnits[i] = units
  let nextBook: Book = { ...book, units: nextUnits }
  if (section && units.length > 0) {
    nextBook = addSection(nextBook, {
      title: section.title,
      generated: section.generated,
      chunk: i,
      unit: Math.min(section.unit, units.length - 1),
    })
  }
  return { book: nextBook, units }
}
