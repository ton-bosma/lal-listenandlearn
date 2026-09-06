# LAL — werkwijze deze repo

## Context klein houden / delegeren
* Default: lees-/scan-/grep-/parse-werk waarvan de output niet in main hoeft →
  background-agent (`run_in_background: true`), compact laten rapporteren.
* Direct in main lezen alleen als ik de exacte tekst nu nodig heb voor een edit.
* Parallelliseer: splits werk in meerdere agents op sub-scopes i.p.v. één lange.
* Model per call kiezen: mechanisch (mv/grep/verbatim lezen) → file-mechanic (haiku);
  één doc samenvatten/parsen → general-purpose (sonnet); cross-referencing → opus.

## Bouwen in deze codebase (valkuilen)
* Backend `server/index.js` draait als node **zonder watch** → na wijziging killen +
  opnieuw starten; client pakt Vite/HMR vanzelf.
* AI-endpoints hebben een `*_PROMPT_VERSION`-constante als cache-buster; ophogen bij
  prompt-wijziging.
* Nieuwe AI-features bij voorkeur via een agent op `server/index.js` bouwen
  (raakt geen client-bestanden → geen edit-conflict met main).
* Dev draaien: `HOME="$USERPROFILE" npm run dev` (Vite :5173 + backend :3001).
