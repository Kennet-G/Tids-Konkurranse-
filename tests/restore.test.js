import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { buildState } from '../app/core/events.js';
import { determineWinner, computeStats } from '../app/core/stats.js';
import { EventStore } from '../app/core/db.js';
import { buildWorkbook, workbookToArray, readEventsFromWorkbook, eventsToImport, competitionInfo, SHEETS } from '../app/core/excel.js';
import { XLSX, eventLog } from './helpers.js';

function sampleLog() {
  const log = eventLog();
  log.competition('VVS-dagene 2026');
  log.register('p1', 'Ola', 'Nordmann', { email: 'ola@firma.no', phone: '0047 912 34 567' });
  log.register('p2', 'Formel', 'Test', { company: '=HYPERLINK("x")', email: 'f@x.no' });
  log.register('p3', 'Åse', 'Ødegård', { email: 'ase@x.no' });
  const a = log.time('p1', 1234);
  const b = log.time('p1', 1199);
  log.time('p2', 1500);
  log.time('p3', 1300, { method: 'manual' });
  log.invalidate(a, 'tjuvstart');
  log.add('ATTEMPT_EDITED', { attemptId: b, participantId: 'p1', cs: 1190, previousCs: 1199, reason: 'tastefeil' });
  const c = log.time('p3', 1000, { method: 'admin' });
  log.add('ATTEMPT_DELETED', { attemptId: c, participantId: 'p3', cs: 1000, reason: 'feil person' });
  log.add('PARTICIPANT_UPDATED', { participantId: 'p1', changes: { company: 'Rør AS' }, previous: { company: 'Firma AS' } });
  log.add('SETTINGS_CHANGED', { winnerMode: 'median' });
  log.add('WINNER_DECLARED', determineWinner(buildState(log.events), 'median'));
  return log;
}

function roundTrip(events) {
  const bytes = workbookToArray(XLSX, buildWorkbook(XLSX, events, { device: 'test' }));
  return { bytes, ...readEventsFromWorkbook(XLSX, bytes) };
}

test('eksport har fanene Deltakere, Forsøk, Hendelseslogg og Resultat', () => {
  const { bytes } = roundTrip(sampleLog().events);
  const wb = XLSX.read(bytes, { type: 'array' });
  assert.deepEqual([...wb.SheetNames], [SHEETS.PARTICIPANTS, SHEETS.ATTEMPTS, SHEETS.LOG, SHEETS.RESULT]);
  const deltakere = XLSX.utils.sheet_to_json(wb.Sheets.Deltakere, { raw: true });
  assert.equal(deltakere.length, 3);
  const ola = deltakere.find((r) => r.Fornavn === 'Ola');
  assert.equal(ola.Telefon, '0047 912 34 567', 'telefon lagres som tekst');
  assert.equal(ola.Nr, 1);
  assert.equal(ola['Beste tid'], '11,90', 'endret tid brukes');
  const forsok = XLSX.utils.sheet_to_json(wb.Sheets['Forsøk'], { raw: true });
  assert.equal(forsok.length, 5, 'slettet forsøk tas med, merket');
  assert.equal(forsok.filter((r) => r.Status === 'UGYLDIG').length, 1);
  assert.equal(forsok.filter((r) => r.Status === 'SLETTET').length, 1);
  assert.match(forsok.find((r) => r['Tid (hundredeler)'] === 1190).Endringer, /11,99 → 11,90/);
  const res = XLSX.utils.sheet_to_json(wb.Sheets.Resultat, { header: 1, raw: true });
  assert.equal(res[0][1], 'VVS-dagene 2026');
});

test('formel-lignende tekst lagres som tekst, ikke formel', () => {
  const { bytes } = roundTrip(sampleLog().events);
  const wb = XLSX.read(bytes, { type: 'array', cellFormula: true });
  const ws = wb.Sheets.Deltakere;
  for (const addr of Object.keys(ws).filter((k) => !k.startsWith('!'))) assert.equal(ws[addr].f, undefined, addr);
});

test('gjenoppretting: hendelsesloggen leses tilbake uendret', () => {
  const log = sampleLog();
  const { events, errors } = roundTrip(log.events);
  assert.deepEqual(errors, []);
  assert.equal(events.length, log.events.length);
  for (let i = 0; i < events.length; i++) {
    assert.equal(events[i].id, log.events[i].id);
    assert.equal(events[i].type, log.events[i].type);
    assert.equal(events[i].ts, log.events[i].ts);
    assert.deepEqual(events[i].data, log.events[i].data);
  }
});

test('gjenoppretting gir identisk tilstand, statistikk og vinner', () => {
  const log = sampleLog();
  const { events } = roundTrip(log.events);
  const a = buildState(log.events);
  const b = buildState(events);
  assert.deepEqual([...b.participants.keys()], [...a.participants.keys()]);
  assert.deepEqual(computeStats(b), computeStats(a));
  assert.deepEqual(determineWinner(b, 'median'), determineWinner(a, 'median'));
  assert.equal(b.result.winnerId, a.result.winnerId);
  assert.equal(b.settings.winnerMode, 'median');
  assert.equal(b.participants.get('p1').company, 'Rør AS');
  assert.equal(b.attempts.size, a.attempts.size);
});

test('gjenoppretting til ny enhet via IndexedDB, og ny import av samme fil gir ingen duplikater', async () => {
  const log = sampleLog();
  const { events } = roundTrip(log.events);
  const store = await new EventStore(new IDBFactory(), 'trox-konk-restore').open();
  const first = eventsToImport(await store.allIds(), events);
  assert.equal(first.fresh.length, events.length);
  await store.append(first.fresh);
  const second = eventsToImport(await store.allIds(), events);
  assert.equal(second.fresh.length, 0);
  assert.equal(second.skipped, events.length);
  const restored = buildState(await store.all());
  assert.deepEqual(computeStats(restored), computeStats(buildState(log.events)));
  store.close();
});

test('konkurransens id og navn leses fra hendelsesloggen', () => {
  const log = sampleLog();
  const { events } = roundTrip(log.events);
  assert.deepEqual(competitionInfo(events), { id: 'konk-1', name: 'VVS-dagene 2026', createdAt: log.events[0].ts });
  log.add('SETTINGS_CHANGED', { name: 'Nytt navn' });
  assert.equal(competitionInfo(log.events).name, 'Nytt navn');
  assert.equal(competitionInfo([]), null);
});

test('sammenslåing: nye hendelser fra en annen fil legges til', () => {
  const log = sampleLog();
  const existing = log.events.slice(0, 5).map((e) => e.id);
  const { fresh, skipped } = eventsToImport(existing, log.events);
  assert.equal(skipped, 5);
  assert.equal(fresh.length, log.events.length - 5);
});

test('fil uten Hendelseslogg avvises med tydelig melding', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['hei']]), 'Ark1');
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  assert.throws(() => readEventsFromWorkbook(XLSX, bytes), /Hendelseslogg/);
});

test('ødelagte rader rapporteres, gyldige rader importeres', () => {
  const log = sampleLog();
  const wb = buildWorkbook(XLSX, log.events);
  const ws = wb.Sheets.Hendelseslogg;
  ws.I3 = { t: 's', v: '{ikke json' };
  ws.D4 = { t: 's', v: 'UKJENT' };
  const { events, errors } = readEventsFromWorkbook(XLSX, workbookToArray(XLSX, wb));
  assert.equal(errors.length, 2);
  assert.equal(events.length, log.events.length - 2);
});
