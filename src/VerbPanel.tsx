import { useEffect, useMemo, useRef, useState } from 'react'
import type { VocabWord } from './lib/vocab'
import { type SrsState, grade, loadSrs, srsKeyFor } from './lib/practice'
import type { SpanishVariant, VerbSettings } from './lib/storage'
import { speak } from './lib/tts'
import {
  type ConjDrill,
  type ConjTable,
  buildVerbQueue,
  fetchConjugationDrill,
  fetchConjugationTable,
  verbBoxToTier,
} from './lib/verbs'

// Werkwoorden-oefening: conjugatie-drills (presente) in drie oplopende tiers, gekozen op de
// conj-box van het werkwoord (zie verbs.ts, verbBoxToTier). De opzet volgt PracticePanel:
//  - constante roundSeed per ronde (verhoogd bij nieuwe ronde), zodat een fout-teruggezet item
//    dezelfde drill terugkrijgt;
//  - drill-cache per (key, seed) + in-flight dedup + prefetch van de komende kaarten;
//  - fout → item verderop terug in de rij; goed → uit de ronde.
// Nakijken is automatisch en accent-ongevoelig (zie normalize). SRS telt los via de ::conj-key.

const PREFETCH_AHEAD = 2

interface Props {
  vocab: VocabWord[]
  onBack: () => void
  settings: VerbSettings
  /** Spaanse variant (LatAm/Spanje) — meegestuurd naar de conjugatie-endpoints. */
  variant: SpanishVariant
  /** Start de "ram"-focusoefening voor één werkwoord (verschijnt na "toon alle vormen"). */
  onFocusVerb: (verbKey: string) => void
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Onbekende fout.'
}

/** Luidspreker-knopje dat een vorm hardop uitspreekt met de gekozen stem. */
function SpeakButton({ text }: { text: string }) {
  return (
    <button
      className="sound-toggle"
      type="button"
      onClick={() => speak(text)}
      aria-label="Uitspraak afspelen"
      title="Uitspreken"
    >
      <span className="material-icons" aria-hidden="true">
        volume_up
      </span>
    </button>
  )
}

/** Accent-ongevoelig normaliseren: diacritics weg, lowercase, trim. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/** Onderwerpsvoornaamwoorden (accent-loos) die vóór de werkwoordsvorm mogen staan. */
const SUBJECT_PRONOUNS = new Set([
  'yo',
  'tu',
  'el',
  'ella',
  'usted',
  'nosotros',
  'nosotras',
  'vosotros',
  'vosotras',
  'ellos',
  'ellas',
  'ustedes',
])

/** Haalt een optioneel voorafgaand onderwerpsvoornaamwoord weg ("tú pareces" → "pareces"). */
function stripSubjectPronoun(s: string): string {
  const parts = normalize(s).split(/\s+/).filter(Boolean)
  if (parts.length > 1 && SUBJECT_PRONOUNS.has(parts[0])) parts.shift()
  return parts.join(' ')
}

/** Of één van de verwachte vormen (accent-ongevoelig, heel woord) in het antwoord voorkomt. */
function matchesExpected(answer: string, expected: string[]): boolean {
  const words = new Set(
    normalize(answer)
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  )
  return expected.some((f) => {
    const nf = normalize(f)
    return nf !== '' && words.has(nf)
  })
}

export default function VerbPanel({ vocab, onBack, settings, variant, onFocusVerb }: Props) {
  // SRS-stand (lokaal). In state zodat de UI meebeweegt; persisteren via grade().
  const [srs, setSrs] = useState<SrsState>(() => loadSrs())

  const [queue, setQueue] = useState<string[]>([])
  const [roundSeed, setRoundSeed] = useState(0)
  const [done, setDone] = useState(0)
  const [wrong, setWrong] = useState(0)
  const [total, setTotal] = useState(0)
  const [finished, setFinished] = useState(false)

  // Antwoord-invoer + nakijk-status van de huidige kaart.
  const [answer, setAnswer] = useState('')
  const [checked, setChecked] = useState(false)
  const [lastCorrect, setLastCorrect] = useState(false)
  const [revealed, setRevealed] = useState(false) // hint (vertaling/modelantwoord) getoond

  const wordByKey = useMemo(() => {
    const m = new Map<string, VocabWord>()
    for (const w of vocab) m.set(w.key, w)
    return m
  }, [vocab])

  // Tier per word-key: vastgezet bij het bouwen van de ronde, zodat een fout-teruggezet item op
  // hetzelfde tier terugkomt (de conj-box kan tussentijds veranderen door grade()).
  const tierByKey = useRef(new Map<string, 1 | 2 | 3>())

  const currentKey = queue[0] ?? null
  const currentWord = currentKey ? wordByKey.get(currentKey) ?? null : null
  const seed = roundSeed

  // Drill-cache per (key, seed) + in-flight dedup (zelfde patroon als PracticePanel's sentences).
  const drillCache = useRef(new Map<string, ConjDrill>())
  const inFlight = useRef(new Map<string, Promise<ConjDrill>>())
  const [drill, setDrill] = useState<ConjDrill | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)

  // Volledige presente-tabel bij "spieken". Cache per infinitief (zoals drillCache), zodat herhaald
  // klikken niet opnieuw fetcht. `spied` = de gebruiker heeft voor het HUIDIGE item de vervoegingen
  // opgevraagd → dit item telt niet mee (geen grade in handleNext). Reset bij het volgende item.
  const tableCache = useRef(new Map<string, ConjTable>())
  const [table, setTable] = useState<ConjTable | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [tableError, setTableError] = useState<string | null>(null)
  const [spied, setSpied] = useState(false) // vóór nakijken opgevraagd → telt niet mee
  const [tableOpen, setTableOpen] = useState(false) // tabel zichtbaar (ook ná nakijken, dan als naslag)

  // Focus-sturing: tijdens antwoorden het invoerveld, daarna de Volgende-knop, zodat Enter
  // door de hele kaart heen consistent doorloopt (typen → nakijken → volgende).
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const nextBtnRef = useRef<HTMLButtonElement>(null)

  function showConjugations() {
    if (!currentWord || tableOpen) return
    const inf = currentWord.infinitive || currentWord.word
    // Vóór nakijken tellen: item telt niet mee. Ná nakijken: puur naslag, score blijft staan.
    if (!checked) setSpied(true)
    setTableOpen(true)
    const cached = tableCache.current.get(inf)
    if (cached) {
      setTable(cached)
      setTableLoading(false)
      setTableError(null)
      return
    }
    setTable(null)
    setTableLoading(true)
    setTableError(null)
    fetchConjugationTable(inf, variant)
      .then((t) => {
        tableCache.current.set(inf, t)
        setTable(t)
      })
      .catch((e) => setTableError(errMessage(e)))
      .finally(() => setTableLoading(false))
  }

  function getDrill(word: VocabWord, s: number): Promise<ConjDrill> {
    const ck = `${word.key}:${s}`
    const cached = drillCache.current.get(ck)
    if (cached) return Promise.resolve(cached)
    const pending = inFlight.current.get(ck)
    if (pending) return pending
    const tier = tierByKey.current.get(word.key) ?? 1
    const infinitive = word.infinitive || word.word
    const p = fetchConjugationDrill({ infinitive, tier, tense: 'presente', seed: s, variant })
      .then((r) => {
        drillCache.current.set(ck, r)
        return r
      })
      .finally(() => {
        inFlight.current.delete(ck)
      })
    inFlight.current.set(ck, p)
    return p
  }

  function startRound() {
    const round = buildVerbQueue(vocab, srs, settings.shuffleAll)
    // Tier per key vastzetten op basis van de huidige conj-box en de ingestelde drempels.
    const tiers = new Map<string, 1 | 2 | 3>()
    for (const key of round) {
      const box = srs[srsKeyFor(key, 'conj')]?.box ?? 0
      tiers.set(key, verbBoxToTier(box, settings.tier2Min, settings.tier3Min))
    }
    tierByKey.current = tiers
    setQueue(round)
    setRoundSeed((s) => s + 1)
    setDone(0)
    setWrong(0)
    setTotal(round.length)
    setFinished(false)
    setAnswer('')
    setChecked(false)
    setRevealed(false)
    setSpied(false)
    setTableOpen(false)
    setDrill(null)
    setTable(null)
    setTableError(null)
    setTableLoading(false)
    setError(null)
  }

  // Ronde starten bij mount.
  useEffect(() => {
    startRound()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Huidige kaart: de drill ophalen via getDrill (geen dubbele fetch bij lopende prefetch).
  useEffect(() => {
    if (!currentWord) return
    const ck = `${currentWord.key}:${seed}`
    const cached = drillCache.current.get(ck)
    if (cached) {
      setDrill(cached)
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setDrill(null)
    setLoading(true)
    setError(null)
    getDrill(currentWord, seed)
      .then((r) => !cancelled && setDrill(r))
      .catch((e) => !cancelled && setError(errMessage(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWord, seed, retryTick])

  // Prefetch: scan de wachtrij vanaf index 1, sla al-gecachete over, start de eerste
  // PREFETCH_AHEAD komende kaarten (fire-and-forget).
  useEffect(() => {
    let started = 0
    for (let i = 1; i < queue.length && started < PREFETCH_AHEAD; i++) {
      const w = wordByKey.get(queue[i])
      if (!w) continue
      const ck = `${w.key}:${seed}`
      if (drillCache.current.has(ck)) continue
      started++
      getDrill(w, seed).catch(() => {
        /* stil: de fout verschijnt vanzelf als deze kaart de huidige wordt */
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, seed, wordByKey])

  // Focus verplaatsen zodra de kaart van stand wisselt, zodat Enter altijd de juiste knop/veld
  // raakt: antwoorden → invoerveld; nagekeken of gespiekt → Volgende-knop.
  useEffect(() => {
    if (!drill) return
    if (checked || spied) {
      nextBtnRef.current?.focus()
    } else if (drill.tier === 3) {
      textareaRef.current?.focus()
    } else {
      inputRef.current?.focus()
    }
  }, [drill, checked, spied])

  function checkAnswer() {
    if (!drill || checked) return
    let correct: boolean
    // Een voorafgaand onderwerpsvoornaamwoord (tú/yo/…) mag: "tú pareces" telt als "pareces".
    if (drill.tier === 1) correct = stripSubjectPronoun(answer) === stripSubjectPronoun(drill.answer)
    else if (drill.tier === 2)
      correct = stripSubjectPronoun(answer) === stripSubjectPronoun(drill.blankAnswer)
    else correct = matchesExpected(answer, drill.expectedForms)
    setLastCorrect(correct)
    setChecked(true)
  }

  function handleNext() {
    if (!currentKey) return
    // Gespiekt item telt niet mee: geen grade (box ongewijzigd), gewoon afronden en uit de ronde —
    // NIET zoals bij "fout" verderop teruggezet. Anders: de normale goed/fout-logica.
    if (!spied) setSrs(grade(currentKey, lastCorrect, srs, 'conj'))
    setAnswer('')
    setChecked(false)
    setRevealed(false)
    setSpied(false)
    setTableOpen(false)
    setDrill(null)
    setTable(null)
    setTableError(null)
    setTableLoading(false)
    if (spied || lastCorrect) {
      const rest = queue.slice(1)
      setDone((d) => d + 1)
      setQueue(rest)
      if (rest.length === 0) setFinished(true)
    } else {
      setWrong((w) => w + 1)
      const [head, ...rest] = queue
      const insertAt = Math.min(3, rest.length)
      setQueue([...rest.slice(0, insertAt), head, ...rest.slice(insertAt)])
    }
  }

  const title = (
    <span className="practice-title">
      <span className="material-icons">repeat</span> Werkwoorden
    </span>
  )

  // ---- Lege wachtrij -------------------------------------------------------
  if (queue.length === 0 && !finished) {
    return (
      <div className="practice">
        <div className="practice-head">
          <button className="btn practice-back" onClick={onBack} aria-label="Terug" title="Terug">
            <span className="material-icons" aria-hidden="true">
              arrow_back
            </span>
          </button>
          {title}
        </div>
        <p className="practice-empty">
          Je hebt nog geen werkwoorden die je goed genoeg kent — leer ze eerst als woord.
        </p>
      </div>
    )
  }

  // ---- Einde ronde ---------------------------------------------------------
  if (finished) {
    return (
      <div className="practice">
        <div className="practice-head">
          <button className="btn practice-back" onClick={onBack} aria-label="Terug" title="Terug">
            <span className="material-icons" aria-hidden="true">
              arrow_back
            </span>
          </button>
          <span className="practice-title">Ronde klaar</span>
        </div>
        <div className="practice-summary">
          <p className="practice-summary-line">
            <span className="material-icons">celebration</span> Klaar! {total}{' '}
            {total === 1 ? 'werkwoord' : 'werkwoorden'} afgerond.
          </p>
          <p className="practice-summary-sub">
            {wrong === 0 ? 'Alles in één keer goed.' : `${wrong}× fout onderweg.`}
          </p>
          <div className="practice-summary-actions">
            <button className="btn help" onClick={startRound}>
              <span className="material-icons">replay</span> Opnieuw
            </button>
          </div>
        </div>
      </div>
    )
  }

  const infinitive = currentWord?.infinitive || currentWord?.word || '—'
  const sentenceParts = drill?.tier === 2 ? drill.sentence.split('___') : null

  // Het werkwoord als hoverbaar label — zelfde stijl als de woord-hover op de AI-zinnen
  // (.word + .tooltip): hover toont de NL-vertaling, klik toont de vervoegingen. Vóór nakijken telt
  // dat als spieken (item telt niet mee); ná nakijken is het puur naslag en blijft de score staan.
  const verbLabel = currentWord ? (
    <span className="word" lang="es" onClick={showConjugations}>
      {infinitive}
      <span className="tooltip">
        {currentWord.translation || '—'}
        {!tableOpen && <span className="tooltip-hint">klik: vervoegingen</span>}
      </span>
    </span>
  ) : null

  // Herbruikbaar tabel-blok (laden/fout/de 6 vormen) — gebruikt in de gespiekt- én de nagekeken-stand.
  const tableView = (
    <>
      {tableLoading && (
        <span className="practice-loading">
          <span className="spinner" aria-hidden="true" /> Vervoegingen ophalen…
        </span>
      )}
      {tableError && (
        <p className="practice-summary-line practice-wrong">
          <span className="material-icons">warning</span> Vervoegingen ophalen mislukt.
        </p>
      )}
      {table &&
        table.forms.map((f) => (
          <p className="practice-summary-sub" lang="es" key={f.person}>
            <strong>{f.person}</strong> — {f.form}
          </p>
        ))}
      {table && currentKey && (
        <div className="practice-summary-actions">
          <button
            className="sound-toggle"
            type="button"
            onClick={() => onFocusVerb(currentKey)}
            aria-label="Ram dit werkwoord"
            title="Ram dit werkwoord"
          >
            <span className="material-icons" aria-hidden="true">
              gavel
            </span>
          </button>
        </div>
      )}
    </>
  )

  return (
    <div className="practice">
      <div className="practice-head">
        <button className="btn practice-back" onClick={onBack} aria-label="Terug" title="Terug">
          <span className="material-icons" aria-hidden="true">
            arrow_back
          </span>
        </button>
        {title}
        <span className="practice-progress">
          {Math.min(done + 1, total)} / {total}
        </span>
      </div>

      <div className="practice-card">
        <div className="practice-card-face">
          {loading && (
            <span className="practice-loading">
              <span className="spinner" aria-hidden="true" /> Oefening maken…
            </span>
          )}
          {error && (
            <span className="practice-card-error">
              <span className="material-icons">warning</span> Oefening ophalen mislukt.
            </span>
          )}

          {!loading && !error && drill && (
            <>
              {/* Tier 1 — rijtjes dreunen: infinitief + gevraagde persoon. */}
              {drill.tier === 1 && (
                <span className="practice-front">
                  {verbLabel}
                  {' — '}
                  <strong>{drill.person}</strong>
                </span>
              )}

              {/* Tier 2 — cloze: zin met het gat. */}
              {drill.tier === 2 && sentenceParts && (
                <span className="practice-front" lang="es">
                  {sentenceParts[0]}
                  <strong>{'___'}</strong>
                  {sentenceParts.slice(1).join('___')}
                </span>
              )}

              {/* Tier 3 — vraag/antwoord: NL-vraag. */}
              {drill.tier === 3 && (
                <span className="practice-front">{drill.questionNl}</span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tier 2/3 tonen het werkwoord niet in de kaart → hier als hoverbaar label erbij. */}
      {!loading && !error && drill && drill.tier !== 1 && (
        <p className="practice-tip">werkwoord: {verbLabel}</p>
      )}

      {error && (
        <button className="btn practice-retry" onClick={() => setRetryTick((t) => t + 1)}>
          Opnieuw proberen
        </button>
      )}

      {!loading && !error && drill && (
        <>
          {/* ---- Stand 1: antwoorden ---- */}
          {!checked && !spied && (
            <>
              {drill.tier === 3 ? (
                <textarea
                  ref={textareaRef}
                  className="vocab-add-input"
                  lang="es"
                  placeholder="Typ je antwoord in het Spaans…"
                  value={answer}
                  rows={2}
                  onChange={(e) => setAnswer(e.target.value)}
                />
              ) : (
                <input
                  ref={inputRef}
                  className="vocab-add-input"
                  lang="es"
                  placeholder="Typ de vorm…"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      checkAnswer()
                    }
                  }}
                />
              )}

              {/* Reveal-hint (vertaling / modelantwoord) vóór het nakijken — icoon-only. */}
              {(drill.tier === 2 || drill.tier === 3) && !revealed && (
                <button
                  className="sound-toggle practice-reveal"
                  type="button"
                  onClick={() => setRevealed(true)}
                  aria-label={drill.tier === 2 ? 'Toon vertaling' : 'Toon antwoord'}
                  title={drill.tier === 2 ? 'Toon vertaling' : 'Toon antwoord'}
                >
                  <span className="material-icons" aria-hidden="true">
                    visibility
                  </span>
                </button>
              )}
              {revealed && drill.tier === 2 && <p className="practice-tip">{drill.translation}</p>}
              {revealed && drill.tier === 3 && (
                <div className="practice-summary">
                  <p className="practice-summary-line" lang="es">
                    {drill.modelAnswer}
                  </p>
                  <p className="practice-summary-sub">{drill.translation}</p>
                </div>
              )}

              <button
                className="sound-toggle"
                type="button"
                onClick={checkAnswer}
                aria-label="Nakijken"
                title="Nakijken (Enter)"
              >
                <span className="material-icons" aria-hidden="true">
                  done
                </span>
              </button>
            </>
          )}

          {/* ---- Stand 2: gespiekt vóór nakijken (telt niet mee) ---- */}
          {tableOpen && !checked && (
            <div className="practice-summary">
              {tableView}
              <p className="practice-tip">Telt niet mee.</p>
              <div className="practice-summary-actions">
                <button
                  ref={nextBtnRef}
                  className="sound-toggle"
                  type="button"
                  onClick={handleNext}
                  aria-label="Volgende"
                  title="Volgende (Enter)"
                >
                  <span className="material-icons" aria-hidden="true">
                    arrow_forward
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ---- Stand 3: nagekeken (uitslag) ---- */}
          {checked && (
            <div className="practice-summary">
              <p className={`practice-summary-line ${lastCorrect ? 'practice-right' : 'practice-wrong'}`}>
                <span className="material-icons">{lastCorrect ? 'check_circle' : 'cancel'}</span>
              </p>
              {drill.tier === 1 && (
                <p className="practice-summary-sub" lang="es">
                  <strong>{drill.answer}</strong> <SpeakButton text={drill.answer} />
                </p>
              )}
              {drill.tier === 2 && (
                <>
                  <p className="practice-summary-sub" lang="es">
                    <strong>{drill.blankAnswer}</strong> <SpeakButton text={drill.blankAnswer} />
                  </p>
                  <p className="practice-summary-sub">{drill.translation}</p>
                </>
              )}
              {drill.tier === 3 && (
                <>
                  <p className="practice-summary-sub" lang="es">
                    {drill.modelAnswer}
                  </p>
                  <p className="practice-summary-sub">{drill.translation}</p>
                </>
              )}
              {/* Klik op het werkwoord toont hier de volledige vervoeging als naslag (geen score-effect). */}
              {tableOpen && tableView}
              <div className="practice-summary-actions">
                <button
                  ref={nextBtnRef}
                  className="sound-toggle"
                  type="button"
                  onClick={handleNext}
                  aria-label="Volgende"
                  title="Volgende (Enter)"
                >
                  <span className="material-icons" aria-hidden="true">
                    arrow_forward
                  </span>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
