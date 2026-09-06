// Front-matter overslaan (Fase 4). Boeken beginnen zelden met het verhaal: eerst komt
// flaptekst, colofon (uitgever/jaartal/ISBN/ePub-metadata), opdracht en soms een
// inhoudsopgave. We bepalen éénmalig bij het importeren de zin-index waar het échte
// verhaal begint, zodat de app (en de hoofdstukkeuze) daar schoon start.
//
// Aanpak: de backend (/api/book-start, Gemini) beoordeelt de eerste zinnen. Lukt dat niet
// (geen key, fout, backend onbereikbaar), dan valt de client terug op een lichte
// tekst-heuristiek zodat import nooit vastloopt.

// Hoeveel zinnen we bekijken. Front-matter is in de praktijk kort; dit venster is ruim zat.
const WINDOW = 20

/** Regex-signalen voor colofon/flaptekst/opdracht — gebruikt door de heuristische fallback. */
const FRONT_MATTER_RE =
  /t[íi]tulo original|editor digital|dise[ñn]o|retoque|ilustraci|traducci[óo]n|©|®|isbn|dep[óo]sito legal|derechos reservados|todos los derechos|edici[óo]n|ePub|e-?book|r\d+\.\d+|^para\b/i

/**
 * Bepaalt de 0-based index van de eerste "echte" verhaalzin. Geeft 0 als er niets over te
 * slaan valt, of als detectie faalt (dan liever niets weggooien dan verkeerd knippen).
 */
export async function detectBookStart(sentences: string[]): Promise<number> {
  if (sentences.length <= 1) return 0

  const window = sentences.slice(0, WINDOW)
  try {
    const res = await fetch('/api/book-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentences: window }),
    })
    if (res.ok) {
      const json = (await res.json()) as { index?: number }
      const idx = json.index
      if (typeof idx === 'number' && Number.isFinite(idx) && idx >= 0 && idx < window.length) return idx
    }
  } catch {
    // val door naar de heuristiek
  }
  return heuristicStart(sentences)
}

/** Fallback zonder AI: sla vanaf de kop zinnen over die op colofon/opdracht lijken. */
function heuristicStart(sentences: string[]): number {
  const limit = Math.min(WINDOW, sentences.length)
  for (let i = 0; i < limit; i++) {
    if (!FRONT_MATTER_RE.test(sentences[i])) return i
  }
  return 0
}
