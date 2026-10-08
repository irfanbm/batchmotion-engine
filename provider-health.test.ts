import assert from 'node:assert/strict';
import { checkAiProvider } from './ai';
import type { Settings } from './types';

const settings = { baseUrl: 'https://provider.invalid/v1', apiKey: 'k', model: 'm' } as Settings;
const bodies: string[] = [];
const respond = (status: number, body = '{}') => (async (_u: unknown, init?: RequestInit) => {
  bodies.push(String(init?.body));
  return new Response(body, { status });
}) as unknown as typeof fetch;

void (async () => {
  // A health probe must not send generation-shaping params that gateways reject.
  await checkAiProvider(settings, 5000, respond(200));
  const probe = JSON.parse(bodies[0]);
  assert.equal(probe.max_tokens, undefined, 'probe must not send max_tokens');
  assert.equal(probe.max_output_tokens, undefined);
  assert.equal(probe.temperature, undefined);

  // A 4xx rejection still proves the provider answered: reachable, not "unavailable".
  assert.equal(await checkAiProvider(settings, 5000, respond(400, JSON.stringify({ error: { message: 'max_output_tokens too small' } }))), true);
  assert.equal(await checkAiProvider(settings, 5000, respond(404)), true);

  // Real outages, rate limits and auth failures still fail the probe.
  await assert.rejects(() => checkAiProvider(settings, 5000, respond(502)), /502/);
  await assert.rejects(() => checkAiProvider(settings, 5000, respond(429)), /429/);
  await assert.rejects(() => checkAiProvider(settings, 5000, respond(401)), /authentication/);
  console.log('provider health checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
