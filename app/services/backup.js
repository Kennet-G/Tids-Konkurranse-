// Excel-backup til Nedlastinger: hvert 10. minutt (hvis noe er endret) og etter hver 10. registrering.
import { buildWorkbook, workbookToArray } from '../core/excel.js';
import { backupFilename } from '../core/time.js';
import { EventType } from '../core/events.js';

const INTERVAL_MS = 10 * 60 * 1000;

export class BackupService {
  constructor(store, onStatus) {
    this.store = store;
    this.onStatus = onStatus;
    this.last = null; // { at, filename, eventCount }
    this.lastName = '';
    this.busy = false;
  }

  async init() {
    this.last = await this.store.kvGet('lastBackup', null);
    this.store.onChange((ev) => {
      if (ev?.type === EventType.PARTICIPANT_REGISTERED && this.store.state.registrationCount % 10 === 0) {
        this.run('etter 10 registreringer');
      }
    });
    setInterval(() => this.tick(), 30 * 1000);
    this.onStatus?.(this.last);
  }

  tick() {
    const changed = this.store.state.eventCount > (this.last?.eventCount ?? 0);
    const due = !this.last || Date.now() - Date.parse(this.last.at) >= INTERVAL_MS;
    if (changed && due) this.run('automatisk hvert 10. min');
  }

  // Lager og laster ned en komplett Excel-fil. Returnerer filnavnet.
  async run(reason = 'manuell') {
    if (this.busy) return null;
    this.busy = true;
    try {
      const now = new Date();
      let filename = backupFilename(now);
      if (filename === this.lastName) filename = backupFilename(now, { withSeconds: true });
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
