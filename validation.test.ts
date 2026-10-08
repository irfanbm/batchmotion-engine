import assert from "node:assert/strict";
import { extractHtml } from "./ai";
import {
  mergeStored,
  normalizeRenderPreset,
  parseStoredJson,
  resolveStoredModel,
} from "./store-utils";
import {
  assertRenderDimensions,
  endpointReport,
  framePlan,
  hasSceneCoverage,
  hasVisualVariation,
  promptFileName,
  renderWindowOptions,
} from "./render";
import { adaptationCacheSignature } from "./html-import";
import { validateHtml } from "./validation";
import {
  activeAt,
  geometryErrors,
  recommendedSubjectScale,
  representativeSubjectError,
  subjectHardValid,
  subjectQualityValid,
  subjectScaleError,
} from "./geometry";
import { motionActivityReport, uniqueErrors } from "./quality";
import { opaqueBackdropReport } from "./scene-coverage";
import { latestRuntimeError, runtimeRepairProgress } from "./runtime-repair";

const valid =
  "<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body><canvas></canvas><script>const x=1;window.__MOTIONFORGE_OBJECTS__=[];window.__MOTIONFORGE_READY__=true</script></body></html>";
assert.deepEqual(validateHtml(valid), []);
assert.ok(
  !validateHtml(
    valid.replace('</head>', '<script src="gsap.min.js"></script></head>'),
    false,
    { hyperframes: true },
  ).some((x) => x.includes('External scripts')),
  'the host-staged gsap.min.js reference passes the script-source ban in HF mode',
);
assert.ok(
  validateHtml(
    valid.replace('</head>', '<script src="https://cdn.example.com/x.js"></script></head>'),
    false,
    { hyperframes: true },
  ).some((x) => x.includes('External scripts')),
  'real CDN scripts still fail in HF mode',
);
assert.deepEqual(
  validateHtml(
    valid.replace(
      "__MOTIONFORGE_OBJECTS__=[]",
      "__MOTIONFORGE_OBJECTS__=[{id:'a',role:'subject'},{id:'b',role:'support'},{id:'c',role:'background',fullBleed:true}]",
    ),
  ),
  [],
  'the three canonical roles pass metadata validation',
);
assert(
  validateHtml(
    valid.replace(
      "__MOTIONFORGE_OBJECTS__=[]",
      "__MOTIONFORGE_OBJECTS__=[{id:'a',role:'subject'},{id:'b',role:'hero'}]",
    ),
  ).some((x) => x.includes("unknown role 'hero'")),
  'invented metadata roles fail fast instead of degrading at render time',
);
assert(
  validateHtml(
    valid.replace(
      "__MOTIONFORGE_OBJECTS__=[]",
      "__MOTIONFORGE_OBJECTS__=[{id:'a',role:'support'}]",
    ),
  ).some((x) => x.includes('declares no subject')),
  'metadata without a subject fails fast',
);
assert(
  validateHtml(
    valid.replace(
      "__MOTIONFORGE_OBJECTS__=[]",
      "__MOTIONFORGE_OBJECTS__=[{id:'a',role:'subject'},{id:'b',role:'subject'}]",
    ),
  ).some((x) => x.includes('more than one subject')),
  'metadata with two subjects fails fast',
);
assert(
  validateHtml(
    valid.replace("body{margin:0}", "body{margin:0;background:#fff}"),
    true,
  ).some((x) => x.includes("opaque root")),
);
assert(
  validateHtml(
    valid.replace("<canvas>", '<div class="checkerboard"><canvas>'),
    true,
  ).some((x) => x.includes("checkerboard")),
);
assert(
  validateHtml(
    valid.replace(
      "body{margin:0}",
      "body{margin:0;background:repeating-conic-gradient(#fff 0 25%,#ccc 0 50%)}",
    ),
    true,
  ).some((x) => x.includes("checkerboard")),
);
assert.deepEqual(
  validateHtml(
    valid.replace(
      "const x=1",
      'const prose="checkerboard and repeating-conic-gradient are irrelevant prose"',
    ),
    true,
  ),
  [],
);
assert.equal(extractHtml(`Explanation\n\`\`\`html\n${valid}\n\`\`\``), valid);
assert(
  validateHtml(
    valid
      .replace("<canvas>", '<img src="https://x.test/a.png"><canvas>')
      .replace("const x=1", 'fetch("x")'),
  ).length === 2,
);
assert(
  validateHtml(valid.replace("const x=1", "const =")).some((x) =>
    x.startsWith("JavaScript syntax:"),
  ),
);
assert(
  validateHtml(
    valid.replace("const x=1", "body{} @keyframes spin{to{transform:rotate(1turn)}}"),
  ).some((x) => x.includes("@keyframes")),
);
assert(
  validateHtml(valid.replace("const x=1", "const s='transition: all 1s'")).some(
    (x) => x.includes("transitions"),
  ),
);
assert(
  validateHtml(valid.replace("const x=1", "const x = Math.random()")).some(
    (x) => x.includes("seeded PRNG"),
  ),
);
assert(
  validateHtml(valid.replace("window.__MOTIONFORGE_READY__=true", "")).some(
    (x) => x.includes("readiness flag"),
  ),
);
assert.equal(hasVisualVariation(Buffer.alloc(64, 0)), false);
assert.equal(
  hasVisualVariation(Buffer.from([0, 0, 0, 255, 1, 0, 0, 255])),
  true,
);
const covered = Buffer.alloc(40 * 40 * 4);
for (let y = 8; y < 32; y++)
  for (let x = 8; x < 32; x++)
    covered.writeUInt32LE(0xffffffff, (y * 40 + x) * 4);
assert.equal(hasSceneCoverage(covered, 40, 40), true);
const tinyCoverage = Buffer.alloc(40 * 40 * 4);
tinyCoverage.writeUInt32LE(0xffffffff, (20 * 40 + 20) * 4);
assert.equal(hasSceneCoverage(tinyCoverage, 40, 40), false);
assert.deepEqual(mergeStored({ 0: { id: "old" } }, []), [{ id: "old" }]);
assert.deepEqual(parseStoredJson('[{"id":"kept"}]', []), [{ id: "kept" }]);
assert.throws(() => parseStoredJson('{broken', []), SyntaxError, 'corrupt persisted JSON must be detected');
assert.equal(
  resolveStoredModel({
    model: "",
    generationModel: "split",
    refinementModel: "ref",
  } as never),
  "split",
);
assert.deepEqual(
  normalizeRenderPreset({ width: 1920, height: 1080, fps: 24 }),
  { width: 2560, height: 1440, fps: 30 },
);
assert.equal(
  promptFileName("Golden stream; luxury background; slow motion"),
  "Golden stream",
);
assert.deepEqual(framePlan(10, 30), {
  count: 300,
  lastTime: 299 / 30,
  duration: 10,
});
assert.equal(framePlan(1.01, 30).count, 30);
const still = Buffer.alloc(400),
  tiny = Buffer.from(still),
  moving = Buffer.alloc(400, 255);
tiny[0] = 5;
assert(endpointReport([still, tiny, still], false).ok);
assert(!endpointReport([still, moving, still], false).ok);
assert(endpointReport([still, tiny], true).ok);
assert(!endpointReport([still, moving], true).ok);
assert.notEqual(
  adaptationCacheSignature("m", 10, 30, false),
  adaptationCacheSignature("m", 10, 30, true),
);
assert.notEqual(
  adaptationCacheSignature("m", 10, 30, false),
  adaptationCacheSignature("m", 11, 30, false),
);
assert.notEqual(
  adaptationCacheSignature("m", 10, 30, false),
  adaptationCacheSignature("m", 10, 60, false),
);
for (const [width, height] of [
  [2560, 1440],
  [1440, 2560],
]) {
  const options = renderWindowOptions(width, height);
  assert.equal(options.width, width);
  assert.equal(options.height, height);
  assert.equal(options.useContentSize, true);
  assert.equal(options.frame, false);
  assert.equal(options.enableLargerThanScreen, true);
  assert.equal(options.webPreferences?.offscreen, true);
}
assert.doesNotThrow(() => assertRenderDimensions(7680, 4320));
assert.throws(() => assertRenderDimensions(16385, 1080), /texture limit/);
const vp = { width: 100, height: 100 },
  subject = { id: "subject", role: "subject" as const, allowCrop: false };
assert.deepEqual(
  geometryErrors(subject, { x: 10, y: 10, width: 50, height: 50 }, vp),
  [],
);
assert.match(
  geometryErrors(subject, { x: -5, y: 0, width: 20, height: 20 }, vp)[0],
  /L5.0/,
);
assert.deepEqual(
  geometryErrors(subject, { x: -3, y: 2, width: 20, height: 20 }, vp),
  [],
  "a hairline rounding overflow is not a visible crop",
);
assert.deepEqual(
  geometryErrors(
    { ...subject, allowCrop: true },
    { x: -5, y: 0, width: 20, height: 20 },
    vp,
  ),
  [],
);
assert.match(
  geometryErrors(
    { id: "bg", role: "background", allowCrop: true, fullBleed: true },
    { x: 2, y: 0, width: 98, height: 100 },
    vp,
  )[0],
  /L2.0/,
);
assert.match(geometryErrors(subject, undefined, vp)[0], /missing/);
assert.deepEqual(
  geometryErrors(
    { id: "bg", role: "background", allowCrop: false, fullBleed: true },
    undefined,
    vp,
    true,
  ),
  [],
);
assert.match(geometryErrors(subject, undefined, vp, true)[0], /missing/);
assert.match(
  geometryErrors(subject, { x: -5, y: 0, width: 20, height: 20 }, vp, true)[0],
  /clipped/,
);
assert.equal(
  subjectScaleError(subject, { x: 20, y: 20, width: 50, height: 40 }, vp, 0.75),
  undefined,
);
assert.match(
  subjectScaleError(subject, { x: 45, y: 45, width: 12, height: 9 }, vp, 0.75)!,
  /12.0% width x 9.0% height.*75%/,
);
assert.equal(
  subjectScaleError(
    { ...subject, allowSmallSubject: true },
    { x: 45, y: 45, width: 12, height: 9 },
    vp,
    0.75,
  ),
  undefined,
);
const frame = (rgba: [number, number, number, number]) =>
  Buffer.from(Array.from({ length: 1000 }, () => rgba).flat());
const black = frame([0, 0, 0, 0]),
  subtle = Buffer.from(black),
  visible = Buffer.from(black),
  alphaChanged = Buffer.from(black);
subtle[0] = 13;
for (let i = 0; i < 8; i++) visible[i * 4] = 20;
for (let i = 0; i < 8; i++) alphaChanged[i * 4 + 3] = 255;
assert(!motionActivityReport([black, black]).ok);
assert(motionActivityReport([black, visible, visible]).ok);
assert(!motionActivityReport([black, subtle]).ok);
assert(!motionActivityReport([black, alphaChanged], false).ok);
assert(motionActivityReport([black, alphaChanged], true).ok);
assert.deepEqual(
  uniqueErrors([
    "t=0.500s subject #hero occupies 12.0% width x 9.0% height",
    "t=0.750s subject #hero occupies 12.0% width x 9.0% height",
  ]),
  ["t=0.500s subject #hero occupies 12.0% width x 9.0% height"],
);
const bitmap = Buffer.alloc(100 * 100 * 4);
const full = { x: 0, y: 0, width: 100, height: 100 },
  tinyRect = { x: 45, y: 45, width: 5, height: 5 };
assert(
  opaqueBackdropReport(
    { paints: [{ tag: "div", rect: full, background: true, paint: true }] },
    [],
    bitmap,
    100,
    100,
  ).ok,
  "full-bleed DOM background",
);
assert(
  opaqueBackdropReport(
    { paints: [{ tag: "div", rect: full, background: true, paint: true }] },
    [],
    Buffer.alloc(100 * 100 * 4, 42),
    100,
    100,
  ).ok,
  "solid background",
);
assert(
  opaqueBackdropReport(
    { paints: [{ tag: "rect", rect: full, background: false, paint: true }] },
    [],
    bitmap,
    100,
    100,
  ).ok,
  "full-viewport SVG paint",
);
assert(
  opaqueBackdropReport({ paints: [] }, [full], bitmap, 100, 100).ok,
  "metadata background",
);
assert(
  !opaqueBackdropReport(
    { paints: [{ tag: "div", rect: tinyRect, background: true, paint: true }] },
    [],
    bitmap,
    100,
    100,
  ).ok,
  "absent opaque backdrop",
);
assert.match(
  subjectScaleError(subject, tinyRect, vp, 0.5) || "",
  /subject #subject occupies/,
  "tiny subject reports subject-specific failure",
);
const entrance = { ...subject, visibleFrom: 0.2, visibleUntil: 0.9 };
assert(!activeAt(entrance, 0));
assert(
  activeAt(entrance, 0.5) && activeAt(entrance, 0.75),
  "entrance hidden at t0 is evaluated when settled",
);
assert(!activeAt(entrance, 0.999), "finite exit at 99.9% is permitted");
assert(
  geometryErrors(subject, undefined, vp).some((x) => x.includes("missing")),
  "missing selector always fails",
);
assert(
  subjectScaleError(subject, { x: 0, y: 0, width: 31, height: 26 }, vp, 0.5) ===
    undefined,
  "wide subject accepted",
);
assert(
  subjectScaleError(subject, { x: 0, y: 0, width: 23, height: 36 }, vp, 0.5) ===
    undefined,
  "tall subject accepted",
);
assert(
  Math.abs(
    recommendedSubjectScale(
      subject,
      { x: 0, y: 0, width: 24.2, height: 16.1 },
      vp,
    ) - 1.576,
  ) < 0.002,
  "scale recommendation uses area and either dimension",
);
assert.match(
  subjectScaleError(
    subject,
    { x: 0, y: 0, width: 24.2, height: 16.1 },
    vp,
    0.5,
  ) || "",
  /3\.9% area.*1\.58x/,
  "action factor uses normal rounding",
);
assert.match(
  representativeSubjectError(
    [{ ...subject, visibleFrom: 0, visibleUntil: 0.1 }],
    false,
  ) || "",
  /no valid representative frame at 40%, 50%, 60%, 70%, or 75%/,
  "t0-only visibility cannot bypass settled recognizability",
);
for (const rect of [
  { x: 0, y: 0, width: 21.1, height: 17.5 },
  { x: 0, y: 0, width: 30.5, height: 21.8 },
]) {
  assert(
    subjectHardValid(subject, rect, vp),
    "a clearly usable card must pass the hard validity gate",
  );
  assert(
    !subjectQualityValid(subject, rect, vp),
    "a usable but undersized card remains eligible for one quality repair",
  );
}
assert.equal(
  representativeSubjectError([entrance], true),
  undefined,
  "valid settled entrance with finite exit passes",
);
assert(
  !runtimeRepairProgress(
    "subject #hero occupies 20.0% width x 15.0% height (3.0% area)",
    "subject #hero occupies 20.1% width x 15.1% height (3.1% area)",
  ),
  "tiny improvement cannot unlock repair 2",
);
assert(
  runtimeRepairProgress(
    "subject #hero occupies 20.0% width x 15.0% height (3.0% area)",
    "subject #hero occupies 24.0% width x 18.0% height (4.3% area)",
  ),
  "meaningful progress unlocks repair 2",
);
assert(
  !runtimeRepairProgress(
    "subject #hero occupies 20.0% width x 15.0% height (3.0% area)",
    "subject #hero occupies 24.0% width x 18.0% height (4.3% area); missing element #support",
  ),
  "new severe errors block repair 2",
);
assert.equal(
  latestRuntimeError(
    "Runtime preflight failed: t=0.500s subject #hero clipped px L1.0; t=0.750s subject #hero clipped px L2.0",
  ).match(/subject #hero clipped/g)?.length,
  1,
  "latest errors are deduped",
);
assert.doesNotThrow(
  () => opaqueBackdropReport({ paints: [] }, [], bitmap, 100, 100),
  "alpha scenes skip this report at the caller",
);
const splitDoc = valid.replace(
  "<canvas>",
  '<div id="split-film"><canvas></div><div id="split-drafts"><i class="draft-card active" id="draft-0"></i><i id="draft-1"></i><i id="draft-2"></i><i id="draft-3"></i><b id="split-playhead"></b></div>',
);
assert.deepEqual(
  validateHtml(splitDoc, false, { split: true }),
  [],
  "complete Studio Split structure passes",
);
assert(
  validateHtml(
    splitDoc.replace(' class="draft-card active"', ""),
    false,
    { split: true },
  ).some((x) => x.includes('draft-0 must carry class')),
  "card 0 must start active in the markup, not only in a timeline set",
);
assert(
  validateHtml(
    splitDoc.replace(
      "<b id=\"split-playhead\"></b>",
      '<b id="split-playhead"></b><script>tl.to(playhead, { left: "calc(24px + (100% - 48px) * 1)", duration: 8, ease: "none" }, 0);</script>',
    ),
    false,
    { split: true },
  ).some((x) => x.includes("cannot interpolate calc()")),
  "a calc() playhead tween fails before Chromium captures a drifting sweep",
);
assert(
  validateHtml(
    splitDoc.replace(
      "<b id=\"split-playhead\"></b>",
      '<b id="split-playhead"></b><script>tl.call(() => setCard(1), null, 2);</script>',
    ),
    false,
    { split: true },
  ).some((x) => x.includes("tl.call callbacks")),
  "callback card switches fail: sets are position-determined, callbacks depend on seek order",
);
const missingSplit = validateHtml(valid, false, { split: true });
for (const id of ["split-film", "split-drafts", "split-playhead", "draft-0", "draft-3"])
  assert(
    missingSplit.some((x) => x.includes(id)),
    `missing ${id} is reported by name`,
  );
assert.equal(
  missingSplit.filter((x) => x.startsWith("Studio Split layout missing")).length,
  7,
  "film stage, draft strip, playhead and all four cards are required",
);
assert.deepEqual(
  validateHtml(valid, false, {}),
  [],
  "split checks stay off unless the job asks for them",
);
assert.deepEqual(
  validateHtml(splitDoc.replace(' id="split-playhead"', ""), false, { split: true }).length,
  1,
  "a broken board fails exactly the missing element",
);
console.log("validation checks passed");
