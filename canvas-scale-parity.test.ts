import assert from 'node:assert/strict';
import test from 'node:test';
import { gefootRuntime } from './gefoot-runtime';

// Preview-vs-export parity at the API level (no GPU/Electron needed): the same scene is driven through the real
// Gefoot runtime at several pixel widths against a recording 2D context. Everything the scene sets is in 1920x1080
// logical units, so every quantity that ends up on screen must scale with pixelW/1920. Quantities that do not are
// reported as `todo` below: they are the preview/export mismatch (the runtime applies a transform scale, but canvas
// shadowBlur, shadowOffset and filter lengths are specified in device pixels and are NOT affected by the transform).

class StubPath2D { addPath() {} moveTo() {} lineTo() {} arc() {} ellipse() {} rect() {} roundRect() {} arcTo() {} quadraticCurveTo() {} bezierCurveTo() {} closePath() {} }
type M = { a: number; b: number; c: number; d: number; e: number; f: number };
interface Entry { op: string; x: number; w: number; lineWidthPx: number; shadowBlurPx: number; shadowOffsetYPx: number; filterPx: number; t: number }

class RecCtx {
  m: M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  stack: { m: M; lineWidth: number; shadowBlur: number; shadowOffsetY: number; filter: string }[] = [];
  log: Entry[] = []; tSeen = -1;
  fillStyle: unknown = ''; strokeStyle: unknown = ''; lineWidth = 1; shadowBlur = 0; shadowOffsetX = 0; shadowOffsetY = 0; shadowColor = 'transparent';
  filter = 'none'; globalCompositeOperation = 'source-over'; globalAlpha = 1; lineJoin = 'miter'; miterLimit = 10; lineCap = 'butt';
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { this.m = { a, b, c, d, e, f }; }
  getTransform() { return { ...this.m }; }
  save() { this.stack.push({ m: { ...this.m }, lineWidth: this.lineWidth, shadowBlur: this.shadowBlur, shadowOffsetY: this.shadowOffsetY, filter: this.filter }); }
  restore() { const s = this.stack.pop(); if (s) { this.m = s.m; this.lineWidth = s.lineWidth; this.shadowBlur = s.shadowBlur; this.shadowOffsetY = s.shadowOffsetY; this.filter = s.filter; } }
  reset() { this.m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; this.stack = []; this.log = []; this.lineWidth = 1; this.shadowBlur = 0; this.shadowOffsetY = 0; this.filter = 'none'; }
  clip() {} beginPath() {} closePath() {} moveTo() {} lineTo() {} arc() {} ellipse() {} rect() {} roundRect() {} arcTo() {} quadraticCurveTo() {} bezierCurveTo() {}
  fill() {} stroke() {} fillText() {} strokeText() {} measureText() { return { actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0 }; }
  private rec(op: string, x: number, w: number) {
    const filterPx = [...this.filter.matchAll(/(\d*\.?\d+)px/g)].reduce((s, m) => s + Number(m[1]), 0);
    this.log.push({ op, x: x * this.m.a + this.m.e, w: w * this.m.a, lineWidthPx: this.lineWidth * this.m.a, shadowBlurPx: this.shadowBlur, shadowOffsetYPx: this.shadowOffsetY, filterPx, t: this.tSeen });
  }
  fillRect(x: number, _y: number, w: number) { this.rec('fillRect', x, w); }
  strokeRect(x: number, _y: number, w: number) { this.rec('strokeRect', x, w); }
}

const { compileScene } = new Function('Path2D', 'OffscreenCanvas', `${gefootRuntime}\nreturn { compileScene };`)(StubPath2D, undefined) as {
  compileScene: (code: string, o: { duration: number; fps: number; seed: number }) => { drawFrame: (ctx: unknown, frame: number, pixelW: number) => void; totalFrames: number };
};

const SCENE = `function setup(env){return {};}
function draw(ctx,t,env){
  ctx.tSeen=t;
  const x=200+t*100;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,env.width,env.height);
  ctx.shadowColor='rgba(0,0,0,.4)';ctx.shadowBlur=28;ctx.shadowOffsetY=14;
  ctx.fillRect(x,300,400,260);                      // card with soft shadow
  ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  ctx.lineWidth=10;ctx.strokeRect(x,300,400,260);   // outline
  ctx.filter='blur(6px)';ctx.fillRect(900,400,200,200);ctx.filter='none'; // filtered glow
}`;
const FPS = 30, DURATION = 10;
const PREVIEW = 640, EXPORT_4K = 3840;
const scene = compileScene(SCENE, { duration: DURATION, fps: FPS, seed: 1 });
const run = (frame: number, pixelW: number) => { const c = new RecCtx(); scene.drawFrame(c, frame, pixelW); return c.log; };
// log[0] is the runtime's own pre-fill; scene draws follow in order: background, shadowed card, outline, filtered glow.
const CARD = 2, OUTLINE = 3, GLOW = 4;
const at = (log: Entry[], i: number) => log[i];
const norm = (v: number, pixelW: number) => v / pixelW;

test('frame timing: t is frame/fps at every resolution and wraps identically', () => {
  for (const frame of [0, 1, 150, 299]) for (const w of [PREVIEW, 1920, EXPORT_4K]) assert.ok(Math.abs(run(frame, w).at(-1)!.t - frame / FPS) < 1e-12, `frame ${frame} @${w}`);
  assert.equal(scene.totalFrames, DURATION * FPS);
  assert.deepEqual(run(300, PREVIEW).map(e => e.t).slice(1), run(0, PREVIEW).map(e => e.t).slice(1), 'frame == totalFrames wraps to frame 0 (a "last still" must use totalFrames-1)');
});

test('object position and size scale exactly with pixelW', () => {
  for (const frame of [0, 90, 299]) {
    const a = run(frame, PREVIEW), b = run(frame, EXPORT_4K);
    a.forEach((e, i) => { assert.ok(Math.abs(norm(e.x, PREVIEW) - norm(b[i].x, EXPORT_4K)) < 1e-9, `${e.op} x`); assert.ok(Math.abs(norm(e.w, PREVIEW) - norm(b[i].w, EXPORT_4K)) < 1e-9, `${e.op} w`); });
  }
});

test('lineWidth scales exactly with pixelW', () => {
  const a = at(run(90, PREVIEW), OUTLINE), b = at(run(90, EXPORT_4K), OUTLINE);
  assert.equal(a.op, 'strokeRect');
  assert.ok(Math.abs(norm(a.lineWidthPx, PREVIEW) - norm(b.lineWidthPx, EXPORT_4K)) < 1e-9);
});

const gap = 'runtime gap: shadow/filter lengths are device pixels and are not multiplied by the logical->device scale (preview 640 px looks ~3x too soft, 4K ~2x too crisp vs 1920 design). Fix belongs in the shared Gefoot runtime: scale shadowBlur/shadowOffset/filter by ctx.__scale.';
test('shadowBlur scales with pixelW', { todo: gap }, () => {
  const a = at(run(90, PREVIEW), CARD), b = at(run(90, EXPORT_4K), CARD);
  assert.equal(a.shadowBlurPx > 0 && b.shadowBlurPx > 0, true);
  assert.ok(Math.abs(norm(a.shadowBlurPx, PREVIEW) - norm(b.shadowBlurPx, EXPORT_4K)) < 1e-9, `blur/pixelW ${norm(a.shadowBlurPx, PREVIEW)} vs ${norm(b.shadowBlurPx, EXPORT_4K)}`);
});
test('shadowOffset scales with pixelW', { todo: gap }, () => {
  const a = at(run(90, PREVIEW), CARD), b = at(run(90, EXPORT_4K), CARD);
  assert.ok(Math.abs(norm(a.shadowOffsetYPx, PREVIEW) - norm(b.shadowOffsetYPx, EXPORT_4K)) < 1e-9);
});
test('filter blur radius scales with pixelW', { todo: gap }, () => {
  const a = at(run(90, PREVIEW), GLOW), b = at(run(90, EXPORT_4K), GLOW);
  assert.equal(a.filterPx > 0, true);
  assert.ok(Math.abs(norm(a.filterPx, PREVIEW) - norm(b.filterPx, EXPORT_4K)) < 1e-9);
});
