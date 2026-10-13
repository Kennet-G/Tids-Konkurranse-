// Excel-eksport og -gjenoppretting. SheetJS (XLSX) sendes inn som parameter slik at
// modulen kan testes i Node og brukes med lokal /lib/xlsx.full.min.js i nettleseren.
import { EventType, EVENT_LABELS, attemptsFor, buildState, describeEvent, fullName } from './events.js';
import { computeStats, determineWinner, rank, bestTimes } from './stats.js';
import { formatCs, formatCsPrecise, formatDateTime } from './time.js';

export const SHEETS = Object.freeze({
  PARTICIPANTS: 'Deltakere',
  ATTEMPTS: 'Forsøk',
  LOG: 'Hendelseslogg',
  RESULT: 'Resultat',
});

const LOG_HEADERS = ['Nr', 'Tidspunkt', 'Tidspunkt (ISO)', 'Type', 'Beskrivelse', 'Deltaker-ID', 'Enhet', 'Hendelses-ID', 'Data (JSON)'];
const METHOD_LABEL = { timer: 'Stoppeklokke i appen', manual: 'Ekstern stoppeklokke', admin: 'Lagt inn av admin' };
const MODE_LABEL = { best: 'Beste tid', median: 'Nærmest median' };

function sheetFromRows(XLSX, headers, rows, widths) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = (widths ?? headers.map(() => 18)).map((wch) => ({ wch }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } }) };
  return ws;
}

// Alle ID-er og fritekst skrives som tekst (type 's') – aldri som tall eller formel.
const txt = (v) => (v == null ? '' : String(v));

export function buildWorkbook(XLSX, events, { exportedAt = new Date(), device = '' } = {}) {
  const state = buildState(events);
  const wb = XLSX.utils.book_new();
  wb.Props = { Title: `TROX Tidtaking – ${state.settings.name}`, Author: 'TROX Auranor', CreatedDate: exportedAt };

  // Deltakere
  const bestById = new Map(bestTimes(state).map((b) => [b.participant.id, b]));
  const pRows = [...state.participants.values()]
    .sort((a, b) => a.nr - b.nr)
    .map((p) => {
      const atts = attemptsFor(state, p.id).filter((a) => !a.deleted);
      const best = bestById.get(p.id);
      return [
        p.nr, txt(p.firstName), txt(p.lastName), txt(p.company), txt(p.email), txt(p.phone),
        p.consent ? 'Ja' : 'Nei', formatDateTime(p.registeredAt), p.updatedAt ? formatDateTime(p.updatedAt) : '',
        atts.length, best ? formatCs(best.bestCs) : '', best ? best.bestCs : '', p.blockedAttempts || '', txt(p.id),
      ];
    });
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX,
    ['Nr', 'Fornavn', 'Etternavn', 'Firma', 'E-post', 'Telefon', 'Samtykke', 'Registrert', 'Sist endret',
      'Antall forsøk', 'Beste tid', 'Beste tid (hundredeler)', 'Avviste nye registreringer', 'Deltaker-ID'],
    pRows, [6, 16, 18, 24, 30, 16, 10, 20, 20, 12, 12, 14, 14, 38]), SHEETS.PARTICIPANTS);

  // Forsøk (slettede tas med og merkes – de finnes også i hendelsesloggen)
  const aRows = [...state.attempts.values()]
    .sort((a, b) => a.recordedSeq - b.recordedSeq)
    .map((a) => {
      const p = state.participants.get(a.participantId);
      const status = a.deleted ? 'SLETTET' : a.valid ? 'Gyldig' : 'UGYLDIG';
      const reason = a.deleted ? a.deleteReason : a.validityReason;
      return [
        p?.nr ?? '', txt(fullName(p)), txt(p?.company), formatCs(a.cs), a.cs, METHOD_LABEL[a.method] ?? a.method, status, txt(reason),
        a.edits.length ? txt(a.edits.map((e) => `${formatCs(e.from)} → ${formatCs(e.to)}${e.reason ? ` (${e.reason})` : ''}`).join('; ')) : '',
        formatDateTime(a.recordedAt), a.startedAt ? formatDateTime(a.startedAt) : '', a.stoppedAt ? formatDateTime(a.stoppedAt) : '', txt(a.note),
        txt(a.id), txt(a.participantId),
      ];
    });
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX,
    ['Nr', 'Navn', 'Firma', 'Tid', 'Tid (hundredeler)', 'Metode', 'Status', 'Årsak', 'Endringer',
      'Registrert', 'Start', 'Stopp', 'Merknad', 'Forsøk-ID', 'Deltaker-ID'],
    aRows, [6, 24, 22, 12, 14, 18, 10, 26, 30, 20, 20, 20, 24, 38, 38]), SHEETS.ATTEMPTS);

  // Hendelseslogg – brukes også til gjenoppretting
  const lRows = events.map((ev, i) => [
    ev.seq ?? i + 1, formatDateTime(ev.ts), txt(ev.ts), txt(ev.type), txt(`${EVENT_LABELS[ev.type] ?? ev.type}: ${describeEvent(ev, formatCs)}`),
    txt(ev.data?.participantId), txt(ev.device), txt(ev.id), JSON.stringify(ev.data ?? {}),
  ]);
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, LOG_HEADERS, lRows, [7, 20, 26, 26, 70, 22, 14, 38, 60]), SHEETS.LOG);

  // Resultat
  const stats = computeStats(state);
  const mode = state.settings.winnerMode;
  const r = rank(state, mode);
  const live = determineWinner(state, mode);
  const res = [
    ['TROX Tidtaking – TROX Auranor', txt(state.settings.name)],
    ['Eksportert', formatDateTime(exportedAt.toISOString())],
    ['Enhet', txt(device)],
    ['', ''],
    ['Antall deltakere', stats.participantCount],
    ['Deltakere med gyldig tid', stats.participantsWithTime],
    ['Antall forsøk', stats.attemptCount],
    ['Gyldige forsøk', stats.validAttemptCount],
    ['Ugyldige forsøk', stats.invalidAttemptCount],
    ['Slettede tider', stats.deletedAttemptCount],
    ['Beste tid', stats.bestCs == null ? '' : formatCs(stats.bestCs)],
    ['Median av gyldige beste-tider', stats.medianCs == null ? '' : formatCsPrecise(stats.medianCs)],
    ['Valgt vinnermodus', MODE_LABEL[mode] ?? mode],
    ['Tidtaking i appen', state.settings.timerEnabled ? 'På' : 'Av (ekstern stoppeklokke)'],
    ['', ''],
  ];
  if (state.result) {
    const w = state.result;
    res.push(
      ['KÅRET VINNER', w.locked ? 'LÅST' : 'Låst opp igjen'],
      ['Kåret', formatDateTime(w.declaredAt)],
      ['Modus', MODE_LABEL[w.mode] ?? w.mode],
      ['Vinner', txt(w.winnerName)],
      ['Firma', txt(w.winnerCompany)],
      ['E-post', txt(w.winnerEmail)],
      ['Tid', formatCs(w.winnerCs)],
      ['Median ved kåring', w.medianCs == null ? '' : formatCsPrecise(w.medianCs)],
      ['Uavgjort', w.tie ? `Ja – avgjort på tidligste registrering (mot ${w.tiedWith.map((t) => t.name).join(', ')})` : 'Nei'],
      ['', ''],
    );
  } else if (live) {
    res.push(['Foreløpig leder (ikke kåret)', `${live.winnerName} – ${formatCs(live.winnerCs)}${live.tie ? ' (uavgjort)' : ''}`], ['', '']);
  }
  res.push(['Plass', 'Navn', 'Firma', 'Nr', 'Beste tid', mode === 'median' ? 'Avstand til median' : '', 'Uavgjort', 'Registrert']);
  for (const row of r.rows) {
    res.push([row.rank, txt(fullName(row.participant)), txt(row.participant.company), row.participant.nr, formatCs(row.bestCs),
      mode === 'median' ? formatCsPrecise(row.distance) : '', row.tied ? 'Ja' : '', formatDateTime(row.participant.registeredAt)]);
  }
  const ws = XLSX.utils.aoa_to_sheet(res);
  ws['!cols'] = [30, 30, 24, 22, 12, 18, 10, 20].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, SHEETS.RESULT);
  return wb;
}

export function workbookToArray(XLSX, wb) {
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
}

// Leser hendelsesloggen fra en eksportert fil. Returnerer { events, errors }.
export function readEventsFromWorkbook(XLSX, data) {
  const wb = XLSX.read(data, { type: 'array', cellDates: false, cellFormula: false, cellHTML: false, raw: true });
  const ws = wb.Sheets[SHEETS.LOG];
  if (!ws) throw new Error(`Filen mangler fanen «${SHEETS.LOG}». Bruk en fil eksportert fra denne appen.`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  const header = rows[0] ?? [];
  const col = (name) => header.indexOf(name);
  const cId = col('Hendelses-ID');
  const cTs = col('Tidspunkt (ISO)');
  const cType = col('Type');
  const cData = col('Data (JSON)');
  const cDev = col('Enhet');
  if ([cId, cTs, cType, cData].some((c) => c < 0)) throw new Error('Fanen «Hendelseslogg» har ikke forventede kolonner.');
  const events = [];
  const errors = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => c === '' || c == null)) continue;
    const id = String(row[cId] ?? '').trim();
    const ts = String(row[cTs] ?? '').trim();
    const type = String(row[cType] ?? '').trim();
    let data;
    try {
      data = JSON.parse(String(row[cData] ?? '{}'));
    } catch {
      errors.push(`Rad ${i + 1}: ugyldig JSON`);
      continue;
    }
    if (!id) { errors.push(`Rad ${i + 1}: mangler hendelses-ID`); continue; }
    if (!EventType[type]) { errors.push(`Rad ${i + 1}: ukjent type «${type}»`); continue; }
    if (Number.isNaN(Date.parse(ts))) { errors.push(`Rad ${i + 1}: ugyldig tidspunkt`); continue; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) { errors.push(`Rad ${i + 1}: data er ikke et objekt`); continue; }
    events.push({ id, ts, type, device: String(row[cDev] ?? ''), data });
  }
  return { events, errors };
}

// Finner hendelser som ikke allerede finnes (på hendelses-ID). Rekkefølgen fra filen beholdes.
export function eventsToImport(existingIds, incoming) {
  const seen = new Set(existingIds);
  const fresh = [];
  let skipped = 0;
  for (const ev of incoming) {
    if (seen.has(ev.id)) { skipped += 1; continue; }
    seen.add(ev.id);
    fresh.push(ev);
  }
  return { fresh, skipped };
}

// Konkurransens id og navn fra en hendelseslogg (fra COMPETITION_CREATED og senere navneendringer).
export function competitionInfo(events) {
  const created = events.find((e) => e.type === EventType.COMPETITION_CREATED);
  if (!created) return null;
  let name = created.data.name ?? '';
  for (const e of events) if (e.type === EventType.SETTINGS_CHANGED && typeof e.data?.name === 'string' && e.data.name.trim()) name = e.data.name.trim();
  return { id: created.data.competitionId, name, createdAt: created.ts };
}
