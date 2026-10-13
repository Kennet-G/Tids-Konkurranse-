import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { makeEvent } from '../app/core/events.js';

// Laster nøyaktig samme SheetJS-fil som appen bruker i nettleseren (/lib), som et globalt skript.
function loadBrowserGlobal(file, name) {
  const sandbox = { console, Uint8Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, Date, Math, JSON };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(new URL(file, import.meta.url), 'utf8'), sandbox, { filename: file });
  return sandbox[name];
}
export const XLSX = loadBrowserGlobal('../lib/xlsx.full.min.js', 'XLSX');

// Hjelper som lager en sekvens av hendelser med stigende tidsstempel og seq.
export function eventLog(start = Date.parse('2026-10-21T08:00:00Z')) {
  const events = [];
  let t = start;
  return {
    events,
    add(type, data, { ts } = {}) {
      t += 1000;
      const ev = makeEvent(type, data, { ts: ts ?? new Date(t).toISOString(), device: 'test' });
      ev.seq = events.length + 1;
      events.push(ev);
      return ev;
    },
    register(id, first, last = 'Testesen', extra = {}) {
      return this.add('PARTICIPANT_REGISTERED', {
        participantId: id, firstName: first, lastName: last, company: 'Firma AS',
        email: `${first.toLowerCase()}@example.no`, phone: '', consent: true, ...extra,
      });
    },
    time(id, cs, extra = {}) {
      const attemptId = `${id}-a${events.length + 1}`;
      this.add('ATTEMPT_RECORDED', { attemptId, participantId: id, cs, method: 'timer', ...extra });
      return attemptId;
    },
    invalidate(attemptId, reason = 'test') {
      return this.add('ATTEMPT_VALIDITY_CHANGED', { attemptId, valid: false, reason });
    },
  };
}
