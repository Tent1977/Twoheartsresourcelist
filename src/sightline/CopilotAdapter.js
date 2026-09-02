/**
 * CopilotAdapter.js — the pluggable brain.
 *
 * Everything else in Sightline works with no network at all: the lexical
 * passes classify, flag, predict and prompt on their own. The copilot makes
 * those results better, it is not load-bearing. If the API is down or the key
 * is missing, the meeting still gets transcribed and analysed.
 *
 * PROVIDERS
 *   'local'     — no network. Lexical results pass through unchanged.
 *   'anthropic' — Claude. Best judgement on rhetoric, tone and advice.
 *   'deepseek'  — cheap bulk re-scoring; good for the every-sentence pass.
 *   'existing'  — YOUR already-built copilot. Point `endpoint` at it and
 *                 implement `normalize` if its response shape differs.
 *
 * KEYS NEVER TOUCH THE BROWSER. Every provider call goes through the local
 * broker in server/index.js, which holds the keys in its own process env.
 */

'use strict';

const DEFAULT_TIMEOUT_MS = 6000;

const SYSTEM_PROMPT = `You assist a facilitator during a live meeting.

You will receive recent transcript turns and a lexical first-pass analysis.
Return STRICT JSON only, no prose, matching:
{
  "sentences": [{"index": int, "move": string, "epistemic": string, "confidence": number}],
  "tone": [{"speaker": string, "label": string, "emoji": string, "confidence": number}],
  "nextTopic": [{"topic": string, "probability": number, "why": string}],
  "questions": [{"text": string, "why": string, "priority": "now"|"soon"|"parking"}],
  "advice": {"headline": string, "note": string, "suggested": [string], "avoid": string|null}
}

Rules:
- Never assert that anyone is lying, deceptive, or untrustworthy. Report only
  contradictions between statements, with both quotes.
- Never infer a person's rank, competence, education or status from tone of
  voice, accent, grammar or demeanor. Infer standing only from what they claim.
- If you are not confident, say so in the confidence number. Do not round up.
- Keep every suggested line something a person could actually say out loud.`;

class CopilotAdapter {
  /**
   * @param {object} opts
   * @param {'local'|'anthropic'|'deepseek'|'existing'} [opts.provider='local']
   * @param {string} [opts.endpoint='/api/copilot']  Local broker route.
   * @param {function} [opts.transport]  fetch-like; injectable for tests.
   * @param {function} [opts.normalize]  Map a custom copilot's response shape.
   * @param {import('./Redaction').Redactor} [opts.redactor]  Applied before send.
   */
  constructor({
    provider = 'local',
    endpoint = '/api/copilot',
    transport = null,
    normalize = null,
    redactor = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    model = null,
  } = {}) {
    this.provider = provider;
    this.endpoint = endpoint;
    this.transport = transport || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.normalize = normalize;
    this.redactor = redactor;
    this.timeoutMs = timeoutMs;
    this.model = model;
    this.stats = { calls: 0, failures: 0, fallbacks: 0, totalMs: 0 };
  }

  get online() {
    return this.provider !== 'local' && typeof this.transport === 'function';
  }

  /**
   * Enrich a lexical analysis. ALWAYS resolves — never throws, never blocks the
   * transcript. On any failure it returns the lexical result with
   * `enriched:false` and the reason.
   *
   * @param {object} payload {turns, lexical, speakers, workspaceRules}
   */
  async enrich(payload) {
    const started = Date.now();
    if (!this.online) {
      this.stats.fallbacks += 1;
      return { enriched: false, reason: 'local provider — no model call made', result: payload.lexical };
    }

    const safe = this._redactPayload(payload);
    this.stats.calls += 1;

    try {
      const body = {
        provider: this.provider,
        model: this.model,
        system: SYSTEM_PROMPT,
        payload: safe,
      };
      const res = await this._withTimeout(this.transport(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }));

      if (!res || res.ok === false) {
        throw new Error(`copilot HTTP ${res && res.status ? res.status : 'error'}`);
      }
      const json = typeof res.json === 'function' ? await res.json() : res;
      const result = this.normalize ? this.normalize(json) : CopilotAdapter.defaultNormalize(json);
      this.stats.totalMs += Date.now() - started;
      return { enriched: true, reason: null, result: CopilotAdapter.merge(payload.lexical, result) };
    } catch (err) {
      this.stats.failures += 1;
      this.stats.fallbacks += 1;
      return { enriched: false, reason: err.message, result: payload.lexical };
    }
  }

  /** One-off question about the transcript — what the click-to-ask menu calls. */
  async ask(question, context = {}) {
    if (!this.online) {
      return { answered: false, reason: 'local provider — no model call made', text: null };
    }
    const safeContext = this.redactor
      ? Object.assign({}, context, { excerpt: this.redactor.redact(context.excerpt || '').text })
      : context;
    try {
      const res = await this._withTimeout(this.transport(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: this.provider, model: this.model, mode: 'ask', question, context: safeContext }),
      }));
      if (!res || res.ok === false) throw new Error(`copilot HTTP ${res && res.status ? res.status : 'error'}`);
      const json = typeof res.json === 'function' ? await res.json() : res;
      return { answered: true, reason: null, text: json.text || json.answer || '' };
    } catch (err) {
      this.stats.failures += 1;
      return { answered: false, reason: err.message, text: null };
    }
  }

  _redactPayload(payload) {
    if (!this.redactor) return payload;
    const turns = (payload.turns || []).map((t) => Object.assign({}, t, {
      text: this.redactor.redact(t.text || '').text,
    }));
    return Object.assign({}, payload, { turns });
  }

  _withTimeout(promise) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('copilot timeout')), this.timeoutMs);
    });
    // The timer must be cleared on BOTH paths. Leaving it armed after a fast
    // response holds the event loop open for the full timeout every call.
    return Promise.race([Promise.resolve(promise), timeout])
      .finally(() => { if (timer) clearTimeout(timer); });
  }

  /** Accept the documented shape, or a {content:[{text}]} Anthropic response. */
  static defaultNormalize(json) {
    if (json && Array.isArray(json.content)) {
      const text = json.content.map((c) => c.text || '').join('');
      try { return JSON.parse(text); } catch (e) { return { advice: { headline: 'Copilot', note: text, suggested: [], avoid: null } }; }
    }
    if (typeof json === 'string') {
      try { return JSON.parse(json); } catch (e) { return { advice: { headline: 'Copilot', note: json, suggested: [], avoid: null } }; }
    }
    return json || {};
  }

  /** Model output refines lexical output; it never silently replaces it. */
  static merge(lexical, model) {
    const out = Object.assign({}, lexical);
    if (model.sentences && Array.isArray(lexical.sentences)) {
      out.sentences = lexical.sentences.map((s, i) => {
        const m = model.sentences.find((x) => x.index === i);
        if (!m) return s;
        // Only take the model's label when it is more confident than the lexical pass.
        return (m.confidence || 0) > (s.confidence || 0)
          ? Object.assign({}, s, { move: m.move, epistemic: m.epistemic, confidence: m.confidence, source: 'model' })
          : Object.assign({}, s, { modelSuggested: m.move, source: 'lexical' });
      });
    }
    ['tone', 'nextTopic', 'questions', 'advice'].forEach((k) => {
      if (model[k] != null) out[k] = model[k];
    });
    out.modelAssisted = true;
    return out;
  }
}

module.exports = { CopilotAdapter, SYSTEM_PROMPT };
