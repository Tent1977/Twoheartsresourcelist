/**
 * QuestionEngine.js — questions loaded and ready before the user needs them.
 *
 * Draws on everything else in the session: unsourced numbers, unanswered
 * questions, soft commitments, who in the room can actually decide, and where
 * the conversation is heading. Each question carries WHY it is queued, so the
 * user can tell at a glance whether it is worth spending a turn on.
 */

'use strict';

const PRIORITY = { now: 3, soon: 2, parking: 1 };

class QuestionEngine {
  constructor({ registry = null } = {}) {
    this.registry = registry;
    this.queue = new Map();
    this.asked = new Set();
    this.seq = 0;
  }

  /**
   * Rebuild the queue from current session state.
   * @param {object} state {flags, openThreads, topicPrediction, speakers, agendaRemaining}
   */
  refresh(state = {}) {
    const {
      flags = [], openThreads = [], topicPrediction = null,
      speakers = [], agendaRemaining = [],
    } = state;

    // 1. Anything flagged for verification becomes a question first.
    flags.forEach((f) => {
      if (!f.suggestedFollowUp) return;
      this._add({
        text: f.suggestedFollowUp,
        why: f.summary,
        priority: f.severity === 'check' ? 'now' : 'soon',
        source: `flag:${f.type}`,
        target: f.speaker,
      });
    });

    // 2. Questions somebody asked that never got answered. Skip any the flag
    //    pass already queued — an 'unanswered' flag names the same question,
    //    and two rows for one gap is noise the user has to read twice.
    const covered = flags
      .filter((f) => f.type === 'unanswered')
      .flatMap((f) => (f.quotes || []).map((qt) => qt.text.trim()));

    // A thread can be queued on one refresh and then flagged on a later one.
    // Drop the older, weaker row so the flag's version is the only one left.
    if (covered.length) {
      for (const [id, existing] of this.queue) {
        if (existing.source === 'open-thread' && !existing.asked
            && covered.some((c) => existing.text.includes(c))) {
          this.queue.delete(id);
        }
      }
    }

    openThreads.forEach((t) => {
      if (covered.some((c) => c.trim() === t.text.trim())) return;
      this._add({
        text: `Circle back: "${t.text.trim()}"`,
        why: `${t.speaker} asked this and it has not been answered.`,
        priority: 'soon',
        source: 'open-thread',
        target: null,
      });
    });

    // 3. Put the decision in front of whoever can actually make it.
    const decider = speakers.find((s) => s.rank === 'executive');
    if (decider && agendaRemaining.length) {
      this._add({
        text: `${decider.displayName || decider.id}, what do you need from us to say yes to ${agendaRemaining[0]}?`,
        why: `${decider.displayName || decider.id} appears to hold approval authority and the item is still open.`,
        priority: 'now',
        source: 'decision-path',
        target: decider.id,
      });
    }

    // 4. Where the conversation is drifting — get ahead of it.
    if (topicPrediction && topicPrediction.predictions && topicPrediction.predictions.length) {
      const top = topicPrediction.predictions[0];
      if (top.probability > 0.35 && top.topic.startsWith('continue:')) {
        const terms = top.topic.replace('continue:', '').trim();
        this._add({
          text: `We keep coming back to ${terms}. Is that the actual decision on the table today?`,
          why: 'Naming the real subject early saves the last ten minutes of the meeting.',
          priority: 'parking',
          source: 'topic-momentum',
          target: null,
        });
      }
    }

    // 5. Nobody has said what happens next.
    if (!flags.some((f) => f.type === 'soft-commitment') && agendaRemaining.length === 0) {
      this._add({
        text: 'Who owns the next step, and by when?',
        why: 'No owner or date has been named in this session.',
        priority: 'soon',
        source: 'closing',
        target: null,
      });
    }

    return this.list();
  }

  /** Add a question the user typed themselves. */
  addManual(text, why = 'You added this.') {
    return this._add({ text, why, priority: 'now', source: 'manual', target: null });
  }

  markAsked(id) {
    const q = this.queue.get(id);
    if (!q) return null;
    q.asked = true;
    q.askedAt = Date.now();
    this.asked.add(q.text);
    return q;
  }

  dismiss(id) { return this.queue.delete(id); }

  list({ includeAsked = false } = {}) {
    return Array.from(this.queue.values())
      .filter((q) => includeAsked || !q.asked)
      .sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] || a.createdAt - b.createdAt);
  }

  /**
   * Sources that describe the CURRENT state rather than a specific past event.
   * Only the newest row from each is useful — the wording drifts every turn as
   * keywords shift, and stacking them buries the flag-driven questions.
   */
  static get SINGLETON_SOURCES() {
    return ['topic-momentum', 'closing', 'decision-path'];
  }

  _add(fields) {
    // Dedupe on the question text so a re-refresh does not stack duplicates.
    const existing = Array.from(this.queue.values()).find((q) => q.text === fields.text);
    if (existing) return existing;
    if (this.asked.has(fields.text)) return null;

    if (QuestionEngine.SINGLETON_SOURCES.includes(fields.source)) {
      for (const [id, q] of this.queue) {
        if (q.source === fields.source && !q.asked) this.queue.delete(id);
      }
    }

    const q = Object.assign({
      id: `q${++this.seq}`,
      asked: false,
      createdAt: Date.now(),
    }, fields);
    this.queue.set(q.id, q);
    return q;
  }
}

module.exports = { QuestionEngine, PRIORITY };
