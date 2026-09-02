'use strict';
const { Redactor } = require('../../src/sightline/Redaction');

describe('Redactor', () => {
  test('leaves clean text alone', () => {
    const out = new Redactor().redact('We discussed the budget.');
    expect(out.clean).toBe(true);
    expect(out.text).toBe('We discussed the budget.');
  });

  test.each([
    ['ssn', 'SSN 123-45-6789 on file', '[SSN_1]'],
    ['dob', 'DOB 04/12/1988', '[DOB_1]'],
    ['phone', 'call 775-555-0134', '[PHONE_1]'],
    ['email', 'reach me at a.b@example.org', '[EMAIL_1]'],
    ['hmis', 'HMIS ID 88421', '[HMIS_ID_1]'],
    ['address', 'lives at 415 Record St', '[ADDRESS_1]'],
  ])('redacts %s', (kind, input, token) => {
    const out = new Redactor().redact(input);
    expect(out.text).toContain(token);
    expect(out.found.map((f) => f.kind)).toContain(kind);
    expect(out.clean).toBe(false);
  });

  test('numbers each occurrence separately', () => {
    const out = new Redactor().redact('call 775-555-0134 or 775-555-9999');
    expect(out.text).toContain('[PHONE_1]');
    expect(out.text).toContain('[PHONE_2]');
  });

  test('protected names become initials so the text stays readable', () => {
    const out = new Redactor({ protectedNames: ['Maria Gonzalez'] }).redact('Maria Gonzalez needs a bed.');
    expect(out.text).toBe('M.G. needs a bed.');
    expect(out.found.map((f) => f.kind)).toContain('name');
  });

  test('name matching is case-insensitive', () => {
    expect(new Redactor({ protectedNames: ['Maria Gonzalez'] }).redact('maria gonzalez called').text)
      .toBe('M.G. called');
  });

  test('names can be tokenised instead of initialised', () => {
    const out = new Redactor({ protectedNames: ['Maria Gonzalez'], initialsForNames: false }).redact('Maria Gonzalez');
    expect(out.text).toBe('[NAME_1]');
  });

  test('regex characters in a protected name are escaped', () => {
    expect(() => new Redactor({ protectedNames: ['A. (B)'] }).redact('A. (B) was here')).not.toThrow();
  });

  test('restore reverses redaction inside the session', () => {
    const r = new Redactor({ protectedNames: ['Maria Gonzalez'] });
    const original = 'Maria Gonzalez, 775-555-0134, maria@example.org';
    const out = r.redact(original);
    expect(r.restore(out.text)).toBe(original);
  });

  test('forget destroys the ability to restore', () => {
    const r = new Redactor();
    const out = r.redact('call 775-555-0134');
    r.forget();
    expect(r.restore(out.text)).toBe(out.text);
  });

  test('scan reports what is present without changing anything', () => {
    expect(Redactor.scan('call 775-555-0134 or email a@b.co')).toEqual(expect.arrayContaining(['phone', 'email']));
    expect(Redactor.scan('nothing here')).toEqual([]);
    expect(Redactor.scan(null)).toEqual([]);
  });

  test('scan is repeatable — global regex state does not leak', () => {
    const text = 'call 775-555-0134';
    expect(Redactor.scan(text)).toEqual(Redactor.scan(text));
  });

  test('handles null and undefined input', () => {
    expect(new Redactor().redact(null).text).toBe('');
    expect(new Redactor().restore(undefined)).toBe('');
  });
});
