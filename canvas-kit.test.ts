import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasKit, gefootRuntime, kitIconNames, withKit } from './gefoot-runtime';
import { canvasHtml } from './canvas-scene';

class StubPath2D { d: unknown; constructor(d?: unknown) { this.d = d; } addPath() {} moveTo() {} lineTo() {} arc() {} ellipse() {} rect() {} roundRect() {} arcTo() {} quadraticCurveTo() {} bezierCurveTo() {} closePath() {} }

type Kit = Record<string, any>;
const kit = (): Kit => new Function('Path2D', `${canvasKit}\n;return MF;`)(StubPath2D);

function recordingCtx() {
  const calls: string[] = [];
  const target: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1, miterLimit: 10, shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none', lineJoin: 'round' };
  const ctx = new Proxy(target, {
    get: (o, k) => (k in o ? o[k as string] : (...args: unknown[]) => { calls.push(String(k)); return k === 'measureText' ? { width: 10 * String(args[0]).length } : undefined; }),
    set: (o, k, v) => { o[k as string] = v; return true; },
  });
  return { ctx, calls };
}

test('kit exposes the icon set the prompt advertises', () => {
  assert.ok(kitIconNames.length >= 60, `icons: ${kitIconNames.length}`);
  for (const n of ['cart', 'card', 'box', 'truck', 'coin', 'user', 'lock', 'bell', 'barChart', 'phone', 'check', 'shieldCheck']) assert.ok(kitIconNames.includes(n), n);
});

test('easings start at 0 and land on 1', () => {
  const MF = kit();
  for (const [name, e] of Object.entries(MF.ease) as [string, (x: number) => number][]) {
    assert.ok(Math.abs(e(0)) < 1e-9, `${name}(0)`);
    assert.ok(Math.abs(e(1) - 1) < 1e-9, `${name}(1)`);
  }
  assert.equal(MF.seg(0, 1, 1), 0);
  assert.equal(MF.seg(5, 1, 1), 1);
  assert.equal(MF.track(0.5, [[0, 10], [1, 20, 'linear']]), 15);
  assert.ok(Math.abs(MF.spring(20) - 1) < 1e-3, 'spring settles at 1');
  assert.ok(Math.max(...Array.from({ length: 60 }, (_, i) => MF.spring(i / 30))) > 1, 'spring overshoots');
});

test('icon, badge, card and enter draw without throwing and respect progress', () => {
  const MF = kit();
  const { ctx, calls } = recordingCtx();
  for (const n of kitIconNames) MF.icon(ctx, n, 960, 540, 96);
  MF.icon(ctx, 'parcel', 100, 100, 64, { progress: 0.5 });
  MF.icon(ctx, 'not-a-real-icon', 100, 100, 64);
  MF.badge(ctx, 'cart', 300, 300, 120);
  MF.card(ctx, 10, 10, 400, 200);
  MF.enter(ctx, 0.5, 960, 540, (c: unknown) => MF.text(c, 'Pay', 0, 0, { tracking: 2 }));
  assert.ok(calls.filter((c) => c === 'stroke').length >= kitIconNames.length);
  assert.ok(calls.includes('setLineDash'), 'partial progress draws strokes on');
  const before = calls.length;
  MF.icon(ctx, 'cart', 0, 0, 96, { progress: 0 });
  MF.enter(ctx, 0, 0, 0, () => { throw new Error('must not draw before it enters'); });
  assert.equal(calls.length, before, 'nothing drawn at progress 0');
});

test('a scene that calls MF compiles and draws through the real runtime', () => {
  const scene = `// TITLE: t\n// DURATION: 10\nfunction setup(env){return {}}\nfunction draw(ctx,t,env){ctx.save();MF.camera(ctx,t,env.duration);MF.card(ctx,100,100,400,300);MF.badge(ctx,'truck',300,250,120,{progress:MF.seg(t,0,1)});ctx.restore();}`;
  const { compileScene } = new Function('Path2D', 'OffscreenCanvas', `${gefootRuntime}\nreturn { compileScene };`)(StubPath2D, undefined) as { compileScene: (code: string, o: { duration: number; fps: number; seed: number }) => { drawFrame: (ctx: unknown, i: number, w: number) => void; totalFrames: number } };
  const compiled = compileScene(withKit(scene), { duration: 10, fps: 30, seed: 1 });
  assert.equal(compiled.totalFrames, 300);
  assert.ok(canvasHtml(scene, 30, 1).includes('const MF = (() =>'), 'page ships the kit');
});
