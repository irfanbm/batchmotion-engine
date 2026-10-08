import assert from 'node:assert/strict';
import { assemblePrompt, beatsContract, detectAntiPatterns, geometryPreservationContract, helperPreamble, selfReviewChecklist, timelineContract } from './prompt-assembler';
import { pickDictionaryMatches } from './prompt-dictionary';

const task = assemblePrompt({
  userBrief: 'MAIN SUBJECT: glass product',
  dictionaryMatches: pickDictionaryMatches('A frosted translucent glass product showcase reveal'),
  duration: 6,
  looping: true,
  width: 2560,
  height: 1440,
  fps: 30,
  contracts: ['CONTRACT-A', 'CONTRACT-B'],
});

// block order: system role -> helper preamble -> dictionary -> brief -> contracts -> self-review
const order = [
  'Create one complete self-contained HTML',
  'DETERMINISTIC HELPER LIBRARY',
  'DICTIONARY ART DIRECTION',
  'Technical constraints',
  'MAIN SUBJECT: glass product',
  'CONTRACT-A',
  'CONTRACT-B',
  'STRICT TIMELINE CONTRACT',
  'BEATS TABLE',
  'GEOMETRY PRESERVATION',
  'SELF-REVIEW',
];
let last = -1;
for (const marker of order) {
  const index = task.indexOf(marker);
  assert.ok(index >= 0, `missing block: ${marker}`);
  assert.ok(index > last, `block out of order: ${marker}`);
  last = index;
}

// technical constraints carry the job parameters
assert.match(task, /2560 x 1440 px/);
assert.match(task, /Duration: 6 seconds/);
assert.match(task, /30 fps/);
assert.match(task, /t=0 must equal t=duration/);

// the fixed contract blocks are embedded verbatim
assert.ok(task.includes(helperPreamble));
assert.ok(task.includes(timelineContract));
assert.ok(task.includes(beatsContract));
assert.ok(task.includes(geometryPreservationContract));
assert.ok(task.includes(selfReviewChecklist));

// helper preamble provides the deterministic utilities and forbids Math.random
for (const helper of ['mulberry32', 'lerp', 'clamp', 'lerpColor', 'ease', 'beatProgress']) assert.ok(helperPreamble.includes(helper), helper);
assert.match(helperPreamble, /Never call Math\.random/);

// anti-pattern detection: vague words are flagged with suggestions
const vague = detectAntiPatterns('Buat animasi yang keren dan smooth dengan look modern');
assert.ok(vague.some((item) => item.term === 'keren'));
assert.ok(vague.some((item) => item.term === 'smooth'));
assert.ok(vague.some((item) => item.term === 'modern'));
assert.ok(vague.every((item) => item.suggestion.length > 0));
assert.deepEqual(detectAntiPatterns('A vending machine demonstration with bright cartoon shapes'), []);
// no false positives inside longer words
assert.deepEqual(detectAntiPatterns('glassmorphism cooling system smoothed edges'), []);
console.log('prompt assembler checks passed');
