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

    // MISSING: test for trimming whitespace from name/category
    // MISSING: test for optional fields (address, phone, hours, notes) being null by default
    // MISSING: test for empty-string name (whitespace-only)
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

    // MISSING: test that other resources are unaffected after removal
    // MISSING: test that count() decreases after removal
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

    // MISSING: test that id and createdAt cannot be overwritten
    // MISSING: test that updatedAt is refreshed
    // MISSING: test update on non-existent id returns null
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

    // MISSING: test getAll() with category filter
    // MISSING: test getAll() returns empty array when list is empty
  });

  // ── deactivate() / reactivate() ───────────────────────────────────────────

  describe('deactivate()', () => {
    test('marks resource inactive', () => {
      const r = list.add({ name: 'A', category: 'food' });
      expect(list.deactivate(r.id)).toBe(true);
      expect(list.getById(r.id).active).toBe(false);
    });

    // MISSING: deactivate() returns false for unknown id
    // MISSING: reactivate() tests are entirely absent
  });

  // ── count() ───────────────────────────────────────────────────────────────

  // MISSING: count() tests are entirely absent
});
