'use strict';
const { Workspace } = require('../../src/sightline/Workspace');
const { Notebook, GUARDRAILS } = require('../../src/sightline/Notebook');
const { segment, classify } = require('../../src/sightline/Rhetoric');

const cardsFor = (nb, text) => segment(text).map(classify)
  .map((s) => nb.consider(s, { speaker: 'Lawrence' })).filter(Boolean);

const able = (opts = {}) => new Notebook(Object.assign({ workspace: new Workspace('ABLE') }, opts));

describe('Notebook', () => {
  test('requires a workspace', () => {
    expect(() => new Notebook({})).toThrow(/requires a workspace/);
  });

  test('stays quiet on an unremarkable sentence', () => {
    expect(cardsFor(able(), 'The lot is paved.')).toHaveLength(0);
  });

  test('ignores malformed input', () => {
    expect(able().consider(null)).toBeNull();
    expect(able().consider({})).toBeNull();
  });

  describe('ABLE positioning guardrails', () => {
    test.each([
      ['low-barrier', 'Our program is low-barrier, which is our selling point.'],
      ['authority-overreach', 'We will audit their intake policy.'],
      ['price-in-the-room', 'So what would this cost us for four sessions?'],
      ['title-inflation', 'As the founder of ABLE I can tell you.'],
      ['stale-name', 'LEAB reviewed that last year.'],
      ['client-roster', 'Our clients tell us the same thing.'],
      ['conflict-of-interest', 'I also work at Village on Sage Street.'],
    ])('fires the %s guardrail', (id, text) => {
      const card = cardsFor(able(), text)[0];
      expect(card.kind).toBe('guardrail');
      expect(card.id).toBe(`rail:${id}`);
      expect(card.suggested[0]).toEqual(expect.any(String));
      expect(card.avoid).toEqual(expect.any(String));
    });

    test('fires even inside a plain statement the playbook would ignore', () => {
      const plain = classify('Our program is low-barrier, which is our selling point.');
      expect(plain.notebookWorthy).toBe(false);
      expect(able().consider(plain)).not.toBeNull();
    });

    test('a guardrail outranks the generic playbook', () => {
      expect(cardsFor(able(), 'What would this cost?')[0].kind).toBe('guardrail');
    });

    test('the ABLE guardrails encode the facts that get gotten wrong', () => {
      const text = JSON.stringify(GUARDRAILS.ABLE);
      expect(text).toMatch(/founding member/);
      expect(text).toMatch(/Advisory Board of Lived Experience/);
      expect(text).toMatch(/does not enforce/);
    });

    test('VOA carries none of ABLE positioning', () => {
      const voa = new Notebook({ workspace: new Workspace('VOA') });
      expect(voa.guardrails).toEqual([]);
      expect(cardsFor(voa, 'As the founder of ABLE I can tell you.')).toHaveLength(0);
    });
  });

  describe('playbook cards', () => {
    test.each([
      ['According to the report there were 400 people.', 'A checkable claim just landed.'],
      ['Personally I think it is the wrong call.', 'That was a position, not a finding.'],
      ['What if we piloted it at the fairgrounds?', 'A proposal is on the table.'],
      ['Switching gears, the budget.', 'The subject just changed.'],
    ])('%s produces the right headline', (text, headline) => {
      expect(cardsFor(able(), text)[0].headline).toBe(headline);
    });

    test('cards carry lines a person could say out loud', () => {
      const card = cardsFor(able(), 'I disagree, that will not work.')[0];
      expect(card.suggested.length).toBeGreaterThan(0);
      card.suggested.forEach((line) => expect(line.length).toBeGreaterThan(5));
    });

    test('cards are stamped with the workspace they belong to', () => {
      expect(cardsFor(able(), 'What if we tried it?')[0].workspace).toBe('ABLE');
    });
  });

  describe('cooldown', () => {
    test('the same card does not fire twice in quick succession', () => {
      const nb = able();
      expect(cardsFor(nb, 'What if we tried the fairgrounds?')).toHaveLength(1);
      expect(cardsFor(nb, 'What if we tried the armory instead?')).toHaveLength(0);
    });

    test('it fires again once the cooldown lapses', () => {
      const state = { t: 0 };
      const nb = able({ now: () => state.t, cooldownMs: 1000 });
      expect(cardsFor(nb, 'What if we tried the fairgrounds?')).toHaveLength(1);
      state.t = 2000;
      expect(cardsFor(nb, 'What if we tried the armory?')).toHaveLength(1);
    });

    test('different triggers are not blocked by each other', () => {
      const nb = able();
      expect(cardsFor(nb, 'What if we tried the fairgrounds?')).toHaveLength(1);
      expect(cardsFor(nb, 'LEAB reviewed it.')).toHaveLength(1);
    });
  });

  test('recent returns newest first, capped', () => {
    const state = { t: 0 };
    const nb = able({ now: () => state.t, cooldownMs: 1 });
    ['LEAB reviewed it.', 'Our clients say so.', 'We will audit them.'].forEach((t) => {
      state.t += 10;
      cardsFor(nb, t);
    });
    const recent = nb.recent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].trigger).toMatch(/audit/);
  });
});

describe('Notebook explicit requests', () => {
  test('force bypasses the cooldown for a line the user clicked', () => {
    const nb = new Notebook({ workspace: new Workspace('ABLE') });
    const sentence = classify('What if we tried the fairgrounds?');
    expect(nb.consider(sentence)).not.toBeNull();
    expect(nb.consider(sentence)).toBeNull();
    expect(nb.consider(sentence, {}, { force: true })).not.toBeNull();
  });
});
