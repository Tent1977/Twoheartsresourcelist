const {
  validatePhone,
  validateCategory,
  validateHours,
  validateZip,
  validateResource,
  VALID_CATEGORIES,
} = require('../src/Validator');

describe('Validator', () => {
  // ── validatePhone() ───────────────────────────────────────────────────────

  describe('validatePhone()', () => {
    test('accepts undefined (optional field)', () => {
      expect(validatePhone(undefined)).toEqual({ valid: true, error: null });
    });

    test('accepts null (optional field)', () => {
      expect(validatePhone(null)).toEqual({ valid: true, error: null });
    });

    test('accepts a standard US number', () => {
      expect(validatePhone('555-867-5309')).toEqual({ valid: true, error: null });
    });

    test('accepts a number with country code', () => {
      expect(validatePhone('+1 (800) 555-0100')).toEqual({ valid: true, error: null });
    });

    test('rejects a non-string value', () => {
      const result = validatePhone(12345);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/string/i);
    });

    test('rejects an obviously invalid number', () => {
      const result = validatePhone('abc');
      expect(result.valid).toBe(false);
    });

    // MISSING: test for a very short number (e.g. "123" - too few digits)
    // MISSING: test for an empty string
  });

  // ── validateCategory() ────────────────────────────────────────────────────

  describe('validateCategory()', () => {
    test.each(VALID_CATEGORIES)('accepts valid category "%s"', (cat) => {
      expect(validateCategory(cat)).toEqual({ valid: true, error: null });
    });

    test('rejects an unknown category', () => {
      const result = validateCategory('entertainment');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/unknown category/i);
    });

    test('is case-insensitive', () => {
      expect(validateCategory('FOOD')).toEqual({ valid: true, error: null });
    });

    // MISSING: test with null / undefined / empty string
    // MISSING: test with non-string type (e.g. number)
  });

  // ── validateHours() ───────────────────────────────────────────────────────

  describe('validateHours()', () => {
    test('accepts undefined', () => {
      expect(validateHours(undefined)).toEqual({ valid: true, error: null });
    });

    test('accepts a valid hours string', () => {
      expect(validateHours('Mon-Fri 9am-5pm')).toEqual({ valid: true, error: null });
    });

    // MISSING: test with empty string (should fail)
    // MISSING: test with non-string type (should fail)
    // MISSING: test with null (should pass, it's optional)
  });

  // ── validateZip() ─────────────────────────────────────────────────────────

  // MISSING: validateZip() is entirely untested
  //   - should accept undefined/null
  //   - should accept "12345" and "12345-6789"
  //   - should reject "ABCDE" and "1234" (too short)

  // ── validateResource() ───────────────────────────────────────────────────

  describe('validateResource()', () => {
    test('passes for a complete valid resource', () => {
      const result = validateResource({
        name: 'City Shelter',
        category: 'shelter',
        phone: '555-000-1234',
        hours: 'Daily 24hrs',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('fails when name is missing', () => {
      const result = validateResource({ category: 'food' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Name is required');
    });

    test('collects multiple errors', () => {
      const result = validateResource({});
      expect(result.errors.length).toBeGreaterThan(1);
    });

    // MISSING: test that an invalid phone AND invalid category are both reported
    // MISSING: test with all fields absent
    // MISSING: test that hours validation errors surface in validateResource
  });
});
