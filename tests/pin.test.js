import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPin, verifyPin, isValidPinFormat } from '../app/core/pin.js';

test('PIN-format 4–8 sifre', () => {
  assert.ok(isValidPinFormat('1234'));
  assert.ok(isValidPinFormat('12345678'));
  assert.equal(isValidPinFormat('123'), false);
  assert.equal(isValidPinFormat('12a4'), false);
});

test('PIN hashes med salt og verifiseres', async () => {
  const rec = await hashPin('2026');
  assert.notEqual(rec.hash, '2026');
  assert.ok(await verifyPin('2026', rec));
  assert.equal(await verifyPin('2027', rec), false);
  const rec2 = await hashPin('2026');
  assert.notEqual(rec.salt, rec2.salt);
});
