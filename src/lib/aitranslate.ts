// AI-vertaling ("poging 2" of "1e keus"): één zin vertalen mét de omringende zinnen als
// context, via de backend (/api/ai-translate, Gemini). Bedoeld voor gevallen waar Google
// Translate op een los, grammaticaal onafgemaakt fragment struikelt (dialoog waar een
// voorwaarde over de zinsgrens doorloopt). Prompt, key en gedeelde cache zitten server-side.

const cache = new Map<string, string>()

// Sleutel = context + doelzin (dezelfde zin kan elders andere buren hebben).
const cacheKeyFor = (prev: string, current: string, next: string) => `${prev}␞${current}␞${next}`

/** Vertaalt `current` naar NL met `prev`/`next` als context. Geeft alleen de doelzin terug. */
export async function aiTranslateSentence(prev: string, current: string, next: string): Promise<string> {
  const ck = cacheKeyFor(prev, current, next)
  const cached = cache.get(ck)
  if (cached) return cached

  const res = await fetch('/api/ai-translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prev, current, next }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI-vertaalfout ${res.status}: ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as { text?: string }
  const text = (json.text ?? '').trim()
  if (!text) throw new Error('Geen AI-vertaling ontvangen.')

  cache.set(ck, text)
  return text
}
