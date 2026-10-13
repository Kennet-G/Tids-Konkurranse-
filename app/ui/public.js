// Publikumsskjermen: instruksjoner, skanning, registrering og tidtaking.
// VIKTIG: Denne skjermen viser ALDRI tider, rangering eller ledere.
import { EventType, findEmailDuplicates, fullName, makeEvent, uuid } from '../core/events.js';
import { validateRegistration, normalizeContact, isValidParticipantId } from '../core/validation.js';
import { elapsedCs, parseTimeToCs } from '../core/time.js';
import { $, esc, modal, toast, vibrate, debounce } from './dom.js';
import { QrScanner } from '../services/scanner.js';

export const CONSENT_TEXT = 'Jeg samtykker til at TROX Auranor lagrer navn, firma og kontaktinformasjon i forbindelse med konkurransen, '
  + 'og at TROX Auranor kan kontakte meg om resultatet og om produkter og tjenester. Samtykket kan trekkes tilbake ved å kontakte TROX Auranor.';

const now = () => performance.timeOrigin + performance.now();

export class PublicUI {
  constructor(store, host, { requirePin }) {
    this.store = store;
    this.host = host;
    this.requirePin = requirePin;
    this.scanner = null;
    this.busy = false;
    this.adminOpen = false;
  }

  start() {
    const s = this.store.session;
    // Gjenoppretter skjerm etter sideoppdatering/krasj.
    if (s.pending) return this.showTiming({ restoredPending: true });
    if (s.screen === 'timing' && s.participantId && this.store.state.participants.has(s.participantId)) return this.showTiming({ restored: !!s.attempt });
    if (s.screen === 'register' && s.participantId) return this.showRegister(s.participantId, { restored: true });
    return this.showHome();
  }

  setAdminOpen(open) {
    this.adminOpen = open;
    if (open) this.scanner?.pause();
    else if (this.store.session.screen === 'home') this.scanner?.resume();
  }

  render(html) {
    this.host.innerHTML = html;
  }

  // ------------------------------------------------------------ Start/skann
  async showHome() {
    await this.store.setSession({ screen: 'home', participantId: null, draft: null, attempt: null, justRegistered: false });
    this.render(`<section class="screen home">
      <div class="info">
        <h1>Hvor rask er du?</h1>
        <p class="lead">Bli med i TROX sin tidskonkurranse på stand <strong class="accent">D02-05</strong> og vinn premie!</p>
        <ol class="steps">
          <li>Hold QR-koden på messemerket ditt foran kameraet</li>
          <li>Første gang: fyll inn navn, firma og e-post</li>
          <li>Trykk START – og løs oppgaven så raskt du kan!</li>
        </ol>
        <p class="muted" style="margin-top:22px">Vinneren kontaktes etter messen.</p>
      </div>
      <div class="scan">
        <div class="camera-box"><div id="qr-reader"></div><div class="cam-msg" id="cam-msg">Starter kamera …</div></div>
        <button class="btn secondary" id="manual-id">Tast inn ID manuelt</button>
      </div>
    </section>`);
    $('#manual-id').addEventListener('click', () => this.manualId());
    await this.startScanner();
  }

  async startScanner() {
    if (this.scanner) await this.scanner.stop();
    this.scanner = new QrScanner('qr-reader', (text, method) => this.onId(text, method), (status, err) => {
      const msg = $('#cam-msg');
      if (!msg) return;
      if (status === 'ok') msg.hidden = true;
      else {
        msg.hidden = false;
        msg.innerHTML = `Kameraet kunne ikke startes.<br><small>${esc(err?.message ?? err ?? '')}</small><br><br>`
          + '<button class="btn small" id="cam-retry">Prøv igjen</button>';
        $('#cam-retry')?.addEventListener('click', () => this.startScanner());
      }
    });
    if (this.adminOpen) this.scanner.pause();
    await this.scanner.start();
  }

  async stopScanner() {
    const s = this.scanner;
    this.scanner = null;
    if (s) await s.stop();
  }

  async manualId() {
    this.scanner?.pause();
    const id = await modal({
      title: 'Tast inn deltaker-ID',
      html: `<div class="field"><label for="mid">ID fra messemerket</label>
        <input id="mid" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text"></div>`,
      buttons: [
        { label: 'Avbryt', value: null, cls: 'secondary' },
        { label: 'Fortsett', cls: 'primary', value: (o) => $('#mid', o).value.trim(), validate: (o) => isValidParticipantId($('#mid', o).value.trim()) },
      ],
      onMount: (o) => setTimeout(() => $('#mid', o).focus(), 50),
    });
    this.scanner?.resume();
    if (id) this.onId(id, 'manual');
  }

  async onId(rawId, method) {
    if (this.busy || this.adminOpen || this.store.session.screen !== 'home') return;
    if (!isValidParticipantId(rawId)) return;
    this.busy = true;
    try {
      const known = this.store.state.participants.has(rawId);
      try {
        await this.store.record(EventType.SCAN, { participantId: rawId, known, method });
      } catch (e) {
        vibrate([200, 100, 200]);
        toast('LAGRING FEILET – skanningen ble ikke lagret. Prøv igjen.', 'err', 6000);
        return;
      }
      vibrate(60);
      await this.stopScanner();
      if (known) this.showConfirm(rawId);
      else this.showRegister(rawId, { method });
    } finally {
      this.busy = false;
    }
  }

  // ------------------------------------------------------------ Kjent deltaker
  async showConfirm(id) {
    const p = this.store.state.participants.get(id);
    await this.store.setSession({ screen: 'confirm', participantId: id });
    this.render(`<section class="screen center">
      <p class="lead muted">Velkommen tilbake!</p>
      <h1 style="font-size:64px">${esc(fullName(p))}</h1>
      <p class="lead">${esc(p.company)}</p>
      <p class="lead">Er dette deg?</p>
      <div class="btn-row" style="margin-top:20px">
        <button class="btn secondary" id="no">Nei, avbryt</button>
        <button class="btn primary" id="yes" style="min-width:320px">Ja, det er meg</button>
      </div>
    </section>`);
    $('#no').addEventListener('click', () => this.showHome());
    $('#yes').addEventListener('click', () => this.showTiming());
  }

  // ------------------------------------------------------------ Registrering
  async showRegister(id, { method, restored = false } = {}) {
    const s = this.store.session;
    const draft = (restored && s.draft) || { firstName: '', lastName: '', company: '', email: '', phone: '', consent: false };
    await this.store.setSession({ screen: 'register', participantId: id, draft, regMethod: method ?? s.regMethod ?? 'qr' });
    this.render(`<section class="screen form-screen">
      <div class="form-head"><h2>Registrer deg</h2><span class="muted">Kun første gang</span><span class="spacer" style="flex:1"></span><span class="id-chip" title="Deltaker-ID">ID: ${esc(id)}</span></div>
      ${restored ? '<div class="banner warn" style="font-size:18px;padding:8px 16px">Skjemaet ble gjenopprettet etter omstart.</div>' : ''}
      <form id="reg" novalidate autocomplete="off">
        <div class="form-grid">
          ${field('firstName', 'Fornavn', 'text', 'given-name', 'words')}
          ${field('lastName', 'Etternavn', 'text', 'family-name', 'words')}
          ${field('company', 'Firma', 'text', 'organization', 'words')}
          ${field('email', 'E-post', 'email', 'email', 'none', 'email')}
          ${field('phone', 'Telefon <span class="opt">(valgfritt)</span>', 'tel', 'tel', 'none', 'tel')}
          <label class="consent" for="consent">
            <input type="checkbox" id="consent" name="consent">
            <span><strong>Samtykke (påkrevd):</strong> ${esc(CONSENT_TEXT)}</span>
          </label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn secondary" id="cancel">Avbryt</button>
          <button type="submit" class="btn primary" id="save" disabled style="min-width:300px">Lagre</button>
        </div>
      </form>
    </section>`);

    const form = $('#reg');
    for (const [k, v] of Object.entries(draft)) {
      const el = form.elements[k];
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = v === true; else el.value = v ?? '';
    }
    const touched = new Set(restored ? Object.keys(draft).filter((k) => draft[k]) : []);
    const read = () => ({
      firstName: form.elements.firstName.value, lastName: form.elements.lastName.value, company: form.elements.company.value,
      email: form.elements.email.value, phone: form.elements.phone.value, consent: form.elements.consent.checked,
    });
    const saveDraft = debounce(() => this.store.setSession({ draft: read() }), 250);
    const update = () => {
      const { valid, errors } = validateRegistration(read());
      $('#save').disabled = !valid;
      for (const name of ['firstName', 'lastName', 'company', 'email', 'phone']) {
        const wrap = form.elements[name].closest('.field');
        const show = touched.has(name) && errors[name];
        wrap.classList.toggle('invalid', !!show);
        $('.err', wrap).textContent = show ? errors[name] : '';
      }
    };
    form.addEventListener('input', (e) => { saveDraft(); if (e.target.name && e.target.value) touched.add(e.target.name); update(); });
    form.addEventListener('change', () => { saveDraft(); update(); });
    form.addEventListener('focusout', (e) => { if (e.target.name) { touched.add(e.target.name); update(); } });
    form.addEventListener('submit', (e) => { e.preventDefault(); this.saveRegistration(id, read()); });
    $('#cancel').addEventListener('click', async () => {
      const r = read();
      const hasData = ['firstName', 'lastName', 'company', 'email', 'phone'].some((k) => r[k].trim());
      if (hasData) {
        const ok = await modal({ title: 'Avbryte registreringen?', html: '<p>Det du har fylt inn blir ikke lagret.</p>',
          buttons: [{ label: 'Fortsett utfylling', value: false, cls: 'secondary' }, { label: 'Avbryt registrering', value: true, cls: 'danger' }] });
        if (!ok) return;
      }
      this.showHome();
    });
    update();
    if (!restored) setTimeout(() => form.elements.firstName.focus(), 100);
  }

  async saveRegistration(id, raw) {
    if (this.busy) return;
    const { valid } = validateRegistration(raw);
    if (!valid) return;
    if (this.store.state.participants.has(id)) {
      // Kan skje hvis samme ID ble registrert i en annen fane/økt.
      toast('Denne ID-en er allerede registrert.', 'info');
      return this.showConfirm(id);
    }
    const contact = normalizeContact(raw);
    const dups = findEmailDuplicates(this.store.state, contact.email, id);
    if (dups.length) {
      const go = await modal({
        kind: 'warn',
        title: 'Mulig dobbeltregistrering',
        html: `<p class="lead" style="font-size:22px">E-postadressen <strong>${esc(contact.email)}</strong> er allerede registrert på et annet messemerke:</p>
          <ul style="font-size:20px">${dups.map((p) => `<li><strong>${esc(fullName(p))}</strong>, ${esc(p.company)} <span class="id-chip">ID: ${esc(p.id)}</span></li>`).join('')}</ul>
          <p style="font-size:20px">Vil du fortsette og registrere dette merket også?</p>`,
        buttons: [{ label: 'Gå tilbake og rett', value: false, cls: 'secondary' }, { label: 'Fortsett likevel', value: true, cls: 'primary' }],
      });
      if (!go) return;
    }
    this.busy = true;
    $('#save').disabled = true;
    try {
      await this.store.record(EventType.PARTICIPANT_REGISTERED, {
        participantId: id, ...contact, consent: true, consentText: CONSENT_TEXT,
        method: this.store.session.regMethod ?? 'qr', duplicateOf: dups.map((p) => p.id),
      });
    } catch (e) {
      console.error(e);
      vibrate([300, 100, 300]);
      await modal({ title: 'LAGRING FEILET', kind: 'warn', html: `<p class="lead" style="color:var(--error)">Registreringen ble <strong>ikke</strong> lagret. Skjemaet er beholdt – prøv å trykke Lagre igjen.</p><p class="small muted">${esc(e?.message ?? e)}</p>` });
      $('#save') && ($('#save').disabled = false);
      this.busy = false;
      return;
    }
    this.busy = false;
    vibrate(200);
    await this.store.setSession({ draft: null });
    this.showTiming({ justRegistered: true });
  }

  // ------------------------------------------------------------ Tidtaking
  async showTiming({ justRegistered = false, restored = false, restoredPending = false } = {}) {
    const s = this.store.session;
    const id = s.participantId;
    const p = this.store.state.participants.get(id);
    await this.store.setSession({ screen: 'timing', justRegistered: justRegistered || (restored && s.justRegistered) });
    const first = esc(p?.firstName ?? '');
    this.render(`<section class="screen timing" id="timing">
      ${this.store.session.justRegistered ? `<div class="banner ok">Du er registrert, ${first}!</div>` : ''}
      ${restored && s.attempt ? '<div class="banner warn">Pågående forsøk ble gjenopprettet etter omstart</div>' : ''}
      <div class="who">${esc(fullName(p))}</div>
      <div class="company">${esc(p?.company ?? '')}</div>
      <div id="timer-area"></div>
      <div class="btn-row" id="timing-actions"></div>
    </section>`);
    // Tid som ble målt men ikke bekreftet lagret før omstart: lagres nå (idempotent på hendelses-ID).
    if (restoredPending && s.pending) return this.savePending();
    if (s.attempt) this.renderRunning(); else this.renderReady();
  }

  renderReady() {
    $('#timer-area').innerHTML = '<button class="big-btn start" id="start">START</button>';
    $('#timing-actions').innerHTML = `<button class="btn secondary" id="back">Tilbake til start</button>
      <button class="btn ghost" id="manual-time">Tast inn tid manuelt</button>`;
    $('#start').addEventListener('pointerdown', (e) => this.onStart(e), { once: true });
    $('#back').addEventListener('click', () => this.showHome());
    $('#manual-time').addEventListener('click', () => this.manualTime());
  }

  async onStart(e) {
    e.preventDefault();
    // event.timeStamp er tidspunktet for selve trykket (høy oppløsning), uavhengig av forsinkelser i koden.
    const startEpoch = performance.timeOrigin + (e.timeStamp || performance.now());
    const attempt = { attemptId: uuid(), participantId: this.store.session.participantId, startEpoch, startedAt: new Date(startEpoch).toISOString() };
    vibrate(80);
    this.store.setSession({ attempt, justRegistered: false });
    this.renderRunning();
    this.store.record(EventType.ATTEMPT_STARTED, { attemptId: attempt.attemptId, participantId: attempt.participantId, startedAt: attempt.startedAt })
      .catch((err) => { console.error(err); toast('Advarsel: startmerket kunne ikke logges. Tiden måles likevel.', 'err', 5000); });
  }

  renderRunning() {
    const banner = $('.banner.ok');
    if (banner) banner.remove();
    $('#timer-area').innerHTML = `<div class="running-indicator"><span class="pulse"></span>Tiden går …</div>
      <button class="big-btn stop" id="stop" style="margin-top:18px">STOPP</button>`;
    $('#timing-actions').innerHTML = '<button class="btn ghost" id="abort">Avbryt forsøket</button>';
    const stop = $('#stop');
    const armedAt = now() + 400; // hindrer at et dobbelttrykk på START stopper klokka umiddelbart
    let stopped = false;
    stop.addEventListener('pointerdown', (e) => {
      if (stopped || now() < armedAt) return;
      stopped = true;
      this.onStop(e);
    });
    $('#abort').addEventListener('click', () => this.abortAttempt());
  }

  async onStop(e) {
    e.preventDefault();
    const stopEpoch = performance.timeOrigin + (e.timeStamp || performance.now());
    const a = this.store.session.attempt;
    if (!a) return;
    $('#stop').disabled = true;
    let cs;
    try {
      cs = elapsedCs(a.startEpoch, stopEpoch);
    } catch {
      return this.showSaveError(new Error('Ugyldig måling (klokken ble endret). Forsøket må registreres manuelt.'));
    }
    const ev = makeEvent(EventType.ATTEMPT_RECORDED, {
      attemptId: a.attemptId, participantId: a.participantId, cs, method: 'timer',
      startedAt: a.startedAt, stoppedAt: new Date(stopEpoch).toISOString(), rawMs: Math.round((stopEpoch - a.startEpoch) * 1000) / 1000,
    }, { device: this.store.device });
    // Hendelsen lagres i økten FØR den skrives, slik at den kan lagres på nytt hvis appen krasjer nå.
    await this.store.setSession({ attempt: null, pending: ev });
    await this.savePending();
  }

  async savePending() {
    const ev = this.store.session.pending;
    if (!ev) return;
    try {
      if (await this.store.hasEvent(ev.id)) {
        await this.store.rebuild(); // allerede lagret (f.eks. krasj rett etter lagring)
      } else {
        await this.store.recordPrepared(ev);
      }
      await this.store.setSession({ pending: null });
      this.showSaved();
    } catch (e) {
      console.error(e);
      this.showSaveError(e);
    }
  }

  showSaved() {
    const p = this.store.state.participants.get(this.store.session.participantId);
    vibrate([120, 60, 120]);
    // Ingen tid vises på publikumsskjermen.
    $('#timing').innerHTML = `<div class="result-ok">
      <div class="icon">✓</div>
      <h1>Tiden er registrert!</h1>
      <p class="lead" style="color:inherit">Takk for at du deltok, ${esc(p?.firstName ?? '')}! Vinneren kontaktes etter messen.</p>
      <div class="btn-row"><button class="btn" id="again">Nytt forsøk</button><button class="btn primary" id="done" style="min-width:280px">Ferdig</button></div>
    </div>`;
    $('#again').addEventListener('click', () => this.showTiming());
    $('#done').addEventListener('click', () => this.showHome());
  }

  showSaveError(err) {
    vibrate([400, 150, 400, 150, 400]);
    const host = $('#timing') ?? this.host;
    host.innerHTML = `<div class="result-err">
      <div class="icon">!</div>
      <h1>Tiden er IKKE lagret</h1>
      <p class="lead" style="color:inherit">${esc(err?.message ?? err ?? 'Ukjent feil')}</p>
      <div class="btn-row">
        <button class="btn" id="discard">Forkast og gå til start</button>
        ${this.store.session.pending ? '<button class="btn primary" id="retry">Prøv å lagre igjen</button>' : '<button class="btn primary" id="manual">Registrer tid manuelt</button>'}
      </div></div>`;
    $('#retry')?.addEventListener('click', () => this.savePending());
    $('#manual')?.addEventListener('click', () => this.manualTime());
    $('#discard').addEventListener('click', async () => {
      const ok = await modal({ title: 'Forkaste forsøket?', html: '<p>Tiden blir ikke lagret. Bruk «Tast inn tid manuelt» hvis tiden er kjent.</p>',
        buttons: [{ label: 'Nei', value: false }, { label: 'Ja, forkast', value: true, cls: 'danger' }] });
      if (!ok) return;
      const pending = this.store.session.pending;
      if (pending) {
        this.store.record(EventType.ATTEMPT_ABORTED, { attemptId: pending.data.attemptId, participantId: pending.data.participantId, reason: 'Lagring feilet – forkastet' }).catch(() => {});
      }
      await this.store.setSession({ pending: null, attempt: null });
      this.showHome();
    });
  }

  async abortAttempt() {
    const ok = await modal({ title: 'Avbryte forsøket?', html: '<p class="lead">Klokken stoppes og forsøket lagres ikke som tid.</p>',
      buttons: [{ label: 'Fortsett forsøket', value: false }, { label: 'Avbryt forsøket', value: true, cls: 'danger' }] });
    if (!ok) return;
    const a = this.store.session.attempt;
    await this.store.setSession({ attempt: null });
    if (a) {
      try { await this.store.record(EventType.ATTEMPT_ABORTED, { attemptId: a.attemptId, participantId: a.participantId, reason: 'Avbrutt av operatør' }); } catch { /* logges ikke */ }
    }
    this.showTiming();
  }

  // Manuell tid krever PIN (tiden vises ikke for publikum).
  async manualTime() {
    const ok = await this.requirePin('Tast PIN for å legge inn tid manuelt');
    if (!ok) return;
    const res = await modal({
      title: 'Tast inn tid manuelt',
      html: `<div class="field"><label for="mt">Tid (f.eks. 12,34 eller 1:05,20)</label>
        <input id="mt" type="text" inputmode="decimal" autocomplete="off"><div class="err" id="mt-err"></div></div>
        <div class="field"><label for="mn">Merknad <span class="opt">(valgfritt)</span></label><input id="mn" type="text" autocomplete="off"></div>`,
      buttons: [
        { label: 'Avbryt', value: null },
        { label: 'Lagre tid', cls: 'primary', value: (o) => ({ cs: parseTimeToCs($('#mt', o).value), note: $('#mn', o).value.trim() }),
          validate: (o) => { const okv = parseTimeToCs($('#mt', o).value) != null; $('#mt-err', o).textContent = okv ? '' : 'Ugyldig tid'; return okv; } },
      ],
      onMount: (o) => setTimeout(() => $('#mt', o).focus(), 50),
    });
    if (!res) return;
    const s = this.store.session;
    if (s.attempt) {
      this.store.record(EventType.ATTEMPT_ABORTED, { attemptId: s.attempt.attemptId, participantId: s.participantId, reason: 'Erstattet av manuell tid' }).catch(() => {});
    }
    const ev = makeEvent(EventType.ATTEMPT_RECORDED, { attemptId: uuid(), participantId: s.participantId, cs: res.cs, method: 'manual', note: res.note }, { device: this.store.device });
    await this.store.setSession({ attempt: null, pending: ev });
    if (!$('#timing')) await this.showTiming();
    await this.savePending();
  }
}

function field(name, label, type, autocomplete, autocap, inputmode) {
  return `<div class="field"><label for="${name}">${label}</label>
    <input id="${name}" name="${name}" type="${type}" autocomplete="off" data-ac="${autocomplete}" autocapitalize="${autocap}" spellcheck="false"
      ${inputmode ? `inputmode="${inputmode}"` : ''} enterkeyhint="next"><div class="err"></div></div>`;
}

