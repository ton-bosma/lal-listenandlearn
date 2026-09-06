# Status & vervolg

Levend document: waar staat het project, wat is af, wat is de volgende stap. Bijwerken bij
elke fase. Datum laatste update: **2026-08-24**.

## Fasering (afgesproken volgorde)

- **Fase 1 — Skelet + flow op dummytekst (geen key nodig).** ✅ AF
- **Fase 2 — Live vertaling via Google Translate (TTS blijft gratis browser-stem).** ✅ AF
  (code klaar; wacht alleen op de key van de gebruiker in `.env`).
- **Fase 3 — Selecteer + uitleg via Gemini.** ✅ AF (getest? key staat in `.env`).
- **Fase 4 — Manolito-PDF inladen (extractie + opschonen → zinnen + hoofdstukken).** ✅ AF.
- **Fase 5 — Google Cloud TTS als optionele "natuurlijke stem"** (naast de gratis browser-stem).
  ✅ AF (code klaar; wacht op activatie: TTS-API aanzetten + key-restrictie uitbreiden).

Zie **## TODO / nice-to-have (geparkeerd)** onderaan voor bewust uitgestelde ideeën.

## Fase 1 — wat is gebouwd (✅)

Volledig werkende flow op **eigen dummytekst**, offline, zonder key:

- Zin voor zin doorlopen met **◀ Vorige / Volgende ▶** (uiteinden disabled).
- Progressieve hulp: **Luister** (audio) → **Ondertiteld** (Spaanse zin + woord-hovers) →
  **NL-zin** (volledige vertaling eronder).
- Terug/verder → zin weer kaal (default-gedrag uit SPEC).
- **Woord-hovers** met tooltip (NL-gloss per woord) uit statische data.
- **Voorlezen** via gratis browser-stem (Web Speech API), poogt Latijns-Amerikaanse stem;
  **snelheidsslider** (0.5–1.5×).
- **Voortgang** (huidige zin-index) bewaard in localStorage.
- Auto-voorlezen bij aankomen op een zin (niet bij allereerste render i.v.m. browser-policy).

### Bestandsoverzicht

```
index.html                  entry
src/main.tsx                React-mount
src/App.tsx                 hoofdcomponent: state, flow, knoppen, LIVE vertaling wiring
src/index.css               styling (licht/donker, tooltip)
src/data/demoText.ts        TIJDELIJKE demo: demoSentences: string[] (alleen Spaans)
src/lib/words.ts            tokenize() + normalizeWord() voor de hovers
src/lib/tts.ts              speak()/stopSpeaking() — gratis browser-stem (blijft zo)
src/lib/translate.ts        Google Translate v2 + localStorage-cache (NL-zin + glossen)
src/lib/storage.ts          loadProgress()/saveProgress() — localStorage
vite.config.ts              dev-proxy "/gtranslate" -> translation.googleapis.com (CORS)
.env.example                sjabloon voor VITE_GOOGLE_TRANSLATE_KEY
```

## Fase 2 — wat is gebouwd (✅)

Live vertaling i.p.v. hardcoded data. **TTS-beslissing:** de browser-stem beviel, dus
voorlezen blijft gratis via de browser — Google Cloud TTS is **niet** nodig/gebouwd.

- `src/lib/translate.ts`: Google Translate (v2 REST), es→nl, met **localStorage-cache**
  (`spaanleren.translateCache.v1`); elke bron-string max één keer echt vertaald. Batcht
  ongecachte woorden in één request. `MissingKeyError` als er geen key is.
- **NL-zin** komt live bij de stap "NL-zin"; **glossen** worden opgehaald zodra "Ondertiteld"
  aan gaat (alle woorden van de zin in één batch → hovers meteen snappy).
- Laad-/foutindicatie in de UI; duidelijke melding als de key ontbreekt.
- Verkeer loopt in dev via de Vite-proxy `/gtranslate` (CORS). Key uit `.env`.

**Activatie: GEDAAN en getest ✅.** De key staat in `.env` (gitignored), Cloud Translation API
is enabled, en live vertaling + hovers zijn in de browser bevestigd werkend (2026-08-24).
Key-aanmaak was: Credentials → API key → "Public data" → Application restrictions "None" →
API restriction beperkt tot Cloud Translation API. Dev-server herstart nodig na .env-wijziging.

**Geverifieerde gratis-limiet:** Cloud Translation = eerste **500.000 tekens/maand gratis**,
verloopt niet; daarboven $20/miljoen. Billing (creditcard) verplicht, ook voor gratis laag.

## Fase 3 — wat is gebouwd (✅)

- `src/lib/explain.ts`: Gemini-call (model **gemini-2.5-flash**) via Vite-proxy `/gemini`,
  met fragment + hele zin als context; NL-prompt vraagt om Letterlijk / Natuurlijk / Uitleg.
  **localStorage-cache** (`spaanleren.explainCache.v1`) per (zin+fragment). `MissingGeminiKeyError`.
- UI: muisselectie binnen de Spaanse zin (`onMouseUp`) → knop **💡 Leg uit "…"** → paneel met
  het antwoord, sluitknop, laad-/foutindicatie. `.tooltip` heeft `user-select:none` zodat
  tooltiptekst niet in de selectie belandt.
- Key: `VITE_GEMINI_KEY` in `.env` (Google AI Studio, geen creditcard). Staat ingevuld.
- **Geverifieerde gratis-limiet (2026):** 2.5 Flash ~10 RPM / ~250 per dag / 250k TPM;
  Flash-Lite ~15 RPM / ~1000 per dag. Geen creditcard. Live limieten per project:
  https://aistudio.google.com/rate-limit . Google kan gratis-prompts gebruiken voor
  modelverbetering; limieten kunnen zonder aankondiging wijzigen.

## Fase 4 — Manolito-PDF

- PDF-tekst extraheren (bijv. `pdfjs-dist`) en **opschonen**: pagina-koppen/voetteksten weg,
  afbreekstreepjes (woord-splitsing over regels) herstellen, regelafbrekingen samenvoegen.
- Zin-splitser (`src/lib/sentences.ts`) die Spaans aankan (afkortingen, dialoogstreepjes,
  «…», ¿?/¡!). Resultaat: `string[]` van zinnen → in de flow.
- Boekbestand blijft **lokaal en buiten git** (auteursrecht).

## Fase 4 — wat is gebouwd (✅)

- `src/lib/pdf.ts`: `extractPdfText(File)` via pdfjs-dist v6 (worker geladen met Vite `?url`).
- `src/lib/sentences.ts`: `cleanText()` (afbreekstreepjes/witruimte/alineagrenzen, paar regels
  regex) + `splitSentences()` met native **`Intl.Segmenter('es')`** (geen dependency; TS-lib
  kent het type niet in ons target → kleine lokale typering). Filtert lege regels en losse
  paginanummers.
- `src/lib/storage.ts`: `Book { name, sentences }` + `loadBook()`/`saveBook()` in localStorage
  (`spaanleren.book.v1`). Meerdere boeken = nog steeds later; nu één "current".
- `src/App.tsx`: **"Boek laden"**-knop (verborgen file-input, accept=pdf) → extractie → split →
  als huidig boek zetten, positie naar 0. Zonder boek valt hij terug op de demotekst. Boeknaam
  in de nieuwe `.bookbar`. Laad-/foutindicatie.
- **Hoofdstukken:** `extractPdfBook()` leest de PDF-**outline** (bladwijzers) → per hoofdstuk een
  0-based pagina; `buildSentences()` levert `pageStartSentence[page]` via PAGE_MARK-tellingen;
  App mapt hoofdstuk→startzin en toont een **hoofdstuk-dropdown** in de boekbalk (springt naar
  de startzin; markeert het huidige hoofdstuk). Manolito-PDF heeft 11 outline-items. Boeken
  zónder outline krijgen simpelweg geen dropdown. **Let op:** een boek dat vóór deze feature
  is ingeladen mist `chapters` → PDF één keer opnieuw laden.
- **Stemkeuze:** `tts.ts` cachet stemmen + luistert op `voiceschanged` (lost m/v-wisseling op);
  dropdown in de instellingen-rij met alle Spaanse systeemstemmen; keuze onthouden
  (`spaanleren.voiceURI.v1`), anders auto Latijns-Amerikaans. NB: de "Google …"-stemmen in
  Chrome zijn Chrome-eigen (gratis, vaste set), los van Google Cloud; meer keuze = Windows-
  stemmen bijinstalleren.
- Diagnose op het echte boek (scratchpad `pdftest.mjs`): 86 pagina's, ~160k tekens, tekst-PDF
  (geen OCR nodig), ~1421 zinnen, gezonde lengteverdeling. Bekende ruwe randjes: enkele hele
  lange ratelzinnen (dialoog met — splitst Intl.Segmenter niet) en een paar hele korte
  (titels). Finetunen op wat opvalt.
- **Bundelwaarschuwing**: pdfjs-worker is groot (~1,2 MB). Onschadelijk; later evt. lui laden
  met dynamic import zodat pdfjs pas bij "Boek laden" binnenkomt.

## Openstaande punten / let op

- **Auto-voorlezen bij (her)laden in dev**: door React StrictMode draait het mount-effect
  dubbel, waardoor de eerste zin bij een full reload tóch wordt uitgesproken (in productie
  zonder StrictMode niet). Onschuldig dev-artefact.
- **Stem m/v-wisseling** = OPGELOST (voiceschanged + gecachte stemmen + stemkeuze in `tts.ts`).
- **Gratis-limiet Translate** = geverifieerd (500k tekens/mnd). **Gemini** = geverifieerd
  (2.5/3.x Flash gratis laag; live limiet per project in AI Studio). TTS-limiet niet relevant.
- **Gemini billing-valkuil (2026):** een Gemini-key op een project mét billing (bijv. het
  Translate-project met creditcard) wordt als BETAALD (Prepay) behandeld → `429 "prepayment
  credits are depleted"` bij €0 tegoed. **Opgelost door de gebruiker met €25 prepay (Optie B).**
  (Alternatief was Optie A: Gemini-key in een apart no-billing project.) Model op alias
  `gemini-flash-latest`.
- **Gemini "thinking"-afkapping** = OPGELOST: flash-modellen gebruiken denk-tokens die meetellen
  in `maxOutputTokens`; met 512 werd het antwoord afgekapt (alleen "Letterlijk" zichtbaar).
  Nu `maxOutputTokens: 2048`. Explain-cache is naar `v2` gebumpt (v1 bevatte afgekapte tekst).
- **Key-exposure:** browser-direct is oké voor persoonlijk/lokaal; bij delen/publiceren eerst
  een proxy-laagje bouwen (SPEC §6).
- **StrictMode** dubbel-invoket effects in dev; `speak()` cancelt eerst, dus geen dubbele
  spraak. Bij het bouwen van caches hiermee rekening houden.
- npm op deze machine: `HOME="$USERPROFILE"` prefixen (netwerkschijf-HOME).

## Fase 5 — wat is gebouwd (✅)

Optionele natuurlijke stem via Google Cloud TTS, náást de gratis browser-stem.

- `src/lib/cloudtts.ts`: `listSpanishCloudVoices()` (voices.list, es-*, gecached), `speakCloud()`
  (text:synthesize → MP3 → afspelen), **IndexedDB-audiocache** (`spaanleren-tts`, key =
  stem|snelheid|tekst) zodat herhalen/latere sessies gratis zijn. Hergebruikt de
  **Translate-key** (`VITE_GOOGLE_TRANSLATE_KEY`, zelfde Cloud-project). Proxy `/gtts`.
- `src/lib/tts.ts`: één `speak()` die routeert op een generiek stem-id:
  `''` = auto browser LatAm, `browser:<voiceURI>`, `cloud:<name>:<lang>`, of legacy bare uri.
  `stopSpeaking()` stopt beide. `subscribeTtsError()` geeft async Cloud-fouten door aan de UI.
- `src/App.tsx`: stem-dropdown met optgroups **Browser (gratis)** en **☁ Google Cloud
  (natuurlijk)**; Cloud-stemmen worden opgehaald als er een key is (stil falen als de API nog
  niet aan staat). Foutmelding onderin bij Cloud-problemen.
- **Activatie door de gebruiker:** (1) **Cloud Text-to-Speech API** aanzetten in hetzelfde
  project; (2) die API toevoegen aan de **API-restricties** van de key (stond op alleen
  Translation). Daarna verschijnen de ☁-stemmen vanzelf.
- **Gratis-limiet (geverifieerd 2026):** Neural2/Chirp3-HD 1M tekens/mnd, WaveNet 4M/mnd, geen
  verloop. WaveNet $4/1M, Neural2 $16/1M, Chirp3-HD $30/1M daarboven. Met cache ruim gratis.
- Kwaliteit/keuze: voor realisme zijn **Neural2** of **Chirp3-HD** in es-US/es-MX het mooist.

## EPUB-ondersteuning (gebouwd, TIJDELIJK GEPARKEERD)

> Front-end staat bewust weer op **PDF** (`accept="application/pdf"`): EPUB "ging nog niet
> helemaal lekker" bij het testen en heeft nog polish nodig voor het weer default wordt.
> Alle EPUB-code blijft staan en de routing werkt op extensie — terugzetten = `accept`
> weer op `.epub,application/epub+zip`. Nog uit te zoeken wat er niet lekker ging (bijv.
> tekst-/hoofdstukkwaliteit op een echte EPUB).

- `src/lib/epub.ts`: `extractEpubBook(file)` — jszip pakt de ZIP uit; container.xml → .opf →
  manifest + spine (leesvolgorde) + nav-item/ncx; XHTML → tekst via native **DOMParser**
  (blok-einden eerst naar newlines zodat woorden niet plakken). PAGE_MARK vóór elk
  spine-document → zelfde `buildSentences()` hoofdstuk→zin-mapping als bij PDF. Hoofdstukken
  uit **nav.xhtml** (EPUB3) of **toc.ncx** (EPUB2). Levert dezelfde `ExtractedBook`-vorm als
  `pdf.ts`, dus de App-flow is identiek.
- `src/App.tsx`: laadknop accepteert nu **alleen `.epub`**; routeert op extensie
  (`.epub` → epub-laag, anders → PDF-fallback). **PDF-code blijft staan** als stille fallback
  (bewust niet weggegooid).
- Structuur-check (scratchpad `epubtest.mjs`) op een neutraal EPUB: opf ok, 16 spine-docs,
  toc.ncx met 16 hoofdstukken, ~5700 zinnen. Pipeline gevalideerd.
- **Auteursrecht:** de EPUB-functie is formaat-ondersteuning, los van de bron. De gebruiker
  laadt zelf een **legale** EPUB (gekocht/geleend). De OceanofPDF-bestanden in Downloads zijn
  illegale kopieën en worden bewust niet verwerkt/gebruikt in dit project.

## TODO / nice-to-have (geparkeerd)

- **Taal als instelling (generiek maken).** De app is qua mechaniek taal-onafhankelijk, maar
  nu hard op Spaans→Nederlands: `Intl.Segmenter('es')` (sentences.ts), `source:'es'/target:'nl'`
  (translate.ts), de Spaanse stemfilters (tts.ts/cloudtts.ts) en de NL-prompt (explain.ts).
  Doel: bron-/doeltaal als instelling, zodat andere talencombinaties werken. Repo heet daarom
  bewust generiek **lal-listenandlearn** (Listen And Learn).

Bewust uitgesteld — de app is nu bruikbaar voor "schools" leren via de boek-flow; deze ideeën
komen later, in ongeveer deze volgorde van waarschijnlijkheid:

- **Front matter overslaan** (titel/auteur/copyright/inhoudsopgave wordt nu als zinnen
  ingelezen en voorgelezen). Opties:
  (a) automatisch bij het **eerste hoofdstuk** beginnen als er een TOC/outline is;
  (b) handmatige **"▮ Begin hier"-knop** als vangnet voor boeken zonder TOC;
  (c) **Gemini "zoek het begin"**: stuur de eerste ~N genummerde zinnen naar Gemini en laat
  het de index teruggeven waar de echte tekst begint (voorbij titel/auteur/copyright/TOC) —
  één call per boek, robuust over talen/formaten heen. Kan (a)/(b) aanvullen of vervangen.
  In alle gevallen: bewaar een **start-offset** per boek (niet wegtrimmen → omkeerbaar).
- **Verhelderende vervolgvraag op de AI-uitleg** (zonder in een algemene chat te belanden).
  Klein "Vraag door…"-veld onder het uitlegpaneel; de vraag gaat naar Gemini mét context
  (Spaanse zin + fragment + vorige uitleg). **Strak gebonden aan het fragment**: de mini-draad
  hoort bij déze zin en wist bij het navigeren naar de volgende zin. Evt. zachte limiet op
  aantal vervolgvragen. Doel: verhelderen, geen losse chat-app.
- **Uitspraak-check (twee-traps).** Je spreekt een woord/zin, de app zegt of het klopt.
  (1) **Gratis, mild — Duolingo-stijl:** browser `SpeechRecognition` (lang `es`) → transcriptie
  fuzzy vergelijken met de doelzin → ✓/✗. Laag bouwwerk, geen extra key (Chrome, mic-permissie,
  internet). Bewust vergevingsgezind = motiverend, geen echte uitspraak-score.
  (2) **Upgrade — echte scores:** Azure Speech **Pronunciation Assessment** (per woord/foneem;
  gratis laag ~5 audio-uur/mnd; aparte key; doorbreekt "alles via Google" want Google heeft
  hier geen goede kant-en-klare dienst voor).
- **Vocabulaire vooraf (front-loading), aanzetbare optie.** De app kijkt X woorden / N zinnen
  vooruit en biedt de **lastige woorden** eerst aan — als vertaallijst óf als **matching-spel**
  (twee rijen Spaans↔betekenis, paren vormen, Duolingo-stijl). "Lastig" bepalen via een Spaanse
  frequentielijst, Gemini ("welke woorden zijn hier lastig voor een leerder?"), of je
  nog-niet-geziene/gemarkeerde woorden. Deelt bouwstenen met de overhoor-oefenmodus (matching)
  en de bestaande hovers/vertaling. Toggle in de instellingen.
- **Woorden markeren + overhoren (oefenmodus).** Tik/selecteer een woord → "★ Onthouden" →
  persoonlijke woordenlijst met NL-betekenis + bronzin als context. Aparte **Oefenen**-modus
  die de gemarkeerde woorden overhoort (flashcards Spaans↔NL) met **spaced repetition**
  (goed = later terug, fout = snel terug). Leunt op bestaande hovers/vertaling; Gemini kan
  er optioneel een voorbeeldzin/uitleg bij geven. Opslag lokaal (localStorage).
### Sneller-lezen-features (ideeën van Claude, afgekeken van andere apps)

- **★ Karaoke-highlight tijdens voorlezen** *(top-2)*. Woord licht op terwijl de stem leest →
  ogen volgen spraaktempo, snellere woordherkenning. Web Speech `onboundary` per woord
  (browserstem; bij Cloud-audio lastiger). Grootste directe versneller voor leestempo.
- **★ Bekende/onbekende woorden kleuren + dekkingspercentage** *(top-2, LingQ-kern)*. Houd een
  known-words set bij; onbekende gemarkeerd, bekende "gewoon". "Je kent X% van dit boek"-meter
  helpt materiaal op niveau kiezen (i+1). Voedt de overhoor-SRS.
- **Flow-/extensief-modus**: auto-doorlezen + voorlezen zonder aansporing tot opzoeken; volume
  boven precisie, voor leesritme. Tegenhanger van de intensieve study-modus.
- **Leesstatistieken + streak** (woorden gelezen / nieuwe woorden / dagen op rij). Volume drijft
  leessnelheid; goedkoop te bouwen.
- **Steun-niveau / hulp afbouwen** (globaal): tekst+audio → alleen audio → snelheid richting
  native. Bouwt voort op de bestaande progressieve hulp per zin.
- **Chunk/collocatie-herkenning**: veelvoorkomende woordgroepen (bijv. vaste uitdrukkingen)
  markeren/opslaan; vloeiende lezers lezen in brokken. Leent op de selectie-voor-uitleg.

- **Video-flow** (grootste, veel later). Doel: leren echte sprekers te verstaan, niet alleen
  nette TTS. Realistisch beperkt tot **YouTube** (Netflix afgeschermd); transcript+timing via
  YouTube-captions of **Whisper** (lokaal, gratis, met tijdstempels); zelfde hulplagen als bij
  tekst. **Gotcha's (reden dat het later komt):** waar begint/eindigt een "scene", sprekers die
  door elkaar praten, en het ontbreken van nette zinsgrenzen in spraak. Eerst boek-flow rijp
  maken.
- **Realisme-ladder voor spraak** (context bij bovenstaande): browser-stem → Google Cloud TTS
  neurale/HD-stem (Fase 5 / "A") → echte menselijke spraak (video/audioboek). Kernpunt: een
  nette TTS verstaan ≠ een echte Spanjaard/Mexicaan verstaan (echte spraak = sneller,
  aaneengeplakt, reducties, regionaal accent).
- **Instelling "achtergelaten stand onthouden"** i.p.v. altijd kaal terug (SPEC §2).
- **Meerdere boeken** bewaren + kiezen (nu één "current"; voortgang dan per boek sleutelen).
- **Terug naar demotekst** als expliciete knop (nu overschrijft "Ander boek laden").
- **pdfjs lui laden** (dynamic import) zodat de grote worker pas bij "Boek laden" binnenkomt.
- **Dialoog-splitsing**: lange ratelzinnen met gedachtestreepjes (—) eventueel extra splitsen
  als het bij het lezen stoort.
