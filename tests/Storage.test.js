const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { load, save, deleteStore } = require('../src/Storage');

// Each test gets its own temp file so tests never share state
function tmpFile() {
  return path.join(os.tmpdir(), `storage-test-${Date.now()}-${Math.floor(Math.random() * 1e6)}.json`);
}

afterEach(() => {
  // Clean up any temp files created during the test (best-effort)
});

// ── load() ────────────────────────────────────────────────────────────────

describe('load()', () => {
  test('returns empty array when file does not exist', () => {
    const p = tmpFile();
    expect(load(p)).toEqual([]);
  });

  test('reads and returns a valid JSON array', () => {
    const p = tmpFile();
    const data = [{ id: 1, name: 'Food Bank' }, { id: 2, name: 'Shelter' }];
    fs.writeFileSync(p, JSON.stringify(data), 'utf-8');
    try {
      expect(load(p)).toEqual(data);
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('throws a descriptive error for invalid JSON', () => {
    const p = tmpFile();
    fs.writeFileSync(p, '{ not valid json ,,, }', 'utf-8');
    try {
      expect(() => load(p)).toThrow(/Failed to parse storage file/i);
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('throws when the file contains a JSON object (not an array)', () => {
    const p = tmpFile();
    fs.writeFileSync(p, JSON.stringify({ id: 1 }), 'utf-8');
    try {
      expect(() => load(p)).toThrow(/must contain a JSON array/i);
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('throws when the file contains a JSON string (not an array)', () => {
    const p = tmpFile();
    fs.writeFileSync(p, JSON.stringify('just a string'), 'utf-8');
    try {
      expect(() => load(p)).toThrow();
    } finally {
      fs.unlinkSync(p);
    }
  });

  test('returns empty array when the file contains an empty JSON array', () => {
    const p = tmpFile();
    fs.writeFileSync(p, '[]', 'utf-8');
    try {
      expect(load(p)).toEqual([]);
    } finally {
      fs.unlinkSync(p);
    }
  });
});

// ── save() ────────────────────────────────────────────────────────────────

describe('save()', () => {
  test('writes data that can be read back by load()', () => {
    const p = tmpFile();
    const data = [{ id: 1, name: 'Clinic', category: 'healthcare' }];
    try {
      save(data, p);
      expect(load(p)).toEqual(data);
    } finally {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  test('creates parent directories automatically', () => {
    const dir  = path.join(os.tmpdir(), `storage-test-dir-${Date.now()}`);
    const p    = path.join(dir, 'sub', 'resources.json');
    try {
      save([{ id: 99 }], p);
      expect(fs.existsSync(p)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('overwrites existing file', () => {
    const p = tmpFile();
    try {
      save([{ id: 1 }], p);
      save([{ id: 2 }, { id: 3 }], p);
      const result = load(p);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(2);
    } finally {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  test('writes pretty-printed JSON (human-readable)', () => {
    const p = tmpFile();
    try {
      save([{ id: 1, name: 'Test' }], p);
      const raw = fs.readFileSync(p, 'utf-8');
      expect(raw).toContain('\n'); // pretty-printed
    } finally {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  test('round-trips an empty array', () => {
    const p = tmpFile();
    try {
      save([], p);
      expect(load(p)).toEqual([]);
    } finally {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  test('preserves all resource fields through the round-trip', () => {
    const p = tmpFile();
    const resource = {
      id: 7, name: 'Shelter A', category: 'shelter',
      address: '1 Main St', phone: '555-1234',
      hours: 'Mon-Fri 9-5', notes: 'Walk-ins', active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    try {
      save([resource], p);
      const [loaded] = load(p);
      expect(loaded).toEqual(resource);
    } finally {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });
});

// ── deleteStore() ─────────────────────────────────────────────────────────

describe('deleteStore()', () => {
  test('deletes an existing file and returns true', () => {
    const p = tmpFile();
    fs.writeFileSync(p, '[]', 'utf-8');
    expect(deleteStore(p)).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  test('returns false when file does not exist', () => {
    expect(deleteStore(tmpFile())).toBe(false);
  });

  test('file is gone after deletion (load returns [])', () => {
    const p = tmpFile();
    fs.writeFileSync(p, JSON.stringify([{ id: 1 }]), 'utf-8');
    deleteStore(p);
    expect(load(p)).toEqual([]);
  });
});
