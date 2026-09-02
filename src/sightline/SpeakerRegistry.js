/**
 * SpeakerRegistry.js — who is in the room, and what standing they carry.
 *
 * Identity is resolved cheapest-first:
 *   1. The user told us (always wins).
 *   2. A voiceprint matched from a previous session.
 *   3. A faceprint matched from a previous session — consent-gated, opt-in per
 *      person, never enabled by default.
 *   4. Self-introduction detected in the transcript ("I'm Ben with RISE").
 *
 * Biometric templates never leave the machine and are stored as opaque vectors
 * with no recoverable image or audio. See Consent.js for why that matters.
 *
 * AUTHORITY IS INFERRED FROM WHAT PEOPLE SAY, NOT HOW THEY CARRY THEMSELVES.
 * Demeanor-based ranking encodes class and race bias and would be indefensible
 * if it ever surfaced. What people actually claim — budget control, the ability
 * to approve, policy ownership — is observable, quotable, and correctable.
 */

'use strict';

const RANKS = {
  executive: { tier: 5, label: 'Executive / Director', color: '#FFC400' },
  manager:   { tier: 4, label: 'Manager / Coordinator', color: '#00E5FF' },
  staff:     { tier: 3, label: 'Staff', color: '#7CFF3D' },
  peer:      { tier: 2, label: 'Lived Experience / Peer', color: '#B388FF' },
  guest:     { tier: 1, label: 'Guest', color: '#9EB0C4' },
  unknown:   { tier: 0, label: 'Unidentified', color: '#5A6B80' },
};

// Phrases that reveal standing. Weighted; evidence is always retained.
const AUTHORITY_SIGNALS = [
  { re: /\bi (?:can |will )?(?:approve|sign off|authorize|greenlight)\b/i, rank: 'executive', weight: 0.9, why: 'claims approval authority' },
  { re: /\b(?:my|our) budget\b|\bi control the budget\b|\bi allocate\b/i, rank: 'executive', weight: 0.85, why: 'claims budget control' },
  { re: /\bi'?ll take (?:that|this) to (?:the )?board\b|\breport to the board\b/i, rank: 'executive', weight: 0.7, why: 'board-level reporting' },
  { re: /\bmy team\b|\bmy staff\b|\bi supervise\b|\bdirect reports?\b/i, rank: 'manager', weight: 0.75, why: 'supervises others' },
  { re: /\bi'?ll assign\b|\bi'?ll put (?:someone|somebody) on\b/i, rank: 'manager', weight: 0.7, why: 'assigns work' },
  { re: /\bi'?ll need to check with\b|\bi'?ll have to ask\b|\bthat'?s above my\b/i, rank: 'staff', weight: 0.6, why: 'defers upward' },
  { re: /\bwhen i was (?:unsheltered|homeless|on the street)\b|\bmy lived experience\b/i, rank: 'peer', weight: 0.8, why: 'speaks from lived experience' },
];

class SpeakerRegistry {
  /**
   * @param {object} opts
   * @param {import('./Workspace').Workspace} opts.workspace
   * @param {import('./Consent').ConsentLedger} [opts.consent]
   */
  constructor({ workspace, consent = null } = {}) {
    if (!workspace) throw new Error('SpeakerRegistry requires a workspace');
    this.workspace = workspace;
    this.consent = consent;
    this.people = new Map();
  }

  /**
   * Create or update a person.
   * @param {string} id
   * @param {object} fields {displayName, org, title, rank, notes}
   */
  upsert(id, fields = {}) {
    const existing = this.people.get(id) || {
      id,
      displayName: null,
      org: null,
      title: null,
      rank: 'unknown',
      rankSource: 'default',
      evidence: [],
      voiceprint: null,
      faceprint: null,
      firstSeen: Date.now(),
    };
    // Drop undefined values so a partial update never erases a known field.
    const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const merged = Object.assign(existing, defined, { workspace: this.workspace.id });
    if (fields.rank && !RANKS[fields.rank]) throw new Error(`Unknown rank: ${fields.rank}`);
    this.people.set(id, merged);
    return merged;
  }

  get(id) { return this.people.get(id) || null; }

  list() {
    return Array.from(this.people.values())
      .sort((a, b) => RANKS[b.rank].tier - RANKS[a.rank].tier);
  }

  /** Rank badge for the UI: label, tier and color. */
  badge(id) {
    const p = this.get(id);
    const rank = (p && p.rank) || 'unknown';
    return Object.assign({ rank }, RANKS[rank], {
      confident: Boolean(p && p.rankSource === 'user'),
      source: (p && p.rankSource) || 'default',
    });
  }

  /**
   * Enroll a biometric template. Refuses without consent on record.
   * @param {string} id
   * @param {'voice'|'face'} kind
   * @param {number[]} vector  Opaque embedding. No image or audio retained.
   */
  enrollBiometric(id, kind, vector) {
    if (!Array.isArray(vector) || vector.length === 0) throw new Error('vector required');
    if (!this.consent) {
      return { enrolled: false, reason: 'No consent ledger attached; biometric enrollment refused.' };
    }
    const check = this.consent.canUseBiometric(id, kind);
    if (!check.allowed) return { enrolled: false, reason: check.reason, statute: check.statute };

    const person = this.upsert(id, {});
    person[kind === 'face' ? 'faceprint' : 'voiceprint'] = {
      vector: vector.slice(),
      enrolledAt: Date.now(),
      consentMethod: this.consent.get(id).method,
    };
    return { enrolled: true, kind, id };
  }

  /** Delete a person's biometric templates. Must always be one call away. */
  forgetBiometrics(id) {
    const p = this.get(id);
    if (!p) return false;
    p.voiceprint = null;
    p.faceprint = null;
    return true;
  }

  /**
   * Match an observed embedding against enrolled templates.
   * Cosine similarity; returns null below threshold rather than guessing.
   */
  match(kind, vector, threshold = 0.82) {
    const field = kind === 'face' ? 'faceprint' : 'voiceprint';
    let best = null;
    for (const p of this.people.values()) {
      const tpl = p[field];
      if (!tpl) continue;
      const score = SpeakerRegistry.cosine(tpl.vector, vector);
      if (!best || score > best.score) best = { id: p.id, score, displayName: p.displayName };
    }
    if (!best || best.score < threshold) return null;
    return best;
  }

  /**
   * Pull a name out of a self-introduction.
   * "I'm Ben with RISE" / "This is Catrina, Washoe County".
   */
  static detectIntroduction(text) {
    const m = String(text).match(
      /\b(?:[Ii]'?m|[Ii] am|[Tt]his is|[Mm]y name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s*,?\s*(?:with|from|at|of)\s+([A-Z][A-Za-z&.'\- ]{1,40}?))?(?=\s*[.,!?]|$)/
    );
    if (!m) return null;
    return { displayName: m[1].trim(), org: m[2] ? m[2].trim() : null };
  }

  /**
   * Infer standing from what a person said. Always returns the quotes.
   * @param {string} id
   * @param {string[]} utterances
   */
  inferAuthority(id, utterances = []) {
    const scores = {};
    const evidence = [];
    for (const line of utterances) {
      for (const sig of AUTHORITY_SIGNALS) {
        if (sig.re.test(line)) {
          scores[sig.rank] = (scores[sig.rank] || 0) + sig.weight;
          evidence.push({ rank: sig.rank, why: sig.why, quote: line.trim() });
        }
      }
    }
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    if (!ranked.length) {
      return { id, rank: null, confidence: 0, evidence: [], note: 'No authority signals in what was said.' };
    }
    const [rank, score] = ranked[0];
    const total = ranked.reduce((a, [, s]) => a + s, 0);
    const result = {
      id,
      rank,
      confidence: Number((score / total).toFixed(2)),
      evidence: evidence.filter((e) => e.rank === rank),
      note: 'Inferred from statements made, not from demeanor. Confirm before relying on it.',
    };
    // Create the row if this is the first thing we have learned about them —
    // a speaker who never introduced themselves still gets a record.
    const person = this.get(id) || this.upsert(id, {});
    if (person.rankSource !== 'user') {
      this.upsert(id, { rank, rankSource: 'inferred', evidence: result.evidence });
    }
    return result;
  }

  static cosine(a, b) {
    const n = Math.min(a.length, b.length);
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < n; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
}

module.exports = { SpeakerRegistry, RANKS, AUTHORITY_SIGNALS };
