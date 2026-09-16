# Handover — Spaanse variant-setting + werkwoorden-oefening (2026-09-08 13:02)

## Waar we mee bezig zijn
Taal-leer-app **LAL** (Spaans→NL). Deze sessie: de **werkwoorden-oefening** gebouwd en flink
uitgebreid (conjugatie-drills presente, tiers, SRS), een **ram-drill** (focus op 1+ werkwoorden),
een **complete UI-opschoonslag** (icoon-first), en diverse fixes. Alles draait. **Volgende stap =
de Spaanse-variant-setting** (plan hieronder), afgesproken maar nog NIET gebouwd.

## Onderhanden werk
- Niets half-af in code. Laatste `tsc -b` was **groen**. Alle wijzigingen staan in de working tree
  (zie git-stand) — **nog niets gecommit deze sessie**.
- Dev draait op de achtergrond (Vite :5173 + backend :3001).

## PLAN — Spaanse variant als app-setting (NIEUW OP TE PAKKEN)
Doel: kiezen tussen **Latijns-Amerika** (standaard) en **Spanje**, want dat bepaalt de personenset
en vervoegingen. Consistent met de stem-default (app leunt al op Latijns-Amerikaans).

1. **Setting** in het tandwiel-paneel (`src/App.tsx`, panel-blok; opslag via `src/lib/storage.ts`
   zoals `loadVerbSettings`/`saveVerbSettings` — nieuwe key `spaanleren.spanishVariant.v1`,
   waarde `'latam' | 'spain'`, default `'latam'`). Kleine select "Spaanse variant".
2. **Personenset variant-afhankelijk (server, `server/index.js`):**
   - LatAm: yo, tú, él/ella/usted, nosotros, **ustedes/ellos/ellas** (géén vosotros).
   - Spanje: yo, tú, él/ella/usted, nosotros, **vosotros**, ellos/ellas/ustedes.
   - Raakt `DRILL_PERSONS` + `conjugationDrillPrompt` (tier 1 persoonskeuze) en
     `conjugationTablePrompt` (de 6/5 rijen). `pickPersonIndex` blijft, maar over de variant-set.
3. **Labels naar Spaans** (afgesproken): in de gewone oefening tier 1 het **Spaanse** voornaamwoord
   tonen i.p.v. NL ("tú" i.p.v. "jij"). Server geeft nu `person` = NL-label terug → omzetten naar ES,
   óf ES meesturen. Ram-drill (`VerbFocusPanel`) toont al ES uit de tabel — die is dan meteen consistent.
4. **Client stuurt variant mee** naar `/api/conjugation-drill` en `/api/conjugation-table`
   (body-veld, bv. `variant`). **Cache-key uitbreiden met de variant** (anders botsen LatAm/Spanje).
   **`CONJ_PROMPT_VERSION` ophogen** (staat nu op **2** in `server/index.js`).
5. **Backend herstart** na de server-wijziging (geen watch). Client via HMR.

## Openstaande beslissingen / todo's (los van het plan)
- **Woordenlijst — conjugatie-balkje + tier-labeltje** (afgesproken, nog NIET gebouwd): tweede
  voortgangsbalk voor de `::conj`-box bij werkwoorden, met `repeat`-icoon; plus tier-label ("T2")
  o.b.v. de drempels. Import `srsKeyFor` uit `./lib/practice` was hiervoor al klaargezet maar weer
  verwijderd (was unused). Vocab-rij zit rond `App.tsx` ~960 (de `vocab-progress`-span).
- Persoonslabel-vorm: user koos **Spaans**; variant (LatAm/Spanje) wordt de setting hierboven.

## Relevante context / valkuilen
- **Git**: branch `master`, laatste commit `8a06670` (vorige sessie, gepusht). **Deze hele sessie is
  ONGECOMMIT** in de working tree: `M server/index.js, src/App.tsx, src/PracticePanel.tsx,
  src/index.css, src/lib/{addword,practice,storage,vocab}.ts` + **nieuw** `src/VerbPanel.tsx` en
  `src/VerbFocusPanel.tsx`. Push gaat via SSH (zie vorige handover). Version-bump bij push (CLAUDE.md).
- **Backend zonder watch** → na `server/index.js`-wijziging killen + opnieuw starten
  (`HOME="$USERPROFILE" npm run dev`, concurrently -k; kill de hele boom, poorten 3001/5173).
- **AI-endpoints** hebben `*_PROMPT_VERSION`-constanten als cache-buster; ophogen bij prompt-wijziging.
  Nu: `CONJ_PROMPT_VERSION=2`, `ADDWORD_PROMPT_VERSION=2`, `CLASSIFY_PROMPT_VERSION=1`.
- **Wat er nu al staat** (deze sessie, werkend): `type`+`infinitive` op woorden (AI-classificatie bij
  toevoegen/markeren + backfill `/api/vocab/enrich-missing`); `/api/conjugation-drill` (tier 1/2/3,
  persoon deterministisch geroteerd) en `/api/conjugation-table`; SRS-dimensie `::conj`; VerbPanel
  (gate uit, drempel-settings + "tiers door elkaar", Enter-flow, klik-werkwoord→tabel, luidspreker,
  hover=NL-vertaling, accent-/voornaamwoord-soepel nakijken); 24 kernwerkwoorden voorgevuld in
  `cache/vocab.json`; ram-drill `VerbFocusPanel` (kiezer met vinkjes vanuit menu + "Ram dit werkwoord"
  vanuit de oefening; 6 personen x3 passes, variatie-requeue met filler-reps; klik-werkwoord→tabel;
  geen SRS); hele UI opgeschoond naar icoon-first; hamer-icoon (`gavel`) voor de ram-feature.
- **Werkwijze** (project `CLAUDE.md`): lees/scan → background-agents, compact rapporteren; main licht;
  server-AI-werk via agent op `server/index.js`. Geen keuzelijsten; analyse->afstemmen->aanpassen.

## Volgende stap
Bouw de **Spaanse-variant-setting** volgens het plan hierboven (server-personenset variant-afhankelijk
+ Spaanse labels + setting + cache/versie + herstart). Daarna: het woordenlijst-balkje + tier-labeltje.

## Documentatie (leidend — niet overtypen)
`docs/IDEEEN.md`, `docs/FUNCTIES.md`, `docs/TECHNIEK.md`, `docs/DEPLOY.md`, `README.md`, `CLAUDE.md`.
