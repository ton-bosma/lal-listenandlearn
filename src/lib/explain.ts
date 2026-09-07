// Chat met de tutor (Gemini) via de backend (/api/chat). Twee ingangen op één contract:
//  - "Selecteer + uitleg": een geselecteerd stukje Spaans laten uitleggen (initiële uitleg).
//  - Vrije chat / vervolgvragen: een gesprek met eerdere beurten (+ optionele fragment-context).
// De prompt, de key en de gedeelde cache zitten server-side (zie server/index.js en docs/DEPLOY.md).
// Hier houden we alleen een lichte sessie-cache voor de initiële uitleg.

const cache = new Map<string, string>()

// Sleutel combineert zin + fragment (␟ als scheider komt niet in tekst voor).
const cacheKeyFor = (sentence: string, fragment: string) => `${sentence}␟${fragment}`

/** Eén bericht in het chat-gesprek: 'model' = de AI, 'user' = jouw (vervolg)vraag. */
export interface ChatMsg {
  role: 'user' | 'model'
  text: string
}

/**
 * Initiële uitleg van een geselecteerd fragment binnen zijn zin. Lege history + geen question +
 * alleen context → de backend geeft de openings-uitleg terug. Client-side gecachet per zin+fragment.
 */
export async function explainFragment(fragment: string, sentence: string): Promise<string> {
  const ck = cacheKeyFor(sentence, fragment)
  const cached = cache.get(ck)
  if (cached) return cached

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: { fragment, sentence } }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Uitleg-fout ${res.status}: ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as { text?: string }
  const text = (json.text ?? '').trim()
  if (!text) throw new Error('Geen uitleg ontvangen.')

  cache.set(ck, text)
  return text
}

/**
 * Een (vervolg)vraag in het chat-gesprek. Stuurt de eerdere beurten mee als history, plus optioneel
 * de fragment-context (zin + geselecteerd stukje). Niet gecachet (gespreksafhankelijk).
 */
export async function chatSend(
  history: ChatMsg[],
  question: string,
  context?: { fragment: string; sentence: string },
): Promise<string> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ history, question, context }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Uitleg-fout ${res.status}: ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as { text?: string }
  const text = (json.text ?? '').trim()
  if (!text) throw new Error('Geen antwoord ontvangen.')
  return text
}
