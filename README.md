# Spaans leren per zin

Een persoonlijke app om Spaans te leren door een boek (of later video) **zin voor zin**
te doorlopen, met progressieve hulp die je zelf inroept: eerst luisteren, dan de Spaanse
tekst, dan woord-hovers, dan de hele NL-zin, en (later) een LLM-uitleg van een geselecteerd
tekstdeel.

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
