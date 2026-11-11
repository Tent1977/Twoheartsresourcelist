const { schema, moderation, factcheck, ratings } = require('../src/shelterwatch');
const { decide } = require('../functions/review-screen');

const facility = (overrides = {}) =>
  schema.toFacility({ id: 'SW-001', name: 'Test Place', category: 'transitional_housing', confidence: 'medium', ...overrides });

let n = 0;
const comment = (over = {}) => ({
  ...moderation.prepareComment({
    facilityId: 'SW-001',
    text: 'This is a long enough comment about the place.',
    relationship: 'current_resident',
    ...over,
  }),
  id: `c${++n}`,
  authorKey: over.authorKey || `u${n}`,
});

describe('schema', () => {
  test('toFacility requires id and name', () => {
    expect(() => schema.toFacility({ name: 'x' })).toThrow();
    expect(() => schema.toFacility(null)).toThrow();
  });

  test('maps research fields and starts every fact empty', () => {
    const f = schema.toFacility({
      id: 'SW-9', name: 'A', address: '1 Main St', how_to_apply: 'Call', typical_rent: '$400',
      waitlist_status: 'open', units: 0, sources: ['https://a.org/x y', 'not a url'],
    });
    expect(f).toMatchObject({ address: '1 Main St', howToApply: 'Call', rent: '$400', waitlist: 'open', units: 0 });
    expect(f.sources).toEqual(['https://a.org/x%20y']);
    expect(f.researchConfidence).toBe('low');
    expect(Object.keys(f.facts)).toEqual(schema.FACT_KEYS);
    expect(f.facts.petsAllowed).toEqual({ establishment: null, verified: null });
    expect(schema.toFacility({ id: 'a', name: 'b', cost: '$5', sources: 'x' })).toMatchObject({ rent: '$5', sources: [], units: null });
  });

  test('confidential sites hide address, notes, sources, units and street names', () => {
    const f = facility({
      category: 'dv_shelter', address: '123 Real St', notes: 'near [location withheld]', sources: ['https://news/x'],
      units: 'new facility', how_to_apply: 'Go to 50 Oak Ave', population: 'survivors',
    });
    expect(f.address).toMatch(/Confidential/);
    expect(f).toMatchObject({ researchNotes: null, sources: [], units: null, confidential: true });
    expect(f.howToApply).toBe('Go to [location withheld]');
    expect(facility({ address: 'confidential' }).confidential).toBe(true);
    expect(schema.isConfidential(null)).toBe(false);
    expect(facility({ address: '5 Oak Ave' }).confidential).toBe(false);
    expect(schema.scrubLocation(null)).toBeNull();
  });

  test.each([
    ['24-hr hotline (775) 329-4150', [['7753294150', '24-hr hotline']]],
    ['24-hr hotline (775) 322-3466; office (775) 324-3766', [['7753223466', '24-hr hotline'], ['7753243766', 'office']]],
    ['(775) 688-4555 (option 2 for shelter assistance)', [['7756884555', 'option 2 for shelter assistance']]],
    ['775-331-4166 (I); 775-331-9444 (II)', [['7753314166', 'I'], ['7753319444', 'II']]],
    ['(775) 329-4141 or 311', [['7753294141', null], ['311', null]]],
    ['24/7 call/text 1-800-536-4588 (National Safe Place)', [['8005364588', '24/7 call/text National Safe Place']]],
    ['(775) 327-7501 (county policy lists 775-328-2700)', [['7753277501', null], ['7753282700', 'county policy lists']]],
  ])('parsePhones("%s")', (text, expected) => {
    expect(schema.parsePhones(text).map((p) => [p.number, p.label])).toEqual(expected);
  });

  test('parsePhones handles empty and duplicate input', () => {
    expect(schema.parsePhones(null)).toEqual([]);
    expect(schema.parsePhones('775-111-2222 or 775-111-2222')).toHaveLength(1);
    expect(schema.parsePhones('775-111-2222')[0].display).toBe('(775) 111-2222');
  });

  test('normalizeSearch straightens apostrophes and case', () => {
    expect(schema.normalizeSearch('Women’s  SHELTER')).toBe('womens shelter');
    expect(schema.normalizeSearch("women's")).toBe('womens');
    expect(schema.normalizeSearch(null)).toBe('');
  });

  test('has 11 rating dimensions and resident-reportable facts have options', () => {
    expect(schema.DIMENSIONS).toHaveLength(11);
    schema.RESIDENT_REPORTABLE.forEach((k) => expect(schema.FACTS.find((f) => f.key === k).options).toBeTruthy());
  });
});

describe('moderation screen', () => {
  test('clean comments post immediately', () => {
    expect(comment().status).toBe('visible');
  });

  test.each([
    'call me at 775-555-1234 anytime',
    'call seven seven five five five five one two one two',
    '775_555_1212 is his cell',
    '７７５-５５５-１２１２',
    'email me jane.doe@example.com please',
    'jane dot doe at gmail dot com',
    'reach me at jane(at)gmail.com',
    'gonna kill that manager',
    'I know where you live',
    'someone should burn the place down',
  ])('holds "%s"', (text) => {
    expect(moderation.screen(text).status).toBe('held');
  });

  test.each([
    'I will beat my addiction here',
    'they kill you with kindness',
    'great place to live honestly',
    'The hotline 775-329-4150 helped me',
  ])('lets through "%s"', (text) => {
    expect(moderation.screen(text, { allowNumbers: ['7753294150'] }).status).toBe('visible');
  });

  test('confidential sites always go to a moderator and flag locations', () => {
    expect(moderation.screen('Nice staff and clean rooms', { confidential: true }).status).toBe('held');
    expect(moderation.screen('it is at 123 n virginia st', { confidential: true }).reasons).toContain('Mentions a location on a confidential site');
    expect(moderation.screen('on [location withheld] near Kietzke', { confidential: true }).reasons).toContain('Mentions a location on a confidential site');
  });
});

describe('moderation comments', () => {
  test('validates input with plain-language errors', () => {
    expect(() => moderation.prepareComment(null)).toThrow('Please write');
    expect(() => comment({ text: 'short' })).toThrow('at least');
    expect(() => comment({ text: '​'.repeat(20) })).toThrow('at least');
    expect(() => comment({ text: 'x'.repeat(3001) })).toThrow('under');
    expect(() => comment({ facilityId: '' })).toThrow('facilityId');
    expect(() => comment({ relationship: 'boss' })).toThrow('how you know');
    expect(() => comment({ ratings: { nope: 3 } })).toThrow('Unknown rating');
    expect(() => comment({ ratings: { clean: 6 } })).toThrow('1–5');
    expect(() => comment({ ratings: { clean: 2.5 } })).toThrow('1–5');
    expect(() => comment({ facts: { staffCount: '4' } })).toThrow('Unknown fact');
    expect(() => comment({ facts: { petsAllowed: 'maybe' } })).toThrow('Invalid');
  });

  test('drops blank ratings and facts', () => {
    const c = comment({ ratings: { clean: '4', safe: '' }, facts: { kitchen: 'communal', bathroom: null } });
    expect(c.ratings).toEqual({ clean: 4 });
    expect(c.facts).toEqual({ kitchen: 'communal' });
    expect(c.reportCount).toBe(0);
  });

  test('sanitizeStored rejects junk and neutralizes hostile values', () => {
    [null, 5, 'x', [], {}, { facilityId: 1, text: 'a' }].forEach((bad) => expect(moderation.sanitizeStored(bad)).toBeNull());
    const s = moderation.sanitizeStored({
      facilityId: 'a', text: 'hi​ there', relationship: 'boss', status: 5, reportCount: -3,
      ratings: { clean: '<img onerror=x>', safe: 4, happy: 1e6, bogus: 3 },
      facts: { kitchen: 'communal', pets: 'yes', bathroom: '<b>' },
      createdAt: '9999-12-31T00:00:00Z',
    });
    expect(s).toMatchObject({ text: 'hi there', relationship: 'other', status: 'held', reportCount: 0, ratings: { safe: 4 }, facts: { kitchen: 'communal' }, id: null });
    expect(Date.parse(s.createdAt)).toBeLessThanOrEqual(Date.now());
    expect(moderation.sanitizeStored({ facilityId: 'a', text: 'b', createdAt: 'nope' }).createdAt).toMatch(/^\d{4}-/);
    expect(moderation.sanitizeRatings(null)).toEqual({});
    expect(moderation.sanitizeFacts(null)).toEqual({});
  });

  test('three reports hide a comment; moderator approval overrides', () => {
    let c = comment();
    c = moderation.addReport(moderation.addReport(c));
    expect(moderation.isPublic(c)).toBe(true);
    c = moderation.addReport(c);
    expect(c.reportCount).toBe(3);
    expect(moderation.isPublic(c)).toBe(false);
    expect(moderation.isPublic({ ...c, status: 'approved' })).toBe(true);
    expect(moderation.addReport({}).reportCount).toBe(1);
  });

  test('held, hidden, removed and missing comments are not public', () => {
    expect(moderation.isPublic(null)).toBe(false);
    ['held', 'hidden', 'removed'].forEach((status) => expect(moderation.isPublic({ status })).toBe(false));
  });
});

describe('factcheck', () => {
  const pets = (v, rel = 'current_resident', authorKey) => comment({ relationship: rel, facts: { petsAllowed: v }, authorKey });

  test('consensus needs 3 resident answers and 60% agreement; staff ignored', () => {
    expect(factcheck.residentConsensus([], 'petsAllowed')).toMatchObject({ count: 0, clear: false });
    expect(factcheck.residentConsensus([pets('no'), pets('no')], 'petsAllowed').clear).toBe(false);
    const c = factcheck.residentConsensus([pets('no'), pets('no'), pets('yes'), pets('yes', 'staff')], 'petsAllowed');
    expect(c).toMatchObject({ value: 'no', count: 3, clear: true });
    expect(factcheck.residentConsensus([pets('no'), pets('yes'), pets('service_animals_only')], 'petsAllowed').clear).toBe(false);
  });

  test('one voice per author: repeat posts by the same person count once', () => {
    const same = [pets('no', 'current_resident', 'sock'), pets('no', 'current_resident', 'sock'), pets('no', 'current_resident', 'sock')];
    expect(factcheck.residentConsensus(same, 'petsAllowed').count).toBe(1);
    expect(factcheck.residentConsensus([{ ...pets('no'), authorKey: null }], 'petsAllowed').count).toBe(1);
  });

  test('ignores values that are not allowed options', () => {
    const bad = [1, 2, 3].map(() => ({ ...pets('no'), facts: { petsAllowed: '<script>' } }));
    expect(factcheck.residentConsensus(bad, 'petsAllowed').count).toBe(0);
  });

  test('verdicts', () => {
    const clearNo = { clear: true, value: 'no', count: 3 };
    expect(factcheck.checkFact({ establishment: { value: 'yes' }, verified: { value: 'yes' } }, null).verdict).toBe('verified');
    expect(factcheck.checkFact({ verified: { value: 'yes' } }, null).verdict).toBe('verified');
    expect(factcheck.checkFact({ establishment: { value: 'yes' }, verified: { value: 'no' } }, null).verdict).toBe('contradicted');
    expect(factcheck.checkFact({ establishment: { value: 'yes' } }, clearNo).verdict).toBe('disputed');
    expect(factcheck.checkFact({ establishment: { value: 'no' } }, clearNo).verdict).toBe('consistent');
    expect(factcheck.checkFact({ establishment: { value: 'no' } }, null).verdict).toBe('unverified');
    expect(factcheck.checkFact({}, { clear: false, count: 1 }).verdict).toBe('unverified');
    expect(factcheck.checkFact(undefined, undefined).verdict).toBe('unknown');
  });

  test('checkFacility covers every fact; fact label stays separate from verdict label', () => {
    const f = facility();
    f.facts.petsAllowed.establishment = { value: 'yes', source: 'website' };
    const results = factcheck.checkFacility(f, [pets('no'), pets('no'), pets('no')]);
    expect(results).toHaveLength(schema.FACTS.length);
    const p = results.find((r) => r.key === 'petsAllowed');
    expect(p).toMatchObject({ verdict: 'disputed', label: 'Pets allowed' });
    expect(p.verdictLabel).toMatch(/^Disputed/);
    expect(factcheck.summarize(results)).toMatchObject({ disputed: 1, unknown: schema.FACTS.length - 1 });
    expect(factcheck.checkFacility(null, null)).toHaveLength(schema.FACTS.length);
  });
});

describe('ratings', () => {
  const rated = (r, extra = {}) => comment({ ratings: r, ...extra });

  test('aggregate counts residents only, one per author, valid values only', () => {
    const hidden = { ...rated({ clean: 1 }), status: 'held' };
    const staff = rated({ clean: 1 }, { relationship: 'staff' });
    const junk = { ...rated({}), ratings: { clean: '5', safe: 1e6 } };
    const agg = ratings.aggregate([rated({ clean: 4, safe: 2 }), rated({ clean: 5 }), hidden, staff, junk]);
    expect(agg.clean).toMatchObject({ average: 4.5, count: 2 });
    expect(agg.safe).toMatchObject({ average: 2, count: 1 });
    expect(agg.happy).toMatchObject({ average: null, count: 0 });
    expect(ratings.aggregate(undefined).clean.count).toBe(0);
  });

  test('demeanor labels', () => {
    expect(ratings.demeanorLabel(null)).toMatch(/Not enough/);
    expect(ratings.demeanorLabel(2)).toBe('Mean');
    expect(ratings.demeanorLabel(3)).toBe('Tolerable');
    expect(ratings.demeanorLabel(4.2)).toBe('Friendly');
  });

  test('no score below the review minimum', () => {
    const r = ratings.claudeRating(facility(), [rated({ clean: 5 })]);
    expect(r).toMatchObject({ score: null, status: 'not_enough_data', reviews: 1 });
    expect(r.explanation[0]).toMatch(/No score yet/);
    expect(ratings.claudeRating(facility(), []).explanation).toContain('No resident ratings yet.');
  });

  test('staff-only and sock-puppet reviews cannot produce a score', () => {
    const staff = Array.from({ length: 5 }, () => rated({ clean: 5 }, { relationship: 'staff' }));
    expect(ratings.claudeRating(facility(), staff).score).toBeNull();
    const socks = Array.from({ length: 5 }, () => rated({ clean: 5 }, { authorKey: 'same-person' }));
    expect(ratings.claudeRating(facility(), socks).reviews).toBe(1);
  });

  test('scores with residents and research; openness only counts once asked', () => {
    const comments = Array.from({ length: 5 }, () => rated({ clean: 5, safe: 5 }));
    const f = facility({ confidence: 'high' });
    const r = ratings.claudeRating(f, comments);
    expect(r.components).toEqual({ residents: 100, accountability: null, transparency: null, research: 100 });
    expect(r.score).toBe(100);
    expect(r.explanation.join(' ')).toMatch(/not asked the place yet/);
    expect(r.explanation.join(' ')).toMatch(/nothing to compare yet/);
    f.establishmentAskedAt = '2026-11-11';
    const asked = ratings.claudeRating(f, comments);
    expect(asked.components.transparency).toBe(0);
    expect(asked.score).toBe(75);
    expect(asked.stars).toBe(4);
    expect(asked.explanation.join(' ')).toMatch(/answered 0 of/);
  });

  test('fact-checker penalties lower the score and score stays in 0–100', () => {
    const f = facility();
    f.facts.petsAllowed.establishment = { value: 'yes' };
    f.facts.petsAllowed.verified = { value: 'no' };
    f.facts.kitchen.establishment = { value: 'individual' };
    const comments = [
      ...Array.from({ length: 3 }, () => comment({ ratings: { clean: 1 }, facts: { kitchen: 'communal' } })),
      ...Array.from({ length: 2 }, () => rated({ clean: 1 })),
    ];
    const r = ratings.claudeRating(f, comments);
    expect(r.components.accountability).toBe(65);
    expect(r.components.residents).toBe(0);
    expect(r.status).toBe('rated');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.explanation.join(' ')).toMatch(/1 wrong, 1 disputed/);
    expect(ratings.claudeRating(null, comments).components.research).toBe(30);
  });
});

describe('server review screen (functions)', () => {
  const info = { open: { confidential: false, numbers: ['7753294141'] }, dv: { confidential: true, numbers: [] } };

  test('holds reviews the browser screen would have held', () => {
    expect(decide({ facilityId: 'open', text: 'call 775-555-1212 now', status: 'visible' }, info)).toEqual({
      status: 'held', heldReasons: ['Contains a phone number'],
    });
    expect(decide({ facilityId: 'dv', text: 'good place to stay', status: 'visible' }, info).status).toBe('held');
    expect(decide({ facilityId: 'nope', text: 'whatever text', status: 'visible' }, info).status).toBe('held');
  });

  test('leaves clean or already-held reviews alone', () => {
    expect(decide({ facilityId: 'open', text: 'their line 775-329-4141 works', status: 'visible' }, info)).toBeNull();
    expect(decide({ facilityId: 'open', text: 'call 775-555-1212', status: 'held' }, info)).toBeNull();
    expect(decide(null, info)).toBeNull();
  });
});
