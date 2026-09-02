'use strict';
const { ConsentLedger, ALL_PARTY_STATES } = require('../../src/sightline/Consent');

const nv = () => new ConsentLedger({ jurisdiction: 'NV', workspace: 'ABLE' });

describe('ConsentLedger', () => {
  test('requires a jurisdiction', () => {
    expect(() => new ConsentLedger({})).toThrow(/jurisdiction is required/);
  });

  test('Nevada is treated as all-party', () => {
    expect(ALL_PARTY_STATES).toContain('NV');
    expect(nv().allPartyRequired).toBe(true);
  });

  test('a one-party state is not all-party', () => {
    expect(new ConsentLedger({ jurisdiction: 'NY' }).allPartyRequired).toBe(false);
  });

  test('lowercase jurisdictions are normalised', () => {
    expect(new ConsentLedger({ jurisdiction: 'nv' }).jurisdiction).toBe('NV');
  });

  test('blocks recording until every party consents in an all-party state', () => {
    const c = nv();
    c.record('a', { recording: true });
    const gate = c.canRecord(['a', 'b']);
    expect(gate.allowed).toBe(false);
    expect(gate.missing).toEqual(['b']);
    expect(gate.basis).toMatch(/NRS 200.620/);
  });

  test('allows recording once every party consents', () => {
    const c = nv();
    c.record('a', { recording: true });
    c.record('b', { recording: true });
    expect(c.canRecord(['a', 'b']).allowed).toBe(true);
  });

  test('one-party state still needs at least one consenting party', () => {
    const c = new ConsentLedger({ jurisdiction: 'NY' });
    expect(c.canRecord(['a', 'b']).allowed).toBe(false);
    c.record('a', { recording: true });
    expect(c.canRecord(['a', 'b']).allowed).toBe(true);
  });

  test('empty participant list is permitted', () => {
    expect(new ConsentLedger({ jurisdiction: 'NY' }).canRecord([]).allowed).toBe(true);
  });

  test('client data forces all-party consent even in a one-party state', () => {
    const c = new ConsentLedger({ jurisdiction: 'NY', clientData: true });
    c.record('a', { recording: true });
    const gate = c.canRecord(['a', 'b']);
    expect(gate.allowed).toBe(false);
    expect(gate.basis).toMatch(/coordinated entry/i);
  });

  test('withdrawal revokes every grant and is timestamped', () => {
    const c = nv();
    c.record('a', { recording: true, biometricVoice: true });
    expect(c.withdraw('a')).toBe(true);
    expect(c.get('a').recording).toBe(false);
    expect(c.get('a').biometricVoice).toBe(false);
    expect(c.get('a').withdrawnAt).toEqual(expect.any(Number));
  });

  test('withdrawing an unknown participant reports false', () => {
    expect(nv().withdraw('ghost')).toBe(false);
  });

  test('record requires a participant id', () => {
    expect(() => nv().record()).toThrow(/participantId is required/);
  });

  test('biometrics are refused without explicit consent', () => {
    const c = nv();
    c.record('a', { recording: true });
    expect(c.canUseBiometric('a', 'face').allowed).toBe(false);
    expect(c.canUseBiometric('a', 'voice').allowed).toBe(false);
  });

  test('biometrics allowed once granted', () => {
    const c = nv();
    c.record('a', { biometricFace: true, biometricVoice: true });
    expect(c.canUseBiometric('a', 'face').allowed).toBe(true);
    expect(c.canUseBiometric('a', 'voice').allowed).toBe(true);
  });

  test('Illinois requires a written release, not a verbal yes', () => {
    const c = new ConsentLedger({ jurisdiction: 'IL' });
    c.record('a', { biometricFace: true, method: 'verbal-on-record' });
    const verbal = c.canUseBiometric('a', 'face');
    expect(verbal.allowed).toBe(false);
    expect(verbal.statute).toBe('BIPA');

    c.record('a', { biometricFace: true, method: 'written-release' });
    expect(c.canUseBiometric('a', 'face').allowed).toBe(true);
  });

  test('names the biometric statute for the jurisdiction', () => {
    expect(new ConsentLedger({ jurisdiction: 'TX' }).biometricStatute).toBe('CUBI');
    expect(new ConsentLedger({ jurisdiction: 'NV' }).biometricStatute).toBe('NRS603A');
    expect(new ConsentLedger({ jurisdiction: 'OR' }).biometricStatute).toBeNull();
  });

  test('disclosure script names the state requirement and the two-hour wipe', () => {
    const lines = nv().script('Lawrence').join(' ');
    expect(lines).toMatch(/Lawrence/);
    expect(lines).toMatch(/NV law requires everyone's consent/);
    expect(lines).toMatch(/two hours/);
    expect(lines).toMatch(/withdraw/);
  });

  test('script adds the client-data line only when relevant', () => {
    const plain = nv().script().join(' ');
    const withClients = new ConsentLedger({ jurisdiction: 'NV', clientData: true }).script().join(' ');
    expect(plain).not.toMatch(/receiving services/);
    expect(withClients).toMatch(/receiving services/);
  });

  test('audit trail is complete enough to attach to minutes', () => {
    const c = nv();
    c.record('a', { recording: true });
    const audit = c.auditTrail();
    expect(audit).toMatchObject({ jurisdiction: 'NV', workspace: 'ABLE', allPartyRequired: true });
    expect(audit.participants).toHaveLength(1);
  });
});
