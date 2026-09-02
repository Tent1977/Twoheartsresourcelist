/**
 * ToneMeter.js — a read on tone, shown as an emoji, hedged honestly.
 *
 * Scores three axes from lexical and prosodic cues:
 *   valence   (-1 hostile  .. +1 warm)
 *   arousal   ( 0 flat     ..  1 heated)
 *   dominance ( 0 yielding ..  1 asserting)
 *
 * Text alone is a weak tone signal. When the ASR supplies prosody (pitch
 * variance, loudness, speech rate) we blend it in and confidence rises. Below
 * the confidence floor the meter shows a neutral face rather than guessing — a
 * wrong "she is angry" badge in a partner meeting is worse than no badge.
 */

'use strict';

const LEX = {
  warm:        { re: /\b(?:thank(?:s| you)|appreciate|great|wonderful|love (?:that|this)|glad|excited|grateful|perfect)\b/gi, v: 0.7,  a: 0.4,  d: 0.4 },
  hostile:     { re: /\b(?:ridiculous|unacceptable|nonsense|garbage|waste of|incompetent|never again|absolutely not)\b/gi,    v: -0.85, a: 0.75, d: 0.8 },
  frustrated:  { re: /\b(?:again|still|how many times|i already (?:said|told)|we keep|every time|seriously)\b/gi,              v: -0.5,  a: 0.65, d: 0.6 },
  anxious:     { re: /\b(?:worried|concerned|nervous|afraid|at risk|if we don'?t|what happens if|scared)\b/gi,                v: -0.35, a: 0.6,  d: 0.25 },
  resentful:   { re: /\b(?:they got|must be nice|of course they|we never get|meanwhile we|unlike (?:us|some))\b/gi,           v: -0.55, a: 0.45, d: 0.35 },
  discouraged: { re: /\b(?:give up|no point|nothing changes|same as always|why bother|tired of)\b/gi,                         v: -0.6,  a: 0.2,  d: 0.2 },
  skeptical:   { re: /\b(?:supposedly|allegedly|we'?ll see|says who|prove it|i doubt|hard to believe)\b/gi,                   v: -0.3,  a: 0.4,  d: 0.6 },
  asserting:   { re: /\b(?:i'?m telling you|the fact is|make no mistake|let me be clear|absolutely|definitely|non-?negotiable)\b/gi, v: 0.05, a: 0.6, d: 0.9 },
  yielding:    { re: /\b(?:whatever you think|up to you|i defer|your call|i'?m fine either way|if that'?s ok)\b/gi,           v: 0.15,  a: 0.2,  d: 0.05 },
};

// Ordered: first match wins. Keep this list short and legible.
const FACES = [
  { emoji: '\u{1F620}', label: 'angry',        test: (t) => t.valence < -0.45 && t.arousal > 0.55 },
  { emoji: '\u{1F61F}', label: 'anxious',      test: (t) => t.valence < 0 && t.arousal > 0.4 && t.dominance < 0.35 },
  { emoji: '\u{1F624}', label: 'frustrated',   test: (t) => t.valence < -0.25 && t.arousal > 0.45 },
  { emoji: '\u{1F614}', label: 'discouraged',  test: (t) => t.valence < -0.3 && t.arousal < 0.3 },
  { emoji: '\u{1F612}', label: 'resentful',    test: (t) => t.valence < -0.35 && t.dominance < 0.5 },
  { emoji: '\u{1F928}', label: 'skeptical',    test: (t) => t.valence < 0 && t.dominance > 0.5 },
  { emoji: '\u{1F600}', label: 'enthusiastic', test: (t) => t.valence > 0.45 && t.arousal > 0.45 },
  { emoji: '\u{1F642}', label: 'warm',         test: (t) => t.valence > 0.25 },
  { emoji: '\u{1F4AA}', label: 'assertive',    test: (t) => t.dominance > 0.7 },
  { emoji: '\u{1FAE1}', label: 'deferring',    test: (t) => t.dominance < 0.2 },
  { emoji: '\u{1F610}', label: 'neutral',      test: () => true },
];

const CONFIDENCE_FLOOR = 0.35;

/**
 * @param {string} text
 * @param {object} [prosody] {pitchVariance 0..1, loudness 0..1, rate 0..1}
 */
function read(text, prosody = null) {
  const s = String(text || '');
  let v = 0, a = 0, d = 0.4, hits = 0;
  const cues = [];

  for (const [name, def] of Object.entries(LEX)) {
    def.re.lastIndex = 0;
    const matches = s.match(def.re);
    if (!matches) continue;
    const n = Math.min(matches.length, 3);
    v += def.v * n; a += def.a * n; d += (def.d - 0.4) * n;
    hits += n;
    cues.push({ cue: name, matched: matches.slice(0, 3) });
  }

  // Typographic intensity: shouting and exclamation raise arousal.
  const shout = (s.match(/\b[A-Z]{3,}\b/g) || []).length;
  const bangs = (s.match(/!/g) || []).length;
  if (shout || bangs) {
    a += Math.min(0.5, (shout + bangs) * 0.15);
    hits += 1;
    cues.push({ cue: 'intensity', matched: [`${shout} caps, ${bangs} exclamation`] });
  }

  if (hits) { v /= hits; a /= hits; d = 0.4 + (d - 0.4) / hits; }

  let confidence = Math.min(0.75, 0.18 + hits * 0.16);

  if (prosody) {
    const loud = prosody.loudness == null ? 0.4 : prosody.loudness;
    const pitch = prosody.pitchVariance == null ? 0.4 : prosody.pitchVariance;
    const rate = prosody.rate == null ? 0.4 : prosody.rate;
    a = a * 0.55 + (0.5 * loud + 0.3 * pitch + 0.2 * rate) * 0.45;
    d = d * 0.7 + loud * 0.3;
    confidence = Math.min(0.9, confidence + 0.2);
  }

  const tone = {
    valence: Number(Math.max(-1, Math.min(1, v)).toFixed(2)),
    arousal: Number(Math.max(0, Math.min(1, a)).toFixed(2)),
    dominance: Number(Math.max(0, Math.min(1, d)).toFixed(2)),
  };

  const low = confidence < CONFIDENCE_FLOOR;
  const face = low
    ? { emoji: '\u{1F610}', label: 'unclear' }
    : FACES.find((f) => f.test(tone));

  return Object.assign({}, tone, {
    emoji: face.emoji,
    label: face.label,
    confidence: Number(confidence.toFixed(2)),
    lowConfidence: low,
    cues,
    caveat: `Tone read from words${prosody ? ' and voice' : ' only'}. A prompt to look up, not a verdict.`,
  });
}

/** Rolling tone for one speaker across their recent turns. */
function trend(readings, window = 5) {
  const recent = readings.slice(-window);
  if (!recent.length) return null;
  const avg = (k) => Number((recent.reduce((s, r) => s + r[k], 0) / recent.length).toFixed(2));
  const tone = { valence: avg('valence'), arousal: avg('arousal'), dominance: avg('dominance') };
  const face = FACES.find((f) => f.test(tone));
  const delta = recent[recent.length - 1].valence - recent[0].valence;
  return Object.assign({}, tone, {
    emoji: face.emoji,
    label: face.label,
    direction: delta > 0.15 ? 'warming' : delta < -0.15 ? 'cooling' : 'steady',
    samples: recent.length,
  });
}

module.exports = { read, trend, FACES, LEX, CONFIDENCE_FLOOR };
