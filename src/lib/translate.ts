// Vertalen via Google Cloud Translation (v2 REST), met lokale cache.
//
// - Bron: Spaans (es) -> doel: Nederlands (nl).
// - Elke bron-string wordt max één keer echt vertaald; daarna uit de cache (localStorage).
// - In dev loopt het verkeer via de Vite-proxy "/gtranslate" (zie vite.config.ts) om CORS
//   te omzeilen. De key komt uit .env (VITE_GOOGLE_TRANSLATE_KEY).
//
// Publiek:
//   translateSentence(es)      -> Promise<string>            (de NL-zin)
//   translateWords(words[])    -> Promise<Record<key, nl>>   (glossen voor de hovers)
//
// Zie docs/SPEC.md en docs/STATUS.md.

const KEY = import.meta.env.VITE_GOOGLE_TRANSLATE_KEY as string | undefined
const BASE = '/gtranslate' // Vite-proxy -> https://translation.googleapis.com
const CACHE_KEY = 'spaanleren.translateCache.v1'

/** Gegooid als er geen key is ingesteld; de UI toont dit netjes. */
export class MissingKeyError extends Error {
  constructor() {
    super('Geen Google Translate-key ingesteld (zie .env.example).')
    this.name = 'MissingKeyError'
  }
}

export function hasTranslateKey(): boolean {
  return typeof KEY === 'string' && KEY.trim().length > 0
}

// --- Cache (bron-string -> vertaling), in-memory + localStorage ------------------

const cache = new Map<string, string>(loadCache())

function loadCache(): [string, string][] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    return Object.entries(JSON.parse(raw) as Record<string, string>)
  } catch {
    return []
  }
}

function persistCache(): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(cache)))
  } catch {
    // cache-persistentie is best-effort
  }
}

// --- Kern: batch-vertaling met cache ---------------------------------------------

/**
 * Vertaalt een lijst bron-strings naar NL. Gebruikt de cache; alleen wat nog niet
 * gecached is gaat in één request naar Google. Volgorde blijft behouden.
 */
async function translateBatch(texts: string[]): Promise<string[]> {
  if (!hasTranslateKey()) throw new MissingKeyError()

  const missing = [...new Set(texts.filter((t) => t.trim() !== '' && !cache.has(t)))]

  if (missing.length > 0) {
    const res = await fetch(`${BASE}/language/translate/v2?key=${encodeURIComponent(KEY!)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: missing, source: 'es', target: 'nl', format: 'text' }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Translate API-fout ${res.status}: ${detail.slice(0, 200)}`)
    }
    const json = (await res.json()) as {
      data?: { translations?: { translatedText: string }[] }
    }
    const translations = json.data?.translations ?? []
    missing.forEach((src, i) => {
      const nl = translations[i]?.translatedText
      if (typeof nl === 'string') cache.set(src, nl)
    })
    persistCache()
  }

  return texts.map((t) => (t.trim() === '' ? t : cache.get(t) ?? t))
}

// --- Publieke helpers ------------------------------------------------------------

export async function translateSentence(es: string): Promise<string> {
  const [nl] = await translateBatch([es])
  return nl
}

/** Vertaalt losse woorden; geeft een map {woord -> NL} terug. */
export async function translateWords(words: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(words.filter((w) => w.trim() !== ''))]
  const results = await translateBatch(unique)
  const map: Record<string, string> = {}
  unique.forEach((w, i) => {
    map[w] = results[i]
  })
  return map
}
