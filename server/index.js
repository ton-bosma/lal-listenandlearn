// LAL-backend: houdt de API-keys server-side, proxyt naar Google, en cachet dure resultaten
// op een gemount volume (gedeeld tussen gebruikers). Zie docs/DEPLOY.md voor de architectuur.
//
// Endpoints (allemaal onder /api):
//   GET  /api/health       -> welke features beschikbaar zijn (welke keys gezet)
//   POST /api/translate    -> Cloud Translate (batch), cache per tekst
//   POST /api/chat         -> Gemini: Spaans-tutor (fragment-uitleg + vrije chat), cache op initiële uitleg
//   POST /api/ai-translate -> Gemini: zin vertalen mét context, cache
//   POST /api/tts          -> Cloud TTS: mp3-bytes, cache
//   GET  /api/voices       -> Cloud TTS: Spaanse stemmen, cache
//
// Env: GOOGLE_CLOUD_KEY (Translate + TTS), GEMINI_KEY, CACHE_DIR (default ./cache), PORT (3001).
// In dev vallen we terug op de bestaande VITE_*-namen zodat de huidige .env blijft werken.

import express from 'express'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// --- Config ----------------------------------------------------------------------

const GOOGLE_KEY = process.env.GOOGLE_CLOUD_KEY || process.env.VITE_GOOGLE_TRANSLATE_KEY || ''
const GEMINI_KEY = process.env.GEMINI_KEY || process.env.VITE_GEMINI_KEY || ''
const CACHE_DIR = process.env.CACHE_DIR || join(__dirname, '..', 'cache')
const PORT = Number(process.env.PORT) || 3001
const GEMINI_MODEL = 'gemini-flash-latest'
const GEMINI_MAX_TOKENS = 2048 // ruim: thinking-tokens tellen mee (te krap -> leeg antwoord)
const BOOK_START_WINDOW = 20 // hoeveel begin-zinnen we aan de front-matter-detectie geven
const SEGMENT_PROMPT_VERSION = 3
const STORY_START_PROMPT_VERSION = 2
const PRACTICE_PROMPT_VERSION = 1
const ADDWORD_PROMPT_VERSION = 1
const CHAT_PROMPT_VERSION = 1

const hasGoogle = () => GOOGLE_KEY.trim().length > 0
const hasGemini = () => GEMINI_KEY.trim().length > 0

// --- Filesystem-cache ------------------------------------------------------------

const sha256 = (s) => createHash('sha256').update(s).digest('hex')

/** Pad binnen de cache-map, submap aangemaakt indien nodig. */
async function cachePath(sub, name) {
  const dir = join(CACHE_DIR, sub)
  await mkdir(dir, { recursive: true })
  return join(dir, name)
}

async function readCacheText(sub, key) {
  try {
    return await readFile(await cachePath(sub, `${sha256(key)}.txt`), 'utf8')
  } catch {
    return null
  }
}

async function writeCacheText(sub, key, value) {
  try {
    await writeFile(await cachePath(sub, `${sha256(key)}.txt`), value, 'utf8')
  } catch {
    // cache is best-effort
  }
}

// --- Woordenlijst (persistente data, GEEN cache -> niet mee-wissen!) --------------

const VOCAB_FILE = join(CACHE_DIR, 'vocab.json')

async function readVocab() {
  try {
    const json = JSON.parse(await readFile(VOCAB_FILE, 'utf8'))
    return Array.isArray(json?.words) ? json.words : []
  } catch {
    return []
  }
}

async function writeVocab(words) {
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(VOCAB_FILE, JSON.stringify({ words }, null, 2), 'utf8')
}

// --- Google-clients --------------------------------------------------------------

/** Roept Gemini aan met een kant-en-klare contents-array en geeft de platte tekst terug. Gooit bij fouten. */
async function geminiChat(contents, temperature = 0.3, maxTokens = GEMINI_MAX_TOKENS) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature, maxOutputTokens: maxTokens },
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gemini ${res.status}: ${detail.slice(0, 200)}`)
  }
  const json = await res.json()
  const parts = json?.candidates?.[0]?.content?.parts ?? []
  const text = parts.map((p) => p.text ?? '').join('').trim()
  if (!text) {
    const reason = json?.promptFeedback?.blockReason
    throw new Error(reason ? `Gemini blokkeerde: ${reason}` : 'Gemini gaf geen antwoord.')
  }
  return text
}

/** Roept Gemini aan met een enkele prompt-string en geeft de platte tekst terug. Gooit bij fouten. */
async function geminiGenerate(prompt, temperature = 0.3, maxTokens = GEMINI_MAX_TOKENS) {
  return geminiChat([{ role: 'user', parts: [{ text: prompt }] }], temperature, maxTokens)
}

// --- Prompts (server-side; client stuurt alleen de tekst) ------------------------

/** Framing die voor alle tutor-interacties geldt (initiële uitleg én vrije chat). */
function chatSystemPrompt() {
  return [
    'Je bent een vriendelijke, beknopte docent Spaans voor een Nederlandstalige die Spaans leert.',
    'Je antwoordt altijd in het Nederlands, helder en to-the-point. Je helpt met grammatica,',
    'woorden, uitdrukkingen, en vragen over de tekst die de leerling leest.',
  ].join('\n')
}

/** Initiële uitleg van een geselecteerd fragment binnen een zin (cachebaar, geen gesprek). */
function explainFragmentPrompt(fragment, sentence) {
  return [
    chatSystemPrompt(),
    '',
    `Spaanse zin (context): "${sentence}"`,
    `Geselecteerd deel: "${fragment}"`,
    '',
    'Leg het geselecteerde deel uit. Antwoord beknopt en helder,',
    'zonder inleiding, exact in deze structuur (elk op een eigen regel):',
    '- Natuurlijk: <vloeiende Nederlandse vertaling van het geselecteerde deel>',
    '- Letterlijk: <letterlijke, woord-voor-woord vertaling>',
    '- Uitleg: <korte uitleg van de grammatica, constructie of idioom>',
    '',
    'Als het geselecteerde deel een vaste uitdrukking/idioom is (bijv. "a veces" = "soms"),',
    'benoem dat expliciet bij Uitleg en maak duidelijk dat de letterlijke vertaling niet de',
    'werkelijke betekenis is.',
  ].join('\n')
}

/** Framing voor een vrije chatvraag mét grounding op een fragment/zin uit de tekst. */
function chatContextPrompt(fragment, sentence) {
  return [
    chatSystemPrompt(),
    '',
    `Spaanse zin (context): "${sentence}"`,
    `Geselecteerd deel: "${fragment}"`,
    '',
    'De leerling stelt hierna een vraag over deze tekst. Gebruik de context waar relevant.',
  ].join('\n')
}

function aiTranslatePrompt(prev, current, next) {
  const lines = [
    'Je bent een vertaler Spaans naar Nederlands.',
    'Hieronder staan opeenvolgende zinnen uit een boek. Vertaal ALLEEN de gemarkeerde zin',
    '(die met ">>>") naar natuurlijk, vloeiend Nederlands. Gebruik de omringende zinnen',
    'uitsluitend als context — bijvoorbeeld om een voorwaarde of dialoog die over de zinsgrens',
    'doorloopt goed te laten aansluiten. Geef UITSLUITEND de Nederlandse vertaling van de',
    'gemarkeerde zin terug: geen aanhalingstekens, geen labels, geen uitleg.',
    '',
  ]
  if (prev) lines.push(`    ${prev}`)
  lines.push(`>>> ${current}`)
  if (next) lines.push(`    ${next}`)
  return lines.join('\n')
}

function practiceSentencePrompt(word, translation, seed) {
  return [
    'Je bent een Spaans-docent voor een Nederlandstalige die Spaans leert.',
    `Woord: "${word}"${translation ? ` (Nederlands: "${translation}")` : ''}`,
    '',
    'Bedenk één natuurlijke, leerzame Spaanse zin waarin dit woord voorkomt. Is het woord een',
    'werkwoord, gebruik dan bewust een AFWISSELENDE vervoeging: varieer persoon (yo/tú/él.../',
    'nosotros/ellos) en tijd (bijv. presente, pretérito, imperfecto, futuro) in plaats van steeds',
    'dezelfde vorm — dit traint juist de werkwoordsuitgangen. Houd de zin kort en op leer-niveau',
    '(geen ingewikkelde bijzinnen).',
    '',
    `Variatie-kiem: ${seed}. Gebruik die alleen om een andere variant te kiezen dan een vorige`,
    'keer (andere persoon/tijd/zinsopbouw); noem het getal zelf niet in de zin.',
    '',
    'Geef UITSLUITEND een geldig JSON-object terug, zonder codeblok-fences en zonder tekst',
    'eromheen, in dit formaat:',
    '{ "sentence": "<Spaanse zin met het woord>", "translation": "<natuurlijke NL-vertaling van die zin>" }',
  ].join('\n')
}

function addWordPrompt(text, direction) {
  const lines = ['Je bent een vertaler Spaans-Nederlands voor een Nederlandstalige die Spaans leert.']
  if (direction === 'nl2es') {
    lines.push(
      `Nederlandse tekst: "${text}"`,
      '',
      'Behandel deze tekst als NEDERLANDS, ook als die er ook Spaans uit zou kunnen zien. Geef het',
      'natuurlijke Spaanse equivalent. Is het een frase van meerdere woorden, vertaal die als één',
      'geheel (niet woord-voor-woord).',
    )
  } else if (direction === 'es2nl') {
    lines.push(
      `Spaanse tekst: "${text}"`,
      '',
      'Behandel deze tekst als SPAANS, ook als die er ook Nederlands uit zou kunnen zien. Vertaal',
      'naar natuurlijk Nederlands. Is het een frase van meerdere woorden, vertaal die als één geheel',
      '(niet woord-voor-woord).',
    )
  } else {
    lines.push(
      `Tekst: "${text}"`,
      '',
      'Bepaal eerst of deze tekst Nederlands of Spaans is. Is de tekst Spaans, vertaal hem naar',
      'natuurlijk Nederlands. Is de tekst Nederlands, geef het natuurlijke Spaanse equivalent. Is',
      'het een frase van meerdere woorden, behandel die als één geheel (niet woord-voor-woord).',
    )
  }
  lines.push(
    '',
    'Bedenk daarnaast één korte, natuurlijke Spaanse voorbeeldzin op leer-niveau (geen ingewikkelde',
    'bijzinnen) waarin het Spaanse woord/de Spaanse frase voorkomt.',
    '',
    'Geef UITSLUITEND een geldig JSON-object terug, zonder codeblok-fences en zonder tekst',
    'eromheen, in dit formaat:',
    '{ "word": "<het Spaanse woord/de Spaanse frase>", "translation": "<de Nederlandse vertaling>",',
    '  "context": "<Spaanse voorbeeldzin met het woord>", "detected": "nl2es of es2nl" }',
    '"word" is ALTIJD Spaans en "translation" ALTIJD Nederlands, ongeacht de invoerrichting.',
  )
  return lines.join('\n')
}

function bookStartPrompt(window) {
  const list = window.map((s, i) => `${i}: ${String(s).slice(0, 200)}`).join('\n')
  return [
    'Hieronder de eerste, genummerde zinnen van een boek. Aan het begin staat vaak géén',
    'verhaal maar "front-matter": flaptekst/achterflap, colofon (uitgever, jaartal, ISBN,',
    'ePub-metadata, vertaler, illustrator), een opdracht/dedicatie, en soms een inhoudsopgave.',
    'Het eigenlijke verhaal begint daarna.',
    '',
    'Geef ALLEEN het nummer van de eerste zin die tot het eigenlijke verhaal hoort.',
    'Antwoord met uitsluitend dat getal, zonder uitleg. Begint het verhaal meteen, antwoord 0.',
    '',
    list,
  ].join('\n')
}

function storyStartPrompt(chunks) {
  const list = chunks.map((c, i) => `[${i}]\n${c}`).join('\n\n')
  return [
    'Hieronder genummerde tekst-chunks uit het begin van een boek. Geef de index van de eerste',
    'chunk met LEESBARE inhoud (voorwoord, proloog, introductie, personage-introductie, opdracht,',
    'of het eerste hoofdstuk). Sla ALLEEN over: titelpagina, colofon, copyright/ISBN,',
    'inhoudsopgave. Bij twijfel: kies de VROEGERE chunk (liever iets te veel tonen dan inhoud',
    'missen). Als de leesbare inhoud al in chunk 0 begint, geef 0. Antwoord met UITSLUITEND het',
    'gehele getal, niets anders.',
    '',
    list,
  ].join('\n')
}

function segmentPrompt(text, next) {
  const lines = [
    'Je krijgt een passage uit een Spaanstalig boek, ruw geëxtraheerd uit een PDF. Lever een',
    'opgeschoonde versie, opgeknipt in korte leer-eenheden.',
    '',
    'Regels:',
    "- Verwijder alles wat geen verhaaltekst is: watermerken/bronregels (bijv. website-URLs of",
    "  regels als 'Книги на испанском от hispanoteca.ru'), losse paginanummers, kop- en",
    '  voetteksten, én voetnoten — zowel het cijfer-marker dat aan een woord vastplakt',
    "  (bijv. 'bar3' -> 'bar', 'País4' -> 'País') als de voetnoot-definitie onderaan een pagina.",
    '- Herstel woorden die door een regeleinde zijn afgebroken.',
    '- Knip in korte leer-eenheden: voeg twee korte, bij elkaar horende zinnen samen tot één',
    '  eenheid; knip een heel lange zin op een natuurlijke pauze (komma, puntkomma, voegwoord)',
    '  in twee of meer leesbare delen.',
    '- Vertaal NIET. Voeg NIETS toe. Verander de woorden niet, behalve het weghalen van',
    '  rommel/voetnoot-markers. Behoud de volgorde.',
    '- Als de hele passage rommel is, geef een lege array terug.',
    '',
    'Sectie-detectie: als deze passage een NIEUWE sectie/hoofdstuk begint, geef ook "section"',
    'terug. Staat er een kop in de tekst (bijv. "1", "Capítulo 1", een echte titel)? Neem die',
    'verbatim over met "generated": false. Staat er GEEN kop maar begint de tekst duidelijk een',
    'aparte sectie zonder titel (voorwoord/proloog/introductie/personagelijst/opdracht)? Verzin',
    'een kort NEDERLANDS label ("Voorwoord", "Proloog", "Introductie", "Personages", "Opdracht")',
    'met "generated": true. "unit" is de 0-based index in de teruggegeven "units" waar de sectie',
    'begint (meestal 0). Geef "section" ALLEEN mee als er echt een nieuwe sectie begint in deze',
    'passage.',
    '',
    'Geef UITSLUITEND een geldig JSON-object terug, zonder codeblok-fences en zonder tekst',
    'eromheen, in dit formaat:',
    '{ "units": string[], "section"?: { "title": string, "generated": boolean, "unit": number } }',
    '',
    text,
  ]
  if (next && next.trim() !== '') {
    lines.push(
      '',
      '=== VOLGENDE (alleen context) ===',
      "De tekst na '=== VOLGENDE (alleen context) ===' is puur context voor de overgang/grens —",
      'knip en label die NIET, neem er niets uit over.',
      next,
    )
  }
  return lines.join('\n')
}

// --- App -------------------------------------------------------------------------

const app = express()
app.use(express.json({ limit: '256kb' }))

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    features: { translate: hasGoogle(), tts: hasGoogle(), gemini: hasGemini() },
  })
})

// Cloud Translate (batch met per-tekst cache).
app.post('/api/translate', async (req, res) => {
  if (!hasGoogle()) return res.status(503).json({ error: 'Geen GOOGLE_CLOUD_KEY ingesteld.' })
  const texts = Array.isArray(req.body?.texts) ? req.body.texts.filter((t) => typeof t === 'string') : null
  if (!texts) return res.status(400).json({ error: 'Verwacht { texts: string[] }.' })

  try {
    const out = new Array(texts.length)
    const missIdx = []
    const missText = []
    for (let i = 0; i < texts.length; i++) {
      if (texts[i].trim() === '') {
        out[i] = texts[i]
        continue
      }
      const hit = await readCacheText('translate', `translate|es|nl|${texts[i]}`)
      if (hit != null) out[i] = hit
      else {
        missIdx.push(i)
        missText.push(texts[i])
      }
    }

    if (missText.length > 0) {
      const unique = [...new Set(missText)]
      const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(GOOGLE_KEY)}`
      const gres = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: unique, source: 'es', target: 'nl', format: 'text' }),
      })
      if (!gres.ok) {
        const detail = await gres.text().catch(() => '')
        return res.status(502).json({ error: `Translate ${gres.status}: ${detail.slice(0, 200)}` })
      }
      const json = await gres.json()
      const translations = json?.data?.translations ?? []
      const map = new Map()
      unique.forEach((src, i) => {
        const nl = translations[i]?.translatedText
        if (typeof nl === 'string') map.set(src, nl)
      })
      for (const [src, nl] of map) await writeCacheText('translate', `translate|es|nl|${src}`, nl)
      for (let k = 0; k < missIdx.length; k++) out[missIdx[k]] = map.get(missText[k]) ?? missText[k]
    }

    res.json({ translations: out })
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) })
  }
})

// Gemini: Spaans-tutor. Zonder history/question maar mét context -> initiële fragment-uitleg
// (gecached). Anders -> vrije chatvraag (multi-turn, met context als grounding indien aanwezig),
// ongecached.
app.post('/api/chat', async (req, res) => {
  if (!hasGemini()) return res.status(503).json({ error: 'Geen GEMINI_KEY ingesteld.' })
  const { history, question, context } = req.body ?? {}

  const ctx =
    context && typeof context === 'object' &&
    typeof context.fragment === 'string' && typeof context.sentence === 'string'
      ? { fragment: context.fragment, sentence: context.sentence }
      : null
  const hasHistory = Array.isArray(history) && history.length > 0
  const hasQuestion = typeof question === 'string' && question.trim() !== ''

  if (!ctx && !hasQuestion)
    return res.status(400).json({ error: 'Verwacht { context } voor een uitleg, of { question } voor een chatvraag.' })

  // Initiële uitleg: context aanwezig, nog geen gesprek.
  if (ctx && !hasHistory && !hasQuestion) {
    const key = `chat|${GEMINI_MODEL}|${CHAT_PROMPT_VERSION}|${ctx.sentence}|${ctx.fragment}`
    const hit = await readCacheText('chat', key)
    if (hit != null) return res.json({ text: hit })

    try {
      const text = await geminiGenerate(explainFragmentPrompt(ctx.fragment, ctx.sentence))
      await writeCacheText('chat', key, text)
      res.json({ text })
    } catch (err) {
      res.status(502).json({ error: String(err?.message || err) })
    }
    return
  }

  // Vrije chatvraag: heeft altijd een question nodig.
  if (!hasQuestion)
    return res.status(400).json({ error: 'Verwacht { question } voor een chatvraag.' })

  const framing = ctx ? chatContextPrompt(ctx.fragment, ctx.sentence) : chatSystemPrompt()
  const contents = [{ role: 'user', parts: [{ text: framing }] }]
  if (Array.isArray(history)) {
    for (const item of history) {
      if (!item || (item.role !== 'user' && item.role !== 'model') || typeof item.text !== 'string') continue
      contents.push({ role: item.role, parts: [{ text: String(item.text) }] })
    }
  }
  contents.push({ role: 'user', parts: [{ text: question }] })

  try {
    const text = await geminiChat(contents, 0.3, 4096)
    res.json({ text })
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) })
  }
})

// Gemini: zin vertalen mét context.
app.post('/api/ai-translate', async (req, res) => {
  if (!hasGemini()) return res.status(503).json({ error: 'Geen GEMINI_KEY ingesteld.' })
  const { prev = '', current, next = '' } = req.body ?? {}
  if (typeof current !== 'string' || current.trim() === '')
    return res.status(400).json({ error: 'Verwacht { current, prev?, next? }.' })

  const key = `aitranslate|${GEMINI_MODEL}|${prev}|${current}|${next}`
  const hit = await readCacheText('aitranslate', key)
  if (hit != null) return res.json({ text: hit })

  try {
    const raw = await geminiGenerate(aiTranslatePrompt(prev, current, next))
    const text = raw.replace(/^[\s"'«»]+|[\s"'«»]+$/g, '').trim()
    await writeCacheText('aitranslate', key, text)
    res.json({ text })
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) })
  }
})

// Gemini: oefenzin voor de oefenmodus (variërende persoon/tijd om uitgangen te trainen).
app.post('/api/practice-sentence', async (req, res) => {
  if (!hasGemini()) return res.status(503).json({ error: 'Geen GEMINI_KEY ingesteld.' })
  const { word, translation = '', seed = '' } = req.body ?? {}
  if (typeof word !== 'string' || word.trim() === '')
    return res.status(400).json({ error: 'Verwacht { word, translation?, seed? }.' })
  const seedKey = String(seed)

  const key = `practice|${GEMINI_MODEL}|${PRACTICE_PROMPT_VERSION}|${word}|${translation}|${seedKey}`
  const hit = await readCacheText('practice', key)
  if (hit != null) return res.json(JSON.parse(hit))

  try {
    // Iets hogere temperature (variatie in persoon/tijd) + ruim budget: thinking-tokens tellen mee.
    const raw = await geminiGenerate(practiceSentencePrompt(word, translation, seedKey), 0.8, 4096)
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch (parseErr) {
      console.error('[lal] /api/practice-sentence: ongeldige JSON van Gemini:', parseErr, '\nraw:', raw.slice(0, 500))
      return res.status(502).json({ error: 'Gemini gaf geen geldig JSON-object terug.' })
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.sentence !== 'string' ||
      typeof parsed.translation !== 'string' ||
      parsed.sentence.trim() === '' ||
      parsed.translation.trim() === ''
    ) {
      console.error('[lal] /api/practice-sentence: geen { sentence, translation } van Gemini:', raw.slice(0, 500))
      return res.status(502).json({ error: 'Gemini gaf geen { sentence, translation } terug.' })
    }
    const result = { sentence: parsed.sentence.trim(), translation: parsed.translation.trim() }
    await writeCacheText('practice', key, JSON.stringify(result))
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) })
  }
})

// Gemini: handmatig woord/frase toevoegen -> AI-vertaling + voorbeeldzin (met richting-detectie).
app.post('/api/add-word', async (req, res) => {
  if (!hasGemini()) return res.status(503).json({ error: 'Geen GEMINI_KEY ingesteld.' })
  const { text, direction = 'auto' } = req.body ?? {}
  if (typeof text !== 'string' || text.trim() === '')
    return res.status(400).json({ error: 'Verwacht { text: string, direction? }.' })
  const dir = direction === 'nl2es' || direction === 'es2nl' ? direction : 'auto'
  const trimmed = text.trim()
  const normText = trimmed.toLowerCase()

  const key = `addword|${GEMINI_MODEL}|${ADDWORD_PROMPT_VERSION}|${dir}|${normText}`
  const hit = await readCacheText('addword', key)
  if (hit != null) return res.json(JSON.parse(hit))

  try {
    // Ruim budget: thinking-tokens tellen mee.
    const raw = await geminiGenerate(addWordPrompt(trimmed, dir), 0.4, 4096)
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch (parseErr) {
      console.error('[lal] /api/add-word: ongeldige JSON van Gemini:', parseErr, '\nraw:', raw.slice(0, 500))
      return res.status(502).json({ error: 'Gemini gaf geen geldig JSON-object terug.' })
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.word !== 'string' ||
      typeof parsed.translation !== 'string' ||
      typeof parsed.context !== 'string' ||
      parsed.word.trim() === '' ||
      parsed.translation.trim() === '' ||
      parsed.context.trim() === '' ||
      (parsed.detected !== 'nl2es' && parsed.detected !== 'es2nl')
    ) {
      console.error('[lal] /api/add-word: geen { word, translation, context, detected } van Gemini:', raw.slice(0, 500))
      return res.status(502).json({ error: 'Gemini gaf geen { word, translation, context, detected } terug.' })
    }
    const result = {
      word: parsed.word.trim(),
      translation: parsed.translation.trim(),
      context: parsed.context.trim(),
      detected: parsed.detected,
    }
    await writeCacheText('addword', key, JSON.stringify(result))
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) })
  }
})

// Gemini: front-matter overslaan -> index van de eerste echte verhaalzin.
app.post('/api/book-start', async (req, res) => {
  if (!hasGemini()) return res.status(503).json({ error: 'Geen GEMINI_KEY ingesteld.' })
  const sentences = Array.isArray(req.body?.sentences)
    ? req.body.sentences.filter((s) => typeof s === 'string')
    : null
  if (!sentences || sentences.length === 0)
    return res.status(400).json({ error: 'Verwacht { sentences: string[] }.' })

  const window = sentences.slice(0, BOOK_START_WINDOW)
  const key = `bookstart|${GEMINI_MODEL}|${window.join('␞')}`
  const hit = await readCacheText('bookstart', key)
  if (hit != null) return res.json({ index: Number(hit) || 0 })

  try {
    const answer = await geminiGenerate(bookStartPrompt(window), 0)
    const m = answer.match(/\d+/)
    let idx = m ? Number(m[0]) : 0
    if (!Number.isFinite(idx) || idx < 0 || idx >= window.length) idx = 0
    await writeCacheText('bookstart', key, String(idx))
    res.json({ index: idx })
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) })
  }
})

// Gemini: front-matter overslaan (chunk-versie) -> index van de eerste echte verhaal-chunk.
app.post('/api/story-start', async (req, res) => {
  if (!hasGemini()) return res.status(503).json({ error: 'Geen GEMINI_KEY ingesteld.' })
  const chunks = Array.isArray(req.body?.chunks)
    ? req.body.chunks.filter((c) => typeof c === 'string')
    : null
  if (!chunks || chunks.length === 0)
    return res.status(400).json({ error: 'Verwacht { chunks: string[] }.' })

  const key = `storystart|${GEMINI_MODEL}|${STORY_START_PROMPT_VERSION}|${chunks.join('␞')}`
  const hit = await readCacheText('storystart', key)
  if (hit != null) return res.json({ index: Number(hit) || 0 })

  try {
    const answer = await geminiGenerate(storyStartPrompt(chunks), 0)
    const m = answer.match(/\d+/)
    let idx = m ? Number(m[0]) : NaN
    if (!Number.isFinite(idx)) {
      console.warn('[lal] /api/story-start: kon geen getal parsen uit antwoord:', answer.slice(0, 200))
      idx = 0
    }
    if (idx < 0 || idx >= chunks.length) idx = Math.min(Math.max(idx, 0), chunks.length - 1)
    await writeCacheText('storystart', key, String(idx))
    res.json({ index: idx })
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) })
  }
})

// Gemini: passage opschonen + opknippen in leer-eenheden.
app.post('/api/segment', async (req, res) => {
  if (!hasGemini()) return res.status(503).json({ error: 'Geen GEMINI_KEY ingesteld.' })
  const { text, next } = req.body ?? {}
  if (typeof text !== 'string' || text.trim() === '')
    return res.status(400).json({ error: 'Verwacht { text: string, next? }.' })
  const nextText = typeof next === 'string' ? next : ''

  const key = `segment|${GEMINI_MODEL}|${SEGMENT_PROMPT_VERSION}|${text}␞${nextText}`
  const hit = await readCacheText('segment', key)
  if (hit != null) return res.json(JSON.parse(hit))

  try {
    // Ruim budget: thinking-tokens tellen mee en een hele chunk levert meerdere eenheden op —
    // met 2048 kapt het JSON-antwoord af (unterminated string -> parse-fout).
    const raw = await geminiGenerate(segmentPrompt(text, nextText), 0.3, 8192)
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch (parseErr) {
      console.error('[lal] /api/segment: ongeldige JSON van Gemini:', parseErr, '\nraw:', raw.slice(0, 500))
      return res.status(502).json({ error: 'Gemini gaf geen geldig JSON-object terug.' })
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.units) || !parsed.units.every((u) => typeof u === 'string')) {
      console.error('[lal] /api/segment: geen units-array van strings:', raw.slice(0, 500))
      return res.status(502).json({ error: 'Gemini gaf geen units-array van strings terug.' })
    }
    const units = parsed.units.map((u) => u.trim()).filter((u) => u !== '')

    let section
    const s = parsed.section
    if (
      s &&
      typeof s === 'object' &&
      typeof s.title === 'string' &&
      s.title.trim() !== '' &&
      typeof s.generated === 'boolean' &&
      Number.isInteger(s.unit) &&
      s.unit >= 0
    ) {
      section = { title: s.title.trim(), generated: s.generated, unit: s.unit }
    }

    const result = section ? { units, section } : { units }
    await writeCacheText('segment', key, JSON.stringify(result))
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) })
  }
})

// Cloud TTS: mp3-bytes met cache.
app.post('/api/tts', async (req, res) => {
  if (!hasGoogle()) return res.status(503).json({ error: 'Geen GOOGLE_CLOUD_KEY ingesteld.' })
  const { text, voice, lang, rate } = req.body ?? {}
  if (typeof text !== 'string' || typeof voice !== 'string' || typeof lang !== 'string')
    return res.status(400).json({ error: 'Verwacht { text, voice, lang, rate }.' })
  const speakingRate = Number(rate) || 1

  const file = await cachePath('tts', `${sha256(`tts|${voice}|${speakingRate}|${text}`)}.mp3`)
  try {
    const cached = await readFile(file)
    res.type('audio/mpeg').send(cached)
    return
  } catch {
    // miss -> synthetiseren
  }

  try {
    const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(GOOGLE_KEY)}`
    const gres = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: lang, name: voice },
        audioConfig: { audioEncoding: 'MP3', speakingRate },
      }),
    })
    if (!gres.ok) {
      const detail = await gres.text().catch(() => '')
      return res.status(502).json({ error: `TTS ${gres.status}: ${detail.slice(0, 200)}` })
    }
    const json = await gres.json()
    if (!json?.audioContent) return res.status(502).json({ error: 'TTS gaf geen audio terug.' })
    const bytes = Buffer.from(json.audioContent, 'base64')
    await writeFile(file, bytes).catch(() => {})
    res.type('audio/mpeg').send(bytes)
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) })
  }
})

// Cloud TTS: Spaanse stemmen (gecached als voices.json, verversbaar door bestand te wissen).
app.get('/api/voices', async (_req, res) => {
  if (!hasGoogle()) return res.status(503).json({ error: 'Geen GOOGLE_CLOUD_KEY ingesteld.' })
  const hit = await readCacheText('.', 'voices')
  if (hit != null) return res.type('application/json').send(hit)

  try {
    const url = `https://texttospeech.googleapis.com/v1/voices?languageCode=es&key=${encodeURIComponent(GOOGLE_KEY)}`
    const gres = await fetch(url)
    if (!gres.ok) {
      const detail = await gres.text().catch(() => '')
      return res.status(502).json({ error: `Voices ${gres.status}: ${detail.slice(0, 160)}` })
    }
    const json = await gres.json()
    const voices = (json?.voices ?? [])
      .map((v) => ({ name: v.name, lang: v.languageCodes?.[0] ?? '', gender: v.ssmlGender }))
      .filter((v) => v.lang.toLowerCase().startsWith('es'))
      .sort((a, b) => a.name.localeCompare(b.name))
    const payload = JSON.stringify({ voices })
    await writeCacheText('.', 'voices', payload)
    res.type('application/json').send(payload)
  } catch (err) {
    res.status(502).json({ error: String(err?.message || err) })
  }
})

// Woordenlijst: één gedeelde lijst (per-profiel is een latere uitbreiding).
app.get('/api/vocab', async (_req, res) => {
  res.json({ words: await readVocab() })
})

app.post('/api/vocab', async (req, res) => {
  const { key, word, translation = '', context = '' } = req.body ?? {}
  if (typeof key !== 'string' || key.trim() === '' || typeof word !== 'string')
    return res.status(400).json({ error: 'Verwacht { key, word, translation?, context? }.' })
  const words = await readVocab()
  if (!words.some((w) => w.key === key)) {
    words.push({ key, word, translation, context, addedAt: new Date().toISOString() })
    await writeVocab(words)
  }
  res.json({ words })
})

app.post('/api/vocab/update', async (req, res) => {
  const { key, translation, word, newKey } = req.body ?? {}
  if (typeof key !== 'string' || key.trim() === '')
    return res.status(400).json({ error: 'Verwacht { key, translation?, word?, newKey? }.' })
  const words = await readVocab()
  const item = words.find((w) => w.key === key)
  if (item) {
    if (typeof translation === 'string') item.translation = translation
    if (typeof word === 'string' && word.trim() !== '') item.word = word
    if (typeof newKey === 'string' && newKey.trim() !== '' && newKey !== key) {
      item.key = newKey
      for (let i = words.length - 1; i >= 0; i--) {
        if (words[i] !== item && words[i].key === newKey) words.splice(i, 1)
      }
    }
    await writeVocab(words)
  }
  res.json({ words })
})

app.post('/api/vocab/delete', async (req, res) => {
  const { key } = req.body ?? {}
  if (typeof key !== 'string') return res.status(400).json({ error: 'Verwacht { key }.' })
  const words = (await readVocab()).filter((w) => w.key !== key)
  await writeVocab(words)
  res.json({ words })
})

// Statische Vite-build serveren (prod). In dev bestaat dist/ niet -> Vite serveert zelf.
const distDir = join(__dirname, '..', 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(join(distDir, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`[lal] backend op :${PORT}  cache=${CACHE_DIR}  translate/tts=${hasGoogle()} gemini=${hasGemini()}`)
})
