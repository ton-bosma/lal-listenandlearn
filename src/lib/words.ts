// Woord-hulp voor de hovers: een Spaanse zin opsplitsen in klikbare/hoverbare
// tokens, en per token een genormaliseerde sleutel maken om de gloss op te zoeken.

export interface Token {
  /** Zoals het in de zin staat, incl. leestekens (bijv. "cocina."). */
  raw: string
  /** Genormaliseerd voor gloss-lookup (bijv. "cocina"). Leeg voor pure interpunctie/spaties. */
  key: string
  /** True als dit een echt woord is (geen spatie/leesteken) en dus een hover krijgt. */
  isWord: boolean
}

/** Kleine letters + leestekens aan begin/eind eraf. Accenten blijven staan (mañana ≠ manana). */
export function normalizeWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[^\p{L}\p{N}]+$/u, '')
}

/**
 * Splitst een zin in tokens, met spaties en interpunctie als losse niet-woord-tokens,
 * zodat de zin exact reconstrueerbaar blijft bij het renderen.
 */
export function tokenize(sentence: string): Token[] {
  // Splits op woordgrenzen maar behoud de scheidingstekens.
  const parts = sentence.match(/(\p{L}[\p{L}\p{N}'’-]*|\s+|[^\s\p{L}\p{N}]+)/gu) ?? []
  return parts.map((raw) => {
    const isWord = /\p{L}/u.test(raw) && !/^\s+$/.test(raw)
    return { raw, key: isWord ? normalizeWord(raw) : '', isWord }
  })
}
