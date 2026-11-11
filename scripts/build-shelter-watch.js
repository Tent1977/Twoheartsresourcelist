#!/usr/bin/env node
/**
 * Builds web/shelter-watch/facilities.json from the research dataset and
 * copies the shared logic modules into web/shelter-watch/lib/.
 *   node scripts/build-shelter-watch.js
 */
const fs = require('fs');
const path = require('path');
const { schema } = require('../src/shelterwatch');

const root = path.join(__dirname, '..');
const master = JSON.parse(fs.readFileSync(path.join(root, 'data/shelter-watch/housing_master.json'), 'utf8'));
const outDir = path.join(root, 'web/shelter-watch');

const facilities = master
  .filter((r) => !String(r.group || '').startsWith('Out of scope'))
  .map(schema.toFacility);

fs.writeFileSync(
  path.join(outDir, 'facilities.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), count: facilities.length, facilities }, null, 2)
);

['schema', 'moderation', 'factcheck', 'ratings'].forEach((m) => {
  fs.copyFileSync(path.join(root, `src/shelterwatch/${m}.js`), path.join(outDir, `lib/${m}.js`));
});

console.log(`Wrote ${facilities.length} facilities to web/shelter-watch/facilities.json`);
