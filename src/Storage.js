/**
 * Simple JSON file-based persistence for the resource list.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = path.join(process.cwd(), 'data', 'resources.json');

/**
 * Load resources from a JSON file.
 * Returns an empty array if the file does not exist.
 * @param {string} filePath
 * @returns {object[]}
 */
function load(filePath = DEFAULT_PATH) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Storage file must contain a JSON array');
    }
    return parsed;
  } catch (err) {
    throw new Error(`Failed to parse storage file "${filePath}": ${err.message}`);
  }
}

/**
 * Save resources to a JSON file, creating parent directories if needed.
 * @param {object[]} resources
 * @param {string} filePath
 */
function save(resources, filePath = DEFAULT_PATH) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(resources, null, 2), 'utf-8');
}

/**
 * Delete the storage file if it exists.
 */
function deleteStore(filePath = DEFAULT_PATH) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

module.exports = { load, save, deleteStore, DEFAULT_PATH };
