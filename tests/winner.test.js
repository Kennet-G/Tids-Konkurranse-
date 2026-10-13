import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildState } from '../app/core/events.js';
import { median, bestTimes, computeStats, rank, determineWinner, topN } from '../app/core/stats.js';
import { eventLog } from './helpers.js';

test('median – oddetall, partall, tom', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([1000, 1001]), 1000.5);
});

test('beste tid per deltaker ignorerer ugyldige forsøk', () => {
  const log = eventLog();
  log.register('A', 'Ola');
  log.time('A', 1500);
  const fast = log.time('A', 900);
  log.invalidate(fast);
  log.register('B', 'Kari');
  const b = bestTimes(buildState(log.events));
  assert.equal(b.length, 1, 'B uten tid er ikke med');
  assert.equal(b[0].bestCs, 1500);
});

test('statistikk: deltakere, forsøk, beste tid og median av gyldige beste-tider', () => {
  const log = eventLog();
  log.register('A', 'A'); log.time('A', 1000); log.time('A', 1200);
  log.register('B', 'B'); log.time('B', 2000);
  log.register('C', 'C'); const c = log.time('C', 500); log.invalidate(c); log.time('C', 3000);
  log.register('D', 'D');
  const st = computeStats(buildState(log.events));
  assert.equal(st.participantCount, 4);
  assert.equal(st.participantsWithTime, 3);
  assert.equal(st.attemptCount, 5);
  assert.equal(st.validAttemptCount, 4);
  assert.equal(st.invalidAttemptCount, 1);
  assert.equal(st.bestCs, 1000);
  assert.equal(st.medianCs, 2000); // beste-tider 1000, 2000, 3000
});

test('vinnermodus beste tid: raskeste gyldige tid vinner', () => {
  const log = eventLog();
  log.register('A', 'A'); log.time('A', 1500);
  log.register('B', 'B'); log.time('B', 1200);
  log.register('C', 'C'); log.time('C', 1300);
  const w = determineWinner(buildState(log.events), 'best');
  assert.equal(w.winnerId, 'B');
  assert.equal(w.winnerCs, 1200);
  assert.equal(w.tie, false);
  assert.deepEqual(w.top5.map((r) => r.id), ['B', 'C', 'A']);
});

test('beste tid: ugyldig forsøk kan ikke vinne', () => {
  const log = eventLog();
  log.register('A', 'A'); const a = log.time('A', 100); log.invalidate(a, 'tjuvstart');
  log.register('B', 'B'); log.time('B', 1200);
  assert.equal(determineWinner(buildState(log.events), 'best').winnerId, 'B');
});

test('beste tid: likhet avgjøres på tidligste registrering og vises som uavgjort', () => {
  const log = eventLog();
  log.register('SEN', 'Sen', 'X', { email: 'sen@x.no' }, );
  log.register('TIDLIG', 'Tidlig');
  // SEN er registrert først i loggen, men vi gir TIDLIG et eldre tidsstempel
  log.events[1].ts = '2026-10-21T07:00:00.000Z';
  log.time('SEN', 1111);
  log.time('TIDLIG', 1111);
  log.register('C', 'C'); log.time('C', 1500);
  const w = determineWinner(buildState(log.events), 'best');
  assert.equal(w.winnerId, 'TIDLIG');
  assert.equal(w.tie, true);
  assert.deepEqual(w.tiedWith.map((t) => t.id), ['SEN']);
  assert.equal(w.top5[0].tied, true);
  assert.equal(w.top5[2].tied, false);
});

test('vinnermodus nærmest median', () => {
  const log = eventLog();
  // beste-tider: 1000, 1900, 2000, 2200, 5000 → median 2000 (C)
  log.register('A', 'A'); log.time('A', 1000);
  log.register('B', 'B'); log.time('B', 1900);
  log.register('C', 'C'); log.time('C', 2500); log.time('C', 2000);
  log.register('D', 'D'); log.time('D', 2200);
  log.register('E', 'E'); log.time('E', 5000);
  const s = buildState(log.events);
  const w = determineWinner(s, 'median');
  assert.equal(w.medianCs, 2000);
  assert.equal(w.winnerId, 'C', 'deltakerens BESTE tid brukes');
  assert.equal(w.winnerDistance, 0);
  assert.deepEqual(w.top5.map((r) => r.id), ['C', 'B', 'D', 'A', 'E']);
});

test('nærmest median: lik avstand over/under median er uavgjort – tidligste registrering vinner', () => {
  const log = eventLog();
  // beste-tider 1000, 1200, 1400, 1600 → median 1300; B (1200) og C (1400) har begge avstand 100
  log.register('A', 'A'); log.time('A', 1000);
  log.register('B', 'B'); log.time('B', 1200);
  log.register('C', 'C'); log.time('C', 1400);
  log.register('D', 'D'); log.time('D', 1600);
  let w = determineWinner(buildState(log.events), 'median');
  assert.equal(w.medianCs, 1300);
  assert.equal(w.winnerId, 'B');
  assert.equal(w.tie, true);
  assert.deepEqual(w.tiedWith.map((t) => t.id), ['C']);
  // Hvis C var registrert før B, vinner C
  log.events.find((e) => e.data.participantId === 'C' && e.type === 'PARTICIPANT_REGISTERED').ts = '2026-10-21T07:00:00.000Z';
  w = determineWinner(buildState(log.events), 'median');
  assert.equal(w.winnerId, 'C');
  assert.equal(w.tie, true);
});

test('nærmest median med halv hundredel', () => {
  const log = eventLog();
  log.register('A', 'A'); log.time('A', 1000);
  log.register('B', 'B'); log.time('B', 1001);
  const w = determineWinner(buildState(log.events), 'median');
  assert.equal(w.medianCs, 1000.5);
  assert.equal(w.tie, true);
  assert.equal(w.winnerId, 'A');
});

test('ingen gyldige tider gir ingen vinner', () => {
  const log = eventLog();
  log.register('A', 'A');
  assert.equal(determineWinner(buildState(log.events), 'best'), null);
  assert.equal(determineWinner(buildState(log.events), 'median'), null);
});

test('topp 5 begrenses til fem og bruker valgt modus fra innstillinger', () => {
  const log = eventLog();
  for (let i = 0; i < 8; i++) { log.register(`P${i}`, `P${i}`); log.time(`P${i}`, 1000 + i * 100); }
  log.add('SETTINGS_CHANGED', { winnerMode: 'median' });
  const s = buildState(log.events);
  const t = topN(s, 5);
  assert.equal(t.mode, 'median');
  assert.equal(t.rows.length, 5);
  assert.equal(rank(s, 'best').rows[0].participant.id, 'P0');
});

test('kåring låser resultat, opplåsing logges', () => {
  const log = eventLog();
  log.register('A', 'A'); log.time('A', 1000);
  const w = determineWinner(buildState(log.events), 'best');
  log.add('WINNER_DECLARED', w);
  let s = buildState(log.events);
  assert.equal(s.result.locked, true);
  assert.equal(s.result.winnerId, 'A');
  log.add('RESULT_UNLOCKED', { reason: 'feil' });
  s = buildState(log.events);
  assert.equal(s.result.locked, false);
  assert.equal(s.resultHistory.length, 1);
});

test('rask med 1500 deltakere og 4500 forsøk', () => {
  const log = eventLog();
  for (let i = 0; i < 1500; i++) {
    log.register(`ID${i}`, `Navn${i}`);
    for (let k = 0; k < 3; k++) log.time(`ID${i}`, 1000 + ((i * 7919 + k * 31) % 5000));
  }
  const t0 = performance.now();
  const s = buildState(log.events);
  determineWinner(s, 'median');
  determineWinner(s, 'best');
  computeStats(s);
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `brukte ${ms.toFixed(0)} ms`);
});
