// Werkwoorden-oefening: conjugatie-drills (presente) met drie oplopende tiers, en de logica die
// bepaalt wélke werkwoorden in de conjugatie-wachtrij komen en op welk tier. De SRS-stand (Leitner)
// is dezelfde localStorage-store als de andere oefeningen; conjugatie telt los via de ::conj-suffix
// (zie practice.ts, srsKeyFor). Contract van het backend-endpoint: zie server/index.js
// (/api/conjugation-drill), respons strikt per tier.

import { type SrsState, srsKeyFor } from './practice'
import type { VocabWord } from './vocab'

/** Drempels box→tier (tunebaar). Box 0-1 → tier 1, 2-3 → tier 2, 4-5 → tier 3. */
export const TIER2_MIN_BOX = 2
export const TIER3_MIN_BOX = 4

/**
 * Een werkwoord komt pas in de conjugatie-wachtrij als je het als woord (ES→NL) al redelijk
 * herkent: zijn es2nl-box moet ≥ deze drempel zijn. Tunebaar.
 */
export const RECOGNITION_GATE = 0

/** Vertaalt een conj-box naar het tier van de bijbehorende drill. Drempels tunebaar (settings). */
export function verbBoxToTier(
  box: number,
  tier2Min: number = TIER2_MIN_BOX,
  tier3Min: number = TIER3_MIN_BOX,
): 1 | 2 | 3 {
  if (box >= tier3Min) return 3
  if (box >= tier2Min) return 2
  return 1
}

/** Tier 1 — rijtjes dreunen: gevraagde persoon → correcte presente-vorm. */
export interface ConjDrillT1 {
  tier: 1
  /** NL-persoonslabel: "ik" | "jij" | "hij/zij" | "wij" | "jullie" | "zij". */
  person: string
  /** Correcte presente-vorm. */
  answer: string
}

/** Tier 2 — cloze: zin met een gat (`___`) waar de doelvorm hoort. */
export interface ConjDrillT2 {
  tier: 2
  /** Zin met placeholder `___` op de plek van de doelvorm. */
  sentence: string
  /** Correcte vorm voor het gat. */
  blankAnswer: string
  /** NL-vertaling van de volledige zin. */
  translation: string
}

/** Tier 3 — vraag/antwoord: NL-vraag, vrij Spaans antwoord dat een verwachte vorm bevat. */
export interface ConjDrillT3 {
  tier: 3
  /** De vraag in het Nederlands. */
  questionNl: string
  /** Aanvaardbare doelvormen; één ervan (heel woord) volstaat in het antwoord. */
  expectedForms: string[]
  /** Voorbeeld-modelantwoord in het Spaans. */
  modelAnswer: string
  /** NL-vertaling van het modelantwoord. */
  translation: string
}

export type ConjDrill = ConjDrillT1 | ConjDrillT2 | ConjDrillT3

/** Spaanse variant die de personenset/vervoegingen bepaalt (LatAm vs Spanje). */
export type SpanishVariant = 'latam' | 'spain'

interface FetchParams {
  infinitive: string
  tier: 1 | 2 | 3
  tense: 'presente'
  seed: number
  variant: SpanishVariant
}

/**
 * Haalt één conjugatie-drill op via de backend. `seed` werkt als bij /api/practice-sentence:
 * zelfde seed = zelfde item, een nieuwe ronde varieert. De respons is strikt per tier (zie de
 * union hierboven); we vertrouwen op het contract en casten naar het juiste tier-type.
 */
export async function fetchConjugationDrill(params: FetchParams): Promise<ConjDrill> {
  const res = await fetch('/api/conjugation-drill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Conjugatie-fout ${res.status}: ${detail.slice(0, 200)}`)
  }
  return (await res.json()) as ConjDrill
}

/** Volledige presente-tabel: 6 personen in vaste volgorde (yo … ellos/ellas/ustedes). */
export interface ConjTable {
  tense: string
  forms: { person: string; form: string }[]
}

/**
 * Haalt de volledige vervoegingstabel van een infinitief op via de backend. Zelfde foutstijl als
 * fetchConjugationDrill. De server geeft exact 6 personen in vaste volgorde: yo, tú,
 * él/ella/usted, nosotros, vosotros, ellos/ellas/ustedes.
 */
export async function fetchConjugationTable(
  infinitive: string,
  variant: SpanishVariant,
  tense: 'presente' = 'presente',
): Promise<ConjTable> {
  const res = await fetch('/api/conjugation-table', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ infinitive, tense, variant }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Conjugatie-fout ${res.status}: ${detail.slice(0, 200)}`)
  }
  return (await res.json()) as ConjTable
}

/** Fisher-Yates shuffle (in-place op een kopie) — zelfde als in practice.ts. */
function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Bouwt de conjugatie-wachtrij: alleen werkwoorden die je als woord al genoeg herkent
 * (es2nl-box ≥ RECOGNITION_GATE), gesorteerd op conj-box (laag eerst, dus wat je in de vervoeging
 * minder goed kent komt eerder), en binnen een gelijke conj-box willekeurig geschud — net als
 * buildRound in practice.ts. Retourneert de word-keys.
 */
export function buildVerbQueue(
  vocab: VocabWord[],
  srs: SrsState,
  shuffleAll = false,
): string[] {
  const recogBox = (wordKey: string) => srs[wordKey]?.box ?? 0
  const conjBox = (wordKey: string) => srs[srsKeyFor(wordKey, 'conj')]?.box ?? 0

  const eligible = vocab.filter(
    (w) => w.type === 'werkwoord' && recogBox(w.key) >= RECOGNITION_GATE,
  )

  // Echt door elkaar: alle werkwoorden willekeurig, ongeacht box (dus tiers gemengd).
  if (shuffleAll) return shuffle(eligible.map((w) => w.key))

  // Anders: groepeer per conj-box, shuffle binnen de groep, plak op oplopende box aan elkaar.
  const byBox = new Map<number, string[]>()
  for (const w of eligible) {
    const b = conjBox(w.key)
    const bucket = byBox.get(b)
    if (bucket) bucket.push(w.key)
    else byBox.set(b, [w.key])
  }
  const boxes = [...byBox.keys()].sort((a, b) => a - b)
  return boxes.flatMap((b) => shuffle(byBox.get(b) ?? []))
}
