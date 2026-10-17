import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Guards portability: the Canvas runtime/prompt must ship inside the repo (resources/gefoot),
// and the built dist/*.source copies must be what gefoot-runtime.ts loads at startup.
const root = path.join(__dirname, '..', 'resources', 'gefoot');
const read = (name: string) => readFileSync(path.join(root, name), 'utf8');

assert.ok(existsSync(path.join(root, 'runtime.js')), 'resources/gefoot/runtime.js must be committed');
assert.ok(existsSync(path.join(root, 'prompt.js')), 'resources/gefoot/prompt.js must be committed');
assert.match(read('runtime.js'), /function\s+compileScene\s*\(/, 'runtime exposes compileScene');
assert.match(read('prompt.js'), /function\s+buildPrompt\s*\(/, 'prompt exposes buildPrompt');
for (const name of ['runtime', 'prompt']) {
  assert.equal(readFileSync(path.join(__dirname, `gefoot-${name}.source`), 'utf8'), read(`${name}.js`), `dist/gefoot-${name}.source mirrors resources/gefoot/${name}.js`);
}
const { gefootHtml, gefootPrompt } = require('./gefoot-runtime') as typeof import('./gefoot-runtime');
assert.equal(typeof gefootPrompt('a cube'), 'string');
assert.match(gefootHtml('function setup(env){return{}}\nfunction draw(ctx,t,env){}', 10, 30, 1, false), /compileScene\(/);
console.log('gefoot resource checks passed');
