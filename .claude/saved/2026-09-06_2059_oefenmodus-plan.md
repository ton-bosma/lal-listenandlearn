# Handover — AI-knipper + vocab + uitleg-chat, en plan oefenmodus (2026-09-06 20:59)

## Waar we mee bezig zijn
Taal-leer-app LAL (Spaans→NL), boek zin-voor-zin. Deze sessie: een **AI-knipper** (voortschrijdend
per chunk), **woordenlijst-uitbreiding**, een **AI-uitleg-chat**, en tot slot een **plan voor een
oefenmodus** (flashcards vanuit de woordenlijst) dat vastligt in `docs/OEFENMODUS.md`.

## Deze sessie af & werkend (getest via curl + UI)
1. **AI-knipper (voortschrijdend, achter setting "Knippen (bij import)")** — deterministisch chunken
   bij import (`src/lib/chunk.ts`, cap ~800, harde breuk per hoofdstuk), dan **per chunk** door de AI
   opschonen + knippen (`/api/segment`, v3). Venster-navigatie + lazy laden in `src/lib/reader.ts`
   (`useReader`-hook). Deterministische modus blijft intact.
   - **story-start** (`/api/story-start`, v2): éénmalig, generiek, over de opening; slaat alleen
     boilerplate over (titelpagina/colofon/ISBN/inhoudsopgave), behoudt voorwoord/proloog/intro.
     Gecachet op `book.storyStart`.
   - **Secties progressief**: `/api/segment` geeft `{ units, section? }`; ontdekte secties
     (`{title, chunk, unit, generated}`) vullen de hoofdstuk-dropdown terwijl je leest (`✦` = AI-label).
   - **next-chunk als context** meegestuurd; **prefetch 1 vooruit** getriggerd op de (voor)laatste
     eenheid; **in-flight dedup** in `segmentChunk`. Spinner "AI-knipper is bezig…".
   - Gemini `maxOutputTokens` per call ophoogbaar (segment 8192, explain-chat 4096) — 2048 kapte
     JSON af door thinking-tokens.
2. **Woordenlijst**: woord is nu **klikbaar/bewerkbaar** (zoals de vertaling); **opschoning bij
   toevoegen** (`cleanWord` in `src/lib/words.ts`: lowercase, leestekens weg, **afkortingen houden
   punten**). Sleutel/oplichten via `normalizeWord` dat hoofdletters/punten/apostrofs negeert; bij
   woord-bewerken wordt de key herberekend (server `/api/vocab/update` doet rename+dedup).
3. **AI-uitleg → multi-turn chat**: uitleg-box is een thread met "Vraag verder…"-veld
   (`/api/explain` met `history`+`question`, helper `geminiChat`). **Reset bij zin-wissel**.
   Antwoorden als **HTML gerenderd** via `src/lib/markdown.ts` (veilige subset, escaped).
4. **Tokenizer-fix**: losse getallen (jaartal "40") vielen uit de weergave — `tokenize` matcht nu
   ook tokens die met een cijfer beginnen.

## Onderhanden / status
- **Oefenmodus: alleen plan, nog niet gebouwd.** Volledig ontwerp in **`docs/OEFENMODUS.md`**.
  Kern v1 (afgestemd): oefen-view in het 📑-paneel (knop "Oefenen" + terugknop), **twee flashcard-
  oefeningen apart te kiezen (niet door elkaar)**, focus **Spaans→NL**, flip + zelf-beoordelen,
  **lichte SRS** (localStorage):
  - **A. AI-voorbeeldzin (hoofdwens)** — AI maakt een verse Spaanse zin met het woord, **variërend
    in persoon/tijd** (traint werkwoord-uitgangen), omdraaien → NL-vertaling → Goed/Fout. Nieuwe
    backend-call `/api/practice-sentence` → `{ sentence, translation }`, gecachet per (woord, seed).
  - **B. Woord-flashcard** — Spaans woord → omdraaien → NL + bronzin → Goed/Fout. Client-only.
- **NIETS is gecommit** deze sessie — alles staat als werktree-wijziging.

## Openstaande beslissingen / todo's
- Oefenmodus bouwen volgens `docs/OEFENMODUS.md` (nieuw: `src/lib/practice.ts`,
  `src/PracticePanel.tsx`, `/api/practice-sentence`, styling, inhaken in `App.tsx`).
- Later (buiten v1, zie `docs/STATUS.md`): matching, cloze, meerkeuze, NL→ES produceren,
  AI-beoordeling van vrije antwoorden, tijd-gebaseerde SRS, dekkings-%.
- **Docker** (deploy) staat nog steeds open — schetsen in `docs/DEPLOY.md`.
- Nog niets gecommit deze hele sessie → overweeg committen vóór de volgende grote stap.

## Relevante context / valkuilen
- **Git**: branch `master`, laatste commit `97ae590`; deze sessie = allemaal werktree, niets gepusht.
  Push-workaround (gh ingelogd) in de vorige handover (`2026-08-24_1523_lal-nas-deploy.md`).
- **Dev draaien**: `HOME="$USERPROFILE" npm run dev` (Vite :5173 + backend :3001, concurrently -k).
  Backend = node **zonder watch** → na een `server/index.js`-wijziging **killen + opnieuw** starten;
  client pakt Vite/HMR vanzelf. Dev-stack draait nu (achtergrond-taak `b9jxyl4uy`).
- Server-endpoints hebben prompt-**versieconstanten** als cache-buster (SEGMENT_PROMPT_VERSION=3,
  STORY_START_PROMPT_VERSION=2). Nieuwe AI-features: bouw via een background-agent op `server/index.js`
  (raakt geen client-bestanden → geen conflict).
- **AI-boek herbouwen** vereist opnieuw importeren (units/story-start worden vers berekend).
- Woordenlijst is server-side gedeeld (`vocab.json`, 12 echte woorden — niet weggooien);
  SRS-stand bewust **lokaal** per apparaat.

## Volgende stap
De oefenmodus (v1) bouwen volgens `docs/OEFENMODUS.md`, te beginnen bij `src/lib/practice.ts` +
`/api/practice-sentence`, dan `src/PracticePanel.tsx` en de knop "Oefenen" in het 📑-paneel.

## Documentatie (leidend — niet overtypen)
`docs/OEFENMODUS.md` (plan oefenmodus), `docs/DEPLOY.md` (deploy/endpoints/cache), `docs/SPEC.md`,
`docs/STATUS.md` (grote brainstorm/TODO), `README.md`, `CLAUDE.md` (werkwijze-afspraken).
