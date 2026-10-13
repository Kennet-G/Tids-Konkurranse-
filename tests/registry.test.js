import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { CompetitionRegistry, competitionDbName } from '../app/core/registry.js';
import { EventStore, deleteDatabase } from '../app/core/db.js';
import { makeEvent } from '../app/core/events.js';
import { hashPin, verifyPin } from '../app/core/pin.js';

test('flere konkurranser på samme enhet, hver med egen PIN og egen database', async () => {
  const idb = new IDBFactory();
  const reg = await new CompetitionRegistry(idb).open();
  await reg.put({ id: 'a', name: 'VVS-dagene', createdAt: '2026-10-20T08:00:00Z', pin: await hashPin('1111') });
  await reg.put({ id: 'b', name: 'Fagdag', createdAt: '2026-10-21T08:00:00Z', pin: await hashPin('2222') });
  const list = await reg.list();
  assert.deepEqual(list.map((c) => c.name), ['Fagdag', 'VVS-dagene'], 'nyeste først');
  assert.ok(await verifyPin('1111', (await reg.get('a')).pin));
  assert.equal(await verifyPin('1111', (await reg.get('b')).pin), false, 'PIN gjelder bare egen konkurranse');

  const sa = await new EventStore(idb, competitionDbName('a')).open();
  const sb = await new EventStore(idb, competitionDbName('b')).open();
  await sa.append(makeEvent('PARTICIPANT_REGISTERED', { participantId: 'x', firstName: 'Ola' }));
  assert.equal(await sa.count(), 1);
  assert.equal(await sb.count(), 0, 'data er adskilt');
  sa.close(); sb.close();
  reg.close();
});

test('aktiv konkurranse huskes på enheten', async () => {
  const reg = await new CompetitionRegistry(new IDBFactory()).open();
  assert.equal(await reg.getActive(), null);
  await reg.put({ id: 'a', name: 'A', createdAt: 'x' });
  await reg.setActive('a');
  assert.equal(await reg.getActive(), 'a');
  reg.close();
});

test('sletting fjerner konkurransen, dens data og aktiv-markering – andre konkurranser berøres ikke', async () => {
  const idb = new IDBFactory();
  const reg = await new CompetitionRegistry(idb).open();
  await reg.put({ id: 'a', name: 'A', createdAt: '1' });
  await reg.put({ id: 'b', name: 'B', createdAt: '2' });
  await reg.setActive('a');
  for (const id of ['a', 'b']) {
    const s = await new EventStore(idb, competitionDbName(id)).open();
    await s.append(makeEvent('SETTINGS_CHANGED', { name: id }));
    s.close();
  }
  await reg.remove('a');
  await deleteDatabase(idb, competitionDbName('a'));
  assert.deepEqual((await reg.list()).map((c) => c.id), ['b']);
  assert.equal(await reg.getActive(), null);
  const again = await new EventStore(idb, competitionDbName('a')).open();
  assert.equal(await again.count(), 0, 'dataene til A er borte');
  again.close();
  const other = await new EventStore(idb, competitionDbName('b')).open();
  assert.equal(await other.count(), 1, 'B er urørt');
  other.close();
  reg.close();
});
