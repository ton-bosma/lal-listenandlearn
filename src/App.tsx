import { useEffect, useRef, useState } from 'react'
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
  loadBook,
  loadMuted,
  saveBook,
  saveMuted,
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
import { type ChatMsg, explainFollowup, explainFragment } from './lib/explain'
import { mdToHtml } from './lib/markdown'
import { type Features, NO_FEATURES, fetchFeatures } from './lib/health'
import { type VocabWord, addVocab, listVocab, removeVocab, updateVocab } from './lib/vocab'

// De drie zichtbaarheidsniveaus van de progressieve hulp (zie docs/SPEC.md):
//  'none'    -> Luister: alleen audio, Spaanse tekst verborgen
//  'spanish' -> Ondertiteld: Spaanse zin zichtbaar met woord-hovers (live vertaald)
//  'dutch'   -> NL-zin: volledige vertaling eronder, Spaans blijft staan
type Reveal = 'none' | 'spanish' | 'dutch'

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

  const [reveal, setReveal] = useState<Reveal>('none')
  const [rate, setRate] = useState(0.9)
  const firstMount = useRef(true)

  // Mute: alle spraak uit (auto én handmatig), met een kort zichtbare melding.
  const [muted, setMuted] = useState(() => loadMuted())
  const [muteNotice, setMuteNotice] = useState(false)
  const muteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
  const [vocabOpen, setVocabOpen] = useState(false)
  const markedKeys = new Set(vocab.map((w) => w.key))
  // Inline bewerken van een vertaling in het paneel.
  const [editKey, setEditKey] = useState<string | null>(null)
  const [editVal, setEditVal] = useState('')
  // Inline bewerken van het woord zelf.
  const [editWordKey, setEditWordKey] = useState<string | null>(null)
  const [editWordVal, setEditWordVal] = useState('')

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

  // Selecteer + uitleg (Fase 3).
  const [selection, setSelection] = useState('')
  // Uitleg als multi-turn chat: de thread (uitleg + vervolgvragen/-antwoorden), waar de chat over
  // gaat (fragment+zin), en het vervolgvraag-invoerveld. Reset bij zin-wissel.
  const [explainChat, setExplainChat] = useState<ChatMsg[]>([])
  const [explainCtx, setExplainCtx] = useState<{ fragment: string; sentence: string } | null>(null)
  const [followupVal, setFollowupVal] = useState('')
  const [explaining, setExplaining] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)

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
    setFollowupVal('')
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
    if (muted) return // mute: geen automatische spraak
    speak(sentence, rate)
    // rate/muted bewust niet in deps: snelheid of mute wijzigen leest niet vanzelf opnieuw voor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos])

  // Kort de "geluid staat uit"-melding tonen (bij een luister-actie terwijl mute aanstaat).
  function flashMuteNotice() {
    setMuteNotice(true)
    if (muteTimer.current) clearTimeout(muteTimer.current)
    muteTimer.current = setTimeout(() => setMuteNotice(false), 2500)
  }
  useEffect(() => {
    return () => {
      if (muteTimer.current) clearTimeout(muteTimer.current)
    }
  }, [])

  function toggleMute() {
    const next = !muted
    setMuted(next)
    saveMuted(next)
    if (next) {
      stopSpeaking()
      flashMuteNotice()
    } else {
      setMuteNotice(false)
    }
  }

  // Handmatig voorlezen ("Luister"); bij mute geen geluid maar wel de melding.
  function handleListen() {
    if (muted) {
      flashMuteNotice()
      return
    }
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
    setReveal('none')
    reader.goPrev()
  }
  function navNext() {
    stopSpeaking()
    setReveal('none')
    reader.goNext()
  }
  function navChapter(i: number) {
    stopSpeaking()
    setReveal('none')
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
        setReveal('none')
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
      setReveal('none')
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
    // Nieuwe selectie -> oud uitleg-gesprek opruimen.
    setExplainChat([])
    setExplainCtx(null)
    setFollowupVal('')
    setExplainError(null)
  }

  function runExplain() {
    if (selection === '') return
    const fragment = selection
    const ctxSentence = sentence
    setExplaining(true)
    setExplainChat([])
    setExplainCtx(null)
    setFollowupVal('')
    setExplainError(null)
    explainFragment(fragment, ctxSentence)
      .then((text) => {
        setExplainCtx({ fragment, sentence: ctxSentence })
        setExplainChat([{ role: 'model', text }])
      })
      .catch((err) => setExplainError(errMessage(err)))
      .finally(() => setExplaining(false))
  }

  // Vervolgvraag binnen het uitleg-gesprek (fragment + zin + eerdere beurten als context).
  function askFollowup() {
    const q = followupVal.trim()
    if (q === '' || !explainCtx || explaining) return
    const history = explainChat
    setFollowupVal('')
    setExplainChat((prev) => [...prev, { role: 'user', text: q }])
    setExplaining(true)
    setExplainError(null)
    explainFollowup(explainCtx.fragment, explainCtx.sentence, history, q)
      .then((text) => setExplainChat((prev) => [...prev, { role: 'model', text }]))
      .catch((err) => setExplainError(errMessage(err)))
      .finally(() => setExplaining(false))
  }

  // Klik op een woord = markeren/ontmarkeren (alleen bij een kále klik, niet bij een selectie).
  function toggleMark(key: string, raw: string) {
    if ((window.getSelection()?.toString().trim() ?? '') !== '') return // selectie = "Leg uit"
    if (markedKeys.has(key)) {
      setVocab((prev) => prev.filter((w) => w.key !== key)) // optimistisch
      removeVocab(key).then(setVocab).catch(() => {})
      return
    }
    // Vertaling uit de reeds opgehaalde glossen; anders even los ophalen.
    const known = glosses?.[key]
    const word = cleanWord(raw) // opgeschoonde weergave (lowercase, leestekens weg, afkortingen heel)
    const add = (translation: string) => {
      setVocab((prev) => [...prev, { key, word, translation, context: sentence }]) // optimistisch
      addVocab({ key, word, translation, context: sentence }).then(setVocab).catch(() => {})
    }
    if (typeof known === 'string' && known !== '') add(known)
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

  return (
    <div className="app">
      <header className="topbar">
        <h1>Spaans leren per zin</h1>
        <div className="topbar-right">
          <span className="counter">
            {reader.progress.approx
              ? `Zin ~${reader.progress.current} / ~${reader.progress.total}`
              : `Zin ${reader.progress.current} / ${reader.progress.total}`}
            {reader.loading && ' ⏳'}
          </span>
          <button
            className="icon-btn vocab-btn"
            onClick={() => setVocabOpen((o) => !o)}
            aria-label="Woordenlijst"
            aria-pressed={vocabOpen}
            title="Woordenlijst (gemarkeerde woorden)"
          >
            📑{vocab.length > 0 && <span className="vocab-count">{vocab.length}</span>}
          </button>
          <button
            className="icon-btn"
            onClick={toggleMute}
            aria-label={muted ? 'Geluid aanzetten' : 'Geluid uitzetten (mute)'}
            aria-pressed={muted}
            title={muted ? 'Mute staat aan — klik om geluid aan te zetten' : 'Mute (alle spraak uit)'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen((o) => !o)}
            aria-label="Instellingen en boek"
            title="Instellingen en boek"
          >
            ⚙
          </button>
        </div>
      </header>

      {vocabOpen && (
        <>
          <div className="vocab-backdrop" onClick={() => setVocabOpen(false)} />
          <aside className="vocab-panel" aria-label="Woordenlijst">
            <div className="vocab-head">
              <span>Woordenlijst ({vocab.length})</span>
              <button className="icon-btn" onClick={() => setVocabOpen(false)} aria-label="Sluiten">
                ×
              </button>
            </div>
            {vocab.length === 0 ? (
              <p className="vocab-empty">Nog geen woorden. Klik in de Spaanse zin op een woord dat je niet kent.</p>
            ) : (
              <ul className="vocab-list">
                {vocab.map((w) => (
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
                    <button
                      className="vocab-del"
                      onClick={() => {
                        setVocab((prev) => prev.filter((x) => x.key !== w.key))
                        removeVocab(w.key).then(setVocab).catch(() => {})
                      }}
                      aria-label={`Verwijder ${w.word}`}
                      title="Verwijderen"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </>
      )}

      {settingsOpen && (
        <div className="panel">
          <div className="panel-row">
            <span className="book-name" title={bookName}>📖 {bookName}</span>
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
        {reveal === 'none' ? (
          <p className="listen-hint">🎧 Luister naar de zin</p>
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
                ⚠️ AI-vertaling mislukt
              </p>
            ) : (
              <p
                className={`dutch${aiMode === 'second' && !aiNl ? ' clickable' : ''}`}
                onClick={aiMode === 'second' && !aiNl ? () => setAiOptionOpen(true) : undefined}
                title={aiMode === 'second' && !aiNl ? 'Klik voor een AI-vertaling met context' : undefined}
              >
                {aiNl ?? nl ?? 'Vertalen…'}
                {aiNl && <span className="ai-badge">✨ AI</span>}
              </p>
            )}
            {aiMode === 'second' && aiOptionOpen && !aiNl && (
              <button className="btn ai-translate-btn" onClick={runAiTranslate} disabled={aiTranslating}>
                ✨{' '}
                {aiTranslating
                  ? 'AI-vertaling…'
                  : aiError
                    ? 'AI-vertaling mislukt ⚠️ — opnieuw'
                    : 'AI-vertaling (met context)'}
              </button>
            )}
          </div>
        )}

        {/* Selecteer -> uitleg + bewaren */}
        {reveal !== 'none' && selection !== '' && (
          <div className="selection-actions">
            <button className="btn explain-btn" onClick={runExplain} disabled={explaining || !features.gemini}>
              💡 {explaining ? 'Uitleg ophalen…' : `Leg uit: "${selection}"`}
            </button>
            {markedKeys.has(phraseKey(selection)) ? (
              <button className="btn" disabled>
                ✓ In lijst
              </button>
            ) : (
              <button className="btn" onClick={saveSelection}>
                📑 Bewaar: "{selection}"
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
                setFollowupVal('')
              }}
              aria-label="Sluiten"
            >
              ×
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
              {explaining && <p className="explain-typing">Antwoord ophalen…</p>}
            </div>
            <div className="explain-ask">
              <input
                className="explain-input"
                placeholder="Vraag verder…"
                value={followupVal}
                onChange={(e) => setFollowupVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') askFollowup()
                }}
              />
              <button
                className="btn"
                onClick={askFollowup}
                disabled={followupVal.trim() === '' || explaining || !features.gemini}
              >
                Vraag
              </button>
            </div>
          </div>
        )}
        {explainError && <p className="warn">{explainError}</p>}

        {error && <p className="warn">{error}</p>}
        {reader.error && <p className="warn">AI-knipper: {reader.error}</p>}
      </main>

      {muteNotice && <p className="mute-notice">🔇 Geluid staat uit — mute is aan.</p>}

      <div className="controls">
        <button className="btn help" onClick={handleListen} disabled={!ttsSupported()}>
          🔊 Luister{reveal === 'none' ? '' : ' (nog een keer)'}
        </button>
        {reveal === 'none' && (
          <button className="btn help" onClick={() => setReveal('spanish')}>
            👁 Ondertiteld
          </button>
        )}
        {reveal === 'spanish' && (
          <button className="btn help" onClick={() => setReveal('dutch')}>
            🇳🇱 NL-zin
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
