/**
 * EphemeralBuffer.js — the two-hour memory.
 *
 * Holds a large working set of transcript segments, notes and clips, and wipes
 * itself two hours after the last write. Inside that window everything is
 * editable, deletable, copyable and appendable. Pinned items are the one
 * exception: pinning is an explicit human decision to keep something, so a pin
 * survives the sweep and must be exported or dropped deliberately.
 *
 * The TTL is a privacy feature, not a cache policy. `wipe()` is unconditional.
 */

'use strict';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

class EphemeralBuffer {
  /**
   * @param {object} [opts]
   * @param {number} [opts.ttlMs=7200000]  Lifetime of an unpinned item.
   * @param {number} [opts.maxItems=200000] Hard ceiling; oldest unpinned drop first.
   * @param {function} [opts.now=Date.now]  Injectable clock for tests.
   */
  constructor({ ttlMs = TWO_HOURS_MS, maxItems = 200000, now = Date.now } = {}) {
    if (ttlMs <= 0) throw new Error('ttlMs must be positive');
    this.ttlMs = ttlMs;
    this.maxItems = maxItems;
    this.now = now;
    this.items = new Map();
    this.seq = 0;
    this.wipedAt = null;
  }

  append(payload, { kind = 'segment', pinned = false } = {}) {
    const id = `i${++this.seq}`;
    const item = {
      id,
      kind,
      payload,
      pinned: Boolean(pinned),
      createdAt: this.now(),
      updatedAt: this.now(),
      expiresAt: this.now() + this.ttlMs,
      edited: false,
    };
    this.items.set(id, item);
    this._enforceCeiling();
    return item;
  }

  get(id) {
    const item = this.items.get(id);
    if (!item) return null;
    if (this._isExpired(item)) return null;
    return item;
  }

  /** Edit in place. Extends the item's life, because it is being worked on. */
  edit(id, payload) {
    const item = this.get(id);
    if (!item) return null;
    item.payload = payload;
    item.edited = true;
    item.updatedAt = this.now();
    item.expiresAt = this.now() + this.ttlMs;
    return item;
  }

  remove(id) {
    return this.items.delete(id);
  }

  pin(id) {
    const item = this.get(id);
    if (!item) return null;
    item.pinned = true;
    item.updatedAt = this.now();
    return item;
  }

  unpin(id) {
    const item = this.get(id);
    if (!item) return null;
    item.pinned = false;
    item.expiresAt = this.now() + this.ttlMs;
    return item;
  }

  /** Duplicate an item — the "copy" half of copy/paste. */
  copy(id) {
    const item = this.get(id);
    if (!item) return null;
    return this.append(item.payload, { kind: item.kind, pinned: false });
  }

  /** Append text onto an existing item without retyping it. */
  appendTo(id, text) {
    const item = this.get(id);
    if (!item) return null;
    const base = typeof item.payload === 'string'
      ? item.payload
      : (item.payload && item.payload.text) || '';
    const merged = `${base}${base ? '\n' : ''}${text}`;
    return this.edit(id, typeof item.payload === 'string'
      ? merged
      : Object.assign({}, item.payload, { text: merged }));
  }

  list({ kind = null, includeExpired = false } = {}) {
    const out = [];
    for (const item of this.items.values()) {
      if (!includeExpired && this._isExpired(item)) continue;
      if (kind && item.kind !== kind) continue;
      out.push(item);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  /** Drop everything past its TTL. Returns how many went. */
  sweep() {
    let dropped = 0;
    for (const [id, item] of this.items) {
      if (this._isExpired(item)) { this.items.delete(id); dropped += 1; }
    }
    return dropped;
  }

  /** Unconditional. Pins do not survive an explicit wipe. */
  wipe() {
    const n = this.items.size;
    this.items.clear();
    this.wipedAt = this.now();
    return n;
  }

  /** Milliseconds until the oldest unpinned item disappears. */
  msUntilNextExpiry() {
    let soonest = Infinity;
    for (const item of this.items.values()) {
      if (item.pinned) continue;
      soonest = Math.min(soonest, item.expiresAt);
    }
    return soonest === Infinity ? null : Math.max(0, soonest - this.now());
  }

  stats() {
    const all = Array.from(this.items.values());
    const live = all.filter((i) => !this._isExpired(i));
    return {
      total: all.length,
      live: live.length,
      pinned: live.filter((i) => i.pinned).length,
      edited: live.filter((i) => i.edited).length,
      byKind: live.reduce((acc, i) => { acc[i.kind] = (acc[i.kind] || 0) + 1; return acc; }, {}),
      msUntilNextExpiry: this.msUntilNextExpiry(),
      ttlMs: this.ttlMs,
      capacityUsed: all.length / this.maxItems,
    };
  }

  _isExpired(item) {
    if (item.pinned) return false;
    return this.now() >= item.expiresAt;
  }

  _enforceCeiling() {
    if (this.items.size <= this.maxItems) return;
    for (const [id, item] of this.items) {
      if (this.items.size <= this.maxItems) break;
      if (!item.pinned) this.items.delete(id);
    }
  }
}

module.exports = { EphemeralBuffer, TWO_HOURS_MS };
