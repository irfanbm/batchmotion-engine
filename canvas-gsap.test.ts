import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureGsapRuntime, hasGsapRuntime, isCanvasHtml } from './gsap-runtime';
import { gefootHtml } from './gefoot-runtime';
import { injectVirtualClock } from './virtual-clock';

const scene = 'function setup(env){return {};}\nfunction draw(ctx,t,env){ctx.fillRect(0,0,10,10);}';
const legacy = '<!DOCTYPE html><html><head><style>body{}</style></head><body><script>window.__MOTIONFORGE_READY__=true;</script></body></html>';

test('Canvas page is recognised, legacy page is not', () => {
  assert.equal(isCanvasHtml(gefootHtml(scene, 10, 30, 1, false)), true);
  assert.equal(isCanvasHtml(legacy), false);
});

test('Canvas page never receives GSAP (preview, render and quality-repair callers share ensureGsapRuntime)', () => {
  const html = gefootHtml(scene, 10, 30, 1, false);
  const out = ensureGsapRuntime(html);
  assert.equal(hasGsapRuntime(out), false);
  assert.equal(out, html, 'Canvas html is returned byte-identical');
  assert.equal(hasGsapRuntime(ensureGsapRuntime(injectVirtualClock(html))), false);
});

test('a previously injected GSAP copy is stripped from a saved Canvas project', () => {
  const html = gefootHtml(scene, 10, 30, 1, false);
  const polluted = html.replace('<head>', '<head><script id="batchmotion-gsap">/*batchmotion:gsap*/fake</script>');
  assert.equal(hasGsapRuntime(polluted), true);
  assert.equal(ensureGsapRuntime(polluted), html);
});

test('legacy HTML/GSAP pipeline is unchanged', () => {
  const out = ensureGsapRuntime(legacy);
  assert.equal(hasGsapRuntime(out), true);
  assert.equal(ensureGsapRuntime(out), out, 'still idempotent');
});

// ---- Regression: Canvas HTML read back from disk must never contain GSAP, on any engine path --------------------
// Evidence for this test: a Windows-saved Canvas project carried <script id="batchmotion-gsap"> (73 KB) because
// ensureGsapRuntime() ran on it. These checks read real files and run the exact compositions used by
// preview (queue.ts: injectVirtualClock(ensureGsapRuntime(html))) and render (render.ts, same composition).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const vendored = readFileSync(path.join(__dirname, '..', 'resources', 'gsap.min.js'), 'utf8');
const GSAP_MARKERS: [string, RegExp][] = [
  ['script id', /id=["']batchmotion-gsap["']/],
  ['host comment', /batchmotion:gsap/],
  ['bundle banner', /GSAP\s+3\.\d+/],
  ['bundle API', /gsap\.registerPlugin|_gsScope|gsap\.core|CSSPlugin/],
];
const gsapMarkersIn = (html: string) => GSAP_MARKERS.filter(([, re]) => re.test(html)).map(([name]) => name);
const withTmp = <T>(fn: (dir: string) => T): T => { const dir = mkdtempSync(path.join(tmpdir(), 'bm-canvas-')); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };
const previewComposition = (html: string) => injectVirtualClock(ensureGsapRuntime(html)); // queue.ts:76 / render.ts:454

test('detector is not vacuous: it finds GSAP in the vendored bundle and in a legacy page', () => {
  assert.deepEqual(gsapMarkersIn(vendored.slice(0, 20000)).includes('bundle banner'), true);
  assert.equal(gsapMarkersIn(ensureGsapRuntime(legacy)).length, GSAP_MARKERS.length, 'legacy page trips every marker');
});

test('fresh Canvas page read from disk: no GSAP before or after the preview/render compositions', () => withTmp((dir) => {
  const file = path.join(dir, 'project.html');
  writeFileSync(file, gefootHtml(scene, 10, 30, 1, false));
  const html = readFileSync(file, 'utf8');
  assert.deepEqual(gsapMarkersIn(html), []);
  assert.deepEqual(gsapMarkersIn(previewComposition(html)), []);
  assert.ok(previewComposition(html).length < 60_000, 'no 73 KB bundle');
}));

test('old saved Canvas project (GSAP injected by an earlier engine, LF or Windows CRLF) is cleaned when reopened', () => withTmp((dir) => {
  const injected = ensureGsapRuntime(legacy).match(/<script id="batchmotion-gsap">[\s\S]*?<\/script>/)![0]; // the real 73 KB block
  const clean = gefootHtml(scene, 10, 30, 1, false);
  for (const [name, text] of [['LF', clean], ['CRLF', clean.replace(/\n/g, '\r\n')]] as const) {
    const polluted = text.replace('<head>', `<head>${injected}`);
    const file = path.join(dir, `old-${name}.html`);
    writeFileSync(file, polluted);
    const reopened = readFileSync(file, 'utf8');
    assert.ok(gsapMarkersIn(reopened).length >= 3, `${name}: fixture really carries GSAP`);
    assert.deepEqual(gsapMarkersIn(previewComposition(reopened)), [], `${name}: preview/render path`);
    assert.equal(ensureGsapRuntime(reopened), text, `${name}: reopened page equals the clean page byte for byte`);
  }
}));

test('legacy HTML/GSAP pages still get exactly one GSAP injection through the same compositions', () => {
  const out = previewComposition(legacy);
  assert.equal((out.match(/id="batchmotion-gsap"/g) ?? []).length, 1);
  assert.equal(gsapMarkersIn(out).length, GSAP_MARKERS.length);
});
