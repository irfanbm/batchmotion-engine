import assert from 'node:assert/strict';
import { checkAiProvider, formatPromptBrief, listProviderModels, motionDirection, parseAiJson, professionalContract, providerUnavailable, resolveAiModel, safeProviderMessage, timingContract, transientAiStatus } from './ai';

assert.equal(transientAiStatus(502),true);
assert.equal(transientAiStatus(429),true);
assert.equal(transientAiStatus(401),false);
assert.deepEqual(parseAiJson('```json\n{"ok":true}\n```'),{ok:true});
assert.deepEqual(parseAiJson('{"a":1}{"a":1,"b":"two"}'),{a:1,b:'two'});
assert.deepEqual(parseAiJson('Here is the metadata: {"title":"x","keywords":["a","b"]} Hope this helps!'),{title:'x',keywords:['a','b']});
assert.deepEqual(parseAiJson('```json\n{"title":"x"}\n```\n{"title":"y","extra":true}'),{title:'y',extra:true});
assert.throws(()=>parseAiJson('not json at all'),SyntaxError);
assert.equal(providerUnavailable(new Error('AI provider unavailable (502).')),true);
assert.equal(providerUnavailable(new Error('Invalid API key.')),false);
assert.match(timingContract(true),/without reversal/i);
assert.match(timingContract(false),/seamless boundary is not required/i);
assert.match(formatPromptBrief('Sphere; stock background; centered; blue glass; slow orbit; calm depth; no text'),/^MAIN SUBJECT: Sphere\nSTYLE \/ USE CASE:/);
assert.equal(formatPromptBrief('Free prompt; with only two parts'),'Free prompt; with only two parts');
assert.equal(safeProviderMessage('{"error":{"message":"Unknown model"}}'),'Unknown model');
assert.equal(safeProviderMessage('{"message":"Bad payload"}'),'Bad payload');
assert.deepEqual(Object.keys(motionDirection).sort(),['auto','balanced','calm','dynamic','prompt']);
assert.match(motionDirection.auto,/choose the intensity that fits the subject/i,'auto commits to a fitting intensity');
void (async () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchOk = async () => ok({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'b-model' }, { id: '' }] });
  assert.deepEqual(await listProviderModels('https://x.test/v1', 'k', fetchOk as typeof fetch), ['a-model', 'b-model'], 'models dedupe and sort');
  await assert.rejects(() => listProviderModels('', 'k', fetchOk as typeof fetch), /Base URL is missing/);
  await assert.rejects(() => listProviderModels('https://x.test/v1', '  ', fetchOk as typeof fetch), /API key is missing/);
  await assert.rejects(
    () => listProviderModels('https://x.test/v1', 'k', (async () => ok({ error: { message: 'bad key' } }, 401)) as typeof fetch),
    /authentication failed/,
    'auth failures stay fatal and readable',
  );
  await assert.rejects(() => listProviderModels('https://x.test/v1', 'k', (async () => ok({ data: [] })) as typeof fetch), /no models/);
  await assert.rejects(() => listProviderModels('https://x.test/v1', 'k', (async () => { throw new TypeError('fetch failed'); }) as typeof fetch), /network check failed/);
  console.log('provider model list checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
