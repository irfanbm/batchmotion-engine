import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasKit, gefootRuntime, withKit } from './gefoot-runtime';
import { canvasHtml } from './canvas-scene';

class StubPath2D { constructor(_d?: unknown) {} addPath() {} moveTo() {} lineTo() {} arc() {} ellipse() {} rect() {} roundRect() {} arcTo() {} quadraticCurveTo() {} bezierCurveTo() {} closePath() {} }

type Kit = Record<string, any>;
const kit = (): Kit => new Function('Path2D', `${canvasKit}\n;return MF;`)(StubPath2D);

test('MF ships no icon library and exposes only style/motion primitives', () => {
  const MF = kit();
  assert.equal(MF.icon, undefined);
  assert.equal(MF.badge, undefined);
  for (const name of ['card', 'rr', 'text', 'seg', 'stagger', 'track', 'spring', 'enter', 'camera', 'bar', 'ring', 'line']) assert.equal(typeof MF[name], 'function', name);
});

test('easings and timelines are deterministic and settle correctly', () => {
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

test('surface and motion helpers draw without throwing', () => {
  const MF = kit();
  const ctx = new Proxy({ globalAlpha: 1, lineWidth: 1, miterLimit: 10, shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none', lineJoin: 'round' } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : (...args: unknown[]) => k === 'measureText' ? { width: 10 * String(args[0]).length } : undefined),
    set: (o, k, v) => { o[k as string] = v; return true; },
  });
  MF.card(ctx, 10, 10, 400, 200);
  MF.bar(ctx, 20, 240, 300, 12, 0.6);
  MF.ring(ctx, 500, 300, 80, 0.75);
  MF.line(ctx, 10, 10, 100, 100, 0.5);
  MF.enter(ctx, 0.5, 960, 540, (c: unknown) => MF.text(c, 'Result', 0, 0));
});

test('a custom-object scene compiles through the real runtime', () => {
  const scene = `// TITLE: t\n// DURATION: 10\nfunction setup(env){return {}}\nfunction draw(ctx,t,env){const p=MF.seg(t,0,1);MF.card(ctx,100,100,400,300);MF.enter(ctx,p,300,250,c=>{c.fillStyle='#2563eb';c.fillRect(-60,-40,120,80)});}`;
  const { compileScene } = new Function('Path2D', 'OffscreenCanvas', `${gefootRuntime}\nreturn { compileScene };`)(StubPath2D, undefined) as { compileScene: (code: string, o: { duration: number; fps: number; seed: number }) => { totalFrames: number } };
  assert.equal(compileScene(withKit(scene), { duration: 10, fps: 30, seed: 1 }).totalFrames, 300);
  const prompt = canvasHtml(scene, 30, 1);
  assert.ok(prompt.includes('const MF = (() =>'), 'page ships the motion kit');
});
