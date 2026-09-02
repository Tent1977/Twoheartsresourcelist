/**
 * Session.js — the orchestrator the UI drives.
 *
 * One meeting. Wires consent, diarization, the analysis layer, the notebook,
 * the question queue, routing and the two-hour buffer into a single object with
 * one method the UI calls per recognised word, and one snapshot it renders.
 *
 * Order matters here and is deliberate:
 *   consent gate -> diarize -> classify -> tone -> verify -> notebook
 *   -> predict -> requeue questions -> route -> buffer
 *
 * Nothing downstream of the consent gate runs until the gate passes.
 */

'use strict';

const { Workspace } = require('./Workspace');
const { ConsentLedger } = require('./Consent');
const { EphemeralBuffer } = require('./EphemeralBuffer');
const { Timeclock } = require('./Timeclock');
const { Diarizer } = require('./Diarization');
const { SpeakerRegistry } = require('./SpeakerRegistry');
const { Redactor } = require('./Redaction');
const Rhetoric = require('./Rhetoric');
const ToneMeter = require('./ToneMeter');
const { Predictor } = require('./Prediction');
const { VerificationLedger } = require('./VerificationFlags');
const { Notebook } = require('./Notebook');
const { QuestionEngine } = require('./QuestionEngine');
const { Router } = require('./Router');
const { CopilotAdapter } = require('./CopilotAdapter');

class Session {
  constructor({
    workspace = 'ABLE',
    jurisdiction = 'NV',
    clientData = false,
    records = [],
    protectedNames = [],
    agenda = [],
    copilot = null,
    billableRate = null,
    now = Date.now,
  } = {}) {
    this.now = now;
    this.workspace = new Workspace(workspace);
    this.consent = new ConsentLedger({ jurisdiction, workspace: this.workspace.id, clientData });
    this.buffer = new EphemeralBuffer({ now });
    this.clock = new Timeclock({ now, billableRate });
    this.diarizer = new Diarizer();
    this.registry = new SpeakerRegistry({ workspace: this.workspace, consent: this.consent });
    this.redactor = new Redactor({ protectedNames });
    this.predictor = new Predictor();
    this.verifier = new VerificationLedger({ records });
    this.notebook = new Notebook({ workspace: this.workspace, now });
    this.questions = new QuestionEngine({ registry: this.registry });
    this.router = new Router({ workspace: this.workspace, redactor: this.redactor });
    this.copilot = copilot || new CopilotAdapter({ redactor: this.redactor });

    this.agenda = agenda.slice();
    this.agendaDone = new Set();
    this.recording = false;
    this.toneByTurn = new Map();
    this.toneBySpeaker = new Map();
    this.cards = [];
    this.lastTurnId = null;
  }

  // ---- consent -----------------------------------------------------------

  consentScript(hostName) { return this.consent.script(hostName); }

  recordConsent(participantId, grants) { return this.consent.record(participantId, grants); }

  /**
   * @param {string[]} expectedParticipants
   * @throws if the jurisdiction's consent requirements are not met
   */
  start(expectedParticipants = []) {
    const gate = this.consent.canRecord(expectedParticipants);
    if (!gate.allowed) {
      const err = new Error(`Recording blocked: ${gate.reason}`);
      err.gate = gate;
      throw err;
    }
    this.recording = true;
    this.clock.start();
    this.buffer.append({ event: 'session-start', gate }, { kind: 'audit', pinned: true });
    return gate;
  }

  stop() {
    this.recording = false;
    this.clock.stop();
    return this.clock.elapsedMs();
  }

  /** A participant revoked consent mid-meeting. Stop immediately. */
  withdrawConsent(participantId) {
    this.consent.withdraw(participantId);
    this.recording = false;
    this.clock.pause();
    this.buffer.append({ event: 'consent-withdrawn', participantId }, { kind: 'audit', pinned: true });
    return { recording: false, reason: `${participantId} withdrew consent. Recording stopped.` };
  }

  // ---- ingest ------------------------------------------------------------

  /**
   * Feed one recognised word. Returns the turn it landed in, and — when that
   * word closed a previous turn — the analysis of the turn that just closed.
   */
  ingestWord(word) {
    if (!this.recording) throw new Error('Session is not recording. Call start() after consent.');
    const before = this.diarizer.turns.length;
    const turn = this.diarizer.ingest(word);
    const closed = this.diarizer.turns.length > before && before > 0
      ? this.diarizer.turns[before - 1]
      : null;

    let analysis = null;
    if (closed) analysis = this.processTurn(closed);
    return { turn, analysis };
  }

  /** Force analysis of the current open turn — used when the mic goes quiet. */
  flush() {
    const last = this.diarizer.turns[this.diarizer.turns.length - 1];
    if (!last || last.id === this.lastTurnId) return null;
    return this.processTurn(last);
  }

  /**
   * The full pipeline for one completed turn.
   */
  processTurn(turn) {
    this.lastTurnId = turn.id;

    // Self-introduction gives us a free identity. This runs BEFORE the speaker
    // name is resolved, so the turn a person introduces themselves in is
    // already attributed to them — otherwise their first claim is filed under
    // "Speaker 0" and never matches their later ones.
    const intro = SpeakerRegistry.detectIntroduction(turn.text);
    if (intro) {
      this.registry.upsert(turn.speaker, { displayName: intro.displayName, org: intro.org });
      this.diarizer.label(turn.speaker, intro.displayName);
    }
    const speakerName = this.diarizer.nameFor(turn.speaker);

    // Register everyone who speaks, named or not. Somebody who never introduces
    // themselves still needs a row to hang talk time, rank and evidence on.
    if (!this.registry.get(turn.speaker)) this.registry.upsert(turn.speaker, {});

    const analysis = Rhetoric.analyzeTurn(turn);
    analysis.speakerName = speakerName;

    // Tone, blended with prosody when the ASR gave us any.
    const prosody = turn.words.find((w) => w.prosody) ? turn.words.find((w) => w.prosody).prosody : null;
    const tone = ToneMeter.read(turn.text, prosody);
    this.toneByTurn.set(turn.id, tone);
    const history = this.toneBySpeaker.get(turn.speaker) || [];
    history.push(tone);
    this.toneBySpeaker.set(turn.speaker, history);

    // Verification, notebook cards, routing — per sentence.
    const flags = [];
    const cards = [];
    analysis.sentences.forEach((sentence) => {
      flags.push(...this.verifier.ingest(sentence, { speaker: speakerName, turnId: turn.id, atMs: turn.startMs }));
      const card = this.notebook.consider(sentence, { speaker: speakerName });
      if (card) cards.push(card);
      this.router.route({
        text: sentence.text,
        speaker: speakerName,
        move: sentence.move,
        epistemic: sentence.epistemic,
        turnId: turn.id,
        atMs: turn.startMs,
      });
    });
    this.cards.push(...cards);

    // Authority, from what they said and nothing else.
    const said = this.diarizer.turns.filter((t) => t.speaker === turn.speaker).map((t) => t.text);
    const authority = this.registry.inferAuthority(turn.speaker, said);

    this.predictor.observeTurn(analysis);
    this.clock.creditTalk(turn.speaker, turn.endMs - turn.startMs);

    const nextSentence = this.predictor.nextSentence();
    const nextTopic = this.predictor.nextTopic(this.agendaRemaining());

    this.questions.refresh({
      flags: this.verifier.open(),
      openThreads: this.predictor.openThreadList(),
      topicPrediction: nextTopic,
      speakers: this.registry.list(),
      agendaRemaining: this.agendaRemaining(),
    });

    this.buffer.append({
      turnId: turn.id, speaker: speakerName, text: turn.text,
      startMs: turn.startMs, endMs: turn.endMs, tone: tone.label,
    }, { kind: 'segment' });

    return { turn, analysis, tone, flags, cards, authority, nextSentence, nextTopic };
  }

  // ---- point and click ---------------------------------------------------

  /**
   * The context menu behind a click on a transcript turn.
   * Returns the actions available and everything already known about it.
   */
  inspect(turnId) {
    const turn = this.diarizer.turns.find((t) => t.id === turnId);
    if (!turn) return null;
    const speakerName = this.diarizer.nameFor(turn.speaker);
    const sentences = Rhetoric.segment(turn.text).map(Rhetoric.classify);
    return {
      turnId,
      speaker: speakerName,
      badge: this.registry.badge(turn.speaker),
      text: turn.text,
      startMs: turn.startMs,
      endMs: turn.endMs,
      confidence: turn.confidence,
      tone: this.toneByTurn.get(turnId) || null,
      sentences,
      flags: this.verifier.open().filter((f) => f.quotes.some((q) => turn.text.includes(q.text.slice(0, 30)))),
      containsPII: Redactor.scan(turn.text),
      actions: [
        { id: 'explain', label: 'What does this mean?' },
        { id: 'expand', label: 'Give me more on this' },
        { id: 'counter', label: 'How do I respond?' },
        { id: 'verify', label: 'Check this against our records' },
        { id: 'question', label: 'Turn into a question to ask' },
        { id: 'route', label: 'Send to a project' },
        { id: 'pin', label: 'Keep past the two-hour wipe' },
        { id: 'reassign', label: 'Wrong speaker — fix it' },
        { id: 'redact', label: 'Redact and copy' },
      ],
    };
  }

  /** Execute one of those actions. Model-backed ones degrade to local advice. */
  async act(turnId, actionId, arg = null) {
    const info = this.inspect(turnId);
    if (!info) return { ok: false, reason: 'unknown turn' };

    switch (actionId) {
      case 'pin': {
        const item = this.buffer.list().find((i) => i.payload && i.payload.turnId === turnId);
        return item ? { ok: true, pinned: this.buffer.pin(item.id) } : { ok: false, reason: 'not in buffer' };
      }
      case 'reassign':
        return { ok: true, turn: this.diarizer.reassign(turnId, arg) };
      case 'redact': {
        const r = this.redactor.redact(info.text);
        return { ok: true, text: r.text, removed: r.found.map((f) => f.kind) };
      }
      case 'question': {
        const q = this.questions.addManual(
          `Following up on what ${info.speaker} said — ${info.sentences[0] ? info.sentences[0].text : info.text}`,
          'You flagged this line during the meeting.'
        );
        return { ok: true, question: q };
      }
      case 'route': {
        const notes = this.router.route({ text: info.text, speaker: info.speaker, move: info.sentences[0] && info.sentences[0].move, turnId, forceProject: arg });
        return { ok: true, notes };
      }
      case 'verify': {
        const flags = this.verifier.open().filter((f) => f.speaker === info.speaker);
        return { ok: true, flags, records: this.verifier.records };
      }
      default: {
        const res = await this.copilot.ask(
          { explain: 'What does this actually mean, in plain terms?',
            expand: 'Give me the background I need on this.',
            counter: 'How should I respond to this in the room, right now?' }[actionId] || actionId,
          { excerpt: info.text, speaker: info.speaker, workspace: this.workspace.id }
        );
        if (res.answered) return { ok: true, text: res.text };
        // Local fallback — the notebook already knows what to do with this.
        const card = info.sentences.map((s) => this.notebook.consider(s, { speaker: info.speaker }, { force: true })).find(Boolean);
        return {
          ok: true,
          text: card ? `${card.headline} — ${card.note}\nTry: ${card.suggested.join(' / ')}` : 'No copilot available and no local guidance for this line.',
          local: true,
          reason: res.reason,
        };
      }
    }
  }

  // ---- state -------------------------------------------------------------

  agendaRemaining() { return this.agenda.filter((a) => !this.agendaDone.has(a)); }

  completeAgendaItem(item) { this.agendaDone.add(item); return this.agendaRemaining(); }

  /** Everything the UI renders, in one object. */
  snapshot() {
    return {
      workspace: { id: this.workspace.id, legalName: this.workspace.legalName, ui: this.workspace.uiPalette() },
      recording: this.recording,
      clock: {
        elapsed: Timeclock.format(this.clock.elapsedMs()),
        elapsedMs: this.clock.elapsedMs(),
        talkShare: this.clock.talkShare().map((t) => Object.assign({}, t, { name: this.diarizer.nameFor(t.speakerId) })),
        billable: this.clock.billable(),
        marks: this.clock.marks,
      },
      buffer: this.buffer.stats(),
      transcript: this.diarizer.transcript(),
      speakers: this.registry.list().map((p) => Object.assign({}, p, { badge: this.registry.badge(p.id) })),
      tone: Array.from(this.toneBySpeaker.entries()).map(([speaker, readings]) => ({
        speaker: this.diarizer.nameFor(speaker),
        current: readings[readings.length - 1],
        trend: ToneMeter.trend(readings),
      })),
      flags: this.verifier.open(),
      cards: this.cards.slice(-4).reverse(),
      questions: this.questions.list(),
      prediction: {
        nextSentence: this.predictor.nextSentence(),
        nextTopic: this.predictor.nextTopic(this.agendaRemaining()),
      },
      agenda: { remaining: this.agendaRemaining(), done: Array.from(this.agendaDone) },
      routing: { pending: this.router.pending(), projects: Array.from(this.router.projects.values()) },
      consent: this.consent.auditTrail(),
      copilot: Object.assign({ provider: this.copilot.provider, online: this.copilot.online }, this.copilot.stats),
    };
  }

  /** Two hours are up, or the user hit the button. Everything goes. */
  wipe() {
    const n = this.buffer.wipe();
    this.diarizer.turns = [];
    this.toneByTurn.clear();
    this.toneBySpeaker.clear();
    this.cards = [];
    this.redactor.forget();
    this.verifier.claims = [];
    this.verifier.flags = [];
    return { wiped: n, at: this.now() };
  }
}

module.exports = { Session };
