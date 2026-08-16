/**
 * Integration tests — exercise the full add → validate → save → load → query pipeline.
 * Each test uses a dedicated temp file and a fresh ResourceList instance.
 */
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ResourceList        = require('../src/ResourceList');
const { validateResource} = require('../src/Validator');
const { load, save }      = require('../src/Storage');
const { query }           = require('../src/Search');
const { summary }         = require('../src/Stats');

function tmpFile() {
  return path.join(os.tmpdir(), `integration-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
}

function cleanFile(p) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// ── Round-trip: save then reload ──────────────────────────────────────────

describe('save → load round-trip', () => {
  test('all active resources survive a full save/load cycle', () => {
    const p    = tmpFile();
    const list = new ResourceList();
    try {
      list.add({ name: 'City Food Bank',   category: 'food',    phone: '555-1000', address: '1 Main St' });
      list.add({ name: 'Riverside Shelter',category: 'shelter', phone: '555-2000', address: '22 River Rd' });
      list.add({ name: 'Downtown Clinic',  category: 'healthcare' });

      save(list.getAllIncludingInactive(), p);

      const list2 = new ResourceList();
      list2.resources = load(p);

      expect(list2.count()).toBe(3);
      expect(list2.getAll().map((r) => r.name)).toEqual(
        expect.arrayContaining(['City Food Bank', 'Riverside Shelter', 'Downtown Clinic'])
      );
    } finally {
      cleanFile(p);
    }
  });

  test('inactive resources remain inactive after reload', () => {
    const p    = tmpFile();
    const list = new ResourceList();
    try {
      list.add({ name: 'Food Bank', category: 'food' });
      const r = list.add({ name: 'Old Shelter', category: 'shelter' });
      list.deactivate(r.id);

      save(list.getAllIncludingInactive(), p);

      const list2 = new ResourceList();
      list2.resources = load(p);

      const active = list2.getAll();
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('Food Bank');
    } finally {
      cleanFile(p);
    }
  });

  test('all resource fields are preserved through the round-trip', () => {
    const p    = tmpFile();
    const list = new ResourceList();
    try {
      list.add({
        name: 'Full Record',
        category: 'legal',
        phone: '555-9999',
        address: '100 Court St',
        hours: 'Mon-Fri 9am-5pm',
        notes: 'Walk-ins welcome',
      });

      save(list.getAllIncludingInactive(), p);

      const list2 = new ResourceList();
      list2.resources = load(p);
      const [loaded] = list2.getAll();

      expect(loaded.name).toBe('Full Record');
      expect(loaded.category).toBe('legal');
      expect(loaded.phone).toBe('555-9999');
      expect(loaded.address).toBe('100 Court St');
      expect(loaded.hours).toBe('Mon-Fri 9am-5pm');
      expect(loaded.notes).toBe('Walk-ins welcome');
      expect(loaded.active).toBe(true);
    } finally {
      cleanFile(p);
    }
  });
});

// ── Validation gate ───────────────────────────────────────────────────────

describe('validateResource() → ResourceList.add() gate', () => {
  test('valid resource passes validation and can be added', () => {
    const list     = new ResourceList();
    const resource = { name: 'Clinic', category: 'healthcare', phone: '555-1234' };
    const { valid } = validateResource(resource);
    expect(valid).toBe(true);
    const added = list.add(resource);
    expect(added.id).toBeDefined();
  });

  test('invalid resource fails validation before add is attempted', () => {
    const list     = new ResourceList();
    const resource = { name: 'Bad Resource', category: 'not-a-real-category' };
    const { valid, errors } = validateResource(resource);
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
    // Nothing should be added
    expect(list.count()).toBe(0);
  });

  test('resource missing name fails validation and is not added', () => {
    const list = new ResourceList();
    const { valid } = validateResource({ category: 'food' });
    expect(valid).toBe(false);
    expect(list.count()).toBe(0);
  });

  test('nothing is persisted when validation fails', () => {
    const p    = tmpFile();
    const list = new ResourceList();
    try {
      const resource = { name: '', category: 'invalid' };
      const { valid } = validateResource(resource);
      if (!valid) {
        // Do NOT call list.add() or save()
      }
      save(list.getAllIncludingInactive(), p);
      expect(load(p)).toHaveLength(0);
    } finally {
      cleanFile(p);
    }
  });
});

// ── Query after reload ────────────────────────────────────────────────────

describe('query() after reload', () => {
  test('keyword search works correctly on reloaded resources', () => {
    const p    = tmpFile();
    const list = new ResourceList();
    try {
      list.add({ name: 'Sunrise Food Bank',  category: 'food',    notes: 'Open weekends' });
      list.add({ name: 'Northside Shelter',  category: 'shelter'  });
      list.add({ name: 'Westside Clinic',    category: 'healthcare' });

      save(list.getAllIncludingInactive(), p);
      const reloaded = load(p);

      const results = query(reloaded, { keyword: 'food' });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Sunrise Food Bank');
    } finally {
      cleanFile(p);
    }
  });

  test('category filter works correctly on reloaded resources', () => {
    const p    = tmpFile();
    const list = new ResourceList();
    try {
      list.add({ name: 'Food Bank A',  category: 'food'    });
      list.add({ name: 'Food Bank B',  category: 'food'    });
      list.add({ name: 'Shelter X',    category: 'shelter' });

      save(list.getAllIncludingInactive(), p);
      const reloaded = load(p);

      const foodOnly = query(reloaded, { categories: ['food'] });
      expect(foodOnly).toHaveLength(2);
      foodOnly.forEach((r) => expect(r.category).toBe('food'));
    } finally {
      cleanFile(p);
    }
  });

  test('deactivated resources are excluded from query after reload', () => {
    const p    = tmpFile();
    const list = new ResourceList();
    try {
      list.add({ name: 'Active Resource',   category: 'food' });
      const inactive = list.add({ name: 'Closed Resource', category: 'food' });
      list.deactivate(inactive.id);

      save(list.getAllIncludingInactive(), p);
      const reloaded = load(p);

      const results = query(reloaded, { activeOnly: true });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Active Resource');
    } finally {
      cleanFile(p);
    }
  });
});

// ── Stats after reload ────────────────────────────────────────────────────

describe('summary() after reload', () => {
  test('summary counts are correct after a round-trip', () => {
    const p    = tmpFile();
    const list = new ResourceList();
    try {
      list.add({ name: 'Food A',   category: 'food'    });
      list.add({ name: 'Food B',   category: 'food'    });
      list.add({ name: 'Shelter',  category: 'shelter' });
      const gone = list.add({ name: 'Old Place', category: 'legal' });
      list.deactivate(gone.id);

      save(list.getAllIncludingInactive(), p);
      const reloaded = load(p);

      const s = summary(reloaded);
      expect(s.total).toBe(4);
      expect(s.active).toBe(3);
      expect(s.inactive).toBe(1);
      expect(s.byCategory.food).toBe(2);
      expect(s.topCategory).toBe('food');
    } finally {
      cleanFile(p);
    }
  });
});

// ── Multiple save cycles ──────────────────────────────────────────────────

describe('multiple save cycles', () => {
  test('adding more resources and saving again produces the correct final state', () => {
    const p    = tmpFile();
    const list = new ResourceList();
    try {
      list.add({ name: 'Resource 1', category: 'food' });
      save(list.getAllIncludingInactive(), p);

      list.add({ name: 'Resource 2', category: 'shelter' });
      save(list.getAllIncludingInactive(), p);

      const loaded = load(p);
      expect(loaded).toHaveLength(2);
    } finally {
      cleanFile(p);
    }
  });

  test('update() changes are reflected after re-save', () => {
    const p    = tmpFile();
    const list = new ResourceList();
    try {
      const r = list.add({ name: 'Old Name', category: 'food' });
      save(list.getAllIncludingInactive(), p);

      list.update(r.id, { name: 'New Name' });
      save(list.getAllIncludingInactive(), p);

      const [loaded] = load(p);
      expect(loaded.name).toBe('New Name');
    } finally {
      cleanFile(p);
    }
  });
});
