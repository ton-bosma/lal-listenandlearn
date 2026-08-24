import { useEffect, useRef, useState } from 'react'
import { demoSentences } from './data/demoText'
import { tokenize } from './lib/words'
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
import { type CloudVoice, hasCloudKey, listSpanishCloudVoices } from './lib/cloudtts'
import { type Book, type Chapter, loadBook, loadProgress, saveBook, saveProgress } from './lib/storage'
import { extractPdfBook } from './lib/pdf'
import { extractEpubBook } from './lib/epub'
import { buildSentences } from './lib/sentences'
import {
  hasTranslateKey,
  MissingKeyError,
  translateSentence,
  translateWords,
} from './lib/translate'
import { explainFragment, hasGeminiKey } from './lib/explain'

// De drie zichtbaarheidsniveaus van de progressieve hulp (zie docs/SPEC.md):
//  'none'    -> Luister: alleen audio, Spaanse tekst verborgen
//  'spanish' -> Ondertiteld: Spaanse zin zichtbaar met woord-hovers (live vertaald)
//  'dutch'   -> NL-zin: volledige vertaling eronder, Spaans blijft staan
type Reveal = 'none' | 'spanish' | 'dutch'

function errMessage(err: unknown): string {
  if (err instanceof MissingKeyError) return err.message
  return err instanceof Error ? err.message : 'Onbekende fout.'
}

/** Unieke, genormaliseerde woorden van een zin (voor de gloss-lookup). */
function wordKeys(sentence: string): string[] {
  return [...new Set(tokenize(sentence).filter((t) => t.isWord).map((t) => t.key))]
}

export default function App() {
  const [book, setBook] = useState<Book | null>(() => loadBook())
  const [index, setIndex] = useState(() => {
    const saved = loadProgress().index
    const len = (loadBook()?.sentences ?? demoSentences).length
    return saved < len ? saved : 0
  })
  const [reveal, setReveal] = useState<Reveal>('none')
  const [rate, setRate] = useState(0.9)
  const firstMount = useRef(true)

  // Ingeladen boek of demotekst.
  const sentences = book?.sentences ?? demoSentences
  const bookName = book?.name ?? 'Demotekst'
  const chapters = book?.chapters ?? []
  // Huidig hoofdstuk = laatste hoofdstuk dat op/voor de huidige zin begint.
  const currentChapter = chapters.reduce((acc, c, i) => (c.start <= index ? i : acc), -1)

  // Boek laden.
  const fileInput = useRef<HTMLInputElement>(null)
  const [loadingBook, setLoadingBook] = useState(false)
  const [bookError, setBookError] = useState<string | null>(null)

  // Stemkeuze: browserstemmen (async) + optionele Cloud-stemmen.
  const [voices, setVoices] = useState(() => getSpanishVoices())
  const [cloudVoices, setCloudVoices] = useState<CloudVoice[]>([])
  const [voiceId, setVoiceId] = useState(() => getChosenVoiceId())
  const [ttsError, setTtsError] = useState<string | null>(null)

  useEffect(() => subscribeVoices(() => setVoices(getSpanishVoices())), [])
  useEffect(() => subscribeTtsError((msg) => setTtsError(msg)), [])
  useEffect(() => {
    if (!hasCloudKey()) return
    let cancelled = false
    listSpanishCloudVoices()
      .then((v) => !cancelled && setCloudVoices(v))
      .catch(() => {}) // stil: Cloud-stemmen zijn optioneel (API mogelijk niet aan)
    return () => {
      cancelled = true
    }
  }, [])

  function onVoiceChange(id: string) {
    setVoiceId(id)
    setChosenVoiceId(id || null)
    setTtsError(null)
  }

  // Live-vertaalresultaten voor de huidige zin (null = nog niet opgehaald).
  const [nl, setNl] = useState<string | null>(null)
  const [glosses, setGlosses] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Selecteer + uitleg (Fase 3).
  const [selection, setSelection] = useState('')
  const [explanation, setExplanation] = useState<string | null>(null)
  const [explaining, setExplaining] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)

  const sentence = sentences[index] ?? ''

  useEffect(() => {
    saveProgress({ index })
  }, [index])

  // Nieuwe zin -> alle per-zin resultaten resetten.
  useEffect(() => {
    setNl(null)
    setGlosses(null)
    setError(null)
    setSelection('')
    setExplanation(null)
    setExplainError(null)
  }, [index])

  // Auto-voorlezen bij aankomen op een zin ("Luister"), niet bij allereerste render.
  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false
      return
    }
    speak(sentence, rate)
    // rate bewust niet in deps: snelheid wijzigen leest niet vanzelf opnieuw voor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

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

  // NL-zin ophalen zodra die stap wordt ingeroepen.
  useEffect(() => {
    if (reveal !== 'dutch' || nl !== null) return
    let cancelled = false
    translateSentence(sentence)
      .then((text) => !cancelled && setNl(text))
      .catch((err) => !cancelled && setError(errMessage(err)))
    return () => {
      cancelled = true
    }
  }, [reveal, nl, sentence])

  function goTo(next: number) {
    if (next < 0 || next >= sentences.length) return
    stopSpeaking()
    setReveal('none') // terug/verder -> zin weer kaal (default, zie SPEC)
    setIndex(next)
  }

  // Een PDF kiezen -> tekst extraheren -> in zinnen splitsen -> als huidig boek zetten.
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
      const { sentences: list, pageStartSentence } = buildSentences(text)
      if (list.length === 0) throw new Error('Geen tekst gevonden — is dit een scan (zonder tekstlaag)?')
      const chapters: Chapter[] = rawChapters
        .map((c) => ({ title: c.title, start: pageStartSentence[c.page] ?? 0 }))
        .filter((c) => c.start >= 0 && c.start < list.length)
        .sort((a, b) => a.start - b.start)
      const newBook: Book = { name: file.name.replace(/\.pdf$/i, ''), sentences: list, chapters }
      saveBook(newBook)
      stopSpeaking()
      setBook(newBook)
      setIndex(0)
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
    // Nieuwe selectie -> oud uitlegresultaat opruimen.
    setExplanation(null)
    setExplainError(null)
  }

  function runExplain() {
    if (selection === '') return
    setExplaining(true)
    setExplanation(null)
    setExplainError(null)
    explainFragment(selection, sentence)
      .then(setExplanation)
      .catch((err) => setExplainError(errMessage(err)))
      .finally(() => setExplaining(false))
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>Spaans leren per zin</h1>
        <span className="counter">
          Zin {index + 1} / {sentences.length}
        </span>
      </header>

      <div className="bookbar">
        <span className="book-name" title={bookName}>📖 {bookName}</span>
        {chapters.length > 0 && (
          <select
            className="chapter-select"
            value={currentChapter >= 0 ? currentChapter : ''}
            onChange={(e) => goTo(chapters[Number(e.target.value)].start)}
          >
            {currentChapter < 0 && <option value="">— hoofdstuk —</option>}
            {chapters.map((c, i) => (
              <option key={i} value={i}>
                {c.title}
              </option>
            ))}
          </select>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={onPickFile}
        />
        <button className="btn book-load" onClick={() => fileInput.current?.click()} disabled={loadingBook}>
          {loadingBook ? 'Inladen…' : book ? 'Ander boek laden' : 'Boek laden'}
        </button>
      </div>
      {bookError && <p className="warn">{bookError}</p>}

      <main className="stage">
        {reveal === 'none' ? (
          <p className="listen-hint">🎧 Luister naar de zin</p>
        ) : (
          <p className="spanish" lang="es" onMouseUp={handleSelection}>
            {tokenize(sentence).map((t, i) =>
              t.isWord ? (
                <span className="word" key={i}>
                  {t.raw}
                  <span className="tooltip">{glosses ? glosses[t.key] ?? '—' : '…'}</span>
                </span>
              ) : (
                <span key={i}>{t.raw}</span>
              ),
            )}
          </p>
        )}

        {reveal === 'dutch' && <p className="dutch">{nl ?? 'Vertalen…'}</p>}

        {/* Selecteer + uitleg */}
        {reveal !== 'none' && selection !== '' && (
          <button className="btn explain-btn" onClick={runExplain} disabled={explaining || !hasGeminiKey()}>
            💡 {explaining ? 'Uitleg ophalen…' : `Leg uit: "${selection}"`}
          </button>
        )}
        {reveal !== 'none' && selection === '' && (
          <p className="hint-select">Tip: selecteer een woord of stukje van de Spaanse zin voor uitleg.</p>
        )}
        {explanation && (
          <div className="explain-panel">
            <button className="explain-close" onClick={() => setExplanation(null)} aria-label="Sluiten">
              ×
            </button>
            <pre className="explain-text">{explanation}</pre>
          </div>
        )}
        {explainError && <p className="warn">{explainError}</p>}

        {error && <p className="warn">{error}</p>}
      </main>

      <div className="controls">
        <button className="btn help" onClick={() => speak(sentence, rate)} disabled={!ttsSupported()}>
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

      <div className="settings">
        <label className="voice">
          Stem
          <select
            value={voiceId}
            onChange={(e) => onVoiceChange(e.target.value)}
            disabled={voices.length === 0 && cloudVoices.length === 0}
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
            {cloudVoices.length > 0 && (
              <optgroup label="☁ Google Cloud (natuurlijk)">
                {cloudVoices.map((v) => (
                  <option key={v.name} value={`cloud:${v.name}:${v.lang}`}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <label className="speed">
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
      </div>

      <nav className="nav">
        <button className="btn nav-btn" onClick={() => goTo(index - 1)} disabled={index === 0}>
          ◀ Vorige
        </button>
        <button className="btn nav-btn" onClick={() => goTo(index + 1)} disabled={index >= sentences.length - 1}>
          Volgende ▶
        </button>
      </nav>

      {!hasTranslateKey() && (
        <p className="warn">
          Geen Google Translate-key ingesteld — vertaling en hovers werken pas na het invullen
          van <code>.env</code> (zie <code>.env.example</code>).
        </p>
      )}
      {!hasGeminiKey() && (
        <p className="warn">
          Geen Gemini-key ingesteld — "Leg uit" werkt pas na het invullen van{' '}
          <code>VITE_GEMINI_KEY</code> in <code>.env</code>.
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
