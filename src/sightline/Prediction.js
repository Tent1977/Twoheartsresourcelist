/**
 * Prediction.js — what is probably coming next.
 *
 * Two horizons:
 *   nextSentence() — which rhetorical move the current speaker is likely to
 *                    make next, from a first-order Markov chain over moves.
 *   nextTopic()    — what the next stretch of conversation is likely to be
 *                    about, from agenda position, unresolved threads and
 *                    topic-momentum.
 *
 * The chain starts from hand-set priors drawn from how meetings actually run
 * (a question is usually followed by an answer or a deflection, a commitment is
 * usually followed by a procedural move) and then LEARNS from the meeting in
 * front of it, so by twenty minutes in the priors barely matter.
 *
 * Probabilities are reported with the observation count behind them. A 0.9 off
 * three samples is not a 0.9, and the UI is expected to say so.
 */

'use strict';

const { ENQUIRY_MOVES } = require('./Rhetoric');

const PRIOR_TRANSITIONS = {
  question:    { statement: 0.34, 'data-point': 0.16, hedge: 0.16, deflection: 0.12, commitment: 0.10, question: 0.12 },
  statement:   { statement: 0.30, question: 0.18, concession: 0.10, objection: 0.12, 'data-point': 0.12, hedge: 0.18 },
  'data-point':{ statement: 0.28, question: 0.24, objection: 0.14, concession: 0.10, 'action-item': 0.12, hedge: 0.12 },
  objection:   { concession: 0.22, statement: 0.24, hedge: 0.16, question: 0.18, deflection: 0.12, objection: 0.08 },
  concession:  { statement: 0.30, commitment: 0.20, 'action-item': 0.18, question: 0.16, procedural: 0.16 },
  commitment:  { procedural: 0.26, 'action-item': 0.24, statement: 0.22, question: 0.16, concession: 0.12 },
  'action-item':{ procedural: 0.30, commitment: 0.20, statement: 0.20, question: 0.18, 'action-item': 0.12 },
  hedge:       { statement: 0.28, question: 0.20, hedge: 0.14, 'data-point': 0.14, objection: 0.12, deflection: 0.12 },
  deflection:  { procedural: 0.28, statement: 0.22, question: 0.20, objection: 0.16, hedge: 0.14 },
  decision:    { 'action-item': 0.34, procedural: 0.28, commitment: 0.20, statement: 0.18 },
  procedural:  { statement: 0.32, question: 0.24, 'data-point': 0.16, procedural: 0.16, anecdote: 0.12 },
  anecdote:    { statement: 0.30, concession: 0.18, question: 0.18, 'data-point': 0.16, hedge: 0.18 },
  request:     { commitment: 0.36, hedge: 0.20, deflection: 0.18, question: 0.14, objection: 0.12 },
};

const STOPWORDS = new Set(('the a an and or but if then that this these those of to in on for with at by from as is are was were be been it its we our you your they their i me my he she them us not no yes do does did will would can could should have has had about into over under so than too very just also only more most other some such own same what which who whom how when where why all any each'.split(' ')));

class Predictor {
  constructor({ decay = 0.98, priorWeight = 3 } = {}) {
    this.decay = decay;
    this.priorWeight = priorWeight;
    this.observed = new Map();   // from -> Map(to -> weight)
    this.moveHistory = [];
    this.topicHistory = [];
    this.openThreads = new Map();
  }

  /** Feed the classified sentences of a turn, oldest first. */
  observeTurn(analysis) {
    const moves = analysis.sentences.map((s) => s.move);
    for (let i = 0; i < moves.length; i += 1) {
      const prev = this.moveHistory[this.moveHistory.length - 1];
      if (prev) this._bump(prev, moves[i]);
      this.moveHistory.push(moves[i]);
    }
    const kws = Predictor.keywords(analysis.sentences.map((s) => s.text).join(' '));
    this.topicHistory.push({ turnId: analysis.turnId, speaker: analysis.speaker, keywords: kws });

    // A question with no answer yet is an open thread.
    analysis.sentences.forEach((s) => {
      if (ENQUIRY_MOVES.includes(s.move)) {
        this.openThreads.set(`${analysis.turnId}:${s.text.slice(0, 40)}`, {
          text: s.text, speaker: analysis.speaker, openedAt: this.moveHistory.length,
        });
      }
    });
    if (analysis.sentences.some((s) => ['commitment', 'decision', 'data-point'].includes(s.move))) {
      const oldest = Array.from(this.openThreads.keys())[0];
      if (oldest) this.openThreads.delete(oldest);
    }
    return this;
  }

  /**
   * @returns {{predictions: Array<{move,probability}>, basis, samples, reliable}}
   */
  nextSentence(fromMove = null) {
    const from = fromMove || this.moveHistory[this.moveHistory.length - 1] || 'statement';
    const prior = PRIOR_TRANSITIONS[from] || PRIOR_TRANSITIONS.statement;
    const obs = this.observed.get(from) || new Map();
    const observedTotal = Array.from(obs.values()).reduce((a, b) => a + b, 0);

    const moves = new Set([...Object.keys(prior), ...obs.keys()]);
    const scored = Array.from(moves).map((to) => {
      const p = (prior[to] || 0) * this.priorWeight;
      const o = obs.get(to) || 0;
      return { move: to, raw: p + o };
    });
    const total = scored.reduce((a, s) => a + s.raw, 0) || 1;

    return {
      from,
      predictions: scored
        .map((s) => ({ move: s.move, probability: Number((s.raw / total).toFixed(3)) }))
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 5),
      samples: Math.round(observedTotal),
      basis: observedTotal >= 8 ? 'this meeting' : observedTotal > 0 ? 'this meeting + priors' : 'priors only',
      reliable: observedTotal >= 8,
    };
  }

  /**
   * What the next stretch is likely to be about.
   * @param {string[]} [agendaRemaining]
   */
  nextTopic(agendaRemaining = []) {
    const candidates = [];

    // 1. Momentum: keywords that keep recurring in the last few turns.
    const recent = this.topicHistory.slice(-4);
    const freq = new Map();
    recent.forEach((t, i) => {
      const recencyWeight = 1 + i * 0.4;
      t.keywords.forEach((k) => freq.set(k, (freq.get(k) || 0) + recencyWeight));
    });
    const momentum = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (momentum.length) {
      candidates.push({
        topic: `continue: ${momentum.map(([k]) => k).join(', ')}`,
        raw: momentum[0][1] * 1.2,
        why: 'these terms are gaining weight across the last few turns',
      });
    }

    // 2. Unanswered questions pull the conversation back.
    for (const thread of this.openThreads.values()) {
      candidates.push({
        topic: `unanswered: "${thread.text.slice(0, 70)}"`,
        raw: 2.2,
        why: `${thread.speaker} asked this and has not been answered`,
      });
    }

    // 3. Agenda gravity.
    agendaRemaining.slice(0, 2).forEach((item, i) => {
      candidates.push({ topic: `agenda: ${item}`, raw: 2.0 - i * 0.6, why: 'next unfinished agenda item' });
    });

    if (!candidates.length) {
      return { predictions: [], basis: 'not enough conversation yet', reliable: false };
    }
    const total = candidates.reduce((a, c) => a + c.raw, 0);
    return {
      predictions: candidates
        .map((c) => ({ topic: c.topic, probability: Number((c.raw / total).toFixed(3)), why: c.why }))
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 4),
      basis: 'momentum + open threads + agenda',
      reliable: this.topicHistory.length >= 4,
    };
  }

  openThreadList() {
    return Array.from(this.openThreads.values());
  }

  _bump(from, to) {
    if (!this.observed.has(from)) this.observed.set(from, new Map());
    const row = this.observed.get(from);
    for (const [k, v] of row) row.set(k, v * this.decay);
    row.set(to, (row.get(to) || 0) + 1);
  }

  static keywords(text, limit = 6) {
    const counts = new Map();
    String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
      .forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([w]) => w);
  }
}

module.exports = { Predictor, PRIOR_TRANSITIONS };
