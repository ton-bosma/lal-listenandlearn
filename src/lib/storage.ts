// Voortgang onthouden: welke zin was je in het huidige boek?
//
// FASE 1: één (dummy) boek, positie in localStorage.
// LATER: meerdere boeken -> sleutel per boek-id (zie docs/SPEC.md, nice-to-have).

const PROGRESS_KEY = 'spaanleren.progress.v1'
const BOOK_KEY = 'spaanleren.book.v1'
const AI_TRANSLATE_KEY = 'spaanleren.aiTranslateEnabled.v1'
const MUTED_KEY = 'spaanleren.muted.v1'
const MIC_MUTED_KEY = 'spaanleren.micMuted.v1'
const SEGMENT_MODE_KEY = 'spaanleren.segmentMode.v1'
const VERB_SETTINGS_KEY = 'spaanleren.verbSettings.v1'
const SPANISH_VARIANT_KEY = 'spaanleren.spanishVariant.v1'

export interface Progress {
  /** Index van de huidige zin (deterministische modus). */
  index: number
  /** Cursor voor de AI-modus: welke chunk + welke eenheid daarin. */
  chunk?: number
  unit?: number
}

/**
 * Hoe een boek geknipt is:
 *  - 'deterministic' -> in één keer bij import via Intl.Segmenter (klassiek, default).
 *  - 'ai'            -> voortschrijdend per chunk door de AI-knipper (opschonen + knippen).
 */
export type SegmentMode = 'deterministic' | 'ai'

/** Een hoofdstuk. `start` = zin-index (deterministisch, of lazy in AI-modus);
 *  `startChunk` = chunk-index waar het hoofdstuk begint (AI-modus, bekend bij import). */
export interface Chapter {
  title: string
  start?: number
  startChunk?: number
}

/** Een door de AI ontdekte sectie (AI-modus): titel + waar hij begint (chunk + eenheid-index).
 *  `generated` = titel door AI verzonnen (bijv. "Voorwoord") i.p.v. uit de tekst gehaald.
 *  Wordt progressief opgebouwd tijdens het lezen en op het boek gecachet. */
export interface Section {
  title: string
  chunk: number
  unit: number
  generated: boolean
}

/** Voeg een sectie toe/vervang die van dezelfde chunk, en houd de lijst gesorteerd. */
export function addSection(book: Book, section: Section): Book {
  const rest = (book.sections ?? []).filter((s) => s.chunk !== section.chunk)
  const sections = [...rest, section].sort((a, b) => a.chunk - b.chunk || a.unit - b.unit)
  return { ...book, sections }
}

/** Het ingeladen boek. Beide knip-modi passen in dit model (zie `mode`). */
export interface Book {
  name: string
  /** Knip-modus. Ontbreekt = legacy boek = deterministisch. */
  mode?: SegmentMode
  chapters?: Chapter[]
  // Deterministische modus (en legacy):
  sentences?: string[]
  // AI-modus (voortschrijdend geknipt):
  /** Ruwe tekst per chunk (deterministisch gehakt bij import). */
  rawChunks?: string[]
  /** Per chunk de geknipte leer-eenheden; null = nog niet verwerkt (sparse cache). */
  units?: (string[] | null)[]
  /** Ruwe tekstlengte van het hele boek, voor de voortgangsraming. */
  rawLength?: number
  /** Chunk-index waar het verhaal begint (front-matter ervoor overslaan). Eénmalig door de AI
   *  bepaald over de opening en hier gecachet; undefined = nog niet bepaald. */
  storyStart?: number
  /** Progressief door de AI ontdekte secties (voor de hoofdstuk-dropdown), gecachet. */
  sections?: Section[]
}

export function loadBook(): Book | null {
  try {
    const raw = localStorage.getItem(BOOK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Book>
    if (typeof parsed.name !== 'string') return null

    const chapters = Array.isArray(parsed.chapters)
      ? parsed.chapters.filter(
          (c): c is Chapter =>
            !!c &&
            typeof c.title === 'string' &&
            (typeof c.start === 'number' || typeof c.startChunk === 'number'),
        )
      : undefined

    // AI-modus: ruwe chunks + sparse eenheden-cache.
    if (parsed.mode === 'ai' && Array.isArray(parsed.rawChunks)) {
      const rawChunks = parsed.rawChunks.filter((s): s is string => typeof s === 'string')
      const units = Array.isArray(parsed.units)
        ? rawChunks.map((_, i) => {
            const u = parsed.units![i]
            return Array.isArray(u) ? u.filter((s) => typeof s === 'string') : null
          })
        : rawChunks.map(() => null)
      const sections = Array.isArray(parsed.sections)
        ? parsed.sections
            .filter(
              (s) =>
                !!s &&
                typeof s.title === 'string' &&
                typeof s.chunk === 'number' &&
                typeof s.unit === 'number',
            )
            .map((s) => ({ title: s.title!, chunk: s.chunk!, unit: s.unit!, generated: !!s.generated }))
        : undefined
      return {
        name: parsed.name,
        mode: 'ai',
        rawChunks,
        units,
        rawLength: typeof parsed.rawLength === 'number' ? parsed.rawLength : undefined,
        storyStart: typeof parsed.storyStart === 'number' ? parsed.storyStart : undefined,
        sections,
        chapters,
      }
    }

    // Deterministische modus (en legacy boeken zonder `mode`).
    if (Array.isArray(parsed.sentences)) {
      return {
        name: parsed.name,
        mode: 'deterministic',
        sentences: parsed.sentences.filter((s) => typeof s === 'string'),
        chapters,
      }
    }
    return null
  } catch {
    return null
  }
}

export function saveBook(book: Book): void {
  try {
    localStorage.setItem(BOOK_KEY, JSON.stringify(book))
  } catch {
    // localStorage kan vol/geblokkeerd zijn — dan draait het boek deze sessie zonder te bewaren.
  }
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return { index: 0 }
    const parsed = JSON.parse(raw) as Partial<Progress>
    const index = typeof parsed.index === 'number' && parsed.index >= 0 ? parsed.index : 0
    const chunk = typeof parsed.chunk === 'number' && parsed.chunk >= 0 ? parsed.chunk : undefined
    const unit = typeof parsed.unit === 'number' && parsed.unit >= 0 ? parsed.unit : undefined
    return { index, chunk, unit }
  } catch {
    return { index: 0 }
  }
}

export function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress))
  } catch {
    // localStorage kan geblokkeerd zijn (privémodus e.d.) — dan simpelweg niet bewaren.
  }
}

/**
 * Setting voor de AI-vertaling (Gemini-met-context) op niveau 'dutch':
 *  - 'off'    -> nooit; alleen Google Translate.
 *  - 'second' -> als 2e keus; Google eerst, klik op de NL-zin voor de AI-versie.
 *  - 'first'  -> meteen; direct de AI-versie, Google wordt overgeslagen.
 * Default 'off'.
 */
export type AiTranslateMode = 'off' | 'second' | 'first'

export function getAiTranslateMode(): AiTranslateMode {
  try {
    const v = localStorage.getItem(AI_TRANSLATE_KEY)
    if (v === 'off' || v === 'second' || v === 'first') return v
    if (v === '1') return 'second' // migratie van de oude aan/uit-setting
    return 'off'
  } catch {
    return 'off'
  }
}

export function setAiTranslateMode(mode: AiTranslateMode): void {
  try {
    localStorage.setItem(AI_TRANSLATE_KEY, mode)
  } catch {
    // best-effort
  }
}

/**
 * Setting: hoe nieuw geïmporteerde boeken geknipt worden.
 *  - 'deterministic' -> klassiek, in één keer bij import (default, geen AI-calls).
 *  - 'ai'            -> voortschrijdend per chunk door de AI-knipper.
 * De modus wordt bij import in het boek gebakken; wisselen geldt pas bij (her)import.
 */
export function getSegmentMode(): SegmentMode {
  try {
    return localStorage.getItem(SEGMENT_MODE_KEY) === 'ai' ? 'ai' : 'deterministic'
  } catch {
    return 'deterministic'
  }
}

export function setSegmentMode(mode: SegmentMode): void {
  try {
    localStorage.setItem(SEGMENT_MODE_KEY, mode)
  } catch {
    // best-effort
  }
}

/**
 * Setting: geluid ontvangen (voorlezen/TTS) uit — automatisch én handmatig voorlezen.
 * Hergebruikt de bestaande mute-sleutel zodat de huidige stand behouden blijft. Default uit
 * (= geluid aan).
 */
export function loadAudioMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

export function saveAudioMuted(on: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, on ? '1' : '0')
  } catch {
    // best-effort
  }
}

/**
 * Setting: geluid produceren (microfoon/spraak-invoer) uit. Nieuw, eigen sleutel; heeft nog
 * geen consument (er is nog geen spraak-invoer) maar wordt vast bewaard voor komende
 * spraak-oefeningen. Default uit (= mic aan).
 */
export function loadMicMuted(): boolean {
  try {
    return localStorage.getItem(MIC_MUTED_KEY) === '1'
  } catch {
    return false
  }
}

export function saveMicMuted(on: boolean): void {
  try {
    localStorage.setItem(MIC_MUTED_KEY, on ? '1' : '0')
  } catch {
    // best-effort
  }
}

/**
 * Settings voor de werkwoorden-oefening: vanaf welke conj-box tier 2/3 begint, en of de tiers
 * echt door elkaar komen (i.p.v. oplopend tier 1 → 3). Eén object onder een eigen sleutel.
 */
export interface VerbSettings {
  /** Conj-box vanaf waar tier 2 (cloze) begint. 1..5. */
  tier2Min: number
  /** Conj-box vanaf waar tier 3 (vraag-antwoord) begint. 1..5. */
  tier3Min: number
  /** true = wachtrij echt husselen over alle tiers; false = oplopend op box (tier 1 eerst). */
  shuffleAll: boolean
}

export const DEFAULT_VERB_SETTINGS: VerbSettings = { tier2Min: 2, tier3Min: 4, shuffleAll: false }

/** Klemt de drempels netjes: 1 ≤ tier2Min ≤ tier3Min ≤ 5. */
function clampVerbSettings(s: VerbSettings): VerbSettings {
  const clamp = (n: number) => Math.min(5, Math.max(1, Math.round(Number.isFinite(n) ? n : 1)))
  const tier2Min = clamp(s.tier2Min)
  const tier3Min = Math.max(tier2Min, clamp(s.tier3Min))
  return { tier2Min, tier3Min, shuffleAll: !!s.shuffleAll }
}

export function loadVerbSettings(): VerbSettings {
  try {
    const raw = localStorage.getItem(VERB_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_VERB_SETTINGS }
    return clampVerbSettings({ ...DEFAULT_VERB_SETTINGS, ...JSON.parse(raw) })
  } catch {
    return { ...DEFAULT_VERB_SETTINGS }
  }
}

export function saveVerbSettings(s: VerbSettings): void {
  try {
    localStorage.setItem(VERB_SETTINGS_KEY, JSON.stringify(clampVerbSettings(s)))
  } catch {
    // best-effort
  }
}

/** Spaanse variant die de personenset/vervoegingen bij de werkwoord-oefening bepaalt. */
export type SpanishVariant = 'latam' | 'spain'

export const DEFAULT_SPANISH_VARIANT: SpanishVariant = 'latam'

/** Leest de variant; valideert strikt op 'latam'|'spain', anders default. */
export function loadSpanishVariant(): SpanishVariant {
  try {
    const raw = localStorage.getItem(SPANISH_VARIANT_KEY)
    return raw === 'latam' || raw === 'spain' ? raw : DEFAULT_SPANISH_VARIANT
  } catch {
    return DEFAULT_SPANISH_VARIANT
  }
}

export function saveSpanishVariant(v: SpanishVariant): void {
  try {
    localStorage.setItem(SPANISH_VARIANT_KEY, v === 'spain' ? 'spain' : 'latam')
  } catch {
    // best-effort
  }
}
