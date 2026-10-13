import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildState, applyEvent, createState, findEmailDuplicates, attemptsFor, makeEvent } from '../app/core/events.js';
import { eventLog } from './helpers.js';

test('registrering oppretter deltaker med rå QR-tekst som nøkkel', () => {
  const log = eventLog();
  const rawId = '  VVS26:000123\t';
  log.register(rawId, 'Ola', 'Nordmann', { email: 'ola@firma.no', phone: '+47 912 34 567' });
  const s = buildState(log.events);
  assert.equal(s.participants.size, 1);
  const p = s.participants.get(rawId);
  assert.ok(p, 'ID lagres uendret, også med mellomrom/tab');
  assert.equal(p.firstName, 'Ola');
  assert.equal(p.consent, true);
  assert.equal(s.registrationCount, 1);
  assert.equal(s.participants.get('VVS26:000123'), undefined);
});

test('samme ID registrert to ganger beholder første registrering', () => {
  const log = eventLog();
  log.register('A', 'Ola');
  log.register('A', 'Kari');
  const s = buildState(log.events);
  assert.equal(s.participants.get('A').firstName, 'Ola');
  assert.equal(s.registrationCount, 1);
  assert.equal(s.warnings.length, 1);
});

test('skanning teller per deltaker', () => {
  const log = eventLog();
  log.register('A', 'Ola');
  log.add('SCAN', { participantId: 'A', known: true });
  log.add('SCAN', { participantId: 'A', known: true });
  log.add('SCAN', { participantId: 'B', known: false });
  const s = buildState(log.events);
  assert.equal(s.scanCount, 3);
  assert.equal(s.participants.get('A').scanCount, 2);
});

test('kontaktinfo kan rettes, og e-postindeksen følger med', () => {
  const log = eventLog();
  log.register('A', 'Ola', 'N', { email: 'ola@a.no' });
  log.add('PARTICIPANT_UPDATED', { participantId: 'A', changes: { email: 'ola@b.no', company: 'Nytt AS' }, previous: { email: 'ola@a.no', company: 'Firma AS' } });
  const s = buildState(log.events);
  const p = s.participants.get('A');
  assert.equal(p.email, 'ola@b.no');
  assert.equal(p.company, 'Nytt AS');
  assert.equal(p.firstName, 'Ola', 'uendrede felt beholdes');
  assert.ok(p.updatedAt);
  assert.equal(findEmailDuplicates(s, 'ola@a.no').length, 0);
  assert.equal(findEmailDuplicates(s, 'OLA@B.NO ').length, 1);
});

test('varsel om mulig dobbeltregistrering: samme e-post på annet ID (uavhengig av store/små bokstaver)', () => {
  const log = eventLog();
  log.register('A', 'Ola', 'N', { email: 'Ola@Firma.no' });
  const s = buildState(log.events);
  const dup = findEmailDuplicates(s, ' ola@firma.NO');
  assert.equal(dup.length, 1);
  assert.equal(dup[0].id, 'A');
  assert.equal(findEmailDuplicates(s, 'ola@firma.no', 'A').length, 0, 'egen ID teller ikke');
  log.register('B', 'Ola', 'N', { email: 'ola@firma.no', duplicateOf: ['A'] });
  const s2 = buildState(log.events);
  assert.deepEqual(s2.participants.get('B').duplicateOf, ['A']);
  assert.equal(findEmailDuplicates(s2, 'ola@firma.no').length, 2);
});

test('flere forsøk per deltaker lagres; ugyldig merking sletter ikke', () => {
  const log = eventLog();
  log.register('A', 'Ola');
  const a1 = log.time('A', 1500);
  const a2 = log.time('A', 1400);
  log.invalidate(a2, 'tjuvstart');
  const s = buildState(log.events);
  const atts = attemptsFor(s, 'A');
  assert.equal(atts.length, 2);
  assert.equal(s.attempts.get(a1).valid, true);
  assert.equal(s.attempts.get(a2).valid, false);
  assert.equal(s.attempts.get(a2).validityReason, 'tjuvstart');
  // korrigering: gjør gyldig igjen med ny hendelse
  log.add('ATTEMPT_VALIDITY_CHANGED', { attemptId: a2, valid: true, reason: 'feil merket' });
  assert.equal(buildState(log.events).attempts.get(a2).valid, true);
});

test('inkrementell oppdatering gir samme tilstand som full avspilling', () => {
  const log = eventLog();
  log.register('A', 'Ola');
  log.time('A', 1234);
  log.add('SETTINGS_CHANGED', { winnerMode: 'median' });
  const inc = createState();
  for (const ev of log.events) applyEvent(inc, ev);
  const full = buildState(log.events);
  assert.equal(inc.attempts.size, full.attempts.size);
  assert.equal(inc.settings.winnerMode, 'median');
});

test('ukjent hendelsestype avvises', () => {
  assert.throws(() => makeEvent('SLETT_ALT', {}));
});
