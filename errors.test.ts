import assert from "node:assert/strict";
import {
  normalizeThrown,
  optionalVisualAnalyzer,
  visualGateFinding,
} from "./errors";

const stringError = normalizeThrown("native image unavailable", "frame-capture");
assert.match(stringError.message, /Frame capture failed: native image unavailable/);
assert.equal(stringError.name, "UnknownThrownValue");

const objectError = normalizeThrown(
  { name: "CaptureError", message: "bitmap conversion failed", code: "E_BITMAP", stack: "safe stack" },
  "visual-preflight",
);
assert.match(objectError.message, /Visual preflight failed: bitmap conversion failed \(E_BITMAP\)/);
assert.equal(objectError.stack, "safe stack");

const domError = normalizeThrown(new DOMException("canvas detached", "InvalidStateError"), "render-initialization");
assert.match(domError.message, /Render initialization failed: canvas detached/);
assert.equal(domError.name, "InvalidStateError");

const opaque = normalizeThrown({ name: "UnknownVizError" }, "frame-capture");
assert.match(opaque.message, /Electron could not complete the visual operation/);
assert.doesNotMatch(opaque.message, /^UnknownVizError$/);

void (async () => {
  const warnings: string[] = [];
  const result = await optionalVisualAnalyzer(
    "backdrop coverage",
    () => { throw { name: "UnknownVizError" }; },
    (message) => warnings.push(message),
  );
  assert.equal(result, undefined);
  const rejection = new Error('motion activity rejected');
  rejection.name = 'RenderQualityError';
  await assert.rejects(() => optionalVisualAnalyzer('motion', () => { throw rejection; }, () => {}), /motion activity rejected/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Visual preflight skipped: backdrop coverage: Visual preflight failed:/);

  assert.doesNotThrow(() =>
    visualGateFinding(false, "subject is small", (message) => warnings.push(message)),
  );
  assert.match(warnings.at(-1) || "", /subject is small \(continuing\)/);
  assert.doesNotThrow(() =>
    visualGateFinding(false, "geometry underfill", () => { throw new Error("logger unavailable"); }),
  );
  assert.throws(
    () => visualGateFinding(true, "subject is small", () => {}),
    /Runtime visual quality gate failed/,
  );

  const controller = new AbortController();
  controller.abort(new Error("Stopped."));
  await assert.rejects(
    () => optionalVisualAnalyzer("still detection", () => { throw new Error("analyzer failed"); }, () => {}, controller.signal),
    /analyzer failed/,
  );
  await assert.rejects(
    () => optionalVisualAnalyzer("geometry", () => { throw new Error("DOM measurement failed"); }, () => {}, undefined, () => "Renderer process ended: crashed"),
    /Renderer process ended: crashed/,
  );
  console.log("error normalization checks passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
