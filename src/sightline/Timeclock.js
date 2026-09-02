/**
 * Timeclock.js — meeting timer, billable clock, and per-speaker talk time.
 *
 * Talk-time matters for ABLE specifically: in a co-design session, "did the
 * people with lived experience actually get the floor" is a measurable claim,
 * and this is what measures it.
 */

'use strict';

class Timeclock {
  constructor({ now = Date.now, billableRate = null } = {}) {
    this.now = now;
    this.billableRate = billableRate;
    this.startedAt = null;
    this.stoppedAt = null;
    this.pausedTotal = 0;
    this.pausedAt = null;
    this.talk = new Map();
    this.marks = [];
  }

  start() {
    if (this.startedAt !== null) return this;
    this.startedAt = this.now();
    return this;
  }

  pause() {
    if (this.startedAt === null || this.pausedAt !== null || this.stoppedAt !== null) return this;
    this.pausedAt = this.now();
    return this;
  }

  resume() {
    if (this.pausedAt === null) return this;
    this.pausedTotal += this.now() - this.pausedAt;
    this.pausedAt = null;
    return this;
  }

  stop() {
    if (this.startedAt === null || this.stoppedAt !== null) return this;
    this.resume();
    this.stoppedAt = this.now();
    return this;
  }

  /** Wall-clock elapsed minus paused time. */
  elapsedMs() {
    if (this.startedAt === null) return 0;
    const end = this.stoppedAt !== null ? this.stoppedAt : this.now();
    const paused = this.pausedTotal + (this.pausedAt !== null ? end - this.pausedAt : 0);
    return Math.max(0, end - this.startedAt - paused);
  }

  /** Credit a speaker with time on the floor. */
  creditTalk(speakerId, ms) {
    if (!speakerId || !(ms > 0)) return this;
    this.talk.set(speakerId, (this.talk.get(speakerId) || 0) + ms);
    return this;
  }

  /** Drop a named marker at the current offset — "action item", "decision". */
  mark(label) {
    const m = { label, atMs: this.elapsedMs(), at: this.now() };
    this.marks.push(m);
    return m;
  }

  /** Share of floor per speaker, descending. */
  talkShare() {
    const total = Array.from(this.talk.values()).reduce((a, b) => a + b, 0);
    if (!total) return [];
    return Array.from(this.talk.entries())
      .map(([speakerId, ms]) => ({ speakerId, ms, share: ms / total }))
      .sort((a, b) => b.ms - a.ms);
  }

  billable() {
    if (this.billableRate == null) return null;
    const hours = this.elapsedMs() / 3600000;
    return { hours: Number(hours.toFixed(4)), rate: this.billableRate, amount: Number((hours * this.billableRate).toFixed(2)) };
  }

  static format(ms) {
    const total = Math.floor(ms / 1000);
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
}

module.exports = { Timeclock };
