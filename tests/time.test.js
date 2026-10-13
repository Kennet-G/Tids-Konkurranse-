import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msToCs, elapsedCs, formatCs, formatCsPrecise, parseTimeToCs, backupFilename } from '../app/core/time.js';

test('ms til hundredeler avkortes nedover', () => {
  assert.equal(msToCs(0), 0);
  assert.equal(msToCs(9), 0);
  assert.equal(msToCs(10), 1);
  assert.equal(msToCs(12345), 1234);
  assert.equal(msToCs(12349.9), 1234);
  assert.equal(msToCs(12339.9999999), 1234, 'flyttallsstøy fra performance.now');
});

test('tidsberegning fra start/stopp', () => {
  assert.equal(elapsedCs(1000.5, 13346.2), 1234);
  assert.equal(elapsedCs(5, 5), 0);
  assert.throws(() => elapsedCs(10, 5), RangeError);
  assert.throws(() => elapsedCs(NaN, 5), RangeError);
});

test('formatering av tid', () => {
  assert.equal(formatCs(0), '0,00');
  assert.equal(formatCs(5), '0,05');
  assert.equal(formatCs(1234), '12,34');
  assert.equal(formatCs(6000), '1:00,00');
  assert.equal(formatCs(7512), '1:15,12');
  assert.equal(formatCs(360000), '1:00:00,00');
  assert.equal(formatCs(null), '');
});

test('median med halv hundredel vises med tre desimaler', () => {
  assert.equal(formatCsPrecise(1234), '12,34');
  assert.equal(formatCsPrecise(1234.5), '12,345');
});

test('tolking av manuell tid', () => {
  assert.equal(parseTimeToCs('12,34'), 1234);
  assert.equal(parseTimeToCs('12.34'), 1234);
  assert.equal(parseTimeToCs('12,3'), 1230);
  assert.equal(parseTimeToCs('12'), 1200);
  assert.equal(parseTimeToCs('1:15,12'), 7512);
  assert.equal(parseTimeToCs('01:05'), 6500);
  assert.equal(parseTimeToCs('1:00:05,5'), 360550);
  assert.equal(parseTimeToCs(' 9 , 99 '), 999);
  for (const bad of ['', 'abc', '0', '0,00', '1:75', '12,345', '-5', '1:2:3:4', '1,2,3']) assert.equal(parseTimeToCs(bad), null, bad);
});

test('format → tolk gir samme verdi', () => {
  for (const cs of [1, 99, 1234, 5999, 6000, 7512, 359999, 360000, 1234567]) assert.equal(parseTimeToCs(formatCs(cs)), cs);
});

test('backup-filnavn med tidsstempel', () => {
  const d = new Date(2026, 9, 21, 14, 30, 7);
  assert.equal(backupFilename(d), 'TROX_VVS2026_2026-10-21_1430.xlsx');
  assert.equal(backupFilename(d, { withSeconds: true }), 'TROX_VVS2026_2026-10-21_143007.xlsx');
});
