// Publikumsskjermen for én konkurranse: instruksjoner, registrering og ett forsøk per deltaker.
// VIKTIG: Denne skjermen viser ALDRI tider, rangering eller ledere (unntak: tiden operatøren selv taster inn).
import { EventType, findExistingParticipant, hasHadAttempt, fullName, makeEvent, uuid } from '../core/events.js';
import { validateRegistration, normalizeContact } from '../core/validation.js';
import { elapsedCs, parseTimeToCs } from '../core/time.js';
import { $, esc, modal, toast, vibrate, debounce } from './dom.js';

export const CONSENT_TEXT = 'Jeg samtykker til at TROX Auranor lagrer navn, firma og kontaktinformasjon i forbindelse med konkurransen, '
  + 'og at TROX Auranor kan kontakte meg om resultatet og om produkter og tjenester. Samtykket kan trekkes tilbake ved å kontakte TROX Auranor.';

const AUTO_HOME_MS = 20 * 1000;
const now = () => performance.timeOrigin + performance.now();

export class PublicUI {
  constructor(store, host) {
    this.store = store;
    this.host = host;
    this.busy = false;
    this.homeTimer = null;
    this.unsub = store.onChange((ev) => {
      // Endret innstilling (f.eks. tidtaking av/på) oppdaterer startskjermen.
      if (ev?.type === EventType.SETTINGS_CHANGED && this.store.session.screen === 'home') this.showHome();
    });
  }

  destroy() {
    clearTimeout(this.homeTimer);
    this.unsub?.();
  }

  get settings() { return this.store.state.settings; }

  start() {
    const s = this.store.session;
    const p = s.participantId && this.store.state.participants.get(s.participantId);
    // Gjenoppretter skjerm etter sideoppdatering/krasj.
    if (p && (s.pending || s.attempt)) return this.showAttempt({ restored: true });
    if (s.screen === 'attempt' && p && !hasHadAttempt(this.store.state, p.id)) return this.showAttempt({ restored: true });
    if (s.screen === 'register' && s.draft) return this.showRegister({ restored: true });
    return this.showHome();
  }

  render(html) {
    clearTimeout(this.homeTimer);
    this.host.innerHTML = html;
  }

  // ------------------------------------------------------------ Start
  async showHome() {
    await this.store.setSession({ screen: 'home', participantId: null, draft: null, attempt: null, justRegistered: false });
    const timer = this.settings.timerEnabled;
    this.render(`<section class="screen home">
      <div class="info">
        <h1>Hvor rask er du?</h1>
        <p class="lead"><strong class="accent">${esc(this.settings.name)}</strong></p>
        <ol class="steps">
          <li>Registrer deg med navn, firma og e-post</li>
          ${timer ? '<li>Trykk START – og løs oppgaven så raskt du kan</li><li>Trykk STOPP når du er ferdig</li>'
            : '<li>Løs oppgaven så raskt du kan – vi tar tiden</li><li>Tiden registreres på deg</li>'}
        </ol>
        <p class="muted" style="margin-top:20px">Én deltakelse per person. Vinneren kontaktes etter konkurransen.</p>
      </div>
      <div class="cta"><button class="btn" id="register">Registrer deg</button></div>
    </section>`);
    $('#register').addEventListener('click', () => this.showRegister());
  }

  // ------------------------------------------------------------ Registrering
  async showRegister({ restored = false } = {}) {
    const s = this.store.session;
    const draft = (restored && s.draft) || { firstName: '', lastName: '', company: '', email: '', phone: '', consent: false };
    await this.store.setSession({ screen: 'register', participantId: null, draft });
    this.render(`<section class="screen form-screen"><div class="form-wrap">
      <div class="form-head"><h2>Registrer deg</h2><span class="muted">Alle felt unntatt telefon må fylles ut</span></div>
      ${restored ? '<div class="banner warn" style="font-size:17px;padding:8px 16px;margin-bottom:6px">Skjemaet ble gjenopprettet etter omstart.</div>' : ''}
      <form id="reg" novalidate autocomplete="off">
        <div class="form-grid">
          ${field('firstName', 'Fornavn', 'text', 'words')}
          ${field('lastName', 'Etternavn', 'text', 'words')}
          ${field('company', 'Firma', 'text', 'words')}
          ${field('email', 'E-post', 'email', 'none', 'email')}
          ${field('phone', 'Telefon <span class="opt">(valgfritt)</span>', 'tel', 'none', 'tel')}
          <label class="consent" for="consent">
            <input type="checkbox" id="consent" name="consent">
            <span><strong>Samtykke (påkrevd):</strong> ${esc(CONSENT_TEXT)}</span>
          </label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn secondary" id="cancel">Avbryt</button>
          <button type="submit" class="btn" id="save" disabled style="min-width:300px">${this.settings.timerEnabled ? 'Lagre og gå til START' : 'Lagre'}</button>
        </div>
      </form></div>
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
    form.addEventListener('submit', (e) => { e.preventDefault(); this.saveRegistration(read()); });
    $('#cancel').addEventListener('click', async () => {
      const r = read();
      if (['firstName', 'lastName', 'company', 'email', 'phone'].some((k) => r[k].trim())) {
        const ok = await modal({ title: 'Avbryte registreringen?', html: '<p>Det du har fylt inn blir ikke lagret.</p>',
          buttons: [{ label: 'Fortsett utfylling', value: false, cls: 'secondary' }, { label: 'Avbryt registrering', value: true, cls: 'danger' }] });
        if (!ok) return;
      }
      this.showHome();
    });
    update();
    if (!restored) setTimeout(() => form.elements.firstName.focus(), 100);
  }

  async saveRegistration(raw) {
    if (this.busy) return;
    if (!validateRegistration(raw).valid) return;
    const contact = normalizeContact(raw);
    const existing = findExistingParticipant(this.store.state, contact);
    this.busy = true;
    try {
      if (existing) {
        if (hasHadAttempt(this.store.state, existing.id)) {
          // Ett forsøk per deltaker.
          await this.store.record(EventType.REREGISTRATION_BLOCKED, { participantId: existing.id, matchedOn: 'identity' }).catch((e) => console.error(e));
          await this.store.setSession({ draft: null });
          return this.showInfo(`Du har allerede hatt forsøket ditt, ${existing.firstName}!`,
            'Hver deltaker kan være med én gang. Takk for at du var med – vinneren kontaktes etter konkurransen.');
        }
        // Registrert før, men har ikke fått tid ennå: fortsett med samme registrering.
        await this.store.setSession({ draft: null, participantId: existing.id, justRegistered: false });
        toast(`Du er allerede registrert, ${existing.firstName} – fortsett til forsøket`, 'info', 4000);
        return this.showAttempt();
      }
      const participantId = uuid();
      await this.store.record(EventType.PARTICIPANT_REGISTERED, { participantId, ...contact, consent: true, consentText: CONSENT_TEXT });
      vibrate(200);
      await this.store.setSession({ draft: null, participantId, justRegistered: true });
      this.showAttempt();
    } catch (e) {
      console.error(e);
      vibrate([300, 100, 300]);
      await modal({ title: 'LAGRING FEILET', kind: 'danger', html: `<p class="lead" style="color:var(--error)">Registreringen ble <strong>ikke</strong> lagret. Skjemaet er beholdt – prøv å trykke Lagre igjen.</p><p class="small muted">${esc(e?.message ?? e)}</p>` });
    } finally {
      this.busy = false;
    }
  }

  showInfo(title, text) {
    vibrate([80, 60, 80]);
    this.render(`<section class="screen"><div class="result-info">
      <div class="icon">i</div><h1>${esc(title)}</h1><p class="lead" style="color:inherit;max-width:900px">${esc(text)}</p>
      <div class="btn-row"><button class="btn primary" id="done" style="min-width:280px">OK</button></div></div></section>`);
    $('#done').addEventListener('click', () => this.showHome());
    this.homeTimer = setTimeout(() => this.showHome(), AUTO_HOME_MS);
  }

  // ------------------------------------------------------------ Forsøket
  async showAttempt({ restored = false } = {}) {
    const s = this.store.session;
    const p = this.store.state.participants.get(s.participantId);
    if (!p) return this.showHome();
    await this.store.setSession({ screen: 'attempt' });
    this.render(`<section class="screen timing" id="timing">
      ${s.justRegistered ? `<div class="banner ok">Du er registrert, ${esc(p.firstName)}!</div>` : ''}
      ${restored && s.attempt ? '<div class="banner warn">Pågående forsøk ble gjenopprettet etter omstart</div>' : ''}
      <div class="who">${esc(fullName(p))}</div>
      <div class="company">${esc(p.company)}</div>
      <div id="timer-area"></div>
      <div class="btn-row" id="timing-actions"></div>
    </section>`);
    // Tid som ble målt men ikke bekreftet lagret før omstart: lagres nå (idempotent på hendelses-ID).
    if (s.pending) return this.savePending();
    if (s.attempt) return this.renderRunning();
    if (this.settings.timerEnabled) return this.renderReady();
    return this.renderTimeEntry();
  }

  // Tidtaking i appen er AV: operatøren taster tiden fra den eksterne stoppeklokka.
  renderTimeEntry() {
    $('#timer-area').innerHTML = `<form id="te" novalidate autocomplete="off" style="display:flex;flex-direction:column;align-items:center;gap:8px">
        <label for="tt" class="lead" style="color:var(--navy);font-weight:700">Tid fra stoppeklokka</label>
        <div class="field"><input id="tt" class="time-input" type="text" inputmode="decimal" placeholder="00,00" autocomplete="off" enterkeyhint="done"></div>
        <div id="tt-err" style="color:var(--error);min-height:22px"></div>
        <button type="submit" class="btn" id="tt-save" disabled style="min-width:320px">Lagre tid</button>
        <p class="muted" style="margin:0">Skriv f.eks. 12,34 eller 1:05,20</p>
      </form>`;
    $('#timing-actions').innerHTML = '<button class="btn secondary small" id="later">Avbryt – tiden legges inn senere</button>';
    const input = $('#tt');
    input.addEventListener('input', () => {
      const ok = parseTimeToCs(input.value) != null;
      $('#tt-save').disabled = !ok;
      $('#tt-err').textContent = input.value.trim() && !ok ? 'Ugyldig tid' : '';
    });
    $('#te').addEventListener('submit', async (e) => {
      e.preventDefault();
      const cs = parseTimeToCs(input.value);
      if (cs == null) return;
      $('#tt-save').disabled = true;
      const ev = makeEvent(EventType.ATTEMPT_RECORDED, { attemptId: uuid(), participantId: this.store.session.participantId, cs, method: 'manual' }, { device: this.store.device });
      await this.store.setSession({ pending: ev });
      await this.savePending();
    });
    $('#later').addEventListener('click', () => this.showHome());
    setTimeout(() => input.focus(), 100);
  }

  renderReady() {
    $('#timer-area').innerHTML = '<button class="big-btn start" id="start">START</button>';
    $('#timing-actions').innerHTML = '<button class="btn secondary" id="back">Avbryt</button>';
    $('#start').addEventListener('pointerdown', (e) => this.onStart(e), { once: true });
    $('#back').addEventListener('click', () => this.showHome());
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
    $('.banner.ok')?.remove();
    $('#timer-area').innerHTML = `<div class="running-indicator"><span class="pulse"></span>Tiden går …</div>
      <button class="big-btn stop" id="stop" style="margin-top:18px">STOPP</button>`;
    $('#timing-actions').innerHTML = '<button class="btn ghost" id="abort">Avbryt forsøket</button>';
    const armedAt = now() + 400; // hindrer at et dobbelttrykk på START stopper klokka umiddelbart
    let stopped = false;
    $('#stop').addEventListener('pointerdown', (e) => {
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
      await this.store.setSession({ attempt: null });
      return this.showSaveError(new Error('Ugyldig måling (klokken på enheten ble endret). Tiden må legges inn i adminpanelet.'));
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
      if (await this.store.hasEvent(ev.id)) await this.store.rebuild(); // allerede lagret (krasj rett etter lagring)
      else await this.store.recordPrepared(ev);
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
    this.render(`<section class="screen"><div class="result-ok">
      <div class="icon">✓</div>
      <h1>Tiden er registrert!</h1>
      <p class="lead" style="color:inherit">Takk for at du deltok, ${esc(p?.firstName ?? '')}! Vinneren kontaktes etter konkurransen.</p>
      <div class="btn-row"><button class="btn primary" id="done" style="min-width:280px">Ferdig</button></div>
    </div></section>`);
    $('#done').addEventListener('click', () => this.showHome());
    this.store.setSession({ screen: 'done', participantId: null });
    this.homeTimer = setTimeout(() => this.showHome(), AUTO_HOME_MS);
  }

  showSaveError(err) {
    vibrate([400, 150, 400, 150, 400]);
    const canRetry = !!this.store.session.pending;
    this.render(`<section class="screen"><div class="result-err">
      <div class="icon">!</div>
      <h1>Tiden er IKKE lagret</h1>
      <p class="lead" style="color:inherit">${esc(err?.message ?? err ?? 'Ukjent feil')}</p>
      <div class="btn-row">
        <button class="btn" id="discard">Forkast og gå til start</button>
        ${canRetry ? '<button class="btn primary" id="retry">Prøv å lagre igjen</button>' : ''}
      </div></div></section>`);
    $('#retry')?.addEventListener('click', () => this.showAttempt());
    $('#discard').addEventListener('click', async () => {
      const ok = await modal({ title: 'Forkaste forsøket?', html: '<p>Tiden blir ikke lagret. Den kan legges inn i adminpanelet senere.</p>',
        buttons: [{ label: 'Nei', value: false, cls: 'secondary' }, { label: 'Ja, forkast', value: true, cls: 'danger' }] });
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
    const ok = await modal({ title: 'Avbryte forsøket?', html: '<p class="lead">Klokken stoppes og ingen tid lagres. Deltakeren kan starte på nytt.</p>',
      buttons: [{ label: 'Fortsett forsøket', value: false, cls: 'secondary' }, { label: 'Avbryt forsøket', value: true, cls: 'danger' }] });
    if (!ok) return;
    const a = this.store.session.attempt;
    await this.store.setSession({ attempt: null });
    if (a) {
      try { await this.store.record(EventType.ATTEMPT_ABORTED, { attemptId: a.attemptId, participantId: a.participantId, reason: 'Avbrutt av operatør' }); } catch { /* logges ikke */ }
    }
    this.showAttempt();
  }
}

function field(name, label, type, autocap, inputmode) {
  return `<div class="field"><label for="${name}">${label}</label>
    <input id="${name}" name="${name}" type="${type}" autocomplete="off" autocapitalize="${autocap}" spellcheck="false"
      ${inputmode ? `inputmode="${inputmode}"` : ''} enterkeyhint="next"><div class="err"></div></div>`;
}
