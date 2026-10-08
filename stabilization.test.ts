import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { mandatoryRuntimeSkeleton } from "./ai";
import { EXPERIMENTAL_VISUAL_GATES } from "./render";

const source = (name: string) => fs.readFileSync(path.join(__dirname, `../${name}`), "utf8");
const render = source("render.ts");
const queue = source("queue.ts");
const ai = source("ai.ts");

assert.equal(EXPERIMENTAL_VISUAL_GATES, false);
for (const diagnostic of ["subject and geometry diagnostics", "motion activity diagnostic", "timeline endpoint diagnostic"])
  assert.match(render, new RegExp(`optionalVisualAnalyzer\\(\"${diagnostic}`));
assert.match(render, /visualGateFinding\(EXPERIMENTAL_VISUAL_GATES/);
assert.doesNotMatch(queue, /runtimeRepairKind|runtimeRepairProgress|measured .* repair|acceptSuboptimalQuality/);
assert.doesNotMatch(queue, /generateHtml\([\s\S]{0,300}errors: \[failure\]/);
assert.match(queue, /\^Visual preflight \(\?:warning\|skipped\):/);
assert.match(queue, /line === \"Rendering frames\"/);

for (const hardCheck of [
  /Insufficient disk space/,
  /requires DPR 1/,
  /Motion viewport mismatch/,
  /Motion capture size changed/,
  /Browser runtime initialization failed/,
  /assertRuntimeHealthy\(\"readiness\"\)/,
  /assertRuntimeHealthy\(`frame \$\{frame\}`\)/,
  /Encoded output verification failed/,
  /verifyEncodedAlpha/,
  /runFfmpeg/,
]) assert.match(render, hardCheck);

for (const required of [
  /requestAnimationFrame\(frame\)/,
  /applyFrame\(0\)/,
  /gsap\.timeline\(\{ paused: true \}\)/,
  /gsap\.defaults\(\{ lazy: false \}\)/,
  /['"]motionforge:frame['"]/,
  /tl\.seek\(seconds, false\)/,
  /__MOTIONFORGE_READY__/,
  /motionforge:ready/,
  /performance\.now\(\)/,
  /Never use CSS @keyframes/,
]) assert.match(mandatoryRuntimeSkeleton, required);
// Concept mode keeps the frozen pre-GSAP runtime (WAAPI), not the GSAP skeleton.
assert.match(ai, /conceptRuntimeSkeleton = `[\s\S]*renderScene\(0\)/);
assert.match(ai, /const system = `[\s\S]*\$\{mandatoryRuntimeSkeleton\}`/);
assert.match(ai, /FINAL MANDATORY CHECK[\s\S]*\$\{mandatoryRuntimeSkeleton\}/);
console.log("stabilization policy checks passed");
