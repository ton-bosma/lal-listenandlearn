// Voortgang onthouden: welke zin was je in het huidige boek?
//
// FASE 1: één (dummy) boek, positie in localStorage.
// LATER: meerdere boeken -> sleutel per boek-id (zie docs/SPEC.md, nice-to-have).

const PROGRESS_KEY = 'spaanleren.progress.v1'
const BOOK_KEY = 'spaanleren.book.v1'

interface Progress {
  /** Index van de huidige zin in het boek. */
  index: number
}

/** Een hoofdstuk: titel + de zin-index waar het begint. */
export interface Chapter {
  title: string
  start: number
}

/** Het ingeladen boek (Fase 4). Meerdere boeken = later; nu één "current". */
export interface Book {
  name: string
  sentences: string[]
  chapters?: Chapter[]
}

export function loadBook(): Book | null {
  try {
    const raw = localStorage.getItem(BOOK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Book>
    if (typeof parsed.name === 'string' && Array.isArray(parsed.sentences)) {
      const chapters = Array.isArray(parsed.chapters)
        ? parsed.chapters.filter(
            (c): c is Chapter => !!c && typeof c.title === 'string' && typeof c.start === 'number',
          )
        : undefined
      return {
        name: parsed.name,
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
    return { index }
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
