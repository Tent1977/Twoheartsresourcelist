'use strict';
const { VerificationLedger } = require('../../src/sightline/VerificationFlags');
const { segment, classify } = require('../../src/sightline/Rhetoric');

const run = (ledger, lines) => {
  lines.forEach(([speaker, text], i) => {
    segment(text).map(classify).forEach((s) => ledger.ingest(s, { speaker, turnId: `t${i}` }));
  });
  return ledger;
};

describe('VerificationLedger', () => {
  test('never labels anyone deceptive, and says so on every flag', () => {
    const l = run(new VerificationLedger(), [['Ben', 'We have 30 beds.'], ['Ben', 'We have 20 beds.']]);
    l.open().forEach((f) => {
      expect(f.disclaimer).toMatch(/not an accusation/);
      expect(JSON.stringify(f)).not.toMatch(/\blie|lying|deceptive|dishonest\b/i);
    });
  });

  test('catches a speaker contradicting their own figure', () => {
    const l = run(new VerificationLedger(), [
      ['Ben', 'We are proposing 30 parking spots at the fairgrounds.'],
      ['Ben', 'Honestly we are proposing 20 parking spots now.'],
    ]);
    const flag = l.open().find((f) => f.type === 'contradiction');
    expect(flag.severity).toBe('check');
    expect(flag.quotes).toHaveLength(2);
    expect(flag.suggestedFollowUp).toMatch(/30/);
  });

  test('does not flag two different speakers giving different numbers', () => {
    const l = run(new VerificationLedger(), [
      ['Ben', 'We have 30 spots.'],
      ['Catrina', 'We have 20 spots.'],
    ]);
    expect(l.open().some((f) => f.type === 'contradiction')).toBe(false);
  });

  test('catches a statement conflicting with a record on file', () => {
    const l = run(new VerificationLedger({ records: [{ subject: 'parking spots', value: 30, source: 'RISE site plan v2' }] }),
      [['Ben', 'We are proposing 20 parking spots.']]);
    const flag = l.open().find((f) => f.type === 'conflicts-with-record');
    expect(flag.record.source).toBe('RISE site plan v2');
    expect(flag.suggestedFollowUp).toMatch(/RISE site plan v2/);
  });

  test('does not flag a statement that agrees with the record', () => {
    const l = run(new VerificationLedger({ records: [{ subject: 'parking spots', value: 30, source: 'plan' }] }),
      [['Ben', 'We are proposing 30 parking spots.']]);
    expect(l.open().some((f) => f.type === 'conflicts-with-record')).toBe(false);
  });

  test('flags a bare number and clears once a source is cited', () => {
    const bare = run(new VerificationLedger(), [['Ben', 'There are 400 people out there.']]);
    expect(bare.open().some((f) => f.type === 'unsourced')).toBe(true);

    const cited = run(new VerificationLedger(), [['Ben', 'According to the PIT count there are 400 people out there.']]);
    expect(cited.open().some((f) => f.type === 'unsourced')).toBe(false);
  });

  test('flags a commitment with no date', () => {
    const l = run(new VerificationLedger(), [['Lawrence', 'I will draft the cost sheet.']]);
    const flag = l.open().find((f) => f.type === 'soft-commitment');
    expect(flag.summary).toMatch(/a date/);
  });

  test('accepts a commitment that names both owner and date', () => {
    const l = run(new VerificationLedger(), [['Lawrence', 'I will draft the cost sheet by Friday.']]);
    expect(l.open().some((f) => f.type === 'soft-commitment')).toBe(false);
  });

  test('flags a reply that does not address the question asked', () => {
    const l = run(new VerificationLedger(), [
      ['Catrina', 'How many WASH units does that require?'],
      ['Ben', 'The lot has good lighting and a fence around it.'],
    ]);
    const flag = l.open().find((f) => f.type === 'unanswered');
    expect(flag.quotes.map((q) => q.label)).toEqual(['asked', 'replied']);
  });

  test('accepts a reply that does address the question', () => {
    const l = run(new VerificationLedger(), [
      ['Catrina', 'How many WASH units does that require?'],
      ['Ben', 'That would require four WASH units total.'],
    ]);
    expect(l.open().some((f) => f.type === 'unanswered')).toBe(false);
  });

  test('a speaker answering their own question is not flagged', () => {
    const l = run(new VerificationLedger(), [
      ['Ben', 'How many units? Something else entirely about lighting.'],
    ]);
    expect(l.open().some((f) => f.type === 'unanswered')).toBe(false);
  });

  test('open() filters by severity and sorts most urgent first', () => {
    const l = run(new VerificationLedger(), [
      ['Ben', 'We have 30 spots.'], ['Ben', 'We have 20 spots.'],
    ]);
    expect(l.open()[0].severity).toBe('check');
    expect(l.open({ minSeverity: 'check' }).every((f) => f.severity === 'check')).toBe(true);
  });

  test('dismissed flags drop out of the open list', () => {
    const l = run(new VerificationLedger(), [['Ben', 'There are 400 people.']]);
    const id = l.open()[0].id;
    expect(l.dismiss(id, 'checked it').dismissReason).toBe('checked it');
    expect(l.open().find((f) => f.id === id)).toBeUndefined();
    expect(l.dismiss('nope')).toBeNull();
  });

  describe('number parsing', () => {
    test('reads currency, percentages and plain counts', () => {
      expect(VerificationLedger._numbers('$1,200 and 30% and 45 beds').map((n) => n.value))
        .toEqual([1200, 30, 45]);
    });

    test('returns nothing for text with no numbers', () => {
      expect(VerificationLedger._numbers('no digits here')).toEqual([]);
    });
  });

  describe('subject extraction', () => {
    test('a claim about "30 parking spots at the fairgrounds" is about spots', () => {
      const numbers = VerificationLedger._numbers('30 parking spots at the fairgrounds');
      expect(VerificationLedger._subject('We are proposing 30 parking spots at the fairgrounds.', numbers)).toBe('spots');
    });

    test('falls back to the last content word with no numbers', () => {
      expect(VerificationLedger._subject('we talked about the encampment')).toBe('encampment');
    });

    test('returns null when nothing qualifies', () => {
      expect(VerificationLedger._subject('it is')).toBeNull();
    });
  });

  describe('overlap', () => {
    test('is zero for unrelated text and high for a direct echo', () => {
      expect(VerificationLedger._overlap('how many units', 'completely different words')).toBe(0);
      expect(VerificationLedger._overlap('how many WASH units', 'four WASH units total')).toBeGreaterThan(0.3);
    });

    test('is zero when either side is empty', () => {
      expect(VerificationLedger._overlap('', 'anything')).toBe(0);
    });
  });
});

describe('VerificationLedger deduplication', () => {
  test('the same contradiction is raised once, not once per pass', () => {
    const l = run(new VerificationLedger(), [
      ['Ben', 'We are proposing 30 parking spots.'],
      ['Ben', 'We are proposing 20 parking spots.'],
      ['Ben', 'We are proposing 20 parking spots.'],
    ]);
    expect(l.open().filter((f) => f.type === 'contradiction')).toHaveLength(1);
  });

  test('genuinely different observations are still separate flags', () => {
    const l = run(new VerificationLedger(), [
      ['Ben', 'We have 30 beds.'], ['Ben', 'We have 20 beds.'],
      ['Ben', 'We have 15 vans.'], ['Ben', 'We have 9 vans.'],
    ]);
    expect(l.open().filter((f) => f.type === 'contradiction').length).toBeGreaterThan(1);
  });
});
