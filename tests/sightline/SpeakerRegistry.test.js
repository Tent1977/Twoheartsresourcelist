'use strict';
const { Workspace } = require('../../src/sightline/Workspace');
const { ConsentLedger } = require('../../src/sightline/Consent');
const { SpeakerRegistry, RANKS } = require('../../src/sightline/SpeakerRegistry');

const build = ({ consent = true } = {}) => {
  const workspace = new Workspace('ABLE');
  const ledger = consent ? new ConsentLedger({ jurisdiction: 'NV', workspace: 'ABLE' }) : null;
  return { registry: new SpeakerRegistry({ workspace, consent: ledger }), ledger };
};

describe('SpeakerRegistry', () => {
  test('requires a workspace', () => {
    expect(() => new SpeakerRegistry({})).toThrow(/requires a workspace/);
  });

  test('upsert creates then merges, stamping the workspace', () => {
    const { registry } = build();
    registry.upsert('ben', { displayName: 'Ben Castro' });
    const p = registry.upsert('ben', { org: 'RISE' });
    expect(p).toMatchObject({ displayName: 'Ben Castro', org: 'RISE', workspace: 'ABLE' });
    expect(registry.get('ben').rank).toBe('unknown');
  });

  test('unknown people and unknown ranks are handled', () => {
    const { registry } = build();
    expect(registry.get('ghost')).toBeNull();
    expect(() => registry.upsert('x', { rank: 'emperor' })).toThrow(/Unknown rank/);
  });

  test('list is ordered by rank tier, highest first', () => {
    const { registry } = build();
    registry.upsert('a', { rank: 'staff' });
    registry.upsert('b', { rank: 'executive' });
    registry.upsert('c', { rank: 'peer' });
    expect(registry.list().map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  test('badge carries a color and says where the rank came from', () => {
    const { registry } = build();
    registry.upsert('a', { rank: 'executive', rankSource: 'user' });
    expect(registry.badge('a')).toMatchObject({ rank: 'executive', color: RANKS.executive.color, confident: true, source: 'user' });
    expect(registry.badge('ghost')).toMatchObject({ rank: 'unknown', confident: false });
  });

  test('every rank has a distinct color', () => {
    const colors = Object.values(RANKS).map((r) => r.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  describe('biometrics', () => {
    test('refused with no consent ledger attached at all', () => {
      const { registry } = build({ consent: false });
      expect(registry.enrollBiometric('ben', 'face', [1, 2]).enrolled).toBe(false);
    });

    test('refused without recorded consent', () => {
      const { registry } = build();
      const res = registry.enrollBiometric('ben', 'face', [1, 2]);
      expect(res.enrolled).toBe(false);
      expect(res.reason).toMatch(/No face biometric consent/);
    });

    test('allowed with consent, and stores no raw media', () => {
      const { registry, ledger } = build();
      ledger.record('ben', { biometricFace: true });
      expect(registry.enrollBiometric('ben', 'face', [1, 2, 3]).enrolled).toBe(true);
      const tpl = registry.get('ben').faceprint;
      expect(tpl.vector).toEqual([1, 2, 3]);
      expect(tpl).not.toHaveProperty('image');
      expect(tpl).not.toHaveProperty('audio');
    });

    test('an empty vector is rejected', () => {
      const { registry } = build();
      expect(() => registry.enrollBiometric('ben', 'face', [])).toThrow(/vector required/);
    });

    test('forgetBiometrics clears both templates', () => {
      const { registry, ledger } = build();
      ledger.record('ben', { biometricFace: true, biometricVoice: true });
      registry.enrollBiometric('ben', 'face', [1, 2, 3]);
      registry.enrollBiometric('ben', 'voice', [4, 5, 6]);
      expect(registry.forgetBiometrics('ben')).toBe(true);
      expect(registry.get('ben').faceprint).toBeNull();
      expect(registry.get('ben').voiceprint).toBeNull();
      expect(registry.forgetBiometrics('ghost')).toBe(false);
    });

    test('match returns the enrolled person above threshold', () => {
      const { registry, ledger } = build();
      ledger.record('ben', { biometricVoice: true });
      registry.upsert('ben', { displayName: 'Ben Castro' });
      registry.enrollBiometric('ben', 'voice', [1, 0, 0]);
      expect(registry.match('voice', [0.98, 0.05, 0])).toMatchObject({ id: 'ben', displayName: 'Ben Castro' });
    });

    test('match returns null rather than guessing below threshold', () => {
      const { registry, ledger } = build();
      ledger.record('ben', { biometricVoice: true });
      registry.enrollBiometric('ben', 'voice', [1, 0, 0]);
      expect(registry.match('voice', [0, 1, 0])).toBeNull();
      expect(registry.match('face', [1, 0, 0])).toBeNull();
    });

    test('cosine handles zero vectors and unequal lengths', () => {
      expect(SpeakerRegistry.cosine([0, 0], [1, 1])).toBe(0);
      expect(SpeakerRegistry.cosine([1, 0, 9], [1, 0])).toBeCloseTo(1);
    });
  });

  describe('introduction detection', () => {
    test.each([
      ["Hi, I'm Ben with RISE.", 'Ben', 'RISE'],
      ['This is Catrina Peters, from Washoe County.', 'Catrina Peters', 'Washoe County'],
      ['My name is Susan Clark', 'Susan Clark', null],
      ["I'm Lawrence Dodson", 'Lawrence Dodson', null],
    ])('parses %s', (text, name, org) => {
      expect(SpeakerRegistry.detectIntroduction(text)).toEqual({ displayName: name, org });
    });

    test('returns null when nobody introduced themselves', () => {
      expect(SpeakerRegistry.detectIntroduction('we should move on')).toBeNull();
      expect(SpeakerRegistry.detectIntroduction('')).toBeNull();
    });
  });

  describe('authority inference', () => {
    test('never uses demeanor — only what was claimed', () => {
      const { registry } = build();
      registry.upsert('ben', {});
      const out = registry.inferAuthority('ben', ['I can approve that today.']);
      expect(out.rank).toBe('executive');
      expect(out.evidence[0].quote).toBe('I can approve that today.');
      expect(out.note).toMatch(/not from demeanor/);
    });

    test('reports nothing when no signals are present', () => {
      const { registry } = build();
      const out = registry.inferAuthority('x', ['the weather is fine']);
      expect(out.rank).toBeNull();
      expect(out.confidence).toBe(0);
    });

    test('lived experience is recognised as its own standing', () => {
      const { registry } = build();
      registry.upsert('p', {});
      expect(registry.inferAuthority('p', ['When I was unsheltered we had nowhere to park.']).rank).toBe('peer');
    });

    test('deferring upward reads as staff', () => {
      const { registry } = build();
      registry.upsert('s', {});
      expect(registry.inferAuthority('s', ["I'll need to check with my supervisor."]).rank).toBe('staff');
    });

    test('a user-set rank is never overwritten by inference', () => {
      const { registry } = build();
      registry.upsert('ben', { rank: 'peer', rankSource: 'user' });
      registry.inferAuthority('ben', ['I can approve that today.']);
      expect(registry.get('ben').rank).toBe('peer');
    });

    test('inference does write when the rank was not user-set', () => {
      const { registry } = build();
      registry.upsert('ben', {});
      registry.inferAuthority('ben', ['My team will handle it.']);
      expect(registry.get('ben')).toMatchObject({ rank: 'manager', rankSource: 'inferred' });
    });

    test('confidence falls when signals disagree', () => {
      const { registry } = build();
      registry.upsert('m', {});
      const out = registry.inferAuthority('m', ['I can approve that.', 'When I was homeless it was worse.']);
      expect(out.confidence).toBeLessThan(1);
    });
  });
});
