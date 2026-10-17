import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasHtml } from './canvas-scene';
import { captureCanvasFrames, type CanvasFrameReply } from './canvas-capture';

// The host must read the pixels of the frame it asked for. These tests pin that contract at two levels:
// (1) the real page script: __MOTIONFORGE_CAPTURE_FRAME__(i) draws scene frame i synchronously, then reads the canvas;
// (2) the host loop: it rejects a stale frame 0, a one-frame lag, and a sequence whose last frame is never captured.

const SCENE = `// TITLE: t\n// DURATION: 10\nfunction setup(env){return {}}\nfunction draw(ctx,t,env){ctx.fillRect(Math.round(t*30),0,1,1);}`;

function loadPage(fps = 30) {
  const html = canvasHtml(SCENE, fps, 7, false, 10);
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const seen: number[] = [];
  const painted: number[] = [];
  class FakeCtx {
    setTransform() {} getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; } resetTransform() {} save() {} restore() {} clearRect() {} scale() {} translate() {} beginPath() {}
    fillRect(x: number, _y: number, w: number, h: number) { if (w === 1 && h === 1) seen.push(x); }
  }
  const ctx: any = new FakeCtx();
  const canvas: any = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => `data:image/png;base64,${Buffer.from(String(seen[seen.length - 1])).toString('base64')}` };
  const win: any = { addEventListener() {}, dispatchEvent() {} };
  const doc: any = { querySelector: () => canvas };
  new Function('window', 'document', 'innerWidth', 'Event', 'performance', 'requestAnimationFrame', 'Path2D', 'OffscreenCanvas', script)(win, doc, 320, class {}, { now: () => 0 }, () => 0, class {}, undefined);
  return { win, seen, painted, canvas };
}

test('page capture hook draws exactly the requested frame (0, 1, stage boundaries, 299)', () => {
  const { win, seen, canvas } = loadPage();
  assert.equal(typeof win.__MOTIONFORGE_CAPTURE_FRAME__, 'function');
  for (const f of [0, 1, 43, 86, 129, 172, 215, 258, 298, 299]) {
    const r = win.__MOTIONFORGE_CAPTURE_FRAME__(f);
    assert.equal(r.frame, f, `frame ${f}`);
    assert.equal(seen[seen.length - 1], f, `last draw is frame ${f}`);
    assert.equal(Buffer.from(r.png.split(',')[1], 'base64').toString(), String(f), `pixels come from draw ${f}`);
  }
  assert.equal(canvas.width, 320);
});

test('page capture hook never serves a previous frame when called out of order', () => {
  const { win } = loadPage();
  win.__MOTIONFORGE_CAPTURE_FRAME__(299);
  assert.equal(win.__MOTIONFORGE_CAPTURE_FRAME__(0).frame, 0, 'frame 0 after the last frame is frame 0, not stale 299');
});

const png = (n: number) => `data:image/png;base64,${Buffer.from(String(n)).toString('base64')}`;
const run = (source: (f: number) => Promise<CanvasFrameReply>, count = 300) => captureCanvasFrames(count, source, async () => {});

test('host loop: exact 1:1 mapping over 300 frames incl. last frame 299', async () => {
  const map = await run(async f => ({ frame: f, png: png(f) }));
  assert.equal(map.length, 300);
  assert.equal(map[0], 0); assert.equal(map[1], 1); assert.equal(map[299], 299);
  assert.ok(map.every((v, i) => v === i));
});

test('host loop detects a stale frame 0 (shows the final frame)', async () => {
  await assert.rejects(run(async f => ({ frame: f === 0 ? 299 : f, png: png(f) })), /requested scene frame 0 but the page drew frame 299/);
});

test('host loop detects output lagging one frame behind', async () => {
  await assert.rejects(run(async f => ({ frame: Math.max(0, f - 1), png: png(f) })), /requested scene frame 1 but the page drew frame 0/);
});

test('host loop detects a last frame that is never captured', async () => {
  await assert.rejects(run(async f => ({ frame: Math.min(f, 298), png: png(f) })), /requested scene frame 299 but the page drew frame 298/);
  await assert.rejects(captureCanvasFrames(299, async f => ({ frame: f, png: png(f) }), async () => {}).then(m => { if (m.length !== 300) throw new Error('last frame 299 never captured'); }), /never captured/);
});

test('host loop rejects non-PNG replies and honours stop', async () => {
  await assert.rejects(run(async f => ({ frame: f, png: 'data:image/jpeg;base64,AAAA' }), 2), /PNG data URL/);
  await assert.rejects(captureCanvasFrames(5, async f => ({ frame: f, png: png(f) }), async () => {}, () => true), /stopped/);
});

test('canvas capture/pop log lines survive the queue log filter', async () => {
  const { readFileSync } = await import('node:fs');
  const queue = readFileSync(require.resolve('./queue').replace(/queue\.js$/, 'queue.js'), 'utf8');
  const render = readFileSync(require.resolve('./render'), 'utf8');
  assert.match(queue, /\^Canvas capture:/);
  assert.match(render, /visualWarning\(`Visual preflight warning: \[canvas warning\] pop:/);
});
