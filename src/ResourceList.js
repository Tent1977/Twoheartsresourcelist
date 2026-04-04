/**
 * Core resource list manager for Two Hearts Community Aid.
 * Manages community resources such as food banks, shelters, and clinics.
 */
class ResourceList {
  constructor() {
    this.resources = [];
    this.nextId = 1;
  }

  /**
   * Add a new resource to the list.
   * @param {object} resource - { name, category, address, phone, hours, notes }
   * @returns {object} The created resource with assigned id
   * @throws {Error} If name or category is missing
   */
  add(resource) {
    if (!resource.name || resource.name.trim() === '') {
      throw new Error('Resource name is required');
    }
    if (!resource.category || resource.category.trim() === '') {
      throw new Error('Resource category is required');
    }

    const entry = {
      id: this.nextId++,
      name: resource.name.trim(),
      category: resource.category.trim(),
      address: resource.address || null,
      phone: resource.phone || null,
      hours: resource.hours || null,
      notes: resource.notes || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      active: true,
    };

    this.resources.push(entry);
    return entry;
  }

  /**
   * Remove a resource by id. Returns true if found and removed, false otherwise.
   */
  remove(id) {
    const index = this.resources.findIndex((r) => r.id === id);
    if (index === -1) return false;
    this.resources.splice(index, 1);
    return true;
  }

  /**
   * Get a single resource by id.
   */
  getById(id) {
    return this.resources.find((r) => r.id === id) || null;
  }

  /**
   * Update fields on an existing resource.
   * @returns {object|null} Updated resource, or null if not found
   */
  update(id, fields) {
    const resource = this.getById(id);
    if (!resource) return null;

    const protectedFields = ['id', 'createdAt'];
    for (const key of Object.keys(fields)) {
      if (!protectedFields.includes(key)) {
        resource[key] = fields[key];
      }
    }
    resource.updatedAt = new Date().toISOString();
    return resource;
  }

  /**
   * Soft-delete: mark a resource as inactive without removing it.
   */
  deactivate(id) {
    const resource = this.getById(id);
    if (!resource) return false;
    resource.active = false;
    resource.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Reactivate a previously deactivated resource.
   */
  reactivate(id) {
    const resource = this.getById(id);
    if (!resource) return false;
    resource.active = true;
    resource.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Return all active resources, optionally filtered by category.
   */
  getAll(category = null) {
    let results = this.resources.filter((r) => r.active);
    if (category) {
      results = results.filter(
        (r) => r.category.toLowerCase() === category.toLowerCase()
      );
    }
    return results;
  }

  /**
   * Return all resources including inactive ones.
   */
  getAllIncludingInactive() {
    return [...this.resources];
  }

  /**
   * Return total count of active resources.
   */
  count() {
    return this.resources.filter((r) => r.active).length;
  }

  /**
   * Clear all resources. Useful for testing and resets.
   */
  clear() {
    this.resources = [];
    this.nextId = 1;
  }
}

module.exports = ResourceList;
