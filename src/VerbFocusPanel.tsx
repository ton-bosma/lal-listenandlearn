import { useEffect, useMemo, useRef, useState } from 'react'
import type { VocabWord } from './lib/vocab'
import { type ConjTable, fetchConjugationTable } from './lib/verbs'
import type { SpanishVariant } from './lib/storage'
import { speak } from './lib/tts'

// "Rammen": focus op één of meer gekozen werkwoorden en dril hun presente-vervoeging snel en
// herhaald. GEEN SRS — dit is los bijspijkeren, er wordt niets opgeslagen. De juiste vormen komen
// uit fetchConjugationTable (zelfde bron als VerbPanel's "spieken"-tabel).
//
// Opzet, bewust simpeler dan VerbPanel (geen tiers, geen seeds, geen backend-drill):
//  - bij mount alle tabellen parallel ophalen (in de gegeven volgorde), gefaalde werkwoorden slaan
//    we over; faalt álles → nette fout;
//  - wachtrij gegroepeerd per werkwoord: per werkwoord PASSES passes, elke pass de 6 personen
//    geschud (Fisher-Yates); blokken achter elkaar (eerst A, dan B, …);
//  - drillen: infinitief + persoon → typ de vorm; Enter = nakijken (accent-ongevoelig, een
//    voorafgaand onderwerpsvoornaamwoord mag). Goed → item weg; fout → item verderop terug BINNEN
//    hetzelfde werkwoord-blok, zodat je blijft rammen tot het zit.

/** Aantal keer dat elke persoon per werkwoord langskomt (tunebaar). */
const PASSES = 3

interface Props {
  vocab: VocabWord[]
  verbKeys: string[]
  /** Spaanse variant (LatAm/Spanje) — meegestuurd naar het conjugatie-endpoint. */
  variant: SpanishVariant
  onBack: () => void
}

/** Eén drilldoel: toon infinitief + persoon, verwacht `answer`. */
interface DrillItem {
  verbKey: string
  infinitive: string
  person: string
  answer: string
  /** Extra tussen-rep, getrokken uit de al-goede-personen-pool (telt niet als "echt" item mee). */
  isFiller?: boolean
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Onbekende fout.'
}

/** Fisher-Yates shuffle (op een kopie). */
function shuffle<T>(items: T[]): T[] {
  const arr = [...items]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
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

/** Haalt een optioneel voorafgaand onderwerpsvoornaamwoord weg ("tú hablas" → "hablas"). */
function stripSubjectPronoun(s: string): string {
  const parts = normalize(s).split(/\s+/).filter(Boolean)
  if (parts.length > 1 && SUBJECT_PRONOUNS.has(parts[0])) parts.shift()
  return parts.join(' ')
}

export default function VerbFocusPanel({ vocab, verbKeys, variant, onBack }: Props) {
  const [preparing, setPreparing] = useState(true)
  const [prepError, setPrepError] = useState<string | null>(null)

  const [queue, setQueue] = useState<DrillItem[]>([])
  const [done, setDone] = useState(0)
  const [total, setTotal] = useState(0)
  const [finished, setFinished] = useState(false)

  const [answer, setAnswer] = useState('')
  const [checked, setChecked] = useState(false)
  const [lastCorrect, setLastCorrect] = useState(false)

  // De bij mount opgehaalde presente-tabellen, bewaard per verbKey, zodat "klik op het werkwoord"
  // de 6 vormen direct uit het geheugen toont zonder opnieuw te fetchen.
  const tables = useRef(new Map<string, ConjTable>())
  const [showTable, setShowTable] = useState(false) // vervoegingen van het huidige item zichtbaar

  const wordByKey = useMemo(() => {
    const m = new Map<string, VocabWord>()
    for (const w of vocab) m.set(w.key, w)
    return m
  }, [vocab])

  // Per werkwoord: de al-correct afgeronde personen, als pool om filler-reps uit te trekken (zie
  // spreadBlock). Ref, want puur intern rammen-hulpmiddel — geen re-render nodig, niets opslaan.
  const correctPool = useRef(new Map<string, DrillItem[]>())

  // Focus-sturing (zelfde truc als VerbPanel): tijdens antwoorden het invoerveld, na nakijken de
  // Volgende-knop, zodat Enter door de hele kaart heen consistent doorloopt.
  const inputRef = useRef<HTMLInputElement>(null)
  const nextBtnRef = useRef<HTMLButtonElement>(null)

  // Voorbereiden bij mount: alle tabellen parallel ophalen, in volgorde de wachtrij bouwen.
  useEffect(() => {
    let cancelled = false
    setPreparing(true)
    setPrepError(null)

    const jobs = verbKeys.map((key) => {
      const w = wordByKey.get(key)
      if (!w) return Promise.resolve<{ key: string; infinitive: string; table: ConjTable } | null>(null)
      const infinitive = w.infinitive || w.word
      return fetchConjugationTable(infinitive, variant)
        .then((table) => ({ key, infinitive, table }))
        .catch(() => null) // gefaald werkwoord: overslaan
    })

    Promise.all(jobs)
      .then((results) => {
        if (cancelled) return
        const items: DrillItem[] = []
        for (const r of results) {
          if (!r) continue
          tables.current.set(r.key, r.table)
          for (let p = 0; p < PASSES; p++) {
            for (const f of shuffle(r.table.forms)) {
              items.push({ verbKey: r.key, infinitive: r.infinitive, person: f.person, answer: f.form })
            }
          }
        }
        if (items.length === 0) {
          setPrepError('Geen enkel werkwoord kon voorbereid worden.')
        } else {
          setQueue(items)
          setTotal(items.length)
        }
        setPreparing(false)
      })
      .catch((e) => {
        if (cancelled) return
        setPrepError(errMessage(e))
        setPreparing(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const current = queue[0] ?? null

  // Focus verplaatsen zodra de kaart van stand wisselt.
  useEffect(() => {
    if (preparing || finished || !current) return
    if (checked) nextBtnRef.current?.focus()
    else inputRef.current?.focus()
  }, [current, checked, preparing, finished])

  function checkAnswer() {
    if (!current || checked) return
    setLastCorrect(stripSubjectPronoun(answer) === stripSubjectPronoun(current.answer))
    setChecked(true)
  }

  /** Voegt een al-goede persoon toe aan de filler-pool van zijn werkwoord (dedup op persoon). */
  function addToPool(item: DrillItem) {
    const pool = correctPool.current.get(item.verbKey) ?? []
    if (!pool.some((it) => it.person === item.person)) {
      pool.push({
        verbKey: item.verbKey,
        infinitive: item.infinitive,
        person: item.person,
        answer: item.answer,
      })
      correctPool.current.set(item.verbKey, pool)
    }
  }

  /** Trekt (geschud) een al-goede persoon van dit werkwoord met een àndere persoon dan excludePerson. */
  function drawFiller(verbKey: string, excludePerson: string): DrillItem | null {
    const pool = correctPool.current.get(verbKey)
    if (!pool) return null
    const candidates = pool.filter((it) => it.person !== excludePerson)
    if (candidates.length === 0) return null
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    return { ...pick, isFiller: true }
  }

  // Spreidt de resterende items van één werkwoord-blok zó dat NOOIT twee keer dezelfde persoon
  // direct achter elkaar komt (ook niet vlak na de zojuist getoonde `justShownPerson`). Greedy:
  // pak steeds het eerste item met een andere persoon dan de vorige (behoudt grofweg de volgorde);
  // zit alles op dezelfde persoon vast (bv. alleen de foute persoon over), meng dan een al-goede
  // persoon van HETZELFDE werkwoord als tussen-rep erin. Blijft dus strikt binnen het blok.
  function spreadBlock(items: DrillItem[], justShownPerson: string, verbKey: string): DrillItem[] {
    const remaining = [...items]
    const result: DrillItem[] = []
    let prev = justShownPerson
    while (remaining.length > 0) {
      const idx = remaining.findIndex((it) => it.person !== prev)
      if (idx >= 0) {
        const [picked] = remaining.splice(idx, 1)
        result.push(picked)
        prev = picked.person
      } else {
        // Alles wat rest deelt dezelfde persoon → een filler (andere persoon) ertussen schuiven.
        const filler = drawFiller(verbKey, prev)
        if (filler) {
          result.push(filler)
          prev = filler.person
        } else {
          // Geen filler beschikbaar (nog geen andere goede persoon): best effort, rest erachter.
          result.push(...remaining)
          remaining.length = 0
        }
      }
    }
    return result
  }

  function handleNext() {
    if (!current) return
    const [head, ...rest] = queue
    setAnswer('')
    setChecked(false)
    setShowTable(false) // naslag is per item: verberg bij het volgende item/werkwoord

    // Het huidige werkwoord-blok = de leidende run in `rest` met dezelfde verbKey als head; alles
    // daarna is een volgend werkwoord en blijft onaangeroerd (geen lekken tussen werkwoorden).
    let blockEnd = 0
    while (blockEnd < rest.length && rest[blockEnd].verbKey === head.verbKey) blockEnd++
    const block = rest.slice(0, blockEnd)
    const after = rest.slice(blockEnd)

    if (lastCorrect) {
      // Echt item goed → uit de ronde en de persoon in de filler-pool. Fillers tellen niet mee.
      if (!head.isFiller) {
        setDone((d) => d + 1)
        addToPool(head)
      }
      const spread = spreadBlock(block, head.person, head.verbKey)
      const next = [...spread, ...after]
      setQueue(next)
      if (next.length === 0) setFinished(true)
    } else {
      // Fout → item terug in het blok, gespreid zodat het nooit direct herhaald wordt.
      const spread = spreadBlock([...block, head], head.person, head.verbKey)
      setQueue([...spread, ...after])
    }
  }

  const title = (
    <span className="practice-title">
      <span className="material-icons">gavel</span> Rammen
    </span>
  )

  const backButton = (
    <button className="btn practice-back" onClick={onBack} aria-label="Terug" title="Terug">
      <span className="material-icons" aria-hidden="true">
        arrow_back
      </span>
    </button>
  )

  // ---- Voorbereiden --------------------------------------------------------
  if (preparing) {
    return (
      <>
        <div className="app-shell-head practice-head">
          {backButton}
          {title}
        </div>
        <div className="app-shell-body">
          <div className="practice-card">
            <div className="practice-card-face">
              <span className="practice-loading">
                <span className="spinner" aria-hidden="true" /> Voorbereiden…
              </span>
            </div>
          </div>
        </div>
      </>
    )
  }

  // ---- Voorbereiden mislukt ------------------------------------------------
  if (prepError) {
    return (
      <>
        <div className="app-shell-head practice-head">
          {backButton}
          {title}
        </div>
        <div className="app-shell-body">
          <div className="practice-summary">
            <p className="practice-summary-line practice-wrong">
              <span className="material-icons">warning</span> Voorbereiden mislukt.
            </p>
            <p className="practice-summary-sub">{prepError}</p>
          </div>
        </div>
      </>
    )
  }

  // ---- Klaar ---------------------------------------------------------------
  if (finished) {
    return (
      <>
        <div className="app-shell-head practice-head">
          {backButton}
          <span className="practice-title">Klaar</span>
        </div>
        <div className="app-shell-body">
          <div className="practice-summary">
            <p className="practice-summary-line practice-right">
              <span className="material-icons">celebration</span> Gerammd!
            </p>
            <p className="practice-summary-sub">
              {total} {total === 1 ? 'vorm' : 'vormen'} afgewerkt.
            </p>
          </div>
        </div>
      </>
    )
  }

  // ---- Drillen -------------------------------------------------------------
  const currentTranslation = current ? wordByKey.get(current.verbKey)?.translation : ''
  const currentTable = current ? tables.current.get(current.verbKey) ?? null : null

  // Het werkwoord als klikbaar label — zelfde stijl als VerbPanel (.word + .tooltip): hover toont
  // de NL-vertaling, klik toont/verbergt de 6 vormen. Puur naslag: geen score-effect (geen SRS).
  const verbLabel = current ? (
    <span className="word" lang="es" onClick={() => setShowTable((v) => !v)}>
      {current.infinitive}
      <span className="tooltip">
        {currentTranslation || '—'}
        <span className="tooltip-hint">klik: vervoegingen</span>
      </span>
    </span>
  ) : null

  return (
    <>
      <div className="app-shell-head practice-head">
        {backButton}
        {title}
        <span className="practice-progress">
          {Math.min(done + 1, total)} / {total}
        </span>
      </div>

      <div className="app-shell-body">
        <div className="practice-card">
          <div className="practice-card-face">
            {current && (
              <span className="practice-front">
                {verbLabel}
                {' — '}
                <strong>{current.person}</strong>
              </span>
            )}
          </div>
        </div>

        {showTable && currentTable && (
          <div className="practice-summary">
            {currentTable.forms.map((f) => (
              <p className="practice-summary-sub" lang="es" key={f.person}>
                <strong>{f.person}</strong> — {f.form}
              </p>
            ))}
          </div>
        )}

        {current && !checked && (
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

        {current && checked && (
          <div className="practice-summary">
            <p className={`practice-summary-line ${lastCorrect ? 'practice-right' : 'practice-wrong'}`}>
              <span className="material-icons">{lastCorrect ? 'check_circle' : 'cancel'}</span>
            </p>
            <p className="practice-summary-sub" lang="es">
              <strong>{current.answer}</strong> <SpeakButton text={current.answer} />
            </p>
          </div>
        )}
      </div>

      <div className="app-shell-foot">
        <div className="action-bar">
          <div className="action-bar-left" />
          <div className="action-bar-right">
            {current && !checked && (
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
            )}

            {current && checked && (
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
            )}
          </div>
        </div>
      </div>
    </>
  )
}
