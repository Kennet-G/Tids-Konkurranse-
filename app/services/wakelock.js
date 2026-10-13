// Holder skjermen våken (Screen Wake Lock API). Fornyes når appen blir synlig igjen.
let sentinel = null;

export async function keepAwake() {
  if (!('wakeLock' in navigator)) return false;
  try {
    if (sentinel && !sentinel.released) return true;
    sentinel = await navigator.wakeLock.request('screen');
    return true;
  } catch {
    return false;
  }
}

export function installWakeLock(onState) {
  const refresh = async () => onState?.(await keepAwake());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  // Krever ofte en brukerhandling første gang
  document.addEventListener('pointerdown', () => { if (!sentinel || sentinel.released) refresh(); }, { passive: true });
  refresh();
}

export function isAwake() {
  return !!sentinel && !sentinel.released;
}
