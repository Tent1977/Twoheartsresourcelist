/**
 * Diarization.js — turn assembly and speaker attribution.
 *
 * Streaming ASR gives us words tagged with a provider speaker index
 * ("speaker 0", "speaker 1"). That index is stable within a session and
 * meaningless outside it. This module turns that stream into turns, lets a
 * human retroactively rename a whole speaker, and reports honestly how sure
 * it is — a low-confidence attribution is shown as low-confidence, never
 * laundered into a name.
 */

'use strict';

const DEFAULT_GAP_MS = 900;      // silence that ends a turn
const LOW_CONFIDENCE = 0.6;

class Diarizer {
  /**
   * @param {object} [opts]
   * @param {number} [opts.gapMs]  Silence threshold that closes a turn.
   */
  constructor({ gapMs = DEFAULT_GAP_MS } = {}) {
    this.gapMs = gapMs;
    this.turns = [];
    this.labels = new Map();   // provider index -> human name
    this.seq = 0;
  }

  /**
   * Feed one recognised word.
   * @param {object} word {text, speaker, startMs, endMs, confidence}
   * @returns {object} the turn it landed in
   */
  ingest(word) {
    if (!word || typeof word.text !== 'string') throw new Error('word.text is required');
    const speaker = word.speaker == null ? 'unknown' : String(word.speaker);
    const last = this.turns[this.turns.length - 1];

    const continues = last
      && last.speaker === speaker
      && (word.startMs - last.endMs) <= this.gapMs;

    if (continues) {
      last.words.push(word);
      last.endMs = word.endMs;
      last.text = `${last.text} ${word.text}`.trim();
      last.confidence = this._mean(last.words);
      return last;
    }

    const turn = {
      id: `t${++this.seq}`,
      speaker,
      words: [word],
      text: word.text,
      startMs: word.startMs,
      endMs: word.endMs,
      confidence: typeof word.confidence === 'number' ? word.confidence : 1,
      finalized: false,
    };
    if (last) last.finalized = true;
    this.turns.push(turn);
    return turn;
  }

  /** Bulk feed. */
  ingestAll(words) {
    words.forEach((w) => this.ingest(w));
    return this.turns;
  }

  /** Attach a real name to every turn by this provider speaker index. */
  label(speakerIndex, name) {
    this.labels.set(String(speakerIndex), name);
    return this.labels.size;
  }

  /** Human-facing name for a speaker index, or the raw index if unnamed. */
  nameFor(speakerIndex) {
    const key = String(speakerIndex);
    return this.labels.get(key) || (key === 'unknown' ? 'Unidentified' : `Speaker ${key}`);
  }

  /**
   * Reassign one turn to a different speaker. Human correction always wins and
   * is marked so downstream analysis knows it is ground truth.
   */
  reassign(turnId, speakerIndex) {
    const turn = this.turns.find((t) => t.id === turnId);
    if (!turn) return null;
    turn.speaker = String(speakerIndex);
    turn.confidence = 1;
    turn.humanCorrected = true;
    return turn;
  }

  /** Split a turn at a word offset — for when two people talk over each other. */
  split(turnId, wordIndex) {
    const idx = this.turns.findIndex((t) => t.id === turnId);
    if (idx === -1) return null;
    const turn = this.turns[idx];
    if (wordIndex <= 0 || wordIndex >= turn.words.length) return null;

    const tail = turn.words.splice(wordIndex);
    turn.text = turn.words.map((w) => w.text).join(' ');
    turn.endMs = turn.words[turn.words.length - 1].endMs;
    turn.confidence = this._mean(turn.words);

    const created = {
      id: `t${++this.seq}`,
      speaker: turn.speaker,
      words: tail,
      text: tail.map((w) => w.text).join(' '),
      startMs: tail[0].startMs,
      endMs: tail[tail.length - 1].endMs,
      confidence: this._mean(tail),
      finalized: turn.finalized,
      splitFrom: turn.id,
    };
    this.turns.splice(idx + 1, 0, created);
    return created;
  }

  /** Merge a turn into the one before it. */
  mergeWithPrevious(turnId) {
    const idx = this.turns.findIndex((t) => t.id === turnId);
    if (idx <= 0) return null;
    const prev = this.turns[idx - 1];
    const turn = this.turns[idx];
    prev.words = prev.words.concat(turn.words);
    prev.text = `${prev.text} ${turn.text}`.trim();
    prev.endMs = turn.endMs;
    prev.confidence = this._mean(prev.words);
    this.turns.splice(idx, 1);
    return prev;
  }

  /** Turns whose attribution the user should eyeball. */
  uncertainTurns(threshold = LOW_CONFIDENCE) {
    return this.turns.filter((t) => !t.humanCorrected && t.confidence < threshold);
  }

  /** Total speaking time per speaker index. */
  talkTime() {
    const out = new Map();
    for (const t of this.turns) {
      out.set(t.speaker, (out.get(t.speaker) || 0) + (t.endMs - t.startMs));
    }
    return out;
  }

  transcript({ named = true } = {}) {
    return this.turns.map((t) => ({
      id: t.id,
      speaker: named ? this.nameFor(t.speaker) : t.speaker,
      text: t.text,
      startMs: t.startMs,
      endMs: t.endMs,
      confidence: t.confidence,
      uncertain: !t.humanCorrected && t.confidence < LOW_CONFIDENCE,
    }));
  }

  _mean(words) {
    const vals = words.map((w) => (typeof w.confidence === 'number' ? w.confidence : 1));
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
}

module.exports = { Diarizer, DEFAULT_GAP_MS, LOW_CONFIDENCE };
