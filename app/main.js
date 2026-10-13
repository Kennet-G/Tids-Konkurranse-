// Oppstart: lagring, tjenester, publikumsskjerm og skjult adminportal.
import { AppStore } from './services/store.js';
import { BackupService } from './services/backup.js';
import { installWakeLock } from './services/wakelock.js';
import { EventType } from './core/events.js';
import { formatDateTime } from './core/time.js';
import { PublicUI } from './ui/public.js';
import { AdminUI } from './ui/admin.js';
import { Auth } from './ui/auth.js';
import { $, fatal, onLongPress, toast } from './ui/dom.js';

async function main() {
  if (!window.indexedDB) return fatal('Denne nettleseren støtter ikke lokal lagring (IndexedDB).');
  if (!window.XLSX) return fatal('Excel-biblioteket (lib/xlsx.full.min.js) ble ikke lastet.');

  // Be om vedvarende lagring så nettleseren ikke rydder bort data ved lite plass.
  let persisted = false;
  try { persisted = (await navigator.storage?.persist?.()) ?? false; } catch { /* ikke støttet */ }

  const store = new AppStore();
  try {
    await store.init();
  } catch (e) {
    console.error(e);
    return fatal(`Kunne ikke åpne lokal database: ${e?.message ?? e}`);
  }
  await store.record(EventType.APP_STARTED, { persisted, userAgent: navigator.userAgent, version: document.documentElement.dataset.version })
    .catch((e) => { console.error(e); fatal(`Lagring virker ikke: ${e?.message ?? e}`); });

  const statusEl = $('#status');
  const backup = new BackupService(store, (last, err) => {
    statusEl.querySelector('#st-backup').innerHTML = err
      ? '<span class="dot err"></span>Backup feilet'
      : `<span class="dot ${last ? '' : 'warn'}"></span>Backup ${last ? formatDateTime(last.at).slice(11, 16) : '–'}`;
    if (err) toast(`Automatisk backup feilet: ${err.message ?? err}`, 'err', 8000);
  });
  await backup.init();

  statusEl.querySelector('#st-store').innerHTML = `<span class="dot ${persisted ? '' : 'warn'}"></span>${persisted ? 'Lagring OK' : 'Lagring ikke vedvarende'}`;
  installWakeLock((ok) => { statusEl.querySelector('#st-wake').innerHTML = `<span class="dot ${ok ? '' : 'warn'}"></span>${ok ? 'Skjerm våken' : 'Skjermlås ikke aktiv'}`; });

  const auth = new Auth(store);
  const host = $('#screen-host');
  let publicUi;
  const admin = new AdminUI(store, backup, auth, { onClose: () => publicUi.setAdminOpen(false) });
  publicUi = new PublicUI(store, host, { requirePin: (t) => auth.requirePin(t) });

  // Skjult inngang til admin: hold inne på logoen i 2 sekunder.
  onLongPress($('#logo'), 2000, async () => {
    if (admin.open) return;
    publicUi.setAdminOpen(true);
    const ok = await admin.show();
    if (!ok) publicUi.setAdminOpen(false);
  });

  window.addEventListener('unhandledrejection', (e) => console.error('Uhåndtert feil', e.reason));
  publicUi.start();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker ble ikke registrert', e));
}

main();
