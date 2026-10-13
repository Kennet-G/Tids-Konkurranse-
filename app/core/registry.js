// Oversikt over konkurranser på denne enheten. Hver konkurranse har sin egen database (egen hendelseslogg).
// PIN lagres her som hash per konkurranse.

const REGISTRY_DB = 'trox-konkurranser';

export function competitionDbName(id) {
  return `trox-konk-${id}`;
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Transaksjonsfeil'));
    tx.onabort = () => reject(tx.error ?? new Error('Transaksjonen ble avbrutt'));
  });
}

export class CompetitionRegistry {
  constructor(idb) {
    this.idb = idb ?? globalThis.indexedDB;
    this.db = null;
  }

  async open() {
    const open = this.idb.open(REGISTRY_DB, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('competitions')) db.createObjectStore('competitions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    this.db = await req(open);
    return this;
  }

  async list() {
    const tx = this.db.transaction(['competitions'], 'readonly');
    const all = await req(tx.objectStore('competitions').getAll());
    return all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async get(id) {
    const tx = this.db.transaction(['competitions'], 'readonly');
    return (await req(tx.objectStore('competitions').get(id))) ?? null;
  }

  async put(record) {
    const tx = this.db.transaction(['competitions'], 'readwrite');
    const done = txDone(tx);
    tx.objectStore('competitions').put(record);
    await done;
    return record;
  }

  async update(id, patch) {
    const cur = await this.get(id);
    if (!cur) throw new Error('Konkurransen finnes ikke');
    return this.put({ ...cur, ...patch });
  }

  // Fjerner konkurransen fra oversikten. Selve databasen slettes av kalleren (deleteDatabase).
  async remove(id) {
    const tx = this.db.transaction(['competitions', 'kv'], 'readwrite');
    const done = txDone(tx);
    tx.objectStore('competitions').delete(id);
    const kv = tx.objectStore('kv');
    const r = kv.get('activeCompetition');
    r.onsuccess = () => { if (r.result?.value === id) kv.delete('activeCompetition'); };
    await done;
  }

  async kvGet(key, fallback = null) {
    const tx = this.db.transaction(['kv'], 'readonly');
    const row = await req(tx.objectStore('kv').get(key));
    return row ? row.value : fallback;
  }

  async kvSet(key, value) {
    const tx = this.db.transaction(['kv'], 'readwrite');
    const done = txDone(tx);
    tx.objectStore('kv').put({ key, value });
    await done;
  }

  async getActive() { return this.kvGet('activeCompetition', null); }
  async setActive(id) { return id ? this.kvSet('activeCompetition', id) : this.kvDelete('activeCompetition'); }

  async kvDelete(key) {
    const tx = this.db.transaction(['kv'], 'readwrite');
    const done = txDone(tx);
    tx.objectStore('kv').delete(key);
    await done;
  }

  close() { this.db?.close(); }
}
