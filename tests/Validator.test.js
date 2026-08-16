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

    test('rejects a too-short number', () => {
      expect(validatePhone('123').valid).toBe(false);
    });

    test('accepts an empty string (treated as not provided)', () => {
      // The source guards with !phone — empty string is falsy, so treated as absent
      expect(validatePhone('').valid).toBe(true);
    });
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

    test('rejects null', () => {
      expect(validateCategory(null).valid).toBe(false);
    });

    test('rejects undefined', () => {
      expect(validateCategory(undefined).valid).toBe(false);
    });

    test('rejects empty string', () => {
      expect(validateCategory('').valid).toBe(false);
    });

    test('rejects a non-string type', () => {
      expect(validateCategory(42).valid).toBe(false);
    });
  });

  // ── validateHours() ───────────────────────────────────────────────────────

  describe('validateHours()', () => {
    test('accepts undefined', () => {
      expect(validateHours(undefined)).toEqual({ valid: true, error: null });
    });

    test('accepts a valid hours string', () => {
      expect(validateHours('Mon-Fri 9am-5pm')).toEqual({ valid: true, error: null });
    });

    test('rejects an empty string', () => {
      expect(validateHours('').valid).toBe(false);
    });

    test('rejects a non-string type', () => {
      expect(validateHours(123).valid).toBe(false);
    });

    test('accepts null (optional field)', () => {
      expect(validateHours(null)).toEqual({ valid: true, error: null });
    });
  });

  // ── validateZip() ─────────────────────────────────────────────────────────

  describe('validateZip()', () => {
    test('accepts undefined (optional field)', () => {
      expect(validateZip(undefined)).toEqual({ valid: true, error: null });
    });

    test('accepts null (optional field)', () => {
      expect(validateZip(null)).toEqual({ valid: true, error: null });
    });

    test('accepts a 5-digit ZIP', () => {
      expect(validateZip('12345')).toEqual({ valid: true, error: null });
    });

    test('accepts a ZIP+4 format', () => {
      expect(validateZip('12345-6789')).toEqual({ valid: true, error: null });
    });

    test('rejects letters', () => {
      expect(validateZip('ABCDE').valid).toBe(false);
    });

    test('rejects a too-short number', () => {
      expect(validateZip('1234').valid).toBe(false);
    });

    test('rejects a too-long number', () => {
      expect(validateZip('123456').valid).toBe(false);
    });
  });

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

    test('reports both an invalid phone and an invalid category', () => {
      const result = validateResource({ name: 'X', category: 'not-valid', phone: 'abc' });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /category/i.test(e))).toBe(true);
      expect(result.errors.some((e) => /phone/i.test(e))).toBe(true);
    });

    test('fails with multiple errors when all fields are absent', () => {
      const result = validateResource({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    test('surfaces hours validation errors', () => {
      const result = validateResource({ name: 'X', category: 'food', hours: '' });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /hours/i.test(e))).toBe(true);
    });
  });
});
