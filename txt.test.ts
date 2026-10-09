import assert from 'node:assert/strict';
import { pendingTxtPrompts } from './txt';

assert.deepEqual(pendingTxtPrompts('first\n[ DONE ] second\n [done] third\nfourth'),['first','fourth']);
assert.deepEqual(pendingTxtPrompts(''),[],'an empty file yields no prompts, never a phantom job');
assert.deepEqual(pendingTxtPrompts('[ DONE ] only\n'),[],'a fully-consumed file yields no prompts');
console.log('TXT import checks passed');
