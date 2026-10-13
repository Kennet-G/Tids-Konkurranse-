// Datalag for én konkurranse: egen IndexedDB-hendelseslogg + tilstand i minnet + øktdata (utkast/pågående forsøk).
import { EventStore } from '../core/db.js';
import { competitionDbName } from '../core/registry.js';
import { applyEvent, buildState, makeEvent } from '../core/events.js';

const SESSION_KEY = 'session';

export class AppStore {
  constructor(competitionId, device) {
    this.competitionId = competitionId;
    this.lsKey = `trox-konk-session-${competitionId}`;
    this.db = new EventStore(undefined, competitionDbName(competitionId));
    this.device = device;
    this.state = null;
    this.listeners = new Set();
    this.session = {};
  }

  async init() {
    await this.db.open();
    this.state = buildState(await this.db.all());
    // Øktdata: bruk den nyeste av IndexedDB og localStorage (localStorage skrives synkront ved hver endring).
    const fromDb = (await this.db.kvGet(SESSION_KEY)) ?? {};
    let fromLs = {};
    try { fromLs = JSON.parse(localStorage.getItem(this.lsKey) || '{}'); } catch { /* ignorer */ }
    this.session = (fromLs.savedAt ?? 0) > (fromDb.savedAt ?? 0) ? fromLs : fromDb;
    return this;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Lagrer hendelse(r). Løftet løses først når IndexedDB-transaksjonen er fullført.
  // Kaster ved feil – kalleren skal da vise rød melding.
  async record(type, data) {
    const ev = makeEvent(type, data, { device: this.device });
    return this.recordPrepared(ev);
  }

  async recordPrepared(ev) {
    const stored = await this.db.append(ev);
    applyEvent(this.state, stored);
    this.emit(stored);
    return stored;
  }

  async recordMany(events) {
    const stored = await this.db.append(events);
    for (const ev of stored) applyEvent(this.state, ev);
    this.emit(null);
    return stored;
  }

  async hasEvent(id) {
    const ids = await this.db.allIds();
    return ids.includes(id);
  }

  emit(ev) {
    for (const fn of this.listeners) {
      try { fn(ev, this.state); } catch (e) { console.error(e); }
    }
  }

  async allEvents() {
    return this.db.all();
  }

  async rebuild() {
    this.state = buildState(await this.db.all());
    this.emit(null);
  }

  // ---- Økt (skjermbilde, skjemautkast, pågående forsøk) – overlever omstart ----
  setSession(patch) {
    this.session = { ...this.session, ...patch, savedAt: Date.now() };
    try { localStorage.setItem(this.lsKey, JSON.stringify(this.session)); } catch { /* full/blokkert */ }
    if (this.closed) return Promise.resolve();
    const snapshot = this.session;
    this._sessPromise = this.db.kvSet(SESSION_KEY, snapshot).catch((e) => console.error('Kunne ikke lagre økt', e));
    return this._sessPromise;
  }

  clearSession() {
    return this.setSession({ screen: 'home', participantId: null, draft: null, attempt: null, pending: null, justRegistered: false });
  }

  close() {
    this.closed = true;
    this.listeners.clear();
    this.db.close();
  }

  // Fjerner øktdata i localStorage (ved sletting av konkurransen).
  forgetLocal() {
    try { localStorage.removeItem(this.lsKey); } catch { /* */ }
  }

  kvGet(key, fallback) { return this.db.kvGet(key, fallback); }
  kvSet(key, value) { return this.db.kvSet(key, value); }
}
