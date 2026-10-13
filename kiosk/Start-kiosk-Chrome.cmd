@echo off
rem Starter TROX Konkurranseregistrering i kioskmodus i Google Chrome (Windows).
rem - Lukk ALLE Chrome-vinduer forst, ellers apnes et vanlig vindu i stedet for kiosk.
rem - Bruker din vanlige Chrome-profil, sa dataene er de samme som i appen/fanen.
rem - Avslutt kioskmodus med Alt+F4.
rem - Endre ADRESSE hvis appen ligger et annet sted.
rem IKKE bruk Edge sin --kiosk: den kjorer InPrivate og sletter alle data nar den lukkes.
set ADRESSE=https://kennet-g.github.io/Tids-Konkurranse-/
start "" chrome --kiosk "%ADRESSE%" --no-first-run
