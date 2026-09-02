/**
 * Notebook.js — the card that pops up while someone is still talking.
 *
 * When a sentence lands as a fact, an opinion, an idea, a subject change, a
 * question or an objection, the notebook offers: what just happened, how to
 * answer it, two or three lines the user can actually say, and what not to say.
 *
 * The last part is the point. The guardrails encode the positioning rules the
 * org keeps getting wrong under pressure — so if someone says "low-barrier" or
 * asks for a price in the room, the card fires before the wrong answer does.
 */

'use strict';

/**
 * Workspace-scoped guardrails. ABLE's are its actual positioning rules.
 * VOA's are deliberately minimal: its messaging discipline is VOA's to set,
 * and inventing rules for it is exactly the bleed we are preventing.
 */
const GUARDRAILS = {
  ABLE: [
    {
      id: 'low-barrier',
      re: /\blow[- ]barrier\b/i,
      severity: 'check',
      note: 'ABLE\'s own finding (CSH Supportive Housing Messaging Workgroup) is that "low-barrier" sets misaligned resident expectations and damages program reputation.',
      say: 'Reframe to what the program actually does: "we do not screen people out for things that are not safety issues."',
      avoid: 'Do not use "low-barrier" as a selling point.',
    },
    {
      id: 'authority-overreach',
      re: /\b(?:we(?:'ll| will)? )?(?:audit|enforce|investigate|hold them accountable|make them comply)\b/i,
      severity: 'check',
      note: 'ABLE advises. It does not enforce, audit or investigate. Claiming authority over another org\'s operations makes partners defensive and is not true.',
      say: '"We review the policy and flag what will not survive contact with the people it applies to."',
      avoid: 'Do not imply oversight authority.',
    },
    {
      id: 'price-in-the-room',
      re: /\b(?:what (?:would|does) (?:it|this) cost|how much (?:is|do you charge|would)|your rate|price)\b/i,
      severity: 'watch',
      note: 'Prices stay off pitch materials and out of the room. The rate sheet goes over only after they ask, and separately.',
      say: '"I will send you the rate sheet today — it depends on scope and how many sessions." Then send it.',
      avoid: 'Do not quote a number on the spot.',
    },
    {
      id: 'title-inflation',
      re: /\b(?:the )?(?:founder|executive director|ceo) of able\b|\bi founded able\b/i,
      severity: 'check',
      note: 'Lawrence is a founding member, not the founder and not the executive director. Dr. Catrina Grigsby recruited him and held the county contract that built ABLE.',
      say: '"I am a founding member of ABLE."',
      avoid: 'Do not inflate the title — it is checkable and it costs credibility.',
    },
    {
      id: 'stale-name',
      re: /\bLEAB\b|\badvisory board for lived experience\b/i,
      severity: 'check',
      note: 'The name is "Advisory Board of Lived Experience" — of, not for. LEAB is the retired name.',
      say: 'Correct it in the room, lightly: "it is Advisory Board of Lived Experience now."',
      avoid: 'Do not let LEAB go into anyone\'s notes.',
    },
    {
      id: 'client-roster',
      re: /\bour clients\b|\bclients we (?:work with|serve)\b/i,
      severity: 'watch',
      note: 'No fee-for-service clients have signed yet. Eight organizations are in the pipeline.',
      say: '"We have eight organizations in conversation right now." That is true and it is enough.',
      avoid: 'Do not imply a client roster that does not exist.',
    },
    {
      id: 'conflict-of-interest',
      re: /\b(?:VOA|Volunteers of America|Village on Sage|Hi-?Way 40)\b/i,
      severity: 'info',
      note: 'You work for VOA while active in ABLE, whose fiscal agent is RISE — all inside the same CoC funding ecosystem. Every affiliation is openly known.',
      say: 'Name it before someone else does: "for the record, I work for VOA and volunteer with ABLE."',
      avoid: 'Do not let it surface later as something you did not mention.',
    },
  ],
  VOA: [],
};

// What to do with each kind of sentence, independent of org.
const PLAYBOOK = {
  fact: {
    headline: 'A checkable claim just landed.',
    moves: [
      'Ask for the source before it becomes settled fact in the room.',
      'Write the number down now — you will need it exactly, not approximately.',
    ],
    openers: [
      'Where is that number from?',
      'Is that the current figure, or the one from last cycle?',
    ],
  },
  opinion: {
    headline: 'That was a position, not a finding.',
    moves: [
      'Separate the position from the reasoning — agree with the reasoning if you can, even when you disagree with the position.',
      'Ask what would change their mind. It tells you whether this is negotiable.',
    ],
    openers: [
      'What would have to be true for you to see it differently?',
      'Help me understand what is driving that.',
    ],
  },
  idea: {
    headline: 'A proposal is on the table.',
    moves: [
      'Get it concrete before it gets argued about — who, how many, by when.',
      'Say what you like about it first. An idea that gets attacked on arrival stops getting offered.',
    ],
    openers: [
      'I like the shape of that. What would the first thirty days look like?',
      'Who would own it, and what does it cost?',
    ],
  },
  'subject-shift': {
    headline: 'The subject just changed.',
    moves: [
      'Check whether the last thread actually closed. Subject changes are where decisions get lost.',
      'If something was left open, say so now.',
    ],
    openers: [
      'Before we move — did we land the last one?',
      'Can I get one thing on the record before we switch?',
    ],
  },
  question: {
    headline: 'You have been asked something.',
    moves: [
      'Answer the question that was asked, then add context. Not the reverse.',
      'If you do not know, say the date you will know by.',
    ],
    openers: [
      'Short answer is X. The longer version is...',
      'I do not have that in front of me — I will have it to you by [date].',
    ],
  },
  objection: {
    headline: 'Pushback.',
    moves: [
      'Restate their objection until they agree you have it right. Then respond.',
      'Find the true part and concede it out loud. It costs nothing and buys the room.',
    ],
    openers: [
      'Let me say that back — you are saying...',
      'You are right about that part. Here is where I still land differently.',
    ],
  },
  commitment: {
    headline: 'Someone committed to something.',
    moves: [
      'Pin the owner and the date now, out loud, so it exists in the minutes.',
    ],
    openers: [
      'So that is you, by Friday — did I get that right?',
    ],
  },
  decision: {
    headline: 'A decision was made.',
    moves: [
      'Say it back and get an audible yes. Decisions that are not restated get relitigated.',
    ],
    openers: [
      'To confirm, we have decided X. Everyone good with that?',
    ],
  },
};

class Notebook {
  /**
   * @param {object} opts
   * @param {import('./Workspace').Workspace} opts.workspace
   * @param {number} [opts.cooldownMs] Minimum gap between cards of the same id.
   */
  constructor({ workspace, cooldownMs = 90000, now = Date.now } = {}) {
    if (!workspace) throw new Error('Notebook requires a workspace');
    this.workspace = workspace;
    this.guardrails = GUARDRAILS[workspace.id] || [];
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.lastFired = new Map();
    this.history = [];
  }

  /**
   * @param {object} sentence  from Rhetoric.classify()
   * @param {object} [ctx] {speaker, turnId}
   * @param {object} [opts] {force} — bypass the cooldown. Set when the USER
   *   asked for advice by clicking a line; the cooldown exists to stop the
   *   notebook interrupting unprompted, not to refuse a direct request.
   */
  consider(sentence, ctx = {}, opts = {}) {
    if (!sentence || typeof sentence.text !== 'string') return null;

    // Guardrails are checked on EVERY sentence, not just notebook-worthy ones.
    // A positioning slip usually arrives inside an ordinary statement, which is
    // exactly the kind of sentence the playbook filter would throw away.
    const rail = this.guardrails.find((g) => g.re.test(sentence.text));
    if (!rail && !sentence.notebookWorthy) return null;
    const key = rail ? `rail:${rail.id}` : `play:${sentence.epistemic}:${sentence.move}`;

    const last = this.lastFired.get(key);
    if (!opts.force && last != null && this.now() - last < this.cooldownMs) return null;

    const play = PLAYBOOK[sentence.epistemic] || PLAYBOOK[sentence.move];
    if (!rail && !play) return null;

    const card = rail
      ? {
        id: key,
        kind: 'guardrail',
        severity: rail.severity,
        headline: 'Positioning check',
        trigger: sentence.text,
        speaker: ctx.speaker || null,
        note: rail.note,
        suggested: [rail.say],
        avoid: rail.avoid,
        workspace: this.workspace.id,
        at: this.now(),
      }
      : {
        id: key,
        kind: 'playbook',
        severity: 'info',
        headline: play.headline,
        trigger: sentence.text,
        speaker: ctx.speaker || null,
        note: play.moves.join(' '),
        suggested: play.openers,
        avoid: null,
        workspace: this.workspace.id,
        at: this.now(),
      };

    this.lastFired.set(key, this.now());
    this.history.push(card);
    return card;
  }

  recent(n = 5) { return this.history.slice(-n).reverse(); }
}

module.exports = { Notebook, GUARDRAILS, PLAYBOOK };
