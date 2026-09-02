/**
 * Redaction.js — strip identifying detail before anything leaves the session.
 *
 * Any transcript touching coordinated entry, HMIS or a named person receiving
 * services carries confidentiality obligations that outlive the meeting. This
 * runs before export, before routing to a project, and before any text is sent
 * to a model API.
 *
 * Redaction is reversible only inside the session — the map lives in memory and
 * dies with the two-hour buffer.
 */

'use strict';

const PATTERNS = [
  { kind: 'ssn',    re: /\b\d{3}-\d{2}-\d{4}\b/g,                                   token: 'SSN' },
  { kind: 'dob',    re: /\b(?:0?[1-9]|1[0-2])[\/-](?:0?[1-9]|[12]\d|3[01])[\/-](?:19|20)\d{2}\b/g, token: 'DOB' },
  { kind: 'phone',  re: /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g,    token: 'PHONE' },
  { kind: 'email',  re: /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g,                          token: 'EMAIL' },
  { kind: 'hmis',   re: /\b(?:HMIS|client)\s*(?:id|#|number)?\s*[:#]?\s*\d{4,}\b/gi, token: 'HMIS_ID' },
  { kind: 'address',re: /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Way|Ct|Court)\b\.?/g, token: 'ADDRESS' },
];

class Redactor {
  /**
   * @param {object} [opts]
   * @param {string[]} [opts.protectedNames] Names of people receiving services.
   * @param {boolean} [opts.initialsForNames=true] Replace with initials rather
   *   than a token, so the transcript stays readable.
   */
  constructor({ protectedNames = [], initialsForNames = true } = {}) {
    this.protectedNames = protectedNames;
    this.initialsForNames = initialsForNames;
    this.map = new Map();
    this.counters = {};
  }

  redact(text) {
    let out = String(text || '');
    const found = [];

    for (const p of PATTERNS) {
      out = out.replace(p.re, (match) => {
        const placeholder = this._token(p.token, match);
        found.push({ kind: p.kind, placeholder });
        return placeholder;
      });
    }

    for (const name of this.protectedNames) {
      const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      out = out.replace(re, (match) => {
        const initials = name.split(/\s+/).map((w) => w[0].toUpperCase()).join('.') + '.';
        const placeholder = this.initialsForNames ? initials : this._token('NAME', match);
        this.map.set(placeholder, match);
        found.push({ kind: 'name', placeholder });
        return placeholder;
      });
    }

    return { text: out, found, clean: found.length === 0 };
  }

  /** Reverse a redaction. Only works inside the live session. */
  restore(text) {
    let out = String(text || '');
    for (const [placeholder, original] of this.map) {
      out = out.split(placeholder).join(original);
    }
    return out;
  }

  /** Does this text contain anything that must not be exported as-is? */
  static scan(text) {
    return PATTERNS
      .filter((p) => { p.re.lastIndex = 0; return p.re.test(String(text || '')); })
      .map((p) => p.kind);
  }

  forget() { this.map.clear(); this.counters = {}; }

  _token(prefix, original) {
    this.counters[prefix] = (this.counters[prefix] || 0) + 1;
    const placeholder = `[${prefix}_${this.counters[prefix]}]`;
    this.map.set(placeholder, original);
    return placeholder;
  }
}

module.exports = { Redactor, PATTERNS };
