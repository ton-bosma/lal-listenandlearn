# Handover — werkwoorden-route & roadmap (2026-09-07 16:23)

## Waar we mee bezig zijn
Taal-leer-app **LAL** (Spaans→NL), boek zin-voor-zin. Deze sessie: oefenmodus gebouwd + flink
uitgebreid, docs herzien, silent modes + Material Icons. Nu klaar om aan de **werkwoorden-
oefening** te beginnen — de user wil eerst in een **verse chat sparren over de uitvoering**.

## Deze sessie af & gecommit/gepusht (origin/master)
- Oefenmodus: AI-voorbeeldzin (variërende vervoeging, reveal-knop, woord-hover/klik, zelfde zin
  bij fout, prefetch) + woord-flashcard **ES→NL én NL→ES** (aparte SRS `::nl2es`).
- Full-screen schermmodel (🎯 → keuzescherm → onderhoud / oefening / chat; terug = stap omhoog).
- Woordenlijst: filter, voortgang (SRS-box), AI-toevoegen (taal-detectie, omdraaien, voorbeeldzin).
- Gedeeld chat-scherm (`/api/chat`): vrije chat + "verder in chat" vanuit uitleg.
- Silent modes: twee settings-toggles **Voorlezen** (ontvangen) + **Microfoon** (produceren, nu
  **inert**), stille-leesmodus-fallback. **Material Icons** overal standaard.
- Backend endpoints: `/api/segment`, `/api/story-start`, `/api/practice-sentence`, `/api/add-word`,
  `/api/chat` (vervangt `/api/explain`). Prompt-versieconstanten als cache-buster.
- Docs herzien: **IDEEEN.md** (jouw ideeën/wensen + route), **FUNCTIES.md**, **TECHNIEK.md**;
  README bijgewerkt; OEFENMODUS/STATUS/SPEC verwijderd (DEPLOY.md blijft).

## Onderhanden
- Niets half-af qua code. `docs/IDEEEN.md` net bijgewerkt (route + afgestreepte punten) —
  zie git-stand hieronder.

## Volgende stap — de afgesproken route (staat in docs/IDEEEN.md → "Werkwoorden oefenen")
1. **Woordtype + infinitief-fundament**: AI bepaalt bij toevoegen én markeren het type
   (werkwoord/zelfstandig/…) + voor werkwoorden de infinitief; opslaan als veld op het woord.
   Levert meteen filteren per type op.
2. **Werkwoorden-oefening — vervoegingen, beide richtingen** (twee menu-items), zelf-beoordelen/typen.
3. **Gesproken antwoord** (SpeechRecognition, gate't op de mic-toggle) + **clitic-combi's** als lagen.
- Open sub-vraag: mag de AI ook **losse werkwoorden aandragen** of strikt uit de lijst?
- **Eerst sparren over de uitvoering** voordat er gebouwd wordt (wens van de user).

## Relevante context / valkuilen
- **Git**: branch `master`, laatste commit `82437cf` (gepusht). **Push gaat via SSH**
  (`git@github.com:ton-bosma/lal-listenandlearn.git`); HTTPS vraagt om wachtwoord/token en werkt niet.
- **Dev draaien**: `HOME="$USERPROFILE" npm run dev` (Vite :5173 + backend :3001, concurrently -k).
  Backend = node **zonder watch** → na `server/index.js`-wijziging killen + opnieuw starten.
- **Werkwijze** (zie project `CLAUDE.md`): lees/scan/parse → background-agents, compact rapporteren;
  main-context licht houden; model per call kiezen.
- Woordenlijst is server-side (`vocab.json`); SRS-stand lokaal (localStorage), per richting apart.

## Documentatie (leidend — niet overtypen)
`docs/IDEEEN.md` (ideeën/wensen + route + open lijst), `docs/FUNCTIES.md` (wat de app doet),
`docs/TECHNIEK.md` (draaien/endpoints/opslag), `docs/DEPLOY.md`, `README.md`, `CLAUDE.md`.
