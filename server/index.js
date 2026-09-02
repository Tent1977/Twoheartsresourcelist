#!/usr/bin/env node
/**
 * server/index.js — static host + API key broker for Sightline.
 *
 * Zero dependencies on purpose. This runs on Lawrence's laptop next to the
 * meeting; every dependency is a thing that can break in a room full of people
 * or leak a transcript to somewhere it should not go.
 *
 * WHY A BROKER AT ALL:
 * API keys must never reach the browser. A key in client JavaScript is a key
 * published to everyone in the meeting who opens dev tools, and to anyone the
 * page is ever screen-shared with. The browser talks only to this process; this
 * process holds the keys in its own environment and talks to the providers.
 *
 * WHAT THIS PROCESS DOES NOT DO:
 *   - It does not write transcripts to disk. Ever.
 *   - It does not log request or response bodies.
 *   - It does not listen on anything but localhost unless you force it.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 1_000_000;

const PROVIDERS = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-opus-5',
    headers: (key) => ({
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    body: ({ model, system, user, maxTokens }) => ({
      model, system, max_tokens: maxTokens,
      messages: [{ role: 'user', content: user }],
    }),
    extract: (json) => (json.content || []).map((c) => c.text || '').join(''),
  },
  deepseek: {
    url: 'https://api.deepseek.com/chat/completions',
    envKey: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    headers: (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    body: ({ model, system, user, maxTokens }) => ({
      model, max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    extract: (json) => (((json.choices || [])[0] || {}).message || {}).content || '',
  },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    // No transcript fragment should ever end up in a shared cache.
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  }, headers));
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (err) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/** Which providers actually have a key present. */
function availability() {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([name, p]) => [name, Boolean(process.env[p.envKey])]));
}

async function callProvider(name, { system, user, model, maxTokens = 1400 }) {
  const provider = PROVIDERS[name];
  if (!provider) throw Object.assign(new Error(`unknown provider "${name}"`), { status: 400 });

  const key = process.env[provider.envKey];
  if (!key) {
    throw Object.assign(new Error(`${provider.envKey} is not set in this process`), { status: 503 });
  }

  const res = await fetch(provider.url, {
    method: 'POST',
    headers: provider.headers(key),
    body: JSON.stringify(provider.body({ model: model || provider.defaultModel, system, user, maxTokens })),
  });

  if (!res.ok) {
    // Report the status, never the provider's response body — it can echo the
    // prompt, and the prompt is meeting content.
    throw Object.assign(new Error(`${name} responded ${res.status}`), { status: 502 });
  }
  return provider.extract(await res.json());
}

async function handleCopilot(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (err) { return send(res, 400, { error: err.message }); }

  const { provider = 'anthropic', model = null, system = '', mode = 'enrich' } = body;

  const user = mode === 'ask'
    ? `Question: ${body.question}\n\nExcerpt (${(body.context || {}).speaker || 'unknown speaker'}): ${(body.context || {}).excerpt || ''}`
    : JSON.stringify(body.payload || {});

  try {
    const text = await callProvider(provider, {
      system: system || 'You assist a meeting facilitator. Be concise and concrete.',
      user, model,
    });
    if (mode === 'ask') return send(res, 200, { text });
    try { return send(res, 200, JSON.parse(text)); }
    catch (e) { return send(res, 200, { advice: { headline: 'Copilot', note: text, suggested: [], avoid: null } }); }
  } catch (err) {
    // Log the failure, not the content.
    console.error(`[copilot] ${provider} failed: ${err.message}`);
    return send(res, err.status || 500, { error: err.message });
  }
}

/**
 * Speech provider config for the browser. Returns a short-lived Deepgram key
 * when one can be minted, so the long-lived key stays in this process.
 */
async function handleSpeechConfig(req, res) {
  const key = process.env.DEEPGRAM_API_KEY;
  const project = process.env.DEEPGRAM_PROJECT_ID;

  if (!key) {
    return send(res, 200, {
      provider: 'browser',
      reason: 'DEEPGRAM_API_KEY not set — falling back to the browser speech API, which does not diarize.',
      diarization: false,
    });
  }
  if (!project) {
    return send(res, 200, {
      provider: 'deepgram',
      diarization: true,
      ephemeral: false,
      reason: 'DEEPGRAM_PROJECT_ID not set — cannot mint a short-lived key. Set it so the long-lived key never reaches the browser.',
    });
  }
  try {
    const r = await fetch(`https://api.deepgram.com/v1/projects/${project}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Token ${key}` },
      body: JSON.stringify({
        comment: 'sightline ephemeral',
        scopes: ['usage:write'],
        time_to_live_in_seconds: 7200,
      }),
    });
    if (!r.ok) throw new Error(`deepgram responded ${r.status}`);
    const json = await r.json();
    return send(res, 200, { provider: 'deepgram', diarization: true, ephemeral: true, key: json.key, expiresIn: 7200 });
  } catch (err) {
    console.error(`[speech] ${err.message}`);
    return send(res, 502, { error: err.message });
  }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, rel);
  // Refuse anything that climbs out of public/.
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    send(res, 200, data, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  });
}

const LIB_DIR = path.join(__dirname, '..', 'src', 'sightline');

function serveLib(req, res, name) {
  if (!/^[A-Za-z]+\.js$/.test(name)) return send(res, 400, { error: 'bad module name' });
  const filePath = path.join(LIB_DIR, name);
  if (!filePath.startsWith(LIB_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, { error: 'not found' });
    send(res, 200, data, { 'content-type': MIME['.js'] });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, providers: availability(), speech: Boolean(process.env.DEEPGRAM_API_KEY) });
  }
  if (req.method === 'GET' && url.pathname === '/api/speech-config') return handleSpeechConfig(req, res);
  if (req.method === 'POST' && url.pathname === '/api/copilot') return handleCopilot(req, res);
  // The browser runs the SAME analysis modules the test suite exercises.
  // Serving them directly means there is one implementation, not two.
  if (req.method === 'GET' && url.pathname.startsWith('/lib/')) {
    return serveLib(req, res, url.pathname.slice('/lib/'.length));
  }
  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  return send(res, 405, { error: 'method not allowed' });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const have = availability();
    console.log(`Sightline on http://${HOST}:${PORT}`);
    console.log(`  copilot providers: ${Object.entries(have).map(([k, v]) => `${k}=${v ? 'ready' : 'no key'}`).join(', ')}`);
    console.log(`  speech: ${process.env.DEEPGRAM_API_KEY ? 'deepgram (diarization on)' : 'browser fallback (no diarization)'}`);
    if (HOST !== '127.0.0.1') console.warn('  WARNING: not bound to localhost. Anything on this network can reach the broker.');
  });
}

module.exports = { server, availability, PROVIDERS };
