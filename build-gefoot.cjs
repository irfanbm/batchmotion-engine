// Copies the vendored Gefoot Canvas runtime/prompt sources into dist/ as *.source files.
// Sources live INSIDE this repository (resources/gefoot) so a fresh clone builds and packs
// without any sibling folder. Override with GEFOOT_SRC_DIR only for local experiments.
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.GEFOOT_SRC_DIR ? path.resolve(process.env.GEFOOT_SRC_DIR) : path.join(__dirname, 'resources', 'gefoot');
const required = ['runtime', 'prompt', 'csv']; // prompt.js imports stockCsvText from csv.js

const missing = required.filter((name) => !fs.existsSync(path.join(root, `${name}.js`)));
if (missing.length) {
  console.error(`build-gefoot: missing ${missing.map((n) => `${n}.js`).join(', ')} in ${root}.`);
  console.error('Add the Gefoot sources to resources/gefoot/ (runtime.js, prompt.js, csv.js).');
  process.exit(1);
}

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
for (const name of required) {
  fs.writeFileSync(path.join(__dirname, 'dist', `gefoot-${name}.source`), fs.readFileSync(path.join(root, `${name}.js`), 'utf8'));
}
