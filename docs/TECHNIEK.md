# Techniek — huidige staat

Technisch overzicht van LAL zoals de code nu draait: hoe je 'm start, welke backend-endpoints er
zijn met hun contract, de cache en versie-constanten, de opslag, en de belangrijkste bestanden.
Voor de architectuur-/deploy-achtergrond zie [DEPLOY.md](DEPLOY.md); dit document beschrijft de
feitelijke huidige implementatie (en corrigeert DEPLOY.md waar de code afwijkt — zie onderaan).

## Stack

- **Frontend**: React 18 + TypeScript + Vite. PDF-extractie via `pdfjs-dist`, EPUB via `jszip`.
- **Backend**: Node + Express (`server/index.js`), zonder extra HTTP-lib (globale `fetch`).
  Houdt de API-keys server-side, proxyt naar Google (Cloud Translate, Cloud TTS, Gemini) en
  cachet dure resultaten op schijf.
- De client praat **uitsluitend** met de eigen backend via `/api/*`; er wordt niet rechtstreeks
  vanuit de browser naar Google gebeld.

## Draaien (dev)

```bash
# Windows: HOME wijst naar een netwerkschijf, daarom expliciet:
HOME="$USERPROFILE" npm install     # eenmalig
HOME="$USERPROFILE" npm run dev     # Vite + backend samen
HOME="$USERPROFILE" npm run build   # tsc -b + vite build (productie-build met typecheck)
```

`npm run dev` start via `concurrently -k` twee processen:

- **`dev:web`** = `vite` → dev-server op **:5173**.
- **`dev:api`** = `node --env-file=.env server/index.js` → backend op **:3001**.

Vite proxyt `/api` → `http://localhost:3001` (zie `vite.config.ts`). De backend leest de keys uit
`.env`. De backend draait **zonder watch** (gewone `node`), dus na een wijziging in `server/`
moet je hem herstarten.

Andere scripts: `npm run dev:web` / `npm run dev:api` (los), `npm start`
(`node server/index.js`, prod), `npm run preview` (Vite preview).

## Config (env)

Gelezen in `server/index.js`:

- **`GOOGLE_CLOUD_KEY`** (fallback: `VITE_GOOGLE_TRANSLATE_KEY`) — Cloud Translate + Cloud TTS.
- **`GEMINI_KEY`** (fallback: `VITE_GEMINI_KEY`) — Gemini.
- **`CACHE_DIR`** — cache-map (default `<repo>/cache`).
- **`PORT`** — default `3001`.

Vaste constanten: `GEMINI_MODEL = 'gemini-flash-latest'`, `GEMINI_MAX_TOKENS = 2048`
(sommige endpoints vragen ruimer aan, zie hieronder), `BOOK_START_WINDOW = 20`.

## Backend-endpoints

Alle onder `/api`. Body = JSON (limiet 256 kB). Fout-antwoorden: `503` als de vereiste key
ontbreekt, `400` bij ongeldige input, `502` bij een fout van Google/Gemini of ongeldige AI-output.

| Endpoint | Methode | Input | Output | Key | Cache |
|---|---|---|---|---|---|
| `/api/health` | GET | — | `{ ok, features: { translate, tts, gemini } }` | — | nee |
| `/api/translate` | POST | `{ texts: string[] }` | `{ translations: string[] }` | Google | ja (per tekst) |
| `/api/chat` | POST | `{ context?, history?, question? }` | `{ text }` | Gemini | deels (zie hieronder) |
| `/api/ai-translate` | POST | `{ current, prev?, next? }` | `{ text }` | Gemini | ja |
| `/api/practice-sentence` | POST | `{ word, translation?, seed? }` | `{ sentence, translation }` | Gemini | ja |
| `/api/add-word` | POST | `{ text, direction? }` | `{ word, translation, context, detected }` | Gemini | ja |
| `/api/book-start` | POST | `{ sentences: string[] }` | `{ index }` | Gemini | ja |
| `/api/story-start` | POST | `{ chunks: string[] }` | `{ index }` | Gemini | ja |
| `/api/segment` | POST | `{ text, next? }` | `{ units: string[], section? }` | Gemini | ja |
| `/api/tts` | POST | `{ text, voice, lang, rate }` | `audio/mpeg` (mp3-bytes) | Google | ja (mp3) |
| `/api/voices` | GET | — | `{ voices: [{ name, lang, gender }] }` | Google | ja (1 bestand) |
| `/api/vocab` | GET | — | `{ words: [...] }` | — | n.v.t. (persistent) |
| `/api/vocab` | POST | `{ key, word, translation?, context? }` | `{ words: [...] }` | — | n.v.t. (persistent) |
| `/api/vocab/update` | POST | `{ key, translation?, word?, newKey? }` | `{ words: [...] }` | — | n.v.t. (persistent) |
| `/api/vocab/delete` | POST | `{ key }` | `{ words: [...] }` | — | n.v.t. (persistent) |

Details per endpoint:

- **`/api/chat`** — drie gevallen op één contract:
  - alleen `context` (`{ fragment, sentence }`), geen `history`/`question` → **initiële
    fragment-uitleg** (structuur Natuurlijk/Letterlijk/Uitleg), **gecachet**.
  - `question` (met optionele `history` en `context`) → **vrije chatvraag** (multi-turn),
    **niet gecachet** (aangevraagd met max 4096 tokens).
- **`/api/ai-translate`** — vertaalt alleen `current`, met `prev`/`next` als context; geeft de
  kale doelzin terug (aanhalingstekens gestript).
- **`/api/practice-sentence`** — `seed` stuurt de variatie (persoon/tijd); temperatuur 0.8,
  budget 4096 tokens. Verwacht geldig JSON van Gemini.
- **`/api/add-word`** — `direction` ∈ `auto` | `nl2es` | `es2nl` (overig → `auto`). Woord is
  altijd Spaans, vertaling altijd Nederlands; `detected` zegt welke richting gebruikt is.
- **`/api/book-start`** — kijkt naar de eerste `BOOK_START_WINDOW` (20) zinnen; geeft de index
  van de eerste verhaalzin (of 0). Temperatuur 0.
- **`/api/story-start`** — chunk-variant van book-start voor de AI-modus; geeft de chunk-index
  waar het verhaal begint. Temperatuur 0.
- **`/api/segment`** — schoont een ruwe chunk op en knipt in leer-eenheden; `section` alleen als
  de chunk een nieuwe sectie start. Budget 8192 tokens (een chunk levert meerdere eenheden op).

## Cache & versie-constanten

**Filesystem-cache** (geen DB): dure resultaten worden op `CACHE_DIR` bewaard, gedeeld tussen
gebruikers en persistent over herstarts. Sleutel = `sha256(<sleutelstring>)`, opgeslagen als
`<subdir>/<hash>.txt` (tekst) of `.mp3` (audio). Cache-hit = 0 API-calls; alleen misses gaan naar
Google/Gemini en worden dan weggeschreven. Schrijven is best-effort (faalt stil).

Subdirs en sleutelstrings:

| Subdir | Sleutelstring |
|---|---|
| `translate/` | `translate\|es\|nl\|<tekst>` (per unieke tekst) |
| `chat/` | `chat\|<model>\|<CHAT_PROMPT_VERSION>\|<zin>\|<fragment>` (alleen de initiële uitleg) |
| `aitranslate/` | `aitranslate\|<model>\|<prev>\|<current>\|<next>` |
| `practice/` | `practice\|<model>\|<PRACTICE_PROMPT_VERSION>\|<word>\|<translation>\|<seed>` |
| `addword/` | `addword\|<model>\|<ADDWORD_PROMPT_VERSION>\|<dir>\|<genormaliseerde tekst>` |
| `bookstart/` | `bookstart\|<model>\|<eerste 20 zinnen>` |
| `storystart/` | `storystart\|<model>\|<STORY_START_PROMPT_VERSION>\|<chunks>` |
| `segment/` | `segment\|<model>\|<SEGMENT_PROMPT_VERSION>\|<text>␞<next>` |
| `tts/` | `tts\|<voice>\|<rate>\|<tekst>` → `.mp3` |
| (root) | `voices` → `voices.json` (verversbaar door het bestand te wissen) |

**Prompt-versie-constanten** (cache-buster: ophogen invalideert de betreffende cache omdat de
sleutel verandert):

- `SEGMENT_PROMPT_VERSION = 3`
- `STORY_START_PROMPT_VERSION = 2`
- `PRACTICE_PROMPT_VERSION = 1`
- `ADDWORD_PROMPT_VERSION = 1`
- `CHAT_PROMPT_VERSION = 1`

Let op: `translate`, `aitranslate`, `bookstart`, `tts` en `voices` hebben **geen** versie in hun
sleutel (alleen het model waar van toepassing).

De client houdt daarnaast een lichte **in-memory sessie-cache** per lib (`translate.ts`,
`aitranslate.ts`, `explain.ts`, `cloudtts.ts`) voor directe herhaling binnen één sessie. De
AI-knipper (`aisegment.ts`) en de oefenzin-fetch (`PracticePanel.tsx`) hebben in-flight-dedup zodat
prefetch en de directe fetch niet dubbel dezelfde call doen.

## Opslag

**Server-side woordenlijst** — persistente data, **geen cache** (mag niet mee-gewist worden).
Bestand: `<CACHE_DIR>/vocab.json`, vorm `{ words: [{ key, word, translation, context, addedAt }] }`.
Eén gedeelde lijst. `POST /api/vocab` dedupliceert op `key`; `/api/vocab/update` kan de key
hernoemen (`newKey`) en dedupliceert dan.

**Lokaal (localStorage, per apparaat)** — sleutels:

- `spaanleren.progress.v1` — leespositie (`index`, of `chunk`+`unit` in AI-modus).
- `spaanleren.book.v1` — het ingeladen boek (incl. de sparse AI-eenheden-cache).
- `spaanleren.srs.v1` — de SRS-stand van de oefenmodus (`{ <key>: { box } }`).
- `spaanleren.voiceURI.v1` — de gekozen stem (`''` = auto, `browser:<uri>`, of `cloud:<name>:<lang>`).
- `spaanleren.aiTranslateEnabled.v1` — AI-vertaling-modus (`off` | `second` | `first`;
  migreert `'1'` → `second`).
- `spaanleren.muted.v1` — mute (`'1'`/`'0'`).
- `spaanleren.segmentMode.v1` — knip-modus voor import (`deterministic` | `ai`).

## Productie

Bestaat er een `dist/` (Vite-build), dan serveert de backend die statisch plus een
`GET *`-fallback naar `index.html`; in dev bestaat `dist/` niet en serveert Vite zelf. Voor de
Docker/Synology-deploy (poort 8080, gedeelde cache op een NAS-volume) zie [DEPLOY.md](DEPLOY.md).

## Architectuur kort (belangrijkste bestanden)

Frontend (`src/`):

- `App.tsx` — hoofdscherm: lezer, reveal-niveaus, schermmodel, instellingen, mute, alle
  UI-orkestratie.
- `PracticePanel.tsx` — oefenmodus (AI-voorbeeldzin + woord-flashcard).
- `ChatPanel.tsx` — full-screen chat (vrije chat + vervolg vanuit uitleg).
- `lib/reader.ts` — leesbron achter één interface (deterministisch + voortschrijdende AI-modus).
- `lib/storage.ts` — boek-model + alle localStorage (boek, voortgang, instellingen).
- `lib/sentences.ts` — opschonen + zinnen splitsen (`Intl.Segmenter`), paginamarkers.
- `lib/chunk.ts` — deterministische chunker voor de AI-knipper.
- `lib/aisegment.ts` — client van de AI-knipper (`/api/segment`, `/api/story-start`).
- `lib/frontmatter.ts` — front-matter overslaan (`/api/book-start` + heuristische fallback).
- `lib/pdf.ts` / `lib/epub.ts` — tekst + hoofdstukken extraheren.
- `lib/words.ts` — tokeniseren + woord-normalisatie voor hovers/keys.
- `lib/translate.ts` — Google-vertaling (zin + woord-glosses) via `/api/translate`.
- `lib/aitranslate.ts` — AI-vertaling met context via `/api/ai-translate`.
- `lib/explain.ts` — uitleg + chat via `/api/chat`.
- `lib/addword.ts` — AI-woordvoorstel via `/api/add-word`.
- `lib/vocab.ts` — woordenlijst-client (`/api/vocab*`).
- `lib/practice.ts` — Leitner-SRS + oefenzin-fetch (`/api/practice-sentence`).
- `lib/tts.ts` — voorlezen (browser + Cloud, één ingang).
- `lib/cloudtts.ts` — Cloud TTS-client (`/api/tts`, `/api/voices`).
- `lib/health.ts` — feature-detectie (`/api/health`).
- `lib/markdown.ts` — veilige Markdown→HTML-subset voor uitleg/chat.
- `data/demoText.ts` — ingebouwde demotekst.

Backend:

- `server/index.js` — Express-app: alle `/api/*`-endpoints, filesystem-cache, woordenlijst,
  statische serving van `dist/`.

## Afwijkingen t.o.v. DEPLOY.md

DEPLOY.md is de architectuur-schets ("in aanbouw") en loopt op enkele punten achter op de code:

- **`/api/explain` bestaat niet (meer).** De uitleg loopt via `/api/chat` (initiële uitleg =
  context zonder vraag, gecachet in `chat/` met `CHAT_PROMPT_VERSION`). DEPLOY.md noemt nog een
  apart `/api/explain` met een `explain/`-cache.
- **Nieuwere endpoints ontbreken in DEPLOY.md**: `/api/story-start`, `/api/segment`,
  `/api/practice-sentence`, `/api/add-word` en `/api/vocab/update`.
- **`/api/book-start`** bestaat nog (deterministische modus); daarnaast is er `/api/story-start`
  voor de AI-modus.
- De cache-sleutels in DEPLOY.md (bijv. voor explain) komen niet overeen met de huidige
  sleutelstrings hierboven; deze tabel is leidend voor de code.
