/**
 * VerificationFlags.js — consistency and verifiability, not deception.
 *
 * WHY THIS IS NOT A LIE DETECTOR, DELIBERATELY:
 * Demeanor- and language-based deception detection does not work. The standing
 * meta-analysis (Bond & DePaulo 2006, 206 studies) puts human accuracy at ~54%
 * against a 50% baseline, and cue-based models do not reliably beat it. A tool
 * that told a facilitator "this person is probably lying" would be wrong close
 * to half the time, would fall hardest on people who are nervous, disabled,
 * traumatised or not speaking their first language, and would end the
 * relationship the moment anyone found out it existed.
 *
 * What IS observable and defensible:
 *   - a speaker said 30 units at 10:04 and 20 units at 10:41       -> contradiction
 *   - a speaker contradicted a document we hold                     -> conflicts with record
 *   - a number arrived with no source attached                      -> unsourced
 *   - a commitment landed with no owner or no date                  -> soft commitment
 *   - an answer did not address the question that was asked         -> unanswered
 *
 * Every flag carries the exact quotes. The user decides what it means.
 */

'use strict';

const { ENQUIRY_MOVES } = require('./Rhetoric');

const SEVERITY = { info: 1, watch: 2, check: 3 };

class VerificationLedger {
  /**
   * @param {object} [opts]
   * @param {Array<{subject:string, value:string|number, source:string}>} [opts.records]
   *   Facts already on file — PIT counts, budget lines, prior minutes.
   */
  constructor({ records = [] } = {}) {
    this.records = records;
    this.claims = [];
    this.flags = [];
    this.pendingQuestions = [];
    this.seq = 0;
  }

  /**
   * Ingest one classified sentence attributed to a speaker.
   * @param {object} sentence  from Rhetoric.classify()
   * @param {object} ctx {speaker, turnId, atMs}
   */
  ingest(sentence, ctx = {}) {
    const produced = [];
    const text = sentence.text;
    const speaker = ctx.speaker || 'unknown';

    if (ENQUIRY_MOVES.includes(sentence.move)) {
      this.pendingQuestions.push({ text, speaker, turnId: ctx.turnId, atMs: ctx.atMs });
      return produced;
    }

    // An assertion answers whatever question is outstanding.
    if (this.pendingQuestions.length && sentence.wordCount > 3) {
      const q = this.pendingQuestions[0];
      if (q.speaker !== speaker) {
        const overlap = VerificationLedger._overlap(q.text, text);
        if (overlap < 0.12) {
          produced.push(this._flag({
            type: 'unanswered',
            severity: 'watch',
            speaker,
            summary: 'The reply does not appear to address the question that was asked.',
            quotes: [{ label: 'asked', by: q.speaker, text: q.text }, { label: 'replied', by: speaker, text }],
            suggestedFollowUp: `Re-ask directly: "${q.text.trim()}"`,
          }));
        }
        this.pendingQuestions.shift();
      }
    }

    const numbers = VerificationLedger._numbers(text);
    const subject = VerificationLedger._subject(text, numbers);

    if (numbers.length) {
      // 1. Same speaker, same subject, different number.
      const prior = this.claims.find(
        (c) => c.speaker === speaker && c.subject === subject && c.numbers.length &&
               c.numbers[0].value !== numbers[0].value
      );
      if (prior) {
        produced.push(this._flag({
          type: 'contradiction',
          severity: 'check',
          speaker,
          summary: `${speaker} gave a different figure for "${subject}" earlier in this meeting.`,
          quotes: [{ label: 'earlier', by: speaker, text: prior.text }, { label: 'now', by: speaker, text }],
          suggestedFollowUp: `Ask which figure is current: ${prior.numbers[0].raw} or ${numbers[0].raw}?`,
        }));
      }

      // 2. Conflicts with something we hold on file.
      const record = this.records.find((r) => subject && String(r.subject).toLowerCase().includes(subject));
      if (record && String(record.value) !== String(numbers[0].value)) {
        produced.push(this._flag({
          type: 'conflicts-with-record',
          severity: 'check',
          speaker,
          summary: `Stated ${numbers[0].raw} for "${subject}"; our record says ${record.value}.`,
          quotes: [{ label: 'said', by: speaker, text }],
          record,
          suggestedFollowUp: `Cite the record: "${record.source} has ${record.value} — has that changed?"`,
        }));
      }

      // 3. A number with no source attached.
      if (!/\b(?:according to|per |source|the report|hud|pit count|census|our data|we counted|as of)\b/i.test(text)) {
        produced.push(this._flag({
          type: 'unsourced',
          severity: 'info',
          speaker,
          summary: `Figure ${numbers[0].raw} arrived without a source.`,
          quotes: [{ label: 'said', by: speaker, text }],
          suggestedFollowUp: 'Ask where the number comes from before it ends up in a grant application.',
        }));
      }
    }

    // 4. A commitment with no owner or no date.
    if (sentence.move === 'commitment' || sentence.move === 'action-item') {
      const hasDate = /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|next week|end of (?:day|week|month)|by the \d+|\d{1,2}\/\d{1,2})\b/i.test(text);
      const hasOwner = /\b(?:i|we|i'?ll|we'?ll)\b/i.test(text) || /\b[A-Z][a-z]+ will\b/.test(text);
      if (!hasDate || !hasOwner) {
        produced.push(this._flag({
          type: 'soft-commitment',
          severity: 'watch',
          speaker,
          summary: `Commitment missing ${!hasOwner ? 'an owner' : ''}${!hasOwner && !hasDate ? ' and ' : ''}${!hasDate ? 'a date' : ''}.`,
          quotes: [{ label: 'said', by: speaker, text }],
          suggestedFollowUp: !hasDate
            ? 'Pin a date to it before the meeting ends.'
            : 'Name who owns it before the meeting ends.',
        }));
      }
    }

    this.claims.push({ speaker, text, subject, numbers, turnId: ctx.turnId, atMs: ctx.atMs, move: sentence.move });
    return produced;
  }

  /** Flags sorted most-urgent first. */
  open({ minSeverity = 'info' } = {}) {
    const floor = SEVERITY[minSeverity] || 1;
    return this.flags
      .filter((f) => !f.dismissed && SEVERITY[f.severity] >= floor)
      .sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity] || b.at - a.at);
  }

  dismiss(flagId, reason = '') {
    const f = this.flags.find((x) => x.id === flagId);
    if (!f) return null;
    f.dismissed = true;
    f.dismissReason = reason;
    return f;
  }

  _flag(fields) {
    // The same pair of statements can match on more than one pass. Raise the
    // observation once — a list with the same flag twice reads as two problems.
    const signature = `${fields.type}|${fields.speaker}|${(fields.quotes || []).map((q) => q.text).join('~')}`;
    const existing = this.flags.find((f) => f.signature === signature);
    if (existing) return existing;

    const flag = Object.assign({
      signature,
      id: `f${++this.seq}`,
      at: Date.now(),
      dismissed: false,
      // Stated on every flag so it cannot be quoted out of context.
      disclaimer: 'This is a consistency observation, not an accusation. People misremember, numbers get revised, and context is missing.',
    }, fields);
    this.flags.push(flag);
    return flag;
  }

  static _numbers(text) {
    const out = [];
    const re = /\$?\b\d[\d,]*(?:\.\d+)?\s*(?:%|percent|k|million|beds|units|spots|people|clients|households)?\b/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const raw = m[0].trim();
      const value = parseFloat(raw.replace(/[$,]/g, ''));
      if (!Number.isNaN(value)) out.push({ raw, value });
    }
    return out;
  }

  /**
   * What the sentence is a claim ABOUT.
   *
   * When a number is present the subject is the noun the number modifies, not
   * the last word of the sentence — "30 parking spots at the fairgrounds" is a
   * claim about spots, not about fairgrounds. Getting this wrong is what makes
   * contradiction detection miss.
   */
  static _subject(text, numbers = []) {
    const stop = new Set(['about', 'there', 'their', 'which', 'would', 'could', 'should',
      'think', 'right', 'thing', 'those', 'these', 'going', 'really', 'because', 'people',
      'parking', 'total', 'roughly', 'around', 'approximately']);
    const clean = String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');

    if (numbers.length) {
      const digits = String(numbers[0].value).split('.')[0];
      const idx = clean.indexOf(digits);
      if (idx !== -1) {
        const after = clean.slice(idx + digits.length).split(/\s+/)
          .filter((w) => w.length > 3 && !stop.has(w));
        if (after.length) return after[0];
      }
    }
    const words = clean.split(/\s+/).filter((w) => w.length > 4 && !stop.has(w));
    return words.length ? words[words.length - 1] : null;
  }

  static _overlap(a, b) {
    const norm = (s) => new Set(String(s).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3));
    const A = norm(a); const B = norm(b);
    if (!A.size || !B.size) return 0;
    let hit = 0;
    for (const w of A) if (B.has(w)) hit += 1;
    return hit / A.size;
  }
}

module.exports = { VerificationLedger, SEVERITY };
