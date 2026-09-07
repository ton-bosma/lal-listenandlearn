import { useEffect, useMemo, useRef, useState } from 'react'
import type { VocabWord } from './lib/vocab'
import { tokenize } from './lib/words'
import { translateWords } from './lib/translate'
import {
  type PracticeDir,
  type PracticeSentence,
  type SrsState,
  buildRound,
  fetchPracticeSentence,
  grade,
  loadSrs,
} from './lib/practice'

// Oefenmodus (flashcards vanuit de woordenlijst). Twee oefeningen, elk als eigen scherm gekozen:
//  'aisentence' — verse Spaanse zin met het woord (backend) → reveal-knop → NL-vertaling.
//  'flashcard'  — Spaans woord → reveal-knop → NL-vertaling + bronzin.
// Beide: reveal + zelf-beoordelen (Goed/Fout) met lichte Leitner-SRS. Zie docs/OEFENMODUS.md.
// De oefening start meteen bij mount; er is geen intern menu meer (dat is het keuzescherm in App).

type Mode = 'flashcard' | 'aisentence'

// Hoeveel komende (nog niet gecachete) kaarten vooruit worden gegenereerd terwijl je met de
// huidige kaart bezig bent. We scannen de wachtrij vanaf index 1 en slaan al-gecachete over,
// zodat ook de kaart ná een instant-herhaling (fout-teruggezette zin) alvast klaarstaat.
const PREFETCH_AHEAD = 2

interface Props {
  vocab: VocabWord[]
  mode: Mode
  /** Richting van de woord-flashcard (alleen relevant bij mode==='flashcard'). */
  flashDir?: PracticeDir
  onBack: () => void
  markedKeys: Set<string>
  onToggleMark: (key: string, raw: string, context: string, known?: string) => void
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Onbekende fout.'
}

export default function PracticePanel({
  vocab,
  mode,
  flashDir = 'es2nl',
  onBack,
  markedKeys,
  onToggleMark,
}: Props) {
  const isAi = mode === 'aisentence'
  // Effectieve richting: alleen de woord-flashcard kent NL→ES; de AI-zin blijft altijd ES→NL.
  const dir: PracticeDir = mode === 'flashcard' ? flashDir : 'es2nl'
  const flashTitle =
    dir === 'nl2es'
      ? '🃏 Woord-flashcard — Nederlands → Spaans'
      : '🃏 Woord-flashcard — Spaans → Nederlands'

  // SRS-stand (lokaal). We houden 'm in state zodat de UI meebeweegt, en persisteren via grade().
  const [srs, setSrs] = useState<SrsState>(() => loadSrs())

  // De ronde als wachtrij van woord-keys. Bij Fout schuift de kaart verderop terug in de rij.
  const [queue, setQueue] = useState<string[]>([])
  // Seed voor oefening A: constant binnen een ronde (een fout-teruggezette kaart toont dezelfde
  // zin, zodat je 'm een keer goed kunt krijgen), en roteert per nieuwe ronde voor een verse zin.
  const [roundSeed, setRoundSeed] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(0)
  const [wrong, setWrong] = useState(0)
  const [total, setTotal] = useState(0)
  const [finished, setFinished] = useState(false)

  const wordByKey = useMemo(() => {
    const m = new Map<string, VocabWord>()
    for (const w of vocab) m.set(w.key, w)
    return m
  }, [vocab])

  const currentKey = queue[0] ?? null
  const currentWord = currentKey ? wordByKey.get(currentKey) ?? null : null
  const seed = roundSeed

  // Oefening A: opgehaalde zinnen cachen per (key, seed) zodat een herhaling/terugkeer niet
  // opnieuw haalt. De cache overleeft re-renders (ref); status stuurt de spinner/foutmelding.
  const sentenceCache = useRef(new Map<string, PracticeSentence>())
  // In-flight dedup: lopende fetches per (key, seed), zodat een prefetch en de huidige-kaart-fetch
  // niet dubbel voor dezelfde zin gaan werken (en de huidige kaart op een lopende prefetch wacht).
  const inFlight = useRef(new Map<string, Promise<PracticeSentence>>())
  const [aiSentence, setAiSentence] = useState<PracticeSentence | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  // Woord-vertalingen (glosses) voor de tokens op de voorkant van de AI-zin. null = nog niet klaar.
  const [glosses, setGlosses] = useState<Record<string, string> | null>(null)

  // Eén ingang naar een zin: cache-hit → meteen; anders een lopende fetch hergebruiken; anders
  // een nieuwe fetch starten, die in de cache schrijft en zichzelf uit inFlight opruimt.
  function getSentence(word: VocabWord, s: number): Promise<PracticeSentence> {
    const ck = `${word.key}:${s}`
    const cached = sentenceCache.current.get(ck)
    if (cached) return Promise.resolve(cached)
    const pending = inFlight.current.get(ck)
    if (pending) return pending
    const p = fetchPracticeSentence(word.word, word.translation, s)
      .then((r) => {
        sentenceCache.current.set(ck, r)
        return r
      })
      .finally(() => {
        inFlight.current.delete(ck)
      })
    inFlight.current.set(ck, p)
    return p
  }

  function startRound() {
    const round = buildRound(vocab, srs, dir)
    setQueue(round)
    setRoundSeed((s) => s + 1)
    setDone(0)
    setWrong(0)
    setTotal(round.length)
    setFlipped(false)
    setFinished(false)
    setAiSentence(null)
    setAiError(null)
    setGlosses(null)
  }

  // Meteen een ronde starten bij mount (de gekozen oefening); geen intern menu meer.
  useEffect(() => {
    startRound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Huidige kaart: de zin ophalen via getSentence (dus geen dubbele fetch als de prefetch al
  // bezig is). Bij cache-miss blijft de spinner staan tot de (lopende of nieuwe) fetch klaar is.
  useEffect(() => {
    if (!isAi || !currentWord) return
    const ck = `${currentWord.key}:${seed}`
    const cached = sentenceCache.current.get(ck)
    if (cached) {
      setAiSentence(cached)
      setAiLoading(false)
      setAiError(null)
      return
    }
    let cancelled = false
    setAiSentence(null)
    setAiLoading(true)
    setAiError(null)
    getSentence(currentWord, seed)
      .then((r) => {
        if (!cancelled) setAiSentence(r)
      })
      .catch((e) => !cancelled && setAiError(errMessage(e)))
      .finally(() => !cancelled && setAiLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAi, currentWord, seed, retryTick])

  // Prefetch (oefening A): scan de wachtrij vanaf index 1 vooruit, sla al-gecachete kaarten over
  // en start (fire-and-forget) de eerste PREFETCH_AHEAD nog niet gecachete komende kaarten. Zo
  // staat ook de kaart ná een instant-herhaling alvast klaar.
  useEffect(() => {
    if (!isAi) return
    let started = 0
    for (let i = 1; i < queue.length && started < PREFETCH_AHEAD; i++) {
      const w = wordByKey.get(queue[i])
      if (!w) continue
      const ck = `${w.key}:${seed}`
      if (sentenceCache.current.has(ck)) continue
      started++
      getSentence(w, seed).catch(() => {
        /* stil: de fout verschijnt vanzelf als deze kaart de huidige wordt */
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAi, queue, seed, wordByKey])

  // Glosses (woord-vertalingen) voor de AI-zin ophalen zodra er een nieuwe zin is; bij een
  // zin-wissel eerst naar null zodat je nooit de vorige vertalingen in de tooltips ziet flitsen.
  useEffect(() => {
    if (!isAi || !aiSentence) {
      setGlosses(null)
      return
    }
    setGlosses(null)
    let cancelled = false
    const keys = [...new Set(tokenize(aiSentence.sentence).filter((t) => t.isWord).map((t) => t.key))]
    translateWords(keys)
      .then((map) => !cancelled && setGlosses(map))
      .catch(() => {
        /* stil: zonder glosses tonen de tooltips gewoon '—' */
      })
    return () => {
      cancelled = true
    }
  }, [isAi, aiSentence])

  function handleGrade(correct: boolean) {
    if (!currentKey) return
    const nextSrs = grade(currentKey, correct, srs, dir)
    setSrs(nextSrs)
    setFlipped(false)
    if (correct) {
      const rest = queue.slice(1)
      setDone((d) => d + 1)
      setQueue(rest)
      if (rest.length === 0) setFinished(true)
    } else {
      setWrong((w) => w + 1)
      const [head, ...rest] = queue
      // Verderop opnieuw in de rij (snel terug, maar niet meteen weer).
      const insertAt = Math.min(3, rest.length)
      setQueue([...rest.slice(0, insertAt), head, ...rest.slice(insertAt)])
    }
  }

  // ---- Lege lijst ----------------------------------------------------------
  if (vocab.length === 0) {
    return (
      <div className="practice">
        <div className="practice-head">
          <button className="btn practice-back" onClick={onBack}>
            ← Terug
          </button>
          <span className="practice-title">{isAi ? '✨ AI-voorbeeldzin' : flashTitle}</span>
        </div>
        <p className="practice-empty">
          Nog geen woorden om te oefenen. Markeer eerst wat woorden in de tekst.
        </p>
      </div>
    )
  }

  // ---- Einde ronde ---------------------------------------------------------
  if (finished) {
    return (
      <div className="practice">
        <div className="practice-head">
          <button className="btn practice-back" onClick={onBack}>
            ← Terug
          </button>
          <span className="practice-title">Ronde klaar</span>
        </div>
        <div className="practice-summary">
          <p className="practice-summary-line">
            🎉 Klaar! {total} {total === 1 ? 'kaart' : 'kaarten'} afgerond.
          </p>
          <p className="practice-summary-sub">
            {wrong === 0 ? 'Alles in één keer goed.' : `${wrong}× fout onderweg.`}
          </p>
          <div className="practice-summary-actions">
            <button className="btn help" onClick={startRound}>
              Opnieuw
            </button>
            <button className="btn" onClick={onBack}>
              Ander oefening
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---- Actieve kaart -------------------------------------------------------
  // De kaart is niet meer klikbaar om te draaien; de reveal loopt via een aparte knop.
  const canReveal = isAi ? !!aiSentence && !aiLoading && !aiError : !!currentWord

  return (
    <div className="practice">
      <div className="practice-head">
        <button className="btn practice-back" onClick={onBack}>
          ← Terug
        </button>
        <span className="practice-title">{isAi ? '✨ AI-voorbeeldzin' : flashTitle}</span>
        <span className="practice-progress">
          {Math.min(done + 1, total)} / {total}
        </span>
      </div>

      <div className={`practice-card${flipped ? ' flipped' : ''}${canReveal ? '' : ' not-ready'}`}>
        {!flipped ? (
          <div className="practice-card-face">
            {isAi ? (
              <>
                {aiLoading && (
                  <span className="practice-loading">
                    <span className="spinner" aria-hidden="true" /> Zin maken…
                  </span>
                )}
                {aiError && <span className="practice-card-error">⚠️ Zin ophalen mislukt.</span>}
                {!aiLoading && !aiError && aiSentence && (
                  <span className="practice-front" lang="es">
                    {tokenize(aiSentence.sentence).map((t, i) =>
                      t.isWord ? (
                        <span
                          className={`word${markedKeys.has(t.key) ? ' marked' : ''}`}
                          key={i}
                          onClick={() => onToggleMark(t.key, t.raw, aiSentence.sentence, glosses?.[t.key])}
                        >
                          {t.raw}
                          <span className="tooltip">
                            {glosses ? glosses[t.key] ?? '—' : '…'}
                            <span className="tooltip-hint">
                              {markedKeys.has(t.key) ? 'klik: uit lijst' : 'klik: markeer'}
                            </span>
                          </span>
                        </span>
                      ) : (
                        <span key={i}>{t.raw}</span>
                      ),
                    )}
                  </span>
                )}
              </>
            ) : dir === 'nl2es' ? (
              <span className="practice-front">{currentWord?.translation || '—'}</span>
            ) : (
              <span className="practice-front" lang="es">
                {currentWord?.word || '—'}
              </span>
            )}
          </div>
        ) : (
          <div
            className="practice-card-face practice-card-back"
            onClick={() => setFlipped(false)}
            role="button"
            tabIndex={0}
            title="Klik om terug te gaan naar het origineel"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setFlipped(false)
              }
            }}
          >
            {isAi ? (
              <span className="practice-back-nl">{aiSentence?.translation || '—'}</span>
            ) : dir === 'nl2es' ? (
              <>
                <span className="practice-back-nl" lang="es">
                  {currentWord?.word || '—'}
                </span>
                {currentWord?.context && (
                  <span className="practice-back-context" lang="es">
                    “{currentWord.context}”
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="practice-back-nl">{currentWord?.translation || '—'}</span>
                {currentWord?.context && (
                  <span className="practice-back-context" lang="es">
                    “{currentWord.context}”
                  </span>
                )}
              </>
            )}
            <span className="practice-flip-hint">klik om terug naar het origineel</span>
          </div>
        )}
      </div>

      {isAi && aiError && !flipped && (
        <button className="btn practice-retry" onClick={() => setRetryTick((t) => t + 1)}>
          Opnieuw proberen
        </button>
      )}

      {flipped ? (
        <div className="practice-grade">
          <button className="btn practice-wrong" onClick={() => handleGrade(false)}>
            ✗ Fout
          </button>
          <button className="btn practice-right" onClick={() => handleGrade(true)}>
            ✓ Goed
          </button>
        </div>
      ) : (
        <>
          <button
            className="btn help practice-reveal"
            onClick={() => setFlipped(true)}
            disabled={!canReveal}
          >
            👁 Toon vertaling
          </button>
          <p className="practice-tip">
            {isAi
              ? 'Lees de Spaanse zin, bedenk de vertaling, toon dan de vertaling.'
              : 'Bedenk de betekenis, toon dan de vertaling.'}
          </p>
        </>
      )}
    </div>
  )
}
