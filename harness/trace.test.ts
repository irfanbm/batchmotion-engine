import assert from 'node:assert/strict';
import { consecutiveIdenticalErrors, traceElapsedMs, type JobTrace } from './trace';

const trace = (...errorSets: string[][]): JobTrace => ({
  attempts: errorSets.map((errors, i) => ({ attempt: i + 1, errors, startedAt: 1000 * i })),
});
assert.equal(consecutiveIdenticalErrors(trace(['a'], ['a'])), false, 'two repeats are not enough');
assert.equal(consecutiveIdenticalErrors(trace(['a'], ['a'], ['a'])), true, 'three identical failures stall the loop');
assert.equal(consecutiveIdenticalErrors(trace(['a'], ['b'], ['a'])), false, 'a changed error resets the count');
assert.equal(consecutiveIdenticalErrors(trace(['b', 'a'], ['a', 'b'], ['b', 'a'])), true, 'order within a set does not matter');
assert.equal(traceElapsedMs({ attempts: [
  { attempt: 1, errors: ['a'], startedAt: 1000, endedAtMs: 1500 },
  { attempt: 2, errors: ['b'], startedAt: 2000, endedAtMs: 3000 },
] }), 2000, 'elapsed spans first start to last end');
assert.equal(traceElapsedMs({ attempts: [] }), 0, 'an empty trace costs nothing');
console.log('harness trace checks passed');
