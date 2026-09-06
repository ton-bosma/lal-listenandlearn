# Handover — LAL: NAS-backend + woordenlijst (2026-09-06 10:44)

## Waar we mee bezig zijn
Taal-leer-app (Spaans→NL), boek zin-voor-zin met progressieve hulp. Deze sessie: (1) drie
inhoudelijke fixes/features aan de leesflow, (2) de **NAS-deploy backend gebouwd** (keys
server-side + gedeelde filesystem-cache) en de client daarop omgezet, (3) een **woordenlijst**
(markeren → flashcards later), server-side bewaard.

## Wat deze sessie af & werkend is (alles getest)
1. **Front-matter overslaan + hoofdstuktitel strippen** bij PDF-import.
   - `frontmatter.ts` → `detectBookStart()` roept `/api/book-start` (Gemini) aan; heuristische
     fallback in de client. Manolito: 1462→1456 zinnen (index 6), nep-colofon-hoofdstuk weg.
   - Titel-strip in `App.tsx` openBook: kop wordt van de start-zin gehaald ("El último mono
     Me llamo…" → "Me llamo…").
2. **AI-vertaling met context** (Gemini) — lost Google's "dangling zin"-dubbeling op.
   - Setting in ⚙ met 3 standen (`storage.ts` `AiTranslateMode`): **Uit** / **Als 2e keus**
     (klik op NL-zin → knop) / **Meteen** (1e keus, direct AI). Default uit. Faalt AI in
     "Meteen" → **⚠️ melding, geen terugval op Google** (bewust).
   - `aitranslate.ts` → `/api/ai-translate` (prev/current/next).
3. **Mute-knop** (🔊/🔇 in topbar) — alle spraak uit, korte melding "🔇 Geluid staat uit".
   `storage.ts` loadMuted/saveMuted.
4. **Backend + client-omzetting** (zie DEPLOY.md, volledig bijgewerkt):
   - `server/index.js` (Express): `/api/health`, `/api/translate`, `/api/explain`,
     `/api/ai-translate`, `/api/book-start`, `/api/tts`, `/api/voices`, `/api/vocab` (+ `/update`,
     `/delete`). Filesystem-cache per call in `CACHE_DIR` (dev: `./cache`, gitignored).
   - Client libs praten nu allemaal met `/api/*`; **geen VITE-keys/client-caches meer**.
     `gemini.ts` verwijderd. `health.ts` (nieuw) → features-gating i.p.v. key-checks.
   - `vite.config.ts`: alleen nog `/api`-proxy → `localhost:3001`.
   - `npm run dev` start Vite **én** backend samen (concurrently). Ook `dev:web`/`dev:api`/`start`.
5. **Woordenlijst** (`vocab.ts` + panel in `App.tsx`):
   - **Los woord markeren** = één klik op woord in de Spaanse zin (toggle, licht op, ook overal
     elders in de tekst). **Combinatie** (bijv. "por eso") = selecteren → knop **"📑 Bewaar"**
     naast "💡 Leg uit". **Vertaling bewerken** = klik op de vertaling in het paneel (Enter/
     klik-weg opslaan, Esc annuleer).
   - **📑-knop in topbar** (met telling) opent zijpaneel (dicht by default), 2 kolommen
     woord|vertaling, kruisje = verwijderen.
   - Server-side in **één gedeelde `vocab.json`** op het volume (persistente data, GEEN cache).
     Velden: key, word, translation, context, addedAt (klaar voor flashcards later).

## Onderhanden / status
- **Alles werkt en is getest.** Backend end-to-end via curl; UI in de browser (Manolito laden,
  front-matter, titel-strip, Google- vs AI-vertaling, mute) — behalve de allerlaatste twee
  (klik-markeren en vertaling-bewerken) die de user zelf heeft bevestigd (mijn Chrome-extensie
  zat op dat moment vast; de app werkte prima).
- De user heeft **12 echte woorden** in zijn `vocab.json` staan (niet aanraken).
- **NIETS is gecommit.** Hele sessie staat als werktree-wijziging (zie git hieronder).

## Openstaande beslissingen / TODO's
- **Docker** (laatste deploy-stap, nog NIET gebouwd): `Dockerfile` + `docker-compose.yml` —
  schetsen staan in `docs/DEPLOY.md`. Poort 8080, cache-volume `/volume1/docker/lal/cache`,
  env `GOOGLE_CLOUD_KEY` + `GEMINI_KEY`.
- **Woordenlijst per-profiel** (Ton vs. vrouw) — bewust uitgesteld; nu één gedeelde lijst.
- **Flashcard-oefenmodus** — velden liggen klaar, UI nog te bouwen.
- Bestaande grote TODO-lijst in `docs/STATUS.md` (uitspraak-check, vocabulaire vooraf, etc.).
- `bash.exe.stackdump` (untracked) is rommel → mag weg.

## Relevante context / valkuilen
- **Git**: branch `master`, laatste commit `97ae590`, niets gepusht deze sessie. Alle werk =
  werktree. Nieuwe files: `server/`, `src/lib/{aitranslate,frontmatter,health,vocab}.ts`,
  `docs/DEPLOY.md`. Push-workaround (gh ingelogd) staat in de vorige handover
  (`2026-08-24_1523_lal-nas-deploy.md`).
- **Dev draaien**: `HOME="$USERPROFILE" npm run dev`. Backend leest keys uit `.env` via
  `--env-file` en valt terug op de oude `VITE_*`-namen, dus `.env` hoeft niet aangepast.
  Backend = node zonder watch → **na een `server/index.js`-wijziging herstarten** (kill node +
  `npm run dev`). Vite/HMR pakt client-wijzigingen vanzelf.
- **Dev-server draait nu** (achtergrond-taak `bn61lvbri`), Vite :5173 + backend :3001.
- **Gemini**: model `gemini-flash-latest`, `maxOutputTokens: 2048` (thinking-tokens kapten
  anders af → leeg antwoord; ook bij de kleine book-start-call ruim budget nodig).
- **DeepL onderzocht, geparkeerd**: geen echte gratis tier meer (Developer = 1M eenmalig, daarna
  €23,80/mnd) + CORS verbiedt browser-calls (zou toch via backend moeten). Niet ingebouwd.
- **Auteursrecht**: app leest alleen legaal verkregen boeken (user's Manolito-PDF in Downloads
  voor testen). `*.pdf`/`*.epub` gitignored. Upload-tool mag alleen sessie-gedeelde files → PDF
  eerst naar scratchpad kopiëren om in de browser te testen.

## Volgende stap
Docker bouwen (`Dockerfile` + `docker-compose.yml`) volgens de schetsen in `docs/DEPLOY.md`,
daarna eventueel committen/pushen. Overweeg vóór commit: `bash.exe.stackdump` verwijderen.

## Documentatie (leidend — niet overtypen)
`docs/DEPLOY.md` (deploy-architectuur, endpoints, cache, beslissingen — volledig up-to-date),
`docs/SPEC.md`, `docs/STATUS.md` (groot TODO-blok), `README.md`.
