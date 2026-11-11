/**
 * Shelter Watch — fact checker.
 *
 * For each fact, compares three things:
 *   1. What the establishment says   (facility.facts[key].establishment)
 *   2. What residents say            (consensus of public resident comments)
 *   3. What independent evidence shows (facility.facts[key].verified)
 *
 * A stored claim looks like: { value, source, date }.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const schema = isNode ? require('./schema') : root.ShelterWatch.schema;
  const moderation = isNode ? require('./moderation') : root.ShelterWatch.moderation;
  const mod = factory(schema, moderation);
  if (isNode) module.exports = mod;
  else (root.ShelterWatch = root.ShelterWatch || {}).factcheck = mod;
})(typeof self !== 'undefined' ? self : this, function (schema, moderation) {
  /** Who counts as "the people" for consensus. Staff are excluded on purpose. */
  const RESIDENT_VOICES = ['current_resident', 'former_resident', 'family_or_friend'];
  const MIN_REPORTS = 3;
  const MIN_AGREEMENT = 0.6;

  const VERDICTS = {
    verified: 'Verified — matches independent evidence',
    contradicted: 'Contradicted — establishment claim does not match the evidence',
    disputed: 'Disputed — residents say something different from the establishment',
    consistent: 'Consistent — residents and establishment agree (not independently verified)',
    unverified: 'Unverified — only one side has spoken',
    unknown: 'Unknown — no information yet',
  };

  /** Residents' answer to one fact, or null if there isn't a clear consensus. */
  function residentConsensus(comments, factKey) {
    const answers = (comments || [])
      .filter((c) => moderation.isPublic(c) && RESIDENT_VOICES.includes(c.relationship))
      .map((c) => c.facts && c.facts[factKey])
      .filter((v) => v !== undefined && v !== null && v !== '');
    if (answers.length === 0) return { value: null, count: 0, agreement: 0, clear: false };
    const tally = {};
    answers.forEach((v) => {
      tally[v] = (tally[v] || 0) + 1;
    });
    const [value, top] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    const agreement = top / answers.length;
    const clear = answers.length >= MIN_REPORTS && agreement >= MIN_AGREEMENT;
    return { value: clear ? value : null, count: answers.length, agreement, clear, tally };
  }

  const val = (claim) => (claim && claim.value !== undefined && claim.value !== null ? String(claim.value) : null);

  /** Verdict for one fact. */
  function checkFact(fact, consensus) {
    const est = val(fact && fact.establishment);
    const ver = val(fact && fact.verified);
    const res = consensus && consensus.clear ? String(consensus.value) : null;

    let verdict;
    if (ver !== null) verdict = est !== null && est !== ver ? 'contradicted' : 'verified';
    else if (est !== null && res !== null) verdict = est === res ? 'consistent' : 'disputed';
    else if (est !== null || res !== null || (consensus && consensus.count > 0)) verdict = 'unverified';
    else verdict = 'unknown';

    return { establishment: est, residents: res, verified: ver, verdict, verdictLabel: VERDICTS[verdict] };
  }

  /** Run the fact checker over every fact on a facility. */
  function checkFacility(facility, comments) {
    const facts = (facility && facility.facts) || {};
    return schema.FACTS.map((def) => {
      const consensus = def.options ? residentConsensus(comments, def.key) : { clear: false, count: 0 };
      return { key: def.key, label: def.label, ...checkFact(facts[def.key], consensus), residentCount: consensus.count };
    });
  }

  function summarize(results) {
    const counts = Object.keys(VERDICTS).reduce((o, k) => ({ ...o, [k]: 0 }), {});
    results.forEach((r) => {
      counts[r.verdict] += 1;
    });
    return counts;
  }

  return { VERDICTS, RESIDENT_VOICES, MIN_REPORTS, MIN_AGREEMENT, residentConsensus, checkFact, checkFacility, summarize };
});
