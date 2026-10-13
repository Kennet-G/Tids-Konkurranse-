// Forsiden: konkurranser på denne enheten. Velg en, opprett ny, eller gjenopprett fra backup.
import { WinnerMode } from '../core/events.js';
import { readEventsFromWorkbook, competitionInfo } from '../core/excel.js';
import { formatDateTime } from '../core/time.js';
import { $, $$, esc, modal, toast } from './dom.js';
import { chooseNewPin } from './auth.js';

export async function renderChooser(host, { registry, activeId, onOpen, onCreate, onRestore }) {
  const list = await registry.list();
  host.innerHTML = `<section class="screen chooser"><div class="inner">
    <h1>Konkurranser</h1>
    <p class="lead muted" style="margin-top:0">Velg konkurransen som skal være aktiv på denne enheten.</p>
    <div class="comp-list">${list.length ? list.map((c) => `<button class="comp-card ${c.id === activeId ? 'active' : ''}" data-id="${esc(c.id)}">
        <span class="comp-ikon">⏱</span><span><strong>${esc(c.name)}</strong><small>Opprettet ${formatDateTime(c.createdAt).slice(0, 10)}${c.id === activeId ? ' · sist brukt på denne enheten' : ''}</small></span><span class="pil">›</span></button>`).join('')
      : '<div class="empty">Ingen konkurranser på denne enheten ennå.<br>Opprett en ny, eller gjenopprett fra en backupfil.</div>'}</div>
    <div class="btn-row" style="justify-content:flex-start">
      <button class="btn" id="c-new">+ Ny konkurranse</button>
      <button class="btn secondary" id="c-restore">Gjenopprett fra backup …</button>
      <input type="file" id="c-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
    </div>
    <p class="small muted" style="margin-top:28px">Data lagres bare lokalt på denne enheten. Hver konkurranse har sin egen PIN for adminpanelet.</p>
  </div></section>`;
  $$('.comp-card', host).forEach((b) => b.addEventListener('click', () => onOpen(b.dataset.id)));
  $('#c-new', host).addEventListener('click', async () => {
    const opts = await newCompetitionDialog();
    if (!opts) return;
    const pin = await chooseNewPin('Velg PIN for adminpanelet (4 sifre)', `Gjelder bare «${opts.name}». Skriv den ned og oppbevar den trygt.`);
    if (!pin) return;
    onCreate({ ...opts, pin });
  });
  $('#c-restore', host).addEventListener('click', () => $('#c-file', host).click());
  $('#c-file', host).addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    let parsed;
    try {
      parsed = readEventsFromWorkbook(window.XLSX, new Uint8Array(await f.arrayBuffer()));
    } catch (err) {
      return modal({ title: 'Kunne ikke lese filen', kind: 'warn', html: `<p>${esc(err?.message ?? err)}</p>`, buttons: [{ label: 'OK', value: true }] });
    }
    if (!parsed.events.length) return toast('Filen inneholder ingen hendelser', 'err');
    onRestore({ file: f, parsed, info: competitionInfo(parsed.events) });
  });
}

export function newCompetitionDialog(defaultName = '') {
  return modal({
    title: 'Ny konkurranse',
    html: `<div class="field"><label for="nc-name">Navn på konkurransen</label><input id="nc-name" type="text" maxlength="80" value="${esc(defaultName)}" placeholder="f.eks. VVS-dagene 2026" autocomplete="off"><div class="err" id="nc-err"></div></div>
      <p style="margin:14px 0 6px;font-weight:650;color:var(--navy)">Tidtaking</p>
      <div class="radio-row"><label><input type="radio" name="nc-timer" value="off" checked> Ekstern stoppeklokke</label><label><input type="radio" name="nc-timer" value="on"> Stoppeklokke i appen (START/STOPP)</label></div>
      <p style="margin:14px 0 6px;font-weight:650;color:var(--navy)">Vinner</p>
      <div class="radio-row"><label><input type="radio" name="nc-mode" value="best" checked> Beste tid</label><label><input type="radio" name="nc-mode" value="median"> Nærmest median</label></div>
      <p class="small muted">Alt kan endres senere i adminpanelet. Neste steg: velg en 4-sifret PIN.</p>`,
    buttons: [{ label: 'Avbryt', value: null, cls: 'secondary' }, { label: 'Neste', value: (o) => ({
      name: $('#nc-name', o).value.trim().replace(/\s+/g, ' '),
      timerEnabled: $('input[name=nc-timer]:checked', o).value === 'on',
      winnerMode: $('input[name=nc-mode]:checked', o).value === 'median' ? WinnerMode.MEDIAN : WinnerMode.BEST,
    }), validate: (o) => { const ok = !!$('#nc-name', o).value.trim(); $('#nc-err', o).textContent = ok ? '' : 'Skriv et navn'; return ok; } }],
    onMount: (o) => setTimeout(() => $('#nc-name', o).focus(), 50),
  });
}
