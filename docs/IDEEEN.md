# Ideeën & wensen — LAL (Listen And Learn)

Dit document is van mij (Ton): waar de app voor is, wat ik ermee wil, en de ideeën die nog
open staan — in mijn eigen woorden, zonder implementatie-details. Wat de app nú feitelijk
doet staat in [FUNCTIES.md](FUNCTIES.md); hoe het technisch werkt in [TECHNIEK.md](TECHNIEK.md).

Ideeën die oorspronkelijk van Claude kwamen staan hieronder apart gemarkeerd, zodat het
verschil tussen mijn wensen en aangedragen ideeën herkenbaar blijft.

---

## Kernidee — waarom deze app

- Een persoonlijke leer-app die een Spaanse tekst (start: *Manolito Gafotas* deel 1) **zin voor
  zin** aanbiedt, met hulp die ik zelf in **oplopende diepte** inroep. Didactische kern: eerst
  luisteren zonder kruk, en pas méér hulp tonen wanneer ik erom vraag. Bewust anders dan
  bestaande apps, die alle hulp tegelijk tonen — hier is het een gestuurde reeks stappen.
- **Drie vertaal-/uitleglagen**, omdat Google Translate een zin platslaat en de leerstap (hóe
  zit het Spaans in elkaar) dan verdwijnt: woord-hover (oppervlakkig) → NL-zin (volledig maar
  platgeslagen) → selecteer + LLM-uitleg (vult precies dat gat).
- Ik leer zelf Spaans; voorlopig voor eigen gebruik. De app is qua mechaniek taal-onafhankelijk
  bedoeld — daarom heet de repo generiek **lal-listenandlearn** (Listen And Learn).

## De leesflow per zin (vastgelegd)

- Navigatie **◀ Vorige / Volgende ▶**.
- Progressieve hulp: **Luister** → **Ondertiteld** (Spaanse zin + woord-hovers) → **NL-zin**
  (volledige vertaling eronder, Spaans blijft staan) → **Selecteer + uitleg** (LLM).
- Bij navigeren komt een zin standaard weer **kaal** terug (niveau "Luister").

---

## Wensen uit deze werksessie — gerealiseerd

Mijn ideeën die in deze sessie zijn gebouwd (het "hoe" staat in FUNCTIES.md):

- **Oefenmodus met flashcards** vanuit de woordenlijst.
- Bij de **AI-voorbeeldzin**: een fout beoordeelde zin moet terugkomen — en dan **dezelfde**
  zin, want in de zinnen zitten soms woorden die ik nog niet ken, dus ik wil die zin een keer
  goed hebben. En de volgende zin vast **vooruit laten verzinnen**, dat scheelt tijd.
- **Full-screen schermen i.p.v. de sidebar**: als ik oefenen kies hoef ik niet ook het
  hoofdscherm te zien, en zo is er meer ruimte om functionaliteit toe te voegen. Route:
  **leesscherm → keuzescherm → oefening- of onderhoudscherm**. De oefening-types staan op het
  keuzescherm; elke oefening heeft z'n eigen scherm. **Terug = een stap terug in de
  schermdiepte.** Icoon voor oefenen: **🎯**.
- In de oefenzin **dezelfde mouseover + klik** als op het hoofdscherm (hover = vertaling van
  een woord, klik = markeren/toevoegen); de **reveal wordt een eigen knop**. Als de vertaalde
  zin getoond wordt: **klik op die zin = terug naar het origineel**.
- **Woordenlijst**: een **filter** (op alles — Nederlands én Spaans), **voortgang tonen**, en
  **toevoegen met AI**: op basis van een Nederlands woord een Spaans woord toevoegen, of een
  Spaans woord/frase door AI laten vertalen (Google Translate doet losse woorden soms raar).
  Automatisch, met **omkeer-mogelijkheid**, **met bevestiging**, en een **voorbeeldzin** zodat
  het in sync loopt met de andere woorden.
- Bij het oefenen ook een **AI-chatsessie** kunnen doen, via **hetzelfde scherm** als de
  bestaande uitleg-chat: vanuit het keuzescherm een **vrije chat** starten, of vanuit een
  AI-uitleg **doorschakelen naar de chat met terugkeer** naar waar je vandaan kwam. Eén
  endpoint; de vrije vraag is bedoeld voor taal leren; elke keer **vers beginnen**.
- **Twee app-brede geluidsinstellingen** (voorlezen = ontvangen, microfoon = produceren) + de
  **stille-leesmodus-fallback** (voorlezen uit → tekst meteen zichtbaar, Luister-knoppen weg).
  De mic-toggle staat al klaar maar is nog **inert**, voor de komende spraak-oefeningen. De
  **fallback-regel** (nooit een doodlopend pad als een geluidsoptie uitstaat) geldt verder
  voor alles wat nog komt.
- **Material Icons** als standaard-iconenset door de hele app.

---

## Nog open — mijn ideeën

### Oefenvormen (naast de twee bestaande flashcard-oefeningen)
- **Matching-spel** (twee rijen Spaans ↔ betekenis, paren vormen, Duolingo-stijl).
- **Cloze / invuller**.
- **Meerkeuze**.
- **NL → ES produceren** (nu alleen Spaans → Nederlands, receptief).
- **AI-beoordeling van vrije (getypte) antwoorden**.
- **Tijd-gebaseerde SRS-planning** (nu alleen Leitner-box, geen tijdstip).
- **Ronde begrenzen** tot bijv. 10 kaarten (nu de hele lijst).

### Werkwoorden oefenen (vervoegingen + clitic-combi's)
Het hoofddoel achter woordtypes: gericht **werkwoorden** kunnen oefenen — het venijnigste stuk
Spaans.
- **Twee richtingen, twee menu-items**: Spaans → Nederlands en Nederlands → Spaans (zoals de
  flashcards).
- **Vervoegingen eerst** (de werkwoordsvormen per persoon/tijd), en de **clitic-combi's** als
  aparte laag erbij zodra dat staat — werkwoord + aangehecht/voorgeplaatst voornaamwoord:
  "het/hem/haar" (lo/la/le) en "zich" (se), zoals *decirle, decírselo, levantarse, dímelo,
  se lo digo*.
- **Gesproken antwoord als optie** (de AI keurt goed/fout), met fallback naar typen of
  zelf-beoordelen (zie de geluid-regel hieronder).
- **Voeding**: de werkwoorden uit mijn woordenlijst. Daarvoor moet de app het **woordtype +
  de infinitief** kennen — de AI bepaalt dat bij toevoegen en bij markeren in de tekst (voor
  zelfstandige naamwoorden idem het geslacht/lidwoord); bestaande woorden kunnen in één
  AI-pass alsnog geclassificeerd worden. *(Open: mag de AI ook losse werkwoorden aandragen,
  of strikt uit de lijst?)*
- Woordtypes maken meteen ook **filteren/ordenen** van de lijst per type mogelijk.

**Route (afgesproken volgorde):**
1. **Woordtype + infinitief-fundament** — de AI bepaalt bij toevoegen én bij markeren in de
   tekst het type (werkwoord / zelfstandig / …) en voor werkwoorden de infinitief; opslaan als
   veld op het woord. Levert meteen filteren per type op.
2. **Werkwoorden-oefening — vervoegingen, beide richtingen** (twee menu-items), met
   zelf-beoordelen/typen als basis.
3. **Gesproken antwoord** (SpeechRecognition, gate't op de mic-toggle) en de **clitic-combi's**
   als lagen erbovenop.

### Vocabulaire vooraf (front-loading), aanzetbare optie
- De app kijkt X woorden / N zinnen vooruit en biedt de **lastige woorden** eerst aan — als
  vertaallijst óf als matching-spel. "Lastig" bepalen via een frequentielijst, Gemini, of mijn
  nog-niet-geziene/gemarkeerde woorden. Toggle in de instellingen.

### Spreken & uitspraak
- **Spreken + AI-beoordeling (produceren) — "Duolingo on steroids".** Ik spreek het antwoord
  in en de AI / woordherkenning keurt het goed of fout — zowel **Nederlands → Spaans** als
  andersom, en niet alleen losse woorden maar ook **hele zinnen**.
- **Uitspraak-check, twee-traps:**
  - Gratis, mild (Duolingo-stijl): browser `SpeechRecognition` (lang `es`) → transcriptie
    fuzzy vergelijken met de doelzin → ✓/✗. Bewust vergevingsgezind = motiverend.
  - Upgrade — echte scores: Azure Speech **Pronunciation Assessment** (per woord/foneem;
    aparte key). Doorbreekt "alles via Google", want daar heeft Google geen goede dienst voor.

### Lezen & boeken
- **Taal als instelling (generiek maken):** bron-/doeltaal instelbaar zodat andere
  talencombinaties werken (nu hard Spaans → Nederlands).
- **Instelling "achtergelaten stand onthouden"** i.p.v. altijd kaal terug.
- **Meerdere boeken** bewaren + kiezen (nu één "current"; voortgang dan per boek).
- **"Terug naar demotekst"** als expliciete knop.
- **Dialoog-splitsing:** lange ratelzinnen met gedachtestreepjes (—) eventueel extra splitsen
  als het bij het lezen stoort.

### Groot, veel later
- **Video-flow:** echte sprekers leren verstaan, niet alleen nette TTS. Realistisch beperkt tot
  **YouTube** (Netflix afgeschermd); transcript + timing via YouTube-captions of **Whisper**
  (lokaal, gratis, met tijdstempels); dezelfde hulplagen als bij tekst. Gotcha's: scène-grenzen,
  door elkaar pratende sprekers, ontbrekende zinsgrenzen in spraak.

---

## Nog open — ideeën van Claude (afgekeken van andere apps)

- **Karaoke-highlight tijdens voorlezen** *(top-2)*: woord licht op terwijl de stem leest.
- **Bekende/onbekende woorden kleuren + dekkingspercentage** *(top-2, LingQ-kern)*: "je kent
  X% van dit boek" helpt materiaal op niveau kiezen; voedt de overhoor-SRS.
- **Flow-/extensief-modus:** auto-doorlezen + voorlezen zonder aansporing tot opzoeken.
- **Leesstatistieken + streak** (woorden gelezen / nieuwe woorden / dagen op rij).
- **Steun-niveau / hulp afbouwen (globaal):** tekst+audio → alleen audio → snelheid richting
  native.
- **Chunk/collocatie-herkenning:** vaste woordgroepen markeren/opslaan.
- **pdfjs lui laden** (dynamic import), zodat de grote worker pas bij "Boek laden" binnenkomt.
- **Realisme-ladder voor spraak** (context): browser-stem → Cloud TTS neuraal/HD → echte
  menselijke spraak. Een nette TTS verstaan ≠ een echte Spanjaard/Mexicaan verstaan.

---

## Referentie: bestaande apps (context)

Onderdelen van dit idee bestaan al los: **Language Reactor** (Netflix/YouTube; dubbele
ondertiteling, blur + hover, auto-pauze) komt het dichtst bij de video-kant; **LingQ** bij de
boek-kant (eigen tekst/EPUB, synced audio, tik-voor-vertaling); **Lingopie** (Spaanse TV). Het
onderscheidende hier is de gestuurde stappen-didactiek en boek + video in dezelfde flow.
