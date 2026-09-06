// Welke features de backend aanbiedt, hangt af van welke keys server-side gezet zijn.
// De client vraagt dat éénmaal op bij /api/health en gebruikt het om knoppen te disablen.

export interface Features {
  translate: boolean
  tts: boolean
  gemini: boolean
}

export const NO_FEATURES: Features = { translate: false, tts: false, gemini: false }

export async function fetchFeatures(): Promise<Features> {
  try {
    const res = await fetch('/api/health')
    if (!res.ok) return NO_FEATURES
    const json = (await res.json()) as { features?: Partial<Features> }
    const f = json.features ?? {}
    return { translate: !!f.translate, tts: !!f.tts, gemini: !!f.gemini }
  } catch {
    return NO_FEATURES
  }
}
