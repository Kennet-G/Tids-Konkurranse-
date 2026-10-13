// PIN per konkurranse (4 sifre). Hash lagres i konkurranseoversikten på enheten – aldri i klartekst,
// aldri i hendelsesloggen eller Excel-filene.
import { hashPin, verifyPin, isValidPinFormat } from '../core/pin.js';
import { $, esc, toast, vibrate } from './dom.js';

const MAX_FAILS = 5;
const LOCK_MS = 60 * 1000;
const lockState = new Map(); // competitionId -> { fails, lockedUntil }

// Ber om PIN for konkurransen. onFail kalles ved feil PIN (for logging).
export async function requirePin(registry, competitionId, title = 'Tast PIN', { onFail } = {}) {
  const rec = await registry.get(competitionId);
  if (!rec?.pin) { toast('Konkurransen har ingen PIN', 'err'); return false; }
  const ls = lockState.get(competitionId) ?? { fails: 0, lockedUntil: 0 };
  if (Date.now() < ls.lockedUntil) {
    toast(`For mange feil forsøk. Vent ${Math.ceil((ls.lockedUntil - Date.now()) / 1000)} sek.`, 'err');
    return false;
  }
  const pin = await pinPad(title, rec.name);
  if (pin == null) return false;
  if (await verifyPin(pin, rec.pin)) { lockState.set(competitionId, { fails: 0, lockedUntil: 0 }); return true; }
  ls.fails += 1;
  if (ls.fails >= MAX_FAILS) { ls.lockedUntil = Date.now() + LOCK_MS; ls.fails = 0; }
  lockState.set(competitionId, ls);
  vibrate([200, 80, 200]);
  onFail?.();
  toast('Feil PIN', 'err');
  return false;
}

// Velg ny PIN (to ganger). Returnerer hash-posten eller null.
export async function chooseNewPin(title = 'Velg PIN (4 sifre)', hint = 'Skriv den ned og oppbevar den trygt.') {
  const a = await pinPad(title, hint);
  if (a == null) return null;
  if (!isValidPinFormat(a)) { toast('PIN må være 4 sifre', 'err'); return null; }
  const b = await pinPad('Gjenta PIN');
  if (b == null) return null;
  if (a !== b) { toast('PIN-kodene var ikke like – prøv igjen', 'err'); return null; }
  return hashPin(a);
}

export function pinPad(title, hint = '') {
  return new Promise((resolve) => {
    let value = '';
    let closed = false;
    const o = document.createElement('div');
    o.className = 'overlay';
    o.innerHTML = `<div class="modal" style="width:min(440px,100%)" role="dialog" aria-modal="true">
      <h2>${esc(title)}</h2>${hint ? `<p class="muted">${esc(hint)}</p>` : ''}
      <div class="pin-display" id="pin-d">&nbsp;</div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <button type="button" data-k="del" aria-label="Slett">⌫</button><button type="button" data-k="0">0</button>
        <button type="button" data-k="ok" style="background:var(--action);color:var(--white);border-color:var(--action)">OK</button></div>
      <div class="btn-row"><button type="button" class="btn secondary small" data-k="cancel">Avbryt</button></div></div>`;
    const show = () => { $('#pin-d', o).textContent = value ? '•'.repeat(value.length) : ' '; };
    const done = (v) => { if (closed) return; closed = true; document.removeEventListener('keydown', onKey, true); o.remove(); resolve(v); };
    const press = (k) => {
      if (k === 'cancel') return done(null);
      if (k === 'ok') return value ? done(value) : undefined;
      if (k === 'del') value = value.slice(0, -1);
      else if (/^\d$/.test(k) && value.length < 4) value += k;
      show();
      if (value.length === 4) setTimeout(() => done(value), 120); // 4 sifre: sendes automatisk
    };
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') press('ok');
      else if (e.key === 'Escape') press('cancel');
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    o.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(o);
  });
}
