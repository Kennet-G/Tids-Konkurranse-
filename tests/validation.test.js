import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEmail, isValidPhone, isValidName, validateRegistration, isValidParticipantId, normalizeContact } from '../app/core/validation.js';

const ok = { firstName: 'Ola', lastName: 'Nordmann', company: 'Rørlegger AS', email: 'ola@firma.no', phone: '', consent: true };

test('gyldige e-postadresser godtas', () => {
  for (const e of ['ola@firma.no', 'ola.nordmann+vvs@sub.firma.com', 'Kari_Øy@trox.no', ' ola@firma.no ']) assert.ok(isValidEmail(e), e);
});

test('ugyldige e-postadresser avvises', () => {
  for (const e of ['', 'ola', 'ola@', '@firma.no', 'ola@firma', 'ola@@firma.no', 'ola firma@x.no', 'ola@firma..no', 'ola@.firma.no', '.ola@firma.no', 'ola@firma.n', 'ola@-firma.no'])
    assert.equal(isValidEmail(e), false, e);
});

test('telefon er valgfritt men valideres hvis utfylt', () => {
  assert.ok(isValidPhone(''));
  assert.ok(isValidPhone('   '));
  assert.ok(isValidPhone('+47 912 34 567'));
  assert.ok(isValidPhone('91234567'));
  assert.equal(isValidPhone('1234'), false);
  assert.equal(isValidPhone('ring meg'), false);
});

test('navn må inneholde bokstaver', () => {
  assert.ok(isValidName('Åse'));
  assert.equal(isValidName('   '), false);
  assert.equal(isValidName('123'), false);
});

test('komplett skjema er gyldig', () => {
  assert.deepEqual(validateRegistration(ok), { valid: true, errors: {} });
});

test('hvert påkrevd felt gir feil når det mangler', () => {
  for (const f of ['firstName', 'lastName', 'company', 'email']) {
    const r = validateRegistration({ ...ok, [f]: '' });
    assert.equal(r.valid, false);
    assert.ok(r.errors[f], f);
  }
});

test('samtykke er påkrevd (GDPR)', () => {
  assert.equal(validateRegistration({ ...ok, consent: false }).errors.consent, 'Samtykke er påkrevd');
  assert.equal(validateRegistration({ ...ok, consent: 'true' }).valid, false, 'kun boolsk true godtas');
  assert.equal(validateRegistration({ ...ok, consent: false }, { requireConsent: false }).valid, true);
});

test('ugyldig e-post og telefon gir feilmelding', () => {
  const r = validateRegistration({ ...ok, email: 'feil', phone: 'abc' });
  assert.equal(r.errors.email, 'Ugyldig e-postadresse');
  assert.equal(r.errors.phone, 'Ugyldig telefonnummer');
});

test('normalisering trimmer og slår sammen mellomrom', () => {
  assert.deepEqual(normalizeContact({ firstName: '  Ola  Jakob ', lastName: 'Nordmann', company: ' A  AS', email: ' ola@a.no ', phone: ' ' }),
    { firstName: 'Ola Jakob', lastName: 'Nordmann', company: 'A AS', email: 'ola@a.no', phone: '' });
});

test('deltaker-ID: rå tekst godtas, tom avvises', () => {
  assert.ok(isValidParticipantId('VVS2026-000123'));
  assert.ok(isValidParticipantId(' 00123 '));
  assert.equal(isValidParticipantId(''), false);
  assert.equal(isValidParticipantId('   '), false);
  assert.equal(isValidParticipantId(123), false);
});
