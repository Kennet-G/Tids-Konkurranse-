# TROX Konkurranseregistrering

**TROX Konkurranseregistrering** er en app for registrering og tidtaking i TROX Auranor sine konkurranser, for eksempel på stand under VVS-dagene.
Appen er en progressiv webapp (PWA) og virker på **Android-nettbrett og PC** (Chrome eller Edge).

- Den virker **helt uten nett**.
- Den har **ingen server eller sky**: alle data ligger lokalt på enheten.
- Excel-backup lastes automatisk ned til mappen *Nedlastinger*.

Utseendet følger samme TROX-profil som *TROX Kalkulator* og *TROX Planlegger*: farger fra trox.no, marineblå logo
og Segoe UI.

---

## Innhold

1. [Slik virker appen](#slik-virker-appen)
2. [Hvem er admin?](#hvem-er-admin)
3. [Installasjon](#installasjon)
4. [Adminpanelet](#adminpanelet)
5. [Backup, eksport og gjenoppretting](#backup-eksport-og-gjenoppretting)
6. [Sikkerhet og personvern](#sikkerhet-og-personvern)
7. [Utvikling og automatiske tester](#utvikling-og-automatiske-tester)
8. [Sjekkliste før arrangementet](#sjekkliste-før-arrangementet)
9. [Kjente begrensninger](#kjente-begrensninger)

---

## Slik virker appen

### Konkurranser

Forsiden viser **alle konkurranser på denne enheten**. Trykk på en konkurranse for å gjøre den aktiv.
Enheten husker den aktive konkurransen og åpner den direkte neste gang appen startes.

**Ny konkurranse:** Trykk **«+ Ny konkurranse»** og fyll ut:

1. Navn på konkurransen.
2. Tidtaking: ekstern stoppeklokke eller stoppeklokke i appen.
3. Vinnermodus.
4. En **4-sifret PIN**, som du taster to ganger.

**Bytt konkurranse:** Trykk knappen *Bytt konkurranse* øverst til høyre. Du kan også gå via adminpanelet.
Ingen data slettes når du bytter.

Hver konkurranse har egen database, egen PIN, egen hendelseslogg og egne backupfiler.

### Flyten for deltakeren

Registrering skjer manuelt. Appen bruker ikke QR-skanning.

1. Deltakeren trykker **«Registrer deg»** og fyller ut:
   - fornavn, etternavn, firma og e-post (påkrevd)
   - telefon (valgfritt)
   - samtykke (påkrevd)

   **«Lagre»** er grå til alt påkrevd er gyldig.
2. Det som skjer etterpå, avhenger av hvilken tidtaking som er valgt i adminpanelet:
   - **Ekstern stoppeklokke:** Operatøren taster tiden fra stoppeklokka, for eksempel `12,34` eller `1:05,20`,
     og trykker **«Lagre tid»**. Det kreves ingen PIN.
   - **Stoppeklokke i appen:** Deltakeren trykker stor grønn **START**. Når oppgaven er løst, trykker deltakeren
     stor rød **STOPP**. Tiden måles i hundredeler.
3. Grønn skjerm **«Tiden er registrert!»** og vibrasjon vises **først når lagringen er fullført**.
   Ved feil vises en rød skjerm med «Prøv å lagre igjen».
   Etter 20 sekunder går skjermen automatisk tilbake til start.

### Ett forsøk per deltaker

En ny registrering regnes som **samme person** bare når **navn, firma, e-post og telefon** alle er like.
Store og små bokstaver, ekstra mellomrom og telefonformat spiller ingen rolle, så `+47 912 34 567` og `91234567`
regnes som samme nummer.

Flere personer kan altså ha samme navn, eller dele e-post eller telefon, for eksempel `post@firma.no`. Slike
deltakere merkes med «Delt kontakt» i adminpanelet, som informasjon.

- **Har deltakeren allerede fått en tid**, vises *«Du har allerede hatt forsøket ditt, [fornavn]!»*.
  Forsøket på ny registrering logges, og deltakeren merkes med «Prøvde igjen» i adminpanelet.
- **Er deltakeren registrert, men har ikke fått tid** (for eksempel hvis operatøren trykket «Avbryt – tiden legges
  inn senere»), sendes deltakeren rett videre til forsøket. Det opprettes ingen dobbel registrering.
- **Slettes deltakerens tid i adminpanelet**, kan deltakeren få et nytt forsøk.

### Publikumsskjermen

Publikumsskjermen **viser aldri tider, rangering eller ledere**. Det eneste unntaket er tiden operatøren selv taster
inn, mens den tastes.

### Robusthet

- Alt lagres som en append-only hendelseslogg: registreringer, tider, endringer, slettinger og kåring.
  Ingenting forsvinner fra loggen. Når en tid «slettes», lagres det som en ny hendelse.
- Et halvutfylt skjema og et pågående forsøk overlever at siden lastes på nytt, at appen krasjer eller at enheten
  startes på nytt.
- Skjermen holdes våken (Wake Lock).

---

## Hvem er admin?

**Den som kjenner PIN-koden til konkurransen er admin for den konkurransen.**

- PIN-koden velges av den som oppretter konkurransen. Den er **4 sifre** og gjelder **bare den ene konkurransen**.
- Det finnes ingen felles «superadmin» og ingen bakdør.
- Adminpanelet åpnes med knappen **Admin** øverst til høyre, og krever PIN.
- PIN lagres bare som en saltet hash (PBKDF2), aldri i klartekst. Den er heller aldri med i hendelsesloggen eller
  i Excel-filene.
- Etter 5 feil forsøk sperres PIN-tastaturet i 60 sekunder. Feil forsøk logges.
- Adminpanelet lukkes automatisk etter 5 minutter uten aktivitet.
- **Endre PIN:** *Admin → Innstillinger og backup → Endre PIN*. Krever nåværende PIN.
- **Glemt PIN?** Det finnes ingen bakdør, så skriv PIN-en ned. Dataene er likevel ikke tapt:
  1. Ta den nyeste backupfilen fra *Nedlastinger*.
  2. Velg *Gjenopprett fra backup* på en annen enhet eller i en annen nettleser.
  3. Velg en ny PIN der.

---

## Installasjon

Kamera trengs ikke lenger, men offline-funksjonen krever at appen åpnes **én gang fra en HTTPS-adresse**.
Etter det trengs ikke nett.

### 1. Legg filene ut på en HTTPS-adresse (én gang)

Det enkleste er **GitHub Pages** fra dette repoet:

1. På GitHub: *Settings → Pages → Build and deployment → Source: Deploy from a branch*.
2. Velg grenen og mappen `/ (root)`, og trykk *Save*.
3. Etter et par minutter ligger appen på `https://kennet-g.github.io/Tids-Konkurranse-/`.

Merk:

- **Private repoer** krever betalt GitHub-abonnement for Pages.
- Repoet kan trygt gjøres offentlig. Det inneholder bare kode, ingen deltakerdata.
- Last aldri opp backupfiler til GitHub. `.gitignore` stopper `.xlsx`-filer.

> **Viktig:** Data lagres per adresse og per enhet. Bruk **samme adresse** hele tiden.

### 2a. Android-nettbrett

1. Åpne adressen i **Chrome**.
2. Velg **⋮ → «Installer app»**.
3. Start appen fra ikonet på startskjermen. Den åpnes i fullskjerm.
4. Opprett konkurransen og velg PIN.
5. Slå på **flymodus** og start appen på nytt for å bekrefte at den virker uten nett.

### 2b. PC (Windows/Mac)

1. Åpne adressen i **Chrome** eller **Edge**.
2. Klikk installer-ikonet i adressefeltet (eller *⋯ → Apper → Installer*). Appen får et eget vindu og en snarvei.
3. Backupfilene havner i PC-ens *Nedlastinger*-mappe.
4. Alt kan styres med mus og tastatur. Enter lagrer skjemaer, og PIN kan tastes på tastaturet.

Til testing på PC uten nett kan du kjøre `npm start` og åpne `http://localhost:8080`. Data lagres da per adresse,
så `localhost` og GitHub Pages har hver sine data.

### Høykant eller liggende?

**Anbefalt: høykant (stående).**

- Med skjermtastaturet oppe får hele registreringsskjemaet plass over tastaturet: alle felt, samtykke og «Lagre».
- Skjemaet vises i én kolonne, så det er lett å fylle ut stående ved standen.

**Liggende fungerer også**, men tastaturet tar omtrent halve skjermen.

- Appen gjør da toppfeltet og skjemaet mer kompakt, og feltet du skriver i holdes synlig.
- Liggende passer best hvis dere bruker stoppeklokken i appen, fordi START- og STOPP-knappene blir større.

Uansett retning bør du **låse rotasjonen** på nettbrettet (hurtiginnstillinger → «Rotasjonslås»), så skjermen ikke snur
seg midt i en registrering.

**Skjermtastaturet er tilpasset hvert felt:**

| Felt | Tastatur |
|---|---|
| Navn og firma | Stor forbokstav |
| E-post | @-tastatur |
| Telefon | Talltastatur |
| Tid | Talltastatur med komma. Over ett minutt kan tiden skrives som sekunder, f.eks. `65,20`. |

«Neste» på tastaturet hopper til neste felt, og etter telefonfeltet lukkes tastaturet.

**Personvern på delt nettbrett:** Slå av autoutfylling i Chrome (*Innstillinger → Adresser og mer* og
*Betalingsmåter* → av). Slå også av ordforslag og innlæring av nye ord i tastaturet (Gboard: *Innstillinger →
Retting av tekst / Forslag*). Da foreslår ikke nettbrettet navn og e-post fra forrige deltaker.

### Anbefalte innstillinger på nettbrettet

- **Automatiske nedlastinger:** Første gang en backup lastes ned, svarer du **Tillat** hvis Chrome spør om
  nettstedet kan laste ned flere filer.
- **Batterioptimalisering:** Slå den av for Chrome. Hold nettbrettet tilkoblet lader.
- **Lås appen til skjermen:** Bruk *«Fest app» / «App pinning»* slik at besøkende ikke kommer ut av appen.

### Oppdatere appen senere

1. Øk `VERSION` i `sw.js`.
2. Neste gang appen åpnes med nett, hentes den nye versjonen.

Dataene påvirkes ikke.

---

## Adminpanelet

| Fane | Innhold |
|---|---|
| **Deltakere** | Full liste med søk (navn, firma, e-post, telefon, nr) og sortering. **«+ Ny deltaker»** lar admin registrere en deltaker direkte. Trykk på en deltaker for å rette kontaktinfo og se, endre, slette eller legge til tider. |
| **Tider** | Alle tider med filter (gyldige, ugyldige, slettede, alle) og knappene **Endre**, **Ugyldig/Gyldig** og **Slett**. Endring og sletting krever en årsak, og alt logges med gammel og ny verdi. |
| **Resultat** | Statistikk (deltakere, tider, beste tid, median), vinnermodus, topp 5 og **«Kåre vinner»**. Kåring låser og logger resultatet og tar en backup. |
| **Hendelseslogg** | Hele loggen med søk. |
| **Innstillinger og backup** | Se under. |

Innholdet i fanen **Innstillinger og backup**:

- **Tidtaking:** stoppeklokke i appen eller ekstern stoppeklokke. Kan byttes når som helst, også midt i konkurransen.
- Navn på konkurransen.
- **Endre PIN** og **Bytt konkurranse**.
- Excel-eksport og import, som slår sammen data fra en annen enhet.
- Status for lagring, Wake Lock og offline-modus.
- **Slett konkurransen.**

**Slette tider:** En slettet tid fjernes fra lister, statistikk og vinnerberegning, og deltakeren kan få et nytt
forsøk. Hendelsen blir likevel stående i hendelsesloggen, og tiden står merket *SLETTET* i Excel-fanen
*Forsøk*. Slik kan sletting alltid etterprøves.

**Ugyldig** er et mildere alternativ: tiden vises fortsatt, men teller ikke i resultatet, og deltakeren har likevel
brukt forsøket sitt.

**Vinnermodus:**

1. **Beste tid** – den raskeste gyldige tiden vinner.
2. **Nærmest median** – den tiden som ligger nærmest medianen av alle gyldige tider, vinner.

Ved likhet vinner den som registrerte seg først. Det merkes tydelig som **UAVGJORT**.

**Slette en konkurranse** kan bare gjøres inne i konkurransens eget adminpanel:

1. Gå til *Innstillinger og backup → Slett konkurransen*.
2. Skriv **SLETT**.
3. Tast PIN.
4. En siste Excel-backup lastes ned automatisk. Deretter slettes alle data for konkurransen fra enheten.

Andre konkurranser berøres ikke.

---

## Backup, eksport og gjenoppretting

### Hvor lagres dataene?

1. **Hovedlageret er IndexedDB** i nettleseren på enheten. Hver registrering og tid skrives dit **med en gang**.
   Hele listen er alltid tilgjengelig i adminpanelet, også uten nett.
2. **Excel-backup** er en ekstra sikring. Appen laster ned en komplett `.xlsx`-fil til *Nedlastinger*:
   - **hver time, men bare hvis noe er endret** siden forrige backup
   - etter hver 10. registrering
   - når en vinner kåres
   - før en konkurranse slettes
   - når du trykker «Eksporter Excel nå»

Hver backup er en **ny fil**, så ingenting overskrives. Filnavnet inneholder konkurransenavn og tidspunkt, for
eksempel `TROX_VVS-dagene-2026_2026-10-21_1430.xlsx`. Den nyeste filen er alltid komplett.

Kopier filene jevnlig til en annen plass, for eksempel en PC eller minnepinne. Hvis nettbrettet blir borte, forsvinner
også filene i *Nedlastinger*.

### Excel-filen har fire faner

| Fane | Innhold |
|---|---|
| **Deltakere** | Nr, navn, firma, e-post, telefon, samtykke, registreringstid og tid |
| **Forsøk** | Alle tider med metode, status (gyldig, ugyldig eller slettet), årsak og endringer |
| **Hendelseslogg** | Komplett logg. Denne fanen brukes ved gjenoppretting og må ikke redigeres. |
| **Resultat** | Konkurransenavn, statistikk, kåret vinner og rangering |

### Gjenoppretting

**På en ny enhet, eller etter sletting:**

1. Gå til forsiden og velg **«Gjenopprett fra backup …»**.
2. Velg den nyeste filen.
3. Velg en ny PIN.

Konkurransen kommer tilbake med alle deltakere og tider.

**Slå sammen to enheter:**

1. Åpne konkurransen på den ene enheten.
2. Gå til *Admin → Innstillinger og backup → Importer*.
3. Velg backupfilen fra den andre enheten.

Bare hendelser som mangler, blir lagt til, så samme fil kan trygt importeres flere ganger.

---

## Sikkerhet og personvern

- Deltakerdata finnes bare på enheten og i backupfilene. Behandle backupfilene som personopplysninger, og slett dem
  når oppfølgingen er ferdig (GDPR).
- Samtykketeksten ligger i `CONSENT_TEXT` i `app/ui/public.js`, og lagres sammen med hver registrering.
  Avklar teksten med TROX sin personvernansvarlige.
- Repoet inneholder bare kode. Det kan være offentlig uten at deltakerdata blir tilgjengelig.

---

## Utvikling og automatiske tester

Krever Node.js 20 eller nyere.

```bash
npm install     # testverktøy (fake-indexeddb) og SheetJS
npm test        # alle automatiske tester
npm start       # lokal server på http://localhost:8080
```

```
index.html, manifest.webmanifest, sw.js   Inngang, PWA-manifest, offline-cache
app/core/        Ren logikk (testes): hendelser, validering, tid, statistikk/vinner, Excel, database, konkurranser, PIN
app/services/    Lagring per konkurranse, backup, Wake Lock
app/ui/          Konkurranseliste, publikumsskjerm, adminpanel, PIN-dialog
app/styles/      theme.css (ALLE farger – TROX-profil) og app.css
lib/             SheetJS 0.18.5 (lokalt, ingen CDN)
assets/          logo.png (TROX-logo, samme som TROX Kalkulator), app-ikoner
tests/           Automatiske tester + lokal server
```

| Testfil | Dekker |
|---|---|
| `validation.test.js` | Skjema, e-post, telefon og samtykke |
| `registration.test.js` | Konkurranseoppsett, tidtaking av/på, registrering, samme person bare ved likt navn, firma, e-post og telefon, ett forsøk per deltaker, endre og slette tid, ugyldig/gyldig, retting av kontaktinfo |
| `time.test.js` | Hundredeler, formatering, tolking av tid, filnavn |
| `winner.test.js` | Median, statistikk, begge vinnermoduser, uavgjort, slettede og endrede tider, ytelse med 1500 deltakere |
| `restore.test.js` | Excel-eksport (fire faner, ingen formler), gjenoppretting, ingen duplikater, sammenslåing |
| `registry.test.js` | Flere konkurranser med egen PIN og egne data, aktiv konkurranse, sletting som ikke berører andre konkurranser |
| `db.test.js` | IndexedDB: rekkefølge, unike hendelser, atomiske skrivinger |
| `backup.test.js` | Backup hver time, men bare når noe er endret |
| `pin.test.js` | 4-sifret PIN og hashing |
| `offline.test.js` | At alle filer caches for offline bruk, at det ikke finnes CDN-lenker, og at publikumsskjermen ikke viser tider |

---

## Sjekkliste før arrangementet

**Oppsett**

- [ ] Samtykketeksten er godkjent av TROX.
- [ ] `npm test` går grønt.
- [ ] Appen er publisert på HTTPS og installert («Installer app») på nettbrettet eller PC-en.
- [ ] Konkurransen er opprettet med riktig navn, tidtaking og vinnermodus.
- [ ] PIN er skrevet ned og oppbevart trygt.
- [ ] *Admin → Innstillinger og backup* viser grønt for: **Vedvarende lagring = Ja**, **Offline-klar = Ja**,
      **Skjerm holdes våken = Aktiv**.
- [ ] Flymodus er på og appen startet på nytt: alt virker.
- [ ] Batterioptimalisering er av, nettbrettet står på lader, og app-festing er på.
- [ ] Rotasjonen er låst (helst høykant), og autoutfylling i Chrome og ordforslag i tastaturet er slått av.
- [ ] Fyll ut skjemaet med skjermtastaturet: alle felt og «Lagre» kan nås uten å lukke tastaturet.

**Funksjonstest (med testdeltakere)**

- [ ] «Lagre» er grå til alle påkrevde felt er gyldige og samtykke er krysset av.
- [ ] Ekstern stoppeklokke: Registrer → tast tid → grønn skjerm. Ingen tid vises etter lagring.
- [ ] Registrer nøyaktig samme navn, firma, e-post og telefon på nytt → «Du har allerede hatt forsøket ditt».
- [ ] Registrer samme navn med annen e-post → godtas som ny deltaker.
- [ ] Slå på **stoppeklokke i appen** i admin → START/STOPP vises for neste deltaker.
- [ ] Trykk START → lukk appen → åpne igjen → forsøket er gjenopprettet, og STOPP virker.
- [ ] Fyll ut halve skjemaet → last siden på nytt → skjemaet er der fortsatt.
- [ ] Admin: Endre en tid, merk en tid ugyldig og slett en tid. Alt vises i hendelsesloggen.
- [ ] Resultat: Topp 5 stemmer for begge vinnermoduser.
- [ ] Eksporter Excel → filen ligger i *Nedlastinger* og åpnes i Excel.
- [ ] **Gjenoppretting er testet:** Velg *Gjenopprett fra backup* på en annen enhet eller i et inkognitovindu på PC.

**Rett før start**

- [ ] Fjern testdataene: slett testkonkurransen fra adminpanelet og opprett den ekte konkurransen.

**Etterpå**

- [ ] Kår vinner (dette låser og logger resultatet) og ta en siste eksport.
- [ ] Kopier backupfilene til et trygt sted, og slett dem når oppfølgingen er ferdig.

---

## Kjente begrensninger

- **SheetJS 0.18.5** er den siste versjonen på npm. Den har kjente svakheter ved lesing av **ukjente** regneark.
  Appen leser bare sine egne backupfiler, men importer aldri regneark fra ukjente kilder.
- **Profilfarger** er hentet fra TROX Kalkulator, som igjen bygger på trox.no. Ved motstrid gjelder TROX sin
  profilhåndbok. Alle farger ligger i `app/styles/theme.css`.
- **Tidtaking i appen** måler tiden mellom to trykk. Presisjonen er bedre enn én hundredel, men reaksjonstiden til
  den som trykker, spiller inn, akkurat som med en vanlig stoppeklokke.
