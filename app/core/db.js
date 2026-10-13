// IndexedDB-lag. Hendelser legges kun til (append-only); det finnes ingen slette- eller oppdateringsfunksjon
// for hendelseslageret. Et løfte løses først når transaksjonen er fullført («complete») på disk.

export const DB_VERSION = 1;

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

export class EventStore {
  constructor(idb, name) {
    this.idb = idb ?? globalThis.indexedDB;
    this.name = name;
    this.db = null;
  }

  async open() {
    if (!this.idb) throw new Error('IndexedDB er ikke tilgjengelig i denne nettleseren');
    const open = this.idb.open(this.name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('events')) {
        const s = db.createObjectStore('events', { keyPath: 'seq', autoIncrement: true });
        s.createIndex('id', 'id', { unique: true });
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    this.db = await req(open);
    this.db.onversionchange = () => this.db.close();
    return this;
  }

  _tx(stores, mode) {
    // «strict» ber nettleseren skrive til disk før complete (der det støttes).
    try {
      return this.db.transaction(stores, mode, { durability: 'strict' });
    } catch {
      return this.db.transaction(stores, mode);
    }
  }

  // Legger til én eller flere hendelser i én transaksjon. Returnerer hendelsene med seq satt,
  // først etter at transaksjonen er fullført.
  async append(events) {
    const list = Array.isArray(events) ? events : [events];
    const tx = this._tx(['events'], 'readwrite');
    const done = txDone(tx);
    const store = tx.objectStore('events');
    const stored = list.map((ev) => {
      const copy = { ...ev };
      delete copy.seq;
      const r = store.add(copy);
      r.onsuccess = () => { copy.seq = r.result; };
      return copy;
    });
    await done;
    return Array.isArray(events) ? stored : stored[0];
  }

  async all() {
    const tx = this._tx(['events'], 'readonly');
    const result = await req(tx.objectStore('events').getAll());
    return result.sort((a, b) => a.seq - b.seq);
  }

  async count() {
    const tx = this._tx(['events'], 'readonly');
    return req(tx.objectStore('events').count());
  }

  // Alle hendelses-ID-er (indeksnøkler – ikke seq).
  async allIds() {
    const tx = this._tx(['events'], 'readonly');
    const ids = [];
    await new Promise((resolve, reject) => {
      const cur = tx.objectStore('events').index('id').openKeyCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return resolve();
        ids.push(c.key);
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
    return ids;
  }

  async kvGet(key, fallback = null) {
    const tx = this._tx(['kv'], 'readonly');
    const row = await req(tx.objectStore('kv').get(key));
    return row ? row.value : fallback;
  }

  async kvSet(key, value) {
    const tx = this._tx(['kv'], 'readwrite');
    const done = txDone(tx);
    tx.objectStore('kv').put({ key, value });
    await done;
  }

  async kvDelete(key) {
    const tx = this._tx(['kv'], 'readwrite');
    const done = txDone(tx);
    tx.objectStore('kv').delete(key);
    await done;
  }

  close() {
    this.db?.close();
  }
}

// Sletter en hel database (brukes bare når en konkurranse slettes fra sitt eget adminpanel).
export function deleteDatabase(idb, name) {
  return new Promise((resolve, reject) => {
    const r = (idb ?? globalThis.indexedDB).deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
    r.onblocked = () => resolve(); // fullføres når siste tilkobling lukkes
  });
}
