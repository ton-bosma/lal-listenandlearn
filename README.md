# LAL — Listen And Learn

Een taal-leer-app om een boek **zin voor zin** door te lopen met progressieve hulp die je zelf
inroept: eerst luisteren, dan de Spaanse tekst, dan woord-hovers, dan de volledige vertaling, en
een AI-uitleg van een geselecteerd tekstdeel. Daarnaast een oefenmodus (flashcards met een lichte
SRS), een woordenlijst en een chat met een AI-tutor.

De mechaniek is taal-onafhankelijk; nu ingericht voor **Spaans → Nederlands**.

- **React + Vite + TypeScript** frontend, **Node + Express** backend.
- Vertalen, uitleg/chat en (optioneel) natuurlijke stemmen lopen via Google (Cloud Translate,
  Gemini, Cloud TTS). De keys staan server-side; de client praat alleen met de eigen backend.
  Zonder keys werkt de app met de gratis browser-stem en zijn de AI-functies uitgeschakeld.

## Snel starten (dev)

```bash
# Windows: HOME wijst naar een netwerkschijf, daarom expliciet:
HOME="$USERPROFILE" npm install     # eenmalig
HOME="$USERPROFILE" npm run dev     # Vite (:5173) + backend (:3001) samen
HOME="$USERPROFILE" npm run build   # productie-build + typecheck
```

(In een gewone shell zonder de HOME-workaround volstaat `npm install` / `npm run dev`.)

De backend leest `GOOGLE_CLOUD_KEY` en `GEMINI_KEY` uit een `.env`. Zie
[docs/TECHNIEK.md](docs/TECHNIEK.md) voor de details.

## Documentatie

- **[docs/IDEEEN.md](docs/IDEEEN.md)** — de ideeën & wensen achter de app en wat er nog open staat.
- **[docs/FUNCTIES.md](docs/FUNCTIES.md)** — wat de app nu doet, per functiegebied.
- **[docs/TECHNIEK.md](docs/TECHNIEK.md)** — draaien, backend-endpoints, cache en opslag.
- **[docs/DEPLOY.md](docs/DEPLOY.md)** — de Docker/Synology-deploy-architectuur.
