import assert from 'node:assert/strict';
import { checkAiProvider, formatPromptBrief, parseAiJson, professionalContract, providerUnavailable, resolveAiModel, safeProviderMessage, timingContract, transientAiStatus } from './ai';

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
