// Tidsberegning. Offisiell tid er hele hundredeler (centisekunder, «cs»),
// avkortet nedover slik som på en vanlig stoppeklokke.

export function msToCs(ms) {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError('Ugyldig varighet');
  // Liten epsilon motvirker flyttallsfeil fra performance.now() (f.eks. 12339.999999).
  return Math.floor(ms / 10 + 1e-6);
}

// Varighet mellom start og stopp (ms, gjerne høyoppløselige verdier) -> cs.
export function elapsedCs(startMs, stopMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) throw new RangeError('Mangler start/stopp');
  if (stopMs < startMs) throw new RangeError('Stopp er før start');
  return msToCs(stopMs - startMs);
}

// 1234 cs -> "12,34"; 7512 -> "1:15,12"; 360000 -> "1:00:00,00"
export function formatCs(cs) {
  if (cs == null || !Number.isFinite(cs)) return '';
  const negative = cs < 0;
  let rest = Math.round(Math.abs(cs));
  const hundredths = rest % 100; rest = (rest - hundredths) / 100;
  const seconds = rest % 60; rest = (rest - seconds) / 60;
  const minutes = rest % 60; const hours = (rest - minutes) / 60;
  const hh = String(hundredths).padStart(2, '0');
  let out;
  if (hours > 0) out = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${hh}`;
  else if (minutes > 0) out = `${minutes}:${String(seconds).padStart(2, '0')},${hh}`;
  else out = `${seconds},${hh}`;
  return negative ? `-${out}` : out;
}

// Format for medianen, som kan ha halve hundredeler (gjennomsnitt av to midtverdier).
export function formatCsPrecise(cs) {
  if (cs == null || !Number.isFinite(cs)) return '';
  if (Number.isInteger(cs)) return formatCs(cs);
  const whole = Math.floor(cs);
  const frac = Math.round((cs - whole) * 10);
  return `${formatCs(whole)}${frac}`;
}

// Tolker manuell tid. Godtar f.eks. "12,34", "12.34", "12", "1:15,2", "01:15,20", "1:00:05,5".
// Returnerer cs (heltall) eller null hvis ugyldig.
export function parseTimeToCs(input) {
  const s = String(input ?? '').trim().replace(/\s+/g, '');
  if (!s) return null;
  const m = /^(?:(?:(\d{1,2}):)?(\d{1,3}):)?(\d{1,5})(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const [, hRaw, minRaw, secRaw, fracRaw] = m;
  const hours = hRaw ? Number(hRaw) : 0;
  const minutes = minRaw ? Number(minRaw) : 0;
  const seconds = Number(secRaw);
  if (minRaw !== undefined && seconds >= 60) return null;
  if (hRaw !== undefined && minutes >= 60) return null;
  const hundredths = fracRaw === undefined ? 0 : (fracRaw.length === 1 ? Number(fracRaw) * 10 : Number(fracRaw));
  const cs = ((hours * 60 + minutes) * 60 + seconds) * 100 + hundredths;
  if (cs <= 0) return null;
  if (cs > 24 * 3600 * 100) return null;
  return cs;
}

// "2026-10-21T14:30:05.123Z" -> "21.10.2026 16:30:05" (lokal tid)
export function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Filnavn for backup: TROX_VVS2026_2026-10-21_1430.xlsx (lokal tid)
export function backupFilename(date = new Date(), { withSeconds = false, suffix = '' } = {}) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${withSeconds ? p(date.getSeconds()) : ''}`;
  return `TROX_VVS2026_${stamp}${suffix}.xlsx`;
}
