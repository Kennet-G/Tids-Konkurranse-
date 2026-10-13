// PIN-beskyttet adminportal: deltakere, forsøk, resultat/vinner, hendelseslogg og system (backup/import/PIN).
import { EventType, EVENT_LABELS, attemptsFor, describeEvent, findEmailDuplicates, fullName, uuid, CONTACT_FIELDS } from '../core/events.js';
import { computeStats, determineWinner, rank, bestTimes } from '../core/stats.js';
import { formatCs, formatCsPrecise, formatDateTime, parseTimeToCs } from '../core/time.js';
import { normalizeContact, validateRegistration } from '../core/validation.js';
import { readEventsFromWorkbook, eventsToImport } from '../core/excel.js';
import { $, $$, esc, modal, toast, vibrate, debounce } from './dom.js';
import { isAwake } from '../services/wakelock.js';

const PAGE = 300;
const IDLE_LOGOUT_MS = 5 * 60 * 1000;
const MODE_LABEL = { best: 'Beste tid', median: 'Nærmest median' };
const METHOD_LABEL = { timer: 'Stoppeklokke', manual: 'Manuell', admin: 'Admin' };
const FIELD_LABEL = { firstName: 'Fornavn', lastName: 'Etternavn', company: 'Firma', email: 'E-post', phone: 'Telefon' };

export class AdminUI {
  constructor(store, backup, auth, { onClose }) {
    this.store = store;
    this.backup = backup;
    this.auth = auth;
    this.onClose = onClose;
    this.el = null;
    this.tab = 'participants';
    this.view = { participants: { q: '', sort: 'registeredAt', dir: -1, limit: PAGE }, attempts: { q: '', sort: 'recordedAt', dir: -1, filter: 'all', limit: PAGE }, log: { q: '', limit: PAGE } };
    this.detailId = null;
    this.unsub = null;
  }

  get open() { return !!this.el; }

  async show() {
    if (this.el) return;
    const ok = await this.auth.requirePin('Adminportal – tast PIN');
    if (!ok) return false;
    this.store.record(EventType.ADMIN_LOGIN, {}).catch(() => {});
    this.el = document.createElement('div');
    this.el.className = 'admin';
    this.el.innerHTML = `<header class="topbar"><img class="logo" src="assets/logo.svg" alt="TROX">
        <div><div class="title">Adminportal</div><div class="subtitle">Tidskonkurranse VVS-dagene 2026</div></div>
        <span class="spacer"></span><span class="statusbar" id="adm-status"></span>
        <button class="btn primary small" id="adm-close">Lukk admin</button></header>
      <nav class="tabs">${[['participants', 'Deltakere'], ['attempts', 'Forsøk'], ['result', 'Resultat'], ['log', 'Hendelseslogg'], ['system', 'Backup og system']]
        .map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</nav>
      <div class="admin-body" id="adm-body"></div>`;
    document.body.appendChild(this.el);
    $('#adm-close', this.el).addEventListener('click', () => this.close());
    $$('.tabs button', this.el).forEach((b) => b.addEventListener('click', () => { this.detailId = null; this.setTab(b.dataset.tab); }));
    this.unsub = this.store.onChange(debounce(() => this.refresh(), 150));
    this.resetIdle = () => { clearTimeout(this.idleTimer); this.idleTimer = setTimeout(() => this.close(), IDLE_LOGOUT_MS); };
    this.el.addEventListener('pointerdown', this.resetIdle, { passive: true });
    this.el.addEventListener('keydown', this.resetIdle, { passive: true });
    this.resetIdle();
    this.setTab(this.tab);
    return true;
  }

  close() {
    if (!this.el) return;
    clearTimeout(this.idleTimer);
    this.unsub?.();
    $$('.overlay').forEach((o) => o.remove());
    this.el.remove();
    this.el = null;
    this.onClose?.();
  }

  setTab(tab) {
    this.tab = tab;
    $$('.tabs button', this.el).forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    this.refresh(true);
  }

  refresh(full = false) {
    if (!this.el) return;
    const st = computeStats(this.store.state);
    $('#adm-status', this.el).innerHTML = `${st.participantCount} deltakere · ${st.attemptCount} forsøk · Backup: ${this.backup.last ? formatDateTime(this.backup.last.at).slice(11, 16) : 'ingen'}`;
    if (this.detailId) return this.renderDetail(this.detailId, full);
    const body = $('#adm-body', this.el);
    const fn = { participants: this.renderParticipants, attempts: this.renderAttempts, result: this.renderResult, log: this.renderLog, system: this.renderSystem }[this.tab];
    fn.call(this, body, full);
  }

  // ------------------------------------------------------------ Deltakere
  renderParticipants(body, full) {
    const v = this.view.participants;
    if (full || !$('#p-table', body)) {
      body.innerHTML = `<div class="toolbar">
          <input type="search" id="p-q" placeholder="Søk navn, firma, e-post, telefon eller ID" value="${esc(v.q)}">
          <span class="muted" id="p-count"></span></div>
        <table class="grid" id="p-table"><thead><tr>
          ${th('id', 'ID', v)}${th('name', 'Navn', v)}${th('company', 'Firma', v)}${th('email', 'E-post', v)}${th('phone', 'Telefon', v)}
          ${th('registeredAt', 'Registrert', v)}${th('attempts', 'Forsøk', v, 'num')}${th('best', 'Beste tid', v, 'num')}<th></th></tr></thead><tbody></tbody></table>
        <div class="more" id="p-more"></div>`;
      $('#p-q', body).addEventListener('input', debounce((e) => { v.q = e.target.value; v.limit = PAGE; this.fillParticipants(body); }, 120));
      $$('#p-table th[data-sort]', body).forEach((h) => h.addEventListener('click', () => { sortBy(v, h.dataset.sort); this.renderParticipants(body, true); }));
      $('#p-table tbody', body).addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) this.openDetail(tr.dataset.id); });
    }
    this.fillParticipants(body);
  }

  fillParticipants(body) {
    const v = this.view.participants;
    const s = this.store.state;
    const best = new Map(bestTimes(s).map((b) => [b.participant.id, b.bestCs]));
    const q = v.q.trim().toLowerCase();
    let rows = [...s.participants.values()].map((p) => ({
      p, name: fullName(p), attempts: (s.attemptsByParticipant.get(p.id) ?? []).length, best: best.get(p.id) ?? null,
    }));
    if (q) rows = rows.filter((r) => `${r.p.id}\u0000${r.name}\u0000${r.p.company}\u0000${r.p.email}\u0000${r.p.phone}`.toLowerCase().includes(q));
    const key = { id: (r) => r.p.id, name: (r) => r.name.toLowerCase(), company: (r) => r.p.company.toLowerCase(), email: (r) => r.p.email.toLowerCase(),
      phone: (r) => r.p.phone, registeredAt: (r) => r.p.registeredAt, attempts: (r) => r.attempts, best: (r) => r.best ?? Infinity }[v.sort];
    rows.sort((a, b) => cmp(key(a), key(b)) * v.dir);
    $('#p-count', body).textContent = `${rows.length} av ${s.participants.size}`;
    $('#p-table tbody', body).innerHTML = rows.slice(0, v.limit).map((r) => `<tr class="clickable" data-id="${esc(r.p.id)}">
      <td class="mono small">${esc(r.p.id)}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.p.company)}</td><td>${esc(r.p.email)}</td><td>${esc(r.p.phone)}</td>
      <td class="small">${formatDateTime(r.p.registeredAt)}</td><td class="num">${r.attempts}</td><td class="num">${r.best == null ? '–' : formatCs(r.best)}</td>
      <td>${r.p.duplicateOf?.length ? '<span class="tag warn">Mulig dobbel</span>' : ''}${r.p.updatedAt ? ' <span class="tag">Endret</span>' : ''}</td></tr>`).join('')
      || '<tr><td colspan="9" class="muted">Ingen deltakere</td></tr>';
    this.moreButton($('#p-more', body), rows.length, v, () => this.fillParticipants(body));
  }

  moreButton(el, total, v, refill) {
    el.innerHTML = total > v.limit ? `<button class="btn secondary small">Vis flere (${total - v.limit} til)</button>` : '';
    el.firstChild?.addEventListener('click', () => { v.limit += PAGE; refill(); });
  }

  openDetail(id) {
    this.detailId = id;
    this.refresh(true);
  }

  renderDetail(id, full) {
    const body = $('#adm-body', this.el);
    const s = this.store.state;
    const p = s.participants.get(id);
    if (!p) { this.detailId = null; return this.refresh(true); }
    const atts = attemptsFor(s, id);
    const bestValid = atts.filter((a) => a.valid).reduce((m, a) => (m == null || a.cs < m ? a.cs : m), null);
    const attemptsHtml = atts.length ? `<table class="grid"><thead><tr><th>#</th><th class="num">Tid</th><th>Metode</th><th>Registrert</th><th>Status</th><th>Merknad</th><th></th></tr></thead><tbody>
      ${atts.map((a, i) => `<tr class="${a.valid ? '' : 'invalid'}"><td>${i + 1}</td><td class="num"><strong>${formatCs(a.cs)}</strong>${a.valid && a.cs === bestValid ? ' <span class="tag green">Beste</span>' : ''}</td>
        <td>${METHOD_LABEL[a.method] ?? esc(a.method)}</td><td class="small">${formatDateTime(a.recordedAt)}</td>
        <td>${a.valid ? '<span class="tag green">Gyldig</span>' : `<span class="tag red">Ugyldig</span> <span class="small">${esc(a.validityReason)}</span>`}</td>
        <td class="small">${esc(a.note)}</td>
        <td><button class="btn small ${a.valid ? 'danger' : 'secondary'}" data-toggle="${esc(a.id)}">${a.valid ? 'Merk ugyldig' : 'Gjør gyldig'}</button></td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Ingen forsøk ennå.</p>';
    if (!full && $('#d-form', body)) {
      $('#d-attempts', body).innerHTML = attemptsHtml;
      return;
    }
    body.innerHTML = `<div class="toolbar"><button class="btn secondary small" id="d-back">← Tilbake til liste</button>
        <h2 style="margin:0 0 0 12px">${esc(fullName(p))}</h2><span class="id-chip">ID: ${esc(p.id)}</span>
        ${p.duplicateOf?.length ? `<span class="tag warn">Mulig dobbeltregistrering av ${esc(p.duplicateOf.join(', '))}</span>` : ''}</div>
      <div class="panel"><h3>Kontaktinfo</h3>
        <form id="d-form" class="detail-grid" novalidate autocomplete="off">
          ${CONTACT_FIELDS.map((f) => `<div class="field"><label for="d-${f}">${FIELD_LABEL[f]}</label>
            <input id="d-${f}" name="${f}" type="${f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text'}" value="${esc(p[f])}" autocomplete="off" spellcheck="false"><div class="err"></div></div>`).join('')}
          <div class="field"><label for="d-reason">Årsak til endring <span class="opt">(valgfritt)</span></label><input id="d-reason" name="reason" type="text" autocomplete="off"></div>
        </form>
        <p class="small muted">Registrert ${formatDateTime(p.registeredAt)} (${p.registrationMethod === 'manual' ? 'manuell ID' : 'QR'}) · Samtykke: ${p.consent ? 'Ja' : 'Nei'} · Skannet ${p.scanCount} ganger${p.updatedAt ? ` · Sist endret ${formatDateTime(p.updatedAt)}` : ''}</p>
        <div class="btn-row" style="justify-content:flex-start"><button class="btn primary small" id="d-save">Lagre endringer</button></div>
      </div>
      <div class="panel"><h3>Forsøk</h3><div id="d-attempts">${attemptsHtml}</div>
        <div class="btn-row" style="justify-content:flex-start;margin-top:14px"><button class="btn secondary small" id="d-addtime">+ Legg til tid manuelt</button></div></div>`;
    $('#d-back', body).addEventListener('click', () => { this.detailId = null; this.refresh(true); });
    $('#d-save', body).addEventListener('click', () => this.saveContact(p.id));
    $('#d-addtime', body).addEventListener('click', () => this.addTime(p.id));
    $('#d-attempts', body).addEventListener('click', (e) => { const b = e.target.closest('[data-toggle]'); if (b) this.toggleValidity(b.dataset.toggle); });
  }

  async saveContact(id) {
    const p = this.store.state.participants.get(id);
    const form = $('#d-form', this.el);
    const raw = Object.fromEntries(CONTACT_FIELDS.map((f) => [f, form.elements[f].value]));
    const { valid, errors } = validateRegistration(raw, { requireConsent: false });
    for (const f of CONTACT_FIELDS) {
      const wrap = form.elements[f].closest('.field');
      wrap.classList.toggle('invalid', !!errors[f]);
      $('.err', wrap).textContent = errors[f] ?? '';
    }
    if (!valid) return;
    const next = normalizeContact(raw);
    const changes = {};
    const previous = {};
    for (const f of CONTACT_FIELDS) if (next[f] !== p[f]) { changes[f] = next[f]; previous[f] = p[f]; }
    if (!Object.keys(changes).length) return toast('Ingen endringer', 'info');
    if ('email' in changes) {
      const dups = findEmailDuplicates(this.store.state, next.email, id);
      if (dups.length) {
        const go = await modal({ kind: 'warn', title: 'E-posten finnes på et annet ID',
          html: `<ul>${dups.map((d) => `<li>${esc(fullName(d))}, ${esc(d.company)} – ID ${esc(d.id)}</li>`).join('')}</ul><p>Lagre likevel?</p>`,
          buttons: [{ label: 'Avbryt', value: false }, { label: 'Lagre likevel', value: true, cls: 'primary' }] });
        if (!go) return;
      }
    }
    await this.save(EventType.PARTICIPANT_UPDATED, { participantId: id, changes, previous, reason: form.elements.reason.value.trim() }, 'Kontaktinfo lagret');
    this.refresh(true);
  }

  async toggleValidity(attemptId) {
    const a = this.store.state.attempts.get(attemptId);
    if (!a) return;
    const makeValid = !a.valid;
    const reason = await modal({
      title: makeValid ? 'Gjøre forsøket gyldig igjen?' : 'Merke forsøket som ugyldig?',
      html: `<p>Tid <strong>${formatCs(a.cs)}</strong> registrert ${formatDateTime(a.recordedAt)}. Forsøket slettes aldri – endringen logges.</p>
        <div class="field"><label for="v-reason">Årsak (påkrevd)</label><input id="v-reason" type="text" autocomplete="off"><div class="err" id="v-err"></div></div>`,
      buttons: [{ label: 'Avbryt', value: null }, { label: makeValid ? 'Gjør gyldig' : 'Merk ugyldig', cls: makeValid ? 'primary' : 'danger',
        value: (o) => $('#v-reason', o).value.trim(), validate: (o) => { const ok = !!$('#v-reason', o).value.trim(); $('#v-err', o).textContent = ok ? '' : 'Skriv en årsak'; return ok; } }],
      onMount: (o) => setTimeout(() => $('#v-reason', o).focus(), 50),
    });
    if (reason == null) return;
    await this.save(EventType.ATTEMPT_VALIDITY_CHANGED, { attemptId, participantId: a.participantId, valid: makeValid, reason }, makeValid ? 'Forsøket er gyldig' : 'Forsøket er merket ugyldig');
  }

  async addTime(participantId) {
    const res = await modal({
      title: 'Legg til tid manuelt',
      html: `<div class="field"><label for="a-time">Tid (f.eks. 12,34 eller 1:05,20)</label><input id="a-time" type="text" inputmode="decimal" autocomplete="off"><div class="err" id="a-err"></div></div>
        <div class="field"><label for="a-note">Merknad / årsak</label><input id="a-note" type="text" autocomplete="off"></div>`,
      buttons: [{ label: 'Avbryt', value: null }, { label: 'Lagre tid', cls: 'primary',
        value: (o) => ({ cs: parseTimeToCs($('#a-time', o).value), note: $('#a-note', o).value.trim() }),
        validate: (o) => { const ok = parseTimeToCs($('#a-time', o).value) != null; $('#a-err', o).textContent = ok ? '' : 'Ugyldig tid'; return ok; } }],
      onMount: (o) => setTimeout(() => $('#a-time', o).focus(), 50),
    });
    if (!res) return;
    await this.save(EventType.ATTEMPT_RECORDED, { attemptId: uuid(), participantId, cs: res.cs, method: 'admin', note: res.note }, `Tid ${formatCs(res.cs)} lagret`);
  }

  // Lagrer en hendelse; grønn bekreftelse kun etter fullført skriving, rød ved feil.
  async save(type, data, okMsg) {
    try {
      const ev = await this.store.record(type, data);
      vibrate(120);
      toast(`✓ ${okMsg}`, 'ok');
      return ev;
    } catch (e) {
      console.error(e);
      vibrate([300, 100, 300]);
      toast(`LAGRING FEILET: ${e?.message ?? e}`, 'err', 8000);
      return null;
    }
  }

  // ------------------------------------------------------------ Forsøk
  renderAttempts(body, full) {
    const v = this.view.attempts;
    if (full || !$('#a-table', body)) {
      body.innerHTML = `<div class="toolbar">
          <input type="search" id="a-q" placeholder="Søk navn, firma eller ID" value="${esc(v.q)}">
          <select id="a-f"><option value="all">Alle forsøk</option><option value="valid">Kun gyldige</option><option value="invalid">Kun ugyldige</option></select>
          <span class="muted" id="a-count"></span></div>
        <table class="grid" id="a-table"><thead><tr>${th('recordedAt', 'Registrert', v)}${th('name', 'Navn', v)}${th('company', 'Firma', v)}
          ${th('cs', 'Tid', v, 'num')}${th('method', 'Metode', v)}${th('valid', 'Status', v)}<th>Merknad / årsak</th><th></th></tr></thead><tbody></tbody></table><div class="more" id="a-more"></div>`;
      $('#a-f', body).value = v.filter;
      $('#a-f', body).addEventListener('change', (e) => { v.filter = e.target.value; v.limit = PAGE; this.fillAttempts(body); });
      $('#a-q', body).addEventListener('input', debounce((e) => { v.q = e.target.value; v.limit = PAGE; this.fillAttempts(body); }, 120));
      $$('#a-table th[data-sort]', body).forEach((h) => h.addEventListener('click', () => { sortBy(v, h.dataset.sort); this.renderAttempts(body, true); }));
      $('#a-table tbody', body).addEventListener('click', (e) => {
        const b = e.target.closest('[data-toggle]');
        if (b) return this.toggleValidity(b.dataset.toggle);
        const tr = e.target.closest('tr[data-pid]');
        if (tr) this.openDetail(tr.dataset.pid);
      });
    }
    this.fillAttempts(body);
  }

  fillAttempts(body) {
    const v = this.view.attempts;
    const s = this.store.state;
    const q = v.q.trim().toLowerCase();
    let rows = [...s.attempts.values()].map((a) => { const p = s.participants.get(a.participantId); return { a, p, name: fullName(p), company: p?.company ?? '' }; });
    if (v.filter === 'valid') rows = rows.filter((r) => r.a.valid);
    if (v.filter === 'invalid') rows = rows.filter((r) => !r.a.valid);
    if (q) rows = rows.filter((r) => `${r.a.participantId}\u0000${r.name}\u0000${r.company}`.toLowerCase().includes(q));
    const key = { recordedAt: (r) => r.a.recordedSeq, name: (r) => r.name.toLowerCase(), company: (r) => r.company.toLowerCase(), cs: (r) => r.a.cs,
      method: (r) => r.a.method, valid: (r) => (r.a.valid ? 1 : 0) }[v.sort];
    rows.sort((a, b) => cmp(key(a), key(b)) * v.dir);
    $('#a-count', body).textContent = `${rows.length} forsøk`;
    $('#a-table tbody', body).innerHTML = rows.slice(0, v.limit).map((r) => `<tr class="clickable ${r.a.valid ? '' : 'invalid'}" data-pid="${esc(r.a.participantId)}">
      <td class="small">${formatDateTime(r.a.recordedAt)}</td><td><strong>${esc(r.name || r.a.participantId)}</strong></td><td>${esc(r.company)}</td>
      <td class="num"><strong>${formatCs(r.a.cs)}</strong></td><td>${METHOD_LABEL[r.a.method] ?? esc(r.a.method)}</td>
      <td>${r.a.valid ? '<span class="tag green">Gyldig</span>' : '<span class="tag red">Ugyldig</span>'}</td>
      <td class="small">${esc([r.a.note, r.a.validityReason].filter(Boolean).join(' · '))}</td>
      <td><button class="btn small ${r.a.valid ? 'danger' : 'secondary'}" data-toggle="${esc(r.a.id)}">${r.a.valid ? 'Ugyldig' : 'Gyldig'}</button></td></tr>`).join('')
      || '<tr><td colspan="8" class="muted">Ingen forsøk</td></tr>';
    this.moreButton($('#a-more', body), rows.length, v, () => this.fillAttempts(body));
  }

  // ------------------------------------------------------------ Resultat
  renderResult(body) {
    const s = this.store.state;
    const st = computeStats(s);
    const mode = s.settings.winnerMode;
    const r = rank(s, mode);
    const top = r.rows.slice(0, 5);
    const locked = s.result?.locked;
    const w = s.result;
    body.innerHTML = `<div class="cards">
        ${card('Deltakere', st.participantCount)}${card('Med gyldig tid', st.participantsWithTime)}${card('Forsøk', st.attemptCount)}
        ${card('Ugyldige forsøk', st.invalidAttemptCount)}${card('Beste tid', st.bestCs == null ? '–' : formatCs(st.bestCs))}
        ${card('Median (beste-tider)', st.medianCs == null ? '–' : formatCsPrecise(st.medianCs))}</div>
      ${w ? `<div class="winner-box"><div class="muted">${w.locked ? 'KÅRET VINNER – resultatet er låst' : 'Tidligere kåring (låst opp)'} · ${formatDateTime(w.declaredAt)} · ${MODE_LABEL[w.mode]}</div>
        <div class="name">${esc(w.winnerName)}</div><div class="lead">${esc(w.winnerCompany)} · ${esc(w.winnerEmail ?? '')} · Tid ${formatCs(w.winnerCs)}
        ${w.mode === 'median' ? ` · median ${formatCsPrecise(w.medianCs)}` : ''}</div>
        ${w.tie ? `<p><span class="tag warn">UAVGJORT</span> Lik ${w.mode === 'median' ? 'avstand til median' : 'tid'} med ${esc(w.tiedWith.map((t) => t.name).join(', '))} – avgjort på tidligste registrering.</p>` : ''}
        ${w.locked ? '<button class="btn small danger" id="unlock">Lås opp resultat …</button>' : ''}</div>` : ''}
      <div class="panel"><h3>Vinnermodus</h3>
        <div class="radio-row">
          <label><input type="radio" name="mode" value="best" ${mode === 'best' ? 'checked' : ''} ${locked ? 'disabled' : ''}> 1. Beste tid – raskeste gyldige tid vinner</label>
          <label><input type="radio" name="mode" value="median" ${mode === 'median' ? 'checked' : ''} ${locked ? 'disabled' : ''}> 2. Nærmest median – beste tid nærmest medianen vinner</label>
        </div><p class="small muted">Ved likhet vinner tidligste registrering, og det vises som uavgjort.${locked ? ' Modus kan ikke endres mens resultatet er låst.' : ''}</p></div>
      <div class="panel"><h3>Topp 5 – ${MODE_LABEL[mode]}${mode === 'median' && r.medianCs != null ? ` (median ${formatCsPrecise(r.medianCs)})` : ''}</h3>
        ${top.length ? `<table class="grid"><thead><tr><th>Plass</th><th>Navn</th><th>Firma</th><th class="num">Beste tid</th>${mode === 'median' ? '<th class="num">Avstand</th>' : ''}<th>Registrert</th><th></th></tr></thead><tbody>
          ${top.map((x) => `<tr class="clickable" data-pid="${esc(x.participant.id)}"><td><strong>${x.rank}</strong></td><td><strong>${esc(fullName(x.participant))}</strong></td><td>${esc(x.participant.company)}</td>
            <td class="num">${formatCs(x.bestCs)}</td>${mode === 'median' ? `<td class="num">${formatCsPrecise(x.distance)}</td>` : ''}<td class="small">${formatDateTime(x.participant.registeredAt)}</td>
            <td>${x.tied ? '<span class="tag warn">Uavgjort</span>' : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Ingen gyldige tider ennå.</p>'}
        <div class="btn-row" style="justify-content:flex-start;margin-top:16px">
          <button class="btn primary" id="declare" ${!top.length || locked ? 'disabled' : ''}>Kåre vinner</button>
          <button class="btn secondary" id="export-full">Eksporter komplett Excel</button></div>
      </div>`;
    $$('input[name=mode]', body).forEach((i) => i.addEventListener('change', async () => {
      await this.save(EventType.SETTINGS_CHANGED, { winnerMode: i.value }, `Vinnermodus: ${MODE_LABEL[i.value]}`);
      this.refresh(true);
    }));
    $$('tr[data-pid]', body).forEach((tr) => tr.addEventListener('click', () => this.openDetail(tr.dataset.pid)));
    $('#declare', body).addEventListener('click', () => this.declareWinner());
    $('#export-full', body).addEventListener('click', () => this.exportNow());
    $('#unlock', body)?.addEventListener('click', () => this.unlock());
  }

  async declareWinner() {
    const s = this.store.state;
    const w = determineWinner(s, s.settings.winnerMode);
    if (!w) return;
    const ok = await modal({
      title: 'Kåre vinner?',
      html: `<p class="lead">Modus: <strong>${MODE_LABEL[w.mode]}</strong></p>
        <p class="lead" style="font-size:30px"><strong>${esc(w.winnerName)}</strong>, ${esc(w.winnerCompany)} – ${formatCs(w.winnerCs)}</p>
        ${w.tie ? `<p><span class="tag warn">UAVGJORT</span> med ${esc(w.tiedWith.map((t) => t.name).join(', '))} – avgjort på tidligste registrering.</p>` : ''}
        <p>Resultatet låses og logges. Det tas også en Excel-backup.</p>`,
      buttons: [{ label: 'Avbryt', value: false }, { label: 'Kåre og lås', value: true, cls: 'primary' }],
    });
    if (!ok) return;
    const ev = await this.save(EventType.WINNER_DECLARED, w, `Vinner kåret: ${w.winnerName}`);
    if (ev) this.backup.run('vinner kåret').catch(() => toast('Backup feilet – eksporter manuelt', 'err', 6000));
    this.refresh(true);
  }

  async unlock() {
    const reason = await modal({
      title: 'Låse opp resultatet?', kind: 'warn',
      html: `<p>Kåringen beholdes i loggen. Etter opplåsing kan modus endres og ny vinner kåres.</p>
        <div class="field"><label for="u-r">Årsak (påkrevd)</label><input id="u-r" type="text" autocomplete="off"></div>`,
      buttons: [{ label: 'Avbryt', value: null }, { label: 'Lås opp', cls: 'danger', value: (o) => $('#u-r', o).value.trim(), validate: (o) => !!$('#u-r', o).value.trim() }],
    });
    if (reason == null) return;
    if (!(await this.auth.requirePin('Bekreft med PIN'))) return;
    await this.save(EventType.RESULT_UNLOCKED, { reason }, 'Resultatet er låst opp');
    this.refresh(true);
  }

  // ------------------------------------------------------------ Hendelseslogg
  async renderLog(body, full) {
    const v = this.view.log;
    if (full || !$('#l-table', body)) {
      body.innerHTML = `<div class="toolbar"><input type="search" id="l-q" placeholder="Søk i loggen (type, ID, tekst)" value="${esc(v.q)}"><span class="muted" id="l-count"></span></div>
        <table class="grid" id="l-table"><thead><tr><th>Nr</th><th>Tidspunkt</th><th>Type</th><th>Deltaker-ID</th><th>Beskrivelse</th></tr></thead><tbody></tbody></table><div class="more" id="l-more"></div>`;
      $('#l-q', body).addEventListener('input', debounce((e) => { v.q = e.target.value; v.limit = PAGE; this.fillLog(body); }, 150));
    }
    this.fillLog(body);
  }

  async fillLog(body) {
    const v = this.view.log;
    const events = (await this.store.allEvents()).reverse();
    const q = v.q.trim().toLowerCase();
    const rows = events.map((ev) => ({ ev, text: `${EVENT_LABELS[ev.type] ?? ev.type}: ${describeEvent(ev, formatCs)}` }))
      .filter((r) => !q || `${r.ev.type}\u0000${r.text}\u0000${r.ev.data?.participantId ?? ''}`.toLowerCase().includes(q));
    if (!$('#l-table', body)) return;
    $('#l-count', body).textContent = `${rows.length} hendelser`;
    $('#l-table tbody', body).innerHTML = rows.slice(0, v.limit).map(({ ev, text }) => `<tr><td>${ev.seq}</td><td class="small">${formatDateTime(ev.ts)}</td>
      <td><span class="tag">${esc(ev.type)}</span></td><td class="mono small">${esc(ev.data?.participantId ?? '')}</td><td>${esc(text)}</td></tr>`).join('');
    this.moreButton($('#l-more', body), rows.length, v, () => this.fillLog(body));
  }

  // ------------------------------------------------------------ System
  async renderSystem(body) {
    const last = this.backup.last;
    let persisted = null;
    let estimate = null;
    try { persisted = await navigator.storage?.persisted?.(); estimate = await navigator.storage?.estimate?.(); } catch { /* ikke støttet */ }
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    body.innerHTML = `<div class="panel"><h3>Excel-backup</h3>
        <p>Automatisk backup lastes ned til <strong>Nedlastinger</strong> hvert 10. minutt (når noe er endret) og etter hver 10. registrering.</p>
        <p>Siste backup: <strong>${last ? `${esc(last.filename)} – ${formatDateTime(last.at)} (${esc(last.reason ?? '')})` : 'ingen ennå'}</strong></p>
        <button class="btn primary" id="s-export">Eksporter Excel nå</button></div>
      <div class="panel"><h3>Gjenoppretting / import</h3>
        <p>Velg en Excel-fil eksportert fra denne appen. Hendelser som allerede finnes hoppes over, så samme fil kan trygt importeres flere ganger.</p>
        <input type="file" id="s-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
        <button class="btn secondary" id="s-import">Velg fil og importer …</button></div>
      <div class="panel"><h3>Status</h3>
        <table class="grid" style="max-width:760px"><tbody>
          <tr><td>Vedvarende lagring (persist)</td><td>${persisted ? '<span class="tag green">Ja</span>' : '<span class="tag red">Nei</span> – installer appen på startskjermen og start på nytt'}</td></tr>
          <tr><td>Lagringsbruk</td><td>${estimate ? `${mb(estimate.usage ?? 0)} MB av ${mb(estimate.quota ?? 0)} MB` : 'ukjent'}</td></tr>
          <tr><td>Skjerm holdes våken (Wake Lock)</td><td>${isAwake() ? '<span class="tag green">Aktiv</span>' : '<span class="tag red">Ikke aktiv</span>'}</td></tr>
          <tr><td>Offline-klar (service worker)</td><td>${navigator.serviceWorker?.controller ? '<span class="tag green">Ja</span>' : '<span class="tag red">Nei</span> – last siden på nytt én gang med nett'}</td></tr>
          <tr><td>Hendelser i loggen</td><td>${this.store.state.eventCount}</td></tr>
          <tr><td>Enhets-ID</td><td class="mono">${esc(this.store.device)}</td></tr>
          ${this.store.state.warnings.length ? `<tr><td>Advarsler ved avspilling</td><td>${this.store.state.warnings.slice(-10).map((w) => esc(w.message)).join('<br>')}</td></tr>` : ''}
        </tbody></table>
        <div class="btn-row" style="justify-content:flex-start;margin-top:14px"><button class="btn secondary small" id="s-vib">Test vibrasjon</button></div></div>
      <div class="panel"><h3>PIN</h3><button class="btn secondary" id="s-pin">Endre PIN …</button></div>`;
    $('#s-export', body).addEventListener('click', () => this.exportNow());
    $('#s-import', body).addEventListener('click', () => $('#s-file', body).click());
    $('#s-file', body).addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) this.importFile(f); });
    $('#s-vib', body).addEventListener('click', () => vibrate([120, 60, 120]));
    $('#s-pin', body).addEventListener('click', () => this.auth.changePin());
  }

  async exportNow() {
    try {
      const name = await this.backup.run('manuell eksport');
      if (name) toast(`✓ Lastet ned ${name}`, 'ok', 5000);
    } catch (e) {
      toast(`EKSPORT FEILET: ${e?.message ?? e}`, 'err', 8000);
    }
  }

  async importFile(file) {
    let parsed;
    try {
      parsed = readEventsFromWorkbook(window.XLSX, new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      return modal({ title: 'Kunne ikke lese filen', kind: 'warn', html: `<p>${esc(e?.message ?? e)}</p>` });
    }
    const { fresh, skipped } = eventsToImport(await this.store.db.allIds(), parsed.events);
    const regs = fresh.filter((e) => e.type === EventType.PARTICIPANT_REGISTERED).length;
    const times = fresh.filter((e) => e.type === EventType.ATTEMPT_RECORDED).length;
    const ok = await modal({
      title: 'Importere data?',
      html: `<p>Fil: <strong>${esc(file.name)}</strong></p><ul>
        <li>${fresh.length} nye hendelser (${regs} registreringer, ${times} tider)</li>
        <li>${skipped} hendelser finnes allerede og hoppes over</li>
        ${parsed.errors.length ? `<li style="color:var(--error)">${parsed.errors.length} rader kunne ikke leses: ${esc(parsed.errors.slice(0, 5).join('; '))}</li>` : ''}</ul>
        <p>Eksisterende data endres ikke – nye hendelser legges til.</p>`,
      buttons: [{ label: 'Avbryt', value: false }, { label: `Importer ${fresh.length} hendelser`, value: true, cls: 'primary' }],
    });
    if (!ok) return;
    try {
      if (fresh.length) await this.store.recordMany(fresh.map((e) => ({ ...e })));
      await this.store.record(EventType.DATA_IMPORTED, { filename: file.name, imported: fresh.length, skipped, errors: parsed.errors.length });
      vibrate(150);
      toast(`✓ Importert ${fresh.length} hendelser`, 'ok', 5000);
      this.refresh(true);
    } catch (e) {
      console.error(e);
      vibrate([300, 100, 300]);
      modal({ title: 'IMPORT FEILET', kind: 'warn', html: `<p>Ingen data ble importert. ${esc(e?.message ?? e)}</p>` });
    }
  }
}

function th(key, label, v, cls = '') {
  const sorted = v.sort === key;
  return `<th data-sort="${key}" class="${cls} ${sorted ? 'sorted' : ''}">${label}${sorted ? (v.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
}

function sortBy(v, key) {
  if (v.sort === key) v.dir = -v.dir; else { v.sort = key; v.dir = 1; }
  v.limit = PAGE;
}

function cmp(a, b) {
  if (a === b) return 0;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'nb');
}

function card(k, v) {
  return `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`;
}

