'use strict';
const { CopilotAdapter, SYSTEM_PROMPT } = require('../../src/sightline/CopilotAdapter');
const { Redactor } = require('../../src/sightline/Redaction');

const lexical = () => ({ sentences: [{ text: 'hi', move: 'statement', confidence: 0.4 }] });
const ok = (body) => async () => ({ ok: true, json: async () => body });

describe('CopilotAdapter', () => {
  test('defaults to the offline local provider', () => {
    const c = new CopilotAdapter();
    expect(c.provider).toBe('local');
    expect(c.online).toBe(false);
  });

  test('a remote provider picks up the ambient fetch when one exists', () => {
    expect(new CopilotAdapter({ provider: 'anthropic' }).online).toBe(typeof fetch === 'function');
  });

  test('a remote provider with no transport at all is offline', () => {
    const c = new CopilotAdapter({ provider: 'anthropic' });
    c.transport = null;
    expect(c.online).toBe(false);
  });

  test('local stays offline even with a working transport', () => {
    expect(new CopilotAdapter({ provider: 'local', transport: async () => ({}) }).online).toBe(false);
  });

  describe('the system prompt forbids the things that would sink this tool', () => {
    test('bans deception claims', () => {
      expect(SYSTEM_PROMPT).toMatch(/Never assert that anyone is lying/);
    });
    test('bans inferring status from demeanor', () => {
      expect(SYSTEM_PROMPT).toMatch(/Never infer a person's rank.*demeanor/s);
    });
    test('demands calibrated confidence', () => {
      expect(SYSTEM_PROMPT).toMatch(/Do not round up/);
    });
  });

  describe('enrich', () => {
    test('local provider passes the lexical result straight through', async () => {
      const out = await new CopilotAdapter().enrich({ turns: [], lexical: lexical() });
      expect(out.enriched).toBe(false);
      expect(out.reason).toMatch(/no model call/);
      expect(out.result).toEqual(lexical());
    });

    test('a more confident model label replaces the lexical one', async () => {
      const c = new CopilotAdapter({ provider: 'anthropic', transport: ok({ sentences: [{ index: 0, move: 'objection', epistemic: 'opinion', confidence: 0.9 }] }) });
      const out = await c.enrich({ turns: [{ text: 'hi' }], lexical: lexical() });
      expect(out.enriched).toBe(true);
      expect(out.result.sentences[0]).toMatchObject({ move: 'objection', source: 'model' });
      expect(out.result.modelAssisted).toBe(true);
    });

    test('a less confident model label is kept only as a suggestion', async () => {
      const c = new CopilotAdapter({ provider: 'anthropic', transport: ok({ sentences: [{ index: 0, move: 'objection', confidence: 0.1 }] }) });
      const out = await c.enrich({ turns: [{ text: 'hi' }], lexical: lexical() });
      expect(out.result.sentences[0]).toMatchObject({ move: 'statement', modelSuggested: 'objection', source: 'lexical' });
    });

    test('sentences the model did not score are left alone', async () => {
      const c = new CopilotAdapter({ provider: 'anthropic', transport: ok({ sentences: [{ index: 5, move: 'x', confidence: 1 }] }) });
      const out = await c.enrich({ turns: [{ text: 'hi' }], lexical: lexical() });
      expect(out.result.sentences[0].move).toBe('statement');
    });

    test('a transport failure degrades to the lexical result', async () => {
      const c = new CopilotAdapter({ provider: 'anthropic', transport: async () => { throw new Error('ECONNREFUSED'); } });
      const out = await c.enrich({ turns: [], lexical: lexical() });
      expect(out).toMatchObject({ enriched: false, reason: 'ECONNREFUSED' });
      expect(out.result).toEqual(lexical());
      expect(c.stats.failures).toBe(1);
    });

    test('an HTTP error degrades rather than throwing', async () => {
      const c = new CopilotAdapter({ provider: 'anthropic', transport: async () => ({ ok: false, status: 500 }) });
      expect((await c.enrich({ turns: [], lexical: lexical() })).reason).toMatch(/HTTP 500/);
    });

    test('a slow model is abandoned, not waited on', async () => {
      const c = new CopilotAdapter({ provider: 'anthropic', timeoutMs: 20, transport: () => new Promise((r) => setTimeout(r, 200)) });
      expect((await c.enrich({ turns: [], lexical: lexical() })).reason).toBe('copilot timeout');
    });

    test('transcript text is redacted before it reaches any model', async () => {
      let sentBody = null;
      const c = new CopilotAdapter({
        provider: 'anthropic',
        redactor: new Redactor(),
        transport: async (url, init) => { sentBody = JSON.parse(init.body); return { ok: true, json: async () => ({}) }; },
      });
      await c.enrich({ turns: [{ text: 'call 775-555-0134' }], lexical: lexical() });
      expect(sentBody.payload.turns[0].text).toBe('call [PHONE_1]');
      expect(sentBody.system).toBe(SYSTEM_PROMPT);
    });

    test('a custom normalize hook maps a third-party copilot shape', async () => {
      const c = new CopilotAdapter({
        provider: 'existing',
        transport: ok({ weird: { headline: 'Custom' } }),
        normalize: (json) => ({ advice: json.weird }),
      });
      const out = await c.enrich({ turns: [], lexical: lexical() });
      expect(out.result.advice.headline).toBe('Custom');
    });
  });

  describe('ask', () => {
    test('local provider declines cleanly', async () => {
      expect(await new CopilotAdapter().ask('why?')).toMatchObject({ answered: false, text: null });
    });

    test('returns the model answer', async () => {
      const c = new CopilotAdapter({ provider: 'anthropic', transport: ok({ text: 'because.' }) });
      expect(await c.ask('why?', { excerpt: 'x' })).toMatchObject({ answered: true, text: 'because.' });
    });

    test('accepts an answer field as well as text', async () => {
      const c = new CopilotAdapter({ provider: 'anthropic', transport: ok({ answer: 'alt' }) });
      expect((await c.ask('why?')).text).toBe('alt');
    });

    test('redacts the excerpt before asking', async () => {
      let body = null;
      const c = new CopilotAdapter({
        provider: 'anthropic', redactor: new Redactor(),
        transport: async (u, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ text: 'ok' }) }; },
      });
      await c.ask('what is this?', { excerpt: 'email a@b.co' });
      expect(body.context.excerpt).toBe('email [EMAIL_1]');
    });

    test('a failure is reported, not thrown', async () => {
      const c = new CopilotAdapter({ provider: 'anthropic', transport: async () => { throw new Error('nope'); } });
      expect(await c.ask('why?')).toMatchObject({ answered: false, reason: 'nope' });
    });
  });

  describe('defaultNormalize', () => {
    test('parses an Anthropic content array of JSON', () => {
      expect(CopilotAdapter.defaultNormalize({ content: [{ text: '{"advice":{"headline":"Hi"}}' }] }).advice.headline).toBe('Hi');
    });

    test('wraps non-JSON prose as advice rather than failing', () => {
      expect(CopilotAdapter.defaultNormalize({ content: [{ text: 'just prose' }] }).advice.note).toBe('just prose');
    });

    test('parses a JSON string', () => {
      expect(CopilotAdapter.defaultNormalize('{"a":1}')).toEqual({ a: 1 });
    });

    test('wraps a non-JSON string', () => {
      expect(CopilotAdapter.defaultNormalize('hello').advice.note).toBe('hello');
    });

    test('passes an object through and survives null', () => {
      expect(CopilotAdapter.defaultNormalize({ a: 1 })).toEqual({ a: 1 });
      expect(CopilotAdapter.defaultNormalize(null)).toEqual({});
    });
  });

  test('merge tolerates a lexical result with no sentences', () => {
    expect(CopilotAdapter.merge({}, { advice: { headline: 'x' } })).toMatchObject({ advice: { headline: 'x' }, modelAssisted: true });
  });

  test('stats track calls, failures and fallbacks', async () => {
    const c = new CopilotAdapter({ provider: 'anthropic', transport: async () => { throw new Error('x'); } });
    await c.enrich({ turns: [], lexical: lexical() });
    expect(c.stats).toMatchObject({ calls: 1, failures: 1, fallbacks: 1 });
  });
});
