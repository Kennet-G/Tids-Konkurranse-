// Oppstart og navigasjon: konkurranseliste (forside) ↔ aktiv konkurranse (publikumsskjerm + adminpanel).
import { CompetitionRegistry, competitionDbName } from './core/registry.js';
import { deleteDatabase } from './core/db.js';
import { EventType, uuid } from './core/events.js';
import { formatDateTime } from './core/time.js';
import { AppStore } from './services/store.js';
import { BackupService } from './services/backup.js';
import { installWakeLock } from './services/wakelock.js';
import { installKiosk, setKiosk, isKiosk } from './services/kiosk.js';
import { PublicUI } from './ui/public.js';
import { AdminUI } from './ui/admin.js';
import { renderChooser } from './ui/chooser.js';
import { chooseNewPin, requirePin } from './ui/auth.js';
import { $, esc, fatal, modal, toast } from './ui/dom.js';

const host = $('#screen-host');
const ui = { title: $('#title'), subtitle: $('#subtitle'), admin: $('#btn-admin'), switch: $('#btn-switch'), status: $('#status') };

let registry;
let device;
let persisted = false;
let current = null; // { id, store, backup, pub, admin }

async function main() {
  if (!window.indexedDB) return fatal('Denne nettleseren støtter ikke lokal lagring (IndexedDB).');
  if (!window.XLSX) return fatal('Excel-biblioteket (lib/xlsx.full.min.js) ble ikke lastet.');
  // Be om vedvarende lagring så nettleseren ikke rydder bort data ved lite plass.
  try { persisted = (await navigator.storage?.persist?.()) ?? false; } catch { /* ikke støttet */ }
  try {
    registry = await new CompetitionRegistry().open();
    device = await registry.kvGet('deviceId');
    if (!device) { device = `enhet-${Math.random().toString(36).slice(2, 6)}`; await registry.kvSet('deviceId', device); }
  } catch (e) {
    console.error(e);
    return fatal(`Kunne ikke åpne lokal database: ${e?.message ?? e}`);
  }
  $('#st-store').innerHTML = `<span class="dot ${persisted ? '' : 'warn'}"></span>${persisted ? 'Lagring OK' : 'Lagring ikke vedvarende'}`;
  installWakeLock((ok) => { $('#st-wake').innerHTML = `<span class="dot ${ok ? '' : 'warn'}"></span>${ok ? 'Skjerm våken' : 'Skjermlås ikke aktiv'}`; });
  ui.admin.addEventListener('click', () => current?.admin.show());
  // Bytte konkurranse krever PIN-koden til den aktive konkurransen.
  ui.switch.addEventListener('click', async () => {
    if (!current) return;
    if (current.store.session.attempt) return toast('Et forsøk pågår – avslutt det først', 'err');
    if (await pinFor(current.id, 'Bytt konkurranse – tast admin-PIN')) showChooser();
  });
  installKiosk({ logo: $('.topbar .logo'), onAdmin: () => current?.admin.show() });
  setKiosk(await registry.kvGet('kiosk', false));
  window.addEventListener('unhandledrejection', (e) => console.error('Uhåndtert feil', e.reason));

  const active = await registry.getActive();
  if (active && (await registry.get(active))) await openCompetition(active);
  else await showChooser();
}

function pinFor(id, title) {
  const store = current?.id === id ? current.store : null;
  return requirePin(registry, id, title, { onFail: () => store?.record(EventType.ADMIN_LOGIN_FAILED, { context: title }).catch(() => {}) });
}

async function closeCurrent() {
  if (!current) return;
  current.admin.close();
  current.pub.destroy();
  current.backup.stop();
  current.store.close();
  current = null;
}

async function showChooser() {
  await closeCurrent();
  setHeader('Konkurranseregistrering', 'TROX Auranor', false);
  $('#st-backup').innerHTML = '';
  await renderChooser(host, {
    registry,
    activeId: await registry.getActive(),
    // Å åpne en konkurranse fra listen krever konkurransens egen PIN.
    onOpen: async (id) => { const rec = await registry.get(id); if (await pinFor(id, `Åpne «${rec?.name ?? ''}» – tast PIN`)) openCompetition(id); },
    onCreate: (opts) => createCompetition(opts),
    onRestore: (r) => restoreCompetition(r),
  });
}

function setHeader(title, subtitle, inCompetition) {
  ui.title.textContent = title;
  ui.subtitle.textContent = subtitle;
  ui.admin.hidden = !inCompetition;
  ui.switch.hidden = !inCompetition;
  document.title = inCompetition ? `${title} – TROX Konkurranseregistrering` : 'TROX Konkurranseregistrering';
}

async function openCompetition(id) {
  await closeCurrent();
  const rec = await registry.get(id);
  if (!rec) { toast('Fant ikke konkurransen', 'err'); return showChooser(); }
  const store = new AppStore(id, device);
  try {
    await store.init();
    await store.record(EventType.APP_STARTED, { persisted, userAgent: navigator.userAgent });
  } catch (e) {
    console.error(e);
    return fatal(`Lagring virker ikke: ${e?.message ?? e}`);
  }
  await registry.setActive(id);
  const backup = new BackupService(store, (last, err) => {
    $('#st-backup').innerHTML = err ? '<span class="dot err"></span>Backup feilet'
      : `<span class="dot ${last ? '' : 'warn'}"></span>Backup ${last ? formatDateTime(last.at).slice(11, 16) : '–'}`;
    if (err) toast(`Backup feilet: ${err.message ?? err}`, 'err', 8000);
  });
  await backup.init();
  const pub = new PublicUI(store, host, {
    requirePin: (title) => requirePin(registry, id, title, { onFail: () => store.record(EventType.ADMIN_LOGIN_FAILED, { context: 'overstyring' }).catch(() => {}) }),
  });
  const admin = new AdminUI({
    store, backup, registry, competitionId: id,
    onClose: () => {},
    onSwitch: () => showChooser(),
    onRenamed: (name) => setHeader(name, 'TROX Konkurranseregistrering', true),
    onDeleted: () => deleteCompetition(id),
    kiosk: {
      get: () => isKiosk(),
      set: async (on) => { await registry.kvSet('kiosk', !!on); setKiosk(on); },
    },
  });
  current = { id, store, backup, pub, admin };
  setHeader(store.state.settings.name || rec.name, 'TROX Konkurranseregistrering', true);
  pub.start();
}

async function createCompetition({ name, timerEnabled, winnerMode, pin }) {
  const id = uuid();
  try {
    await registry.put({ id, name, createdAt: new Date().toISOString(), pin });
    const store = new AppStore(id, device);
    await store.init();
    await store.record(EventType.COMPETITION_CREATED, { competitionId: id, name, timerEnabled, winnerMode });
    await store.record(EventType.PIN_CHANGED, { firstTime: true });
    store.close();
  } catch (e) {
    console.error(e);
    return modal({ title: 'Kunne ikke opprette konkurransen', kind: 'danger', html: `<p>${esc(e?.message ?? e)}</p>`, buttons: [{ label: 'OK', value: true }] });
  }
  toast(`✓ «${name}» er opprettet`, 'ok');
  await openCompetition(id);
}

// Gjenoppretter en konkurranse fra en backupfil (f.eks. på en ny enhet).
async function restoreCompetition({ file, parsed, info }) {
  let id = info?.id;
  let name = info?.name;
  const existing = id ? await registry.get(id) : null;
  if (existing) {
    const ok = await modal({ title: `«${existing.name}» finnes allerede`, html: '<p>Hendelser fra filen som mangler her, legges til (slås sammen). Ingenting slettes.</p>',
      buttons: [{ label: 'Avbryt', value: false, cls: 'secondary' }, { label: 'Slå sammen', value: true }] });
    if (!ok || !(await requirePin(registry, id, `Tast PIN for «${existing.name}»`))) return;
  } else {
    const ok = await modal({ title: 'Gjenopprette konkurranse?',
      html: `<p>Fil: <strong>${esc(file.name)}</strong></p><p>Konkurranse: <strong>${esc(name ?? '(uten navn)')}</strong> – ${parsed.events.length} hendelser
        ${parsed.errors.length ? `<br><span style="color:var(--error)">${parsed.errors.length} rader kunne ikke leses</span>` : ''}</p><p>Neste steg: velg en ny PIN for adminpanelet.</p>`,
      buttons: [{ label: 'Avbryt', value: false, cls: 'secondary' }, { label: 'Gjenopprett', value: true }] });
    if (!ok) return;
    const pin = await chooseNewPin('Velg PIN for adminpanelet (4 sifre)');
    if (!pin) return;
    if (!id) { id = uuid(); name = file.name.replace(/\.xlsx$/i, ''); }
    await registry.put({ id, name, createdAt: info?.createdAt ?? new Date().toISOString(), pin });
  }
  const store = new AppStore(id, device);
  try {
    await store.init();
    if (!info) await store.record(EventType.COMPETITION_CREATED, { competitionId: id, name, timerEnabled: true, winnerMode: 'best' });
    const have = new Set(await store.db.allIds());
    const fresh = parsed.events.filter((e) => !have.has(e.id));
    if (fresh.length) await store.recordMany(fresh.map((e) => ({ ...e })));
    await store.record(EventType.DATA_IMPORTED, { filename: file.name, imported: fresh.length, skipped: parsed.events.length - fresh.length, errors: parsed.errors.length });
    toast(`✓ Gjenopprettet ${fresh.length} hendelser`, 'ok', 5000);
  } catch (e) {
    console.error(e);
    return modal({ title: 'GJENOPPRETTING FEILET', kind: 'danger', html: `<p>${esc(e?.message ?? e)}</p>`, buttons: [{ label: 'OK', value: true }] });
  } finally {
    store.close();
  }
  await openCompetition(id);
}

async function deleteCompetition(id) {
  const store = current?.id === id ? current.store : null;
  store?.forgetLocal();
  await closeCurrent();
  try {
    await registry.remove(id);
    await deleteDatabase(undefined, competitionDbName(id));
    toast('Konkurransen er slettet fra enheten', 'info', 5000);
  } catch (e) {
    toast(`Sletting feilet: ${e?.message ?? e}`, 'err', 8000);
  }
  await showChooser();
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Service worker ble ikke registrert', e));
}

main();
