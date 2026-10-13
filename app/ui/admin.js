// Adminpanel for ÉN konkurranse (krever konkurransens PIN): deltakere, tider, resultat/vinner,
// hendelseslogg og innstillinger (navn, tidtaking av/på, PIN, backup/import, bytt og slett konkurranse).
import { EventType, EVENT_LABELS, attemptsFor, describeEvent, findExistingParticipant, identityKey, sharedContacts, fullName, uuid, CONTACT_FIELDS } from '../core/events.js';
import { computeStats, determineWinner, rank, bestTimes } from '../core/stats.js';
import { formatCs, formatCsPrecise, formatDateTime, parseTimeToCs } from '../core/time.js';
import { normalizeContact, validateRegistration } from '../core/validation.js';
import { readEventsFromWorkbook, eventsToImport, competitionInfo } from '../core/excel.js';
import { $, $$, esc, modal, toast, vibrate, debounce } from './dom.js';
import { requirePin, chooseNewPin } from './auth.js';
import { isAwake } from '../services/wakelock.js';

const PAGE = 300;
const IDLE_LOGOUT_MS = 5 * 60 * 1000;
const MODE_LABEL = { best: 'Beste tid', median: 'Nærmest median' };
const METHOD_LABEL = { timer: 'Appens stoppeklokke', manual: 'Ekstern stoppeklokke', admin: 'Lagt inn av admin' };
const FIELD_LABEL = { firstName: 'Fornavn', lastName: 'Etternavn', company: 'Firma', email: 'E-post', phone: 'Telefon' };

export class AdminUI {
  constructor({ store, backup, registry, competitionId, onClose, onSwitch, onDeleted, onRenamed }) {
    Object.assign(this, { store, backup, registry, competitionId, onClose, onSwitch, onDeleted, onRenamed });
    this.el = null;
    this.tab = 'participants';
    this.view = {
      participants: { q: '', sort: 'nr', dir: -1, limit: PAGE },
      attempts: { q: '', sort: 'recordedAt', dir: -1, filter: 'active', limit: PAGE },
      log: { q: '', limit: PAGE },
    };
    this.detailId = null;
    this.unsub = null;
  }

  get open() { return !!this.el; }
  get state() { return this.store.state; }

  pin(title) {
    return requirePin(this.registry, this.competitionId, title, { onFail: () => this.store.record(EventType.ADMIN_LOGIN_FAILED, {}).catch(() => {}) });
  }

  async show() {
    if (this.el) return true;
    if (!(await this.pin('Adminpanel – tast PIN'))) return false;
    this.store.record(EventType.ADMIN_LOGIN, {}).catch(() => {});
    this.el = document.createElement('div');
    this.el.className = 'admin';
    this.el.innerHTML = `<header class="topbar"><img class="logo" src="assets/logo.png" alt="TROX">
        <div class="brand-tekst"><span class="title" id="adm-title"></span><span class="subtitle">Adminpanel</span></div>
        <span class="spacer"></span><span class="statusbar" id="adm-status"></span>
        <button class="btn small" id="adm-close">Lukk admin</button></header>
      <nav class="tabs">${[['participants', 'Deltakere'], ['attempts', 'Tider'], ['result', 'Resultat'], ['log', 'Hendelseslogg'], ['settings', 'Innstillinger og backup']]
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
    const st = computeStats(this.state);
    $('#adm-title', this.el).textContent = this.state.settings.name;
    $('#adm-status', this.el).innerHTML = `${st.participantCount} deltakere · ${st.attemptCount} tider · Tidtaking i appen: <strong>${this.state.settings.timerEnabled ? 'PÅ' : 'AV'}</strong> · Backup: ${this.backup.last ? formatDateTime(this.backup.last.at).slice(11, 16) : 'ingen'}`;
    if (this.detailId) return this.renderDetail(this.detailId, full);
    const body = $('#adm-body', this.el);
    const fn = { participants: this.renderParticipants, attempts: this.renderAttempts, result: this.renderResult, log: this.renderLog, settings: this.renderSettings }[this.tab];
    fn.call(this, body, full);
  }

  // Lagrer en hendelse; grønn bekreftelse kun etter fullført skriving, rød ved feil.
  async save(type, data, okMsg) {
    try {
      const ev = await this.store.record(type, data);
      vibrate(120);
      if (okMsg) toast(`✓ ${okMsg}`, 'ok');
      return ev;
    } catch (e) {
      console.error(e);
      vibrate([300, 100, 300]);
      toast(`LAGRING FEILET: ${e?.message ?? e}`, 'err', 8000);
      return null;
    }
  }

  // ------------------------------------------------------------ Deltakere
  renderParticipants(body, full) {
    const v = this.view.participants;
    if (full || !$('#p-table', body)) {
      body.innerHTML = `<div class="toolbar">
          <input type="search" id="p-q" placeholder="Søk navn, firma, e-post, telefon eller nr" value="${esc(v.q)}">
          <span class="muted" id="p-count"></span>
          <button class="btn small" id="p-new">+ Ny deltaker</button></div>
        <div class="table-wrap"><table class="grid" id="p-table"><thead><tr>
          ${th('nr', 'Nr', v, 'num')}${th('name', 'Navn', v)}${th('company', 'Firma', v)}${th('email', 'E-post', v)}${th('phone', 'Telefon', v)}
          ${th('registeredAt', 'Registrert', v)}${th('best', 'Tid', v, 'num')}<th></th></tr></thead><tbody></tbody></table></div>
        <div class="more" id="p-more"></div>`;
      $('#p-q', body).addEventListener('input', debounce((e) => { v.q = e.target.value; v.limit = PAGE; this.fillParticipants(body); }, 120));
      $$('#p-table th[data-sort]', body).forEach((h) => h.addEventListener('click', () => { sortBy(v, h.dataset.sort); this.renderParticipants(body, true); }));
      $('#p-table tbody', body).addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) this.openDetail(tr.dataset.id); });
      $('#p-new', body).addEventListener('click', () => this.addParticipant());
    }
    this.fillParticipants(body);
  }

  fillParticipants(body) {
    const v = this.view.participants;
    const s = this.state;
    const best = new Map(bestTimes(s).map((b) => [b.participant.id, b.bestCs]));
    const q = v.q.trim().toLowerCase();
    let rows = [...s.participants.values()].map((p) => {
      const atts = attemptsFor(s, p.id).filter((a) => !a.deleted);
      return { p, name: fullName(p), count: atts.length, best: best.get(p.id) ?? null, invalidOnly: atts.length > 0 && !best.has(p.id), shared: sharedContacts(s, p) };
    });
    if (q) rows = rows.filter((r) => `${r.p.nr}\u0000${r.name}\u0000${r.p.company}\u0000${r.p.email}\u0000${r.p.phone}`.toLowerCase().includes(q));
    const key = { nr: (r) => r.p.nr, name: (r) => r.name.toLowerCase(), company: (r) => r.p.company.toLowerCase(), email: (r) => r.p.email.toLowerCase(),
      phone: (r) => r.p.phone, registeredAt: (r) => r.p.registeredAt, best: (r) => r.best ?? Infinity }[v.sort];
    rows.sort((a, b) => cmp(key(a), key(b)) * v.dir);
    $('#p-count', body).textContent = `${rows.length} av ${s.participants.size}`;
    $('#p-table tbody', body).innerHTML = rows.slice(0, v.limit).map((r) => `<tr class="clickable" data-id="${esc(r.p.id)}">
      <td class="num">${r.p.nr}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.p.company)}</td><td>${esc(r.p.email)}</td><td>${esc(r.p.phone)}</td>
      <td class="small">${formatDateTime(r.p.registeredAt)}</td>
      <td class="num">${r.best != null ? `<strong>${formatCs(r.best)}</strong>` : r.invalidOnly ? '<span class="tag red">Ugyldig</span>' : '<span class="tag">Ingen tid</span>'}</td>
      <td>${r.count > 1 ? `<span class="tag blue">${r.count} tider</span>` : ''}${r.p.blockedAttempts ? ` <span class="tag warn">Prøvde igjen ×${r.p.blockedAttempts}</span>` : ''}${r.shared.length ? ` <span class="tag" title="Deler e-post eller telefon med en annen deltaker">Delt kontakt: nr ${r.shared.map((o) => o.nr).join(', ')}</span>` : ''}${r.p.updatedAt ? ' <span class="tag">Endret</span>' : ''}</td></tr>`).join('')
      || '<tr><td colspan="8" class="muted">Ingen deltakere</td></tr>';
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

  // Admin kan registrere en deltaker direkte (f.eks. etterregistrering).
  async addParticipant() {
    const res = await modal({
      title: 'Ny deltaker',
      html: `<div class="detail-grid">${CONTACT_FIELDS.map((f) => `<div class="field"><label for="n-${f}">${FIELD_LABEL[f]}${f === 'phone' ? ' <span class="opt">(valgfritt)</span>' : ''}</label>
        <input id="n-${f}" type="${f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text'}" autocomplete="off"><div class="err"></div></div>`).join('')}</div>
        <p class="small muted">Deltakeren må ha gitt samtykke muntlig eller skriftlig. Registreringen logges som lagt inn av admin.</p>`,
      buttons: [{ label: 'Avbryt', value: null, cls: 'secondary' }, { label: 'Registrer', value: (o) => Object.fromEntries(CONTACT_FIELDS.map((f) => [f, $(`#n-${f}`, o).value])),
        validate: (o) => {
          const raw = Object.fromEntries(CONTACT_FIELDS.map((f) => [f, $(`#n-${f}`, o).value]));
          const { valid, errors } = validateRegistration(raw, { requireConsent: false });
          for (const f of CONTACT_FIELDS) $(`#n-${f}`, o).closest('.field').querySelector('.err').textContent = errors[f] ?? '';
          return valid;
        } }],
    });
    if (!res) return;
    const contact = normalizeContact(res);
    const existing = findExistingParticipant(this.state, contact);
    if (existing) {
      const go = await modal({ kind: 'warn', title: 'Finnes allerede', html: `<p>${esc(fullName(existing))} (nr ${existing.nr}) er registrert med nøyaktig samme navn, firma, e-post og telefon.</p>`,
        buttons: [{ label: 'Åpne eksisterende', value: 'open', cls: 'secondary' }, { label: 'Registrer likevel', value: 'new' }] });
      if (go === 'open') return this.openDetail(existing.id);
      if (go !== 'new') return;
    }
    const participantId = uuid();
    const ev = await this.save(EventType.PARTICIPANT_REGISTERED, { participantId, ...contact, consent: true, consentText: 'Registrert av admin', method: 'admin' }, `${contact.firstName} er registrert`);
    if (ev) this.openDetail(participantId);
  }

  renderDetail(id, full) {
    const body = $('#adm-body', this.el);
    const s = this.state;
    const p = s.participants.get(id);
    if (!p) { this.detailId = null; return this.refresh(true); }
    const atts = attemptsFor(s, id);
    const bestValid = atts.filter((a) => a.valid && !a.deleted).reduce((m, a) => (m == null || a.cs < m ? a.cs : m), null);
    const attemptsHtml = atts.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>#</th><th class="num">Tid</th><th>Metode</th><th>Registrert</th><th>Status</th><th>Merknad / endringer</th><th></th></tr></thead><tbody>
      ${atts.map((a, i) => attemptRow(a, i + 1, a.valid && !a.deleted && a.cs === bestValid)).join('')}
      </tbody></table></div>` : '<p class="muted">Ingen tid ennå.</p>';
    if (!full && $('#d-form', body)) {
      $('#d-attempts', body).innerHTML = attemptsHtml;
      return;
    }
    body.innerHTML = `<div class="toolbar"><button class="btn secondary small" id="d-back">← Tilbake til listen</button>
        <h2 style="margin:0 0 0 12px">${esc(fullName(p))}</h2><span class="tag blue">Nr ${p.nr}</span>
        ${p.blockedAttempts ? `<span class="tag warn">Prøvde å registrere seg igjen ${p.blockedAttempts} gang(er)</span>` : ''}</div>
      <div class="panel"><h3>Tider</h3><div id="d-attempts">${attemptsHtml}</div>
        <div class="btn-row" style="justify-content:flex-start;margin-top:14px"><button class="btn small" id="d-addtime">+ Legg til tid</button></div></div>
      <div class="panel"><h3>Kontaktinfo</h3>
        <form id="d-form" class="detail-grid" novalidate autocomplete="off">
          ${CONTACT_FIELDS.map((f) => `<div class="field"><label for="d-${f}">${FIELD_LABEL[f]}</label>
            <input id="d-${f}" name="${f}" type="${f === 'email' ? 'email' : f === 'phone' ? 'tel' : 'text'}" value="${esc(p[f])}" autocomplete="off" spellcheck="false"><div class="err"></div></div>`).join('')}
          <div class="field"><label for="d-reason">Årsak til endring <span class="opt">(valgfritt)</span></label><input id="d-reason" name="reason" type="text" autocomplete="off"></div>
        </form>
        <p class="small muted">Registrert ${formatDateTime(p.registeredAt)} · Samtykke: ${p.consent ? 'Ja' : 'Nei'}${p.updatedAt ? ` · Sist endret ${formatDateTime(p.updatedAt)}` : ''}</p>
        <div class="btn-row" style="justify-content:flex-start"><button class="btn small" id="d-save">Lagre kontaktinfo</button></div>
      </div>`;
    $('#d-back', body).addEventListener('click', () => { this.detailId = null; this.refresh(true); });
    $('#d-save', body).addEventListener('click', () => this.saveContact(p.id));
    $('#d-addtime', body).addEventListener('click', () => this.addTime(p.id));
    $('#d-attempts', body).addEventListener('click', (e) => this.onAttemptAction(e));
  }

  onAttemptAction(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return false;
    e.stopPropagation();
    const id = b.dataset.attempt;
    if (b.dataset.act === 'edit') this.editTime(id);
    else if (b.dataset.act === 'delete') this.deleteTime(id);
    else if (b.dataset.act === 'validity') this.toggleValidity(id);
    return true;
  }

  async saveContact(id) {
    const p = this.state.participants.get(id);
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
    const twin = [...this.state.participants.values()].find((o) => o.id !== id && identityKey(o) === identityKey(next));
    if (twin) {
      const go = await modal({ kind: 'warn', title: 'Identisk med en annen deltaker',
        html: `<p>${esc(fullName(twin))} (nr ${twin.nr}) har nøyaktig samme navn, firma, e-post og telefon. Lagre likevel?</p>`,
        buttons: [{ label: 'Avbryt', value: false, cls: 'secondary' }, { label: 'Lagre likevel', value: true }] });
      if (!go) return;
    }
    await this.save(EventType.PARTICIPANT_UPDATED, { participantId: id, changes, previous, reason: form.elements.reason.value.trim() }, 'Kontaktinfo lagret');
    this.refresh(true);
  }

  async addTime(participantId) {
    const res = await timeDialog('Legg til tid', '', 'Merknad / årsak (valgfritt)', false);
    if (!res) return;
    await this.save(EventType.ATTEMPT_RECORDED, { attemptId: uuid(), participantId, cs: res.cs, method: 'admin', note: res.text }, `Tid ${formatCs(res.cs)} lagret`);
  }

  async editTime(attemptId) {
    const a = this.state.attempts.get(attemptId);
    if (!a || a.deleted) return;
    const res = await timeDialog('Endre tid', formatCs(a.cs), 'Årsak (påkrevd)', true,
      `<p>${esc(fullName(this.state.participants.get(a.participantId)))} – nåværende tid <strong>${formatCs(a.cs)}</strong>. Endringen logges med gammel og ny tid.</p>`);
    if (!res) return;
    if (res.cs === a.cs) return toast('Samme tid – ingen endring', 'info');
    await this.save(EventType.ATTEMPT_EDITED, { attemptId, participantId: a.participantId, cs: res.cs, previousCs: a.cs, reason: res.text }, `Tid endret til ${formatCs(res.cs)}`);
  }

  async deleteTime(attemptId) {
    const a = this.state.attempts.get(attemptId);
    if (!a || a.deleted) return;
    const p = this.state.participants.get(a.participantId);
    const reason = await modal({
      kind: 'danger', title: 'Slette tiden?',
      html: `<p>${esc(fullName(p))} – <strong>${formatCs(a.cs)}</strong> (${formatDateTime(a.recordedAt)}).</p>
        <p>Tiden fjernes fra lister, statistikk og vinnerberegning, og deltakeren kan få et nytt forsøk. Slettingen logges i hendelsesloggen.</p>
        <div class="field"><label for="x-r">Årsak (påkrevd)</label><input id="x-r" type="text" autocomplete="off"><div class="err" id="x-e"></div></div>`,
      buttons: [{ label: 'Avbryt', value: null, cls: 'secondary' }, { label: 'Slett tiden', cls: 'danger-solid', value: (o) => $('#x-r', o).value.trim(),
        validate: (o) => { const ok = !!$('#x-r', o).value.trim(); $('#x-e', o).textContent = ok ? '' : 'Skriv en årsak'; return ok; } }],
      onMount: (o) => setTimeout(() => $('#x-r', o).focus(), 50),
    });
    if (reason == null) return;
    await this.save(EventType.ATTEMPT_DELETED, { attemptId, participantId: a.participantId, cs: a.cs, reason }, 'Tiden er slettet');
  }

  async toggleValidity(attemptId) {
    const a = this.state.attempts.get(attemptId);
    if (!a || a.deleted) return;
    const makeValid = !a.valid;
    const reason = await modal({
      title: makeValid ? 'Gjøre tiden gyldig igjen?' : 'Merke tiden som ugyldig?',
      html: `<p>Tid <strong>${formatCs(a.cs)}</strong>. Ugyldige tider vises fortsatt, men teller ikke i resultatet.</p>
        <div class="field"><label for="v-reason">Årsak (påkrevd)</label><input id="v-reason" type="text" autocomplete="off"><div class="err" id="v-err"></div></div>`,
      buttons: [{ label: 'Avbryt', value: null, cls: 'secondary' }, { label: makeValid ? 'Gjør gyldig' : 'Merk ugyldig', cls: makeValid ? '' : 'danger',
        value: (o) => $('#v-reason', o).value.trim(), validate: (o) => { const ok = !!$('#v-reason', o).value.trim(); $('#v-err', o).textContent = ok ? '' : 'Skriv en årsak'; return ok; } }],
      onMount: (o) => setTimeout(() => $('#v-reason', o).focus(), 50),
    });
    if (reason == null) return;
    await this.save(EventType.ATTEMPT_VALIDITY_CHANGED, { attemptId, participantId: a.participantId, valid: makeValid, reason }, makeValid ? 'Tiden er gyldig' : 'Tiden er merket ugyldig');
  }

  // ------------------------------------------------------------ Tider
  renderAttempts(body, full) {
    const v = this.view.attempts;
    if (full || !$('#a-table', body)) {
      body.innerHTML = `<div class="toolbar">
          <input type="search" id="a-q" placeholder="Søk navn, firma eller nr" value="${esc(v.q)}">
          <select id="a-f"><option value="active">Alle tider (uten slettede)</option><option value="valid">Kun gyldige</option><option value="invalid">Kun ugyldige</option><option value="deleted">Kun slettede</option><option value="all">Alle, også slettede</option></select>
          <span class="muted" id="a-count"></span></div>
        <div class="table-wrap"><table class="grid" id="a-table"><thead><tr>${th('nr', 'Nr', v, 'num')}${th('name', 'Navn', v)}${th('company', 'Firma', v)}
          ${th('cs', 'Tid', v, 'num')}${th('method', 'Metode', v)}${th('status', 'Status', v)}${th('recordedAt', 'Registrert', v)}<th>Merknad / endringer</th><th></th></tr></thead><tbody></tbody></table></div><div class="more" id="a-more"></div>`;
      $('#a-f', body).value = v.filter;
      $('#a-f', body).addEventListener('change', (e) => { v.filter = e.target.value; v.limit = PAGE; this.fillAttempts(body); });
      $('#a-q', body).addEventListener('input', debounce((e) => { v.q = e.target.value; v.limit = PAGE; this.fillAttempts(body); }, 120));
      $$('#a-table th[data-sort]', body).forEach((h) => h.addEventListener('click', () => { sortBy(v, h.dataset.sort); this.renderAttempts(body, true); }));
      $('#a-table tbody', body).addEventListener('click', (e) => {
        if (this.onAttemptAction(e)) return;
        const tr = e.target.closest('tr[data-pid]');
        if (tr) this.openDetail(tr.dataset.pid);
      });
    }
    this.fillAttempts(body);
  }

  fillAttempts(body) {
    const v = this.view.attempts;
    const s = this.state;
    const q = v.q.trim().toLowerCase();
    let rows = [...s.attempts.values()].map((a) => { const p = s.participants.get(a.participantId); return { a, p, name: fullName(p), company: p?.company ?? '', nr: p?.nr ?? 0 }; });
    const filters = { active: (r) => !r.a.deleted, valid: (r) => !r.a.deleted && r.a.valid, invalid: (r) => !r.a.deleted && !r.a.valid, deleted: (r) => r.a.deleted, all: () => true };
    rows = rows.filter(filters[v.filter] ?? filters.active);
    if (q) rows = rows.filter((r) => `${r.nr}\u0000${r.name}\u0000${r.company}`.toLowerCase().includes(q));
    const key = { recordedAt: (r) => r.a.recordedSeq, nr: (r) => r.nr, name: (r) => r.name.toLowerCase(), company: (r) => r.company.toLowerCase(), cs: (r) => r.a.cs,
      method: (r) => r.a.method, status: (r) => (r.a.deleted ? 2 : r.a.valid ? 0 : 1) }[v.sort];
    rows.sort((a, b) => cmp(key(a), key(b)) * v.dir);
    $('#a-count', body).textContent = `${rows.length} tider`;
    $('#a-table tbody', body).innerHTML = rows.slice(0, v.limit).map((r) => `<tr class="clickable ${rowCls(r.a)}" data-pid="${esc(r.a.participantId)}">
      <td class="num">${r.nr || ''}</td><td><strong>${esc(r.name)}</strong></td><td>${esc(r.company)}</td>
      <td class="num t"><strong>${formatCs(r.a.cs)}</strong></td><td>${METHOD_LABEL[r.a.method] ?? esc(r.a.method)}</td>
      <td>${statusTag(r.a)}</td><td class="small">${formatDateTime(r.a.recordedAt)}</td><td class="small">${esc(notes(r.a))}</td>
      <td class="actions">${actionButtons(r.a)}</td></tr>`).join('')
      || '<tr><td colspan="9" class="muted">Ingen tider</td></tr>';
    this.moreButton($('#a-more', body), rows.length, v, () => this.fillAttempts(body));
  }

  // ------------------------------------------------------------ Resultat
  renderResult(body) {
    const s = this.state;
    const st = computeStats(s);
    const mode = s.settings.winnerMode;
    const r = rank(s, mode);
    const top = r.rows.slice(0, 5);
    const locked = s.result?.locked;
    const w = s.result;
    body.innerHTML = `<div class="cards">
        ${card('Deltakere', st.participantCount)}${card('Med gyldig tid', st.participantsWithTime)}${card('Tider', st.attemptCount)}
        ${card('Ugyldige', st.invalidAttemptCount)}${card('Beste tid', st.bestCs == null ? '–' : formatCs(st.bestCs))}
        ${card('Median (beste-tider)', st.medianCs == null ? '–' : formatCsPrecise(st.medianCs))}</div>
      ${w ? `<div class="winner-box"><div class="muted">${w.locked ? 'KÅRET VINNER – resultatet er låst' : 'Tidligere kåring (låst opp)'} · ${formatDateTime(w.declaredAt)} · ${MODE_LABEL[w.mode]}</div>
        <div class="name">${esc(w.winnerName)}</div><div class="lead">${esc(w.winnerCompany)} · ${esc(w.winnerEmail ?? '')} · Tid ${formatCs(w.winnerCs)}
        ${w.mode === 'median' ? ` · median ${formatCsPrecise(w.medianCs)}` : ''}</div>
        ${w.tie ? `<p><span class="tag warn">UAVGJORT</span> Lik ${w.mode === 'median' ? 'avstand til median' : 'tid'} med ${esc(w.tiedWith.map((t) => t.name).join(', '))} – avgjort på tidligste registrering.</p>` : ''}
        ${w.locked ? '<button class="btn small danger" id="unlock">Lås opp resultat …</button>' : ''}</div>` : ''}
      <div class="panel"><h3>Vinnermodus</h3>
        <div class="radio-row">
          <label><input type="radio" name="mode" value="best" ${mode === 'best' ? 'checked' : ''} ${locked ? 'disabled' : ''}> 1. Beste tid – raskeste gyldige tid vinner</label>
          <label><input type="radio" name="mode" value="median" ${mode === 'median' ? 'checked' : ''} ${locked ? 'disabled' : ''}> 2. Nærmest median – tiden nærmest medianen vinner</label>
        </div><p class="small muted">Ved likhet vinner tidligste registrering, og det vises som uavgjort.${locked ? ' Modus kan ikke endres mens resultatet er låst.' : ''}</p></div>
      <div class="panel"><h3>Topp 5 – ${MODE_LABEL[mode]}${mode === 'median' && r.medianCs != null ? ` (median ${formatCsPrecise(r.medianCs)})` : ''}</h3>
        ${top.length ? `<div class="table-wrap"><table class="grid"><thead><tr><th>Plass</th><th>Nr</th><th>Navn</th><th>Firma</th><th class="num">Tid</th>${mode === 'median' ? '<th class="num">Avstand</th>' : ''}<th>Registrert</th><th></th></tr></thead><tbody>
          ${top.map((x) => `<tr class="clickable" data-pid="${esc(x.participant.id)}"><td><strong>${x.rank}</strong></td><td>${x.participant.nr}</td><td><strong>${esc(fullName(x.participant))}</strong></td><td>${esc(x.participant.company)}</td>
            <td class="num">${formatCs(x.bestCs)}</td>${mode === 'median' ? `<td class="num">${formatCsPrecise(x.distance)}</td>` : ''}<td class="small">${formatDateTime(x.participant.registeredAt)}</td>
            <td>${x.tied ? '<span class="tag warn">Uavgjort</span>' : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Ingen gyldige tider ennå.</p>'}
        <div class="btn-row" style="justify-content:flex-start;margin-top:16px">
          <button class="btn" id="declare" ${!top.length || locked ? 'disabled' : ''}>Kåre vinner</button>
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
    const s = this.state;
    const w = determineWinner(s, s.settings.winnerMode);
    if (!w) return;
    const ok = await modal({
      title: 'Kåre vinner?',
      html: `<p class="lead">Modus: <strong>${MODE_LABEL[w.mode]}</strong></p>
        <p class="lead" style="font-size:28px"><strong>${esc(w.winnerName)}</strong>, ${esc(w.winnerCompany)} – ${formatCs(w.winnerCs)}</p>
        ${w.tie ? `<p><span class="tag warn">UAVGJORT</span> med ${esc(w.tiedWith.map((t) => t.name).join(', '))} – avgjort på tidligste registrering.</p>` : ''}
        <p>Resultatet låses og logges. Det tas også en Excel-backup.</p>`,
      buttons: [{ label: 'Avbryt', value: false, cls: 'secondary' }, { label: 'Kåre og lås', value: true }],
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
      buttons: [{ label: 'Avbryt', value: null, cls: 'secondary' }, { label: 'Lås opp', cls: 'danger', value: (o) => $('#u-r', o).value.trim(), validate: (o) => !!$('#u-r', o).value.trim() }],
    });
    if (reason == null) return;
    if (!(await this.pin('Bekreft med PIN'))) return;
    await this.save(EventType.RESULT_UNLOCKED, { reason }, 'Resultatet er låst opp');
    this.refresh(true);
  }

  // ------------------------------------------------------------ Hendelseslogg
  renderLog(body, full) {
    const v = this.view.log;
    if (full || !$('#l-table', body)) {
      body.innerHTML = `<div class="toolbar"><input type="search" id="l-q" placeholder="Søk i loggen (type, navn, tekst)" value="${esc(v.q)}"><span class="muted" id="l-count"></span></div>
        <div class="table-wrap"><table class="grid" id="l-table"><thead><tr><th>Nr</th><th>Tidspunkt</th><th>Type</th><th>Deltaker</th><th>Beskrivelse</th></tr></thead><tbody></tbody></table></div><div class="more" id="l-more"></div>`;
      $('#l-q', body).addEventListener('input', debounce((e) => { v.q = e.target.value; v.limit = PAGE; this.fillLog(body); }, 150));
    }
    this.fillLog(body);
  }

  async fillLog(body) {
    const v = this.view.log;
    const events = (await this.store.allEvents()).reverse();
    const q = v.q.trim().toLowerCase();
    const who = (ev) => { const p = this.state.participants.get(ev.data?.participantId); return p ? `${p.nr}. ${fullName(p)}` : ''; };
    const rows = events.map((ev) => ({ ev, who: who(ev), text: `${EVENT_LABELS[ev.type] ?? ev.type}: ${describeEvent(ev, formatCs)}` }))
      .filter((r) => !q || `${r.ev.type}\u0000${r.text}\u0000${r.who}`.toLowerCase().includes(q));
    if (!$('#l-table', body)) return;
    $('#l-count', body).textContent = `${rows.length} hendelser`;
    $('#l-table tbody', body).innerHTML = rows.slice(0, v.limit).map(({ ev, who: w, text }) => `<tr><td>${ev.seq}</td><td class="small">${formatDateTime(ev.ts)}</td>
      <td><span class="tag">${esc(EVENT_LABELS[ev.type] ?? ev.type)}</span></td><td>${esc(w)}</td><td>${esc(text)}</td></tr>`).join('');
    this.moreButton($('#l-more', body), rows.length, v, () => this.fillLog(body));
  }

  // ------------------------------------------------------------ Innstillinger og backup
  async renderSettings(body) {
    const s = this.state.settings;
    const last = this.backup.last;
    let persisted = null;
    let estimate = null;
    try { persisted = await navigator.storage?.persisted?.(); estimate = await navigator.storage?.estimate?.(); } catch { /* ikke støttet */ }
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    body.innerHTML = `<div class="panel"><h3>Tidtaking</h3>
        <div class="radio-row">
          <label><input type="radio" name="timer" value="on" ${s.timerEnabled ? 'checked' : ''}> <span><strong>Stoppeklokke i appen</strong><br><span class="small muted">Deltakeren registrerer seg og trykker START / STOPP</span></span></label>
          <label><input type="radio" name="timer" value="off" ${!s.timerEnabled ? 'checked' : ''}> <span><strong>Ekstern stoppeklokke</strong><br><span class="small muted">Deltakeren registrerer seg, operatøren taster tiden</span></span></label>
        </div><p class="small muted">Kan endres når som helst, også midt i konkurransen. Endringen logges.</p></div>
      <div class="panel"><h3>Konkurranse</h3>
        <div class="toolbar"><input type="text" id="c-name" value="${esc(s.name)}" style="flex:1 1 320px" maxlength="80"><button class="btn small" id="c-rename">Lagre navn</button></div>
        <div class="btn-row" style="justify-content:flex-start"><button class="btn secondary small" id="c-pin">Endre PIN …</button><button class="btn secondary small" id="c-switch">Bytt konkurranse …</button></div></div>
      <div class="panel"><h3>Excel-backup</h3>
        <p>Automatisk backup lastes ned til <strong>Nedlastinger</strong> hver time (bare når noe er endret), etter hver 10. registrering og ved kåring.</p>
        <p>Siste backup: <strong>${last ? `${esc(last.filename)} – ${formatDateTime(last.at)} (${esc(last.reason ?? '')})` : 'ingen ennå'}</strong></p>
        <button class="btn" id="s-export">Eksporter Excel nå</button></div>
      <div class="panel"><h3>Importer / slå sammen</h3>
        <p>Henter inn hendelser fra en backup av <strong>denne</strong> konkurransen (f.eks. fra et annet nettbrett). Det som allerede finnes, hoppes over.</p>
        <input type="file" id="s-file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
        <button class="btn secondary" id="s-import">Velg fil og importer …</button></div>
      <div class="panel"><h3>Status</h3>
        <div class="table-wrap" style="max-width:780px"><table class="grid"><tbody>
          <tr><td>Vedvarende lagring</td><td>${persisted ? '<span class="tag green">Ja</span>' : '<span class="tag red">Nei</span> – installer appen og start på nytt'}</td></tr>
          <tr><td>Lagringsbruk (hele enheten)</td><td>${estimate ? `${mb(estimate.usage ?? 0)} MB av ${mb(estimate.quota ?? 0)} MB` : 'ukjent'}</td></tr>
          <tr><td>Skjerm holdes våken</td><td>${isAwake() ? '<span class="tag green">Aktiv</span>' : '<span class="tag red">Ikke aktiv</span>'}</td></tr>
          <tr><td>Offline-klar</td><td>${navigator.serviceWorker?.controller ? '<span class="tag green">Ja</span>' : '<span class="tag red">Nei</span> – last siden på nytt én gang med nett'}</td></tr>
          <tr><td>Hendelser i loggen</td><td>${this.state.eventCount}</td></tr>
          <tr><td>Enhet</td><td class="mono">${esc(this.store.device)}</td></tr>
          ${this.state.warnings.length ? `<tr><td>Advarsler</td><td>${this.state.warnings.slice(-10).map((w) => esc(w.message)).join('<br>')}</td></tr>` : ''}
        </tbody></table></div></div>
      <div class="panel danger-zone"><h3>Slett konkurransen</h3>
        <p>Sletter <strong>alle</strong> deltakere, tider og logg for «${esc(s.name)}» fra denne enheten. En siste Excel-backup lastes ned først. Kan ikke angres – men backupen kan importeres igjen.</p>
        <button class="btn danger" id="c-delete">Slett konkurransen …</button></div>`;
    $$('input[name=timer]', body).forEach((i) => i.addEventListener('change', async () => {
      const on = i.value === 'on';
      await this.save(EventType.SETTINGS_CHANGED, { timerEnabled: on }, on ? 'Stoppeklokke i appen er slått PÅ' : 'Ekstern stoppeklokke – tidtaking i appen er AV');
      this.refresh();
    }));
    $('#c-rename', body).addEventListener('click', () => this.rename($('#c-name', body).value));
    $('#c-pin', body).addEventListener('click', () => this.changePin());
    $('#c-switch', body).addEventListener('click', () => { this.close(); this.onSwitch?.(); });
    $('#s-export', body).addEventListener('click', () => this.exportNow());
    $('#s-import', body).addEventListener('click', () => $('#s-file', body).click());
    $('#s-file', body).addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) this.importFile(f); });
    $('#c-delete', body).addEventListener('click', () => this.deleteCompetition());
  }

  async rename(raw) {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!name) return toast('Navnet kan ikke være tomt', 'err');
    if (name === this.state.settings.name) return toast('Ingen endring', 'info');
    const ev = await this.save(EventType.SETTINGS_CHANGED, { name }, 'Navnet er endret');
    if (ev) { await this.registry.update(this.competitionId, { name }); this.onRenamed?.(name); this.refresh(true); }
  }

  async changePin() {
    if (!(await this.pin('Tast nåværende PIN'))) return;
    const rec = await chooseNewPin('Velg ny PIN (4 sifre)');
    if (!rec) return;
    try {
      await this.registry.update(this.competitionId, { pin: rec });
      await this.store.record(EventType.PIN_CHANGED, {});
      toast('✓ Ny PIN er lagret', 'ok');
    } catch (e) {
      toast(`Kunne ikke lagre PIN: ${e?.message ?? e}`, 'err', 6000);
    }
  }

  async deleteCompetition() {
    const name = this.state.settings.name;
    const typed = await modal({
      kind: 'danger', title: `Slette «${name}»?`,
      html: `<p>Alle ${this.state.participants.size} deltakere og ${computeStats(this.state).attemptCount} tider slettes fra denne enheten.</p>
        <p>En siste Excel-backup lastes ned først. Skriv <strong>SLETT</strong> for å bekrefte.</p>
        <div class="field"><input id="del-c" type="text" autocomplete="off" autocapitalize="characters"></div>`,
      buttons: [{ label: 'Avbryt', value: null, cls: 'secondary' }, { label: 'Gå videre', cls: 'danger-solid', value: (o) => $('#del-c', o).value.trim().toUpperCase(),
        validate: (o) => $('#del-c', o).value.trim().toUpperCase() === 'SLETT' }],
      onMount: (o) => setTimeout(() => $('#del-c', o).focus(), 50),
    });
    if (typed !== 'SLETT') return;
    if (!(await this.pin(`Tast PIN for å slette «${name}»`))) return;
    try {
      await this.backup.run('før sletting av konkurransen');
    } catch (e) {
      const go = await modal({ kind: 'danger', title: 'Backup feilet', html: `<p>${esc(e?.message ?? e)}</p><p>Slette likevel, uten backup?</p>`,
        buttons: [{ label: 'Avbryt', value: false, cls: 'secondary' }, { label: 'Slett uten backup', value: true, cls: 'danger-solid' }] });
      if (!go) return;
    }
    this.close();
    await this.onDeleted?.();
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
    const info = competitionInfo(parsed.events);
    const other = info && this.state.competition && info.id !== this.state.competition.id;
    const { fresh, skipped } = eventsToImport(await this.store.db.allIds(), parsed.events.filter((e) => e.type !== EventType.COMPETITION_CREATED || !this.state.competition));
    const regs = fresh.filter((e) => e.type === EventType.PARTICIPANT_REGISTERED).length;
    const times = fresh.filter((e) => e.type === EventType.ATTEMPT_RECORDED).length;
    const ok = await modal({
      title: 'Importere data?', kind: other ? 'warn' : '',
      html: `<p>Fil: <strong>${esc(file.name)}</strong>${info ? ` – konkurranse «${esc(info.name)}»` : ''}</p>
        ${other ? '<p style="color:var(--warn)"><strong>Filen er fra en annen konkurranse.</strong> Vil du heller gjenopprette den som egen konkurranse, gjør det fra konkurranselisten.</p>' : ''}
        <ul><li>${fresh.length} nye hendelser (${regs} registreringer, ${times} tider)</li>
        <li>${skipped} hendelser finnes allerede og hoppes over</li>
        ${parsed.errors.length ? `<li style="color:var(--error)">${parsed.errors.length} rader kunne ikke leses: ${esc(parsed.errors.slice(0, 5).join('; '))}</li>` : ''}</ul>
        <p>Eksisterende data endres ikke – nye hendelser legges til.</p>`,
      buttons: [{ label: 'Avbryt', value: false, cls: 'secondary' }, { label: `Importer ${fresh.length} hendelser`, value: true }],
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
      modal({ title: 'IMPORT FEILET', kind: 'danger', html: `<p>Ingen data ble importert. ${esc(e?.message ?? e)}</p>` });
    }
  }
}

// Tidsdialog: returnerer { cs, text } eller null.
function timeDialog(title, initial, textLabel, textRequired, intro = '') {
  return modal({
    title,
    html: `${intro}<div class="field"><label for="td-t">Tid (f.eks. 12,34 eller 1:05,20)</label><input id="td-t" type="text" inputmode="decimal" autocomplete="off" value="${esc(initial)}"><div class="err" id="td-e"></div></div>
      <div class="field"><label for="td-x">${esc(textLabel)}</label><input id="td-x" type="text" autocomplete="off"><div class="err" id="td-xe"></div></div>`,
    buttons: [{ label: 'Avbryt', value: null, cls: 'secondary' }, { label: 'Lagre', value: (o) => ({ cs: parseTimeToCs($('#td-t', o).value), text: $('#td-x', o).value.trim() }),
      validate: (o) => {
        const okT = parseTimeToCs($('#td-t', o).value) != null;
        const okX = !textRequired || !!$('#td-x', o).value.trim();
        $('#td-e', o).textContent = okT ? '' : 'Ugyldig tid';
        $('#td-xe', o).textContent = okX ? '' : 'Skriv en årsak';
        return okT && okX;
      } }],
    onMount: (o) => setTimeout(() => { const i = $('#td-t', o); i.focus(); i.select(); }, 50),
  });
}

function rowCls(a) {
  return a.deleted ? 'deleted' : a.valid ? '' : 'invalid';
}

function statusTag(a) {
  if (a.deleted) return '<span class="tag">Slettet</span>';
  return a.valid ? '<span class="tag green">Gyldig</span>' : '<span class="tag red">Ugyldig</span>';
}

function notes(a) {
  return [a.note, a.edits.length ? `Endret: ${a.edits.map((e) => `${formatCs(e.from)} → ${formatCs(e.to)}${e.reason ? ` (${e.reason})` : ''}`).join('; ')}` : '',
    a.deleted ? `Slettet: ${a.deleteReason}` : (!a.valid ? `Ugyldig: ${a.validityReason}` : '')].filter(Boolean).join(' · ');
}

function actionButtons(a) {
  if (a.deleted) return '';
  const id = esc(a.id);
  return `<button class="btn tiny secondary" data-act="edit" data-attempt="${id}">Endre</button>`
    + `<button class="btn tiny secondary" data-act="validity" data-attempt="${id}">${a.valid ? 'Ugyldig' : 'Gyldig'}</button>`
    + `<button class="btn tiny danger" data-act="delete" data-attempt="${id}">Slett</button>`;
}

function attemptRow(a, n, isBest) {
  return `<tr class="${rowCls(a)}"><td>${n}</td><td class="num t"><strong>${formatCs(a.cs)}</strong>${isBest ? ' <span class="tag green">Teller</span>' : ''}</td>
    <td>${METHOD_LABEL[a.method] ?? esc(a.method)}</td><td class="small">${formatDateTime(a.recordedAt)}</td><td>${statusTag(a)}</td>
    <td class="small">${esc(notes(a))}</td><td class="actions">${actionButtons(a)}</td></tr>`;
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
