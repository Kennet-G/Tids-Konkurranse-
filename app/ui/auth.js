// PIN-dialog med stort talltastatur. PIN-hash lagres i IndexedDB (kv), aldri i klartekst og aldri i loggen.
import { hashPin, verifyPin, isValidPinFormat } from '../core/pin.js';
import { EventType } from '../core/events.js';
import { $, esc, toast, vibrate } from './dom.js';

const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;

export class Auth {
  constructor(store) {
    this.store = store;
    this.fails = 0;
    this.lockedUntil = 0;
  }

  async hasPin() {
    return !!(await this.store.kvGet('pin', null));
  }

  // Ber om PIN. Første gang (ingen PIN satt) må en ny PIN velges.
  async requirePin(title = 'Tast PIN') {
    if (!(await this.hasPin())) return this.setNewPin('Velg admin-PIN (første gang)', true);
    if (Date.now() < this.lockedUntil) {
      toast(`For mange feil forsøk. Vent ${Math.ceil((this.lockedUntil - Date.now()) / 1000)} sek.`, 'err');
      return false;
    }
    const pin = await pinPad(title);
    if (pin == null) return false;
    const ok = await verifyPin(pin, await this.store.kvGet('pin'));
    if (ok) { this.fails = 0; return true; }
    this.fails += 1;
    vibrate([200, 80, 200]);
    this.store.record(EventType.ADMIN_LOGIN_FAILED, { attempt: this.fails }).catch(() => {});
    if (this.fails >= MAX_FAILS) { this.lockedUntil = Date.now() + LOCK_MS; this.fails = 0; }
    toast('Feil PIN', 'err');
    return false;
  }

  async setNewPin(title, firstTime = false) {
    const a = await pinPad(title, firstTime ? 'Minst 4 sifre. Skriv den ned og oppbevar den trygt.' : 'Minst 4 sifre.');
    if (a == null) return false;
    if (!isValidPinFormat(a)) { toast('PIN må være 4–8 sifre', 'err'); return false; }
    const b = await pinPad('Gjenta PIN');
    if (b == null) return false;
    if (a !== b) { toast('PIN-kodene var ikke like', 'err'); return false; }
    try {
      await this.store.kvSet('pin', await hashPin(a));
      await this.store.record(EventType.PIN_CHANGED, { firstTime });
    } catch (e) {
      toast(`Kunne ikke lagre PIN: ${e?.message ?? e}`, 'err', 6000);
      return false;
    }
    toast('✓ PIN lagret', 'ok');
    return true;
  }

  async changePin() {
    if (!(await this.requirePin('Tast nåværende PIN'))) return false;
    return this.setNewPin('Velg ny PIN');
  }
}

function pinPad(title, hint = '') {
  return new Promise((resolve) => {
    let value = '';
    const o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = `<div class="modal" style="width:min(460px,92vw)" role="dialog" aria-modal="true">
      <h2>${esc(title)}</h2>${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
      <div class="pin-display" id="pin-d">&nbsp;</div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
        <button data-k="del" aria-label="Slett">⌫</button><button data-k="0">0</button><button data-k="ok" style="background:var(--trox-red);color:var(--white)">OK</button></div>
      <div class="btn-row"><button class="btn secondary small" data-k="cancel">Avbryt</button></div></div>`;
    const show = () => { $('#pin-d', o).textContent = value ? '•'.repeat(value.length) : ' '; };
    const done = (v) => { document.removeEventListener('keydown', onKey); o.remove(); resolve(v); };
    const press = (k) => {
      if (k === 'cancel') return done(null);
      if (k === 'ok') return value ? done(value) : undefined;
      if (k === 'del') value = value.slice(0, -1);
      else if (/^\d$/.test(k) && value.length < 8) value += k;
      show();
    };
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
      else if (e.key === 'Escape') press('cancel');
    };
    o.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(o);
  });
}
