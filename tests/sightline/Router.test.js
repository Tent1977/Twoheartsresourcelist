'use strict';
const { Workspace } = require('../../src/sightline/Workspace');
const { Router } = require('../../src/sightline/Router');
const { Redactor } = require('../../src/sightline/Redaction');

const build = (opts = {}) => {
  const r = new Router(Object.assign({ workspace: new Workspace('ABLE') }, opts));
  r.addProject('safe-parking', { name: 'RISE RV Safe Parking' });
  return r;
};

describe('Router', () => {
  test('requires a workspace', () => {
    expect(() => new Router({})).toThrow(/requires a workspace/);
  });

  describe('workspace partition', () => {
    test('refuses a project belonging to the other organisation', () => {
      expect(() => build().addProject('hiway40', { workspace: 'VOA' }))
        .toThrow(/belongs to VOA; this router is scoped to ABLE/);
    });

    test('projects default to the router workspace', () => {
      expect(build().projects.get('safe-parking').workspace).toBe('ABLE');
    });

    test('notes are stamped with the workspace', () => {
      const r = build();
      r.addRule({ id: 'k', project: 'safe-parking', when: { keywords: ['fairgrounds'] } });
      expect(r.route({ text: 'the fairgrounds lot' })[0].workspace).toBe('ABLE');
    });
  });

  describe('rules', () => {
    test('a rule must name a known project', () => {
      expect(() => build().addRule({ project: 'nope', when: {} })).toThrow(/Unknown project/);
      expect(() => build().addRule({ when: {} })).toThrow(/rule.project is required/);
    });

    test('rules are evaluated highest priority first', () => {
      const r = build();
      r.addProject('codesign', {});
      r.addRule({ id: 'low', project: 'codesign', when: { keywords: ['lot'] }, priority: 1 });
      r.addRule({ id: 'high', project: 'safe-parking', when: { keywords: ['lot'] }, priority: 9 });
      expect(r.rules[0].id).toBe('high');
    });

    test('rules get an id when none is supplied', () => {
      expect(build().addRule({ project: 'safe-parking', when: { keywords: ['x'] } }).id).toBe('r1');
    });
  });

  describe('matching', () => {
    const item = { text: 'The fairgrounds lot could hold 30 RVs.', speaker: 'Ben', move: 'statement', epistemic: 'assertion' };

    test.each([
      [{ keywords: ['fairgrounds'] }, true],
      [{ keywords: ['nothing'] }, false],
      [{ keywords: ['fairgrounds', 'RVs'], keywordMode: 'all' }, true],
      [{ keywords: ['fairgrounds', 'missing'], keywordMode: 'all' }, false],
      [{ keywords: ['fairgrounds', 'missing'] }, true],
      [{ speaker: 'Ben' }, true],
      [{ speaker: 'Catrina' }, false],
      [{ move: 'statement' }, true],
      [{ move: 'question' }, false],
      [{ epistemic: 'assertion' }, true],
      [{ re: /\bRVs\b/ }, true],
      [{ re: /\bbuses\b/ }, false],
      [{ flagType: 'contradiction' }, false],
    ])('%j matches %s', (when, expected) => {
      expect(Router.matches(when, item)).toBe(expected);
    });

    test('keyword matching is case-insensitive', () => {
      expect(Router.matches({ keywords: ['FAIRGROUNDS'] }, item)).toBe(true);
    });

    test('an empty condition matches nothing, on purpose', () => {
      expect(Router.matches({}, item)).toBe(false);
    });

    test('conditions are combined with AND', () => {
      expect(Router.matches({ speaker: 'Ben', keywords: ['fairgrounds'] }, item)).toBe(true);
      expect(Router.matches({ speaker: 'Catrina', keywords: ['fairgrounds'] }, item)).toBe(false);
    });
  });

  describe('routing', () => {
    test('one sentence can go to more than one project', () => {
      const r = build();
      r.addProject('codesign', {});
      r.addRule({ id: 'a', project: 'safe-parking', when: { keywords: ['fairgrounds'] } });
      r.addRule({ id: 'b', project: 'codesign', when: { keywords: ['fairgrounds'] } });
      expect(r.route({ text: 'the fairgrounds lot' })).toHaveLength(2);
    });

    test('the same sentence is not queued twice into one project', () => {
      const r = build();
      r.addRule({ id: 'a', project: 'safe-parking', when: { keywords: ['fairgrounds'] } });
      r.route({ text: 'the fairgrounds lot' });
      expect(r.route({ text: 'the fairgrounds lot' })).toHaveLength(0);
      expect(r.pending()).toHaveLength(1);
    });

    test('nothing leaves without passing the redactor', () => {
      const r = build({ redactor: new Redactor() });
      r.addRule({ id: 'a', project: 'safe-parking', when: { keywords: ['call'] } });
      const note = r.route({ text: 'call me at 775-555-0134' })[0];
      expect(note.text).toBe('call me at [PHONE_1]');
      expect(note.redacted).toBe(true);
      expect(note.redactedKinds).toEqual(['phone']);
    });

    test('notes carry the rule that caught them and why', () => {
      const r = build();
      r.addRule({ id: 'sp', project: 'safe-parking', when: { keywords: ['fairgrounds'] }, why: 'pilot terms', noteType: 'research' });
      expect(r.route({ text: 'fairgrounds' })[0]).toMatchObject({ matchedRule: 'sp', why: 'pilot terms', noteType: 'research', status: 'queued' });
    });

    test('a queued note can be cancelled before it goes anywhere', () => {
      const r = build();
      r.addRule({ id: 'a', project: 'safe-parking', when: { keywords: ['x'] } });
      const note = r.route({ text: 'x marks it' })[0];
      expect(r.cancel(note.id)).toBe(true);
      expect(r.cancel(note.id)).toBe(false);
      expect(r.pending()).toHaveLength(0);
    });
  });

  describe('dispatch', () => {
    test('rejects a non-function dispatcher', () => {
      expect(() => build().registerDispatcher('x', 'nope')).toThrow(/must be a function/);
    });

    test('delivers through the registered dispatcher', async () => {
      const sent = [];
      const r = build();
      r.addProject('asana', { dispatcher: 'log' });
      r.registerDispatcher('log', async (note) => { sent.push(note.text); return { ref: `id-${note.id}` }; });
      r.addRule({ id: 'a', project: 'asana', when: { keywords: ['ship'] } });
      r.route({ text: 'ship it' });
      const res = await r.flush();
      expect(res).toEqual([{ id: 'n1', status: 'sent', ref: 'id-n1' }]);
      expect(sent).toEqual(['ship it']);
      expect(r.pending()).toHaveLength(0);
    });

    test('holds a note when no dispatcher is registered', async () => {
      const r = build();
      r.addRule({ id: 'a', project: 'safe-parking', when: { keywords: ['x'] } });
      r.route({ text: 'x' });
      const res = await r.flush();
      expect(res[0].status).toBe('held');
      expect(res[0].reason).toMatch(/no dispatcher/);
    });

    test('a dry run sends nothing', async () => {
      const fn = jest.fn();
      const r = build();
      r.addProject('p', { dispatcher: 'd' });
      r.registerDispatcher('d', fn);
      r.addRule({ id: 'a', project: 'p', when: { keywords: ['x'] } });
      r.route({ text: 'x' });
      expect((await r.flush({ dryRun: true }))[0].status).toBe('dry-run');
      expect(fn).not.toHaveBeenCalled();
    });

    test('a failing dispatcher marks the note failed without throwing', async () => {
      const r = build();
      r.addProject('p', { dispatcher: 'd' });
      r.registerDispatcher('d', async () => { throw new Error('network down'); });
      r.addRule({ id: 'a', project: 'p', when: { keywords: ['x'] } });
      r.route({ text: 'x' });
      const res = await r.flush();
      expect(res[0]).toMatchObject({ status: 'failed', error: 'network down' });
    });

    test('a dispatcher returning nothing still counts as sent', async () => {
      const r = build();
      r.addProject('p', { dispatcher: 'd' });
      r.registerDispatcher('d', async () => undefined);
      r.addRule({ id: 'a', project: 'p', when: { keywords: ['x'] } });
      r.route({ text: 'x' });
      expect((await r.flush())[0]).toMatchObject({ status: 'sent', ref: null });
    });

    test('flushing an empty outbox is a no-op', async () => {
      expect(await build().flush()).toEqual([]);
    });
  });
});
