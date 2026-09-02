'use strict';
const { read, trend, CONFIDENCE_FLOOR } = require('../../src/sightline/ToneMeter');

describe('ToneMeter.read', () => {
  test('bland text returns neutral and admits low confidence', () => {
    const r = read('ok');
    expect(r.lowConfidence).toBe(true);
    expect(r.label).toBe('unclear');
    expect(r.confidence).toBeLessThan(CONFIDENCE_FLOOR);
  });

  test.each([
    ['This is ridiculous, we have asked THREE TIMES!', 'frustrated'],
    ['Thanks, I really appreciate you pulling that together.', 'warm'],
    ['I am worried that if we do not act people are at risk.', 'anxious'],
    ['Must be nice. Of course they got theirs.', 'resentful'],
    ['No point, nothing changes, same as always.', 'discouraged'],
    ['Let me be clear, this is non-negotiable, absolutely.', 'assertive'],
    ['Your call, up to you, I am fine either way.', 'deferring'],
  ])('%s reads as %s', (text, label) => {
    expect(read(text).label).toBe(label);
  });

  test('axes stay in range', () => {
    const r = read('ridiculous unacceptable nonsense garbage waste of time!!!');
    expect(r.valence).toBeGreaterThanOrEqual(-1);
    expect(r.arousal).toBeLessThanOrEqual(1);
    expect(r.dominance).toBeGreaterThanOrEqual(0);
    expect(r.dominance).toBeLessThanOrEqual(1);
  });

  test('shouting and exclamation raise arousal', () => {
    expect(read('THIS IS FINE!!!').arousal).toBeGreaterThan(read('this is fine').arousal);
  });

  test('prosody raises confidence and is named in the caveat', () => {
    const plain = read('I appreciate that.');
    const withVoice = read('I appreciate that.', { loudness: 0.8, pitchVariance: 0.7, rate: 0.6 });
    expect(withVoice.confidence).toBeGreaterThan(plain.confidence);
    expect(withVoice.caveat).toMatch(/words and voice/);
    expect(plain.caveat).toMatch(/words only/);
  });

  test('missing prosody fields fall back to neutral values', () => {
    expect(() => read('hello', {})).not.toThrow();
  });

  test('every reading carries a caveat and its cues', () => {
    const r = read('This is ridiculous.');
    expect(r.caveat).toMatch(/not a verdict/);
    expect(r.cues.length).toBeGreaterThan(0);
  });

  test('repeat calls are stable — global regex state does not leak', () => {
    const text = 'Thanks, I appreciate it.';
    expect(read(text).label).toBe(read(text).label);
  });

  test('handles empty input', () => {
    expect(read('').label).toBe('unclear');
    expect(read(null).valence).toBe(0);
  });
});

describe('ToneMeter.trend', () => {
  test('returns null with no readings', () => {
    expect(trend([])).toBeNull();
  });

  test('detects warming', () => {
    const rs = [read('I am tired of this'), read('nothing changes'), read('thanks, this is great'), read('I appreciate it')];
    expect(trend(rs).direction).toBe('warming');
  });

  test('detects cooling', () => {
    const rs = [read('thanks, this is wonderful'), read('this is ridiculous and unacceptable')];
    expect(trend(rs).direction).toBe('cooling');
  });

  test('detects steady', () => {
    const rs = [read('ok'), read('sure')];
    expect(trend(rs).direction).toBe('steady');
  });

  test('respects the window and reports the sample count', () => {
    const rs = new Array(10).fill(null).map(() => read('ok'));
    expect(trend(rs, 3).samples).toBe(3);
  });
});
