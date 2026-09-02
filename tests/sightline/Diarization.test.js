'use strict';
const { Diarizer, LOW_CONFIDENCE } = require('../../src/sightline/Diarization');

const w = (text, speaker, startMs, confidence = 0.95) =>
  ({ text, speaker, startMs, endMs: startMs + 150, confidence });

describe('Diarizer', () => {
  test('rejects a word with no text', () => {
    expect(() => new Diarizer().ingest({ speaker: 0 })).toThrow(/word.text is required/);
  });

  test('consecutive words from one speaker form a single turn', () => {
    const d = new Diarizer();
    d.ingestAll([w('we', 0, 0), w('need', 0, 200), w('beds', 0, 400)]);
    expect(d.turns).toHaveLength(1);
    expect(d.turns[0].text).toBe('we need beds');
  });

  test('a speaker change opens a new turn and closes the old one', () => {
    const d = new Diarizer();
    d.ingestAll([w('yes', 0, 0), w('no', 1, 200)]);
    expect(d.turns).toHaveLength(2);
    expect(d.turns[0].finalized).toBe(true);
    expect(d.turns[1].finalized).toBe(false);
  });

  test('a long silence splits one speaker into two turns', () => {
    const d = new Diarizer({ gapMs: 500 });
    d.ingestAll([w('first', 0, 0), w('second', 0, 5000)]);
    expect(d.turns).toHaveLength(2);
  });

  test('missing speaker tags become "unknown"', () => {
    const d = new Diarizer();
    d.ingest({ text: 'hello', startMs: 0, endMs: 100 });
    expect(d.turns[0].speaker).toBe('unknown');
    expect(d.nameFor('unknown')).toBe('Unidentified');
  });

  test('turn confidence is the mean of its words', () => {
    const d = new Diarizer();
    d.ingestAll([w('a', 0, 0, 0.4), w('b', 0, 200, 0.8)]);
    expect(d.turns[0].confidence).toBeCloseTo(0.6);
  });

  test('words with no confidence are treated as certain', () => {
    const d = new Diarizer();
    d.ingest({ text: 'a', speaker: 0, startMs: 0, endMs: 10 });
    expect(d.turns[0].confidence).toBe(1);
  });

  test('labelling renames every turn by that speaker at once', () => {
    const d = new Diarizer();
    d.ingestAll([w('hi', 0, 0), w('yes', 1, 2000), w('again', 0, 4000)]);
    d.label(0, 'Lawrence Dodson');
    const names = d.transcript().map((t) => t.speaker);
    expect(names).toEqual(['Lawrence Dodson', 'Speaker 1', 'Lawrence Dodson']);
  });

  test('unlabelled speakers fall back to a numbered name', () => {
    expect(new Diarizer().nameFor(3)).toBe('Speaker 3');
  });

  test('reassign is treated as ground truth', () => {
    const d = new Diarizer();
    d.ingestAll([w('mine', 0, 0, 0.3)]);
    const turn = d.reassign('t1', 2);
    expect(turn.speaker).toBe('2');
    expect(turn.confidence).toBe(1);
    expect(turn.humanCorrected).toBe(true);
    expect(d.uncertainTurns()).toHaveLength(0);
  });

  test('reassigning an unknown turn returns null', () => {
    expect(new Diarizer().reassign('nope', 1)).toBeNull();
  });

  test('split divides one turn into two at a word boundary', () => {
    const d = new Diarizer();
    d.ingestAll([w('one', 0, 0), w('two', 0, 200), w('three', 0, 400)]);
    const created = d.split('t1', 1);
    expect(d.turns).toHaveLength(2);
    expect(d.turns[0].text).toBe('one');
    expect(created.text).toBe('two three');
    expect(created.splitFrom).toBe('t1');
    expect(created.startMs).toBe(200);
  });

  test('split refuses out-of-range and unknown targets', () => {
    const d = new Diarizer();
    d.ingestAll([w('one', 0, 0), w('two', 0, 200)]);
    expect(d.split('t1', 0)).toBeNull();
    expect(d.split('t1', 2)).toBeNull();
    expect(d.split('nope', 1)).toBeNull();
  });

  test('mergeWithPrevious folds a turn into the one before it', () => {
    const d = new Diarizer();
    d.ingestAll([w('start', 0, 0), w('end', 1, 5000)]);
    const merged = d.mergeWithPrevious('t2');
    expect(d.turns).toHaveLength(1);
    expect(merged.text).toBe('start end');
    expect(merged.endMs).toBe(5150);
  });

  test('merging the first turn or an unknown turn returns null', () => {
    const d = new Diarizer();
    d.ingestAll([w('only', 0, 0)]);
    expect(d.mergeWithPrevious('t1')).toBeNull();
    expect(d.mergeWithPrevious('nope')).toBeNull();
  });

  test('uncertain turns are surfaced for review', () => {
    const d = new Diarizer();
    d.ingestAll([w('sure', 0, 0, 0.95), w('mumble', 1, 3000, 0.2)]);
    expect(d.uncertainTurns().map((t) => t.id)).toEqual(['t2']);
    expect(d.uncertainTurns(0.1)).toHaveLength(0);
    expect(LOW_CONFIDENCE).toBe(0.6);
  });

  test('talk time is totalled per speaker', () => {
    const d = new Diarizer();
    d.ingestAll([w('a', 0, 0), w('b', 1, 3000), w('c', 0, 6000)]);
    const talk = d.talkTime();
    expect(talk.get('0')).toBe(300);
    expect(talk.get('1')).toBe(150);
  });

  test('transcript can return raw speaker indices', () => {
    const d = new Diarizer();
    d.ingest(w('hi', 0, 0));
    d.label(0, 'Ben');
    expect(d.transcript({ named: false })[0].speaker).toBe('0');
  });

  test('transcript marks low-confidence turns', () => {
    const d = new Diarizer();
    d.ingest(w('what', 0, 0, 0.2));
    expect(d.transcript()[0].uncertain).toBe(true);
  });
});
