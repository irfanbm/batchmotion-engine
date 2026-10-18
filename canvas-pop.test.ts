import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { popReport } from './quality';

// Step series measured on real renders (percent -> fraction): result-3 of the checkout brief, sampled at 30 fps.
const calm = (n: number, v = 0.0003) => Array.from({ length: n }, () => v);

test('isolated one-frame jump between calm frames is a pop', () => {
  const steps = calm(100); steps[43] = 0.0181;
  assert.deepEqual(popReport(steps).pops.map(p => p.frame), [43]);
});

test('small content swap (0.39%) with still neighbours is still a pop; the same size inside moving frames is not', () => {
  const still = calm(60, 0); still[30] = 0.0039;
  assert.deepEqual(popReport(still).pops.map(p => p.frame), [30]);
  const moving = calm(60, 0.0035); moving[30] = 0.0039;
  assert.deepEqual(popReport(moving).pops, []);
});

test('ordinary fast motion and fades are not flagged', () => {
  const fade = Array.from({ length: 40 }, (_, i) => 0.008 + 0.001 * Math.sin(i / 3));
  assert.deepEqual(popReport(fade).pops, []);
  const ramp = Array.from({ length: 40 }, (_, i) => 0.0005 * (i + 1));
  assert.deepEqual(popReport(ramp).pops, []);
});

test('several boundaries are all reported, with their neighbour level', () => {
  const steps = calm(300, 0); for (const f of [43, 86, 129, 172, 215, 258]) steps[f] = 0.01;
  const r = popReport(steps);
  assert.equal(r.pops.length, 6);
  assert.equal(r.maxStep, 0.01);
  assert.ok(r.pops.every(p => p.neighbour === 0.0002), 'neighbour is floored at 0.02%');
});

test('edges and tiny jumps are ignored', () => {
  const steps = calm(50, 0); steps[1] = 0.05; steps[49] = 0.05; steps[20] = 0.001;
  assert.deepEqual(popReport(steps).pops, []);
});

test('pop detection is warning-only: the render path never rejects or throws because of it', () => {
  const src = readFileSync(path.join(__dirname, '..', 'render.ts'), 'utf8');
  const start = src.indexOf('const pops = popReport(popSteps)');
  const end = src.indexOf('progress(82)', start);
  assert.ok(start > 0 && end > start, 'pop block located');
  const block = src.slice(start, end);
  assert.ok(/visualWarning\(/.test(block));
  assert.ok(!/qualityGateReject|throw |RenderQualityError/.test(block), 'no hard failure in the pop block');
});
