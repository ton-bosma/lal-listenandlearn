// Optionele "natuurlijke stem" via Google Cloud Text-to-Speech (Fase 5 / "A").
//
// - Naast de gratis browser-stem. De gebruiker kiest in de stem-dropdown of hij een
//   browserstem of een Cloud-stem (☁) wil.
// - Hergebruikt dezelfde Google Cloud-key als Translate (zelfde project). Vereist dat de
//   Cloud Text-to-Speech API aan staat én de key die API mag aanroepen.
// - In dev via de Vite-proxy "/gtts" (CORS). Audio wordt lokaal in IndexedDB gecached
//   (per stem + snelheid + tekst), zodat herhalen en latere sessies gratis zijn.
//
// Gratis laag (2026): Neural2/Chirp3-HD 1M tekens/mnd, WaveNet 4M — verloopt niet.

const KEY = import.meta.env.VITE_GOOGLE_TRANSLATE_KEY as string | undefined
const BASE = '/gtts' // Vite-proxy -> https://texttospeech.googleapis.com

export function hasCloudKey(): boolean {
  return typeof KEY === 'string' && KEY.trim().length > 0
}

export interface CloudVoice {
  name: string
  lang: string
  gender?: string
}

// --- Stemmenlijst (gecached) -----------------------------------------------------

let voicesCache: CloudVoice[] | null = null

/** Haalt de Spaanse Cloud-stemmen op (eenmalig gecached). Lege lijst zonder key. */
export async function listSpanishCloudVoices(): Promise<CloudVoice[]> {
  if (!hasCloudKey()) return []
  if (voicesCache) return voicesCache
  const res = await fetch(`${BASE}/v1/voices?languageCode=es&key=${encodeURIComponent(KEY!)}`)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Cloud TTS voices-fout ${res.status}: ${detail.slice(0, 160)}`)
  }
  const json = (await res.json()) as {
    voices?: { name: string; languageCodes?: string[]; ssmlGender?: string }[]
  }
  voicesCache = (json.voices ?? [])
    .map((v) => ({ name: v.name, lang: v.languageCodes?.[0] ?? '', gender: v.ssmlGender }))
    .filter((v) => v.lang.toLowerCase().startsWith('es'))
    .sort((a, b) => a.name.localeCompare(b.name))
  return voicesCache
}

// --- Audio-cache in IndexedDB ----------------------------------------------------

const DB_NAME = 'spaanleren-tts'
const STORE = 'audio'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<string | undefined> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const rq = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      rq.onsuccess = () => resolve(rq.result as string | undefined)
      rq.onerror = () => resolve(undefined)
    })
  } catch {
    return undefined
  }
}

async function idbSet(key: string, value: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // cache is best-effort
  }
}

// --- Synthese + afspelen ---------------------------------------------------------

let currentAudio: HTMLAudioElement | null = null

/** Zet tekst om naar een afspeelbare data-URL (MP3), met cache per stem+snelheid+tekst. */
async function synthesize(text: string, voice: CloudVoice, rate: number): Promise<string> {
  const cacheKey = `${voice.name}|${rate}|${text}`
  const cached = await idbGet(cacheKey)
  if (cached) return cached

  const res = await fetch(`${BASE}/v1/text:synthesize?key=${encodeURIComponent(KEY!)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: voice.lang, name: voice.name },
      audioConfig: { audioEncoding: 'MP3', speakingRate: rate },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Cloud TTS-fout ${res.status}: ${detail.slice(0, 160)}`)
  }
  const json = (await res.json()) as { audioContent?: string }
  if (!json.audioContent) throw new Error('Cloud TTS gaf geen audio terug.')
  const dataUrl = `data:audio/mp3;base64,${json.audioContent}`
  await idbSet(cacheKey, dataUrl)
  return dataUrl
}

/** Leest een zin voor met een Cloud-stem. Async; fouten worden gegooid. */
export async function speakCloud(text: string, voice: CloudVoice, rate: number): Promise<void> {
  stopCloud()
  const dataUrl = await synthesize(text, voice, rate)
  const audio = new Audio(dataUrl)
  currentAudio = audio
  await audio.play()
}

export function stopCloud(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
}
