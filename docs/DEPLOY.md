# Deploy-plan: Docker op Synology NAS (met eigen backend + gedeelde cache)

Status: **IN AANBOUW.** Alle beslissingen zijn bevestigd (2026-08-25); de backend/Docker
worden nu in stappen gebouwd. Dit document is de leidende architectuur.

## Waarom een eigen backend

De app draait nu client-side: de browser roept Google rechtstreeks aan (via de Vite dev-proxy)
en houdt keys + caches lokaal. Voor de NAS-deploy met **twee gebruikers** willen we:

1. **Keys server-side** (niet in de client-bundle) — keuze "B".
2. **Gedeelde cache** van dure resultaten, zodat gebruiker 2 profiteert van wat gebruiker 1 al
   ophaalde, en niets opnieuw wordt betaald.
3. Die cache **op een gemount volume**, zodat hij rebuilds/herstarts overleeft.

Daarom komt er een kleine **Node-backend** die keys houdt, naar Google proxyt, en cachet.

## Wat wordt gecached (alle drie de dure calls)

| Endpoint            | Bron            | Cache-sleutel                                              | Opslag op volume              |
|---------------------|-----------------|-----------------------------------------------------------|-------------------------------|
| `/api/translate`    | Cloud Translate | `sha256("translate|es|nl|"+tekst)`                        | `translate/<hash>.txt` (NL)   |
| `/api/explain`      | Gemini          | `sha256("explain|"+model+"|"+zin+"|"+fragment)`           | `explain/<hash>.txt`          |
| `/api/ai-translate` | Gemini          | `sha256("aitranslate|"+model+"|"+prev+"|"+zin+"|"+next)`  | `aitranslate/<hash>.txt`      |
| `/api/book-start`   | Gemini          | `sha256("bookstart|"+model+"|"+eerste N zinnen)`          | `bookstart/<hash>.txt`        |
| `/api/tts`          | Cloud TTS       | `sha256("tts|"+voice+"|"+rate+"|"+tekst)`                 | `tts/<hash>.mp3`              |
| `/api/voices`       | Cloud TTS       | vaste sleutel                                              | `<hash>.txt` (verversbaar)    |

> `/api/ai-translate` = de AI-vertaling-met-context (Gemini). De buurzinnen (`prev`/`next`)
> horen in de sleutel: dezelfde zin kan elders andere context hebben en dus een andere vertaling.

- **Filesystem-cache** (geen DB-afhankelijkheid): tekst als bestand, audio als `.mp3`. Simpel,
  volume-vriendelijk. (Alternatief: SQLite voor de tekstresultaten — niet nodig voor de schaal.)
- Cache is **gedeeld** (niet per gebruiker) en **persistent** op het volume.
- Cache-hit = 0 API-calls; alleen misses gaan naar Google en worden dan opgeslagen.

## Onderdelen

### 1. Backend (`server/` — nieuw)

- **Node + Express** (Node 20+, heeft globale `fetch`; geen extra HTTP-lib nodig).
- Serveert (a) de statische Vite-build en (b) de `/api/*`-endpoints.
- Leest keys uit **env**: `GOOGLE_CLOUD_KEY` (Translate + TTS, zelfde Cloud-project) en
  `GEMINI_KEY`. Cache-map uit env: `CACHE_DIR` (default `/data/cache`).
- Endpoints:
  - `GET  /api/health` → `{ ok, features: { translate, tts, gemini } }` (welke keys gezet zijn).
  - `POST /api/translate { texts: string[] }` → `{ translations: string[] }` (batcht misses).
  - `POST /api/explain { sentence, fragment }` → `{ text }`.
  - `POST /api/ai-translate { prev, current, next }` → `{ text }` (Gemini-met-context).
  - `POST /api/book-start { sentences: string[] }` → `{ index }` (front-matter overslaan).
  - `POST /api/tts { text, voice, lang, rate }` → `audio/mpeg` (bytes), met cache-file.
  - `GET  /api/voices` → `{ voices: [...] }`.
  - `GET  /api/vocab` → `{ words: [...] }`; `POST /api/vocab { key, word, translation, context }`
    (dedupe op key); `POST /api/vocab/delete { key }`. **Persistente data, geen cache** —
    `vocab.json` op het volume, mag NIET mee-gewist worden. Eén gedeelde lijst voorlopig
    (per-profiel = latere uitbreiding).
- Elk endpoint: eerst cache lezen (volume), anders Google aanroepen met de server-key,
  antwoord op het volume schrijven, dan teruggeven.

### 2. Client-wijzigingen

- `src/lib/translate.ts`, `explain.ts`, `aitranslate.ts`, `cloudtts.ts` (+ de gedeelde
  `gemini.ts`): fetch-URL's van Google → **`/api/*`**; **keys en localStorage/IndexedDB-caches
  eruit** (de shared server-cache neemt dat over). Een lichte in-memory sessie-cache mag blijven
  voor directe herhaling.
- `import.meta.env.VITE_*`-keys zijn dan niet meer nodig in de client.
- `hasGeminiKey()` / `hasTranslateKey()` (nu op basis van `VITE_*`) → vervangen door een
  server-check (bijv. `GET /api/health` die zegt welke features beschikbaar zijn), zodat de UI
  nog steeds knoppen kan disablen als een key op de server ontbreekt.

### 3. Dev-modus

- De client roept altijd `/api/*` aan (dev én prod).
- In dev draait de backend lokaal (bijv. poort 3001); Vite-proxy stuurt `/api` → `localhost:3001`.
- Losse `.env` op de dev-machine met de keys (zoals nu, maar gelezen door de backend i.p.v. de
  client). `npm run dev` start dan zowel Vite als de backend (bijv. via een `dev`-script dat
  beide draait).

### 4. Dockerfile (multi-stage, schets)

```dockerfile
# 1) Build de Vite-app
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build            # -> dist/

# 2) Runtime: Node serveert dist + /api
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev        # alleen server-deps (express)
COPY server/ ./server/
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production CACHE_DIR=/data/cache PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
```

### 5. docker-compose.yml (schets)

```yaml
services:
  lal:
    build: .
    ports:
      - "8080:8080"
    env_file:
      - .env                 # GOOGLE_CLOUD_KEY, GEMINI_KEY  (op de NAS, niet in git)
    volumes:
      - /volume1/docker/lal/cache:/data/cache   # gedeelde cache op de NAS
    restart: unless-stopped
```

### 6. Synology (Container Manager)

1. Repo op de NAS zetten (of image elders bouwen en importeren).
2. **Container Manager → Project → Create**, kies de map met `docker-compose.yml`.
3. Maak de cache-map aan: `/volume1/docker/lal/cache`.
4. Leg `.env` naast de compose met `GOOGLE_CLOUD_KEY` en `GEMINI_KEY`.
5. Build & run. App bereikbaar op `http://<nas-ip>:8080`.
6. (Later) HTTPS via de Synology reverse proxy zodra mic-features (uitspraak) komen.

## Wat lokaal (per gebruiker/apparaat) blijft

Voortgang (huidige zin), stemkeuze, snelheid, en het ingeladen boek — allemaal in de browser,
dus per apparaat gescheiden. Eigen apparaten → eigen voortgang, zoals afgesproken.

## Beslissingen (vastgelegd — bevestigd 2026-08-25)

- Keys **server-side via env** (keuze B). Niet in de client, niet in de image gebakken.
- Env-namen: **`GOOGLE_CLOUD_KEY`** (Translate + TTS) en **`GEMINI_KEY`**.
- Cache **gedeeld** en op een **gemount NAS-volume** (overleeft rebuilds).
- Cache-vorm: **losse bestanden** op het volume (tekst `.txt`, audio `.mp3`). Geen SQLite.
- Cache dekt **translate + explain + ai-translate (Gemini) + tts** — alle dure calls.
- **Poort `8080`** (host + container); NAS-cachepad **`/volume1/docker/lal/cache`**.
- Backend serveert ook de statische app (geen aparte nginx nodig; kan later alsnog).
- Boeken/voortgang **niet** serverside gesynct (bewust; eigen apparaten).

## Dev-orchestratie

- De client roept **altijd** `/api/*` aan (dev én prod). In dev proxyt Vite `/api` →
  `http://localhost:3001` (de lokale backend).
- `npm run dev` start **Vite én de backend** samen (via `concurrently`). De backend leest de
  keys uit de bestaande `.env` op de dev-machine (niet meer de client).
- Losse scripts blijven mogelijk: `npm run dev:web` (Vite) en `npm run dev:api` (backend).
