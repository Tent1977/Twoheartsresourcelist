/**
 * Search and filter utilities for the resource list.
 */

/**
 * Full-text search across name, address, and notes fields.
 * Case-insensitive. Returns matching resources.
 */
function searchByKeyword(resources, keyword) {
  if (!keyword || keyword.trim() === '') return [...resources];
  const q = keyword.trim().toLowerCase();
  return resources.filter((r) => {
    return (
      r.name.toLowerCase().includes(q) ||
      (r.address && r.address.toLowerCase().includes(q)) ||
      (r.notes && r.notes.toLowerCase().includes(q))
    );
  });
}

/**
 * Filter resources by one or more categories.
 * @param {object[]} resources
 * @param {string|string[]} categories - single category or array of categories
 */
function filterByCategory(resources, categories) {
  const cats = Array.isArray(categories)
    ? categories.map((c) => c.toLowerCase())
    : [categories.toLowerCase()];
  return resources.filter((r) => cats.includes(r.category.toLowerCase()));
}

/**
 * Filter to only active resources.
 */
function filterActive(resources) {
  return resources.filter((r) => r.active !== false);
}

/**
 * Sort resources by a given field, ascending or descending.
 * @param {object[]} resources
 * @param {string} field - field name to sort by (default 'name')
 * @param {'asc'|'desc'} direction
 */
function sortBy(resources, field = 'name', direction = 'asc') {
  const sorted = [...resources].sort((a, b) => {
    const av = (a[field] || '').toString().toLowerCase();
    const bv = (b[field] || '').toString().toLowerCase();
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return direction === 'desc' ? sorted.reverse() : sorted;
}

/**
 * Paginate a list of resources.
 * @param {object[]} resources
 * @param {number} page - 1-indexed page number
 * @param {number} pageSize
 * @returns {{ items: object[], total: number, page: number, totalPages: number }}
 */
function paginate(resources, page = 1, pageSize = 10) {
  const total = resources.length;
  const totalPages = Math.ceil(total / pageSize);
  const safePage = Math.max(1, Math.min(page, totalPages || 1));
  const start = (safePage - 1) * pageSize;
  const items = resources.slice(start, start + pageSize);
  return { items, total, page: safePage, totalPages };
}

/**
 * Combined search + filter + sort + paginate pipeline.
 */
function query(resources, { keyword, categories, activeOnly = true, sortField, sortDir, page, pageSize } = {}) {
  let results = activeOnly ? filterActive(resources) : [...resources];
  if (keyword) results = searchByKeyword(results, keyword);
  if (categories && categories.length) results = filterByCategory(results, categories);
  if (sortField) results = sortBy(results, sortField, sortDir);
  if (page !== undefined) return paginate(results, page, pageSize);
  return results;
}

module.exports = { searchByKeyword, filterByCategory, filterActive, sortBy, paginate, query };
