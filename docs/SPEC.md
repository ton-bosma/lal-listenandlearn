# Functionele & technische specificatie

Dit document beschrijft wat de app moet doen en welke keuzes vastliggen. Het is bedoeld
zodat een nieuwe sessie (zonder de oorspronkelijke chat) het project volledig begrijpt.

## 1. Doel

Een persoonlijke leer-app die een Spaanse tekst (start: het boek *Manolito Gafotas* deel 1)
**zin voor zin** aanbiedt en per zin hulp geeft die de gebruiker zelf, in oplopende diepte,
inroept. Kernidee didactisch: eerst luisteren zonder kruk, en pas méér hulp tonen wanneer je
erom vraagt. Bewuste keuze t.o.v. bestaande apps: die tonen alle hulp tegelijk; hier is het
een gestuurde reeks stappen.

De maker leert zelf Spaans; dit is voorlopig voor eigen gebruik.

## 2. De flow per zin

Altijd beschikbaar, in beide richtingen:

- **◀ Vorige** / **Volgende ▶** — navigeren tussen zinnen.

Progressieve hulp (oplopende diepte), per zin in te roepen:

1. **Luister** — audio van de zin; Spaanse tekst nog verborgen. (Startpunt van elke zin.)
2. **Nog een keer** — audio opnieuw afspelen (zelfde actie als Luister).
3. **Ondertiteld** — de Spaanse zin verschijnt, met **woord-hovers**: hover over een Spaans
   woord → tooltip met de NL-betekenis van dát woord (los woord, buiten context).
4. **NL-zin** — de volledige NL-vertaling verschijnt **onder** de Spaanse zin; de Spaanse zin
   blijft staan mét actieve hovers.
5. **Selecteer + uitleg** (diepste laag, zie §4) — selecteer een willekeurig tekstdeel en laat
   een taalmodel het vertalen én uitleggen (grammatica/constructie/idioom).

### Gedrag bij navigeren

- Terug/verder naar een zin → die zin staat weer **kaal** (niveau "Luister", tekst verborgen).
  Dit is het standaardgedrag.
- **Nice-to-have (later):** een instelling met de keuze tussen "standaard kaal" (default) en
  "achtergelaten stand onthouden" (de zin terugzien zoals je 'm verliet).

## 3. Waarom drie vertaal-/uitleglagen

Google Translate slaat een zin plat naar één vloeiende NL-zin; daarmee verdwijnt de leerstap
(hóe zit het Spaans in elkaar). Een woordenboek is te oppervlakkig. Daarom drie diepten:

1. **Woord-hover** — snel, oppervlakkig (Google Translate, per woord).
2. **NL-zin** — volledige, maar platgeslagen vertaling (Google Translate).
3. **Selecteer + uitleg** — een LLM (Gemini) vertaalt én legt uit. Dit vult precies het gat
   dat Google laat vallen.

## 4. Selecteer + uitleg (LLM)

- De gebruiker selecteert een deel van de Spaanse zin (woord, woordgroep, halve zin).
- Naar het model gaat het **fragment plus de hele zin als context**, met een instructie in de
  geest van: "vertaal dit fragment letterlijk én natuurlijk en leg de constructie uit voor een
  Nederlandstalige die Spaans leert." De exacte prompt wordt later fijngeslepen.
- Model: **Google Gemini** (gratis laag, past bij de "alles via Google"-keuze). ChatGPT/Claude
  kan technisch ook, maar is betaald.

## 5. Bronmateriaal

- Boek: *Manolito Gafotas* deel 1 (Elvira Lindo). **Auteursrechtelijk beschermd.** Wordt als
  **persoonlijk** bronbestand lokaal ingeladen; niet meegeleverd, niet in git (zie
  `.gitignore`: `books/`, `*.pdf`, `*.epub`). De gebruiker heeft een PDF in zijn Downloads.
- PDF is rommeliger dan tekst/EPUB om schoon in zinnen te knippen (pagina-koppen,
  afbreekstreepjes, regelafbrekingen) → opschonen bij inladen (Fase 4).
- Voor de bouw wordt tijdelijk **eigen, vrij te gebruiken dummytekst** gebruikt
  (`src/data/dummyText.ts`) — expliciet NIET uit Manolito.

## 6. Techniekkeuzes (vastgelegd)

| Onderwerp        | Keuze                                                                 |
|------------------|-----------------------------------------------------------------------|
| Frontend         | React + Vite + TypeScript                                             |
| App later        | Capacitor rond dezelfde codebase (web nu, iOS/Android later)          |
| Voorlezen (TTS)  | Gratis browser-stem (Web Speech API). Beviel in de praktijk → **blijft zo**; Google Cloud TTS alleen als optionele upgrade later |
| Accent           | Latijns-Amerikaans (es-MX/es-US/es-419…)                             |
| Snelheid         | Regelbaar (slider)                                                    |
| Vertaling        | Google Cloud Translation (woord-hovers + NL-zin), **lokaal gecached** |
| Uitleg (LLM)     | Google Gemini (gratis laag)                                          |
| Voortgang        | Positie in huidig boek onthouden (localStorage). Meerdere boeken = later |
| Scope v1         | Alleen boek-flow. Video komt later.                                  |

### Architectuur / API-keys

- Voor **persoonlijk, lokaal** gebruik roepen we de Google-API's rechtstreeks vanuit de browser
  aan met een (beperkte) key op de eigen machine. Houdt het een zuivere client-app die
  Capacitor later netjes kan verpakken.
- **Zou de app ooit gedeeld/gepubliceerd worden**, dan is een klein tussenlaagje (proxy) nodig
  om de key te verbergen. Nu niet aan de orde.
- Google-keys: Translate + TTS lopen via een Google **Cloud**-project (key met creditcard aan
  het account, ook voor de gratis laag). Gemini loopt vermoedelijk via **Google AI Studio**
  (aparte, simpele key, vaak zonder creditcard). Dus: zelfde Google-account, waarschijnlijk
  twee keys.
- **Geverifieerd:** Cloud Translation = eerste 500.000 tekens/maand gratis (verloopt niet),
  daarboven $20/miljoen; billing/creditcard verplicht. **Nog te verifiëren vóór Fase 3:**
  gratis-limiet van Gemini. (TTS-limiet niet meer relevant — browser-stem blijft.)

## 7. Toekomst / video (later)

- Video-flow beperkt zich realistisch tot **YouTube** (Netflix is afgeschermd). Transcript +
  timing via bestaande YouTube-captions of **Whisper** (open source, lokaal, gratis, met
  tijdstempels). Zelfde hulplagen als bij tekst.

## 8. Referentie: bestaande apps (context)

Onderdelen van dit idee bestaan al los: **Language Reactor** (gratis; Netflix/YouTube; dubbele
ondertiteling, blur + hover, auto-pauze per zin) komt het dichtst bij de video-kant;
**LingQ** bij de boek-kant (import eigen tekst/EPUB, synced audio, tik-voor-vertaling);
**Lingopie** (betaald, Spaanse TV). Het onderscheidende hier is de gestuurde stappen-didactiek
en boek+video in dezelfde flow.
