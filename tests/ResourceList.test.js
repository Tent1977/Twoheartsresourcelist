const ResourceList = require('../src/ResourceList');

describe('ResourceList', () => {
  let list;

  beforeEach(() => {
    list = new ResourceList();
  });

  // ── add() ─────────────────────────────────────────────────────────────────

  describe('add()', () => {
    test('adds a resource and returns it with an id', () => {
      const resource = list.add({ name: 'City Food Bank', category: 'food' });
      expect(resource.id).toBe(1);
      expect(resource.name).toBe('City Food Bank');
      expect(resource.category).toBe('food');
      expect(resource.active).toBe(true);
    });

    test('throws when name is missing', () => {
      expect(() => list.add({ category: 'food' })).toThrow('Resource name is required');
    });

    test('throws when category is missing', () => {
      expect(() => list.add({ name: 'Shelter A' })).toThrow('Resource category is required');
    });

    test('assigns incrementing ids', () => {
      const a = list.add({ name: 'A', category: 'food' });
      const b = list.add({ name: 'B', category: 'shelter' });
      expect(b.id).toBe(a.id + 1);
    });

    test('trims leading/trailing whitespace from name', () => {
      const r = list.add({ name: '  Food Bank  ', category: 'food' });
      expect(r.name).toBe('Food Bank');
    });

    test('trims leading/trailing whitespace from category', () => {
      const r = list.add({ name: 'Food Bank', category: '  food  ' });
      expect(r.category).toBe('food');
    });

    test('optional fields default to null', () => {
      const r = list.add({ name: 'Minimal', category: 'food' });
      expect(r.address).toBeNull();
      expect(r.phone).toBeNull();
      expect(r.hours).toBeNull();
      expect(r.notes).toBeNull();
    });

    test('throws when name is whitespace-only', () => {
      expect(() => list.add({ name: '   ', category: 'food' })).toThrow('Resource name is required');
    });

    test('stores provided optional fields', () => {
      const r = list.add({ name: 'Full', category: 'food', address: '1 Main St', phone: '555-0000', hours: '9-5', notes: 'Walk-ins' });
      expect(r.address).toBe('1 Main St');
      expect(r.phone).toBe('555-0000');
      expect(r.hours).toBe('9-5');
      expect(r.notes).toBe('Walk-ins');
    });

    test('sets active to true and timestamps on creation', () => {
      const r = list.add({ name: 'A', category: 'food' });
      expect(r.active).toBe(true);
      expect(r.createdAt).toBeDefined();
      expect(r.updatedAt).toBeDefined();
    });
  });

  // ── remove() ──────────────────────────────────────────────────────────────

  describe('remove()', () => {
    test('removes an existing resource and returns true', () => {
      const r = list.add({ name: 'Shelter A', category: 'shelter' });
      expect(list.remove(r.id)).toBe(true);
      expect(list.getById(r.id)).toBeNull();
    });

    test('returns false for a non-existent id', () => {
      expect(list.remove(999)).toBe(false);
    });

    test('other resources are unaffected after removal', () => {
      const a = list.add({ name: 'A', category: 'food' });
      const b = list.add({ name: 'B', category: 'shelter' });
      list.remove(a.id);
      expect(list.getById(b.id)).not.toBeNull();
    });

    test('count decreases after removal', () => {
      const r = list.add({ name: 'A', category: 'food' });
      expect(list.count()).toBe(1);
      list.remove(r.id);
      expect(list.count()).toBe(0);
    });
  });

  // ── getById() ─────────────────────────────────────────────────────────────

  describe('getById()', () => {
    test('returns the correct resource', () => {
      const r = list.add({ name: 'Clinic B', category: 'healthcare' });
      expect(list.getById(r.id)).toEqual(r);
    });

    test('returns null for unknown id', () => {
      expect(list.getById(42)).toBeNull();
    });
  });

  // ── update() ──────────────────────────────────────────────────────────────

  describe('update()', () => {
    test('updates allowed fields', () => {
      const r = list.add({ name: 'Old Name', category: 'food' });
      const updated = list.update(r.id, { name: 'New Name', phone: '555-1234' });
      expect(updated.name).toBe('New Name');
      expect(updated.phone).toBe('555-1234');
    });

    test('id cannot be overwritten', () => {
      const r = list.add({ name: 'A', category: 'food' });
      const originalId = r.id;
      list.update(r.id, { id: 999 });
      expect(list.getById(originalId).id).toBe(originalId);
    });

    test('createdAt cannot be overwritten', () => {
      const r = list.add({ name: 'A', category: 'food' });
      const original = r.createdAt;
      list.update(r.id, { createdAt: '1970-01-01T00:00:00.000Z' });
      expect(list.getById(r.id).createdAt).toBe(original);
    });

    test('updatedAt is refreshed on update', () => {
      jest.useFakeTimers();
      const r = list.add({ name: 'A', category: 'food' });
      const before = r.updatedAt;
      jest.advanceTimersByTime(1000);
      list.update(r.id, { name: 'B' });
      expect(list.getById(r.id).updatedAt).not.toBe(before);
      jest.useRealTimers();
    });

    test('returns null for non-existent id', () => {
      expect(list.update(999, { name: 'X' })).toBeNull();
    });
  });

  // ── getAll() ──────────────────────────────────────────────────────────────

  describe('getAll()', () => {
    test('returns only active resources', () => {
      const a = list.add({ name: 'A', category: 'food' });
      const b = list.add({ name: 'B', category: 'shelter' });
      list.deactivate(b.id);
      expect(list.getAll()).toHaveLength(1);
      expect(list.getAll()[0].id).toBe(a.id);
    });

    test('filters by category (case-insensitive)', () => {
      list.add({ name: 'Food Bank', category: 'food' });
      list.add({ name: 'Shelter',   category: 'shelter' });
      expect(list.getAll('food')).toHaveLength(1);
      expect(list.getAll('FOOD')).toHaveLength(1);
      expect(list.getAll('food')[0].name).toBe('Food Bank');
    });

    test('returns empty array when list is empty', () => {
      expect(list.getAll()).toEqual([]);
    });

    test('returns empty array when category filter matches nothing', () => {
      list.add({ name: 'Food Bank', category: 'food' });
      expect(list.getAll('shelter')).toEqual([]);
    });
  });

  // ── deactivate() / reactivate() ───────────────────────────────────────────

  describe('deactivate()', () => {
    test('marks resource inactive', () => {
      const r = list.add({ name: 'A', category: 'food' });
      expect(list.deactivate(r.id)).toBe(true);
      expect(list.getById(r.id).active).toBe(false);
    });

    test('returns false for unknown id', () => {
      expect(list.deactivate(999)).toBe(false);
    });
  });

  describe('reactivate()', () => {
    test('sets active back to true', () => {
      const r = list.add({ name: 'A', category: 'food' });
      list.deactivate(r.id);
      expect(list.reactivate(r.id)).toBe(true);
      expect(list.getById(r.id).active).toBe(true);
    });

    test('resource reappears in getAll() after reactivation', () => {
      const r = list.add({ name: 'A', category: 'food' });
      list.deactivate(r.id);
      expect(list.getAll()).toHaveLength(0);
      list.reactivate(r.id);
      expect(list.getAll()).toHaveLength(1);
    });

    test('refreshes updatedAt on reactivation', () => {
      jest.useFakeTimers();
      const r = list.add({ name: 'A', category: 'food' });
      list.deactivate(r.id);
      const before = list.getById(r.id).updatedAt;
      jest.advanceTimersByTime(1000);
      list.reactivate(r.id);
      expect(list.getById(r.id).updatedAt).not.toBe(before);
      jest.useRealTimers();
    });

    test('returns false for unknown id', () => {
      expect(list.reactivate(999)).toBe(false);
    });
  });

  // ── count() ───────────────────────────────────────────────────────────────

  describe('count()', () => {
    test('returns 0 on an empty list', () => {
      expect(list.count()).toBe(0);
    });

    test('increases after each add()', () => {
      list.add({ name: 'A', category: 'food' });
      expect(list.count()).toBe(1);
      list.add({ name: 'B', category: 'shelter' });
      expect(list.count()).toBe(2);
    });

    test('decreases after remove()', () => {
      const r = list.add({ name: 'A', category: 'food' });
      list.remove(r.id);
      expect(list.count()).toBe(0);
    });

    test('excludes inactive resources', () => {
      const r = list.add({ name: 'A', category: 'food' });
      list.add({ name: 'B', category: 'shelter' });
      list.deactivate(r.id);
      expect(list.count()).toBe(1);
    });
  });

  describe('getAllIncludingInactive()', () => {
    test('returns both active and inactive resources', () => {
      const r = list.add({ name: 'A', category: 'food' });
      list.add({ name: 'B', category: 'shelter' });
      list.deactivate(r.id);
      expect(list.getAllIncludingInactive()).toHaveLength(2);
    });

    test('returns empty array when list is empty', () => {
      expect(list.getAllIncludingInactive()).toEqual([]);
    });
  });

  describe('clear()', () => {
    test('removes all resources', () => {
      list.add({ name: 'A', category: 'food' });
      list.add({ name: 'B', category: 'shelter' });
      list.clear();
      expect(list.count()).toBe(0);
      expect(list.getAll()).toEqual([]);
    });

    test('resets the id counter so the next add starts at 1', () => {
      list.add({ name: 'A', category: 'food' });
      list.clear();
      const r = list.add({ name: 'B', category: 'shelter' });
      expect(r.id).toBe(1);
    });

    test('works on an already-empty list without error', () => {
      expect(() => list.clear()).not.toThrow();
    });
  });
});
