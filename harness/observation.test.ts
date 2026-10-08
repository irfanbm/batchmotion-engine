import assert from 'node:assert/strict';
import { buildObservationMessage } from './observation';

assert.equal(buildObservationMessage('fix it', []), 'fix it', 'no frames means a plain text task');
const parts = buildObservationMessage('fix it', ['data:image/jpeg;base64,A', 'data:image/jpeg;base64,B']);
assert.ok(Array.isArray(parts) && parts.length === 3, 'text plus two frames');
assert.deepEqual(parts[0], { type: 'text', text: 'fix it' });
assert.deepEqual(parts[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,A' } });
const capped = buildObservationMessage('fix it', ['a', 'b', 'c', 'd']);
assert.equal((capped as unknown[]).length, 4, 'at most three frames ride along');
console.log('harness observation checks passed');
