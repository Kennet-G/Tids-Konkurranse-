import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildState, applyEvent, createState, findEmailDuplicates, findExistingParticipant, hasHadAttempt, activeAttempts, attemptsFor, makeEvent, normPhone } from '../app/core/events.js';
import { eventLog } from './helpers.js';

test('konkurranse opprettes med navn og innstillinger', () => {
  const log = eventLog();
  log.competition('VVS-dagene 2026', { winnerMode: 'median', timerEnabled: false });
  const s = buildState(log.events);
  assert.equal(s.competition.id, 'konk-1');
  assert.equal(s.settings.name, 'VVS-dagene 2026');
  assert.equal(s.settings.winnerMode, 'median');
  assert.equal(s.settings.timerEnabled, false);
});

test('tidtaking i appen kan slås av og på midt i konkurransen', () => {
  const log = eventLog();
  log.competition();
  assert.equal(buildState(log.events).settings.timerEnabled, true);
  log.add('SETTINGS_CHANGED', { timerEnabled: false });
  assert.equal(buildState(log.events).settings.timerEnabled, false);
  log.add('SETTINGS_CHANGED', { timerEnabled: true });
  assert.equal(buildState(log.events).settings.timerEnabled, true);
  log.add('SETTINGS_CHANGED', { name: '  Nytt navn ' });
  assert.equal(buildState(log.events).settings.name, 'Nytt navn');
});

test('registrering gir deltaker med løpenummer', () => {
  const log = eventLog();
  log.register('p1', 'Ola', 'Nordmann', { phone: '+47 912 34 567' });
  log.register('p2', 'Kari');
  const s = buildState(log.events);
  assert.equal(s.participants.size, 2);
  assert.equal(s.participants.get('p1').nr, 1);
  assert.equal(s.participants.get('p2').nr, 2);
  assert.equal(s.participants.get('p1').consent, true);
});

test('samme deltaker-ID registrert to ganger beholder første', () => {
  const log = eventLog();
  log.register('p1', 'Ola');
  log.register('p1', 'Kari');
  const s = buildState(log.events);
  assert.equal(s.participants.get('p1').firstName, 'Ola');
  assert.equal(s.registrationCount, 1);
  assert.equal(s.warnings.length, 1);
});

test('tidligere registrering finnes på e-post (uansett store/små bokstaver) eller telefon', () => {
  const log = eventLog();
  log.register('p1', 'Ola', 'N', { email: 'Ola@Firma.no', phone: '912 34 567' });
  const s = buildState(log.events);
  assert.equal(findExistingParticipant(s, { email: ' ola@firma.NO' })?.id, 'p1');
  assert.equal(findExistingParticipant(s, { email: 'annen@x.no', phone: '+47 91234567' })?.id, 'p1');
  assert.equal(findExistingParticipant(s, { email: 'annen@x.no', phone: '0047 912 34 567' })?.id, 'p1');
  assert.equal(findExistingParticipant(s, { email: 'annen@x.no', phone: '' }), null);
  assert.equal(findExistingParticipant(s, { email: 'annen@x.no', phone: '1234' }), null, 'for kort nummer matcher ikke');
});

test('telefon normaliseres til siste 8 sifre', () => {
  assert.equal(normPhone('+47 912 34 567'), '91234567');
  assert.equal(normPhone('91234567'), '91234567');
  assert.equal(normPhone('123'), '');
});

test('ett forsøk per deltaker: har hatt forsøk når en tid finnes (også ugyldig), ikke når den er slettet', () => {
  const log = eventLog();
  log.register('p1', 'Ola');
  const s0 = buildState(log.events);
  assert.equal(hasHadAttempt(s0, 'p1'), false, 'registrert uten tid kan fortsette til forsøket');
  const a = log.time('p1', 1500);
  assert.equal(hasHadAttempt(buildState(log.events), 'p1'), true);
  log.invalidate(a);
  assert.equal(hasHadAttempt(buildState(log.events), 'p1'), true, 'ugyldig forsøk er fortsatt brukt');
  log.add('ATTEMPT_DELETED', { attemptId: a, participantId: 'p1', cs: 1500, reason: 'feil person' });
  const s = buildState(log.events);
  assert.equal(hasHadAttempt(s, 'p1'), false, 'slettet tid gir nytt forsøk');
  assert.equal(attemptsFor(s, 'p1').length, 1, 'slettet forsøk finnes fortsatt i historikken');
  assert.equal(activeAttempts(s, 'p1').length, 0);
});

test('avvist ny registrering telles på deltakeren', () => {
  const log = eventLog();
  log.register('p1', 'Ola');
  log.add('REREGISTRATION_BLOCKED', { participantId: 'p1', matchedOn: 'email' });
  assert.equal(buildState(log.events).participants.get('p1').blockedAttempts, 1);
});

test('kontaktinfo kan rettes, og e-post/telefon-indeksene følger med', () => {
  const log = eventLog();
  log.register('p1', 'Ola', 'N', { email: 'ola@a.no', phone: '91234567' });
  log.add('PARTICIPANT_UPDATED', { participantId: 'p1', changes: { email: 'ola@b.no', phone: '98765432', company: 'Nytt AS' }, previous: { email: 'ola@a.no', phone: '91234567', company: 'Firma AS' } });
  const s = buildState(log.events);
  const p = s.participants.get('p1');
  assert.equal(p.email, 'ola@b.no');
  assert.equal(p.company, 'Nytt AS');
  assert.equal(p.firstName, 'Ola');
  assert.ok(p.updatedAt);
  assert.equal(findExistingParticipant(s, { email: 'ola@a.no', phone: '91234567' }), null);
  assert.equal(findExistingParticipant(s, { phone: '98765432' })?.id, 'p1');
  assert.equal(findEmailDuplicates(s, 'ola@b.no', 'p1').length, 0);
});

test('tid kan endres – historikken beholdes', () => {
  const log = eventLog();
  log.register('p1', 'Ola');
  const a = log.time('p1', 1500);
  log.add('ATTEMPT_EDITED', { attemptId: a, participantId: 'p1', cs: 1450, previousCs: 1500, reason: 'tastefeil' });
  const att = buildState(log.events).attempts.get(a);
  assert.equal(att.cs, 1450);
  assert.equal(att.originalCs, 1500);
  assert.deepEqual(att.edits.map((e) => [e.from, e.to, e.reason]), [[1500, 1450, 'tastefeil']]);
});

test('ugyldig merking sletter ikke og kan reverseres', () => {
  const log = eventLog();
  log.register('p1', 'Ola');
  const a = log.time('p1', 1400);
  log.invalidate(a, 'tjuvstart');
  assert.equal(buildState(log.events).attempts.get(a).valid, false);
  log.add('ATTEMPT_VALIDITY_CHANGED', { attemptId: a, valid: true, reason: 'feil merket' });
  assert.equal(buildState(log.events).attempts.get(a).valid, true);
});

test('inkrementell oppdatering gir samme tilstand som full avspilling', () => {
  const log = eventLog();
  log.competition();
  log.register('p1', 'Ola');
  log.time('p1', 1234);
  log.add('SETTINGS_CHANGED', { winnerMode: 'median' });
  const inc = createState();
  for (const ev of log.events) applyEvent(inc, ev);
  const full = buildState(log.events);
  assert.equal(inc.attempts.size, full.attempts.size);
  assert.deepEqual(inc.settings, full.settings);
});

test('ukjent hendelsestype avvises', () => {
  assert.throws(() => makeEvent('SLETT_ALT', {}));
});
