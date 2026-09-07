// Handmatig een woord/frase toevoegen via AI: de backend (/api/add-word, Gemini) detecteert de
// richting, vertaalt en verzint een voorbeeldzin. Zo kun je een woord toevoegen dat je niet in de
// tekst tegenkwam. Prompt, key en gedeelde cache zitten server-side (zie server/index.js). Zelfde
// fetch-/foutstijl als de andere Gemini-endpoints (zie aitranslate.ts / explain.ts).

/** Eén AI-voorstel voor een toe te voegen woord (bewerkbaar voordat je 't opslaat). */
export interface WordSuggestion {
  /** Het Spaanse woord/de frase (de vorm die in de woordenlijst komt). */
  word: string
  /** NL-vertaling (de gloss). */
  translation: string
  /** Een Spaanse voorbeeldzin met het woord (context). */
  context: string
  /** Welke richting de AI detecteerde: NL→ES of ES→NL. Voor het omdraaien bij misdetectie. */
  detected: 'nl2es' | 'es2nl'
}

/**
 * Vraagt de AI om een woordvoorstel voor `text`. `direction` stuurt de richting: 'auto' laat de
 * backend detecteren, 'nl2es'/'es2nl' dwingt hem af (om een verkeerde auto-detectie te corrigeren).
 */
export async function fetchWordSuggestion(
  text: string,
  direction: 'auto' | 'nl2es' | 'es2nl' = 'auto',
): Promise<WordSuggestion> {
  const res = await fetch('/api/add-word', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, direction }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Woordvoorstel-fout ${res.status}: ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as Partial<WordSuggestion>
  const word = (json.word ?? '').trim()
  const translation = (json.translation ?? '').trim()
  const context = (json.context ?? '').trim()
  const detected = json.detected === 'nl2es' || json.detected === 'es2nl' ? json.detected : 'es2nl'
  if (!word) throw new Error('Geen woordvoorstel ontvangen.')
  return { word, translation, context, detected }
}
