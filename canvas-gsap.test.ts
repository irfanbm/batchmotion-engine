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
