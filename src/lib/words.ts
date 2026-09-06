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

/**
 * Sleutel voor identiteit + oplichten. Negeert hoofdletters, punten, apostrofs en overige
 * leestekens (ook intern), zodat "correr", "Correr." en "correr'" hetzelfde zijn. Accenten
 * blijven staan (mañana ≠ manana). Spaties blijven behouden voor combinaties ("por eso").
 */
export function normalizeWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Kleine, gangbare Spaanse afkortingen waarvan de punt(en) bij het woord horen. */
const KNOWN_ABBR = new Set([
  'etc.', 'sr.', 'sra.', 'srta.', 'dr.', 'dra.', 'ud.', 'uds.', 'pág.', 'núm.', 'p.ej.',
  'a.c.', 'd.c.', 'ee.uu.', 'vs.', 'art.',
])

/**
 * Opschoning van de WEERGAVE bij het toevoegen aan de woordenlijst: kleine letters + leestekens/
 * aanhalingstekens aan begin/eind eraf. Uitzondering: afkortingen behouden hun punt(en) — een
 * token met een interne punt (EE.UU., a.C., p.ej.) of één uit de bekende lijst (etc., pág.).
 */
export function cleanWord(raw: string): string {
  const lower = raw.trim().toLowerCase()
  const noLead = lower.replace(/^[^\p{L}\p{N}]+/u, '') // rommel vooraan altijd weg
  if (/\p{L}\.\p{L}/u.test(noLead) || KNOWN_ABBR.has(noLead)) return noLead // afkorting: punt(en) blijven
  return noLead.replace(/[^\p{L}\p{N}]+$/u, '') // anders: leestekens achteraan weg
}

/**
 * Splitst een zin in tokens, met spaties en interpunctie als losse niet-woord-tokens,
 * zodat de zin exact reconstrueerbaar blijft bij het renderen.
 */
export function tokenize(sentence: string): Token[] {
  // Splits op woordgrenzen maar behoud de scheidingstekens. Een token mag met een letter óf een
  // cijfer beginnen, zodat losse getallen (bijv. "40", een jaartal) niet uit de weergave vallen.
  const parts = sentence.match(/([\p{L}\p{N}][\p{L}\p{N}'’-]*|\s+|[^\s\p{L}\p{N}]+)/gu) ?? []
  return parts.map((raw) => {
    // Alleen echte woorden (met een letter) krijgen een hover/gloss; pure getallen niet.
    const isWord = /\p{L}/u.test(raw) && !/^\s+$/.test(raw)
    return { raw, key: isWord ? normalizeWord(raw) : '', isWord }
  })
}
