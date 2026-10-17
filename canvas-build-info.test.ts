import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { engineBuildInfo, engineStamp, gefootHtml } from './gefoot-runtime';

const sha8 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);
const res = (...p: string[]) => path.join(__dirname, '..', ...p);

test('every Canvas page says which engine build produced it', () => {
  const html = gefootHtml('function setup(){return{}}\nfunction draw(){}', 10, 30, 1, false);
  const content = html.match(/<meta name="batchmotion-engine" content="([^"]*)">/)?.[1];
  assert.ok(content, 'stamp present');
  assert.match(content!, /^batchmotion-engine@\d+\.\d+\.\d+\+(?:[0-9a-f]{7}(?:-dirty)?|nogit) /);
  assert.equal(content, engineStamp);
});

test('stamp hashes match the vendored sources actually bundled (detects a stale or hand-copied runtime)', () => {
  assert.equal(engineBuildInfo.sources.runtime, sha8(res('resources', 'gefoot', 'runtime.js')));
  assert.equal(engineBuildInfo.sources.prompt, sha8(res('resources', 'gefoot', 'prompt.js')));
  assert.equal(engineBuildInfo.sources.csv, sha8(res('resources', 'gefoot', 'csv.js')));
  assert.equal(engineBuildInfo.sources.gsap, sha8(res('resources', 'gsap.min.js')));
  assert.equal(engineBuildInfo.version, JSON.parse(readFileSync(res('package.json'), 'utf8')).version);
});
