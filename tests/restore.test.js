import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { buildState } from '../app/core/events.js';
import { determineWinner, computeStats } from '../app/core/stats.js';
import { EventStore } from '../app/core/db.js';
import { buildWorkbook, workbookToArray, readEventsFromWorkbook, eventsToImport, SHEETS } from '../app/core/excel.js';
import { XLSX, eventLog } from './helpers.js';

function sampleLog() {
  const log = eventLog();
  log.add('SCAN', { participantId: '000123', known: false, method: 'qr' });
  log.register('000123', 'Ola', 'Nordmann', { email: 'ola@firma.no', phone: '+47 912 34 567' });
  log.register('=1+1', 'Formel', 'Test', { company: '=HYPERLINK("x")', email: 'f@x.no' });
  log.register('ÆØÅ-id 7', 'Åse', 'Ødegård', { email: 'ase@x.no' });
  const a = log.time('000123', 1234);
  log.time('000123', 1199);
  log.time('=1+1', 1500);
  log.time('ÆØÅ-id 7', 1300, { method: 'manual' });
  log.invalidate(a, 'tjuvstart');
  log.add('PARTICIPANT_UPDATED', { participantId: '000123', changes: { phone: '' }, previous: { phone: '+47 912 34 567' } });
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
  assert.equal(ola['Deltaker-ID'], '000123', 'ID lagres som tekst, ledende nuller beholdes');
  assert.equal(ola['Beste tid'], '11,99');
  const forsok = XLSX.utils.sheet_to_json(wb.Sheets['Forsøk'], { raw: true });
  assert.equal(forsok.length, 4);
  assert.equal(forsok.filter((r) => r.Gyldig === 'NEI').length, 1);
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
  assert.equal(b.participants.get('000123').phone, '');
});

test('gjenoppretting til ny enhet via IndexedDB, og ny import av samme fil gir ingen duplikater', async () => {
  const log = sampleLog();
  const { events } = roundTrip(log.events);
  const store = await new EventStore(new IDBFactory(), 'restore-test').open();
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
