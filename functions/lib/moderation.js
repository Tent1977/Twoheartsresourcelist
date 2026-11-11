/**
 * Shelter Watch — comment moderation ("post now, flag later").
 *
 * Comments go live immediately unless they trip an automatic safety screen
 * (personal contact info, threats against a person, a location on a
 * confidential site). Reviews of confidential (DV) sites are always held for
 * a moderator, because any detail could help someone find a survivor.
 * Anyone can report a live comment; once REPORT_THRESHOLD different people
 * report it, it is hidden until a moderator reviews it.
 *
 * The browser runs this screen for instant feedback; the server
 * (functions/index.js) runs the same screen again because a browser check
 * can be bypassed.
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
  const RELATIONSHIPS = ['current_resident', 'former_resident', 'staff', 'family_or_friend', 'service_provider', 'other'];
  const PUBLIC_STATUSES = ['visible', 'approved'];

  const DIGIT_WORDS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  const INVISIBLE = /[​-‏⁠-⁤﻿­\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

  /** Strip invisible characters and fold look-alike characters (full-width digits etc.). */
  function clean(text) {
    return String(text == null ? '' : text).normalize('NFKC').replace(INVISIBLE, '');
  }

  /** Version used only for detection: digit words → digits, "dot"/"at" spelled out → symbols. */
  function forDetection(text) {
    return clean(text)
      .toLowerCase()
      .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => String(DIGIT_WORDS[w]))
      .replace(/\s*[([]\s*at\s*[)\]]\s*|\s+at\s+(?=[a-z0-9-]+\s*(?:\.|dot)\s*[a-z]{2,}\b)/g, '@')
      .replace(/\s*[([]?\s*dot\s*[)\]]?\s*(?=[a-z]{2,}\b)/g, '.');
  }

  const PHONE = /(?:\d[^\da-z]{0,3}){9}\d/; // 10 digits with any separators
  const EMAIL = /[\w.+-]+\s*@\s*[\w-]+\s*\.\s*[a-z]{2,}/;
  const PERSON = '(?:him|her|them|you|u|y\'?all|everyone|everybody|somebody|someone|that (?:\\w+)|the (?:manager|staff|director|guard|case ?manager|owner|landlord|bitch|guy|lady|man|woman)|my (?:roommate|neighbor|case ?manager))';
  const THREATS = [
    new RegExp(`\\b(?:kill|murder|shoot|stab|beat(?: up)?|hurt|choke|strangle|jump)\\s+${PERSON}\\b(?!\\s+with kindness)`),
    /\bburn\s+(?:it|this place|the place|the building|this (?:\w+)|that (?:\w+))\s+down\b/,
    /\b(?:find|know|found) (?:out )?where (?:you|he|she|they) (?:live|sleep|stay)s?\b/,
    /\b(?:bring|get) (?:a|my) (?:gun|knife|piece)\b/,
  ];
  const STREET =
    /\b\d{1,6}\s+(?:[nsew]\.?\s+|north\s+|south\s+|east\s+|west\s+)?(?:[a-z]+\s+){1,3}(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|way|ln|lane|ct|court|pl|place|pkwy|cir|circle)\b|\b(?:on|off|near|by)\s+[a-z]+\s+(?:near|and|&|by|off)\s+[a-z]+\b/;

  /**
   * Screen comment text. Returns { status: 'visible' | 'held', reasons: [] }.
   * `allowNumbers`: digits-only phone numbers that are fine to post (e.g. the
   * facility's own public line).
   */
  function screen(text, { confidential = false, allowNumbers = [] } = {}) {
    const reasons = [];
    const t = forDetection(text);
    let phoneScan = t;
    allowNumbers.forEach((n) => {
      const digits = String(n).replace(/\D/g, '');
      if (digits.length < 7) return;
      const loose = new RegExp(digits.split('').join('[^\\da-z]{0,3}'), 'g');
      phoneScan = phoneScan.replace(loose, ' ');
    });
    if (PHONE.test(phoneScan)) reasons.push('Contains a phone number');
    if (EMAIL.test(t)) reasons.push('Contains an email address');
    if (THREATS.some((re) => re.test(t))) reasons.push('Possible threat of violence');
    if (confidential) {
      if (STREET.test(t)) reasons.push('Mentions a location on a confidential site');
      reasons.push('Reviews of confidential sites are checked by a moderator first');
    }
    return { status: reasons.length ? 'held' : 'visible', reasons };
  }

  function validRating(v) {
    return Number.isInteger(v) && v >= 1 && v <= 5;
  }

  /** Keep only known rating keys with integer values 1–5 (drops anything else silently). */
  function sanitizeRatings(ratings) {
    const out = {};
    if (!ratings || typeof ratings !== 'object') return out;
    schema.DIMENSION_KEYS.forEach((k) => {
      if (validRating(ratings[k])) out[k] = ratings[k];
    });
    return out;
  }

  /** Keep only reportable fact keys with allowed values. */
  function sanitizeFacts(facts) {
    const out = {};
    if (!facts || typeof facts !== 'object') return out;
    schema.FACTS.forEach((f) => {
      if (f.options && f.options.includes(facts[f.key])) out[f.key] = facts[f.key];
    });
    return out;
  }

  /**
   * Validate a new comment. Throws on bad input; returns the cleaned comment
   * with its moderation status set.
   */
  function prepareComment(input, { confidential = false, allowNumbers = [] } = {}) {
    if (!input || typeof input !== 'object') throw new Error('Please write a review first.');
    const text = clean(input.text).trim();
    if (text.length < MIN_LENGTH) throw new Error(`Please write at least ${MIN_LENGTH} characters.`);
    if (text.length > MAX_LENGTH) throw new Error(`Please keep it under ${MAX_LENGTH} characters.`);
    if (!input.facilityId) throw new Error('facilityId is required');
    if (!RELATIONSHIPS.includes(input.relationship)) throw new Error('Please pick how you know this place.');

    const ratings = {};
    Object.entries(input.ratings || {}).forEach(([k, v]) => {
      if (!schema.DIMENSION_KEYS.includes(k)) throw new Error(`Unknown rating: ${k}`);
      if (v === null || v === undefined || v === '') return;
      const n = Number(v);
      if (!validRating(n)) throw new Error(`Rating ${k} must be 1–5`);
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

    const { status, reasons } = screen(text, { confidential, allowNumbers });
    return {
      facilityId: String(input.facilityId),
      text,
      relationship: input.relationship,
      ratings,
      facts,
      status,
      heldReasons: reasons,
      reportCount: 0,
      createdAt: input.createdAt || new Date().toISOString(),
    };
  }

  /**
   * Make a stored comment safe to use, or return null if it's unusable.
   * Anything read from storage or the network goes through this first.
   */
  function sanitizeStored(c) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    if (typeof c.facilityId !== 'string' || typeof c.text !== 'string') return null;
    const created = Date.parse(c.createdAt);
    const now = Date.now();
    return {
      id: typeof c.id === 'string' ? c.id : null,
      facilityId: c.facilityId,
      text: clean(c.text).slice(0, MAX_LENGTH),
      relationship: RELATIONSHIPS.includes(c.relationship) ? c.relationship : 'other',
      ratings: sanitizeRatings(c.ratings),
      facts: sanitizeFacts(c.facts),
      status: typeof c.status === 'string' ? c.status : 'held',
      reportCount: Number.isInteger(c.reportCount) && c.reportCount >= 0 ? c.reportCount : 0,
      // A date in the future or unparseable is treated as "now" so it can't pin itself to the top.
      createdAt: new Date(Number.isNaN(created) || created > now ? now : created).toISOString(),
      authorKey: typeof c.authorKey === 'string' ? c.authorKey : null,
    };
  }

  /** Add one report. Callers must make sure each person reports once (the server rules enforce it). */
  function addReport(comment) {
    return { ...comment, reportCount: (Number(comment.reportCount) || 0) + 1 };
  }

  /** Should this comment be shown to the public? */
  function isPublic(comment) {
    if (!comment) return false;
    if (comment.status === 'approved') return true; // moderator cleared it
    if (comment.status !== 'visible') return false; // held, hidden or removed
    return (Number(comment.reportCount) || 0) < REPORT_THRESHOLD;
  }

  return {
    REPORT_THRESHOLD,
    MAX_LENGTH,
    MIN_LENGTH,
    RELATIONSHIPS,
    PUBLIC_STATUSES,
    clean,
    screen,
    sanitizeRatings,
    sanitizeFacts,
    sanitizeStored,
    prepareComment,
    addReport,
    isPublic,
  };
});
