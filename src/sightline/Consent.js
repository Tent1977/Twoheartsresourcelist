/**
 * Consent.js — the legal gate. Nothing records until this says yes.
 *
 * Two separate gates, because they are two separate bodies of law:
 *
 *  1. RECORDING consent. Nevada NRS 200.620 requires the consent of ALL parties
 *     to record a wire communication (phone/VoIP); NRS 200.650 makes it unlawful
 *     to surreptitiously listen to or record a private in-person conversation
 *     without the consent of a person present. Treat Nevada as all-party.
 *
 *  2. BIOMETRIC consent. Face and voice templates are biometric identifiers.
 *     Illinois BIPA (740 ILCS 14) requires written release BEFORE capture and
 *     carries a private right of action; Texas CUBI and Washington HB 1493 are
 *     similar without the private action. Nevada NRS 603A treats biometric data
 *     as personal information for breach/security duties.
 *
 * This module does not give legal advice. It refuses to let the app do the
 * obviously illegal thing, and it makes the record of who agreed to what.
 */

'use strict';

// States requiring all-party consent for recording. Nevada is here on the
// strength of NRS 200.620's all-party rule for wire communications.
const ALL_PARTY_STATES = [
  'CA', 'CT', 'DE', 'FL', 'IL', 'MD', 'MA', 'MI', 'MT',
  'NV', 'NH', 'OR', 'PA', 'WA',
];

// States with statutory biometric-capture regimes. IL is the sharp one.
const BIOMETRIC_STATUTE_STATES = { IL: 'BIPA', TX: 'CUBI', WA: 'HB1493', NV: 'NRS603A' };

class ConsentLedger {
  /**
   * @param {object} opts
   * @param {string} opts.jurisdiction  Two-letter state code, e.g. 'NV'.
   * @param {string} opts.workspace     'ABLE' | 'VOA'
   * @param {boolean} [opts.clientData] True if unsheltered-neighbor / client
   *   information may be discussed. Raises the bar regardless of state law.
   */
  constructor({ jurisdiction, workspace, clientData = false } = {}) {
    if (!jurisdiction) throw new Error('jurisdiction is required to open a consent ledger');
    this.jurisdiction = String(jurisdiction).toUpperCase();
    this.workspace = workspace;
    this.clientData = Boolean(clientData);
    this.entries = new Map();
    this.openedAt = Date.now();
  }

  get allPartyRequired() {
    return ALL_PARTY_STATES.includes(this.jurisdiction);
  }

  get biometricStatute() {
    return BIOMETRIC_STATUTE_STATES[this.jurisdiction] || null;
  }

  /**
   * Record one participant's answer.
   * @param {string} participantId
   * @param {object} grants { recording, biometricVoice, biometricFace, analysis }
   */
  record(participantId, grants = {}) {
    if (!participantId) throw new Error('participantId is required');
    const entry = {
      participantId,
      recording: grants.recording === true,
      biometricVoice: grants.biometricVoice === true,
      biometricFace: grants.biometricFace === true,
      analysis: grants.analysis === true,
      method: grants.method || 'verbal-on-record',
      at: Date.now(),
    };
    this.entries.set(participantId, entry);
    return entry;
  }

  withdraw(participantId) {
    const entry = this.entries.get(participantId);
    if (!entry) return false;
    this.entries.set(participantId, Object.assign({}, entry, {
      recording: false, biometricVoice: false, biometricFace: false,
      analysis: false, withdrawnAt: Date.now(),
    }));
    return true;
  }

  get(participantId) {
    return this.entries.get(participantId) || null;
  }

  /**
   * Can we start capturing audio?
   * @param {string[]} expectedParticipants
   * @returns {{allowed:boolean, reason:string, missing:string[], basis:string}}
   */
  canRecord(expectedParticipants = []) {
    const missing = expectedParticipants.filter((id) => {
      const e = this.entries.get(id);
      return !e || e.recording !== true;
    });

    if (this.allPartyRequired && missing.length > 0) {
      return {
        allowed: false,
        reason: `${this.jurisdiction} is an all-party consent jurisdiction; ${missing.length} participant(s) have not consented.`,
        missing,
        basis: this.jurisdiction === 'NV' ? 'NRS 200.620 / 200.650' : 'state all-party consent statute',
      };
    }
    if (!this.allPartyRequired && missing.length === expectedParticipants.length && expectedParticipants.length > 0) {
      return {
        allowed: false,
        reason: 'No party has consented, including the user.',
        missing,
        basis: 'one-party consent still requires one party',
      };
    }
    if (this.clientData && missing.length > 0) {
      return {
        allowed: false,
        reason: 'Client-level information may be discussed; all-party consent is required by policy regardless of state law.',
        missing,
        basis: 'HMIS / coordinated entry confidentiality policy',
      };
    }
    return { allowed: true, reason: 'All required consents on record.', missing: [], basis: this.allPartyRequired ? 'all-party consent obtained' : 'one-party consent satisfied' };
  }

  /**
   * Can we enroll or match a biometric template for this person?
   * Defaults hard to NO. Face is opt-in per person, never per meeting.
   */
  canUseBiometric(participantId, kind) {
    const field = kind === 'face' ? 'biometricFace' : 'biometricVoice';
    const entry = this.entries.get(participantId);
    if (!entry || entry[field] !== true) {
      return {
        allowed: false,
        reason: `No ${kind} biometric consent on record for ${participantId}.`,
        statute: this.biometricStatute,
      };
    }
    if (this.biometricStatute === 'BIPA' && entry.method !== 'written-release') {
      return {
        allowed: false,
        reason: 'Illinois BIPA requires a signed written release before biometric capture; only a verbal consent is on record.',
        statute: 'BIPA',
      };
    }
    return { allowed: true, reason: 'Consent on record.', statute: this.biometricStatute };
  }

  /** The disclosure script to read aloud before pressing record. */
  script(hostName = 'the host') {
    const lines = [
      `Before we start: ${hostName} is using an AI notetaker that transcribes this meeting and takes notes.`,
    ];
    if (this.allPartyRequired) {
      lines.push(`${this.jurisdiction} law requires everyone's consent to record, so I need a yes from each of you on the record.`);
    }
    lines.push('The transcript is deleted automatically two hours after we finish. Nothing is stored longer than that unless someone here asks me to save it.');
    if (this.clientData) {
      lines.push('If we discuss anyone by name who is receiving services, I will stop the recording or we will use initials.');
    }
    lines.push('Anyone can withdraw at any point and I will stop. Does everyone agree?');
    return lines;
  }

  /** Immutable audit record, safe to attach to minutes. */
  auditTrail() {
    return {
      jurisdiction: this.jurisdiction,
      workspace: this.workspace,
      allPartyRequired: this.allPartyRequired,
      biometricStatute: this.biometricStatute,
      clientData: this.clientData,
      openedAt: this.openedAt,
      participants: Array.from(this.entries.values()),
    };
  }
}

module.exports = { ConsentLedger, ALL_PARTY_STATES, BIOMETRIC_STATUTE_STATES };
