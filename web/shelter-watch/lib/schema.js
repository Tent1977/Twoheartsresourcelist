/**
 * Shelter Watch — facility profile schema.
 *
 * Every fact about a facility is stored as three separate claims so the
 * fact checker can compare them side by side:
 *   - establishment: what the operator says (website, flyer, phone call)
 *   - verified:      what an independent source shows (inspection, document, site visit)
 *   - residents:     derived at runtime from resident comments (never stored here)
 *
 * Works in Node (require) and the browser (window.ShelterWatch.schema).
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.ShelterWatch = root.ShelterWatch || {}).schema = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  /** Resident rating dimensions, each scored 1–5. */
  const DIMENSIONS = [
    { key: 'happy', label: 'Happy place to live' },
    { key: 'comfortable', label: 'Comfortable' },
    { key: 'affordable', label: 'Affordable' },
    { key: 'residentsFirst', label: 'Puts residents’ needs first' },
    { key: 'clean', label: 'Clean' },
    { key: 'safe', label: 'Feels safe' },
    { key: 'rulesFair', label: 'Rules are fair' },
    { key: 'privacy', label: 'Privacy' },
    { key: 'staff', label: 'Support staff demeanor' },
    { key: 'management', label: 'Management demeanor' },
    { key: 'recommend', label: 'Would recommend' },
  ];

  /**
   * Facts that can be checked. `options` lists allowed values; residents
   * pick from the same options so their answers can be compared.
   */
  const FACTS = [
    { key: 'petsAllowed', label: 'Pets allowed', options: ['yes', 'no', 'service_animals_only'] },
    { key: 'petRequirements', label: 'Pet requirements', options: null },
    { key: 'visitorsAllowed', label: 'Visitors allowed', options: ['yes', 'no', 'restricted'] },
    { key: 'visitorHours', label: 'Visitor hours', options: null },
    { key: 'rulesLevel', label: 'Amount of rules', options: ['few', 'moderate', 'many'] },
    { key: 'kitchen', label: 'Kitchen', options: ['individual', 'communal', 'both', 'none'] },
    { key: 'bathroom', label: 'Bathroom', options: ['private', 'communal', 'both'] },
    { key: 'furnished', label: 'Furnished', options: ['yes', 'no', 'partial'] },
    { key: 'staffOnSite', label: 'Support staff on site', options: ['24_7', 'business_hours', 'some', 'none'] },
    { key: 'staffCount', label: 'Number of support staff', options: null },
    { key: 'peerSupport', label: 'Peer support staff', options: ['yes', 'no'] },
    { key: 'traumaInformed', label: 'Staff trained in trauma-informed care', options: ['yes', 'no'] },
    { key: 'harmReduction', label: 'Harm reduction approach', options: ['yes', 'no'] },
    { key: 'events', label: 'Holds events / activities', options: ['yes', 'no'] },
    { key: 'acceptsRegistrants', label: 'Accepts people on the sex offender registry', options: ['yes', 'no', 'case_by_case'] },
    { key: 'menWomenRatio', label: 'Men to women ratio', options: null },
  ];

  /** Facts residents may report in a comment (subset with fixed options). */
  const RESIDENT_REPORTABLE = FACTS.filter((f) => Array.isArray(f.options)).map((f) => f.key);

  const DIMENSION_KEYS = DIMENSIONS.map((d) => d.key);
  const FACT_KEYS = FACTS.map((f) => f.key);

  /** Categories whose street address must never be shown. */
  const CONFIDENTIAL_CATEGORIES = ['dv_shelter'];

  function emptyFacts() {
    const facts = {};
    FACT_KEYS.forEach((k) => {
      facts[k] = { establishment: null, verified: null };
    });
    return facts;
  }

  const PHONE_RE = /(?:\b1[\s.-]?)?\(?\b(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})\b|\b(211|311|911|988)\b/g;
  const STREET_WORDS =
    /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9]+\s+){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Way|Ln|Lane|Ct|Court|Pl|Place|Pkwy|Cir)\b\.?|\b(?:[NSEW]\.?\s+)?\d{1,2}(?:st|nd|rd|th)\s+(?:St|Street|Ave|Avenue)\b\.?|\b[A-Z][a-z]+\s+(?:St|Ave|Blvd|Rd|Ln)\b\.?(?:\s+(?:facility|site|campus|location))?/g;

  /** Words in a "who it serves" text, mapped to filter tags. */
  const SERVES = {
    women: /(^|[^a-z])(women|womens|woman|female|females|mothers?|girls?)([^a-z]|$)/i,
    men: /(^|[^a-z])(men|mens|male|males|fathers?)([^a-z]|$)/i,
    families: /(^|[^a-z])(famil\w*|children|child|kids|parents?|parenting)([^a-z]|$)/i,
    youth: /(^|[^a-z])(youth|young adults?|teens?|minors?|18\s*[-–]\s*24|12\s*[-–]\s*17)([^a-z]|$)/i,
    veterans: /(^|[^a-z])veterans?([^a-z]|$)/i,
    seniors: /(^|[^a-z])(seniors?|elderly|62\+?|55\+)([^a-z]|$)/i,
    disabilities: /(^|[^a-z])disab\w*/i,
    recovery: /(^|[^a-z])(recovery|sober|substance|addiction)([^a-z]|$)/i,
    reentry: /(^|[^a-z])(reentry|re-entry|parole|probation|incarcerat\w*|prison)([^a-z]|$)/i,
    dv: /(^|[^a-z])(domestic|dv|survivors?|family violence|sexual assault|trafficking)([^a-z]|$)/i,
    allAdults: /(^|[^a-z])(all adults|adults 18\+?|anyone|all genders|single adults|singles|general|any adult|adults)([^a-z]|$)/i,
  };

  /**
   * Tags for "who it serves" filters, from the population text, name and category.
   * Places that take any adult count for both men and women.
   */
  function servesTags(record) {
    const text = `${(record && record.name) || ''} ${(record && record.population) || ''}`;
    const tags = Object.keys(SERVES).filter((k) => SERVES[k].test(text));
    if (record && record.category === 'dv_shelter' && !tags.includes('dv')) tags.push('dv');
    if (record && /youth/.test(record.category || '') && !tags.includes('youth')) tags.push('youth');
    const onlyOneGender = /\b(women only|women's only|only women|men only|men's only|only men)\b/i.test(text);
    if (tags.includes('allAdults') && !onlyOneGender) {
      if (!tags.includes('women')) tags.push('women');
      if (!tags.includes('men')) tags.push('men');
    }
    if (tags.includes('dv') && !tags.includes('women')) tags.push('women');
    return tags;
  }

  /**
   * Split a free-text phone field into callable numbers with labels.
   * "24-hr hotline (775) 322-3466; office (775) 324-3766" →
   *   [{ number: '7753223466', display: '(775) 322-3466', label: '24-hr hotline' }, ...]
   * 3-digit lines (211, 311, 911, 988) are kept as-is.
   */
  function parsePhones(text) {
    if (!text || typeof text !== 'string') return [];
    const out = [];
    let consumed = 0; // end of the previous number and its trailing "(label)"
    [...text.matchAll(PHONE_RE)].forEach((m) => {
      const before = text.slice(consumed, m.index);
      const end = m.index + m[0].length;
      const after = text.slice(end).match(/^\s*\(([^()]*)\)/);
      const afterLabel = after && !/\d{3}/.test(after[1]) ? after[1] : '';
      consumed = afterLabel ? end + after[0].length : end;
      const label = `${before} ${afterLabel}`
        .replace(/[();,]/g, ' ')
        .replace(/\b(?:or|also|listed|and)\b|\balt\b\.?/gi, ' ')
        .replace(/(^|\s)[.:/-]+(?=\s|$)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[-:\s]+|[-:\s]+$/g, '');
      let number;
      let display;
      if (m[4]) {
        number = m[4];
        display = m[4];
      } else {
        number = `${m[1]}${m[2]}${m[3]}`;
        display = `(${m[1]}) ${m[2]}-${m[3]}`;
      }
      if (!out.some((p) => p.number === number)) out.push({ number, display, label: label || null });
    });
    // Old, secondary or policy-document numbers go last so the main Call button is the best one.
    const weak = (p) => (p.label && /\b(older|old|listed|policy|alt|county policy|previous)\b/i.test(p.label) ? 1 : 0);
    return out.map((p, i) => ({ p, i })).sort((a, b) => weak(a.p) - weak(b.p) || a.i - b.i).map((x) => x.p);
  }

  /** Remove street names / numbered addresses from free text (for confidential sites). */
  function scrubLocation(text) {
    if (text == null) return null;
    return String(text).replace(STREET_WORDS, '[location withheld]');
  }

  /** Lowercase, straighten quotes, drop apostrophes, collapse spaces — for search. */
  function normalizeSearch(text) {
    return String(text || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\u2018\u2019\u02bc'`]/g, '')
      .replace(/[^a-z0-9+]+/g, ' ')
      .trim();
  }

  function isConfidential(record) {
    if (!record) return false;
    if (CONFIDENTIAL_CATEGORIES.includes(record.category)) return true;
    return typeof record.address === 'string' && /confidential/i.test(record.address);
  }

  /**
   * Turn a research record (data/shelter-watch/housing_master.json) into a
   * public facility profile. Never infers facts the research didn't state.
   */
  function toFacility(record) {
    if (!record || !record.id || !record.name) throw new Error('Record needs id and name');
    const confidential = isConfidential(record);
    const hide = (v) => (confidential ? scrubLocation(v) : v);
    const sources = (Array.isArray(record.sources) ? record.sources : [])
      .map((u) => String(u).trim().replace(/ /g, '%20'))
      .filter((u) => /^https?:\/\//i.test(u));
    return {
      id: record.id,
      name: record.name,
      group: record.group || null,
      category: record.category || null,
      operator: record.operator || null,
      population: hide(record.population || null),
      address: confidential ? 'Confidential — call for intake' : record.address || null,
      city: record.city || null,
      phone: record.phone || null,
      phones: parsePhones(record.phone),
      serves: servesTags(record),
      website: record.website || null,
      howToApply: hide(record.how_to_apply || null),
      units: confidential || record.units == null ? null : record.units,
      status: record.status || null,
      waitlist: record.waitlist_status || null,
      rent: record.typical_rent || record.cost || null,
      funding: record.funding || null,
      researchConfidence: record.confidence || 'low',
      // Notes and source links can reveal where a confidential site is, so they are withheld.
      researchNotes: confidential ? null : record.notes || null,
      sources: confidential ? [] : sources,
      confidential,
      establishmentAskedAt: null, // set when Shelter Watch requests facts from the operator
      leadership: [],
      facts: emptyFacts(),
    };
  }

  return {
    DIMENSIONS,
    DIMENSION_KEYS,
    FACTS,
    FACT_KEYS,
    RESIDENT_REPORTABLE,
    CONFIDENTIAL_CATEGORIES,
    emptyFacts,
    isConfidential,
    parsePhones,
    servesTags,
    scrubLocation,
    normalizeSearch,
    toFacility,
  };
});
