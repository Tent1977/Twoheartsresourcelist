/**
 * Statistics and reporting utilities for the resource list.
 */

/**
 * Count resources grouped by category.
 * @returns {object} e.g. { food: 5, shelter: 3, ... }
 */
function countByCategory(resources) {
  return resources
    .filter((r) => r.active !== false)
    .reduce((acc, r) => {
      const cat = r.category || 'uncategorized';
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {});
}

/**
 * Return the category with the most active resources.
 * Returns null if the list is empty.
 */
function topCategory(resources) {
  const counts = countByCategory(resources);
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return entries.reduce((max, entry) => (entry[1] > max[1] ? entry : max))[0];
}

/**
 * Calculate how many resources were added in the last N days.
 */
function addedInLastDays(resources, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return resources.filter((r) => new Date(r.createdAt) >= cutoff).length;
}

/**
 * Return a summary object with key metrics.
 */
function summary(resources) {
  const active = resources.filter((r) => r.active !== false);
  const inactive = resources.filter((r) => r.active === false);
  return {
    total: resources.length,
    active: active.length,
    inactive: inactive.length,
    byCategory: countByCategory(resources),
    topCategory: topCategory(resources),
    addedLast7Days: addedInLastDays(resources, 7),
    addedLast30Days: addedInLastDays(resources, 30),
  };
}

/**
 * Find resources that are missing key contact info (phone or address).
 */
function findIncomplete(resources) {
  return resources.filter(
    (r) => r.active !== false && (!r.phone || !r.address)
  );
}

module.exports = { countByCategory, topCategory, addedInLastDays, summary, findIncomplete };
