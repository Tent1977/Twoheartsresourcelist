'use strict';
const { Predictor, PRIOR_TRANSITIONS } = require('../../src/sightline/Prediction');
const { analyzeTurn } = require('../../src/sightline/Rhetoric');

const feed = (p, turns) => { turns.forEach((t, i) => p.observeTurn(analyzeTurn({ id: `t${i}`, speaker: t[0], text: t[1] }))); return p; };

describe('Predictor.nextSentence', () => {
  test('falls back to priors before anything has been heard', () => {
    const out = new Predictor().nextSentence();
    expect(out.basis).toBe('priors only');
    expect(out.reliable).toBe(false);
    expect(out.samples).toBe(0);
  });

  test('probabilities are ranked, and the visible slice never exceeds 1', () => {
    // nextSentence returns the top 5 of a normalised distribution, so a row
    // with more than five outcomes legitimately sums to less than 1.
    const out = new Predictor().nextSentence('question');
    const sum = out.predictions.reduce((a, p) => a + p.probability, 0);
    expect(sum).toBeLessThanOrEqual(1.001);
    expect(sum).toBeGreaterThan(0.8);
    expect(out.predictions[0].probability).toBeGreaterThanOrEqual(out.predictions[1].probability);
  });

  test('a distribution with five or fewer outcomes sums to one', () => {
    const out = new Predictor().nextSentence('decision');
    expect(out.predictions.reduce((a, p) => a + p.probability, 0)).toBeCloseTo(1, 1);
  });

  test('returns at most five candidates', () => {
    expect(new Predictor().nextSentence('statement').predictions.length).toBeLessThanOrEqual(5);
  });

  test('an unseen move falls back to the statement priors', () => {
    expect(new Predictor().nextSentence('nonsense-move').from).toBe('nonsense-move');
    expect(new Predictor().nextSentence('nonsense-move').predictions.length).toBeGreaterThan(0);
  });

  test('observation shifts the distribution toward what actually happened', () => {
    const p = new Predictor();
    const before = p.nextSentence('question').predictions.find((x) => x.move === 'objection');
    for (let i = 0; i < 6; i += 1) {
      p.observeTurn(analyzeTurn({ id: `q${i}`, speaker: '0', text: 'Is that right? I disagree, that will not work.' }));
    }
    const after = p.nextSentence('question').predictions.find((x) => x.move === 'objection');
    expect(after.probability).toBeGreaterThan(before ? before.probability : 0);
  });

  test('becomes reliable once enough transitions are observed', () => {
    const p = new Predictor();
    for (let i = 0; i < 12; i += 1) {
      p.observeTurn(analyzeTurn({ id: `t${i}`, speaker: '0', text: 'We counted 30 beds. I will follow up. Next item.' }));
    }
    const out = p.nextSentence();
    expect(out.reliable).toBe(true);
    expect(out.basis).toBe('this meeting');
  });

  test('every prior row is itself a normalised distribution', () => {
    Object.entries(PRIOR_TRANSITIONS).forEach(([, row]) => {
      const sum = Object.values(row).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 1);
    });
  });
});

describe('Predictor.nextTopic', () => {
  test('says so when there is not enough to go on', () => {
    expect(new Predictor().nextTopic().reliable).toBe(false);
    expect(new Predictor().nextTopic().predictions).toEqual([]);
  });

  test('surfaces recurring terms as momentum', () => {
    const p = feed(new Predictor(), [
      ['0', 'The fairgrounds lot is the option.'],
      ['1', 'Fairgrounds parking needs lighting.'],
      ['0', 'Fairgrounds again, lighting again.'],
      ['1', 'Lighting at the fairgrounds costs money.'],
    ]);
    const out = p.nextTopic();
    expect(out.predictions[0].topic).toMatch(/fairgrounds/);
    expect(out.reliable).toBe(true);
  });

  test('an unanswered question pulls the conversation back', () => {
    const p = feed(new Predictor(), [['1', 'How many WASH units do we need?']]);
    expect(p.openThreadList()).toHaveLength(1);
    expect(p.nextTopic().predictions.some((x) => x.topic.startsWith('unanswered:'))).toBe(true);
  });

  test('an unanswered request counts as an open thread', () => {
    const p = feed(new Predictor(), [['1', 'Can you send me the site plan?']]);
    expect(p.openThreadList()).toHaveLength(1);
  });

  test('a substantive answer closes the oldest thread', () => {
    const p = feed(new Predictor(), [
      ['1', 'How many WASH units do we need?'],
      ['0', 'We counted 4 units in the last plan.'],
    ]);
    expect(p.openThreadList()).toHaveLength(0);
  });

  test('agenda items carry their own gravity', () => {
    const p = feed(new Predictor(), [['0', 'Some words about the lot.']]);
    const out = p.nextTopic(['mayor briefing', 'fiscal sponsorship', 'ignored third item']);
    const topics = out.predictions.map((x) => x.topic);
    expect(topics).toContain('agenda: mayor briefing');
    expect(topics).not.toContain('agenda: ignored third item');
  });

  test('topic probabilities are normalised and capped at four', () => {
    const p = feed(new Predictor(), [
      ['1', 'How many units?'], ['1', 'And how much money?'], ['1', 'And when?'], ['0', 'Fairgrounds fairgrounds.'],
    ]);
    const out = p.nextTopic(['a', 'b']);
    expect(out.predictions.length).toBeLessThanOrEqual(4);
    expect(out.predictions.reduce((a, x) => a + x.probability, 0)).toBeLessThanOrEqual(1.001);
  });

  test('every prediction explains itself', () => {
    const p = feed(new Predictor(), [['1', 'How many units?'], ['0', 'Fairgrounds.']]);
    p.nextTopic(['agenda item']).predictions.forEach((x) => expect(x.why).toEqual(expect.any(String)));
  });
});

describe('Predictor.keywords', () => {
  test('drops stopwords and short words, ranked by frequency', () => {
    expect(Predictor.keywords('the parking parking lot is at the fairgrounds')).toEqual(['parking', 'fairgrounds']);
  });

  test('respects the limit and handles empty input', () => {
    expect(Predictor.keywords('alpha beta gamma delta epsilon zeta eta', 3)).toHaveLength(3);
    expect(Predictor.keywords('')).toEqual([]);
  });
});
