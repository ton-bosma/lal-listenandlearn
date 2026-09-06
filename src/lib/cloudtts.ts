// Optionele "natuurlijke stem" via de backend (/api/tts, /api/voices — Cloud Text-to-Speech).
//
// - Naast de gratis browser-stem. De gebruiker kiest in de stem-dropdown of hij een
//   browserstem of een Cloud-stem (☁) wil.
// - Key en de gedeelde, persistente mp3-cache zitten server-side (zie server/index.js).
// - Hier houden we een lichte in-memory sessie-cache van blob-URL's voor directe herhaling.

export interface CloudVoice {
  name: string
  lang: string
  gender?: string
}

// --- Stemmenlijst (gecached) -----------------------------------------------------

let voicesCache: CloudVoice[] | null = null

/** Haalt de Spaanse Cloud-stemmen op via de backend (eenmalig gecached). */
export async function listSpanishCloudVoices(): Promise<CloudVoice[]> {
  if (voicesCache) return voicesCache
  const res = await fetch('/api/voices')
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Cloud TTS voices-fout ${res.status}: ${detail.slice(0, 160)}`)
  }
  const json = (await res.json()) as { voices?: CloudVoice[] }
  voicesCache = json.voices ?? []
  return voicesCache
}

// --- Audio-cache (sessie, in-memory) ---------------------------------------------

const audioCache = new Map<string, string>() // cacheKey -> object-URL

// --- Synthese + afspelen ---------------------------------------------------------

let currentAudio: HTMLAudioElement | null = null

/** Haalt de mp3 voor een zin op bij de backend en geeft een afspeelbare object-URL terug. */
async function synthesize(text: string, voice: CloudVoice, rate: number): Promise<string> {
  const cacheKey = `${voice.name}|${rate}|${text}`
  const cached = audioCache.get(cacheKey)
  if (cached) return cached

  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: voice.name, lang: voice.lang, rate }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Cloud TTS-fout ${res.status}: ${detail.slice(0, 160)}`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  audioCache.set(cacheKey, url)
  return url
}

/** Leest een zin voor met een Cloud-stem. Async; fouten worden gegooid. */
export async function speakCloud(text: string, voice: CloudVoice, rate: number): Promise<void> {
  stopCloud()
  const url = await synthesize(text, voice, rate)
  const audio = new Audio(url)
  currentAudio = audio
  await audio.play()
}

export function stopCloud(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
}
