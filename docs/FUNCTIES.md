# Functies — huidige staat

Feitelijke beschrijving van wat de app (LAL — Listen And Learn) op dit moment doet, per
functiegebied. Dit document beschrijft alleen bestaande functionaliteit. Voor het technische
contract (endpoints, cache, opslag) zie [TECHNIEK.md](TECHNIEK.md).

De app is één React-scherm (`src/App.tsx`) met een lezer als basis en enkele full-screen
overlay-schermen daarbovenop. De koptekst toont de titel "Spaans leren per zin", een
zin-teller, en drie knoppen: 🎯 (oefenen & woordenlijst), 🔊/🔇 (mute), ⚙ (instellingen & boek).

## Lezer

De lezer toont één leer-eenheid ("zin") tegelijk, met progressieve hulp die je zelf inroept via
drie zichtbaarheidsniveaus (`reveal`):

- **`none` (Luister)** — alleen audio, de Spaanse tekst is verborgen ("🎧 Luister naar de zin").
- **`spanish` (Ondertiteld)** — de Spaanse zin is zichtbaar, met woord-hovers.
- **`dutch` (NL-zin)** — de volledige Nederlandse vertaling verschijnt eronder; de Spaanse zin
  blijft staan.

De hulpknoppen onderin lopen deze volgorde af: 🔊 Luister → 👁 Ondertiteld → 🇳🇱 NL-zin. Bij het
navigeren naar een volgende/vorige zin gaat het niveau terug naar `none`.

**Woord-hover.** Op niveau `spanish` (en `dutch`) is elk woord een token met een tooltip die de
Nederlandse vertaling toont (live opgehaald zodra de tekst zichtbaar wordt). De tooltip toont ook
een hint ("klik: markeer" of "klik: uit lijst"). Losse getallen krijgen geen hover.

**Klik = markeren.** Een kale klik op een woord zet het in de woordenlijst (of haalt het eruit als
het er al in staat). Een gemarkeerd woord licht op in de tekst. Bij markeren worden woord, de
vertaling (uit de reeds opgehaalde hover-vertaling, anders los opgehaald) en de huidige zin als
context bewaard.

**Selectie → uitleg / bewaren.** Selecteer je een stuk tekst met de muis, dan verschijnen twee
knoppen: "💡 Leg uit: …" (AI-uitleg van het geselecteerde deel binnen zijn zin) en "📑 Bewaar: …"
(de selectie als één regel in de woordenlijst, met vertaling). Staat de selectie al in de lijst,
dan toont de knop "✓ In lijst".

**Uitleg-paneel.** De AI-uitleg verschijnt inline in een paneel (met Markdown-opmaak). De uitleg
is opgebouwd als "Natuurlijk / Letterlijk / Uitleg". Onder de uitleg staat "💬 Verder in chat",
waarmee de uitleg-thread en de fragment-context meegaan naar het full-screen chat-scherm.

**Voorlezen (TTS).** Bij het aankomen op een zin wordt die automatisch voorgelezen (tenzij mute
aan staat, en niet bij de allereerste render). De knop "🔊 Luister" leest handmatig (opnieuw)
voor. Stem en snelheid (0,5×–1,5×) zijn instelbaar.

**Mute.** De 🔊/🔇-knop zet alle spraak uit (automatisch én handmatig). Bij een luister-actie met
mute aan verschijnt kort de melding "🔇 Geluid staat uit — mute is aan." De mute-stand wordt
lokaal onthouden.

## Boek importeren & knippen

Via ⚙ → "Boek laden" / "Ander boek" kies je een bestand. De extractie gebeurt in de browser:

- **PDF** (`src/lib/pdf.ts`, via pdfjs-dist): volledige tekst met paginamarkers + hoofdstukken
  uit de PDF-outline.
- **EPUB** (`src/lib/epub.ts`, via jszip): tekst per spine-document + hoofdstukken uit
  `nav.xhtml` (EPUB3) of `toc.ncx` (EPUB2).

> Let op: het bestandskeuze-veld heeft `accept="application/pdf"`, maar de code kiest op de
> bestandsnaam (`.epub` → EPUB-extractor, anders PDF-extractor), dus EPUB werkt ook.

Na extractie wordt de tekst geknipt. De knip-modus is een instelling (⚙ → "Knippen (bij import)")
die pas geldt bij de volgende (her)import en in het boek wordt vastgelegd:

- **Deterministisch** (default, geen AI) — de hele tekst wordt bij import in één keer opgeschoond
  en in zinnen gesplitst met `Intl.Segmenter` (`src/lib/sentences.ts`). Daarna wordt de
  **front-matter éénmalig weggeknipt**: de AI (`/api/book-start`) bepaalt de eerste echte
  verhaalzin; faalt dat, dan valt de client terug op een regex-heuristiek voor
  colofon/flaptekst/opdracht (`src/lib/frontmatter.ts`). Hoofdstuk-starts schuiven mee en een
  hoofdstuktitel die vóór de eerste zin plakt wordt van die zin gestript.
- **AI-knipper** (opschonen + slim knippen) — de tekst wordt bij import alleen deterministisch in
  chunks gehakt (~800 tekens, harde breuk op elke hoofdstukgrens; `src/lib/chunk.ts`). Het
  opschonen (watermerken/voetnoten/paginanummers weg, afgebroken woorden herstellen) en het
  knippen in korte leer-eenheden gebeurt **voortschrijdend per chunk tijdens het lezen** via
  `/api/segment`. Het resultaat per chunk wordt in het boek gecachet.

**Progressieve secties/hoofdstukken.** In deterministische modus komen de hoofdstukken uit de
PDF/EPUB-outline. In AI-modus worden secties **progressief ontdekt**: de AI-knipper geeft per
chunk optioneel een sectie terug (kop uit de tekst, of een verzonnen NL-label als "Voorwoord",
"Proloog" — met een ✦ in de dropdown). Deze secties worden gaandeweg aan de hoofdstuk-dropdown
toegevoegd.

**Story-start (AI-modus).** Bij het openen van een AI-boek bepaalt de AI éénmalig (over de
opening-chunks samen, `/api/story-start`) bij welke chunk het verhaal begint; front-matter ervoor
wordt overgeslagen. Bij twijfel/fout: chunk 0 (niets overslaan).

**Voortschrijdend laden (AI-modus).** De lezer houdt een venster van aaneengesloten, al-geknipte
chunks bij (`src/lib/reader.ts`). Op (bijna) de laatste eenheid van het venster wordt de volgende
chunk alvast geknipt (prefetch), zodat "Volgende" aan de grens niet hoeft te wachten. Een
hoofdstuk-sprong reset het venster naar de doel-chunk. Bekend-lege chunks (front-matter/rommel)
worden overgeslagen. De zin-teller is in AI-modus een raming (aangeduid met "~"), omdat niet het
hele boek geknipt is.

Zonder ingeladen boek draait de app op een ingebouwde demotekst (`src/data/demoText.ts`).

## Full-screen schermmodel

De 🎯-knop opent het **keuzescherm** (menu). Daarvandaan bereik je vier schermen:

- **💬 Chat** — vrije taalvraag aan de AI-tutor.
- **📖 Woordenlijst onderhouden** — bekijken, bewerken, verwijderen, AI-toevoegen.
- **✨ AI-voorbeeldzin** — oefening A (vereist woorden + Gemini-key).
- **🃏 Woord-flashcard** — oefening B (vereist woorden).

Elk scherm is een overlay bovenop de behouden leesstaat. **Terug = één stap omhoog**:
oefening/onderhoud → menu → lezen. Het chat-scherm keert terug naar waar je vandaan kwam
(vanuit het menu → menu; vanuit een uitleg → de lezer).

**Consistente schermindeling (app-shell).** Elk scherm — de lezer én de overlays — heeft
dezelfde drie vaste regio's: een **gepinde header** bovenaan (links = terug/omhoog, rechts =
scherm-acties), een **scrollende content** in het midden, en een **gepinde actiebalk** onderaan
met vaste links/rechts-betekenis: **links = terugwaarts** (vorige / annuleren / opnieuw),
**rechts = voorwaarts** (volgende / bevestigen / primaire actie). Header en actiebalk scrollen
niet mee; alleen het middenstuk scrollt. Zo staat "verdergaan" overal rechtsonder en
"terug/annuleren" overal linksonder — zoals de ◀ Vorige / Volgende ▶ van de lezer.

## Oefenmodus

Twee oefeningen (`src/PracticePanel.tsx`), elk als eigen scherm, met een lichte Leitner-SRS
(`src/lib/practice.ts`). De oefening start meteen bij het openen.

**Oefening A — AI-voorbeeldzin (`aisentence`).** Voor het huidige woord haalt de backend
(`/api/practice-sentence`) een verse Spaanse voorbeeldzin met vertaling op. Bij een werkwoord
wordt bewust een **wisselende vervoeging** gevraagd (persoon/tijd), om de uitgangen te trainen.
De Spaanse zin toont met woord-hovers en klik-om-te-markeren (net als in de lezer). Met
"👁 Toon vertaling" draai je de kaart; klik op de vertaling brengt je terug naar het origineel.
Een **seed** roteert per ronde voor een verse zin en blijft constant binnen een ronde, zodat een
fout-teruggezette kaart dezelfde zin toont (zodat je 'm alsnog goed kunt krijgen). Komende kaarten
worden vooruit **geprefetcht** (2 vooruit).

**Oefening B — Woord-flashcard (`flashcard`).** Voorkant: het Spaanse woord. Achterkant (na
"👁 Toon vertaling"): de betekenis + de zin waarin je 'm zag. Klik op de achterkant = terug naar
het origineel.

**Beoordelen & SRS.** Na het tonen van de vertaling beoordeel je jezelf met "✓ Goed" / "✗ Fout".
Goed = box +1 (tot max 5); Fout = terug naar box 0 en de kaart schuift enkele plekken verderop
terug in de ronde. Een ronde wordt opgebouwd uit alle woorden, gesorteerd op box (laag eerst),
willekeurig geschud binnen een box. Aan het eind toont een **ronde-samenvatting** (aantal kaarten,
aantal fout) met "Opnieuw" en "Ander oefening".

## Woordenlijst-onderhoud

Het onderhoudscherm (`screen === 'vocab'`) toont de woordenlijst (server-side bewaard):

- **Bewerken.** Klik op het woord of de vertaling om die inline aan te passen (Enter = opslaan,
  Escape = annuleren). Bij een woord-wijziging verandert de sleutel mee; de server hernoemt en
  dedupliceert.
- **Verwijderen.** De ×-knop haalt een woord uit de lijst.
- **Filter.** Een zoekveld filtert de lijst live (substring, hoofdletterongevoelig, over
  woord + vertaling + context).
- **Voortgang-indicator.** Per woord een balkje van 5 segmenten dat de huidige SRS-box toont.
- **AI-toevoegen.** Een invoerveld ("Typ een woord (NL of Spaans)") + "✨ Vertaal" haalt via
  `/api/add-word` een voorstel op: de AI **detecteert de taal**, vertaalt (het woord is altijd
  Spaans, de vertaling altijd Nederlands) en verzint een voorbeeldzin. Het voorstel is bewerkbaar
  (Spaans / vertaling / voorbeeldzin). "↔ Omdraaien" haalt opnieuw op met de tegenovergestelde
  richting (om een verkeerde auto-detectie te corrigeren). "Toevoegen" zet het in de lijst;
  dubbele woorden worden gemeld. AI-toevoegen vereist een Gemini-key op de server.

De woordenlijst is één gedeelde lijst (per-profiel bestaat nog niet).

## Chat

Eén gedeeld full-screen chat-scherm (`src/ChatPanel.tsx`) met twee ingangen:

- **Vrije chat** — vanuit het keuzescherm ("💬 Chat"): verse thread, geen fragment-context,
  vrije taalvraag aan de tutor.
- **Verder vanuit een uitleg** — vanuit het inline uitleg-paneel in de lezer ("💬 Verder in
  chat"): de uitleg-thread en de fragment-context (zin + geselecteerd deel) gaan mee als seed, en
  "← Terug" keert terug naar de lezer.

De tutor antwoordt in het Nederlands. Een gesprek stuurt de eerdere beurten als history mee.
De thread start vers per keer (geen persistentie tussen keren). Chat vereist een Gemini-key.

## AI-vertaling van de zin (met context)

Naast de gewone vertaling (Google Translate) kan de zin op niveau `dutch` door Gemini vertaald
worden **mét de buurzinnen als context** (`/api/ai-translate`), bedoeld voor gevallen waar Google
op een los fragment struikelt (bijv. een voorwaarde/dialoog die over de zinsgrens doorloopt). De
modus is instelbaar (⚙ → "AI-vertaling"):

- **Uit** — alleen Google Translate.
- **Als 2e keus** — Google eerst; klik op de NL-zin voor de AI-versie (knop "✨ AI-vertaling
  (met context)").
- **Meteen** — direct de AI-versie; Google wordt overgeslagen. Bij falen "⚠️ AI-vertaling
  mislukt".

Een AI-vertaling krijgt een "✨ AI"-badge. Vereist een Gemini-key.

## Uitleg (initieel)

Zie ook "Lezer → Selectie → uitleg". De initiële uitleg van een geselecteerd fragment loopt via
`/api/chat` (context zonder vraag) en wordt server-side gecachet. Vervolgvragen verhuizen naar het
chat-scherm. Vereist een Gemini-key.

## Stemmen / TTS

Twee bronnen achter één ingang (`src/lib/tts.ts`):

- **Browserstemmen** (Web Speech API) — gratis, standaard. Auto-keuze verkiest een
  Latijns-Amerikaans accent.
- **Google Cloud-stemmen** (☁, natuurlijker) — optioneel, via `/api/tts` en `/api/voices`
  (`src/lib/cloudtts.ts`). De lijst wordt bekort tot een handvol Latijns-Amerikaanse stemmen
  (es-US/es-MX/es-419: alle Neural2 + enkele Chirp3-HD).

De stemkeuze staat in ⚙ ("Automatisch", een browserstem, of een Cloud-stem) en wordt lokaal
onthouden. Cloud-stemmen verschijnen alleen als de TTS-feature (Google-key) beschikbaar is.

## Feature-gating

De client vraagt bij het opstarten `/api/health` op om te weten welke features de server aanbiedt
(afhankelijk van welke keys server-side gezet zijn; `src/lib/health.ts`):

- **`translate`** (Google-key) — woord-hovers en NL-zin via Google Translate. Ontbreekt de key,
  dan verschijnt een waarschuwing.
- **`tts`** (Google-key) — Cloud-stemmen. Ontbreekt de key, dan alleen browserstemmen.
- **`gemini`** (Gemini-key) — "Leg uit", chat, AI-vertaling, AI-voorbeeldzin, AI-toevoegen en de
  AI-knipper. Ontbreekt de key, dan zijn die knoppen/opties uitgeschakeld (met een tooltip
  "Vereist een Gemini-key op de server") en verschijnt een waarschuwing.

Browser-TTS werkt ongeacht de server-keys; ontbreekt de Web Speech API, dan meldt de app dat
voorlezen hier niet werkt.

## Mobiel & PWA

De app is een **installeerbare PWA** (manifest + service worker): op de telefoon via "Zet op
beginscherm" draait hij full-screen (standalone), met eigen icoon en de app-kleur als thema. De
service worker cachet de app-shell + iconen-font zodat de schil offline laadt; de inhoud
(vertaling, uitleg, voorlezen) blijft afhankelijk van de backend. De **desktop-browser verandert
niet** — de service worker draait alleen in de productie-build, niet in dev.

Op **touch-toestellen** gedragen de leesinteracties zich anders dan met een muis (desktop-hover
en muisselectie blijven ongewijzigd):

- **Tik op een woord → betekenis-popover.** Een tik toont een klein kaartje met de vertaling van
  dat woord plus een **markeer-/uit-lijst-knop**. (Op desktop: hover toont de tooltip, klik
  markeert — zoals voorheen.)
- **Sleep over woorden → eigen selectie.** Vegen over meerdere woorden selecteert een reeks (eigen
  highlight, niet het native iOS-selectiemenu) en opent dezelfde "Leg uit / Bewaar"-acties. Een
  verticale veeg blijft gewoon scrollen.
- **Gepinde regio's + toetsenbord.** Header en actiebalk blijven staan; bij een geopend
  schermtoetsenbord schuift de app mee zodat het invoerveld (chat, woord-toevoegen, werkwoord)
  zichtbaar blijft. Notch/home-indicator worden met safe-area-marges ontzien.
- **Voorlezen op iOS.** De browserstem wordt binnen de eerste tik (Luister/navigatie) ontgrendeld,
  zodat het automatische voorlezen bij zin-wissel daarna ook op iOS klinkt.
