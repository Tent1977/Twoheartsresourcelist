'use strict';
const { Timeclock } = require('../../src/sightline/Timeclock');

const clocked = (opts = {}) => {
  const state = { t: 0 };
  return { clock: new Timeclock(Object.assign({ now: () => state.t }, opts)), state };
};

describe('Timeclock', () => {
  test('reports zero before it is started', () => {
    expect(clocked().clock.elapsedMs()).toBe(0);
  });

  test('a session starting at epoch zero still measures time', () => {
    const { clock, state } = clocked();
    clock.start();
    state.t = 60000;
    expect(clock.elapsedMs()).toBe(60000);
  });

  test('start is idempotent', () => {
    const { clock, state } = clocked();
    clock.start(); state.t = 5000; clock.start();
    expect(clock.elapsedMs()).toBe(5000);
  });

  test('paused time is excluded', () => {
    const { clock, state } = clocked();
    clock.start();
    state.t = 10000; clock.pause();
    state.t = 40000; clock.resume();
    state.t = 50000;
    expect(clock.elapsedMs()).toBe(20000);
  });

  test('elapsed stops growing while paused', () => {
    const { clock, state } = clocked();
    clock.start(); state.t = 1000; clock.pause();
    state.t = 90000;
    expect(clock.elapsedMs()).toBe(1000);
  });

  test('pause and resume are no-ops out of sequence', () => {
    const { clock, state } = clocked();
    clock.resume();
    clock.pause();
    clock.start(); state.t = 1000;
    clock.pause(); clock.pause();
    state.t = 5000; clock.resume();
    expect(clock.elapsedMs()).toBe(1000);
  });

  test('stop freezes the clock and auto-resumes a pause first', () => {
    const { clock, state } = clocked();
    clock.start(); state.t = 10000; clock.pause();
    state.t = 20000; clock.stop();
    state.t = 99000;
    expect(clock.elapsedMs()).toBe(10000);
    clock.stop();
    expect(clock.elapsedMs()).toBe(10000);
  });

  test('stop before start does nothing', () => {
    const { clock } = clocked();
    clock.stop();
    expect(clock.elapsedMs()).toBe(0);
  });

  test('talk share is proportional and sorted', () => {
    const { clock } = clocked();
    clock.creditTalk('LD', 600000).creditTalk('CP', 300000).creditTalk('LD', 100000);
    const share = clock.talkShare();
    expect(share[0]).toMatchObject({ speakerId: 'LD', ms: 700000 });
    expect(share[0].share).toBeCloseTo(0.7);
    expect(share[1].share).toBeCloseTo(0.3);
  });

  test('talk share is empty with no credits and ignores bad input', () => {
    const { clock } = clocked();
    clock.creditTalk('LD', 0).creditTalk(null, 500).creditTalk('LD', -5);
    expect(clock.talkShare()).toEqual([]);
  });

  test('marks record their offset into the meeting', () => {
    const { clock, state } = clocked();
    clock.start(); state.t = 125000;
    expect(clock.mark('decision')).toMatchObject({ label: 'decision', atMs: 125000 });
    expect(clock.marks).toHaveLength(1);
  });

  test('billable is null without a rate', () => {
    expect(clocked().clock.billable()).toBeNull();
  });

  test('billable computes hours and amount', () => {
    const { clock, state } = clocked({ billableRate: 150 });
    clock.start(); state.t = 5400000;
    expect(clock.billable()).toEqual({ hours: 1.5, rate: 150, amount: 225 });
  });

  test('format pads to hh:mm:ss', () => {
    expect(Timeclock.format(0)).toBe('00:00:00');
    expect(Timeclock.format(61000)).toBe('00:01:01');
    expect(Timeclock.format(3661000)).toBe('01:01:01');
    expect(Timeclock.format(36000000)).toBe('10:00:00');
  });
});
