// Vertalen via de eigen backend (/api/translate). Keys en de persistente, gedeelde cache
// zitten server-side (zie server/index.js en docs/DEPLOY.md). Hier houden we alleen een
// lichte in-memory sessie-cache voor directe herhaling binnen dezelfde sessie.
//
// Publiek:
//   translateSentence(es)   -> Promise<string>            (de NL-zin)
//   translateWords(words[]) -> Promise<Record<key, nl>>   (glossen voor de hovers)

const cache = new Map<string, string>()

/**
 * Vertaalt een lijst bron-strings naar NL via de backend. Gebruikt de sessie-cache; alleen
 * wat nog niet gecached is gaat in één request naar de backend. Volgorde blijft behouden.
 */
async function translateBatch(texts: string[]): Promise<string[]> {
  const missing = [...new Set(texts.filter((t) => t.trim() !== '' && !cache.has(t)))]

  if (missing.length > 0) {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: missing }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Vertaalfout ${res.status}: ${detail.slice(0, 200)}`)
    }
    const json = (await res.json()) as { translations?: string[] }
    const translations = json.translations ?? []
    missing.forEach((src, i) => {
      const nl = translations[i]
      if (typeof nl === 'string') cache.set(src, nl)
    })
  }

  return texts.map((t) => (t.trim() === '' ? t : cache.get(t) ?? t))
}

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
