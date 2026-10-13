// Excel-backup til Nedlastinger: hver time (bare hvis noe er endret siden forrige backup),
// etter hver 10. registrering, ved kåring, før sletting og når admin trykker eksport.
import { buildWorkbook, workbookToArray } from '../core/excel.js';
import { backupFilename } from '../core/time.js';
import { EventType } from '../core/events.js';

export const INTERVAL_MS = 60 * 60 * 1000;

// Skal det tas automatisk backup nå? (ren funksjon – testes)
export function backupDue({ last, eventCount, registrations = 1, now = Date.now(), intervalMs = INTERVAL_MS }) {
  const changed = eventCount > (last?.eventCount ?? 0);
  if (!changed) return false;
  if (!last) return registrations > 0; // første backup når første deltaker er registrert
  return now - Date.parse(last.at) >= intervalMs;
}

export class BackupService {
  constructor(store, onStatus) {
    this.store = store;
    this.onStatus = onStatus;
    this.last = null; // { at, filename, eventCount }
    this.lastName = '';
    this.busy = false;
    this.timer = null;
    this.unsub = null;
  }

  async init() {
    this.last = await this.store.kvGet('lastBackup', null);
    this.unsub = this.store.onChange((ev) => {
      if (ev?.type === EventType.PARTICIPANT_REGISTERED && this.store.state.registrationCount % 10 === 0) {
        this.run('etter 10 registreringer').catch(() => {});
      }
    });
    this.timer = setInterval(() => this.tick(), 60 * 1000);
    this.onStatus?.(this.last);
  }

  stop() {
    clearInterval(this.timer);
    this.unsub?.();
  }

  tick() {
    // BACKUP_EXPORTED-hendelsen selv teller ikke som en endring (eventCount lagres etter at den er logget).
    if (backupDue({ last: this.last, eventCount: this.store.state.eventCount, registrations: this.store.state.registrationCount })) this.run('automatisk hver time').catch(() => {});
  }

  // Lager og laster ned en komplett Excel-fil. Returnerer filnavnet.
  async run(reason = 'manuell') {
    if (this.busy) return null;
    this.busy = true;
    try {
      const now = new Date();
      const name = this.store.state.settings.name;
      let filename = backupFilename(name, now);
      if (filename === this.lastName) filename = backupFilename(name, now, { withSeconds: true });
      // Hendelsen om eksporten logges først, slik at den også er med i filen.
      await this.store.record(EventType.BACKUP_EXPORTED, { filename, reason });
      const events = await this.store.allEvents();
      const wb = buildWorkbook(window.XLSX, events, { exportedAt: now, device: this.store.device });
      download(new Blob([workbookToArray(window.XLSX, wb)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
      this.lastName = filename;
      this.last = { at: now.toISOString(), filename, eventCount: this.store.state.eventCount, reason };
      await this.store.kvSet('lastBackup', this.last);
      this.onStatus?.(this.last);
      return filename;
    } catch (e) {
      console.error(e);
      this.onStatus?.(this.last, e);
      throw e;
    } finally {
      this.busy = false;
    }
  }
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}
