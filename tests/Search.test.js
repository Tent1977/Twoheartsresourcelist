const {
  searchByKeyword,
  filterByCategory,
  filterActive,
  sortBy,
  paginate,
  query,
} = require('../src/Search');

// Shared fixture factory
function makeResources() {
  return [
    { id: 1, name: 'City Food Bank',      category: 'food',      address: '100 Main St',  notes: 'Open weekends',  active: true  },
    { id: 2, name: 'Riverside Shelter',   category: 'shelter',   address: '22 River Rd',  notes: null,             active: true  },
    { id: 3, name: 'Downtown Clinic',     category: 'healthcare',address: '5 Oak Ave',    notes: 'Walk-ins ok',    active: true  },
    { id: 4, name: 'Eastside Food Pantry',category: 'food',      address: '88 East Blvd', notes: null,             active: false },
    { id: 5, name: 'Metro Legal Aid',     category: 'legal',     address: '1 Court Plaza',notes: 'By appointment', active: true  },
  ];
}

// ── searchByKeyword() ──────────────────────────────────────────────────────

describe('searchByKeyword()', () => {
  let resources;
  beforeEach(() => { resources = makeResources(); });

  test('empty keyword returns all resources unchanged', () => {
    expect(searchByKeyword(resources, '')).toHaveLength(5);
  });

  test('null keyword returns all resources unchanged', () => {
    expect(searchByKeyword(resources, null)).toHaveLength(5);
  });

  test('whitespace-only keyword returns all resources', () => {
    expect(searchByKeyword(resources, '   ')).toHaveLength(5);
  });

  test('matches on name field', () => {
    const results = searchByKeyword(resources, 'Clinic');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(3);
  });

  test('matches on address field', () => {
    const results = searchByKeyword(resources, 'River Rd');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(2);
  });

  test('matches on notes field', () => {
    const results = searchByKeyword(resources, 'Walk-ins');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(3);
  });

  test('is case-insensitive', () => {
    expect(searchByKeyword(resources, 'food')).toHaveLength(2);
    expect(searchByKeyword(resources, 'FOOD')).toHaveLength(2);
    expect(searchByKeyword(resources, 'Food')).toHaveLength(2);
  });

  test('keyword matching multiple resources returns all matches', () => {
    const results = searchByKeyword(resources, 'food');
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual([1, 4]);
  });

  test('keyword with no match returns empty array', () => {
    expect(searchByKeyword(resources, 'zzz-no-match')).toHaveLength(0);
  });

  test('trims leading/trailing whitespace from keyword', () => {
    expect(searchByKeyword(resources, '  Clinic  ')).toHaveLength(1);
  });

  test('does not match against category field', () => {
    // category is "legal" — keyword "legal" should only match if "legal" appears in name/address/notes
    const results = searchByKeyword(resources, 'legal');
    expect(results[0].name).toBe('Metro Legal Aid'); // matched via name, not category field
  });

  test('resources with null notes are not skipped', () => {
    const results = searchByKeyword(resources, 'Riverside');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(2);
  });

  test('returns a new array, does not mutate input', () => {
    const original = [...resources];
    searchByKeyword(resources, 'food');
    expect(resources).toHaveLength(original.length);
  });
});

// ── filterByCategory() ────────────────────────────────────────────────────

describe('filterByCategory()', () => {
  let resources;
  beforeEach(() => { resources = makeResources(); });

  test('filters by a single category string', () => {
    const results = filterByCategory(resources, 'food');
    expect(results).toHaveLength(2);
    results.forEach((r) => expect(r.category).toBe('food'));
  });

  test('filters by an array containing one category', () => {
    const results = filterByCategory(resources, ['shelter']);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(2);
  });

  test('filters by multiple categories', () => {
    const results = filterByCategory(resources, ['food', 'legal']);
    expect(results).toHaveLength(3);
    const cats = new Set(results.map((r) => r.category));
    expect(cats).toEqual(new Set(['food', 'legal']));
  });

  test('is case-insensitive', () => {
    expect(filterByCategory(resources, 'FOOD')).toHaveLength(2);
    expect(filterByCategory(resources, ['SHELTER'])).toHaveLength(1);
  });

  test('returns empty array when no resources match', () => {
    expect(filterByCategory(resources, 'education')).toHaveLength(0);
  });

  test('includes inactive resources (filtering does not apply active logic)', () => {
    const results = filterByCategory(resources, 'food');
    const ids = results.map((r) => r.id).sort();
    expect(ids).toContain(4); // inactive food pantry still included
  });

  test('returns a new array, does not mutate input', () => {
    filterByCategory(resources, 'food');
    expect(resources).toHaveLength(5);
  });
});

// ── filterActive() ────────────────────────────────────────────────────────

describe('filterActive()', () => {
  let resources;
  beforeEach(() => { resources = makeResources(); });

  test('excludes resources where active is false', () => {
    const results = filterActive(resources);
    expect(results.every((r) => r.active !== false)).toBe(true);
  });

  test('returns the correct count', () => {
    expect(filterActive(resources)).toHaveLength(4);
  });

  test('returns all when all are active', () => {
    const all = resources.map((r) => ({ ...r, active: true }));
    expect(filterActive(all)).toHaveLength(5);
  });

  test('returns empty array when all are inactive', () => {
    const all = resources.map((r) => ({ ...r, active: false }));
    expect(filterActive(all)).toHaveLength(0);
  });

  test('returns empty array for empty input', () => {
    expect(filterActive([])).toHaveLength(0);
  });

  test('returns a new array, does not mutate input', () => {
    filterActive(resources);
    expect(resources).toHaveLength(5);
  });
});

// ── sortBy() ──────────────────────────────────────────────────────────────

describe('sortBy()', () => {
  let resources;
  beforeEach(() => { resources = makeResources(); });

  test('sorts by name ascending by default', () => {
    const sorted = sortBy(resources, 'name');
    const names = sorted.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
  });

  test('sorts by name descending', () => {
    const asc  = sortBy(resources, 'name', 'asc').map((r) => r.name);
    const desc = sortBy(resources, 'name', 'desc').map((r) => r.name);
    expect(desc).toEqual([...asc].reverse());
  });

  test('sorts by category', () => {
    const sorted = sortBy(resources, 'category', 'asc');
    const cats = sorted.map((r) => r.category);
    expect(cats[0]).toBe('food');
    expect(cats[cats.length - 1]).toBe('shelter');
  });

  test('returns a new array, does not mutate input', () => {
    const original = resources.map((r) => r.id);
    sortBy(resources, 'name');
    expect(resources.map((r) => r.id)).toEqual(original);
  });

  test('handles resources with missing field gracefully', () => {
    const sparse = [{ id: 1, name: 'B' }, { id: 2 }, { id: 3, name: 'A' }];
    const sorted = sortBy(sparse, 'name', 'asc');
    // undefined name becomes '' — sorts first
    expect(sorted[0].id).toBe(2);
    expect(sorted[1].name).toBe('A');
    expect(sorted[2].name).toBe('B');
  });

  test('empty input returns empty array', () => {
    expect(sortBy([], 'name')).toHaveLength(0);
  });
});

// ── paginate() ────────────────────────────────────────────────────────────

describe('paginate()', () => {
  const items = Array.from({ length: 23 }, (_, i) => ({ id: i + 1 }));

  test('returns the correct slice for page 1', () => {
    const result = paginate(items, 1, 10);
    expect(result.items).toHaveLength(10);
    expect(result.items[0].id).toBe(1);
  });

  test('returns the correct slice for a middle page', () => {
    const result = paginate(items, 2, 10);
    expect(result.items[0].id).toBe(11);
    expect(result.items).toHaveLength(10);
  });

  test('returns a partial last page', () => {
    const result = paginate(items, 3, 10);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].id).toBe(21);
  });

  test('total equals input length', () => {
    expect(paginate(items, 1, 10).total).toBe(23);
  });

  test('totalPages is correct', () => {
    expect(paginate(items, 1, 10).totalPages).toBe(3);
  });

  test('page beyond totalPages returns last page', () => {
    const result = paginate(items, 99, 10);
    expect(result.page).toBe(3);
    expect(result.items[0].id).toBe(21);
  });

  test('pageSize larger than total returns all items on one page', () => {
    const result = paginate(items, 1, 100);
    expect(result.items).toHaveLength(23);
    expect(result.totalPages).toBe(1);
  });

  test('empty input returns empty items with totalPages 0', () => {
    const result = paginate([], 1, 10);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  test('page defaults to 1 when omitted', () => {
    const result = paginate(items, undefined, 10);
    expect(result.page).toBe(1);
  });
});

// ── query() ───────────────────────────────────────────────────────────────

describe('query()', () => {
  let resources;
  beforeEach(() => { resources = makeResources(); });

  test('activeOnly defaults to true, excludes inactive', () => {
    const results = query(resources);
    expect(results.every((r) => r.active !== false)).toBe(true);
    expect(results).toHaveLength(4);
  });

  test('activeOnly: false includes inactive resources', () => {
    const results = query(resources, { activeOnly: false });
    expect(results).toHaveLength(5);
  });

  test('keyword filters results', () => {
    const results = query(resources, { keyword: 'Clinic' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(3);
  });

  test('categories filters results', () => {
    const results = query(resources, { categories: ['food'] });
    // only active food resources (id 1); id 4 is inactive and excluded by activeOnly default
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(1);
  });

  test('keyword and categories work together', () => {
    const results = query(resources, { keyword: 'appointment', categories: ['legal'] });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(5);
  });

  test('keyword that matches nothing returns empty array', () => {
    expect(query(resources, { keyword: 'zzz' })).toHaveLength(0);
  });

  test('sortField sorts results', () => {
    const results = query(resources, { sortField: 'name', sortDir: 'asc' });
    const names = results.map((r) => r.name);
    expect(names[0]).toBe('City Food Bank');
  });

  test('pagination returns paginated object when page is specified', () => {
    const result = query(resources, { page: 1, pageSize: 2 });
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('total');
    expect(result.items).toHaveLength(2);
  });

  test('empty categories array does not filter anything out', () => {
    const results = query(resources, { categories: [] });
    expect(results).toHaveLength(4); // all active
  });
});
