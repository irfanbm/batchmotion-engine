import assert from 'node:assert/strict';
import { blueprintQualityGate, blueprintSchema, blueprintToCoderBrief, normalizeBlueprint } from './blueprint';
import { saltedSeed, installSalt } from './seed';

const valid: Record<string, unknown> = {
  concept: 'A gold coin lands on a platform and triggers a rising growth chart',
  commercialIntent: 'Finance / investment growth footage',
  visualMetaphor: 'Capital injection drives market growth',
  visualHook: 'Coin impact compresses the platform and launches the chart upward',
  signatureMotion: 'Coin drops, platform compresses on impact, chart springs up in reaction',
  visualPayoff: 'The coin settles as the chart reaches its peak, linking investment to growth',
  style: 'Premium flat 3D with metallic treatment',
  palette: { base: '#0b1f17', primary: '#c9a227', secondary: '#7be3a1', accent: '#12a150' },
  heroObjectId: 'coin',
  objects: [
    { id: 'coin', role: 'hero', shape: '3-layer rim coin', details: ['recessed center face', 'embossed currency symbol', 'darker side wall', 'upper-left highlight arc'], material: { name: 'metallic', construction: 'darker edge, lighter face, rim highlight, controlled reflection' }, rect: { x: 0.4, y: 0.1, w: 0.2, h: 0.28 }, zIndex: 3, opacity: 1, functionalRole: 'the capital being injected' },
    { id: 'platform', role: 'interaction', shape: 'rounded rectangular platform', details: ['beveled top edge'], material: { name: 'matte', construction: 'solid fill, minimal shadow, clean edge' }, rect: { x: 0.3, y: 0.6, w: 0.4, h: 0.1 }, zIndex: 2, opacity: 1, functionalRole: 'receives the coin impact' },
    { id: 'chart', role: 'support', shape: 'rising bar chart', details: ['four ascending bars'], material: { name: 'glossy', construction: 'specular streak, soft reflection' }, rect: { x: 0.62, y: 0.3, w: 0.25, h: 0.3 }, zIndex: 1, opacity: 1, functionalRole: 'visualizes the resulting growth' },
  ],
  composition: [],
  choreography: [
    { from: 0, to: 0.9, objectId: 'coin', property: 'translate', fromValue: 'Y:0.1', toValue: 'Y:0.55', trajectory: 'cubic-bezier fall', easing: 'ease-in', physical: 'gravity acceleration' },
    { from: 0.9, to: 1.1, objectId: 'platform', property: 'scale-y', fromValue: '1', toValue: '0.94', easing: 'ease-out', trigger: 'coin impact', reaction: 'platform compresses' },
    { from: 1.0, to: 2.2, objectId: 'chart', property: 'scale-y', fromValue: '0', toValue: '1', easing: 'spring', trigger: 'platform compression', reaction: 'chart springs up', physical: 'overshoot 3%, settle 0.2s' },
    { from: 2.6, to: 5.6, objectId: 'coin', property: 'rotate', fromValue: '0 deg', toValue: '360 deg', easing: 'ease-in-out', trigger: 'chart peak', reaction: 'coin settles facing forward' },
  ],
  loop: { durationSec: 6, fps: 30, returnMechanism: 'chart and coin ease back to initial state via the second half of the cycle' },
  background: 'deep green studio with soft vignette',
  microMotion: [],
  avoid: ['text', 'logos'],
};
const fixtureObjects = valid.objects as Record<string, unknown>[];
fixtureObjects[0].geometry = {
  silhouette: 'Closed circular coin face with uninterrupted filled interior', aspectRatio: 1,
  parts: [
    { name: 'rim', rect: { x: 0, y: 0, w: 1, h: 1 } },
    { name: 'face', rect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } },
    { name: 'symbol', rect: { x: 0.35, y: 0.3, w: 0.3, h: 0.4 } },
  ], attachment: 'Face shares the center of the rim; both move as a rigid assembly',
};
(valid.choreography as Record<string, unknown>[])[2].easingSpec = 'damped response, 3% overshoot, 0.2s settle';
valid.composition = valid.objects;

const bp = blueprintSchema.parse(valid);
assert.equal(blueprintQualityGate(bp).length, 0, 'a complete blueprint passes the gate');

// hero with too few details fails
const thin = JSON.parse(JSON.stringify(valid));
thin.objects[0].details = ['one detail'];
assert.ok(blueprintQualityGate(blueprintSchema.parse(thin)).some((x) => x.includes('concrete details')));

// generic signature motion fails
const gen = JSON.parse(JSON.stringify(valid));
gen.signatureMotion = 'float';
assert.ok(blueprintQualityGate(blueprintSchema.parse(gen)).some((x) => x.includes('generic transform')));

// no relationship fails
const norel = JSON.parse(JSON.stringify(valid));
norel.choreography = norel.choreography.map((s: Record<string, unknown>) => ({ ...s, trigger: undefined, reaction: undefined }));
assert.ok(blueprintQualityGate(blueprintSchema.parse(norel)).some((x) => x.includes('relationship')));

// motion coverage: dead segments, a hero frozen at the midpoint, and a frozen tail all fail
const dead = JSON.parse(JSON.stringify(valid));
dead.choreography[3].toValue = dead.choreography[3].fromValue;
assert.ok(blueprintQualityGate(blueprintSchema.parse(dead)).some((x) => x.includes('identical start and end')));
const frozenHero = JSON.parse(JSON.stringify(valid));
frozenHero.choreography = frozenHero.choreography.filter((s: Record<string, unknown>) => s.property !== 'rotate');
assert.ok(blueprintQualityGate(blueprintSchema.parse(frozenHero)).some((x) => x.includes('past the midpoint')));
const frozenTail = JSON.parse(JSON.stringify(valid));
frozenTail.choreography[3].to = 4.2;
assert.ok(blueprintQualityGate(blueprintSchema.parse(frozenTail)).some((x) => x.includes('final quarter')));
assert.ok(!blueprintQualityGate(blueprintSchema.parse(frozenTail)).some((x) => x.includes('past the midpoint')), 'hero still active past midpoint');

// brief builder includes the key sections
const brief = blueprintToCoderBrief(bp);
assert.match(brief, /CONCEPT:/);
assert.match(brief, /CHOREOGRAPHY/);
assert.match(brief, /LOOP MATH/);
assert.match(brief, /#coin/);

// salted seed: same base + different salt differs; same inputs identical
assert.notEqual(saltedSeed(1000, 111), saltedSeed(1000, 222));
assert.equal(saltedSeed(1000, 111), saltedSeed(1000, 111));
assert.equal(typeof installSalt(), 'number');

// Representation differences are normalized; missing design decisions are not invented.
const messy = JSON.parse(JSON.stringify(valid));
messy.palette.base = { hex: '#0a0a1a' };
messy.objects[0].role = 'main subject';
messy.objects[0].material = 'metallic glossy hull';
messy.composition = [{ id: 'coin', rect: { x: 0.35, y: 0.15, w: 0.2, h: 0.28 } }];
messy.choreography[0].easing = 'ease-out cubic';
const norm = normalizeBlueprint(messy, { durationSec: 6, fps: 30 });
assert.equal(norm.palette.base, '#0a0a1a', 'nested palette hex coerced to string');
assert.equal(norm.objects[0].role, 'hero', 'role synonym "main subject" maps to hero');
assert.equal(norm.objects[0].material.name, 'metallic', 'material string maps to enum');
assert.equal(norm.composition[0].rect.x, 0.35);
assert.equal(norm.composition[0].shape, fixtureObjects[0].shape, 'placement rows preserve construction');
assert.equal(norm.composition.length, 3, 'placement rows do not discard other objects');
assert.equal(norm.choreography[0].easing, 'ease-out', 'easing string normalized');
assert.doesNotThrow(() => blueprintSchema.parse(norm), 'normalized output is schema-valid');
assert.throws(() => normalizeBlueprint({}, { durationSec: 5, fps: 30 }));
const incomplete = JSON.parse(JSON.stringify(valid));
delete incomplete.objects[0].rect;
incomplete.composition = [];
assert.throws(() => normalizeBlueprint(incomplete, { durationSec: 6, fps: 30 }), 'missing bounds must be repaired, not defaulted');
const noGeometry = blueprintSchema.parse(valid);
delete noGeometry.objects[0].geometry;
assert.match(blueprintQualityGate(noGeometry).join(';'), /hero geometry/);
const wrongTarget = blueprintSchema.parse(valid);
wrongTarget.choreography[0].objectId = 'nonexistent';
wrongTarget.choreography[0].to = 9;
assert.match(blueprintQualityGate(wrongTarget).join(';'), /unknown object/);
assert.match(blueprintQualityGate(wrongTarget).join(';'), /invalid motion interval/);
const finite = normalizeBlueprint(valid, { durationSec: 8, fps: 60, looping: false });
assert.equal(finite.loop.enabled, false);
assert.equal(finite.loop.durationSec, 8);
assert.match(blueprintToCoderBrief(finite), /FINITE clip/);
assert.match(brief, /GEOMETRY LOCK/);
console.log('blueprint checks passed');
