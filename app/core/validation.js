// Validering av registreringsskjema. Ren logikk uten DOM – testes i /tests.

const EMAIL_RE = /^[^\s@"<>(),;:\\[\]]+@[^\s@"<>(),;:\\[\]]+\.[a-zA-Z]{2,}$/;

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function isValidEmail(email) {
  const e = String(email ?? '').trim();
  if (e.length < 6 || e.length > 254) return false;
  if (!EMAIL_RE.test(e)) return false;
  const [local, domain] = e.split('@');
  if (local.length > 64) return false;
  if (domain.startsWith('.') || domain.includes('..') || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (domain.split('.').some((part) => part.length === 0 || part.startsWith('-') || part.endsWith('-'))) return false;
  return true;
}

export function isValidName(name) {
  const n = String(name ?? '').trim();
  return n.length >= 1 && n.length <= 100 && /\p{L}/u.test(n);
}

export function isValidCompany(company) {
  const c = String(company ?? '').trim();
  return c.length >= 1 && c.length <= 150;
}

// Telefon er valgfritt. Hvis utfylt: 8–15 sifre, tillater +, mellomrom, bindestrek og parentes.
export function isValidPhone(phone) {
  const p = String(phone ?? '').trim();
  if (p === '') return true;
  if (!/^\+?[\d\s\-()]+$/.test(p)) return false;
  const digits = p.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

export function normalizeContact(form) {
  return {
    firstName: String(form.firstName ?? '').trim().replace(/\s+/g, ' '),
    lastName: String(form.lastName ?? '').trim().replace(/\s+/g, ' '),
    company: String(form.company ?? '').trim().replace(/\s+/g, ' '),
    email: String(form.email ?? '').trim(),
    phone: String(form.phone ?? '').trim(),
  };
}

// Returnerer { valid, errors } der errors er et objekt felt -> melding (norsk).
export function validateRegistration(form, { requireConsent = true } = {}) {
  const errors = {};
  if (!isValidName(form.firstName)) errors.firstName = 'Fyll inn fornavn';
  if (!isValidName(form.lastName)) errors.lastName = 'Fyll inn etternavn';
  if (!isValidCompany(form.company)) errors.company = 'Fyll inn firma';
  if (!String(form.email ?? '').trim()) errors.email = 'Fyll inn e-post';
  else if (!isValidEmail(form.email)) errors.email = 'Ugyldig e-postadresse';
  if (!isValidPhone(form.phone)) errors.phone = 'Ugyldig telefonnummer';
  if (requireConsent && form.consent !== true) errors.consent = 'Samtykke er påkrevd';
  return { valid: Object.keys(errors).length === 0, errors };
}

// Deltaker-ID er råteksten fra QR-koden og lagres uendret.
// Kun helt tomme/blanke ID-er avvises.
export function isValidParticipantId(id) {
  return typeof id === 'string' && id.trim().length > 0 && id.length <= 512;
}
