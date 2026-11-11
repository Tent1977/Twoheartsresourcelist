/**
 * Shelter Watch — comment moderation ("post now, flag later").
 *
 * Comments go live immediately unless they trip an automatic safety screen
 * (personal contact info, threats, a street address on a confidential site).
 * Anyone can report a live comment; once REPORT_THRESHOLD different people
 * report it, it is hidden until a moderator reviews it.
 */
(function (root, factory) {
  const schema = typeof module === 'object' && module.exports ? require('./schema') : root.ShelterWatch.schema;
  const mod = factory(schema);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else (root.ShelterWatch = root.ShelterWatch || {}).moderation = mod;
})(typeof self !== 'undefined' ? self : this, function (schema) {
  const REPORT_THRESHOLD = 3;
  const MAX_LENGTH = 3000;
  const MIN_LENGTH = 10;

  const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
  const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
  const THREAT = /\b(i(?:'m| am)? (?:going to|gonna|will) (?:kill|hurt|shoot|stab|beat)|burn (?:it|this place) down|(?:kill|shoot|stab) (?:him|her|them|you)\b)/i;
  const STREET = /\b\d{2,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Way|Ln|Lane|Ct|Court)\b/;

  /**
   * Screen comment text. Returns { status: 'visible' | 'held', reasons: [] }.
   * `held` comments are saved but not shown until a moderator approves them.
   */
  function screen(text, { confidential = false } = {}) {
    const reasons = [];
    const t = String(text || '');
    if (PHONE.test(t)) reasons.push('Contains a phone number');
    if (EMAIL.test(t)) reasons.push('Contains an email address');
    if (THREAT.test(t)) reasons.push('Possible threat of violence');
    if (confidential && STREET.test(t)) reasons.push('Street address on a confidential site');
    return { status: reasons.length ? 'held' : 'visible', reasons };
  }

  /**
   * Validate a new comment. Throws on bad input; returns the cleaned comment
   * with its moderation status set.
   */
  function prepareComment(input, { confidential = false } = {}) {
    if (!input || typeof input !== 'object') throw new Error('Comment is required');
    const text = String(input.text || '').trim();
    if (text.length < MIN_LENGTH) throw new Error(`Comment must be at least ${MIN_LENGTH} characters`);
    if (text.length > MAX_LENGTH) throw new Error(`Comment must be under ${MAX_LENGTH} characters`);
    if (!input.facilityId) throw new Error('facilityId is required');

    const relationship = ['current_resident', 'former_resident', 'staff', 'family_or_friend', 'service_provider', 'other'];
    if (!relationship.includes(input.relationship)) throw new Error('Pick how you know this place');

    const ratings = {};
    Object.entries(input.ratings || {}).forEach(([k, v]) => {
      if (!schema.DIMENSION_KEYS.includes(k)) throw new Error(`Unknown rating: ${k}`);
      if (v === null || v === undefined || v === '') return;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`Rating ${k} must be 1–5`);
      ratings[k] = n;
    });

    const facts = {};
    Object.entries(input.facts || {}).forEach(([k, v]) => {
      if (!schema.RESIDENT_REPORTABLE.includes(k)) throw new Error(`Unknown fact: ${k}`);
      if (v === null || v === undefined || v === '') return;
      const def = schema.FACTS.find((f) => f.key === k);
      if (!def.options.includes(v)) throw new Error(`Invalid value for ${k}`);
      facts[k] = v;
    });

    const { status, reasons } = screen(text, { confidential });
    return {
      facilityId: String(input.facilityId),
      text,
      relationship: input.relationship,
      ratings,
      facts,
      status,
      heldReasons: reasons,
      reports: [],
      createdAt: input.createdAt || new Date().toISOString(),
    };
  }

  /** Record a report from `reporterId`. One report per person. Returns a new comment object. */
  function report(comment, reporterId) {
    if (!reporterId) throw new Error('reporterId is required');
    const reports = Array.isArray(comment.reports) ? comment.reports : [];
    if (reports.includes(reporterId)) return comment;
    return { ...comment, reports: [...reports, reporterId] };
  }

  /** Should this comment be shown to the public? */
  function isPublic(comment) {
    if (!comment) return false;
    if (comment.status === 'approved') return true; // moderator cleared it
    if (comment.status !== 'visible') return false; // held or removed
    return (comment.reports || []).length < REPORT_THRESHOLD;
  }

  return { REPORT_THRESHOLD, MAX_LENGTH, MIN_LENGTH, screen, prepareComment, report, isPublic };
});
