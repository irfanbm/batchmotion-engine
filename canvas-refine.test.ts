import assert from 'node:assert/strict';
import test from 'node:test';
import { needsTransitionRepair, popScore, refineTransitions, transitionRepairErrors } from './canvas-refine';
import { popReport } from './quality';

const calm = Array.from({ length: 300 }, (_, i) => (i === 0 ? 0 : 0.004));
const cuts = (frames: number[], step: number) => calm.map((v, i) => (frames.includes(i) ? step : v === 0.004 ? 0.0004 : v));
const result5 = cuts([71, 110, 144, 177, 239], 0.05); // shape of the real prompt-result-5 scene: five hard cuts
const make = (stepsByCode: Record<string, number[]>, over: Partial<Parameters<typeof refineTransitions>[1]> = {}) => {
  const calls = { regenerate: 0, logs: [] as string[], errors: [] as string[][] };
  const deps = {
    fps: 30,
    log: (m: string) => calls.logs.push(m),
    steps: async (c: string) => stepsByCode[c],
    validate: async () => [] as string[],
    regenerate: async (_c: string, e: string[]) => { calls.regenerate++; calls.errors.push(e); return 'good'; },
    ...over,
  };
  return { deps, calls };
};

test('thresholds: calm scenes are left alone, repeated or large cuts trigger repair', () => {
  assert.equal(needsTransitionRepair(popReport(calm)), false);
  assert.equal(needsTransitionRepair(popReport(cuts([100], 0.008))), false, 'one small pop is only a warning');
  assert.equal(needsTransitionRepair(popReport(cuts([100], 0.09))), true, 'one big hard cut');
  assert.equal(needsTransitionRepair(popReport(cuts([50, 100, 150], 0.008))), true, 'three small pops');
  assert.equal(needsTransitionRepair(popReport(result5)), true);
});

test('calm scene: no extra model call', async () => {
  const { deps, calls } = make({ orig: calm });
  assert.equal(await refineTransitions('orig', deps), 'orig');
  assert.equal(calls.regenerate, 0);
});

test('hard cuts: exactly one repair, accepted only when valid and measurably calmer', async () => {
  const { deps, calls } = make({ orig: result5, good: cuts([110], 0.004) });
  assert.equal(await refineTransitions('orig', deps), 'good');
  assert.equal(calls.regenerate, 1);
  assert.match(calls.errors[0].join(' '), /HARD CUTS/);
  assert.match(calls.errors[0].join(' '), /2\.37s/);
  assert.match(calls.errors[0].join(' '), /persistent/);
});

test('repair is discarded (original kept) when invalid, not calmer, or when the call fails', async () => {
  const invalid = make({ orig: result5, good: calm }, { validate: async () => ['Missing draw'] });
  assert.equal(await refineTransitions('orig', invalid.deps), 'orig');
  const same = make({ orig: result5, good: result5 });
  assert.equal(await refineTransitions('orig', same.deps), 'orig');
  const boom = make({ orig: result5 }, { regenerate: async () => { throw new Error('provider down'); } });
  assert.equal(await refineTransitions('orig', boom.deps), 'orig');
  assert.ok(boom.calls.logs.some((l) => /skipped/.test(l)));
});

test('an unreadable step series never blocks generation', async () => {
  const { deps, calls } = make({}, { steps: async () => { throw new Error('page failed'); } });
  assert.equal(await refineTransitions('orig', deps), 'orig');
  assert.equal(calls.regenerate, 0);
});

test('score ranks fewer/smaller cuts as calmer', () => {
  assert.ok(popScore(popReport(cuts([100], 0.01))) < popScore(popReport(result5)));
  assert.ok(transitionRepairErrors(popReport(result5), 30).length === 2);
});
