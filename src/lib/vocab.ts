// Woordenlijst: onbekende woorden die je markeert, server-side bewaard (/api/vocab) zodat je
// ze niet verliest. Eén gedeelde lijst voorlopig; per-profiel is een latere uitbreiding.
// De opgeslagen velden (incl. context-zin) zijn zo gekozen dat er later flashcards van kunnen.

export interface VocabWord {
  /** Genormaliseerd woord (lowercase) — identiteit + voor het oplichten in de tekst. */
  key: string
  /** Weergavevorm zoals je 'm zag. */
  word: string
  /** NL-vertaling (de gloss). */
  translation: string
  /** De Spaanse zin waarin je 'm tegenkwam (context voor later). */
  context: string
  /** ISO-datum van toevoegen (door de server gezet). */
  addedAt?: string
  /** Woordsoort (optioneel; server vult aan indien niet meegegeven). */
  type?: 'werkwoord' | 'zelfstandig' | 'bijvoeglijk' | 'overig'
  /** Infinitief bij werkwoorden (optioneel; server vult aan indien niet meegegeven). */
  infinitive?: string
}

function parseList(json: unknown): VocabWord[] {
  const words = (json as { words?: unknown })?.words
  return Array.isArray(words) ? (words as VocabWord[]) : []
}

export async function listVocab(): Promise<VocabWord[]> {
  const res = await fetch('/api/vocab')
  if (!res.ok) throw new Error(`Woordenlijst-fout ${res.status}`)
  return parseList(await res.json())
}

/** Voegt een woord toe (server dedupliceert op key) en geeft de bijgewerkte lijst terug. */
export async function addVocab(word: Omit<VocabWord, 'addedAt'>): Promise<VocabWord[]> {
  const res = await fetch('/api/vocab', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(word),
  })
  if (!res.ok) throw new Error(`Woord toevoegen mislukt (${res.status})`)
  return parseList(await res.json())
}

/**
 * Werkt een woord bij op sleutel: de vertaling en/of het woord zelf. Bij een woord-wijziging
 * verandert de sleutel mee (`newKey`, client-side herberekend); de server hernoemt + dedupliceert.
 */
export async function updateVocab(
  key: string,
  patch: { translation?: string; word?: string; newKey?: string },
): Promise<VocabWord[]> {
  const res = await fetch('/api/vocab/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, ...patch }),
  })
  if (!res.ok) throw new Error(`Woord bijwerken mislukt (${res.status})`)
  return parseList(await res.json())
}

/** Verwijdert een woord op key en geeft de bijgewerkte lijst terug. */
export async function removeVocab(key: string): Promise<VocabWord[]> {
  const res = await fetch('/api/vocab/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  if (!res.ok) throw new Error(`Woord verwijderen mislukt (${res.status})`)
  return parseList(await res.json())
}
