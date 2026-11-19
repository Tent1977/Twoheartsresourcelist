/**
 * Shelter Watch — resident ratings and the Claude Rating.
 *
 * The Claude Rating is an automated score with every input shown. It is
 * NOT an opinion: it is calculated only from resident ratings, the fact
 * checker, how much the establishment discloses, and how well the research
 * on the facility is sourced. Below MIN_REVIEWS rated reviews it reports
 * "not enough data" instead of a number.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const schema = isNode ? require('./schema') : root.ShelterWatch.schema;
  const moderation = isNode ? require('./moderation') : root.ShelterWatch.moderation;
  const factcheck = isNode ? require('./factcheck') : root.ShelterWatch.factcheck;
  const mod = factory(schema, moderation, factcheck);
  if (isNode) module.exports = mod;
  else (root.ShelterWatch = root.ShelterWatch || {}).ratings = mod;
})(typeof self !== 'undefined' ? self : this, function (schema, moderation, factcheck) {
  const MIN_REVIEWS = 5;
  const WEIGHTS = { residents: 0.5, accountability: 0.2, transparency: 0.2, research: 0.1 };
  const RESEARCH_SCORE = { high: 100, medium: 60, low: 30 };
  const PENALTY = { contradicted: 25, disputed: 10 };

  const round1 = (n) => Math.round(n * 10) / 10;

  /**
   * Average of each rating dimension. Only residents (and their family or
   * friends) count, one review per person; staff and providers are shown
   * but don't move the numbers.
   */
  function aggregate(comments) {
    const out = {};
    schema.DIMENSIONS.forEach((d) => {
      out[d.key] = { label: d.label, average: null, count: 0 };
    });
    factcheck.residentComments(comments).forEach((c) => {
      Object.entries(moderation.sanitizeRatings(c.ratings)).forEach(([k, v]) => {
        if (!out[k]) return;
        out[k].count += 1;
        out[k].sum = (out[k].sum || 0) + v;
      });
    });
    Object.values(out).forEach((d) => {
      if (d.count) d.average = round1(d.sum / d.count);
      delete d.sum;
    });
    return out;
  }

  /** Friendly / Tolerable / Mean label for a staff or management average. */
  function demeanorLabel(average) {
    if (average === null || average === undefined) return 'Not enough reviews';
    if (average < 2.5) return 'Mean';
    if (average < 3.5) return 'Tolerable';
    return 'Friendly';
  }

  function ratedReviewCount(comments) {
    return factcheck.residentComments(comments).filter((c) => Object.keys(moderation.sanitizeRatings(c.ratings)).length > 0).length;
  }

  /**
   * Calculate the Claude Rating for one facility.
   * Returns { score (0–100 or null), stars, status, components, explanation[] }.
   */
  function claudeRating(facility, comments) {
    const explanation = [];
    const agg = aggregate(comments);
    const reviews = ratedReviewCount(comments);

    // 1. What residents say (average of all dimension averages, 1–5 → 0–100)
    const dims = Object.values(agg).filter((d) => d.average !== null);
    const residents = dims.length ? ((dims.reduce((s, d) => s + d.average, 0) / dims.length - 1) / 4) * 100 : null;

    // 2. Fact checker: penalties for contradicted / disputed claims
    const checks = factcheck.checkFacility(facility, comments);
    const counts = factcheck.summarize(checks);
    const checked = counts.verified + counts.contradicted + counts.disputed + counts.consistent;
    const accountability = checked
      ? Math.max(0, 100 - counts.contradicted * PENALTY.contradicted - counts.disputed * PENALTY.disputed)
      : null;

    // 3. Transparency: share of facts the establishment has stated publicly
    const facts = (facility && facility.facts) || {};
    const stated = schema.FACT_KEYS.filter((k) => facts[k] && facts[k].establishment && facts[k].establishment.value != null).length;
    // Only counts once the establishment has actually been asked — otherwise a
    // blank would punish them for our research gap, not their silence.
    const asked = Boolean(facility && facility.establishmentAskedAt);
    const transparency = asked ? (stated / schema.FACT_KEYS.length) * 100 : null;

    // 4. Research quality on this listing
    const research = RESEARCH_SCORE[facility && facility.researchConfidence] || RESEARCH_SCORE.low;

    const components = {
      residents: residents === null ? null : Math.round(residents),
      accountability: accountability === null ? null : Math.round(accountability),
      transparency: transparency === null ? null : Math.round(transparency),
      research,
    };

    explanation.push(
      residents === null
        ? 'No resident ratings yet.'
        : `Residents: ${components.residents}/100 from ${reviews} resident review${reviews === 1 ? '' : 's'} (staff reviews don't count).`
    );
    explanation.push(
      accountability === null
        ? 'Fact checker: nothing to compare yet, so this part is left out.'
        : `Fact checker: ${counts.contradicted} wrong, ${counts.disputed} disputed, out of ${checked} compared.`
    );
    explanation.push(
      asked
        ? `Openness: the place has answered ${stated} of ${schema.FACT_KEYS.length} questions.`
        : 'Openness: we have not asked the place yet, so this part is left out.'
    );
    explanation.push(`Our research on this listing is ${facility && facility.researchConfidence ? facility.researchConfidence : 'low'} confidence.`);

    if (reviews < MIN_REVIEWS) {
      explanation.unshift(`No score yet: needs ${MIN_REVIEWS} resident reviews with ratings (has ${reviews}).`);
      return { score: null, stars: null, status: 'not_enough_data', reviews, components, explanation };
    }

    // Weighted average; drop accountability and re-weight if nothing was checked.
    let total = 0;
    let weight = 0;
    Object.entries(WEIGHTS).forEach(([k, w]) => {
      if (components[k] === null) return;
      total += components[k] * w;
      weight += w;
    });
    const score = Math.max(0, Math.min(100, Math.round(total / weight)));
    const stars = Math.round((score / 20) * 2) / 2;
    return { score, stars, status: 'rated', reviews, components, explanation };
  }

  return { MIN_REVIEWS, WEIGHTS, aggregate, demeanorLabel, ratedReviewCount, claudeRating };
});
