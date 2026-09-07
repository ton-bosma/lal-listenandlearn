import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { demoSentences } from './data/demoText'
import { cleanWord, normalizeWord, tokenize } from './lib/words'
import {
  getChosenVoiceId,
  getSpanishVoices,
  setChosenVoiceId,
  speak,
  stopSpeaking,
  subscribeTtsError,
  subscribeVoices,
  ttsSupported,
} from './lib/tts'
import { type CloudVoice, listSpanishCloudVoices } from './lib/cloudtts'
import {
  type AiTranslateMode,
  type Book,
  type Chapter,
  type SegmentMode,
  getAiTranslateMode,
  getSegmentMode,
  loadAudioMuted,
  loadBook,
  loadMicMuted,
  saveAudioMuted,
  saveBook,
  saveMicMuted,
  setAiTranslateMode,
  setSegmentMode,
} from './lib/storage'
import { aiTranslateSentence } from './lib/aitranslate'
import { extractPdfBook } from './lib/pdf'
import { extractEpubBook } from './lib/epub'
import { buildSentences } from './lib/sentences'
import { buildChunks } from './lib/chunk'
import { useReader } from './lib/reader'
import { detectBookStart } from './lib/frontmatter'
import { translateSentence, translateWords } from './lib/translate'
import { type ChatMsg, explainFragment } from './lib/explain'
import { mdToHtml } from './lib/markdown'
import { type Features, NO_FEATURES, fetchFeatures } from './lib/health'
import { type VocabWord, addVocab, listVocab, removeVocab, updateVocab } from './lib/vocab'
import { type WordSuggestion, fetchWordSuggestion } from './lib/addword'
import { MAX_BOX, loadSrs } from './lib/practice'
import PracticePanel from './PracticePanel'
import ChatPanel from './ChatPanel'

// De drie zichtbaarheidsniveaus van de progressieve hulp (zie docs/SPEC.md):
//  'none'    -> Luister: alleen audio, Spaanse tekst verborgen
//  'spanish' -> Ondertiteld: Spaanse zin zichtbaar met woord-hovers (live vertaald)
//  'dutch'   -> NL-zin: volledige vertaling eronder, Spaans blijft staan
type Reveal = 'none' | 'spanish' | 'dutch'

// De schermen van het full-screen schermmodel:
//  'read'       -> de lezer
//  'menu'       -> keuzescherm (onderhoud / AI-voorbeeldzin / woord-flashcard)
//  'vocab'      -> woordenlijst onderhouden
//  'flashcard'   -> oefening woord-flashcard (Spaans → Nederlands)
//  'flashcardNl' -> oefening woord-flashcard (Nederlands → Spaans)
//  'aisentence'  -> oefening AI-voorbeeldzin
//  'chat'        -> full-screen chat (vrije chat vanuit het menu, of vervolg vanuit de uitleg)
// Terug = één stap omhoog: oefening/onderhoud → menu → lezen; chat → waar je vandaan kwam.
type Screen = 'read' | 'menu' | 'vocab' | 'flashcard' | 'flashcardNl' | 'aisentence' | 'chat'

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Onbekende fout.'
}

/** Unieke, genormaliseerde woorden van een zin (voor de gloss-lookup). */
function wordKeys(sentence: string): string[] {
  return [...new Set(tokenize(sentence).filter((t) => t.isWord).map((t) => t.key))]
}

/** Normaliseert een geselecteerd stukje tot een woordenlijst-key (zelfde regels als een woord). */
function phraseKey(s: string): string {
  return normalizeWord(s)
}

// Kort de Cloud-stemmenlijst in tot een handvol zinvolle Latijns-Amerikaanse stemmen
// (i.p.v. ~90): es-US/es-MX/es-419, alle Neural2 + een paar Chirp3-HD.
const LATAM_LANGS = ['es-us', 'es-mx', 'es-419']
function curateCloudVoices(voices: CloudVoice[]): CloudVoice[] {
  const latam = voices.filter((v) => LATAM_LANGS.includes(v.lang.toLowerCase()))
  const neural = latam.filter((v) => /Neural2/i.test(v.name))
  const chirp = latam.filter((v) => /Chirp3-HD/i.test(v.name)).slice(0, 6)
  return [...neural, ...chirp]
}

export default function App() {
  const [book, setBook] = useState<Book | null>(() => loadBook())
  // Leesbron (beide knip-modi achter één interface): levert de zichtbare zinnen, de positie,
  // navigatie en hoofdstukken. In AI-modus laadt hij voortschrijdend per chunk.
  const reader = useReader(book, setBook, demoSentences)
  const { sentence, pos, chapters, currentChapter } = reader

  // Geluid ontvangen (voorlezen/TTS) uit? Gate't het auto-voorlezen én handmatig "Luister".
  const [audioMuted, setAudioMuted] = useState(() => loadAudioMuted())
  // Geluid produceren (microfoon/spraak-invoer) uit? Nog geen consument; bewaard voor
  // komende spraak-oefeningen.
  const [micMuted, setMicMuted] = useState(() => loadMicMuted())

  // Stille leesmodus: zonder geluid is de audio-only startstap ('none') een doodlopend pad,
  // dus begint elke zin dan meteen zichtbaar ('spanish').
  const freshReveal = (): Reveal => (audioMuted ? 'spanish' : 'none')

  const [reveal, setReveal] = useState<Reveal>(() => (loadAudioMuted() ? 'spanish' : 'none'))
  const [rate, setRate] = useState(0.9)
  const firstMount = useRef(true)

  // Knip-modus voor nieuw te importeren boeken (deterministisch of AI-knipper).
  const [segMode, setSegMode] = useState<SegmentMode>(() => getSegmentMode())

  const bookName = book?.name ?? 'Demotekst'

  // Boek laden.
  const fileInput = useRef<HTMLInputElement>(null)
  const [loadingBook, setLoadingBook] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)

  // Welke features de backend aanbiedt (welke keys server-side gezet zijn).
  const [features, setFeatures] = useState<Features>(NO_FEATURES)

  // Woordenlijst (gemarkeerde onbekende woorden), server-side bewaard.
  const [vocab, setVocab] = useState<VocabWord[]>([])
  // Actief scherm (full-screen schermmodel). 'read' = de lezer; de rest zijn overlay-schermen
  // bovenop de (behouden) leesstaat. Terug = één stap omhoog (oefening/onderhoud → menu → lezen).
  const [screen, setScreen] = useState<Screen>('read')
  const markedKeys = new Set(vocab.map((w) => w.key))
  // Inline bewerken van een vertaling in het paneel.
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  // Inline bewerken van het woord zelf.
  const [editWordKey, setEditWordKey] = useState<string | null>(null)
  const [editWordVal, setEditWordVal] = useState('')

  // Onderhoudscherm: live filter over de lijst (substring op woord/vertaling/context).
  const [vocabFilter, setVocabFilter] = useState('')
  // SRS-stand voor de voortgang-indicator: één keer inlezen bij het (her)openen van een scherm
  // (per apparaat, localStorage). Verandert tijdens onderhoud niet, dus dit volstaat.
  const srs = useMemo(() => loadSrs(), [screen])

  // AI-toevoegen: invoerveld, het (bewerkbare) voorstel, laadstatus en meldingen.
  const [addText, setAddText] = useState('')
  const [addSuggestion, setAddSuggestion] = useState<WordSuggestion | null>(null)
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [addDupNotice, setAddDupNotice] = useState<string | null>(null)

  // Stemkeuze: browserstemmen (async) + optionele Cloud-stemmen.
  const [voices, setVoices] = useState(() => getSpanishVoices())
  const [cloudVoices, setCloudVoices] = useState<CloudVoice[]>([])
  const [voiceId, setVoiceId] = useState(() => getChosenVoiceId())
  const [ttsError, setTtsError] = useState<string | null>(null)

  // Instellingen-paneel (stem/snelheid/boek/hoofdstuk) inklapbaar houden.
  const [settingsOpen, setSettingsOpen] = useState(false)

  const shownCloudVoices = curateCloudVoices(cloudVoices)

  useEffect(() => subscribeVoices(() => setVoices(getSpanishVoices())), [])
  useEffect(() => subscribeTtsError((msg) => setTtsError(msg)), [])
  useEffect(() => {
    fetchFeatures().then(setFeatures)
    listVocab()
      .then(setVocab)
      .catch(() => {}) // stil: lijst is optioneel, verschijnt zodra de backend reageert
  }, [])
  useEffect(() => {
    if (!features.tts) return
    let cancelled = false
    listSpanishCloudVoices()
      .then((v) => !cancelled && setCloudVoices(v))
      .catch(() => {}) // stil: Cloud-stemmen zijn optioneel (API mogelijk niet aan)
    return () => {
      cancelled = true
    }
  }, [features.tts])

  function onVoiceChange(id: string) {
    setVoiceId(id)
    setChosenVoiceId(id || null)
    setTtsError(null)
  }

  // Live-vertaalresultaten voor de huidige zin (null = nog niet opgehaald).
  const [nl, setNl] = useState<string | null>(null)
  const [glosses, setGlosses] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState<string | null>(null)

  // AI-vertaling (Gemini-met-context): modus + per-zin resultaat/status.
  const [aiMode, setAiMode] = useState<AiTranslateMode>(() => getAiTranslateMode())
  const [aiNl, setAiNl] = useState<string | null>(null)
  const [aiOptionOpen, setAiOptionOpen] = useState(false)
  const [aiTranslating, setAiTranslating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // Selecteer + uitleg (Fase 3): de initiële uitleg toont inline; vervolgvragen verhuizen naar het
  // chat-scherm. `explainChat` bevat de (initiële) uitleg-beurt, `explainCtx` waar die over gaat
  // (fragment+zin). Reset bij zin-wissel.
  const [selection, setSelection] = useState('')
  const [explainChat, setExplainChat] = useState<ChatMsg[]>([])
  const [explainCtx, setExplainCtx] = useState<{ fragment: string; sentence: string } | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)

  // Full-screen chat: de seed-history + optionele context waarmee het scherm start, de kop-titel,
  // en waar "← Terug" naartoe gaat. Vers per keer (geen persistentie).
  const [chatSeed, setChatSeed] = useState<ChatMsg[]>([])
  const [chatContext, setChatContext] = useState<{ fragment: string; sentence: string } | null>(null)
  const [chatTitle, setChatTitle] = useState<ReactNode>('')
  const [chatReturnTo, setChatReturnTo] = useState<Screen>('menu')

  // Huidige positie bij de hand voor async callbacks (voorkomt dat een laat resultaat op de
  // verkeerde zin belandt). `pos` verandert bij elke echte positiewissel, ook over chunk-/
  // hoofdstukgrenzen (waar de platte index gelijk kan blijven).
  const posRef = useRef(pos)
  posRef.current = pos

  // Nieuwe zin -> alle per-zin resultaten resetten.
  useEffect(() => {
    setNl(null)
    setGlosses(null)
    setError(null)
    setSelection('')
    setExplainChat([])
    setExplainCtx(null)
    setExplainError(null)
    setAiNl(null)
    setAiOptionOpen(false)
    setAiTranslating(false)
    setAiError(null)
  }, [pos])

  // Auto-voorlezen bij aankomen op een zin ("Luister"), niet bij allereerste render.
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false
      return
    }
    if (audioMuted) return // geluid uit: geen automatische spraak
    speak(sentence, rate)
    // rate/audioMuted bewust niet in deps: snelheid of geluid wijzigen leest niet vanzelf
    // opnieuw voor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos])

  // Voorlezen (geluid ontvangen) aan/uit. Bij uitzetten: lopende spraak stoppen en, als we nog
  // op de audio-only startstap staan, meteen door naar de zichtbare zin (stille leesmodus).
  function setAudioOn(on: boolean) {
    const nextMuted = !on
    setAudioMuted(nextMuted)
    saveAudioMuted(nextMuted)
    if (nextMuted) {
      stopSpeaking()
      setReveal((r) => (r === 'none' ? 'spanish' : r))
    }
  }

  // Microfoon (geluid produceren) aan/uit. Nog geen consument; alleen bewaren.
  function setMicOn(on: boolean) {
    setMicMuted(!on)
    saveMicMuted(!on)
  }

  // Handmatig voorlezen ("Luister"). Bij geluid uit is de knop verborgen; guard voor de zekerheid.
  function handleListen() {
    if (audioMuted) return
    speak(sentence, rate)
  }

  useEffect(() => () => stopSpeaking(), [])

  // Glossen ophalen zodra de Spaanse tekst zichtbaar wordt.
  useEffect(() => {
    if (reveal === 'none' || glosses !== null) return
    let cancelled = false
    translateWords(wordKeys(sentence))
      .then((map) => !cancelled && setGlosses(map))
      .catch((err) => !cancelled && setError(errMessage(err)))
    return () => {
      cancelled = true
    }
  }, [reveal, glosses, sentence])

  // NL-zin via Google ophalen zodra die stap wordt ingeroepen. In modus 'first' slaan we
  // Google over (dan komt de NL-zin meteen van Gemini, zie het auto-effect hieronder).
  useEffect(() => {
    if (reveal !== 'dutch' || aiMode === 'first' || nl !== null) return
    let cancelled = false
    translateSentence(sentence)
      .then((text) => !cancelled && setNl(text))
      .catch((err) => !cancelled && setError(errMessage(err)))
    return () => {
      cancelled = true
    }
  }, [reveal, aiMode, nl, sentence])

  // Modus 'first': direct de AI-vertaling ophalen (één poging; bij falen tonen we ⚠️).
  useEffect(() => {
    if (reveal !== 'dutch' || aiMode !== 'first' || aiNl !== null || aiTranslating || aiError) return
    runAiTranslate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, aiMode, aiNl, aiTranslating, aiError, sentence])

  function onChangeSegMode(mode: SegmentMode) {
    setSegMode(mode)
    setSegmentMode(mode)
  }

  function onChangeAiMode(mode: AiTranslateMode) {
    setAiMode(mode)
    setAiTranslateMode(mode)
    // Modus wisselen op de huidige zin: AI-resultaat/keuze resetten zodat de nieuwe modus
    // meteen zichtbaar is (bijv. 'first' vertaalt de zin die je nu ziet alsnog via AI).
    setAiNl(null)
    setAiOptionOpen(false)
    setAiError(null)
  }

  // De huidige zin via Gemini vertalen, met de buurzinnen als context.
  function runAiTranslate() {
    if (aiTranslating || aiNl !== null) return
    const at = pos
    setAiError(null)
    setAiTranslating(true)
    aiTranslateSentence(reader.prevSentence, sentence, reader.nextSentence)
      .then((text) => posRef.current === at && setAiNl(text))
      .catch((err) => posRef.current === at && setAiError(errMessage(err)))
      .finally(() => posRef.current === at && setAiTranslating(false))
  }

  // Navigatie loopt via de reader; hier alleen de gedeelde UI-bijwerking (spraak stoppen, zin
  // weer kaal). De reader leest de nieuwe zin vanzelf voor bij de positiewissel (auto-speak).
  function navPrev() {
    stopSpeaking()
    setReveal(freshReveal())
    reader.goPrev()
  }
  function navNext() {
    stopSpeaking()
    setReveal(freshReveal())
    reader.goNext()
  }
  function navChapter(i: number) {
    stopSpeaking()
    setReveal(freshReveal())
    reader.jumpToChapter(i)
  }

  // Een boek kiezen -> tekst extraheren -> knippen -> als huidig boek zetten. De knipper hangt
  // af van de setting: deterministisch (in één keer) of de AI-knipper (voortschrijdend per chunk).
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // zelfde bestand later opnieuw kunnen kiezen
    if (!file) return
    setLoadingBook(true)
    setBookError(null)
    try {
      const isEpub = /\.epub$/i.test(file.name)
      const { text, chapters: rawChapters } = isEpub
        ? await extractEpubBook(file)
        : await extractPdfBook(file) // fallback voor .pdf
      const name = file.name.replace(/\.(pdf|epub)$/i, '')

      if (segMode === 'ai') {
        // Alleen deterministisch in chunks hakken; opschonen + knippen + front-matter overslaan
        // doet de AI-knipper later per chunk (voortschrijdend, gecachet).
        const { rawChunks, chapters, rawLength } = buildChunks(text, rawChapters)
        if (rawChunks.length === 0)
          throw new Error('Geen tekst gevonden — is dit een scan (zonder tekstlaag)?')
        const newBook: Book = {
          name,
          mode: 'ai',
          rawChunks,
          units: rawChunks.map(() => null),
          rawLength,
          chapters,
        }
        saveBook(newBook)
        stopSpeaking()
        setBook(newBook) // reader (her)initialiseert + laadt de eerste chunk
        setReveal(freshReveal())
        return
      }

      // Deterministische knipper (klassiek).
      const { sentences: list, pageStartSentence } = buildSentences(text)
      if (list.length === 0) throw new Error('Geen tekst gevonden — is dit een scan (zonder tekstlaag)?')

      // Front-matter (flaptekst/colofon/opdracht) éénmalig wegknippen; hoofdstuk-starts
      // schuiven mee en hoofdstukken die vóór het verhaal liggen (bijv. de colofon) vervallen.
      const bookStart = await detectBookStart(list)
      const sentences = bookStart > 0 ? list.slice(bookStart) : list

      const chapters: Chapter[] = rawChapters
        .map((c) => ({ title: c.title, start: (pageStartSentence[c.page] ?? 0) - bookStart }))
        .filter((c) => (c.start ?? 0) >= 0 && (c.start ?? 0) < sentences.length)
        .sort((a, b) => (a.start ?? 0) - (b.start ?? 0))

      // Kop plakt in de PDF-tekst vaak vóór de eerste zin ("El último mono Me llamo…").
      // De titel kennen we uit de outline, dus we strippen hem van de start-zin af.
      for (const c of chapters) {
        const at = c.start ?? 0
        const s = sentences[at]
        const prefix = c.title + ' '
        if (s.startsWith(prefix) && s.length > prefix.length) {
          sentences[at] = s.slice(prefix.length).trimStart()
        }
      }

      const newBook: Book = { name, mode: 'deterministic', sentences, chapters }
      saveBook(newBook)
      stopSpeaking()
      setBook(newBook)
      setReveal(freshReveal())
    } catch (err) {
      setBookError(errMessage(err))
    } finally {
      setLoadingBook(false)
    }
  }

  // Muisselectie binnen de Spaanse zin opvangen -> knop "Leg uit".
  function handleSelection() {
    const text = window.getSelection()?.toString().trim() ?? ''
    setSelection(text)
    if (text === '') return
    // Nieuwe selectie -> oude uitleg opruimen.
    setExplainChat([])
    setExplainCtx(null)
    setExplainError(null)
  }

  function runExplain() {
    if (selection === '') return
    const fragment = selection
    const ctxSentence = sentence
    setExplaining(true)
    setExplainChat([])
    setExplainCtx(null)
    setExplainError(null)
    explainFragment(fragment, ctxSentence)
      .then((text) => {
        setExplainCtx({ fragment, sentence: ctxSentence })
        setExplainChat([{ role: 'model', text }])
      })
      .catch((err) => setExplainError(errMessage(err)))
      .finally(() => setExplaining(false))
  }

  // Vanuit de inline uitleg doorgaan in het full-screen chat-scherm: de uitleg-thread + fragment-
  // context als seed meegeven, en terugkeren naar de lezer.
  function continueInChat() {
    if (!explainCtx) return
    setChatSeed(explainChat)
    setChatContext(explainCtx)
    setChatTitle(`Uitleg: "${explainCtx.fragment}"`)
    setChatReturnTo('read')
    setScreen('chat')
  }

  // Vrije chat vanuit het keuzescherm: verse thread, geen fragment-context.
  function openFreeChat() {
    setChatSeed([])
    setChatContext(null)
    setChatTitle(
      <>
        <span className="material-icons">chat</span> Chat — Spaans leren
      </>,
    )
    setChatReturnTo('menu')
    setScreen('chat')
  }

  // Klik op een woord = markeren/ontmarkeren (alleen bij een kále klik, niet bij een selectie).
  // context/known optioneel: de reader levert ze via de defaults (huidige zin + reeds opgehaalde
  // glosses); de oefenkaart geeft zijn eigen AI-zin + gloss mee.
  function toggleMark(key: string, raw: string, context?: string, known?: string) {
    if ((window.getSelection()?.toString().trim() ?? '') !== '') return // selectie = "Leg uit"
    if (markedKeys.has(key)) {
      setVocab((prev) => prev.filter((w) => w.key !== key)) // optimistisch
      removeVocab(key).then(setVocab).catch(() => {})
      return
    }
    const ctx = context ?? sentence
    // Vertaling uit de meegegeven/reeds opgehaalde glossen; anders even los ophalen.
    const knownTr = known ?? glosses?.[key]
    const word = cleanWord(raw) // opgeschoonde weergave (lowercase, leestekens weg, afkortingen heel)
    const add = (translation: string) => {
      setVocab((prev) => [...prev, { key, word, translation, context: ctx }]) // optimistisch
      addVocab({ key, word, translation, context: ctx }).then(setVocab).catch(() => {})
    }
    if (typeof knownTr === 'string' && knownTr !== '') add(knownTr)
    else translateWords([key]).then((m) => add(m[key] ?? '')).catch(() => add(''))
  }

  // Selectie (bijv. "por eso") als één regel in de woordenlijst bewaren, mét vertaling.
  function saveSelection() {
    const phrase = selection.trim()
    const key = phraseKey(phrase)
    if (key === '' || markedKeys.has(key)) return
    const word = cleanWord(phrase) // opgeschoonde weergave
    const commit = (translation: string) => {
      setVocab((prev) => (prev.some((w) => w.key === key) ? prev : [...prev, { key, word, translation, context: sentence }]))
      addVocab({ key, word, translation, context: sentence }).then(setVocab).catch(() => {})
    }
    translateSentence(phrase).then(commit).catch(() => commit(''))
  }

  // Vertaling in de woordenlijst inline aanpassen.
  function commitEdit(key: string) {
    const val = editVal.trim()
    setEditKey(null)
    setVocab((prev) => prev.map((w) => (w.key === key ? { ...w, translation: val } : w))) // optimistisch
    updateVocab(key, { translation: val }).then(setVocab).catch(() => {})
  }

  // Het woord zelf inline aanpassen. De sleutel (identiteit + oplichten) wordt uit het nieuwe
  // woord herberekend; hoofdletters/punten/apostrofs worden daarbij genegeerd, dus alleen een
  // echte letter-wijziging verplaatst het oplichten. De server hernoemt + dedupliceert.
  function commitWordEdit(key: string) {
    const word = editWordVal.trim()
    setEditWordKey(null)
    if (word === '') return
    const newKey = normalizeWord(word)
    setVocab((prev) => {
      const withoutCollision = newKey !== key ? prev.filter((w) => w.key !== newKey) : prev
      return withoutCollision.map((w) => (w.key === key ? { ...w, word, key: newKey } : w))
    })
    updateVocab(key, { word, newKey: newKey !== key ? newKey : undefined }).then(setVocab).catch(() => {})
  }

  // AI-toevoegen: een voorstel ophalen voor de ingetypte tekst. `direction` = 'auto' bij "Vraag
  // AI"; bij "Omdraaien" forceren we de tegenovergestelde richting (zelfde brontekst).
  function requestSuggestion(direction: 'auto' | 'nl2es' | 'es2nl') {
    const text = addText.trim()
    if (text === '' || addLoading) return
    setAddLoading(true)
    setAddError(null)
    setAddDupNotice(null)
    fetchWordSuggestion(text, direction)
      .then(setAddSuggestion)
      .catch((err) => setAddError(errMessage(err)))
      .finally(() => setAddLoading(false))
  }

  // Omdraaien: opnieuw ophalen met de tegenovergestelde richting van de laatste detectie, zodat
  // je een verkeerde auto-detectie (bijv. NL-woord voor Spaans aangezien) corrigeert.
  function flipSuggestion() {
    if (!addSuggestion || addLoading) return
    requestSuggestion(addSuggestion.detected === 'nl2es' ? 'es2nl' : 'nl2es')
  }

  // Het (bewerkte) voorstel toevoegen aan de lijst — zelfde patroon als saveSelection/toggleMark.
  function addSuggestionToVocab() {
    if (!addSuggestion) return
    const key = phraseKey(addSuggestion.word)
    if (key === '') return
    if (markedKeys.has(key)) {
      setAddDupNotice('Dit woord staat al in de lijst.')
      return
    }
    const word = cleanWord(addSuggestion.word)
    const translation = addSuggestion.translation.trim()
    const context = addSuggestion.context.trim()
    setVocab((prev) => (prev.some((w) => w.key === key) ? prev : [...prev, { key, word, translation, context }])) // optimistisch
    addVocab({ key, word, translation, context }).then(setVocab).catch(() => {})
    setAddText('')
    setAddSuggestion(null)
    setAddError(null)
    setAddDupNotice(null)
  }

  // Voorstel wissen (annuleren), het invoerveld laten staan.
  function cancelSuggestion() {
    setAddSuggestion(null)
    setAddError(null)
    setAddDupNotice(null)
  }

  // Gefilterde lijst voor het onderhoudscherm (substring, hoofdletterongevoelig).
  const vocabQuery = vocabFilter.trim().toLowerCase()
  const filteredVocab =
    vocabQuery === ''
      ? vocab
      : vocab.filter((w) =>
          `${w.word} ${w.translation} ${w.context}`.toLowerCase().includes(vocabQuery),
        )

  return (
    <div className="app">
      <header className="topbar">
        <h1>Spaans leren per zin</h1>
        <div className="topbar-right">
          <span className="counter">
            {reader.progress.approx
              ? `Zin ~${reader.progress.current} / ~${reader.progress.total}`
              : `Zin ${reader.progress.current} / ${reader.progress.total}`}
            {reader.loading && (
              <>
                {' '}
                <span className="material-icons">hourglass_empty</span>
              </>
            )}
          </span>
          <button
            className="icon-btn vocab-btn"
            onClick={() => setScreen('menu')}
            aria-label="Oefenen en woordenlijst"
            aria-pressed={screen !== 'read'}
            title="Oefenen & woordenlijst"
          >
            <span className="material-icons">track_changes</span>
            {vocab.length > 0 && <span className="vocab-count">{vocab.length}</span>}
          </button>
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label="Instellingen en boek"
            title="Instellingen en boek"
          >
            <span className="material-icons">settings</span>
          </button>
        </div>
      </header>

      {screen === 'menu' && (
        <div className="screen" aria-label="Oefenen">
          <div className="screen-inner">
            <div className="screen-head">
              <button className="btn practice-back" onClick={() => setScreen('read')}>
                <span className="material-icons">arrow_back</span> Terug naar lezen
              </button>
              <h2 className="screen-title">Oefenen</h2>
            </div>
            <div className="practice-menu">
              <button
                className="btn practice-choice"
                onClick={openFreeChat}
                disabled={!features.gemini}
                title={!features.gemini ? 'Vereist een Gemini-key op de server' : undefined}
              >
                <span className="practice-choice-title">
                  <span className="material-icons">chat</span> Chat
                </span>
                <span className="practice-choice-desc">
                  Stel vrij vragen over Spaans aan de AI-tutor.
                  {!features.gemini && ' (niet beschikbaar — geen Gemini-key)'}
                </span>
              </button>
              <button
                className="btn practice-choice"
                onClick={() => setScreen('vocab')}
              >
                <span className="practice-choice-title">
                  <span className="material-icons">menu_book</span> Woordenlijst onderhouden ({vocab.length})
                </span>
                <span className="practice-choice-desc">
                  Bekijk, bewerk en verwijder je gemarkeerde woorden.
                </span>
              </button>
              <button
                className="btn practice-choice"
                onClick={() => setScreen('aisentence')}
                disabled={vocab.length === 0 || !features.gemini}
                title={
                  vocab.length === 0
                    ? 'Nog geen woorden om te oefenen'
                    : !features.gemini
                      ? 'Vereist een Gemini-key op de server'
                      : undefined
                }
              >
                <span className="practice-choice-title">
                  <span className="material-icons">auto_awesome</span> AI-voorbeeldzin
                </span>
                <span className="practice-choice-desc">
                  Een verse Spaanse zin met het woord → vertaal naar het Nederlands.
                  {vocab.length === 0 && ' (nog geen woorden)'}
                  {vocab.length > 0 && !features.gemini && ' (niet beschikbaar — geen Gemini-key)'}
                </span>
              </button>
              <button
                className="btn practice-choice"
                onClick={() => setScreen('flashcard')}
                disabled={vocab.length === 0}
                title={vocab.length === 0 ? 'Nog geen woorden om te oefenen' : undefined}
              >
                <span className="practice-choice-title">
                  <span className="material-icons">style</span> Woord-flashcard — Spaans → Nederlands
                </span>
                <span className="practice-choice-desc">
                  Spaans woord → betekenis + de zin waarin je 'm zag.
                  {vocab.length === 0 && ' (nog geen woorden)'}
                </span>
              </button>
              <button
                className="btn practice-choice"
                onClick={() => setScreen('flashcardNl')}
                disabled={vocab.length === 0}
                title={vocab.length === 0 ? 'Nog geen woorden om te oefenen' : undefined}
              >
                <span className="practice-choice-title">
                  <span className="material-icons">style</span> Woord-flashcard — Nederlands → Spaans
                </span>
                <span className="practice-choice-desc">
                  Nederlandse betekenis → het Spaanse woord + de zin waarin je 'm zag.
                  {vocab.length === 0 && ' (nog geen woorden)'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {screen === 'vocab' && (
        <div className="screen" aria-label="Woordenlijst">
          <div className="screen-inner">
            <div className="screen-head">
              <button className="btn practice-back" onClick={() => setScreen('menu')}>
                <span className="material-icons">arrow_back</span> Terug
              </button>
              <h2 className="screen-title">Woordenlijst ({vocab.length})</h2>
            </div>

            {/* AI-toevoegen: typ een woord (NL of ES) en laat de AI vertaling + voorbeeldzin maken. */}
            {features.gemini ? (
              <div className="vocab-add">
                <div className="vocab-add-row">
                  <input
                    className="vocab-add-input"
                    placeholder="Typ een woord (NL of Spaans)…"
                    value={addText}
                    onChange={(e) => setAddText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') requestSuggestion('auto')
                    }}
                  />
                  <button
                    className="btn"
                    onClick={() => requestSuggestion('auto')}
                    disabled={addText.trim() === '' || addLoading}
                  >
                    {addLoading ? (
                      <>
                        <span className="material-icons">auto_awesome</span> Bezig…
                      </>
                    ) : (
                      <>
                        <span className="material-icons">auto_awesome</span> Vertaal
                      </>
                    )}
                  </button>
                </div>
                {addError && (
                  <p className="vocab-add-error">
                    {addError}{' '}
                    <button className="vocab-add-retry" onClick={() => requestSuggestion('auto')}>
                      Opnieuw
                    </button>
                  </p>
                )}
                {addSuggestion && (
                  <div className="vocab-add-card">
                    <label className="vocab-add-field">
                      <span>Spaans</span>
                      <input
                        lang="es"
                        value={addSuggestion.word}
                        onChange={(e) =>
                          setAddSuggestion((s) => (s ? { ...s, word: e.target.value } : s))
                        }
                      />
                    </label>
                    <label className="vocab-add-field">
                      <span>Vertaling</span>
                      <input
                        value={addSuggestion.translation}
                        onChange={(e) =>
                          setAddSuggestion((s) => (s ? { ...s, translation: e.target.value } : s))
                        }
                      />
                    </label>
                    <label className="vocab-add-field">
                      <span>Voorbeeldzin</span>
                      <input
                        lang="es"
                        value={addSuggestion.context}
                        onChange={(e) =>
                          setAddSuggestion((s) => (s ? { ...s, context: e.target.value } : s))
                        }
                      />
                    </label>
                    {addDupNotice && <p className="vocab-add-dup">{addDupNotice}</p>}
                    <div className="vocab-add-actions">
                      <button
                        className="btn"
                        onClick={flipSuggestion}
                        disabled={addLoading}
                        title="Verkeerde richting gedetecteerd? Draai om."
                      >
<span className="material-icons">swap_horiz</span> Omdraaien
                      </button>
                      <button className="btn" onClick={cancelSuggestion} disabled={addLoading}>
                        Annuleren
                      </button>
                      <button
                        className="btn help"
                        onClick={addSuggestionToVocab}
                        disabled={addLoading || addSuggestion.word.trim() === ''}
                      >
                        Toevoegen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="vocab-add-hint">
                <span className="material-icons">auto_awesome</span> AI-toevoegen vereist een Gemini-key op de
                server.
              </p>
            )}

            {/* Filter over de bestaande lijst. */}
            {vocab.length > 0 && (
              <input
                className="vocab-filter"
                placeholder="Zoek in je woorden…"
                value={vocabFilter}
                onChange={(e) => setVocabFilter(e.target.value)}
              />
            )}

            {vocab.length === 0 ? (
              <p className="vocab-empty">Nog geen woorden. Klik in de Spaanse zin op een woord dat je niet kent.</p>
            ) : filteredVocab.length === 0 ? (
              <p className="vocab-empty">Geen woorden gevonden voor "{vocabFilter.trim()}".</p>
            ) : (
              <ul className="vocab-list">
                {filteredVocab.map((w) => (
                  <li className="vocab-item" key={w.key}>
                    {editWordKey === w.key ? (
                      <input
                        className="vocab-word-edit"
                        lang="es"
                        value={editWordVal}
                        autoFocus
                        onChange={(e) => setEditWordVal(e.target.value)}
                        onBlur={() => commitWordEdit(w.key)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitWordEdit(w.key)
                          else if (e.key === 'Escape') setEditWordKey(null)
                        }}
                      />
                    ) : (
                      <span
                        className="vocab-word"
                        lang="es"
                        title="Klik om het woord aan te passen"
                        onClick={() => {
                          setEditWordKey(w.key)
                          setEditWordVal(w.word)
                        }}
                      >
                        {w.word}
                      </span>
                    )}
                    {editKey === w.key ? (
                      <input
                        className="vocab-tr-edit"
                        value={editVal}
                        autoFocus
                        onChange={(e) => setEditVal(e.target.value)}
                        onBlur={() => commitEdit(w.key)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(w.key)
                          else if (e.key === 'Escape') setEditKey(null)
                        }}
                      />
                    ) : (
                      <span
                        className="vocab-tr"
                        title="Klik om de betekenis aan te passen"
                        onClick={() => {
                          setEditKey(w.key)
                          setEditVal(w.translation)
                        }}
                      >
                        {w.translation || '—'}
                      </span>
                    )}
                    {(() => {
                      const box = srs[w.key]?.box ?? 0
                      return (
                        <span
                          className="vocab-progress"
                          title={`Voortgang: box ${box} / ${MAX_BOX}`}
                          aria-label={`Voortgang: box ${box} van ${MAX_BOX}`}
                        >
                          {Array.from({ length: MAX_BOX }, (_, i) => (
                            <span key={i} className={`vocab-seg${i < box ? ' filled' : ''}`} />
                          ))}
                        </span>
                      )
                    })()}
                    <button
                      className="vocab-del"
                      onClick={() => {
                        setVocab((prev) => prev.filter((x) => x.key !== w.key))
                        removeVocab(w.key).then(setVocab).catch(() => {})
                      }}
                      aria-label={`Verwijder ${w.word}`}
                      title="Verwijderen"
                    >
                      <span className="material-icons">close</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {(screen === 'flashcard' || screen === 'flashcardNl' || screen === 'aisentence') && (
        <div className="screen" aria-label="Oefenen">
          <div className="screen-inner">
            <PracticePanel
              mode={screen === 'aisentence' ? 'aisentence' : 'flashcard'}
              flashDir={screen === 'flashcardNl' ? 'nl2es' : 'es2nl'}
              vocab={vocab}
              onBack={() => setScreen('menu')}
              markedKeys={markedKeys}
              onToggleMark={toggleMark}
            />
          </div>
        </div>
      )}

      {screen === 'chat' && (
        <div className="screen" aria-label="Chat">
          <div className="screen-inner">
            <ChatPanel
              title={chatTitle}
              seed={chatSeed}
              context={chatContext ?? undefined}
              onBack={() => setScreen(chatReturnTo)}
            />
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="panel">
          <div className="panel-row">
            <span className="book-name" title={bookName}>
              <span className="material-icons">menu_book</span> {bookName}
            </span>
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={onPickFile}
            />
            <button className="btn book-load" onClick={() => fileInput.current?.click()} disabled={loadingBook}>
              {loadingBook ? 'Inladen…' : book ? 'Ander boek' : 'Boek laden'}
            </button>
          </div>

          {chapters.length > 0 && (
            <label className="panel-field">
              Hoofdstuk
              <select
                className="chapter-select"
                value={currentChapter >= 0 ? currentChapter : ''}
                onChange={(e) => navChapter(Number(e.target.value))}
              >
                {currentChapter < 0 && <option value="">— kies —</option>}
                {chapters.map((c, i) => (
                  <option key={i} value={i}>
                    {c.generated ? `✦ ${c.title}` : c.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="panel-field">
            Stem
            <select
              value={voiceId}
              onChange={(e) => onVoiceChange(e.target.value)}
              disabled={voices.length === 0 && shownCloudVoices.length === 0}
            >
              <option value="">Automatisch (browser, Latijns-Amerikaans)</option>
              {voices.length > 0 && (
                <optgroup label="Browser (gratis)">
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={`browser:${v.voiceURI}`}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </optgroup>
              )}
              {shownCloudVoices.length > 0 && (
                <optgroup label="☁ Google Cloud (natuurlijk)">
                  {shownCloudVoices.map((v) => (
                    <option key={v.name} value={`cloud:${v.name}:${v.lang}`}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <label className="panel-field">
            Snelheid
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.1}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            />
            <span className="speed-val">{rate.toFixed(1)}×</span>
          </label>

          <div className="panel-field panel-toggle-row">
            <span>Voorlezen (geluid ontvangen)</span>
            <button
              className="sound-toggle"
              onClick={() => setAudioOn(audioMuted)}
              aria-pressed={!audioMuted}
              aria-label={audioMuted ? 'Voorlezen aanzetten' : 'Voorlezen uitzetten'}
              title={audioMuted ? 'Voorlezen staat uit — klik om aan te zetten' : 'Voorlezen staat aan — klik om uit te zetten'}
            >
              <span className="material-icons" aria-hidden="true">
                {audioMuted ? 'volume_off' : 'volume_up'}
              </span>
            </button>
          </div>

          <div className="panel-field panel-toggle-row">
            <span>
              Microfoon (geluid produceren)
              <span className="toggle-hint">Nog niet in gebruik — voor komende spraak-oefeningen.</span>
            </span>
            <button
              className="sound-toggle"
              onClick={() => setMicOn(micMuted)}
              aria-pressed={!micMuted}
              aria-label={micMuted ? 'Microfoon aanzetten' : 'Microfoon uitzetten'}
              title={micMuted ? 'Microfoon staat uit — klik om aan te zetten' : 'Microfoon staat aan — klik om uit te zetten'}
            >
              <span className="material-icons" aria-hidden="true">
                {micMuted ? 'mic_off' : 'mic'}
              </span>
            </button>
          </div>

          <label className="panel-field" title={!features.gemini ? 'Vereist een Gemini-key op de server' : undefined}>
            AI-vertaling
            <select
              value={aiMode}
              disabled={!features.gemini}
              onChange={(e) => onChangeAiMode(e.target.value as AiTranslateMode)}
            >
              <option value="off">Uit (alleen Google)</option>
              <option value="second">Als 2e keus (klik op de NL-zin)</option>
              <option value="first">Meteen (AI als 1e keus)</option>
            </select>
          </label>

          <label className="panel-field" title={!features.gemini ? 'Vereist een Gemini-key op de server' : undefined}>
            Knippen (bij import)
            <select
              value={segMode}
              disabled={!features.gemini}
              onChange={(e) => onChangeSegMode(e.target.value as SegmentMode)}
            >
              <option value="deterministic">Deterministisch (snel, geen AI)</option>
              <option value="ai">AI-knipper (opschonen + slim knippen)</option>
            </select>
            <span className="field-hint">Geldt bij het volgende (her)import.</span>
          </label>
        </div>
      )}
      {bookError && <p className="warn">{bookError}</p>}

      <main className="stage">
        {reader.loading && (
          <p className="loading-hint">
            <span className="spinner" aria-hidden="true" /> AI-knipper is bezig…
          </p>
        )}
        {reveal === 'none' && !audioMuted ? (
          <p className="listen-hint">
            <span className="material-icons">headphones</span> Luister naar de zin
          </p>
        ) : (
          <p className="spanish" lang="es" onMouseUp={handleSelection}>
            {tokenize(sentence).map((t, i) =>
              t.isWord ? (
                <span
                  className={`word${markedKeys.has(t.key) ? ' marked' : ''}`}
                  key={i}
                  onClick={() => toggleMark(t.key, t.raw)}
                >
                  {t.raw}
                  <span className="tooltip">
                    {glosses ? glosses[t.key] ?? '—' : '…'}
                    <span className="tooltip-hint">{markedKeys.has(t.key) ? 'klik: uit lijst' : 'klik: markeer'}</span>
                  </span>
                </span>
              ) : (
                <span key={i}>{t.raw}</span>
              ),
            )}
          </p>
        )}

        {reveal === 'dutch' && (
          <div className="dutch-block">
            {aiMode === 'first' && !aiNl && aiError ? (
              <p className="dutch ai-failed" title={aiError}>
                <span className="material-icons">warning</span> AI-vertaling mislukt
              </p>
            ) : (
              <p
                className={`dutch${aiMode === 'second' && !aiNl ? ' clickable' : ''}`}
                onClick={aiMode === 'second' && !aiNl ? () => setAiOptionOpen(true) : undefined}
                title={aiMode === 'second' && !aiNl ? 'Klik voor een AI-vertaling met context' : undefined}
              >
                {aiNl ?? nl ?? 'Vertalen…'}
                {aiNl && (
                  <span className="ai-badge">
                    <span className="material-icons">auto_awesome</span> AI
                  </span>
                )}
              </p>
            )}
            {aiMode === 'second' && aiOptionOpen && !aiNl && (
              <button className="btn ai-translate-btn" onClick={runAiTranslate} disabled={aiTranslating}>
                <span className="material-icons">auto_awesome</span>{' '}
                {aiTranslating ? (
                  'AI-vertaling…'
                ) : aiError ? (
                  <>
                    AI-vertaling mislukt <span className="material-icons">warning</span> — opnieuw
                  </>
                ) : (
                  'AI-vertaling (met context)'
                )}
              </button>
            )}
          </div>
        )}

        {/* Selecteer -> uitleg + bewaren */}
        {reveal !== 'none' && selection !== '' && (
          <div className="selection-actions">
            <button className="btn explain-btn" onClick={runExplain} disabled={explaining || !features.gemini}>
<span className="material-icons">lightbulb</span>{' '}
              {explaining ? 'Uitleg ophalen…' : `Leg uit: "${selection}"`}
            </button>
            {markedKeys.has(phraseKey(selection)) ? (
              <button className="btn" disabled>
                <span className="material-icons">check</span> In lijst
              </button>
            ) : (
              <button className="btn" onClick={saveSelection}>
                <span className="material-icons">bookmark_add</span> Bewaar: "{selection}"
              </button>
            )}
          </div>
        )}
        {reveal !== 'none' && selection === '' && (
          <p className="hint-select">
            Tip: klik op een woord om het te markeren, of selecteer een stukje voor uitleg/bewaren.
          </p>
        )}
        {explainChat.length > 0 && (
          <div className="explain-panel">
            <button
              className="explain-close"
              onClick={() => {
                setExplainChat([])
                setExplainCtx(null)
              }}
              aria-label="Sluiten"
            >
              <span className="material-icons">close</span>
            </button>
            <div className="explain-thread">
              {explainChat.map((m, i) =>
                m.role === 'model' ? (
                  <div
                    className="explain-text explain-md"
                    key={i}
                    dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }}
                  />
                ) : (
                  <p className="explain-q" key={i}>
                    {m.text}
                  </p>
                ),
              )}
            </div>
            <div className="explain-ask">
              <button className="btn" onClick={continueInChat} disabled={!features.gemini}>
                <span className="material-icons">chat</span> Verder in chat
              </button>
            </div>
          </div>
        )}
        {explainError && <p className="warn">{explainError}</p>}

        {error && <p className="warn">{error}</p>}
        {reader.error && <p className="warn">AI-knipper: {reader.error}</p>}
      </main>

      <div className="controls">
        {!audioMuted && (
          <button className="btn help" onClick={handleListen} disabled={!ttsSupported()}>
            <span className="material-icons">volume_up</span> Luister{reveal === 'none' ? '' : ' (nog een keer)'}
          </button>
        )}
        {reveal === 'none' && (
          <button className="btn help" onClick={() => setReveal('spanish')}>
            <span className="material-icons">visibility</span> Ondertiteld
          </button>
        )}
        {reveal === 'spanish' && (
          <button className="btn help" onClick={() => setReveal('dutch')}>
            <span className="material-icons">translate</span> NL-zin
          </button>
        )}
      </div>

      <nav className="nav">
        <button className="btn nav-btn" onClick={navPrev} disabled={!reader.hasPrev || reader.loading}>
          ◀ Vorige
        </button>
        <button className="btn nav-btn" onClick={navNext} disabled={!reader.hasNext || reader.loading}>
          Volgende ▶
        </button>
      </nav>

      {!features.translate && (
        <p className="warn">
          De vertaal-service is niet beschikbaar — de server heeft geen{' '}
          <code>GOOGLE_CLOUD_KEY</code> ingesteld.
        </p>
      )}
      {!features.gemini && (
        <p className="warn">
          De AI-functies ("Leg uit", AI-vertaling) zijn niet beschikbaar — de server heeft geen{' '}
          <code>GEMINI_KEY</code> ingesteld.
        </p>
      )}
      {!ttsSupported() && (
        <p className="warn">Deze browser ondersteunt geen ingebouwde spraak; voorlezen werkt hier niet.</p>
      )}
      {ttsError && <p className="warn">Voorlezen (Cloud-stem): {ttsError}</p>}

      <footer className="foot">
        browser-stem · vertaling via Google Translate · uitleg via Gemini · PDF via pdfjs
      </footer>
    </div>
  )
}
