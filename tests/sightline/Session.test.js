'use strict';
const { Session } = require('../../src/sightline/Session');
const { CopilotAdapter } = require('../../src/sightline/CopilotAdapter');

const RECORDS = [{ subject: 'parking spots', value: 30, source: 'RISE site plan v2' }];

const consented = (opts = {}) => {
  const s = new Session(Object.assign({ workspace: 'ABLE', jurisdiction: 'NV', records: RECORDS }, opts));
  s.recordConsent('lawrence', { recording: true });
  s.recordConsent('ben', { recording: true });
  s.start(['lawrence', 'ben']);
  return s;
};

const say = (session, state, speaker, text) => {
  text.split(' ').forEach((word) => {
    session.ingestWord({ text: word, speaker, startMs: state.t, endMs: state.t + 150, confidence: 0.95 });
    state.t += 160;
  });
  state.t += 3000;
};

const meeting = (session) => {
  const state = { t: 0 };
  say(session, state, 0, 'Hi I am Ben with RISE. We are proposing 30 parking spots at the fairgrounds.');
  say(session, state, 1, 'How many WASH units does that require?');
  say(session, state, 0, 'The lot has good lighting and a fence. Honestly we are proposing 20 parking spots now.');
  say(session, state, 2, 'I will draft the cost sheet.');
  session.flush();
  return session;
};

describe('Session consent gate', () => {
  test('refuses to record until everyone consents in Nevada', () => {
    const s = new Session({ jurisdiction: 'NV' });
    expect(() => s.start(['a', 'b'])).toThrow(/Recording blocked/);
    expect(s.recording).toBe(false);
  });

  test('the thrown error carries the gate detail for the UI', () => {
    const s = new Session({ jurisdiction: 'NV' });
    try { s.start(['a', 'b']); } catch (err) {
      expect(err.gate.missing).toEqual(['a', 'b']);
      expect(err.gate.basis).toMatch(/NRS/);
    }
  });

  test('ingesting before the gate passes is refused', () => {
    expect(() => new Session().ingestWord({ text: 'hi', speaker: 0, startMs: 0, endMs: 1 }))
      .toThrow(/not recording/i);
  });

  test('records the gate decision in the buffer as a pinned audit entry', () => {
    const s = consented();
    const audit = s.buffer.list({ kind: 'audit' });
    expect(audit).toHaveLength(1);
    expect(audit[0].pinned).toBe(true);
  });

  test('a withdrawal stops recording immediately', () => {
    const s = consented();
    const out = s.withdrawConsent('ben');
    expect(out.recording).toBe(false);
    expect(s.recording).toBe(false);
    expect(s.buffer.list({ kind: 'audit' }).some((i) => i.payload.event === 'consent-withdrawn')).toBe(true);
  });

  test('exposes the disclosure script to read before recording', () => {
    expect(new Session({ jurisdiction: 'NV' }).consentScript('Lawrence').join(' ')).toMatch(/Lawrence/);
  });
});

describe('Session pipeline', () => {
  test('builds a transcript with speakers named from self-introduction', () => {
    const snap = meeting(consented()).snapshot();
    expect(snap.transcript[0].speaker).toBe('Ben');
    expect(snap.transcript).toHaveLength(4);
  });

  test('attributes the introducing turn to the person, not to Speaker 0', () => {
    const s = meeting(consented());
    const bensTurns = s.snapshot().transcript.filter((t) => t.speaker === 'Ben');
    expect(bensTurns).toHaveLength(2);
  });

  test('catches a speaker contradicting themselves across turns', () => {
    const flags = meeting(consented()).snapshot().flags;
    expect(flags.some((f) => f.type === 'contradiction')).toBe(true);
  });

  test('catches a statement conflicting with a record on file', () => {
    expect(meeting(consented()).snapshot().flags.some((f) => f.type === 'conflicts-with-record')).toBe(true);
  });

  test('never accuses anyone of lying anywhere in the snapshot', () => {
    const snap = meeting(consented()).snapshot();
    expect(JSON.stringify(snap)).not.toMatch(/\b(lying|deceptive|dishonest|untruthful)\b/i);
  });

  test('queues questions worth asking, most urgent first', () => {
    const questions = meeting(consented()).snapshot().questions;
    expect(questions.length).toBeGreaterThan(2);
    expect(questions[0].priority).toBe('now');
    questions.forEach((q) => expect(q.why).toEqual(expect.any(String)));
  });

  test('predicts the next move and the next topic', () => {
    const p = meeting(consented()).snapshot().prediction;
    expect(p.nextSentence.predictions.length).toBeGreaterThan(0);
    expect(p.nextTopic.predictions.length).toBeGreaterThan(0);
  });

  test('tracks tone per speaker with a trend', () => {
    const tone = meeting(consented()).snapshot().tone;
    expect(tone.length).toBeGreaterThan(0);
    tone.forEach((t) => {
      expect(t.current.emoji).toEqual(expect.any(String));
      expect(t.current.caveat).toMatch(/not a verdict/);
    });
  });

  test('credits talk time per speaker', () => {
    const share = meeting(consented()).snapshot().clock.talkShare;
    expect(share[0].share).toBeGreaterThan(0);
    expect(share.reduce((a, t) => a + t.share, 0)).toBeCloseTo(1);
  });

  test('everything said lands in the two-hour buffer', () => {
    const snap = meeting(consented()).snapshot();
    expect(snap.buffer.byKind.segment).toBe(4);
    expect(snap.buffer.ttlMs).toBe(7200000);
  });

  test('infers standing only from what people claimed', () => {
    const s = consented();
    const state = { t: 0 };
    say(s, state, 0, 'I can approve that today.');
    say(s, state, 1, 'Something unrelated entirely.');
    s.flush();
    const ben = s.snapshot().speakers.find((p) => p.rank === 'executive');
    expect(ben.evidence[0].quote).toMatch(/approve/);
  });

  test('a positioning slip raises a notebook card', () => {
    const s = consented();
    const state = { t: 0 };
    say(s, state, 0, 'Our program is low-barrier which is the selling point.');
    say(s, state, 1, 'Next.');
    s.flush();
    expect(s.snapshot().cards.some((c) => c.kind === 'guardrail')).toBe(true);
  });

  test('VOA sessions carry none of ABLE positioning or colors', () => {
    const s = new Session({ workspace: 'VOA', jurisdiction: 'NV' });
    s.recordConsent('a', { recording: true });
    s.start(['a']);
    expect(s.notebook.guardrails).toEqual([]);
    expect(s.snapshot().workspace.ui.accent).not.toBe('#00E5FF');
  });

  test('routes matching content to a project', () => {
    const s = consented();
    s.router.addProject('safe-parking', { name: 'RISE RV Safe Parking' });
    s.router.addRule({ id: 'sp', project: 'safe-parking', when: { keywords: ['fairgrounds'] } });
    meeting(s);
    expect(s.snapshot().routing.pending.length).toBeGreaterThan(0);
  });

  test('agenda items can be completed', () => {
    const s = consented({ agenda: ['a', 'b'] });
    expect(s.completeAgendaItem('a')).toEqual(['b']);
    expect(s.snapshot().agenda.done).toEqual(['a']);
  });

  test('flush is idempotent for an already-processed turn', () => {
    const s = meeting(consented());
    expect(s.flush()).toBeNull();
  });

  test('flush on an untouched session returns null', () => {
    expect(consented().flush()).toBeNull();
  });

  test('stop freezes the clock', () => {
    const s = meeting(consented());
    expect(s.stop()).toEqual(expect.any(Number));
    expect(s.recording).toBe(false);
  });
});

describe('Session point-and-click', () => {
  test('inspect returns the full context menu for a turn', () => {
    const s = meeting(consented());
    const info = s.inspect('t1');
    expect(info.speaker).toBe('Ben');
    expect(info.actions.map((a) => a.id)).toEqual(expect.arrayContaining(['explain', 'route', 'pin', 'reassign', 'redact']));
    expect(info.sentences.length).toBeGreaterThan(0);
    expect(info.badge.color).toEqual(expect.any(String));
  });

  test('inspect flags PII in the selected line', () => {
    const s = consented();
    const state = { t: 0 };
    say(s, state, 0, 'Reach me at 775-555-0134 any time.');
    say(s, state, 1, 'Fine.');
    s.flush();
    expect(s.inspect('t1').containsPII).toContain('phone');
  });

  test('inspect on an unknown turn returns null', () => {
    expect(consented().inspect('nope')).toBeNull();
  });

  test('pin keeps a turn past the two-hour wipe', async () => {
    const s = meeting(consented());
    const out = await s.act('t1', 'pin');
    expect(out.ok).toBe(true);
    expect(out.pinned.pinned).toBe(true);
  });

  test('reassign corrects the speaker', async () => {
    const s = meeting(consented());
    expect((await s.act('t2', 'reassign', 0)).turn.speaker).toBe('0');
  });

  test('redact returns a shareable version of the line', async () => {
    const s = consented();
    const state = { t: 0 };
    say(s, state, 0, 'Call 775-555-0134 today.');
    say(s, state, 1, 'Fine.');
    s.flush();
    const out = await s.act('t1', 'redact');
    expect(out.text).toContain('[PHONE_1]');
    expect(out.removed).toContain('phone');
  });

  test('a line can be turned into a question to ask', async () => {
    const s = meeting(consented());
    const out = await s.act('t1', 'question');
    expect(out.question.source).toBe('manual');
    expect(s.snapshot().questions.some((q) => q.id === out.question.id)).toBe(true);
  });

  test('verify surfaces the flags and the records behind them', async () => {
    const s = meeting(consented());
    const out = await s.act('t3', 'verify');
    expect(out.records).toEqual(RECORDS);
  });

  test('route queues the line into a project', async () => {
    const s = meeting(consented());
    s.router.addProject('p', { name: 'P' });
    s.router.addRule({ id: 'r', project: 'p', when: { keywords: ['fairgrounds'] } });
    expect((await s.act('t1', 'route')).notes.length).toBeGreaterThan(0);
  });

  test('acting on an unknown turn fails cleanly', async () => {
    expect(await consented().act('nope', 'pin')).toEqual({ ok: false, reason: 'unknown turn' });
  });

  test('explain falls back to local guidance with no copilot', async () => {
    const s = meeting(consented());
    const out = await s.act('t2', 'explain');
    expect(out.ok).toBe(true);
    expect(out.local).toBe(true);
    expect(out.text).toEqual(expect.any(String));
  });

  test('explain uses the copilot when one is available', async () => {
    const copilot = new CopilotAdapter({ provider: 'anthropic', transport: async () => ({ ok: true, json: async () => ({ text: 'It means they are hedging.' }) }) });
    const s = meeting(consented({ copilot }));
    const out = await s.act('t1', 'explain');
    expect(out.text).toBe('It means they are hedging.');
    expect(out.local).toBeUndefined();
  });
});

describe('Session wipe', () => {
  test('takes everything, including pinned items and the redaction map', () => {
    const s = meeting(consented());
    expect(s.snapshot().transcript.length).toBeGreaterThan(0);
    const out = s.wipe();
    expect(out.wiped).toBeGreaterThan(0);
    const snap = s.snapshot();
    expect(snap.transcript).toEqual([]);
    expect(snap.flags).toEqual([]);
    expect(snap.cards).toEqual([]);
    expect(snap.buffer.live).toBe(0);
  });
});
