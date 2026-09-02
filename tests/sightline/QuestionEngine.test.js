'use strict';
const { QuestionEngine } = require('../../src/sightline/QuestionEngine');

const flag = (over = {}) => Object.assign({
  type: 'contradiction', severity: 'check', speaker: 'Ben',
  summary: 'Ben gave two figures.', suggestedFollowUp: 'Which figure is current, 30 or 20?',
  quotes: [],
}, over);

describe('QuestionEngine', () => {
  test('starts empty', () => {
    expect(new QuestionEngine().list()).toEqual([]);
  });

  test('turns a check-severity flag into a now-priority question', () => {
    const qe = new QuestionEngine();
    qe.refresh({ flags: [flag()] });
    expect(qe.list()[0]).toMatchObject({ priority: 'now', source: 'flag:contradiction', target: 'Ben' });
  });

  test('a watch-severity flag is queued as soon, not now', () => {
    const qe = new QuestionEngine();
    qe.refresh({ flags: [flag({ severity: 'watch', type: 'soft-commitment' })] });
    expect(qe.list()[0].priority).toBe('soon');
  });

  test('a flag with no follow-up produces no question', () => {
    const qe = new QuestionEngine();
    qe.refresh({ flags: [flag({ suggestedFollowUp: undefined })] });
    expect(qe.list().filter((q) => q.source.startsWith('flag:'))).toHaveLength(0);
  });

  test('an open thread becomes a circle-back question', () => {
    const qe = new QuestionEngine();
    qe.refresh({ openThreads: [{ text: 'How many WASH units?', speaker: 'Catrina' }] });
    const q = qe.list().find((x) => x.source === 'open-thread');
    expect(q.text).toMatch(/Circle back/);
    expect(q.why).toMatch(/Catrina/);
  });

  test('an unanswered flag supersedes the weaker circle-back row', () => {
    const qe = new QuestionEngine();
    const thread = { text: 'How many WASH units?', speaker: 'Catrina' };
    qe.refresh({ openThreads: [thread] });
    expect(qe.list().some((q) => q.source === 'open-thread')).toBe(true);

    qe.refresh({
      flags: [flag({ type: 'unanswered', severity: 'watch', suggestedFollowUp: 'Re-ask directly: "How many WASH units?"', quotes: [{ label: 'asked', text: 'How many WASH units?' }] })],
      openThreads: [thread],
    });
    expect(qe.list().some((q) => q.source === 'open-thread')).toBe(false);
    expect(qe.list().some((q) => q.text.startsWith('Re-ask'))).toBe(true);
  });

  test('puts the open decision in front of whoever can approve it', () => {
    const qe = new QuestionEngine();
    qe.refresh({ speakers: [{ id: 'ben', displayName: 'Ben Castro', rank: 'executive' }], agendaRemaining: ['the fairgrounds pilot'] });
    const q = qe.list().find((x) => x.source === 'decision-path');
    expect(q.text).toMatch(/Ben Castro/);
    expect(q.priority).toBe('now');
  });

  test('falls back to the id when a decider has no display name', () => {
    const qe = new QuestionEngine();
    qe.refresh({ speakers: [{ id: 'ben', rank: 'executive' }], agendaRemaining: ['x'] });
    expect(qe.list().find((x) => x.source === 'decision-path').text).toMatch(/^ben,/);
  });

  test('no decision-path question without an executive or an open item', () => {
    const qe = new QuestionEngine();
    qe.refresh({ speakers: [{ id: 'a', rank: 'staff' }], agendaRemaining: ['x'] });
    qe.refresh({ speakers: [{ id: 'b', rank: 'executive' }], agendaRemaining: [] });
    expect(qe.list().some((x) => x.source === 'decision-path')).toBe(false);
  });

  test('strong topic momentum becomes a parking-lot question', () => {
    const qe = new QuestionEngine();
    qe.refresh({ topicPrediction: { predictions: [{ topic: 'continue: fairgrounds, wash', probability: 0.6 }] } });
    expect(qe.list().find((x) => x.source === 'topic-momentum').priority).toBe('parking');
  });

  test('weak or non-continuation momentum is ignored', () => {
    const qe = new QuestionEngine();
    qe.refresh({ topicPrediction: { predictions: [{ topic: 'continue: x', probability: 0.1 }] } });
    qe.refresh({ topicPrediction: { predictions: [{ topic: 'agenda: y', probability: 0.9 }] } });
    expect(qe.list().some((x) => x.source === 'topic-momentum')).toBe(false);
  });

  test('only the newest momentum row survives a refresh', () => {
    const qe = new QuestionEngine();
    qe.refresh({ topicPrediction: { predictions: [{ topic: 'continue: alpha', probability: 0.6 }] } });
    qe.refresh({ topicPrediction: { predictions: [{ topic: 'continue: beta', probability: 0.6 }] } });
    const momentum = qe.list().filter((x) => x.source === 'topic-momentum');
    expect(momentum).toHaveLength(1);
    expect(momentum[0].text).toMatch(/beta/);
  });

  test('asks who owns the next step when nothing is outstanding', () => {
    const qe = new QuestionEngine();
    qe.refresh({});
    expect(qe.list().some((x) => x.source === 'closing')).toBe(true);
  });

  test('a manual question goes to the top', () => {
    const qe = new QuestionEngine();
    qe.refresh({ flags: [flag({ severity: 'watch' })] });
    const manual = qe.addManual('Ask about the lease term.');
    expect(manual.priority).toBe('now');
    expect(qe.list()[0].source).toBe('manual');
  });

  test('the same question is never queued twice', () => {
    const qe = new QuestionEngine();
    qe.refresh({ flags: [flag()] });
    qe.refresh({ flags: [flag()] });
    expect(qe.list().filter((q) => q.source === 'flag:contradiction')).toHaveLength(1);
  });

  test('an asked question leaves the list and never returns', () => {
    const qe = new QuestionEngine();
    qe.refresh({ flags: [flag()] });
    const id = qe.list()[0].id;
    expect(qe.markAsked(id).asked).toBe(true);
    expect(qe.list().some((q) => q.id === id)).toBe(false);
    expect(qe.list({ includeAsked: true }).some((q) => q.id === id)).toBe(true);

    qe.refresh({ flags: [flag()] });
    expect(qe.list().some((q) => q.source === 'flag:contradiction')).toBe(false);
  });

  test('marking an unknown question returns null', () => {
    expect(new QuestionEngine().markAsked('nope')).toBeNull();
  });

  test('dismiss removes a question outright', () => {
    const qe = new QuestionEngine();
    const q = qe.addManual('temp');
    expect(qe.dismiss(q.id)).toBe(true);
    expect(qe.dismiss(q.id)).toBe(false);
  });

  test('ordering is by priority then age', () => {
    const qe = new QuestionEngine();
    qe.refresh({
      flags: [flag(), flag({ severity: 'watch', type: 'unsourced', suggestedFollowUp: 'Where is that from?' })],
      topicPrediction: { predictions: [{ topic: 'continue: a', probability: 0.6 }] },
    });
    expect(qe.list().map((q) => q.priority)).toEqual(['now', 'soon', 'soon', 'parking']);
  });

  test('every question explains why it is queued', () => {
    const qe = new QuestionEngine();
    qe.refresh({ flags: [flag()], openThreads: [{ text: 'q?', speaker: 'C' }], agendaRemaining: [] });
    qe.list().forEach((q) => expect(q.why).toEqual(expect.any(String)));
  });
});
