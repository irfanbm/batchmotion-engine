import test from 'node:test';
import assert from 'node:assert/strict';
import { negotiateProviderParams, type GenParams } from './ai';
import { canvasLivenessReport } from './quality';
import { canvasBrief, hostCanvasDuration, validateCanvasCode } from './canvas-scene';
const base: GenParams = { temperature: 0.75, tokenKey: 'max_tokens', tokens: 32768 };
test('switches to max_completion_tokens', () => assert.equal(negotiateProviderParams(base, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.")?.tokenKey, 'max_completion_tokens'));
test('drops unsupported temperature', () => assert.equal(negotiateProviderParams(base, "Unsupported value: 'temperature' does not support 0.75. Only the default (1) value is supported.")?.temperature, undefined));
test('clamps to provider cap', () => assert.equal(negotiateProviderParams(base, 'max_tokens must be less than or equal to 8192, got 32768.')?.tokens, 8192));
test('ignores unrelated 400', () => assert.equal(negotiateProviderParams(base, 'invalid api key format'), null));
test('canvas brief ignores beautified prompt', () => assert.equal(canvasBrief({ prompt: 'beautified', originalPrompt: 'raw' }), 'raw'));
test('host duration is authoritative', () => { assert.equal(hostCanvasDuration(12), 12); assert.equal(hostCanvasDuration(7), 10); });
test('stray fence rejected', () => assert.ok(validateCanvasCode('function setup(env){}\nfunction draw(ctx,t,env){}\n```', 10).some(e => /fence/.test(e))));
test('liveness: blank and still', () => {
  const w = 64, h = 36, f = () => { const b = Buffer.alloc(w * h * 4, 240); return b; };
  const r = canvasLivenessReport([f(), f(), f()], w, h);
  assert.ok(r.blank && r.still);
  const moving = f(); for (let i = 0; i < 400; i += 4) { moving[i] = 10; }
  assert.equal(canvasLivenessReport([f(), moving, f()], w, h).still, false);
});
