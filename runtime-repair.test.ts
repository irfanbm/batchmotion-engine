import assert from 'node:assert/strict';
import { MAX_REPAIR_ATTEMPTS_PER_KIND, canAttemptRuntimeRepair, maxRepairAttempts, runtimeRepairContract, runtimeRepairKind } from './runtime-repair';

// kind classification from measured failure messages
assert.equal(runtimeRepairKind('Runtime preflight quality target: subject too small'), 'quality');
assert.equal(runtimeRepairKind('opaque background coverage 80%'), 'coverage');
assert.equal(runtimeRepairKind('flicker detected; 5 direction reversals'), 'flicker');
assert.equal(runtimeRepairKind('subject drift 0.30 beyond tolerance'), 'drift');
assert.equal(runtimeRepairKind('title contrast 1.4 below 3'), 'text');
assert.equal(runtimeRepairKind('loop seam pixel endpoint change 4%'), 'loop');
assert.equal(runtimeRepairKind('color consistency new colors 40%'), 'color');
assert.equal(runtimeRepairKind('beat table gap too large'), 'beats');
assert.equal(runtimeRepairKind('renderer process ended'), 'hard');

// every kind has a repair contract
const kinds = ['hard', 'quality', 'coverage', 'flicker', 'drift', 'text', 'loop', 'color', 'beats'] as const;
for (const kind of kinds) assert.ok(runtimeRepairContract[kind].length > 10, `contract for ${kind}`);

// attempt budgets: quality stays at 1, everything else at the shared cap of 2
assert.equal(maxRepairAttempts('quality'), 1);
assert.equal(MAX_REPAIR_ATTEMPTS_PER_KIND, 2);
for (const kind of kinds) assert.equal(maxRepairAttempts(kind), kind === 'quality' ? 1 : 2);

// attempt gating
assert.equal(canAttemptRuntimeRepair('quality', 0, 'a', 'b'), true);
assert.equal(canAttemptRuntimeRepair('quality', 1, 'a', 'b'), false);
assert.equal(canAttemptRuntimeRepair('beats', 0, '', ''), true);
assert.equal(canAttemptRuntimeRepair('hard', 2, 'a', 'b'), false);
assert.equal(canAttemptRuntimeRepair('flicker', 2, 'a', 'b'), false);
// second attempt requires measured progress on the subject metric
const before = 'subject #hero occupies 10.0% width x 10.0% height (1.0% area)';
const improved = 'subject #hero occupies 20.0% width x 20.0% height (4.0% area)';
assert.equal(canAttemptRuntimeRepair('coverage', 1, before, improved), true);
assert.equal(canAttemptRuntimeRepair('coverage', 1, before, before), false);
console.log('runtime repair kind checks passed');
