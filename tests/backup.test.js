import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupDue, INTERVAL_MS } from '../app/services/backup.js';

const t0 = Date.parse('2026-10-21T10:00:00Z');

test('automatisk backup hver time', () => {
  assert.equal(INTERVAL_MS, 60 * 60 * 1000);
});

test('første backup tas så snart første deltaker er registrert', () => {
  assert.equal(backupDue({ last: null, eventCount: 3, registrations: 1, now: t0 }), true);
  assert.equal(backupDue({ last: null, eventCount: 2, registrations: 0, now: t0 }), false, 'tom konkurranse gir ingen fil');
  assert.equal(backupDue({ last: null, eventCount: 0, registrations: 0, now: t0 }), false);
});

test('ingen backup før det har gått en time', () => {
  const last = { at: new Date(t0).toISOString(), eventCount: 10 };
  assert.equal(backupDue({ last, eventCount: 15, now: t0 + 59 * 60 * 1000 }), false);
  assert.equal(backupDue({ last, eventCount: 15, now: t0 + 60 * 60 * 1000 }), true);
});

test('ingen backup når ingenting er endret, selv etter mange timer', () => {
  const last = { at: new Date(t0).toISOString(), eventCount: 10 };
  assert.equal(backupDue({ last, eventCount: 10, now: t0 + 5 * 60 * 60 * 1000 }), false);
});
