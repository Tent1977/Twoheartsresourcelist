/**
 * Router.js — send what was just said to the project it belongs to.
 *
 * Rules match on content, speaker, rhetorical move or flag type, and produce a
 * note addressed to a project. Dispatch itself is pluggable: the same note can
 * go to Asana, Notion, a Slack channel, a webhook or a local file, and the
 * router does not care which.
 *
 * Two hard rules:
 *   1. A project belongs to exactly one workspace. An ABLE utterance can never
 *      route into a VOA project or the reverse. This is enforced, not advised.
 *   2. Nothing leaves without passing the redactor first.
 */

'use strict';

class Router {
  /**
   * @param {object} opts
   * @param {import('./Workspace').Workspace} opts.workspace
   * @param {import('./Redaction').Redactor} [opts.redactor]
   */
  constructor({ workspace, redactor = null } = {}) {
    if (!workspace) throw new Error('Router requires a workspace');
    this.workspace = workspace;
    this.redactor = redactor;
    this.projects = new Map();
    this.rules = [];
    this.outbox = [];
    this.dispatchers = new Map();
    this.seq = 0;
  }

  /**
   * @param {string} id
   * @param {object} def {name, workspace, dispatcher, meta}
   */
  addProject(id, def = {}) {
    const ws = def.workspace || this.workspace.id;
    if (ws !== this.workspace.id) {
      throw new Error(`Project ${id} belongs to ${ws}; this router is scoped to ${this.workspace.id}`);
    }
    const project = Object.assign({ id, name: id, workspace: ws, dispatcher: 'outbox' }, def, { workspace: ws });
    this.projects.set(id, project);
    return project;
  }

  /**
   * @param {object} rule
   *   {id, project, when: {keywords?, re?, speaker?, move?, epistemic?, flagType?},
   *    noteType?, priority?}
   */
  addRule(rule) {
    if (!rule || !rule.project) throw new Error('rule.project is required');
    if (!this.projects.has(rule.project)) throw new Error(`Unknown project: ${rule.project}`);
    const r = Object.assign({ id: rule.id || `r${this.rules.length + 1}`, noteType: 'note', priority: 0 }, rule);
    this.rules.push(r);
    this.rules.sort((a, b) => b.priority - a.priority);
    return r;
  }

  /** Register a delivery function for a named dispatcher. */
  registerDispatcher(name, fn) {
    if (typeof fn !== 'function') throw new Error('dispatcher must be a function');
    this.dispatchers.set(name, fn);
    return this;
  }

  /**
   * Match one item against the rules and queue notes for every project that
   * wants it. An utterance can legitimately belong to more than one project.
   * @param {object} item {text, speaker, move, epistemic, flagType, turnId, atMs}
   */
  route(item) {
    const notes = [];
    for (const rule of this.rules) {
      if (!Router.matches(rule.when || {}, item)) continue;

      const redacted = this.redactor ? this.redactor.redact(item.text) : { text: item.text, found: [] };
      const note = {
        id: `n${++this.seq}`,
        project: rule.project,
        projectName: (this.projects.get(rule.project) || {}).name,
        workspace: this.workspace.id,
        noteType: rule.noteType,
        text: redacted.text,
        redacted: redacted.found.length > 0,
        redactedKinds: redacted.found.map((f) => f.kind),
        speaker: item.speaker || null,
        turnId: item.turnId || null,
        atMs: item.atMs == null ? null : item.atMs,
        matchedRule: rule.id,
        why: rule.why || `matched rule ${rule.id}`,
        status: 'queued',
        createdAt: Date.now(),
      };

      // Do not queue the same sentence into the same project twice.
      const dupe = this.outbox.find((n) => n.project === note.project && n.text === note.text);
      if (dupe) continue;

      this.outbox.push(note);
      notes.push(note);
    }
    return notes;
  }

  /** Deliver queued notes. Returns per-note results. */
  async flush({ dryRun = false } = {}) {
    const queued = this.outbox.filter((n) => n.status === 'queued');
    const results = [];
    for (const note of queued) {
      const project = this.projects.get(note.project);
      const dispatcherName = project.dispatcher || 'outbox';
      const fn = this.dispatchers.get(dispatcherName);

      if (dryRun || !fn) {
        note.status = dryRun ? 'dry-run' : 'held';
        results.push({ id: note.id, status: note.status, reason: fn ? null : `no dispatcher "${dispatcherName}" registered` });
        continue;
      }
      try {
        const res = await fn(note, project);
        note.status = 'sent';
        note.remoteRef = res && res.ref ? res.ref : null;
        results.push({ id: note.id, status: 'sent', ref: note.remoteRef });
      } catch (err) {
        note.status = 'failed';
        note.error = err.message;
        results.push({ id: note.id, status: 'failed', error: err.message });
      }
    }
    return results;
  }

  pending() { return this.outbox.filter((n) => n.status === 'queued'); }

  /** Drop a queued note before it goes anywhere. */
  cancel(noteId) {
    const i = this.outbox.findIndex((n) => n.id === noteId && n.status === 'queued');
    if (i === -1) return false;
    this.outbox.splice(i, 1);
    return true;
  }

  static matches(when, item) {
    const text = String(item.text || '');
    if (when.speaker && item.speaker !== when.speaker) return false;
    if (when.move && item.move !== when.move) return false;
    if (when.epistemic && item.epistemic !== when.epistemic) return false;
    if (when.flagType && item.flagType !== when.flagType) return false;
    if (when.re && !when.re.test(text)) return false;
    if (when.keywords && when.keywords.length) {
      const lower = text.toLowerCase();
      const mode = when.keywordMode === 'all' ? 'all' : 'any';
      const hits = when.keywords.filter((k) => lower.includes(String(k).toLowerCase()));
      if (mode === 'all' ? hits.length !== when.keywords.length : hits.length === 0) return false;
    }
    // A rule with no conditions matches nothing — that is almost never intended.
    return Object.keys(when).length > 0;
  }
}

module.exports = { Router };
