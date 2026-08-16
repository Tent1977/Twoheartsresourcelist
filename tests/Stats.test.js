const {
  countByCategory,
  topCategory,
  addedInLastDays,
  summary,
  findIncomplete,
} = require('../src/Stats');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function makeResources() {
  return [
    { id: 1, name: 'City Food Bank',       category: 'food',      active: true,  phone: '555-1111', address: '1 Main St',  createdAt: daysAgo(0)  },
    { id: 2, name: 'Eastside Food Pantry',  category: 'food',      active: true,  phone: null,       address: '2 East Ave', createdAt: daysAgo(3)  },
    { id: 3, name: 'Riverside Shelter',     category: 'shelter',   active: true,  phone: '555-2222', address: null,         createdAt: daysAgo(10) },
    { id: 4, name: 'Downtown Clinic',       category: 'healthcare',active: true,  phone: null,       address: null,         createdAt: daysAgo(20) },
    { id: 5, name: 'Closed Shelter',        category: 'shelter',   active: false, phone: '555-3333', address: '5 West Rd',  createdAt: daysAgo(40) },
  ];
}

// ── countByCategory() ─────────────────────────────────────────────────────

describe('countByCategory()', () => {
  let resources;
  beforeEach(() => { resources = makeResources(); });

  test('returns correct counts for each category', () => {
    const counts = countByCategory(resources);
    expect(counts.food).toBe(2);
    expect(counts.shelter).toBe(1);   // inactive shelter excluded
    expect(counts.healthcare).toBe(1);
  });

  test('excludes inactive resources', () => {
    const counts = countByCategory(resources);
    // total across all categories = 4 (not 5)
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(4);
  });

  test('returns empty object for empty list', () => {
    expect(countByCategory([])).toEqual({});
  });

  test('returns empty object when all resources are inactive', () => {
    const all = resources.map((r) => ({ ...r, active: false }));
    expect(countByCategory(all)).toEqual({});
  });

  test('does not mutate input', () => {
    const copy = resources.map((r) => ({ ...r }));
    countByCategory(resources);
    expect(resources).toEqual(copy);
  });
});

// ── topCategory() ─────────────────────────────────────────────────────────

describe('topCategory()', () => {
  let resources;
  beforeEach(() => { resources = makeResources(); });

  test('returns the category with the most active resources', () => {
    expect(topCategory(resources)).toBe('food'); // 2 active food vs 1 shelter, 1 healthcare
  });

  test('returns null for an empty list', () => {
    expect(topCategory([])).toBeNull();
  });

  test('returns null when all resources are inactive', () => {
    const all = resources.map((r) => ({ ...r, active: false }));
    expect(topCategory(all)).toBeNull();
  });

  test('returns a string, not a number', () => {
    expect(typeof topCategory(resources)).toBe('string');
  });

  test('returns the single category when list has one active resource', () => {
    const single = [{ id: 1, category: 'education', active: true }];
    expect(topCategory(single)).toBe('education');
  });
});

// ── addedInLastDays() ─────────────────────────────────────────────────────

describe('addedInLastDays()', () => {
  let resources;
  beforeEach(() => { resources = makeResources(); });

  test('counts resources created today (0 days)', () => {
    expect(addedInLastDays(resources, 0)).toBeGreaterThanOrEqual(1);
  });

  test('counts resources created in the last 7 days', () => {
    // ids 1 (today) and 2 (3 days ago) are within 7 days
    expect(addedInLastDays(resources, 7)).toBe(2);
  });

  test('counts resources created in the last 30 days', () => {
    // ids 1 (0d), 2 (3d), 3 (10d), 4 (20d) — id 5 is 40 days ago
    expect(addedInLastDays(resources, 30)).toBe(4);
  });

  test('returns 0 when no resources are within the window', () => {
    expect(addedInLastDays(resources, 0)).toBeLessThanOrEqual(resources.length);
    // all resources are older than -1 days
    const future = [{ id: 99, createdAt: daysAgo(100) }];
    expect(addedInLastDays(future, 0)).toBe(0);
  });

  test('returns 0 for empty list', () => {
    expect(addedInLastDays([], 30)).toBe(0);
  });

  test('includes inactive resources (no active filter here)', () => {
    // id 5 is 40 days ago; ask for 50 days — should include all 5
    expect(addedInLastDays(resources, 50)).toBe(5);
  });
});

// ── summary() ─────────────────────────────────────────────────────────────

describe('summary()', () => {
  let resources;
  beforeEach(() => { resources = makeResources(); });

  test('returns an object with all expected keys', () => {
    const result = summary(resources);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('active');
    expect(result).toHaveProperty('inactive');
    expect(result).toHaveProperty('byCategory');
    expect(result).toHaveProperty('topCategory');
    expect(result).toHaveProperty('addedLast7Days');
    expect(result).toHaveProperty('addedLast30Days');
  });

  test('total equals active + inactive', () => {
    const { total, active, inactive } = summary(resources);
    expect(active + inactive).toBe(total);
  });

  test('total matches input length', () => {
    expect(summary(resources).total).toBe(5);
  });

  test('active count is correct', () => {
    expect(summary(resources).active).toBe(4);
  });

  test('inactive count is correct', () => {
    expect(summary(resources).inactive).toBe(1);
  });

  test('byCategory totals match active count', () => {
    const { byCategory, active } = summary(resources);
    const catTotal = Object.values(byCategory).reduce((a, b) => a + b, 0);
    expect(catTotal).toBe(active);
  });

  test('topCategory is a string matching a byCategory key', () => {
    const { topCategory: top, byCategory } = summary(resources);
    expect(byCategory).toHaveProperty(top);
  });

  test('addedLast7Days is a non-negative integer', () => {
    const { addedLast7Days } = summary(resources);
    expect(addedLast7Days).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(addedLast7Days)).toBe(true);
  });

  test('empty list returns zeros and null topCategory', () => {
    const result = summary([]);
    expect(result.total).toBe(0);
    expect(result.active).toBe(0);
    expect(result.inactive).toBe(0);
    expect(result.topCategory).toBeNull();
  });
});

// ── findIncomplete() ──────────────────────────────────────────────────────

describe('findIncomplete()', () => {
  let resources;
  beforeEach(() => { resources = makeResources(); });

  test('returns active resources missing phone', () => {
    const result = findIncomplete(resources);
    const ids = result.map((r) => r.id);
    expect(ids).toContain(2); // no phone
  });

  test('returns active resources missing address', () => {
    const result = findIncomplete(resources);
    const ids = result.map((r) => r.id);
    expect(ids).toContain(3); // no address
  });

  test('returns active resources missing both phone and address', () => {
    const result = findIncomplete(resources);
    const ids = result.map((r) => r.id);
    expect(ids).toContain(4); // missing both
  });

  test('does not include inactive resources', () => {
    const result = findIncomplete(resources);
    result.forEach((r) => expect(r.active).not.toBe(false));
  });

  test('does not include complete resources', () => {
    const result = findIncomplete(resources);
    const ids = result.map((r) => r.id);
    expect(ids).not.toContain(1); // id 1 has both phone and address
  });

  test('returns empty array when all active resources are complete', () => {
    const complete = [
      { id: 1, active: true, phone: '555-0000', address: '1 Main St' },
      { id: 2, active: true, phone: '555-0001', address: '2 Oak Ave' },
    ];
    expect(findIncomplete(complete)).toHaveLength(0);
  });

  test('returns empty array for empty input', () => {
    expect(findIncomplete([])).toHaveLength(0);
  });
});
