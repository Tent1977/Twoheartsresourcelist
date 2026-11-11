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

  const TLD = '(?:com|org|net|edu|gov|us|io|me|co|info|biz)';
  const SEP = '[\\s.\\-_/\\u2010-\\u2015~]{0,5}';

  /** Version used only for detection: digit words → digits, spelled-out emails → symbols. */
  function forDetection(text) {
    return clean(text)
      .toLowerCase()
      .replace(/\p{Nd}/gu, (d) => String(Number.parseInt(d, 10) || (/\d/.test(d) ? d : '0')))
      .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => String(DIGIT_WORDS[w]))
      .replace(/(?<=\d)[o](?=\d)|(?<=\d)[o]\b/g, '0')
      .replace(/(?<=\d)[li](?=\d)/g, '1')
      .replace(/\b(?=[\dlio]*\d[\dlio]*\d)[\dlio]{3,4}\b/g, (w) => w.replace(/[li]/g, '1').replace(/o/g, '0'))
      .replace(/\b(\d)\s+(?=\d\b)/g, '$1') // "7 7 5" → "775"
      .replace(new RegExp(`\\s*[([]\\s*at\\s*[)\\]]\\s*|\\s+at\\s+(?=[a-z0-9-]+\\s*(?:\\.|\\(?dot\\)?)\\s*${TLD}\\b)`, 'g'), '@')
      .replace(new RegExp(`\\s*[([]?\\s*\\bdot\\b\\s*[)\\]]?\\s*(?=${TLD}\\b)`, 'g'), '.');
  }

  /** Letters swapped for look-alike digits ("k1ll") are folded back, for the threat check only. */
  const unLeet = (t) => t.replace(/(?<=[a-z])1(?=[a-z])/g, 'i').replace(/(?<=[a-z])0(?=[a-z])/g, 'o').replace(/(?<=[a-z])3(?=[a-z])/g, 'e');

  // Phone-shaped only: 3-3-4 digits. Year ranges ("2019-2023") and room lists don't match.
  const PHONE = new RegExp(`(?:^|[^\\d])\\(?\\d{3}\\)?${SEP}\\d{3}${SEP}\\d{4}(?!\\d)`);
  const EMAIL = new RegExp(`[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)*\\.${TLD}\\b|[\\w.+-]+@[\\w-]+\\.[a-z]{2,}\\b`);
  const EMAIL_SPACED = new RegExp(`@[a-z0-9-]+\\.${TLD}\\b`);
  const HANDLE = /\b(?:ig|insta|instagram|snap|snapchat|tiktok|fb|facebook|whatsapp|telegram|cashapp)\s*[:@-]?\s*@?[a-z0-9_.]{3,}/;
  const PERSON =
    "(?:him|her|them|you|u|ya|y'?all|everyone|everybody|somebody|someone|this (?:place|bitch|guy|lady|dude)|that (?:\\w+)|the (?:\\w+ )?(?:manager|staff|director|guard|case ?manager|owner|landlord|bitch|guy|lady|man|woman|dude|cop)|ur (?:\\w+)|your (?:\\w+)|my (?:roommate|neighbor|case ?manager))";
  const INTENT = "(?:i'?ll|i will|i'?m (?:gonna|going to|about to)|i'?d|imma|ima|gonna|going to|finna|we'?ll|we will|we'?re gonna|should|someone should|wanna|want to|i'?m finna|let'?s|about to)";
  const THREATS = [
    new RegExp(`\\b${INTENT}\\s+(?:\\w+\\s+){0,2}(?:kill|murder|shoot|stab|beat(?: up)?|hurt|choke|strangle|jump|end|smoke|cut|slap|punch)\\s+${PERSON}\\b(?!\\s+with kindness)`),
    new RegExp(`\\b(?:kill|shoot|stab|end)\\s+(?:ur|your|that) \\w+\\b`),
    /\bshoot (?:up )?(?:this|the) (?:place|building|shelter)\b|\bshoot (?:this|the) (?:place|building|shelter) up\b/,
    /\bburn\s+(?:it|this place|the place|the building|this (?:\w+)|that (?:\w+))\s+down\b|\bburn down (?:the|this) (?:place|building|shelter)\b/,
    /\b(?:find|know|found) (?:out )?where (?:you|he|she|they|the \w+|that \w+) (?:live|sleep|stay)s?\b/,
    /\b(?:bring|get|got) (?:a|my) (?:gun|knife|piece|strap)\b/,
  ];
  const SELF_HARM =
    /\b(?:kill(?:ing)? myself|end(?:ing)? (?:my life|it all)|suicid\w*|want to die|wanna die|don'?t want to (?:live|be here)|hurt(?:ing)? myself|self[- ]harm)\b/;
  const STREET =
    /\b\d{1,6}(?:st|nd|rd|th)?\s+(?:[nsew]\.?\s+|north\s+|south\s+|east\s+|west\s+)?(?:[a-z]+\s+){0,3}(?:st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|way|ln|lane|ct|court|pl|place|pkwy|cir|circle)\b|\b\d{1,2}(?:st|nd|rd|th)\s+(?:st|street|ave|avenue)\b|\b(?:on|off|near|by|at|behind|across from)\s+(?:the\s+)?[a-z]+(?:\s+(?:st|street|ave|avenue|rd|road|dr|drive|blvd|way|ln|lane))?\s+(?:near|and|&|by|off|at)\s+[a-z]+\b|\b(?:corner of|cross streets?|intersection of)\b/;

  /** True when a review mentions self-harm, so the page can offer 988. Never holds the review. */
  function mentionsSelfHarm(text) {
    return SELF_HARM.test(clean(text).toLowerCase());
  }

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
      const loose = new RegExp(digits.split('').join(SEP), 'g');
      phoneScan = phoneScan.replace(loose, ' ');
    });
    if (PHONE.test(phoneScan)) reasons.push('Contains a phone number');
    if (EMAIL.test(t) || EMAIL_SPACED.test(t.replace(/\s+/g, '')) || HANDLE.test(t)) reasons.push('Contains an email or social media handle');
    const threatText = unLeet(t);
    if (THREATS.some((re) => re.test(threatText))) reasons.push('Possible threat against someone');
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
    mentionsSelfHarm,
    sanitizeRatings,
    sanitizeFacts,
    sanitizeStored,
    prepareComment,
    addReport,
    isPublic,
  };
});
