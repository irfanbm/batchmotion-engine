import assert from 'node:assert/strict';
import { parseAiJson } from './ai';

// Trailing commas and comments are common model output, not a reason to discard a blueprint.
assert.deepEqual(parseAiJson('{"a":1,"b":[1,2,],}'), { a: 1, b: [1, 2] });
assert.deepEqual(parseAiJson('{"a":1, // note\n "b":2}'), { a: 1, b: 2 });
assert.deepEqual(parseAiJson('{/* lead */ "a":1}'), { a: 1 });
assert.deepEqual(parseAiJson('{"a":1,\n/* block\nspanning */ "b":2,}'), { a: 1, b: 2 });

// Comment-like and comma-like sequences inside strings must survive untouched.
assert.deepEqual(parseAiJson('{"path":"M 0.5 0,0 // not a comment"}'), { path: 'M 0.5 0,0 // not a comment' });
assert.deepEqual(parseAiJson('{"css":"a /* keep */ b","trail":"x,"}'), { css: 'a /* keep */ b', trail: 'x,' });
assert.deepEqual(parseAiJson('{"esc":"quote \\" then // safe"}'), { esc: 'quote " then // safe' });

// Genuinely broken JSON still reports the original parser error.
assert.throws(() => parseAiJson('{"a":1 "b":2}'), SyntaxError);
assert.throws(() => parseAiJson('nothing here'), SyntaxError);
console.log('json recovery checks passed');
