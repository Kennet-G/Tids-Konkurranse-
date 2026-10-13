// Append-only hendelseslogg. All tilstand avledes ved å spille av hendelsene i rekkefølge.
// Ingen hendelse slettes eller endres – korrigeringer er nye hendelser som overstyrer.

export const EventType = Object.freeze({
  APP_STARTED: 'APP_STARTED',
  SCAN: 'SCAN',
  PARTICIPANT_REGISTERED: 'PARTICIPANT_REGISTERED',
  PARTICIPANT_UPDATED: 'PARTICIPANT_UPDATED',
  ATTEMPT_STARTED: 'ATTEMPT_STARTED',
  ATTEMPT_ABORTED: 'ATTEMPT_ABORTED',
  ATTEMPT_RECORDED: 'ATTEMPT_RECORDED',
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
  APP_STARTED: 'App startet',
  SCAN: 'Skanning',
  PARTICIPANT_REGISTERED: 'Registrering',
  PARTICIPANT_UPDATED: 'Kontaktinfo endret',
  ATTEMPT_STARTED: 'Forsøk startet',
  ATTEMPT_ABORTED: 'Forsøk avbrutt',
  ATTEMPT_RECORDED: 'Tid registrert',
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
    participants: new Map(), // id -> deltaker
    attempts: new Map(), // attemptId -> forsøk
    attemptsByParticipant: new Map(), // participantId -> [attemptId]
    emailIndex: new Map(), // normalisert e-post -> Set(participantId)
    settings: { winnerMode: WinnerMode.BEST },
    result: null, // { locked, ...WINNER_DECLARED-data, declaredAt }
    resultHistory: [],
    registrationCount: 0,
    scanCount: 0,
    eventCount: 0,
    lastSeq: 0,
    warnings: [],
  };
}

function normEmail(e) {
  return String(e ?? '').trim().toLowerCase();
}

function indexEmail(state, participantId, email) {
  const key = normEmail(email);
  if (!key) return;
  if (!state.emailIndex.has(key)) state.emailIndex.set(key, new Set());
  state.emailIndex.get(key).add(participantId);
}

function unindexEmail(state, participantId, email) {
  const key = normEmail(email);
  const set = state.emailIndex.get(key);
  if (!set) return;
  set.delete(participantId);
  if (set.size === 0) state.emailIndex.delete(key);
}

// Andre deltaker-ID-er som har samme e-post (mulig dobbeltregistrering).
export function findEmailDuplicates(state, email, exceptId = null) {
  const set = state.emailIndex.get(normEmail(email));
  if (!set) return [];
  return [...set].filter((id) => id !== exceptId).map((id) => state.participants.get(id)).filter(Boolean);
}

// Bruker én hendelse på tilstanden (muterer state). Returnerer state.
export function applyEvent(state, ev) {
  state.eventCount += 1;
  if (typeof ev.seq === 'number' && ev.seq > state.lastSeq) state.lastSeq = ev.seq;
  const d = ev.data || {};
  switch (ev.type) {
    case EventType.SCAN: {
      state.scanCount += 1;
      const p = state.participants.get(d.participantId);
      if (p) { p.scanCount += 1; p.lastScanAt = ev.ts; }
      break;
    }
    case EventType.PARTICIPANT_REGISTERED: {
      if (state.participants.has(d.participantId)) {
        state.warnings.push({ eventId: ev.id, message: `ID ${d.participantId} var allerede registrert – registreringen ble ignorert` });
        break;
      }
      const p = {
        id: d.participantId,
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
        registrationMethod: d.method ?? 'qr',
        duplicateOf: Array.isArray(d.duplicateOf) ? d.duplicateOf : [],
        updatedAt: null,
        scanCount: 0,
        lastScanAt: null,
      };
      state.participants.set(p.id, p);
      state.attemptsByParticipant.set(p.id, state.attemptsByParticipant.get(p.id) ?? []);
      indexEmail(state, p.id, p.email);
      state.registrationCount += 1;
      break;
    }
    case EventType.PARTICIPANT_UPDATED: {
      const p = state.participants.get(d.participantId);
      if (!p) { state.warnings.push({ eventId: ev.id, message: `Endring for ukjent ID ${d.participantId}` }); break; }
      const changes = d.changes || {};
      if ('email' in changes) unindexEmail(state, p.id, p.email);
      for (const f of CONTACT_FIELDS) if (f in changes) p[f] = String(changes[f] ?? '');
      if ('email' in changes) indexEmail(state, p.id, p.email);
      p.updatedAt = ev.ts;
      break;
    }
    case EventType.ATTEMPT_RECORDED: {
      if (state.attempts.has(d.attemptId)) {
        state.warnings.push({ eventId: ev.id, message: `Forsøk ${d.attemptId} finnes allerede` });
        break;
      }
      if (!state.participants.has(d.participantId)) {
        state.warnings.push({ eventId: ev.id, message: `Tid for uregistrert ID ${d.participantId}` });
      }
      const a = {
        id: d.attemptId,
        participantId: d.participantId,
        cs: d.cs,
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
      };
      state.attempts.set(a.id, a);
      if (!state.attemptsByParticipant.has(a.participantId)) state.attemptsByParticipant.set(a.participantId, []);
      state.attemptsByParticipant.get(a.participantId).push(a.id);
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
  return (state.attemptsByParticipant.get(participantId) ?? []).map((id) => state.attempts.get(id));
}

export function fullName(p) {
  return p ? `${p.firstName} ${p.lastName}`.trim() : '';
}

// Kort, lesbar beskrivelse av en hendelse til hendelsesloggen.
export function describeEvent(ev, formatCs = (cs) => String(cs)) {
  const d = ev.data || {};
  switch (ev.type) {
    case EventType.SCAN: return `${d.known ? 'Kjent' : 'Ukjent'} ID skannet (${d.method === 'manual' ? 'manuell' : 'QR'})`;
    case EventType.PARTICIPANT_REGISTERED: return `${d.firstName} ${d.lastName}, ${d.company}, ${d.email}${d.duplicateOf?.length ? ` – mulig dobbeltregistrering av ${d.duplicateOf.join(', ')}` : ''}`;
    case EventType.PARTICIPANT_UPDATED: return Object.entries(d.changes || {}).map(([k, v]) => `${k}: «${d.previous?.[k] ?? ''}» → «${v}»`).join('; ') + (d.reason ? ` (${d.reason})` : '');
    case EventType.ATTEMPT_STARTED: return `Forsøk ${short(d.attemptId)} startet`;
    case EventType.ATTEMPT_ABORTED: return `Forsøk ${short(d.attemptId)} avbrutt${d.reason ? `: ${d.reason}` : ''}`;
    case EventType.ATTEMPT_RECORDED: return `Tid ${formatCs(d.cs)} (${({ timer: 'stoppeklokke', manual: 'manuell', admin: 'admin' })[d.method] ?? d.method})${d.note ? ` – ${d.note}` : ''}`;
    case EventType.ATTEMPT_VALIDITY_CHANGED: return `Forsøk ${short(d.attemptId)} merket ${d.valid ? 'GYLDIG' : 'UGYLDIG'}${d.reason ? `: ${d.reason}` : ''}`;
    case EventType.SETTINGS_CHANGED: return Object.entries(d).map(([k, v]) => `${k} = ${v}`).join(', ');
    case EventType.WINNER_DECLARED: return `Vinner (${d.mode === 'median' ? 'nærmest median' : 'beste tid'}): ${d.winnerName} – ${formatCs(d.winnerCs)}${d.tie ? ' (UAVGJORT, avgjort på tidligste registrering)' : ''}`;
    case EventType.RESULT_UNLOCKED: return `Resultat låst opp${d.reason ? `: ${d.reason}` : ''}`;
    case EventType.BACKUP_EXPORTED: return `${d.filename} (${d.reason})`;
    case EventType.DATA_IMPORTED: return `${d.filename}: ${d.imported} nye hendelser, ${d.skipped} fantes fra før`;
    case EventType.APP_STARTED: return d.userAgent ? `Lagring vedvarende: ${d.persisted ? 'ja' : 'nei'}` : '';
    default: return '';
  }
}

function short(id) {
  return String(id ?? '').slice(0, 8);
}
