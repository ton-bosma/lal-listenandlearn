# LAL — Listen And Learn

Een generieke taal-leer-app: een boek (of later video) **zin voor zin** doorlopen met
progressieve hulp die je zelf inroept: eerst luisteren, dan de tekst, dan woord-hovers, dan
de hele vertaling, en een LLM-uitleg van een geselecteerd tekstdeel.

De mechaniek is taal-onafhankelijk; **op dit moment ingericht voor Spaans → Nederlands**
(zin-splitsing `es`, vertaling es→nl, Spaanse stem). "Taal als instelling" staat als
TODO in [docs/STATUS.md](docs/STATUS.md).

> Volledige functionele beschrijving: **[docs/SPEC.md](docs/SPEC.md)**
> Wat is af / wat volgt: **[docs/STATUS.md](docs/STATUS.md)**

## Snel starten

```bash
# Windows: HOME wijst naar netwerkschijf, daarom expliciet:
HOME="$USERPROFILE" npm install     # eenmalig
HOME="$USERPROFILE" npm run dev      # dev-server (http://localhost:5173)
HOME="$USERPROFILE" npm run build    # productie-build + typecheck
```

(In een gewone shell zonder de HOME-workaround volstaat `npm install` / `npm run dev`.)

## Stack

- **React + Vite + TypeScript** (web-app), later te verpakken met **Capacitor** tot een
  iOS/Android-app — één codebase.
- Voorlezen, vertalen en uitleg lopen (t.z.t.) via **Google** (Cloud TTS, Cloud Translation,
  Gemini). Fase 1 gebruikt tijdelijk de gratis browser-stem en statische demo-data.

## Status in één zin

Fase 1 (skelet + flow op dummytekst, gratis browser-stem) werkt. Fase 2 (Google TTS +
Translation) is de volgende stap en vereist een Google-key. Zie STATUS.md.
