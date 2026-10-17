import assert from 'node:assert/strict';
import test from 'node:test';
import { gefootHtml, gefootRuntime, makeAlphaRuntime } from './gefoot-runtime';

const scene = 'function setup(env){return {};}\nfunction draw(ctx,t,env){ctx.fillRect(0,0,10,10);}';

test('opaque page keeps the explicit black pre-fill and declares itself opaque', () => {
  const html = gefootHtml(scene, 10, 30, 1, false);
  assert.match(html, /ctx\.fillStyle = '#000';\s*ctx\.fillRect\(0, 0, BASE_W, BASE_H\);/);
  assert.match(html, /__MOTIONFORGE_ALPHA__=false/);
});

test('alpha page clears instead of painting black and declares itself alpha', () => {
  const html = gefootHtml(scene, 10, 30, 1, true);
  assert.ok(!/ctx\.fillStyle = '#000';\s*ctx\.fillRect\(0, 0, BASE_W, BASE_H\);/.test(html), 'no opaque pre-fill left in the runtime');
  assert.match(html, /ctx\.clearRect\(0, 0, BASE_W, BASE_H\);/);
  assert.match(html, /__MOTIONFORGE_ALPHA__=true/);
  assert.match(html, /background:transparent/);
});

test('alpha conversion survives CRLF line endings (Windows checkouts)', () => {
  const crlf = gefootRuntime.replace(/\r?\n/g, '\r\n');
  const out = makeAlphaRuntime(crlf);
  assert.ok(out.includes('ctx.clearRect(0, 0, BASE_W, BASE_H);'));
  assert.ok(!/ctx\.fillStyle\s*=\s*'#000'/.test(out));
});

test('alpha conversion fails loudly instead of shipping an opaque "alpha" page', () => {
  assert.throws(() => makeAlphaRuntime('function compileScene(){}'), /pre-fill not found/);
});
