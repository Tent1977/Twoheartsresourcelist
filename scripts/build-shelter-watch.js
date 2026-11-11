#!/usr/bin/env node
/**
 * Builds the Shelter Watch site data from the research dataset.
 *   node scripts/build-shelter-watch.js
 *
 * - web/shelter-watch/facilities.json   compact public data (nulls and empty facts dropped)
 * - web/shelter-watch/lib/*.js          shared logic modules
 * - functions/lib/*.js, functions/facility-info.json   for the server-side review screen
 *
 * Fails if a listing has a phone field with no callable number in it, so a
 * broken "Call" button can never ship.
 */
const fs = require('fs');
const path = require('path');
const { schema } = require('../src/shelterwatch');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const master = read('data/shelter-watch/housing_master.json');
const aliasesPath = path.join(root, 'data/shelter-watch/id_aliases.json');
const aliases = fs.existsSync(aliasesPath) ? JSON.parse(fs.readFileSync(aliasesPath, 'utf8')) : {};

const facilities = master.filter((r) => !String(r.group || '').startsWith('Out of scope')).map(schema.toFacility);

const problems = [];
facilities.forEach((f) => {
  if (f.phone && f.phones.length === 0) problems.push(`${f.id}: phone "${f.phone}" has no callable number`);
  f.phones.forEach((p) => {
    if (!/^(\d{10}|[2-9]11|988)$/.test(p.number)) problems.push(`${f.id}: bad number ${p.number}`);
  });
});
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}

// Compact: drop nulls/empty arrays and empty fact pairs; the browser fills them back in.
const compact = facilities.map((f) => {
  const out = {};
  Object.entries(f).forEach(([k, v]) => {
    if (v === null || v === false || (Array.isArray(v) && v.length === 0)) return;
    if (k === 'facts') {
      const facts = {};
      Object.entries(v).forEach(([fk, fv]) => {
        if (fv.establishment || fv.verified) facts[fk] = fv;
      });
      if (Object.keys(facts).length) out.facts = facts;
      return;
    }
    out[k] = v;
  });
  return out;
});

const webDir = path.join(root, 'web/shelter-watch');
fs.writeFileSync(
  path.join(webDir, 'facilities.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), count: compact.length, aliases, facilities: compact })
);

const modules = ['schema', 'moderation', 'factcheck', 'ratings'];
fs.mkdirSync(path.join(root, 'functions/lib'), { recursive: true });
modules.forEach((m) => {
  fs.copyFileSync(path.join(root, `src/shelterwatch/${m}.js`), path.join(webDir, `lib/${m}.js`));
  if (m === 'schema' || m === 'moderation') {
    fs.copyFileSync(path.join(root, `src/shelterwatch/${m}.js`), path.join(root, `functions/lib/${m}.js`));
  }
});

const info = {};
facilities.forEach((f) => {
  info[f.id] = { confidential: f.confidential, numbers: f.phones.map((p) => p.number) };
});
fs.writeFileSync(path.join(root, 'functions/facility-info.json'), JSON.stringify(info));

// Keep the database rules' list of real and confidential listings in step with the data.
const rulesPath = path.join(webDir, 'firestore.rules');
const rules = fs.readFileSync(rulesPath, 'utf8');
const list = (ids) => `[${ids.map((id) => `'${id}'`).join(', ')}]`;
const generated = [
  '    // BEGIN GENERATED (scripts/build-shelter-watch.js) — do not edit by hand',
  `    function knownFacility(id) { return id in ${list(facilities.map((f) => f.id))}; }`,
  `    function confidentialFacility(id) { return id in ${list(facilities.filter((f) => f.confidential).map((f) => f.id))}; }`,
  '    // END GENERATED',
].join('\n');
const next = rules.replace(/    \/\/ BEGIN GENERATED[\s\S]*?\/\/ END GENERATED/, generated);
if (next === rules && !rules.includes(generated)) {
  console.error('firestore.rules is missing the GENERATED markers');
  process.exit(1);
}
fs.writeFileSync(rulesPath, next);

const kb = (fs.statSync(path.join(webDir, 'facilities.json')).size / 1024).toFixed(0);
console.log(`Wrote ${compact.length} facilities (${kb} KB) to web/shelter-watch/facilities.json`);
