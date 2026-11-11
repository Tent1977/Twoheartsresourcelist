const { schema, moderation, factcheck, ratings } = require('../src/shelterwatch');

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
});

describe('schema', () => {
  test('toFacility requires id and name', () => {
    expect(() => schema.toFacility({ name: 'x' })).toThrow();
    expect(() => schema.toFacility(null)).toThrow();
  });

  test('maps research fields and starts every fact empty', () => {
    const f = schema.toFacility({
      id: 'SW-9', name: 'A', address: '1 Main St', how_to_apply: 'Call', typical_rent: '$400',
      waitlist_status: 'open', units: 0, sources: ['u'],
    });
    expect(f).toMatchObject({ address: '1 Main St', howToApply: 'Call', rent: '$400', waitlist: 'open', units: 0, sources: ['u'] });
    expect(f.researchConfidence).toBe('low');
    expect(Object.keys(f.facts)).toEqual(schema.FACT_KEYS);
    expect(f.facts.petsAllowed).toEqual({ establishment: null, verified: null });
    expect(schema.toFacility({ id: 'a', name: 'b', cost: '$5', sources: 'x' })).toMatchObject({ rent: '$5', sources: [], units: null });
  });

  test('hides addresses for DV shelters and confidential sites', () => {
    expect(facility({ category: 'dv_shelter', address: '123 Real St' }).address).toMatch(/Confidential/);
    expect(facility({ address: 'confidential' }).confidential).toBe(true);
    expect(schema.isConfidential(null)).toBe(false);
    expect(facility({ address: '5 Oak Ave' }).confidential).toBe(false);
  });

  test('has 11 rating dimensions and resident-reportable facts have options', () => {
    expect(schema.DIMENSIONS).toHaveLength(11);
    schema.RESIDENT_REPORTABLE.forEach((k) => expect(schema.FACTS.find((f) => f.key === k).options).toBeTruthy());
  });
});

describe('moderation', () => {
  test('clean comments post immediately', () => {
    expect(comment().status).toBe('visible');
  });

  test.each([
    ['call me at 775-555-1234 anytime', 'phone'],
    ['email me jane.doe@example.com please', 'email'],
    ["I'm going to hurt him if this continues", 'threat'],
  ])('holds "%s" (%s)', (text) => {
    const c = comment({ text });
    expect(c.status).toBe('held');
    expect(c.heldReasons.length).toBeGreaterThan(0);
  });

  test('street address held only on confidential sites', () => {
    const text = 'The shelter is at 1234 Elm Street behind the store.';
    expect(moderation.screen(text, { confidential: true }).status).toBe('held');
    expect(moderation.screen(text).status).toBe('visible');
  });

  test('validates input', () => {
    expect(() => moderation.prepareComment(null)).toThrow('required');
    expect(() => comment({ text: 'short' })).toThrow('at least');
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
  });

  test('three different reporters hide a comment; repeats do not count', () => {
    let c = comment();
    c = moderation.report(c, 'u1');
    c = moderation.report(c, 'u1');
    c = moderation.report(c, 'u2');
    expect(c.reports).toEqual(['u1', 'u2']);
    expect(moderation.isPublic(c)).toBe(true);
    c = moderation.report(c, 'u3');
    expect(moderation.isPublic(c)).toBe(false);
    expect(moderation.isPublic({ ...c, status: 'approved' })).toBe(true);
    expect(() => moderation.report(c)).toThrow();
    expect(moderation.report({ status: 'visible' }, 'u1').reports).toEqual(['u1']);
  });

  test('held, removed and missing comments are not public', () => {
    expect(moderation.isPublic(null)).toBe(false);
    expect(moderation.isPublic({ status: 'held' })).toBe(false);
    expect(moderation.isPublic({ status: 'removed' })).toBe(false);
  });
});

describe('factcheck', () => {
  const pets = (v, rel = 'current_resident') => comment({ relationship: rel, facts: { petsAllowed: v } });

  test('consensus needs 3 resident answers and 60% agreement; staff ignored', () => {
    expect(factcheck.residentConsensus([], 'petsAllowed')).toMatchObject({ count: 0, clear: false });
    expect(factcheck.residentConsensus([pets('no'), pets('no')], 'petsAllowed').clear).toBe(false);
    const c = factcheck.residentConsensus([pets('no'), pets('no'), pets('yes'), pets('yes', 'staff')], 'petsAllowed');
    expect(c).toMatchObject({ value: 'no', count: 3, clear: true });
    expect(factcheck.residentConsensus([pets('no'), pets('yes'), pets('service_animals_only')], 'petsAllowed').clear).toBe(false);
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

  test('checkFacility covers every fact and summarize counts verdicts', () => {
    const f = facility();
    f.facts.petsAllowed.establishment = { value: 'yes', source: 'website' };
    const results = factcheck.checkFacility(f, [pets('no'), pets('no'), pets('no')]);
    expect(results).toHaveLength(schema.FACTS.length);
    expect(results.find((r) => r.key === 'petsAllowed').verdict).toBe('disputed');
    expect(factcheck.summarize(results)).toMatchObject({ disputed: 1, unknown: schema.FACTS.length - 1 });
    expect(factcheck.checkFacility(null, null)).toHaveLength(schema.FACTS.length);
  });
});

describe('ratings', () => {
  const rated = (r) => comment({ ratings: r });

  test('aggregate averages only public comments', () => {
    const hidden = { ...rated({ clean: 1 }), status: 'held' };
    const agg = ratings.aggregate([rated({ clean: 4, safe: 2 }), rated({ clean: 5 }), hidden, { ...rated({}), ratings: { bogus: 3 } }]);
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

  test('not enough data below the review minimum', () => {
    const r = ratings.claudeRating(facility(), [rated({ clean: 5 })]);
    expect(r).toMatchObject({ score: null, status: 'not_enough_data', reviews: 1 });
    expect(r.explanation[0]).toMatch(/Not enough data/);
    expect(ratings.claudeRating(facility(), []).explanation).toContain('No resident ratings yet.');
  });

  test('scores with residents, transparency and research; skips unchecked accountability', () => {
    const comments = Array.from({ length: 5 }, () => rated({ clean: 5, safe: 5 }));
    const f = facility({ confidence: 'high' });
    const r = ratings.claudeRating(f, comments);
    // not yet asked: residents 100*.5 + research 100*.1 over weight .6
    expect(r.components).toEqual({ residents: 100, accountability: null, transparency: null, research: 100 });
    expect(r.score).toBe(100);
    expect(r.explanation.join(' ')).toMatch(/not been asked yet/);
    // once asked and silent: transparency 0 pulls the score down
    f.establishmentAskedAt = '2026-11-11';
    const asked = ratings.claudeRating(f, comments);
    expect(asked.components.transparency).toBe(0);
    expect(asked.score).toBe(75);
    expect(asked.stars).toBe(4);
    expect(asked.explanation.join(' ')).toMatch(/stated 0 of/);
    expect(r.explanation.join(' ')).toMatch(/nothing checked yet/);
  });

  test('fact-checker penalties lower the score', () => {
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
    expect(r.explanation.join(' ')).toMatch(/1 contradicted, 1 disputed/);
    expect(ratings.claudeRating(null, comments).components.research).toBe(30);
  });
});

test('checkFacility keeps the fact label separate from the verdict label', () => {
  const r = factcheck.checkFacility(schema.toFacility({ id: 'a', name: 'b' }), [])[0];
  expect(r.label).toBe(schema.FACTS[0].label);
  expect(r.verdictLabel).toMatch(/^Unknown/);
});
