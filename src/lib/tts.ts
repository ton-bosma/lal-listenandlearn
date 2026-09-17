// Voorlezen (text-to-speech). Twee bronnen, één ingang (speak):
//  - Gratis browser-stem (Web Speech API). Standaard.
//  - Optionele Google Cloud-stem (☁), natuurlijker. Zie cloudtts.ts.
//
// De gekozen stem is een generiek id (opgeslagen in localStorage):
//   ''                     -> automatisch (browser, Latijns-Amerikaans)
//   'browser:<voiceURI>'   -> specifieke browserstem
//   'cloud:<name>:<lang>'  -> Cloud-stem (bijv. cloud:es-US-Neural2-A:es-US)
//   '<voiceURI>'           -> legacy (oude opslag) = browserstem
//
// Stemmen laden async: getVoices() is bij een verse load leeg en vult zich later
// ("voiceschanged"). We cachen ze en laten React zich abonneren op wijzigingen.

import { type CloudVoice, speakCloud, stopCloud } from './cloudtts'

const VOICE_KEY = 'spaanleren.voiceURI.v1'

/** Voorkeursvolgorde voor een Latijns-Amerikaans accent (auto-keuze). */
const LATAM_HINTS = ['es-mx', 'es-us', 'es-419', 'es-ar', 'es-co', 'es-cl', 'es-la']

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

let primed = false
/**
 * Ontgrendelt de browser-spraak binnen een user-gesture (iOS eist een gebaar voordat
 * speechSynthesis mag klinken). Eénmalig aanroepen vanuit een tik (navigatie/Luister); daarna
 * werkt ook het automatische voorlezen bij zin-wissel. Op desktop stil en zonder merkbaar effect.
 */
export function primeSpeech(): void {
  if (primed || !ttsSupported()) return
  primed = true
  try {
    const u = new SpeechSynthesisUtterance('')
    u.volume = 0
    window.speechSynthesis.speak(u)
    window.speechSynthesis.resume()
  } catch {
    /* stil: priming is best-effort */
  }
}

// --- Browserstemmen cachen + abonneren -------------------------------------------

let cachedVoices: SpeechSynthesisVoice[] = []
const listeners = new Set<() => void>()

function refreshVoices(): void {
  if (!ttsSupported()) return
  cachedVoices = window.speechSynthesis.getVoices()
  listeners.forEach((l) => l())
}

if (ttsSupported()) {
  refreshVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', refreshVoices)
}

export function subscribeVoices(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getSpanishVoices(): SpeechSynthesisVoice[] {
  return cachedVoices.filter((v) => v.lang.toLowerCase().startsWith('es'))
}

// --- Foutmeldingen (Cloud-pad is async; auto-voorlezen vangt niet zelf) -----------

const errorListeners = new Set<(msg: string) => void>()
export function subscribeTtsError(cb: (msg: string) => void): () => void {
  errorListeners.add(cb)
  return () => errorListeners.delete(cb)
}
function reportError(err: unknown): void {
  const msg = err instanceof Error ? err.message : 'Onbekende fout bij voorlezen.'
  errorListeners.forEach((l) => l(msg))
}

// --- Stemkeuze -------------------------------------------------------------------

export function getChosenVoiceId(): string {
  try {
    return localStorage.getItem(VOICE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setChosenVoiceId(id: string | null): void {
  try {
    if (id) localStorage.setItem(VOICE_KEY, id)
    else localStorage.removeItem(VOICE_KEY)
  } catch {
    // best-effort
  }
}

function autoPickSpanishVoice(): SpeechSynthesisVoice | undefined {
  const spanish = getSpanishVoices()
  if (spanish.length === 0) return undefined
  for (const hint of LATAM_HINTS) {
    const match = spanish.find((v) => v.lang.toLowerCase().startsWith(hint))
    if (match) return match
  }
  return spanish.find((v) => !v.lang.toLowerCase().startsWith('es-es')) ?? spanish[0]
}

// --- Voorlezen -------------------------------------------------------------------

/** Leest één zin voor met de gekozen stem (browser of Cloud). rate 0.5..1.5. */
export function speak(text: string, rate = 1): void {
  if (!text.trim()) return
  const id = getChosenVoiceId()

  if (id.startsWith('cloud:')) {
    const rest = id.slice('cloud:'.length)
    const sep = rest.lastIndexOf(':')
    const voice: CloudVoice = { name: rest.slice(0, sep), lang: rest.slice(sep + 1) }
    stopBrowser()
    speakCloud(text, voice, rate).catch(reportError)
    return
  }

  // Browserpad
  stopCloud()
  if (!ttsSupported()) return
  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  const uri = id.startsWith('browser:') ? id.slice('browser:'.length) : id // legacy = bare uri
  const voice = (uri && cachedVoices.find((v) => v.voiceURI === uri)) || autoPickSpanishVoice()
  if (voice) {
    utter.voice = voice
    utter.lang = voice.lang
  } else {
    utter.lang = 'es-MX'
  }
  utter.rate = rate
  window.speechSynthesis.speak(utter)
}

function stopBrowser(): void {
  if (ttsSupported()) window.speechSynthesis.cancel()
}

export function stopSpeaking(): void {
  stopBrowser()
  stopCloud()
}
