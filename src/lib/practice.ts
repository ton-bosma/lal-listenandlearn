// Oefenmodus: lichte Leitner-SRS + het ophalen van een AI-voorbeeldzin. De SRS-stand staat
// bewust lokaal (per apparaat) in localStorage; de woordenlijst zelf is server-side gedeeld.
// Zie docs/OEFENMODUS.md (secties 1, 3) voor het afgestemde v1-ontwerp.

import type { VocabWord } from './vocab'

const SRS_KEY = 'spaanleren.srs.v1'

/** Hoogste Leitner-box: Goed op dit niveau laat de box hier staan (max). */
export const MAX_BOX = 5

/** Stand per woord-key. Voorlopig alleen de box; later uitbreidbaar (bijv. tijdstip). */
export interface SrsEntry {
  box: number
}

export type SrsState = Record<string, SrsEntry>

/** Oefen-richting van de woord-flashcard. */
export type PracticeDir = 'es2nl' | 'nl2es'

/**
 * SRS-sleutel voor een woord in een gegeven richting. ES→NL (en de AI-zin) gebruiken de kale
 * `wordKey` (backward compatible met bestaande voortgang); NL→ES krijgt een eigen suffix zodat het
 * los telt.
 */
export function srsKeyFor(wordKey: string, dir: PracticeDir = 'es2nl'): string {
  return dir === 'nl2es' ? `${wordKey}::nl2es` : wordKey
}

/** Leest de SRS-stand uit localStorage; bij ontbreken/corrupte data een lege stand. */
export function loadSrs(): SrsState {
  try {
    const raw = localStorage.getItem(SRS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: SrsState = {}
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      const box = (val as { box?: unknown })?.box
      out[key] = { box: typeof box === 'number' && box >= 0 ? box : 0 }
    }
    return out
  } catch {
    return {}
  }
}

/** Bewaart de SRS-stand (stil falen als storage niet beschikbaar is, bijv. private mode). */
export function saveSrs(state: SrsState): void {
  try {
    localStorage.setItem(SRS_KEY, JSON.stringify(state))
  } catch {
    // stil: SRS is een gemak, geen harde eis
  }
}

/** Fisher-Yates shuffle (in-place op een kopie). */
function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Bouwt de volgorde van een ronde: alle woord-keys, gesorteerd op box (laag eerst, dus wat je
 * minder goed kent komt eerder), en binnen een gelijke box willekeurig geschud.
 */
export function buildRound(
  words: VocabWord[],
  state: SrsState = loadSrs(),
  dir: PracticeDir = 'es2nl',
): string[] {
  const boxOf = (wordKey: string) => state[srsKeyFor(wordKey, dir)]?.box ?? 0
  // Groepeer per box, shuffle binnen de groep, en plak op oplopende box aan elkaar.
  const byBox = new Map<number, string[]>()
  for (const w of words) {
    const b = boxOf(w.key)
    const bucket = byBox.get(b)
    if (bucket) bucket.push(w.key)
    else byBox.set(b, [w.key])
  }
  const boxes = [...byBox.keys()].sort((a, b) => a - b)
  return boxes.flatMap((b) => shuffle(byBox.get(b) ?? []))
}

/**
 * Verwerkt een beoordeling: Goed → box+1 (tot MAX_BOX), Fout → terug naar box 0. Persisteert
 * meteen en geeft de bijgewerkte stand terug (handig voor React-state).
 */
export function grade(
  wordKey: string,
  correct: boolean,
  state: SrsState = loadSrs(),
  dir: PracticeDir = 'es2nl',
): SrsState {
  const sk = srsKeyFor(wordKey, dir)
  const box = state[sk]?.box ?? 0
  const next: SrsState = {
    ...state,
    [sk]: { box: correct ? Math.min(box + 1, MAX_BOX) : 0 },
  }
  saveSrs(next)
  return next
}

/** Eén AI-voorbeeldzin met vertaling (oefening A). */
export interface PracticeSentence {
  sentence: string
  translation: string
}

/**
 * Haalt een verse Spaanse voorbeeldzin met het woord op via de backend. `seed` roteert per keer
 * dat een woord terugkomt, zodat je verschillende (maar server-side reproduceerbare/gecachete)
 * zinnen ziet. Zelfde fetch-/foutstijl als de andere Gemini-endpoints (zie aitranslate.ts).
 */
export async function fetchPracticeSentence(
  word: string,
  translation: string,
  seed: number,
): Promise<PracticeSentence> {
  const res = await fetch('/api/practice-sentence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ word, translation, seed }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Voorbeeldzin-fout ${res.status}: ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as { sentence?: string; translation?: string }
  const sentence = (json.sentence ?? '').trim()
  const trans = (json.translation ?? '').trim()
  if (!sentence) throw new Error('Geen voorbeeldzin ontvangen.')
  return { sentence, translation: trans }
}
