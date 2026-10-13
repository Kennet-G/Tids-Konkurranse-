// Append-only hendelseslogg per konkurranse. All tilstand avledes ved å spille av hendelsene i rekkefølge.
// Ingen hendelse slettes eller endres – rettelser og «sletting» av tider er nye hendelser som overstyrer.

export const EventType = Object.freeze({
  COMPETITION_CREATED: 'COMPETITION_CREATED',
  APP_STARTED: 'APP_STARTED',
  PARTICIPANT_REGISTERED: 'PARTICIPANT_REGISTERED',
  PARTICIPANT_UPDATED: 'PARTICIPANT_UPDATED',
  REREGISTRATION_BLOCKED: 'REREGISTRATION_BLOCKED',
  ATTEMPT_STARTED: 'ATTEMPT_STARTED',
  ATTEMPT_ABORTED: 'ATTEMPT_ABORTED',
  ATTEMPT_RECORDED: 'ATTEMPT_RECORDED',
  ATTEMPT_EDITED: 'ATTEMPT_EDITED',
  ATTEMPT_DELETED: 'ATTEMPT_DELETED',
  ATTEMPT_VALIDITY_CHANGED: 'ATTEMPT_VALIDITY_CHANGED',
  SETTINGS_CHANGED: 'SETTINGS_CHANGED',
  WINNER_DECLARED: 'WINNER_DECLARED',
  RESULT_UNLOCKED: 'RESULT_UNLOCKED',
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  ADMIN_LOGIN_FAILED: 'ADMIN_LOGIN_FAILED',
  PIN_CHANGED: 'PIN_CHANGED',
  BACKUP_EXPORTED: 'BACKUP_EXPORTED',
  DATA_IMPORTED: 'DATA_IMPORTED',
});

export const EVENT_LABELS = Object.freeze({
  COMPETITION_CREATED: 'Konkurranse opprettet',
  APP_STARTED: 'Konkurranse åpnet',
  PARTICIPANT_REGISTERED: 'Registrering',
  PARTICIPANT_UPDATED: 'Kontaktinfo endret',
  REREGISTRATION_BLOCKED: 'Registrering stoppet',
  ATTEMPT_STARTED: 'Forsøk startet',
  ATTEMPT_ABORTED: 'Forsøk avbrutt',
  ATTEMPT_RECORDED: 'Tid registrert',
  ATTEMPT_EDITED: 'Tid endret',
  ATTEMPT_DELETED: 'Tid slettet',
  ATTEMPT_VALIDITY_CHANGED: 'Gyldighet endret',
  SETTINGS_CHANGED: 'Innstilling endret',
  WINNER_DECLARED: 'Vinner kåret',
  RESULT_UNLOCKED: 'Resultat låst opp',
  ADMIN_LOGIN: 'Admin innlogget',
  ADMIN_LOGIN_FAILED: 'Feil PIN',
  PIN_CHANGED: 'PIN endret',
  BACKUP_EXPORTED: 'Backup/eksport',
  DATA_IMPORTED: 'Data importert',
});

export const WinnerMode = Object.freeze({ BEST: 'best', MEDIAN: 'median' });

export const CONTACT_FIELDS = ['firstName', 'lastName', 'company', 'email', 'phone'];

export const DEFAULT_SETTINGS = Object.freeze({ name: '', winnerMode: WinnerMode.BEST, timerEnabled: true });

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Lager en ny hendelse (uten seq – den settes av databasen).
export function makeEvent(type, data = {}, { ts = new Date().toISOString(), device = '' } = {}) {
  if (!EventType[type]) throw new Error(`Ukjent hendelsestype: ${type}`);
  return { id: uuid(), ts, type, device, data: structuredClone(data) };
}

export function createState() {
  return {
    competition: null, // { id, name, createdAt }
    participants: new Map(), // id -> deltaker
    attempts: new Map(), // attemptId -> forsøk (også slettede, med deleted=true)
    attemptsByParticipant: new Map(), // participantId -> [attemptId]
    emailIndex: new Map(), // normalisert e-post -> Set(participantId)
    phoneIndex: new Map(), // normalisert telefon -> Set(participantId)
    identityIndex: new Map(), // navn+firma+e-post+telefon -> Set(participantId)
    settings: { ...DEFAULT_SETTINGS },
    result: null,
    resultHistory: [],
    registrationCount: 0,
    eventCount: 0,
    lastSeq: 0,
    warnings: [],
  };
}

export function normEmail(e) {
  return String(e ?? '').trim().toLowerCase();
}

// Sammenligner telefonnummer på de siste 8 sifrene (norske nummer med/uten +47).
export function normPhone(p) {
  const digits = String(p ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : '';
}

function normText(v) {
  return String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Samme person = likt fornavn, etternavn, firma, e-post OG telefon (uavhengig av store/små bokstaver,
// mellomrom og telefonformat). Flere personer kan ha samme navn, e-post eller telefon.
export function identityKey(c) {
  return [normText(c.firstName), normText(c.lastName), normText(c.company), normEmail(c.email), normPhone(c.phone) || String(c.phone ?? '').replace(/\D/g, '')].join('\u0001');
}

function indexParticipant(state, p) {
  addIndex(state.emailIndex, normEmail(p.email), p.id);
  addIndex(state.phoneIndex, normPhone(p.phone), p.id);
  addIndex(state.identityIndex, identityKey(p), p.id);
}

function unindexParticipant(state, p) {
  removeIndex(state.emailIndex, normEmail(p.email), p.id);
  removeIndex(state.phoneIndex, normPhone(p.phone), p.id);
  removeIndex(state.identityIndex, identityKey(p), p.id);
}

function addIndex(map, key, id) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(id);
}

function removeIndex(map, key, id) {
  const set = map.get(key);
  if (!set) return;
  set.delete(id);
  if (set.size === 0) map.delete(key);
}

// Deltakere (andre enn exceptId) med samme e-post.
export function findEmailDuplicates(state, email, exceptId = null) {
  const set = state.emailIndex.get(normEmail(email));
  if (!set) return [];
  return [...set].filter((id) => id !== exceptId).map((id) => state.participants.get(id)).filter(Boolean);
}

// Finner en tidligere registrering av SAMME person: navn, firma, e-post og telefon må alle være like.
export function findExistingParticipant(state, contact = {}) {
  const found = [...(state.identityIndex.get(identityKey(contact)) ?? [])].map((id) => state.participants.get(id)).filter(Boolean);
  found.sort((a, b) => (a.nr ?? 0) - (b.nr ?? 0));
  return found[0] ?? null;
}

// Andre deltakere som deler e-post eller telefon (ikke nødvendigvis samme person) – vises som info i admin.
export function sharedContacts(state, p) {
  const ids = new Set([...(state.emailIndex.get(normEmail(p.email)) ?? []), ...(state.phoneIndex.get(normPhone(p.phone)) ?? [])]);
  ids.delete(p.id);
  return [...ids].map((id) => state.participants.get(id)).filter(Boolean);
}

// Forsøk som teller (ikke slettede). Ugyldige forsøk er med – de er fortsatt «brukt».
export function activeAttempts(state, participantId) {
  return attemptsFor(state, participantId).filter((a) => !a.deleted);
}

export function hasHadAttempt(state, participantId) {
  return activeAttempts(state, participantId).length > 0;
}

// Bruker én hendelse på tilstanden (muterer state). Returnerer state.
export function applyEvent(state, ev) {
  state.eventCount += 1;
  if (typeof ev.seq === 'number' && ev.seq > state.lastSeq) state.lastSeq = ev.seq;
  const d = ev.data || {};
  switch (ev.type) {
    case EventType.COMPETITION_CREATED: {
      if (!state.competition) state.competition = { id: d.competitionId, name: d.name ?? '', createdAt: ev.ts };
      if (d.name) state.settings.name = d.name;
      if (d.winnerMode === WinnerMode.BEST || d.winnerMode === WinnerMode.MEDIAN) state.settings.winnerMode = d.winnerMode;
      if (typeof d.timerEnabled === 'boolean') state.settings.timerEnabled = d.timerEnabled;
      break;
    }
    case EventType.PARTICIPANT_REGISTERED: {
      if (state.participants.has(d.participantId)) {
        state.warnings.push({ eventId: ev.id, message: `Deltaker ${d.participantId} var allerede registrert – registreringen ble ignorert` });
        break;
      }
      state.registrationCount += 1;
      const p = {
        id: d.participantId,
        nr: state.registrationCount,
        firstName: d.firstName ?? '',
        lastName: d.lastName ?? '',
        company: d.company ?? '',
        email: d.email ?? '',
        phone: d.phone ?? '',
        consent: d.consent === true,
        consentText: d.consentText ?? '',
        registeredAt: ev.ts,
        registeredSeq: ev.seq ?? state.eventCount,
        registeredEventId: ev.id,
        updatedAt: null,
        blockedAttempts: 0,
        override: d.override ?? null, // satt når admin har godkjent registreringen med PIN (lik/delt kontakt)
      };
      state.participants.set(p.id, p);
      if (!state.attemptsByParticipant.has(p.id)) state.attemptsByParticipant.set(p.id, []);
      indexParticipant(state, p);
      break;
    }
    case EventType.PARTICIPANT_UPDATED: {
      const p = state.participants.get(d.participantId);
      if (!p) { state.warnings.push({ eventId: ev.id, message: `Endring for ukjent deltaker ${d.participantId}` }); break; }
      const changes = d.changes || {};
      unindexParticipant(state, p);
      for (const f of CONTACT_FIELDS) if (f in changes) p[f] = String(changes[f] ?? '');
      indexParticipant(state, p);
      p.updatedAt = ev.ts;
      break;
    }
    case EventType.REREGISTRATION_BLOCKED: {
      const p = state.participants.get(d.participantId);
      if (p) p.blockedAttempts += 1;
      break;
    }
    case EventType.ATTEMPT_RECORDED: {
      if (state.attempts.has(d.attemptId)) {
        state.warnings.push({ eventId: ev.id, message: `Forsøk ${d.attemptId} finnes allerede` });
        break;
      }
      if (!state.participants.has(d.participantId)) {
        state.warnings.push({ eventId: ev.id, message: `Tid for ukjent deltaker ${d.participantId}` });
      }
      const a = {
        id: d.attemptId,
        participantId: d.participantId,
        cs: d.cs,
        originalCs: d.cs,
        method: d.method ?? 'timer', // timer | manual | admin
        startedAt: d.startedAt ?? null,
        stoppedAt: d.stoppedAt ?? null,
        rawMs: d.rawMs ?? null,
        note: d.note ?? '',
        recordedAt: ev.ts,
        recordedSeq: ev.seq ?? state.eventCount,
        valid: true,
        validityReason: '',
        validityChangedAt: null,
        edits: [],
        deleted: false,
        deletedAt: null,
        deleteReason: '',
      };
      state.attempts.set(a.id, a);
      if (!state.attemptsByParticipant.has(a.participantId)) state.attemptsByParticipant.set(a.participantId, []);
      state.attemptsByParticipant.get(a.participantId).push(a.id);
      break;
    }
    case EventType.ATTEMPT_EDITED: {
      const a = state.attempts.get(d.attemptId);
      if (!a) { state.warnings.push({ eventId: ev.id, message: `Endring av ukjent forsøk ${d.attemptId}` }); break; }
      if (!Number.isFinite(d.cs)) break;
      a.edits.push({ from: a.cs, to: d.cs, at: ev.ts, reason: d.reason ?? '' });
      a.cs = d.cs;
      break;
    }
    case EventType.ATTEMPT_DELETED: {
      const a = state.attempts.get(d.attemptId);
      if (!a) { state.warnings.push({ eventId: ev.id, message: `Sletting av ukjent forsøk ${d.attemptId}` }); break; }
      a.deleted = true;
      a.deletedAt = ev.ts;
      a.deleteReason = d.reason ?? '';
      break;
    }
    case EventType.ATTEMPT_VALIDITY_CHANGED: {
      const a = state.attempts.get(d.attemptId);
      if (!a) { state.warnings.push({ eventId: ev.id, message: `Ukjent forsøk ${d.attemptId}` }); break; }
      a.valid = d.valid === true;
      a.validityReason = d.reason ?? '';
      a.validityChangedAt = ev.ts;
      break;
    }
    case EventType.SETTINGS_CHANGED: {
      if (d.winnerMode === WinnerMode.BEST || d.winnerMode === WinnerMode.MEDIAN) state.settings.winnerMode = d.winnerMode;
      if (typeof d.timerEnabled === 'boolean') state.settings.timerEnabled = d.timerEnabled;
      if (typeof d.name === 'string' && d.name.trim()) {
        state.settings.name = d.name.trim();
        if (state.competition) state.competition.name = d.name.trim();
      }
      break;
    }
    case EventType.WINNER_DECLARED: {
      state.result = { ...structuredClone(d), locked: true, declaredAt: ev.ts, eventId: ev.id };
      state.resultHistory.push(state.result);
      break;
    }
    case EventType.RESULT_UNLOCKED: {
      if (state.result) state.result = { ...state.result, locked: false, unlockedAt: ev.ts, unlockReason: d.reason ?? '' };
      break;
    }
    default:
      // ATTEMPT_STARTED, ATTEMPT_ABORTED, ADMIN_*, PIN_CHANGED, BACKUP_EXPORTED, DATA_IMPORTED, APP_STARTED:
      // kun revisjonsspor, påvirker ikke konkurransetilstanden.
      break;
  }
  return state;
}

export function buildState(events) {
  const state = createState();
  for (const ev of events) applyEvent(state, ev);
  return state;
}

export function attemptsFor(state, participantId) {
  return (state.attemptsByParticipant.get(participantId) ?? []).map((id) => state.attempts.get(id)).filter(Boolean);
}

export function fullName(p) {
  return p ? `${p.firstName} ${p.lastName}`.trim() : '';
}

const METHOD = { timer: 'stoppeklokke i appen', manual: 'ekstern stoppeklokke', admin: 'admin' };

// Kort, lesbar beskrivelse av en hendelse til hendelsesloggen.
export function describeEvent(ev, formatCs = (cs) => String(cs)) {
  const d = ev.data || {};
  switch (ev.type) {
    case EventType.COMPETITION_CREATED: return `«${d.name}» – vinnermodus ${d.winnerMode === 'median' ? 'nærmest median' : 'beste tid'}, tidtaking i appen ${d.timerEnabled ? 'på' : 'av'}`;
    case EventType.PARTICIPANT_REGISTERED: return `${d.firstName} ${d.lastName}, ${d.company}, ${d.email}${d.phone ? `, ${d.phone}` : ''}${d.override ? ` – OVERSTYRT av admin: ${overrideText(d.override)}` : ''}`;
    case EventType.PARTICIPANT_UPDATED: return Object.entries(d.changes || {}).map(([k, v]) => `${k}: «${d.previous?.[k] ?? ''}» → «${v}»`).join('; ') + (d.reason ? ` (${d.reason})` : '');
    case EventType.REREGISTRATION_BLOCKED: return d.matchedOn === 'identity'
      ? 'Forsøkte å registrere seg på nytt med likt navn, firma, e-post og telefon – har allerede hatt forsøket sitt'
      : `Samme ${d.matchedOn === 'phone' ? 'telefon' : d.matchedOn === 'both' ? 'e-post og telefon' : 'e-post'} som denne deltakeren – registrering av ${d.attempted ?? 'ny person'} ble ikke godkjent`;
    case EventType.ATTEMPT_STARTED: return `Forsøk ${short(d.attemptId)} startet`;
    case EventType.ATTEMPT_ABORTED: return `Forsøk ${short(d.attemptId)} avbrutt${d.reason ? `: ${d.reason}` : ''}`;
    case EventType.ATTEMPT_RECORDED: return `Tid ${formatCs(d.cs)} (${METHOD[d.method] ?? d.method})${d.note ? ` – ${d.note}` : ''}`;
    case EventType.ATTEMPT_EDITED: return `Tid endret ${formatCs(d.previousCs)} → ${formatCs(d.cs)}${d.reason ? `: ${d.reason}` : ''}`;
    case EventType.ATTEMPT_DELETED: return `Tid ${formatCs(d.cs)} slettet${d.reason ? `: ${d.reason}` : ''}`;
    case EventType.ATTEMPT_VALIDITY_CHANGED: return `Forsøk ${short(d.attemptId)} merket ${d.valid ? 'GYLDIG' : 'UGYLDIG'}${d.reason ? `: ${d.reason}` : ''}`;
    case EventType.SETTINGS_CHANGED: return [
      d.winnerMode ? `Vinnermodus: ${d.winnerMode === 'median' ? 'nærmest median' : 'beste tid'}` : '',
      typeof d.timerEnabled === 'boolean' ? `Tidtaking i appen: ${d.timerEnabled ? 'PÅ' : 'AV'}` : '',
      d.name ? `Navn: «${d.name}»` : '',
      typeof d.kiosk === 'boolean' ? `Kioskmodus på enheten: ${d.kiosk ? 'PÅ' : 'AV'}` : '',
    ].filter(Boolean).join(', ');
    case EventType.WINNER_DECLARED: return `Vinner (${d.mode === 'median' ? 'nærmest median' : 'beste tid'}): ${d.winnerName} – ${formatCs(d.winnerCs)}${d.tie ? ' (UAVGJORT, avgjort på tidligste registrering)' : ''}`;
    case EventType.RESULT_UNLOCKED: return `Resultat låst opp${d.reason ? `: ${d.reason}` : ''}`;
    case EventType.BACKUP_EXPORTED: return `${d.filename} (${d.reason})`;
    case EventType.DATA_IMPORTED: return `${d.filename}: ${d.imported} nye hendelser, ${d.skipped} fantes fra før`;
    case EventType.APP_STARTED: return `Lagring vedvarende: ${d.persisted ? 'ja' : 'nei'}`;
    default: return '';
  }
}

// «helt lik nr 3» / «samme telefon som nr 1, 4»
export function overrideText(o) {
  const nrs = (o?.matchNrs ?? []).join(', ');
  const what = { identical: 'helt lik', email: 'samme e-post som', phone: 'samme telefon som', both: 'samme e-post og telefon som' }[o?.kind] ?? 'lik';
  return `${what} nr ${nrs}`;
}

// Hva er likt mellom en ny registrering og en eksisterende deltaker? 'both' | 'email' | 'phone' | null
export function contactMatch(contact, p) {
  const e = !!normEmail(contact.email) && normEmail(contact.email) === normEmail(p.email);
  const ph = !!normPhone(contact.phone) && normPhone(contact.phone) === normPhone(p.phone);
  return e && ph ? 'both' : e ? 'email' : ph ? 'phone' : null;
}

function short(id) {
  return String(id ?? '').slice(0, 8);
}
