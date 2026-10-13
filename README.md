# TROX tidskonkurranse – VVS-dagene 2026 (stand D02-05)

Registrerings- og tidtakingsapp for TROX Auranor sin stand. Appen er en progressiv webapp (PWA) som kjører i
Chrome på et Android-nettbrett. Den virker **helt uten nett** og har **ingen server eller sky**: alle data
ligger lokalt på nettbrettet (IndexedDB), og det tas automatisk Excel-backup til mappen *Nedlastinger*.

---

## Innhold

1. [Slik virker appen](#slik-virker-appen)
2. [Mappestruktur](#mappestruktur)
3. [Installasjon på nettbrettet](#installasjon-på-nettbrettet)
4. [PIN-oppsett](#pin-oppsett)
5. [Adminportalen](#adminportalen)
6. [Eksport, backup og gjenoppretting](#eksport-backup-og-gjenoppretting)
7. [Sikkerhet og personvern](#sikkerhet-og-personvern)
8. [Utvikling og automatiske tester](#utvikling-og-automatiske-tester)
9. [Sjekkliste før messa](#sjekkliste-før-messa)
10. [Kjente begrensninger](#kjente-begrensninger)

---

## Slik virker appen

**Flyt på standen:**

1. Deltakeren holder QR-koden på messemerket foran **bakkameraet**. Hvis koden ikke kan leses, trykk
   **«Tast inn ID manuelt»**.
2. **Ukjent ID** → registreringsskjemaet åpnes automatisk: fornavn, etternavn, firma, e-post (påkrevd),
   telefon (valgfritt) og samtykke (påkrevd). **«Lagre»** er grå til alt påkrevd er gyldig.
   Hvis e-posten allerede finnes på et annet ID, vises et varsel om mulig dobbeltregistrering,
   og operatøren kan velge å fortsette.
3. **Kjent ID** → skjemaet hoppes over, og navnet vises for bekreftelse («Er dette deg?»).
4. Tidtaking: stor grønn **START** → stor rød **STOPP**. Tiden måles i hundredeler fra selve trykket.
5. Grønn skjerm **«Tiden er registrert!»** og vibrasjon vises **først når lagringen er fullført**.
   Ved feil vises en rød skjerm med «Prøv å lagre igjen».
6. **«Nytt forsøk»** gir et nytt forsøk for samme deltaker. Alle forsøk lagres.

**Manuell tid:** På tidtakingsskjermen finnes «Tast inn tid manuelt». Den krever PIN, siden tider aldri skal
vises på publikumsskjermen. Formatet er for eksempel `12,34` eller `1:05,20`.

**Publikumsskjermen viser aldri tider, rangering eller ledere.** Den viser bare TROX-profil, instruksjoner,
registreringsskjema og «Du er registrert, [fornavn]!». Tider vises bare i adminportalen.

**Robusthet:**

- Alt lagres som en append-only hendelseslogg: skanninger, registreringer, tider, endringer og kåring.
  Ingenting slettes. Rettelser lagres som nye hendelser som overstyrer de gamle.
- Et halvutfylt skjema og et pågående forsøk overlever sideoppdatering, krasj og omstart.
  Klokka fortsetter å gå selv om appen lukkes mens et forsøk pågår.
- Skjermen holdes våken (Wake Lock).
- Statuslinjen øverst til høyre viser *Lagring OK*, tidspunkt for siste backup og *Skjerm våken*.

---

## Mappestruktur

```
index.html              Inngangsside (må ligge i roten for PWA/service worker)
manifest.webmanifest    PWA-manifest (liggende, fullskjerm)
sw.js                   Service worker – cacher alle filer for offline bruk
app/
  main.js               Oppstart
  core/                 Ren logikk (testes): hendelser, validering, tid, statistikk/vinner, Excel, database, PIN
  services/             Lagring/økt, backup, QR-skanner, Wake Lock
  ui/                   Publikumsskjerm, adminportal, PIN-dialog, hjelpere
  styles/theme.css      ALLE fargekoder (TROX-profil) samlet her
  styles/app.css        Layout og komponenter
lib/                    Lokale biblioteker: html5-qrcode 2.3.8, SheetJS 0.18.5 (med lisenser)
assets/                 logo.svg (plassholder – byttes med offisiell logo), app-ikoner
tests/                  Automatiske tester + enkel lokal webserver (serve.js)
```

**Logo:** Erstatt `assets/logo.svg` med den offisielle TROX-logoen. Behold filnavnet.
**Farger:** Juster `app/styles/theme.css` mot TROX sin profilmanual om nødvendig.

---

## Installasjon på nettbrettet

Kamera og offline-funksjon krever at appen åpnes fra en **HTTPS-adresse** én gang. Etter installasjonen
trenger appen ikke nett.

### 1. Legg filene ut på en HTTPS-adresse (én gang)

Det enkleste er **GitHub Pages** fra dette repoet:

1. På GitHub: *Settings → Pages → Build and deployment → Source: Deploy from a branch*.
2. Velg grenen og mappen `/ (root)`, og trykk *Save*.
3. Etter et par minutter ligger appen på `https://<bruker>.github.io/<repo>/`.

Alle andre statiske HTTPS-verter virker også (for eksempel Netlify eller en intern webserver). Mappen
`node_modules` skal ikke lastes opp.

> **Viktig:** Data lagres per adresse. Bruk **samme adresse** under hele messa. Ny adresse betyr tom app,
> og da må dataene gjenopprettes fra en backup.

### 2. Installer på nettbrettet

1. Koble nettbrettet til nett og åpne adressen i **Chrome**.
2. Velg **⋮ → «Installer app»** (eller «Legg til på startsiden»).
3. Start appen fra ikonet på startskjermen. Den åpnes i fullskjerm og liggende format.
4. Tillat **kamera** når Chrome spør.
5. Vent noen sekunder til appen er ferdig lastet. Slå deretter på **flymodus** og start appen på nytt for å
   bekrefte at den virker uten nett.
6. Åpne adminportalen og sjekk under *Backup og system* at disse er grønne:
   - **Vedvarende lagring: Ja**
   - **Offline-klar: Ja**

### 3. Innstillinger på nettbrettet (anbefalt)

- **Automatiske nedlastinger:** Første gang en automatisk backup lastes ned, kan Chrome spørre om
  nettstedet får laste ned flere filer. Svar **Tillat**.
  Kontroller dette under Chrome → *Innstillinger → Nettstedsinnstillinger → Automatiske nedlastinger*.
- **Batterioptimalisering:** Slå den av for Chrome (*Innstillinger → Apper → Chrome → Batteri → Ubegrenset*).
- **Skjerm:** Sett tidsavbrudd til maks og lysstyrke høyt. Hold nettbrettet tilkoblet lader hele dagen.
- **Lås appen til skjermen:** Bruk Androids *«Fest app» / «App pinning»* (*Innstillinger → Sikkerhet*), slik at
  besøkende ikke kan forlate appen.
- **Rotasjon:** Lås skjermen i liggende retning.
- **Oppdateringer:** Slå av automatiske systemoppdateringer under messa.

### Oppdatere appen senere

Når filene endres, må `VERSION` i `sw.js` økes (for eksempel `v1.0.1`). Nettbrettet henter den nye versjonen
neste gang appen åpnes med nett. Dataene påvirkes ikke.

---

## PIN-oppsett

- Adminportalen åpnes ved å **holde fingeren på TROX-logoen i 2 sekunder**.
- **Første gang** blir du bedt om å velge en PIN på 4–8 sifre og gjenta den. Gjør dette **før messa**, slik at
  ingen besøkende rekker å sette PIN.
- PIN lagres bare som en saltet hash (PBKDF2), aldri i klartekst, og aldri i hendelsesloggen eller Excel-filene.
- **Endre PIN:** *Adminportal → Backup og system → Endre PIN*. Dette krever nåværende PIN.
- Etter 5 feil forsøk sperres PIN-tastaturet i 60 sekunder. Feil forsøk logges.
- Adminportalen lukkes automatisk etter 5 minutter uten aktivitet.
- **Glemt PIN?** Det finnes ingen bakdør. Skriv PIN-en ned og oppbevar den trygt. I nødstilfeller:
  1. Ta en eksport hvis mulig. Automatiske backuper ligger uansett i *Nedlastinger*.
  2. Slett nettstedsdata for appen i Chrome.
  3. Velg ny PIN.
  4. Importer siste backup.

---

## Adminportalen

| Fane | Innhold |
|---|---|
| **Deltakere** | Full liste med søk (navn, firma, e-post, telefon, ID) og sortering ved trykk på kolonnetittel. Trykk på en rad for å rette kontaktinfo, se alle forsøk, merke forsøk ugyldig/gyldig (krever årsak) og legge til tid manuelt. |
| **Forsøk** | Alle forsøk med filter (alle/gyldige/ugyldige), søk og sortering. |
| **Resultat** | Statistikk: antall deltakere, antall forsøk, beste tid og median av alle gyldige beste-tider. I tillegg vinnermodus, topp 5 og **«Kåre vinner»**. |
| **Hendelseslogg** | Hele den uforanderlige loggen med søk. |
| **Backup og system** | Eksport, import/gjenoppretting, status for lagring, Wake Lock og offline, samt PIN-bytte. |

Listene er laget for 1000+ deltakere: de viser 300 rader om gangen («Vis flere»), og søket filtrerer umiddelbart.

**Vinnermodus:**

1. **Beste tid** – den raskeste gyldige tiden vinner.
2. **Nærmest median** – medianen regnes ut fra alle deltakeres beste gyldige tid. Deltakeren med beste tid
   nærmest medianen vinner. Ved et partall deltakere er medianen snittet av de to midterste, og den kan derfor
   ha en halv hundredel (vises som for eksempel `12,345`).

**Ved likhet** vinner den som registrerte seg først. Dette merkes tydelig som **UAVGJORT**, sammen med
hvem det var uavgjort mot.

**«Kåre vinner»** viser vinneren for bekreftelse og deretter:

- låser og logger resultatet
- låser vinnermodusen
- tar en Excel-backup automatisk

«Lås opp resultat» krever årsak og PIN. Den opprinnelige kåringen blir stående i loggen.

Alle endringer i admin logges som egne hendelser: kontaktinfo (med gammel og ny verdi), gyldighet,
manuelle tider, modus, kåring og opplåsing.

---

## Eksport, backup og gjenoppretting

### Automatisk backup

Appen laster automatisk ned en komplett `.xlsx`-fil til **Nedlastinger**:

- **hvert 10. minutt**, hvis noe er endret siden forrige backup
- **etter hver 10. registrering**
- når en vinner kåres

Filnavnet har tidsstempel, for eksempel `TROX_VVS2026_2026-10-21_1430.xlsx`. Siste backup vises i statuslinjen
og i adminportalen.

### Manuell eksport

Velg *Adminportal → Resultat → «Eksporter komplett Excel»* eller *Backup og system → «Eksporter Excel nå»*.

### Innhold i Excel-filen

| Fane | Innhold |
|---|---|
| **Deltakere** | ID, navn, firma, e-post, telefon, samtykke, registreringstid, antall forsøk og beste tid |
| **Forsøk** | Alle forsøk med tid, metode, gyldighet og årsak |
| **Hendelseslogg** | Komplett logg. Denne fanen brukes ved gjenoppretting – den må ikke redigeres. |
| **Resultat** | Statistikk, valgt modus, kåret vinner (eventuelt uavgjort) og rangering |

Alle ID-er og tekstfelter lagres som tekst. Ledende nuller beholdes, og tekst som starter med `=` blir aldri
tolket som en formel.

**Tips:** Kopier backupene jevnlig til en PC eller minnepinne, for eksempel med USB-kabel ved dagslutt.

### Gjenoppretting på ny enhet

1. Installer appen på det nye nettbrettet (se over) og velg PIN.
2. Overfør siste backupfil (`TROX_VVS2026_….xlsx`) til nettbrettet.
3. Gå til *Adminportal → Backup og system → «Velg fil og importer …»*.
4. Appen viser hvor mange nye hendelser som blir importert. Bekreft importen.

Importen **legger bare til** hendelser som ikke finnes fra før (sjekkes på hendelses-ID):

- Det er trygt å importere samme fil flere ganger.
- Du kan slå sammen data fra to nettbrett ved å importere backupen fra det ene inn i det andre.

---

## Sikkerhet og personvern

- Personopplysninger lagres bare lokalt på nettbrettet og i backupfilene. Behandle backupfilene som
  personopplysninger: oppbevar dem trygt, og slett dem når konkurransen og oppfølgingen er avsluttet.
- Samtykketeksten som deltakeren krysser av for, ligger i `CONSENT_TEXT` i `app/ui/public.js`. Den lagres også
  sammen med hver registrering. Avklar teksten med TROX sin personvernansvarlige før messa.
- QR-koden inneholder bare deltaker-ID. Råteksten lagres uendret og er deltakerens unike nøkkel.

---

## Utvikling og automatiske tester

Krever Node.js 20 eller nyere.

```bash
npm install     # henter testverktøy (fake-indexeddb) og bibliotekene som er kopiert til /lib
npm test        # kjører alle automatiske tester
npm start       # lokal server på http://localhost:8080 (localhost tillater kamera uten HTTPS)
```

Testene ligger i `tests/` og dekker:

| Fil | Dekker |
|---|---|
| `validation.test.js` | Registreringsskjema, e-post- og telefonformat, samtykke, deltaker-ID |
| `registration.test.js` | Registrering med rå QR-ID, dobbelt-ID, skanning, retting av kontaktinfo, varsel om dobbel e-post, flere forsøk, ugyldig/gyldig |
| `time.test.js` | Tidsberegning i hundredeler (avkorting), formatering, tolking av manuell tid, filnavn |
| `winner.test.js` | Median, beste tid per deltaker, statistikk, begge vinnermoduser, uavgjort/tidligste registrering, topp 5, låsing, ytelse med 1500 deltakere |
| `restore.test.js` | Excel-eksport (fire faner, tekst-ID-er, ingen formler), gjenoppretting til tom database, ny import uten duplikater, sammenslåing, ødelagte filer |
| `db.test.js` | IndexedDB: rekkefølge, varig lagring, unik hendelses-ID, atomiske skrivinger, ingen slettefunksjon |
| `pin.test.js` | PIN-format og hashing |
| `offline.test.js` | At alle filer er med i service worker-cachen, at det ikke finnes CDN-lenker, og at publikumsskjermen ikke formaterer tider |

Tester for registrering, validering, tidsberegning, median, vinnerlogikk og gjenoppretting kjører i Node. SheetJS
lastes fra samme `lib/`-fil som i nettleseren.

**Biblioteker** (alle lagret lokalt i `lib/`, ingen CDN):

- `html5-qrcode` 2.3.8 (Apache-2.0)
- SheetJS `xlsx` 0.18.5 (Apache-2.0)

Lisensene ligger ved siden av filene.

---

## Sjekkliste før messa

**Oppsett (dagen før)**

- [ ] Offisiell logo er lagt inn i `assets/logo.svg`, og fargene i `theme.css` er kontrollert.
- [ ] Samtykketeksten er godkjent av TROX.
- [ ] `npm test` går grønt.
- [ ] Appen er publisert på HTTPS og installert fra Chrome på nettbrettet («Installer app»).
- [ ] Appen er startet fra ikonet. Den er i fullskjerm og liggende format.
- [ ] Admin-PIN er valgt, skrevet ned og oppbevart trygt.
- [ ] *Backup og system*: **Vedvarende lagring = Ja**, **Offline-klar = Ja**, **Wake Lock = Aktiv**.
- [ ] Flymodus er på og appen startet på nytt: alt virker uten nett.
- [ ] Kameraet har tillatelse og leser QR fra et ekte messemerke (21×21). Lesing er testet på 15–30 cm avstand
      og i standens lys.
- [ ] «Tast inn ID manuelt» er testet.
- [ ] Batterioptimalisering for Chrome er slått av, skjermtidsavbrudd er maks, og nettbrettet står på lader.
- [ ] App-festing (*App pinning*) er slått på.

**Funksjonstest (med testdeltakere)**

- [ ] Ny ID → skjemaet åpnes. «Lagre» er grå til alle påkrevde felt er gyldige og samtykke er krysset av.
- [ ] Feil e-post (`ola@firma`) gir feilmelding. E-posttastatur vises i e-postfeltet og talltastatur i telefonfeltet.
- [ ] Lagre → «Du er registrert, [fornavn]!» og START vises.
- [ ] START → STOPP → grønn skjerm og vibrasjon. **Ingen tid vises.**
- [ ] Skann samme ID igjen → navnet vises for bekreftelse, uten skjema.
- [ ] Registrer et nytt ID med samme e-post → varsel om mulig dobbeltregistrering.
- [ ] Fyll ut halve skjemaet → dra ned for å oppdatere / lukk appen → skjemaet er der fortsatt.
- [ ] Trykk START → lukk appen helt → åpne igjen → «Pågående forsøk ble gjenopprettet» → STOPP virker.
- [ ] Manuell tid krever PIN og lagres.
- [ ] Admin: deltakeren finnes, kontaktinfo kan rettes, og forsøket kan merkes ugyldig og deretter gyldig.
      Alt vises i hendelsesloggen.
- [ ] Admin → Resultat: statistikk og topp 5 stemmer for begge vinnermoduser.
- [ ] Manuell eksport → filen ligger i *Nedlastinger* og åpnes i Excel med fanene Deltakere, Forsøk,
      Hendelseslogg og Resultat.
- [ ] Automatisk backup kom etter 10 minutter, og Chrome ble ikke stoppet av spørsmål om automatiske nedlastinger.
- [ ] **Gjenoppretting er testet:** Importer backupfilen på en annen enhet eller i et inkognitovindu på PC
      (`npm start`) og kontroller at deltakere og tider stemmer.

**Rett før åpning**

- [ ] Testdataene er fjernet:
  1. Ta en eksport.
  2. Slett nettstedsdata for appen i Chrome (*Innstillinger → Nettstedsinnstillinger → Alle nettsteder*).
  3. Start appen og velg PIN på nytt.
  4. Kontroller at *Deltakere* er tom.
- [ ] Statuslinjen viser grønt for «Lagring OK» og «Skjerm våken».

**Under og etter messa**

- [ ] Kopier backupfilene fra *Nedlastinger* til PC/minnepinne hver kveld.
- [ ] Kåre vinner i adminportalen (låser og logger resultatet), og ta en siste manuell eksport.
- [ ] Slett backupfiler med personopplysninger når oppfølgingen er ferdig.

---

## Kjente begrensninger

- **Logoen er en plassholder.** Bytt `assets/logo.svg` med den offisielle logoen.
- **TROX-rødfargen** (`#e3000f`) er en tilnærming. Kontroller den mot profilmanualen.
- **SheetJS-versjon:** SheetJS publiserer nye versjoner bare via sin egen CDN, som ikke var tilgjengelig under
  utviklingen. Derfor brukes 0.18.5 fra npm. Den versjonen har kjente sårbarheter ved lesing av **ukjente**
  regneark. Appen leser bare egne backupfiler, så risikoen er liten, men importer aldri regneark fra ukjente
  kilder. Ønsker du å oppgradere: last ned `xlsx.full.min.js` fra https://cdn.sheetjs.com, legg den i `lib/`,
  og kjør `npm test`.
- **Nedlastinger:** Automatiske nedlastinger i Chrome på Android kan bli blokkert hvis nettstedet ikke har
  tillatelse (se installasjonen over). Statuslinjen viser tidspunkt for siste backup – følg med på den.
- **Tidtaking:** Tiden måles mellom to trykk på skjermen. Presisjonen er bedre enn én hundredel, men reaksjonstiden
  til den som trykker, påvirker resultatet like mye som med en vanlig stoppeklokke.
