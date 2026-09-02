'use strict';
const { EphemeralBuffer, TWO_HOURS_MS } = require('../../src/sightline/EphemeralBuffer');

const clocked = (opts = {}) => {
  const state = { t: 1000 };
  const buf = new EphemeralBuffer(Object.assign({ now: () => state.t }, opts));
  return { buf, state };
};

describe('EphemeralBuffer', () => {
  test('defaults to a two-hour lifetime', () => {
    expect(new EphemeralBuffer().ttlMs).toBe(TWO_HOURS_MS);
    expect(TWO_HOURS_MS).toBe(7200000);
  });

  test('rejects a non-positive ttl', () => {
    expect(() => new EphemeralBuffer({ ttlMs: 0 })).toThrow(/must be positive/);
  });

  test('append returns an item with an expiry two hours out', () => {
    const { buf } = clocked();
    const item = buf.append('hello');
    expect(item.expiresAt - item.createdAt).toBe(TWO_HOURS_MS);
    expect(item.kind).toBe('segment');
    expect(item.edited).toBe(false);
  });

  test('items disappear on their own once the window passes', () => {
    const { buf, state } = clocked();
    buf.append('transient');
    state.t += TWO_HOURS_MS;
    expect(buf.list()).toHaveLength(0);
    expect(buf.get('i1')).toBeNull();
  });

  test('sweep reports how many were dropped', () => {
    const { buf, state } = clocked();
    buf.append('a'); buf.append('b');
    state.t += TWO_HOURS_MS + 1;
    expect(buf.sweep()).toBe(2);
    expect(buf.sweep()).toBe(0);
  });

  test('pinned items survive the sweep', () => {
    const { buf, state } = clocked();
    buf.append('goes');
    const keep = buf.append('stays');
    buf.pin(keep.id);
    state.t += TWO_HOURS_MS + 1;
    buf.sweep();
    expect(buf.list().map((i) => i.payload)).toEqual(['stays']);
  });

  test('unpinning restarts the clock rather than expiring immediately', () => {
    const { buf, state } = clocked();
    const item = buf.append('x');
    buf.pin(item.id);
    state.t += TWO_HOURS_MS * 2;
    buf.unpin(item.id);
    expect(buf.get(item.id)).not.toBeNull();
    state.t += TWO_HOURS_MS + 1;
    expect(buf.get(item.id)).toBeNull();
  });

  test('editing extends the life of what is being worked on', () => {
    const { buf, state } = clocked();
    const item = buf.append('draft');
    state.t += TWO_HOURS_MS - 1000;
    buf.edit(item.id, 'revised');
    state.t += 2000;
    expect(buf.get(item.id).payload).toBe('revised');
    expect(buf.get(item.id).edited).toBe(true);
  });

  test('copy duplicates content without carrying the pin over', () => {
    const { buf } = clocked();
    const original = buf.append('quote', { pinned: true });
    const dupe = buf.copy(original.id);
    expect(dupe.payload).toBe('quote');
    expect(dupe.pinned).toBe(false);
    expect(dupe.id).not.toBe(original.id);
  });

  test('appendTo grows a string item', () => {
    const { buf } = clocked();
    const item = buf.append('line one');
    expect(buf.appendTo(item.id, 'line two').payload).toBe('line one\nline two');
  });

  test('appendTo grows the text field of an object item', () => {
    const { buf } = clocked();
    const item = buf.append({ text: 'first', speaker: 'Ben' });
    const out = buf.appendTo(item.id, 'second');
    expect(out.payload).toEqual({ text: 'first\nsecond', speaker: 'Ben' });
  });

  test('appendTo on an object with no text starts one', () => {
    const { buf } = clocked();
    const item = buf.append({ speaker: 'Ben' });
    expect(buf.appendTo(item.id, 'note').payload.text).toBe('note');
  });

  test('remove deletes outright', () => {
    const { buf } = clocked();
    const item = buf.append('bye');
    expect(buf.remove(item.id)).toBe(true);
    expect(buf.remove(item.id)).toBe(false);
  });

  test('operations on a missing id return null rather than throwing', () => {
    const { buf } = clocked();
    expect(buf.edit('nope', 'x')).toBeNull();
    expect(buf.pin('nope')).toBeNull();
    expect(buf.unpin('nope')).toBeNull();
    expect(buf.copy('nope')).toBeNull();
    expect(buf.appendTo('nope', 'x')).toBeNull();
  });

  test('list filters by kind and can include expired items', () => {
    const { buf, state } = clocked();
    buf.append('a', { kind: 'segment' });
    buf.append('b', { kind: 'note' });
    expect(buf.list({ kind: 'note' }).map((i) => i.payload)).toEqual(['b']);
    state.t += TWO_HOURS_MS + 1;
    expect(buf.list()).toHaveLength(0);
    expect(buf.list({ includeExpired: true })).toHaveLength(2);
  });

  test('list is ordered oldest first', () => {
    const { buf, state } = clocked();
    buf.append('first'); state.t += 10; buf.append('second');
    expect(buf.list().map((i) => i.payload)).toEqual(['first', 'second']);
  });

  test('wipe is unconditional and takes pinned items too', () => {
    const { buf } = clocked();
    buf.append('a'); buf.pin(buf.append('b').id);
    expect(buf.wipe()).toBe(2);
    expect(buf.list()).toHaveLength(0);
    expect(buf.wipedAt).toEqual(expect.any(Number));
  });

  test('the ceiling evicts the oldest unpinned item first', () => {
    const { buf } = clocked({ maxItems: 3 });
    const pinned = buf.append('keep'); buf.pin(pinned.id);
    buf.append('a'); buf.append('b'); buf.append('c');
    const payloads = buf.list().map((i) => i.payload);
    expect(payloads).toContain('keep');
    expect(payloads).toHaveLength(3);
    expect(payloads).not.toContain('a');
  });

  test('msUntilNextExpiry counts down and ignores pinned items', () => {
    const { buf, state } = clocked();
    buf.append('a');
    expect(buf.msUntilNextExpiry()).toBe(TWO_HOURS_MS);
    state.t += 1000;
    expect(buf.msUntilNextExpiry()).toBe(TWO_HOURS_MS - 1000);
    buf.wipe();
    expect(buf.msUntilNextExpiry()).toBeNull();
    buf.pin(buf.append('pinned').id);
    expect(buf.msUntilNextExpiry()).toBeNull();
  });

  test('stats summarise what is live', () => {
    const { buf } = clocked({ maxItems: 100 });
    buf.append('a', { kind: 'segment' });
    buf.pin(buf.append('b', { kind: 'note' }).id);
    buf.edit('i1', 'a2');
    const s = buf.stats();
    expect(s).toMatchObject({ total: 2, live: 2, pinned: 1, edited: 1 });
    expect(s.byKind).toEqual({ segment: 1, note: 1 });
    expect(s.capacityUsed).toBeCloseTo(0.02);
  });
});
