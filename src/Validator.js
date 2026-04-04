/**
 * Validates resource fields before persistence.
 */

const VALID_CATEGORIES = [
  'food',
  'shelter',
  'clothing',
  'healthcare',
  'mental-health',
  'transportation',
  'employment',
  'education',
  'legal',
  'other',
];

const PHONE_REGEX = /^\+?[\d\s\-().]{7,20}$/;
const US_ZIP_REGEX = /^\d{5}(-\d{4})?$/;

/**
 * Validate a phone number string.
 * Returns { valid: bool, error: string|null }
 */
function validatePhone(phone) {
  if (!phone) return { valid: true, error: null }; // optional field
  if (typeof phone !== 'string') {
    return { valid: false, error: 'Phone must be a string' };
  }
  if (!PHONE_REGEX.test(phone.trim())) {
    return { valid: false, error: `Invalid phone number: "${phone}"` };
  }
  return { valid: true, error: null };
}

/**
 * Validate that a category is one of the accepted values.
 */
function validateCategory(category) {
  if (!category || typeof category !== 'string') {
    return { valid: false, error: 'Category is required' };
  }
  const normalized = category.trim().toLowerCase();
  if (!VALID_CATEGORIES.includes(normalized)) {
    return {
      valid: false,
      error: `Unknown category "${category}". Valid categories: ${VALID_CATEGORIES.join(', ')}`,
    };
  }
  return { valid: true, error: null };
}

/**
 * Validate an hours string (free-form but must be non-empty if provided).
 */
function validateHours(hours) {
  if (hours === undefined || hours === null) return { valid: true, error: null };
  if (typeof hours !== 'string') {
    return { valid: false, error: 'Hours must be a string' };
  }
  if (hours.trim() === '') {
    return { valid: false, error: 'Hours cannot be an empty string' };
  }
  return { valid: true, error: null };
}

/**
 * Validate a US ZIP code (optional field).
 */
function validateZip(zip) {
  if (!zip) return { valid: true, error: null };
  if (!US_ZIP_REGEX.test(zip.trim())) {
    return { valid: false, error: `Invalid ZIP code: "${zip}"` };
  }
  return { valid: true, error: null };
}

/**
 * Run all validations on a resource object.
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateResource(resource) {
  const errors = [];

  if (!resource.name || resource.name.trim() === '') {
    errors.push('Name is required');
  }

  const catResult = validateCategory(resource.category);
  if (!catResult.valid) errors.push(catResult.error);

  const phoneResult = validatePhone(resource.phone);
  if (!phoneResult.valid) errors.push(phoneResult.error);

  const hoursResult = validateHours(resource.hours);
  if (!hoursResult.valid) errors.push(hoursResult.error);

  return { valid: errors.length === 0, errors };
}

module.exports = {
  validatePhone,
  validateCategory,
  validateHours,
  validateZip,
  validateResource,
  VALID_CATEGORIES,
};
