import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { EventStore } from '../app/core/db.js';
import { makeEvent } from '../app/core/events.js';

test('hendelser lagres med stigende seq og overlever ny åpning', async () => {
  const idb = new IDBFactory();
  const s1 = await new EventStore(idb, 't1').open();
  const e1 = await s1.append(makeEvent('SCAN', { participantId: 'A' }));
  const [e2, e3] = await s1.append([makeEvent('SCAN', { participantId: 'B' }), makeEvent('SCAN', { participantId: 'C' })]);
  assert.ok(e1.seq < e2.seq && e2.seq < e3.seq);
  s1.close();
  const s2 = await new EventStore(idb, 't1').open();
  const all = await s2.all();
  assert.deepEqual(all.map((e) => e.data.participantId), ['A', 'B', 'C']);
  assert.equal(await s2.count(), 3);
  s2.close();
});

test('samme hendelses-ID kan ikke lagres to ganger (transaksjonen feiler)', async () => {
  const s = await new EventStore(new IDBFactory(), 't2').open();
  const ev = makeEvent('SCAN', { participantId: 'A' });
  await s.append(ev);
  await assert.rejects(() => s.append(ev));
  assert.equal(await s.count(), 1);
  s.close();
});

test('feil i én hendelse i en batch lagrer ingen av dem', async () => {
  const s = await new EventStore(new IDBFactory(), 't3').open();
  const ev = makeEvent('SCAN', { participantId: 'A' });
  await s.append(ev);
  await assert.rejects(() => s.append([makeEvent('SCAN', { participantId: 'B' }), ev]));
  assert.equal(await s.count(), 1);
  s.close();
});

test('nøkkel/verdi-lager for utkast og pågående forsøk', async () => {
  const s = await new EventStore(new IDBFactory(), 't4').open();
  assert.equal(await s.kvGet('session', 'tom'), 'tom');
  await s.kvSet('session', { screen: 'timing', participantId: 'A', startedEpoch: 123 });
  assert.deepEqual(await s.kvGet('session'), { screen: 'timing', participantId: 'A', startedEpoch: 123 });
  await s.kvDelete('session');
  assert.equal(await s.kvGet('session'), null);
  s.close();
});

test('hendelseslageret har ingen slette- eller oppdateringsfunksjon', () => {
  const eventMethods = Object.getOwnPropertyNames(EventStore.prototype).filter((n) => !n.startsWith('kv'));
  for (const name of eventMethods) assert.doesNotMatch(name, /delete|remove|clear|update|put/i);
});
