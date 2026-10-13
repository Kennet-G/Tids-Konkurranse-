// PIN lagres aldri i klartekst – kun salt + PBKDF2-hash.

const ITERATIONS = 100000;

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isValidPinFormat(pin) {
  return /^\d{4}$/.test(String(pin ?? ''));
}

async function derive(pin, saltHex, iterations) {
  const enc = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(bits);
}

export async function hashPin(pin) {
  if (!isValidPinFormat(pin)) throw new Error('PIN må være 4 sifre');
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, iterations: ITERATIONS, hash: await derive(pin, salt, ITERATIONS) };
}

export async function verifyPin(pin, record) {
  if (!record || !record.salt || !record.hash) return false;
  if (!isValidPinFormat(pin)) return false;
  const h = await derive(pin, record.salt, record.iterations ?? ITERATIONS);
  // konstant-tid sammenligning
  let diff = h.length ^ record.hash.length;
  for (let i = 0; i < Math.min(h.length, record.hash.length); i++) diff |= h.charCodeAt(i) ^ record.hash.charCodeAt(i);
  return diff === 0;
}
