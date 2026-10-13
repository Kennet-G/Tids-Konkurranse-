// Små DOM-hjelpere.

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* ikke støttet */ }
}

let toastTimer;
export function toast(message, kind = 'info', ms = 3000) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = `toast ${kind}`;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Modal dialog. buttons: [{ label, value, cls }]. Returnerer valgt verdi (null ved lukking).
export function modal({ title, html = '', buttons = [{ label: 'OK', value: true, cls: 'primary' }], kind = '', onMount } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="modal ${kind}" role="dialog" aria-modal="true">
      ${title ? `<h2>${esc(title)}</h2>` : ''}<div class="modal-content">${html}</div>
      <div class="btn-row">${buttons.map((b, i) => `<button class="btn ${b.cls ?? ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    const close = (value) => { overlay.remove(); resolve(value); };
    overlay.querySelectorAll('.btn-row button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const b = buttons[Number(btn.dataset.i)];
        if (b.validate) {
          const ok = await b.validate(overlay);
          if (!ok) return;
        }
        close(typeof b.value === 'function' ? b.value(overlay) : b.value);
      });
    });
    document.body.appendChild(overlay);
    onMount?.(overlay, close);
  });
}

export function fatal(message) {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.innerHTML = `<div style="font-size:120px">!</div><h1>${esc(message)}</h1>
    <p class="lead" style="color:inherit">Ikke bruk appen før dette er løst. Last siden på nytt, eller kontakt ansvarlig.</p>
    <button class="btn" style="border-color:#fff;color:#fff" onclick="location.reload()">Last inn på nytt</button>`;
  document.body.appendChild(el);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
