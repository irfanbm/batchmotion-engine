import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Guards portability: the Canvas sources ship inside the repo (resources/canvas), the build copies them
// verbatim to dist/*.source, and the engine loads them without any sibling folder.
const root = path.join(__dirname, '..', 'resources', 'canvas');
const read = (name: string) => readFileSync(path.join(root, name), 'utf8');

for (const name of ['runtime.js', 'prompt.js', 'csv.js']) assert.ok(existsSync(path.join(root, name)), `resources/canvas/${name} must be committed`);
assert.match(read('runtime.js'), /function\s+compileScene\s*\(/, 'runtime exposes compileScene');
assert.match(read('prompt.js'), /function\s+buildPrompt\s*\(/, 'prompt exposes buildPrompt');
assert.match(read('prompt.js'), /import\s*\{\s*stockCsvText\s*\}\s*from\s*'\.\/csv\.js'/, 'prompt.js still imports stockCsvText from csv.js');
assert.match(read('csv.js'), /export function stockCsvText\s*\(/, 'csv.js exports stockCsvText');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
for (const name of ['runtime', 'prompt', 'csv']) {
  assert.equal(sha(readFileSync(path.join(__dirname, `gefoot-${name}.source`), 'utf8')), sha(read(`${name}.js`)), `dist/gefoot-${name}.source is a verbatim copy of resources/canvas/${name}.js`);
}
const { gefootHtml, gefootPrompt, gefootStockCsv } = require('./gefoot-runtime') as typeof import('./gefoot-runtime');
const prompt = gefootPrompt('a floating cube');
assert.ok(prompt.includes('CONCEPT: a floating cube') && prompt.includes('function setup(env)') && prompt.includes('function draw(ctx, t, env)'), 'real Gefoot prompt is loaded (not a stub)');
assert.ok(!/STUB/i.test(prompt), 'prompt is not a stub');
const csv = gefootStockCsv('a.mp4', { title: 'T', keywords: ['a', 'b'], category: 8 });
assert.equal(csv, 'Filename,Title,Keywords,Category,Releases\r\na.mp4,T,"a, b",8,\r\n', 'buildStockCsv resolves stockCsvText from csv.js');
assert.match(gefootHtml('function setup(env){return{}}\nfunction draw(ctx,t,env){}', 10, 30, 1, false), /compileScene\(/);
// no build-time dependency on a sibling checkout
assert.ok(!/Batchmotion[\\/]+gefoot-main/.test(readFileSync(path.join(__dirname, '..', 'build-gefoot.cjs'), 'utf8').replace(/\/\/.*$/gm, '')), 'build-gefoot.cjs has no sibling-folder path');
console.log('Canvas resource checks passed');
