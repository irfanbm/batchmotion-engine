import assert from 'node:assert/strict';
import { pendingTxtPrompts } from './txt';

assert.deepEqual(pendingTxtPrompts('first\n[ DONE ] second\n [done] third\nfourth'),['first','fourth']);
console.log('TXT import checks passed');
