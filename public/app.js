/*
 * app.js — the console controller.
 *
 * Owns: the consent gate, the audio source, the render loop, the point-and-click
 * inspector and the notebook popup. All analysis lives in the Sightline modules
 * loaded from /lib — this file decides what to show and when.
 */

(function () {
  'use strict';

  const MODULES = [
    'Workspace', 'Consent', 'EphemeralBuffer', 'Timeclock', 'Diarization',
    'SpeakerRegistry', 'Redaction', 'Rhetoric', 'ToneMeter', 'Prediction',
    'VerificationFlags', 'Notebook', 'QuestionEngine', 'Router',
    'CopilotAdapter', 'Session',
  ];

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); };
  const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

  const state = {
    require: null,
    session: null,
    workspace: 'ABLE',
    selected: null,
    show: { tone: true, notebook: true, flags: true, predict: true, faces: false },
    participants: ['Lawrence Dodson'],
    demoTimer: null,
    audio: null,
  };

  // ---------------------------------------------------------------- consent

  function renderGate() {
    const { Session } = state.require('Session');
    const probe = new Session({ workspace: state.workspace, jurisdiction: 'NV' });

    $('gate-law').textContent = probe.consent.allPartyRequired
      ? `Nevada requires the consent of every party before a conversation is recorded (NRS 200.620 / 200.650). Read the script below out loud and get an audible yes from each person.`
      : `This jurisdiction allows one-party consent, but disclosure is still the right call.`;

    const script = $('gate-script');
    clear(script);
    probe.consentScript(state.participants[0] || 'the host')
      .forEach((line) => script.appendChild(el('p', null, line)));

    renderParticipants();
  }

  function renderParticipants() {
    const box = $('gate-people');
    clear(box);
    state.participants.forEach((name, i) => {
      const row = el('div', 'person-row');
      const input = el('input');
      input.type = 'text';
      input.value = name;
      input.placeholder = 'Name or role';
      input.addEventListener('input', () => { state.participants[i] = input.value; });
      row.appendChild(input);

      if (i > 0) {
        const rm = el('button', 'btn', 'Remove');
        rm.addEventListener('click', () => {
          state.participants.splice(i, 1);
          renderParticipants();
        });
        row.appendChild(rm);
      }
      box.appendChild(row);
    });
  }

  function startSession({ demo = false } = {}) {
    const { Session } = state.require('Session');
    const { CopilotAdapter } = state.require('CopilotAdapter');

    const session = new Session({
      workspace: state.workspace,
      jurisdiction: 'NV',
      agenda: [],
      copilot: new CopilotAdapter({ provider: window.__copilotProvider || 'local' }),
    });

    const ids = state.participants.map((n) => n.trim()).filter(Boolean);
    ids.forEach((id) => session.recordConsent(id, { recording: true, analysis: true, method: 'verbal-on-record' }));

    try {
      session.start(ids);
    } catch (err) {
      const blocked = $('gate-blocked');
      blocked.hidden = false;
      blocked.textContent = err.message;
      return;
    }

    state.session = session;
    session.copilot.redactor = session.redactor;
    $('gate').hidden = true;
    seedProjects(session);
    render();
    if (demo) runDemo(); else startMicrophone();
  }

  /**
   * Starter routing rules. These are examples that match how the work is
   * actually split up — edit them, they are meant to be edited.
   */
  function seedProjects(session) {
    if (session.workspace.id !== 'ABLE') return;
    session.router.addProject('safe-parking', { name: 'RV / Car Safe Parking' });
    session.router.addProject('co-design', { name: 'Co-Design System' });
    session.router.addProject('directory', { name: 'Resource Directory' });

    session.router.addRule({
      id: 'safe-parking', project: 'safe-parking', priority: 5,
      when: { keywords: ['safe parking', 'RV', 'vehicle', 'fairgrounds', 'WASH', 'lot'] },
      noteType: 'research', why: 'safe parking pilot terms',
    });
    session.router.addRule({
      id: 'co-design', project: 'co-design', priority: 5,
      when: { keywords: ['co-design', 'facilitation', 'certification', 'phase', 'workshop'] },
      noteType: 'note', why: 'co-design engagement terms',
    });
    session.router.addRule({
      id: 'directory', project: 'directory', priority: 5,
      when: { keywords: ['directory', 'listing', 'resource list', 'shelter hours', 'intake'] },
      noteType: 'note', why: 'resource directory terms',
    });
    session.router.addRule({
      id: 'commitments', project: 'co-design', priority: 9,
      when: { move: 'commitment' }, noteType: 'action-item', why: 'someone committed to something',
    });
  }

  // ------------------------------------------------------------------ audio

  async function startMicrophone() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      note('No speech recognition in this browser. Use the demo, or run Chrome.');
      return;
    }
    // The browser API cannot diarize. Everything lands on one speaker until the
    // user splits it, or until a Deepgram key is configured server-side.
    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';

    let offset = 0;
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result.isFinal) continue;
        const text = result[0].transcript.trim();
        const confidence = result[0].confidence || 0.8;
        text.split(/\s+/).forEach((word) => {
          try {
            state.session.ingestWord({ text: word, speaker: 0, startMs: offset, endMs: offset + 150, confidence });
          } catch (err) { /* not recording */ }
          offset += 160;
        });
        offset += 700;
        state.session.flush();
        render();
      }
    };
    rec.onerror = (e) => note(`Speech recognition error: ${e.error}`);
    rec.onend = () => { if (state.session && state.session.recording) rec.start(); };
    rec.start();
    state.audio = rec;
    note('Listening. This browser cannot tell speakers apart — set DEEPGRAM_API_KEY for real diarization.');
  }

  // ------------------------------------------------------------------- demo

  const DEMO = [
    [0, "Hi, I'm Ben with RISE. We are proposing 30 parking spots at the fairgrounds."],
    [1, 'How many WASH units does that require?'],
    [0, 'The lot has good lighting and a fence around the whole perimeter.'],
    [2, 'Before we go further, our program is low-barrier, which is honestly our biggest selling point.'],
    [1, 'I disagree, that will not work without water and sanitation on site.'],
    [0, 'Fair point. Honestly we are proposing 20 parking spots now, it depends on the budget.'],
    [2, 'I will put together a WASH cost sheet.'],
    [1, 'So what would this cost us for four sessions?'],
    [0, 'I can approve the site plan today if the numbers hold.'],
  ];

  function runDemo() {
    let i = 0;
    let offset = 0;
    note('Demo meeting running. Click any line to interrogate it.');
    state.demoTimer = setInterval(() => {
      if (i >= DEMO.length) { clearInterval(state.demoTimer); state.session.flush(); render(); return; }
      const [speaker, text] = DEMO[i];
      text.split(/\s+/).forEach((word) => {
        state.session.ingestWord({ text: word, speaker, startMs: offset, endMs: offset + 150, confidence: 0.93 });
        offset += 160;
      });
      offset += 2500;
      state.session.flush();
      render();
      i += 1;
    }, 1600);
  }

  // ----------------------------------------------------------------- render

  function render() {
    if (!state.session) return;
    const snap = state.session.snapshot();

    document.documentElement.dataset.workspace = snap.workspace.id;

    $('clock').textContent = snap.clock.elapsed;
    $('clock').classList.toggle('paused', !snap.recording);

    const wipe = $('wipe');
    if (snap.buffer.msUntilNextExpiry == null) {
      wipe.textContent = snap.buffer.live ? `${snap.buffer.live} held, all pinned` : 'buffer empty';
      wipe.classList.remove('urgent');
    } else {
      wipe.textContent = `wipe in ${mmss(snap.buffer.msUntilNextExpiry)} · ${snap.buffer.live} held`;
      wipe.classList.toggle('urgent', snap.buffer.msUntilNextExpiry < 5 * 60 * 1000);
    }

    renderTranscript(snap);
    renderPeople(snap);
    renderTone(snap);
    renderPredict(snap);
    renderQuestions(snap);
    renderFlags(snap);
    renderRouting(snap);

    if (state.show.notebook && snap.cards.length) showNotebook(snap.cards[0]);
  }

  function renderTranscript(snap) {
    const box = $('transcript');
    $('turn-count').textContent = snap.transcript.length;
    clear(box);
    if (!snap.transcript.length) {
      box.appendChild(el('p', 'empty', 'Waiting for the first word.'));
      return;
    }
    const byName = new Map(snap.speakers.map((p) => [p.displayName, p]));

    snap.transcript.forEach((turn) => {
      const node = el('div', `turn${turn.uncertain ? ' uncertain' : ''}`);
      node.dataset.turn = turn.id;
      node.setAttribute('aria-selected', String(state.selected === turn.id));

      const who = el('div', 'who');
      const person = byName.get(turn.speaker);
      const dot = el('i', 'rank-dot');
      dot.style.background = person && person.badge ? person.badge.color : '#5A6B80';
      who.appendChild(dot);
      who.appendChild(el('span', 'name', turn.speaker));
      who.appendChild(el('span', 'at', mmss(turn.startMs)));

      if (state.show.tone) {
        const tone = snap.tone.find((t) => t.speaker === turn.speaker);
        if (tone) {
          const face = el('span', 'tone', tone.current.emoji);
          face.title = `${tone.current.label} (confidence ${tone.current.confidence}) — ${tone.current.caveat}`;
          who.appendChild(face);
        }
      }
      node.appendChild(who);
      node.appendChild(el('div', 'text', turn.text));

      const Rhetoric = state.require('Rhetoric');
      const moves = el('div', 'moves');
      Rhetoric.segment(turn.text).map(Rhetoric.classify)
        .filter((s) => s.notebookWorthy)
        .slice(0, 3)
        .forEach((s) => {
          const kind = ['fact', 'opinion', 'idea'].includes(s.epistemic) ? s.epistemic : s.move;
          moves.appendChild(el('span', `chip ${kind}`, kind));
        });
      if (moves.childNodes.length) node.appendChild(moves);

      node.addEventListener('click', () => select(turn.id));
      box.appendChild(node);
    });
    box.scrollTop = box.scrollHeight;
  }

  function renderPeople(snap) {
    const box = $('people');
    $('people-count').textContent = snap.speakers.length;
    clear(box);
    if (!snap.speakers.length) { box.appendChild(el('p', 'empty', 'Nobody has spoken yet.')); return; }

    const share = new Map(snap.clock.talkShare.map((t) => [t.name, t.share]));
    snap.speakers.forEach((p) => {
      const row = el('div', 'person');
      const sw = el('i', 'swatch');
      sw.style.background = p.badge.color;
      sw.style.boxShadow = `0 0 7px ${p.badge.color}`;
      row.appendChild(sw);

      const meta = el('div', 'meta');
      meta.appendChild(el('div', 'n', p.displayName || 'Unidentified'));
      const rank = el('div', 'r', p.badge.label);
      if (p.badge.source === 'inferred') {
        rank.appendChild(document.createTextNode(' '));
        const tag = el('span', 'inferred', '(inferred)');
        tag.title = p.evidence && p.evidence.length
          ? `From what they said: "${p.evidence[0].quote}"`
          : 'Inferred from statements made, not from demeanor.';
        rank.appendChild(tag);
      }
      meta.appendChild(rank);

      const pct = share.get(p.displayName) || 0;
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${Math.round(pct * 100)}%`;
      bar.appendChild(fill);
      meta.appendChild(bar);
      row.appendChild(meta);
      row.appendChild(el('span', 'share', `${Math.round(pct * 100)}%`));
      box.appendChild(row);
    });
  }

  function renderTone(snap) {
    const box = $('tone');
    clear(box);
    if (!state.show.tone) { box.appendChild(el('p', 'empty', 'Tone display is off.')); return; }
    if (!snap.tone.length) { box.appendChild(el('p', 'empty', 'Listening.')); return; }

    snap.tone.forEach((t) => {
      const row = el('div', 'row');
      const head = el('div');
      head.appendChild(el('span', null, `${t.current.emoji} `));
      head.appendChild(el('strong', null, t.speaker));
      head.appendChild(el('span', null, ` — ${t.current.label}`));
      if (t.trend) head.appendChild(el('span', null, ` (${t.trend.direction})`));
      row.appendChild(head);
      row.appendChild(el('div', 'why', t.current.lowConfidence
        ? 'Not enough signal to call it — shown as neutral on purpose.'
        : t.current.caveat));
      box.appendChild(row);
    });
  }

  function renderPredict(snap) {
    const box = $('predict');
    clear(box);
    if (!state.show.predict) { box.appendChild(el('p', 'empty', 'Prediction is off.')); return; }

    const topic = snap.prediction.nextTopic;
    if (!topic.predictions.length) { box.appendChild(el('p', 'empty', 'Not enough conversation yet.')); return; }

    topic.predictions.slice(0, 3).forEach((p) => {
      const row = el('div', 'pred');
      row.appendChild(el('span', 'p', `${Math.round(p.probability * 100)}%`));
      const track = el('div', 'track');
      const fill = el('i');
      fill.style.width = `${Math.round(p.probability * 100)}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.title = p.why;
      box.appendChild(row);
      box.appendChild(el('div', 'why', p.topic));
    });

    const next = snap.prediction.nextSentence;
    box.appendChild(el('div', 'why', `Next move likely: ${next.predictions.slice(0, 2).map((m) => `${m.move} ${Math.round(m.probability * 100)}%`).join(', ')}`));
    if (!next.reliable) {
      box.appendChild(el('div', 'unreliable', `Based on ${next.basis} — ${next.samples} observations so far. Treat as a hint.`));
    }
  }

  function renderQuestions(snap) {
    const box = $('questions');
    $('q-count').textContent = snap.questions.length;
    clear(box);
    if (!snap.questions.length) { box.appendChild(el('p', 'empty', 'Nothing queued.')); return; }

    snap.questions.slice(0, 8).forEach((q) => {
      const row = el('div', 'row');
      const head = el('div');
      head.appendChild(el('span', `sev ${q.priority}`, q.priority));
      head.appendChild(document.createTextNode(q.text));
      row.appendChild(head);
      row.appendChild(el('div', 'why', q.why));

      const done = el('button', 'btn', 'Asked');
      done.style.marginTop = '6px';
      done.addEventListener('click', () => { state.session.questions.markAsked(q.id); render(); });
      row.appendChild(done);
      box.appendChild(row);
    });
  }

  function renderFlags(snap) {
    const box = $('flags');
    $('flag-count').textContent = snap.flags.length;
    clear(box);
    if (!state.show.flags) { box.appendChild(el('p', 'empty', 'Flags are off.')); return; }
    if (!snap.flags.length) { box.appendChild(el('p', 'empty', 'Nothing flagged.')); return; }

    snap.flags.slice(0, 8).forEach((f) => {
      const row = el('div', 'row');
      const head = el('div');
      head.appendChild(el('span', `sev ${f.severity}`, f.severity));
      head.appendChild(document.createTextNode(f.summary));
      row.appendChild(head);
      (f.quotes || []).forEach((q) => row.appendChild(el('div', 'quote', `${q.label}: "${q.text}"`)));
      if (f.suggestedFollowUp) row.appendChild(el('div', 'why', `Ask: ${f.suggestedFollowUp}`));
      row.appendChild(el('div', 'disclaimer', f.disclaimer));

      const dismiss = el('button', 'btn', 'Not an issue');
      dismiss.style.marginTop = '6px';
      dismiss.addEventListener('click', () => { state.session.verifier.dismiss(f.id, 'user dismissed'); render(); });
      row.appendChild(dismiss);
      box.appendChild(row);
    });
  }

  function renderRouting(snap) {
    const box = $('routing');
    $('route-count').textContent = snap.routing.pending.length;
    clear(box);
    if (!snap.routing.pending.length) { box.appendChild(el('p', 'empty', 'Nothing routed yet.')); return; }

    snap.routing.pending.slice(0, 8).forEach((n) => {
      const row = el('div', 'row');
      row.appendChild(el('strong', null, n.projectName || n.project));
      row.appendChild(el('div', null, n.text));
      row.appendChild(el('div', 'why', `${n.noteType} · ${n.why}${n.redacted ? ` · redacted: ${n.redactedKinds.join(', ')}` : ''}`));
      const drop = el('button', 'btn', 'Do not send');
      drop.style.marginTop = '6px';
      drop.addEventListener('click', () => { state.session.router.cancel(n.id); render(); });
      row.appendChild(drop);
      box.appendChild(row);
    });
  }

  // -------------------------------------------------------- point and click

  function select(turnId) {
    state.selected = turnId;
    const info = state.session.inspect(turnId);
    const card = $('inspector-card');
    const box = $('inspector');
    if (!info) { card.hidden = true; return; }
    card.hidden = false;
    clear(box);

    const head = el('div');
    head.appendChild(el('strong', null, info.speaker));
    head.appendChild(el('span', 'at', ` ${mmss(info.startMs)} · confidence ${Math.round(info.confidence * 100)}%`));
    box.appendChild(head);
    box.appendChild(el('div', 'quote', info.text));

    if (info.containsPII.length) {
      box.appendChild(el('div', 'why', `Contains ${info.containsPII.join(', ')} — redact before this leaves the room.`));
    }

    const chips = el('div', 'moves');
    info.sentences.forEach((s) => chips.appendChild(el('span', `chip ${s.epistemic}`, `${s.move} / ${s.epistemic}`)));
    box.appendChild(chips);

    const actions = el('div', 'actions');
    info.actions.forEach((a) => {
      const b = el('button', null, a.label);
      b.addEventListener('click', () => runAction(turnId, a.id, box));
      actions.appendChild(b);
    });
    box.appendChild(actions);
    render();
  }

  async function runAction(turnId, actionId, box) {
    if (actionId === 'reassign') {
      const to = window.prompt('Which speaker number does this line belong to?');
      if (to == null) return;
      await state.session.act(turnId, 'reassign', to.trim());
      render(); select(turnId); return;
    }
    const out = await state.session.act(turnId, actionId);
    const result = el('div', 'result');
    if (out.text) result.textContent = out.text;
    else if (out.notes) result.textContent = `Queued to ${out.notes.map((n) => n.projectName).join(', ') || 'no project matched'}`;
    else if (out.question) result.textContent = `Queued: ${out.question.text}`;
    else if (out.pinned) result.textContent = 'Pinned — this survives the two-hour wipe.';
    else if (out.flags) result.textContent = out.flags.length ? out.flags.map((f) => f.summary).join('\n') : 'Nothing to check on this line.';
    else result.textContent = out.ok ? 'Done.' : `Could not do that: ${out.reason}`;

    if (out.local) result.appendChild(el('div', 'disclaimer', 'Local guidance — no copilot key configured.'));
    box.appendChild(result);
    render();
  }

  // --------------------------------------------------------------- notebook

  let lastCardId = null;
  function showNotebook(card) {
    if (!card || card.id === lastCardId) return;
    lastCardId = card.id;

    const nb = $('notebook');
    nb.hidden = false;
    nb.classList.toggle('check', card.severity === 'check');
    $('nb-kind').textContent = card.kind === 'guardrail' ? 'Positioning check' : 'Notebook';
    $('nb-trigger').textContent = `"${card.trigger}"`;
    $('nb-headline').textContent = card.headline;
    $('nb-note').textContent = card.note;

    const say = $('nb-say');
    clear(say);
    card.suggested.forEach((line) => say.appendChild(el('li', null, line)));

    const avoid = $('nb-avoid');
    avoid.hidden = !card.avoid;
    if (card.avoid) avoid.textContent = `Avoid: ${card.avoid}`;

    clearTimeout(showNotebook.timer);
    showNotebook.timer = setTimeout(() => { nb.hidden = true; }, 22000);
  }

  function note(message) {
    showNotebook({ id: `sys:${Date.now()}`, kind: 'playbook', severity: 'info', headline: 'Sightline', trigger: '', note: message, suggested: [], avoid: null });
  }

  // ----------------------------------------------------------------- wiring

  function wire() {
    document.querySelectorAll('.ws-switch button').forEach((b) => {
      b.addEventListener('click', () => {
        if (state.session) {
          // Switching organisation mid-meeting would mix the two. It does not
          // happen silently; the session is wiped and started clean.
          if (!window.confirm('Switching organisation wipes this session so nothing crosses over. Continue?')) return;
          state.session.wipe();
          state.session = null;
        }
        state.workspace = b.dataset.ws;
        document.querySelectorAll('.ws-switch button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        document.documentElement.dataset.workspace = state.workspace;
        $('gate').hidden = false;
        renderGate();
      });
    });

    $('toggles').addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle');
      if (!btn) return;
      const flag = btn.dataset.flag;
      const on = btn.getAttribute('aria-pressed') !== 'true';

      if (flag === 'faces' && on) {
        window.alert(
          'Face recognition stays off until each person has given consent for it specifically.\n\n'
          + 'Face templates are biometric identifiers. Illinois BIPA requires a signed written release before capture and lets people sue; Texas and Washington have their own statutes; Nevada NRS 603A treats the data as personal information you are on the hook to protect.\n\n'
          + 'Enroll a face from that person\'s card after they have said yes on the record.'
        );
        return;
      }
      btn.setAttribute('aria-pressed', String(on));
      state.show[flag] = on;
      render();
    });

    $('btn-pause').addEventListener('click', () => {
      if (!state.session) return;
      if (state.session.recording) {
        state.session.recording = false;
        state.session.clock.pause();
        $('btn-pause').textContent = 'Resume';
      } else {
        state.session.recording = true;
        state.session.clock.resume();
        $('btn-pause').textContent = 'Pause';
      }
      render();
    });

    $('btn-wipe').addEventListener('click', () => {
      if (!state.session) return;
      if (!window.confirm('Wipe everything now, including pinned items? This cannot be undone.')) return;
      clearInterval(state.demoTimer);
      state.session.wipe();
      state.selected = null;
      $('inspector-card').hidden = true;
      render();
    });

    $('gate-add').addEventListener('click', () => { state.participants.push(''); renderParticipants(); });
    $('gate-start').addEventListener('click', () => startSession({ demo: false }));
    $('gate-demo').addEventListener('click', () => startSession({ demo: true }));
    $('nb-close').addEventListener('click', () => { $('notebook').hidden = true; });

    // The buffer expires on wall-clock time, so the countdown has to tick even
    // when nobody is speaking.
    setInterval(() => { if (state.session) { state.session.buffer.sweep(); render(); } }, 5000);
  }

  // ------------------------------------------------------------------ start

  window.Sightline.load(MODULES).then(async (require) => {
    state.require = require;
    try {
      const health = await (await fetch('/api/health')).json();
      window.__copilotProvider = health.providers.anthropic ? 'anthropic'
        : health.providers.deepseek ? 'deepseek' : 'local';
    } catch (e) { window.__copilotProvider = 'local'; }
    wire();
    renderGate();
  }).catch((err) => {
    document.body.innerHTML = `<pre style="padding:24px;color:#FF4D6D">Sightline failed to load: ${err.message}</pre>`;
  });
})();
