// Kioskmodus (per enhet): skjuler Admin/Bytt-knappene, holder appen i fullskjerm, stopper
// tilbake-knappen og høyreklikk/langt trykk-meny. Admin åpnes da ved å holde på TROX-logoen
// i 2 sekunder (nettbrett/PC) eller med Ctrl+Alt+A (PC).

let enabled = false;

export function isKiosk() {
  return enabled;
}

export function setKiosk(on) {
  enabled = !!on;
  document.body.classList.toggle('kiosk', enabled);
  if (enabled) enterFullscreen();
  else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function enterFullscreen() {
  if (document.fullscreenElement || !document.fullscreenEnabled) return;
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}

export function installKiosk({ logo, onAdmin }) {
  // Fullskjerm krever et trykk fra brukeren – prøv igjen ved hvert trykk.
  document.addEventListener('pointerdown', () => { if (enabled) enterFullscreen(); }, { capture: true, passive: true });

  // Tilbake-knappen (Android) og nettleserens «tilbake» skal ikke forlate appen.
  history.pushState({ kiosk: true }, '');
  window.addEventListener('popstate', () => { if (enabled) history.pushState({ kiosk: true }, ''); });

  // Ingen høyreklikk / langt-trykk-meny utenfor skrivefelt.
  document.addEventListener('contextmenu', (e) => {
    if (enabled && !e.target.closest('input, textarea')) e.preventDefault();
  });

  // PC: Ctrl+Alt+A åpner admin (Ctrl+Shift+A er opptatt av Chrome).
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.code === 'KeyA') { e.preventDefault(); onAdmin(); }
  });

  // Nettbrett: hold på TROX-logoen i 2 sekunder.
  let t = null;
  const cancel = () => { clearTimeout(t); t = null; };
  logo.addEventListener('pointerdown', (e) => { e.preventDefault(); cancel(); t = setTimeout(() => { t = null; onAdmin(); }, 2000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => logo.addEventListener(n, cancel));
}
