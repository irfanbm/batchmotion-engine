// Copies the vendored Gefoot Canvas runtime/prompt sources into dist/ as *.source files.
// Canvas sources live INSIDE this repository (resources/canvas) so a fresh clone builds and packs
// without any sibling folder. Override with CANVAS_SRC_DIR only for local experiments.
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.CANVAS_SRC_DIR ? path.resolve(process.env.CANVAS_SRC_DIR) : path.join(__dirname, 'resources', 'canvas');
const required = ['runtime', 'prompt', 'csv', 'kit']; // prompt.js imports stockCsvText from csv.js; kit.js is the MF motion kit

const missing = required.filter((name) => !fs.existsSync(path.join(root, `${name}.js`)));
if (missing.length) {
  console.error(`build-gefoot: missing ${missing.map((n) => `${n}.js`).join(', ')} in ${root}.`);
  console.error('Add the Canvas sources to resources/canvas/ (runtime.js, prompt.js, csv.js, kit.js).');
  process.exit(1);
}

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
for (const name of required) {
  fs.writeFileSync(path.join(__dirname, 'dist', `gefoot-${name}.source`), fs.readFileSync(path.join(root, `${name}.js`), 'utf8'));
}

// Build stamp: lets any generated Canvas page (and the host) say which engine produced it.
// commit is "<sha7>" or "<sha7>-dirty" (local edits, e.g. a hand-copied runtime), "nogit" outside a checkout.
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const sha8 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
const git = (args) => { try { return execSync(`git ${args}`, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
const sha = git('rev-parse --short=7 HEAD');
const info = {
  name: require('./package.json').name,
  version: require('./package.json').version,
  commit: sha ? `${sha}${git('status --porcelain -- . ":!dist"') ? '-dirty' : ''}` : 'nogit',
  sources: Object.fromEntries([...required.map((n) => [n, sha8(path.join(root, `${n}.js`))]), ['gsap', sha8(path.join(__dirname, 'resources', 'gsap.min.js'))]]),
};
fs.writeFileSync(path.join(__dirname, 'dist', 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
