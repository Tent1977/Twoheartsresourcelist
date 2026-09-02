'use strict';
const { segment, classify, analyzeTurn, MOVES } = require('../../src/sightline/Rhetoric');

describe('segment', () => {
  test('splits on sentence terminators', () => {
    expect(segment('One. Two? Three!')).toEqual(['One.', 'Two?', 'Three!']);
  });

  test('does not split on abbreviations or decimals', () => {
    expect(segment('Dr. Grigsby said 3.5 percent. Is that right?'))
      .toEqual(['Dr. Grigsby said 3.5 percent.', 'Is that right?']);
  });

  test('handles empty and unterminated input', () => {
    expect(segment('')).toEqual([]);
    expect(segment(null)).toEqual([]);
    expect(segment('no terminator')).toEqual(['no terminator']);
  });
});

describe('classify', () => {
  test.each([
    ['How many beds do we have?', 'question'],
    ['I will send the draft by Friday.', 'commitment'],
    ['We have decided to move forward.', 'decision'],
    ['I disagree, that will not work.', 'objection'],
    ['Fair point, you are right about that.', 'concession'],
    ['That is a different conversation.', 'deflection'],
    ['We counted 1600 people.', 'data-point'],
    ['Can you send me the file?', 'request'],
    ['Next item on the agenda.', 'procedural'],
    ['When I was unsheltered I parked behind the church.', 'anecdote'],
    ['Maybe we could look at it.', 'hedge'],
    ['The lot is paved.', 'statement'],
  ])('%s reads as a %s', (text, move) => {
    expect(classify(text).move).toBe(move);
  });

  test.each([
    ['According to the report, 40 percent were turned away.', 'fact'],
    ['Personally I think it is the wrong call.', 'opinion'],
    ['What if we piloted it at the fairgrounds?', 'idea'],
    ['Switching gears, the budget.', 'subject-shift'],
    ['The lot is paved.', 'assertion'],
  ])('%s is epistemically %s', (text, epistemic) => {
    expect(classify(text).epistemic).toBe(epistemic);
  });

  test('confidence is bounded and non-zero', () => {
    const c = classify('The lot is paved.');
    expect(c.confidence).toBeGreaterThan(0);
    expect(c.confidence).toBeLessThanOrEqual(0.98);
  });

  test('competing cues are kept as alternates', () => {
    const c = classify('Can you send me the file by Friday?');
    expect(c.alternates.length).toBeGreaterThan(0);
  });

  test('marks what the notebook may interrupt for', () => {
    expect(classify('What if we tried the fairgrounds?').notebookWorthy).toBe(true);
    expect(classify('The lot is paved.').notebookWorthy).toBe(false);
  });

  test('counts words and survives empty input', () => {
    expect(classify('one two three').wordCount).toBe(3);
    expect(classify('').wordCount).toBe(0);
    expect(classify(null).move).toBe('statement');
  });

  test('every move rule is reachable and uniquely named', () => {
    const names = MOVES.map((m) => m.move);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('analyzeTurn', () => {
  test('breaks a turn into classified sentences', () => {
    const out = analyzeTurn({ id: 't1', speaker: '0', text: 'We counted 30 beds. Can you confirm?' });
    expect(out.turnId).toBe('t1');
    expect(out.sentences).toHaveLength(2);
    expect(out.hasQuestion).toBe(true);
  });

  test('detects commitments and decisions in a turn', () => {
    expect(analyzeTurn({ id: 't1', speaker: '0', text: 'I will do it.' }).hasCommitment).toBe(true);
    expect(analyzeTurn({ id: 't2', speaker: '0', text: 'The lot is paved.' }).hasCommitment).toBe(false);
  });

  test('an empty turn degrades to a plain statement', () => {
    const out = analyzeTurn({ id: 't1', speaker: '0', text: '' });
    expect(out.sentences).toEqual([]);
    expect(out.dominantMove).toBe('statement');
    expect(out.hasQuestion).toBe(false);
  });
});
