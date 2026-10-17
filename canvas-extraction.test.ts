import assert from 'node:assert/strict';
import { extractJavaScript, validateCanvasCode } from './canvas-scene';

const code = `// TITLE: Office Desk
// KEYWORDS: ${Array.from({ length: 48 }, (_, i) => `keyword${i}`).join(', ')}
// CATEGORY: 19
// DURATION: 10
// LOOP: yes
function setup(env) { return {}; }
function draw(ctx, t, env) { ctx.fillRect(0, 0, 1920, 1080); }`;
for (const response of [code, `javascript\n${code}`, `javascript ${code}`, `js\r\n${code}`, `\uFEFFjavascript\n${code}`, `\x60\x60\x60javascript\n${code}\n\x60\x60\x60`, `\x60\x60\x60\njavascript\n${code}\n\x60\x60\x60`, `<script>javascript\n${code}</script>`]) {
  const extracted = extractJavaScript(response);
  assert.equal(extracted, code);
  assert.deepEqual(validateCanvasCode(extracted, 10), []);
  assert.equal(new Function(`${extracted}; return typeof draw;`)(), 'function');
}
for (const valid of ['const javascript = 1;', 'javascript();', 'javascript = 2;', '// javascript\nfunction draw() {}']) {
  assert.equal(extractJavaScript(valid), valid);
}
console.log('Canvas extraction regression checks passed');
