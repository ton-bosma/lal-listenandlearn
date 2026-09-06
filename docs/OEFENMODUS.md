# Plan — Oefenmodus (flashcards vanuit de woordenlijst)

Status: **ontwerp vastgelegd, nog niet gebouwd** (2026-09-06). Afgestemd met de user; dit is de
v1-scope. Grotere brainstorm (SRS, matching, dekkings-%, front-loading) staat in
`docs/STATUS.md` onder "TODO / nice-to-have".

## Doel & scope (v1)

Vanuit het 📑-woordenlijst-paneel een **oefenmodus** starten en daar **flashcards** oefenen op
basis van de opgeslagen woorden. Focus **Spaans → Nederlands** (receptief, om boeken te kunnen
lezen; de productiekant NL→ES komt later). Twee oefeningen, **apart te kiezen, niet door elkaar**.
Beide delen dezelfde **flip + zelf-beoordelen**-flow met **lichte spaced repetition**.

### A. AI-voorbeeldzin (hoofdwens)
- Voorkant: een **verse Spaanse zin** die de AI maakt met het woord, **bewust variërend in
  persoon/tijd** (traint de werkwoord-uitgangen — het pijnpunt van de user).
- Omdraaien → de **NL-vertaling** van die zin.
- **Goed / Fout** → stuurt de SRS.
- Nodig: backend-call die per woord `{ sentence, translation }` teruggeeft.

### B. Woord-flashcard (simpele basis)
- Voorkant: het **Spaanse woord** (blind).
- Omdraaien → **NL-vertaling + de bronzin** (context, `word.context`).
- **Goed / Fout** → SRS.
- Puur client-side, geen backend.

### Gedeeld
- Flip + zelf-beoordelen (geen AI-beoordeling van getypte antwoorden in v1).
- **Lichte SRS** (Leitner-achtig): Fout → snel terug in de ronde + box 0; Goed → box +1, dit
  rondje klaar. Stand **lokaal** bewaard (localStorage, per apparaat).
- Per ronde de **hele lijst** in willekeurige volgorde (later begrensbaar tot bijv. 10).

### Buiten scope v1 (later, zie STATUS.md)
Matching-spel, cloze/invuller, meerkeuze, NL→ES produceren, AI-beoordeling van vrije antwoorden,
tijd-gebaseerde SRS-planning, dekkings-% / bekende-woorden.

## Implementatie

### 1. SRS + rondes — `src/lib/practice.ts` (nieuw)
- localStorage `spaanleren.srs.v1`: `{ [key]: { box: number } }` (Leitner-box per woord-key).
- Helpers:
  - `loadSrs()/saveSrs()`.
  - `buildRound(words): key[]` — sorteer op box (laag eerst), shuffle binnen gelijke box.
  - `grade(key, correct)` — Goed → box+1 (max N), Fout → box 0; persist.
  - In-ronde: bij Fout de kaart **verderop opnieuw** in de wachtrij zetten (snel terug).
- `fetchPracticeSentence(word, translation, seed)` → POST `/api/practice-sentence`.

### 2. Backend — `server/index.js`: `POST /api/practice-sentence`
- Input `{ word, translation, seed? }`. Output `{ sentence, translation }` (Spaanse zin met het
  woord in een **wisselende** persoon/tijd + NL-vertaling).
- Prompt: één natuurlijke Spaanse zin op leer-niveau met het woord; varieer de werkwoordsvorm;
  geef JSON `{ "sentence": "...", "translation": "..." }`. Niet te lang. Ruim `maxOutputTokens`
  (thinking-tokens; zie de segment/explain-calls, 4096–8192).
- Cache-key incl. `seed`, zodat je per woord meerdere (reproduceerbare) varianten krijgt en niet
  telkens dezelfde zin ziet. `PRACTICE_PROMPT_VERSION` als cache-buster.
- Zelfde key/cache/foutstijl als de andere Gemini-endpoints.

### 3. UI — nieuwe component `src/PracticePanel.tsx` (App.tsx is al groot)
- Props: `vocab: VocabWord[]`, `onClose()`, `features` (voor Gemini-gating van oefening A).
- Views (interne state): `'menu' | 'flashcard' | 'aisentence'`, met **terugknop** naar het menu
  en (vanuit het menu) terug naar de lijst.
- Kaart: voorkant/achterkant, klik = omdraaien; na omdraaien **Goed / Fout**-knoppen.
- Voortgang: "X / N", einde-ronde-samenvatting (goed/fout, opnieuw / klaar).
- Oefening A: bij een nieuwe kaart `fetchPracticeSentence` (met spinner); cache client-side per
  (key, seed) zodat terugbladeren niet opnieuw haalt.

### 4. Inhaken in het paneel — `src/App.tsx`
- In het 📑-paneel bovenaan een knop **"Oefenen"** (naast/boven de lijst) → toont `PracticePanel`
  i.p.v. de lijst; de terugknop van het panel keert terug naar de lijst.
- Simpelste koppeling: een state `practiceOpen` in App; `vocabOpen`-paneel rendert of de lijst óf
  `<PracticePanel vocab={vocab} .../>`.

### 5. Styling — `src/index.css`
- Kaart (flip), Goed/Fout-knoppen, oefen-menu, terugknop, voortgang. Thema-tokens hergebruiken.

## Aandachtspunten
- **Variëteit vs. cache** (oefening A): cache per `(word, seed)` en roteer de seed per keer dat
  een woord terugkomt, zodat je verschillende zinnen ziet maar het reproduceerbaar/gecachet blijft.
- **Gemini-gating**: oefening A verbergen/disemabelen als `!features.gemini` (zoals AI-vertaling).
- **Lege lijst**: nette melding als er nog geen woorden zijn.
- **Backend herstarten** na `server/index.js`-wijziging (node zonder watch).
- Woordenlijst is server-side gedeeld; SRS-stand bewust **lokaal** (per apparaat) in v1.
