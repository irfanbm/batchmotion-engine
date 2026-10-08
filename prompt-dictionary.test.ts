import assert from 'node:assert/strict';
import { DICTIONARY_CATEGORIES, DICTIONARY_CONFIDENCE_THRESHOLD, detectDictionaryMatches, formatDictionaryContext, pickDictionaryMatches, promptDictionary } from './prompt-dictionary';

const count = (category: string) => promptDictionary.filter((entry) => entry.category === category && !entry.fallback).length;
assert.equal(count('style'), 12, 'plan requires 12 style presets');
assert.equal(count('motion'), 8, 'plan requires 8 motion archetypes');
assert.equal(count('palette'), 8, 'plan requires 8 color palettes');
assert.equal(count('composition'), 6, 'plan requires 6 composition presets');
assert.equal(count('material'), 8, 'plan requires 8 material presets');
assert.equal(count('subject'), 12, 'plan requires 12 subject anatomy recipes');
for (const category of DICTIONARY_CATEGORIES) {
  assert.equal(promptDictionary.filter((entry) => entry.category === category && entry.fallback).length, 1, `exactly one fallback for ${category}`);
}

// detection: glassmorphism tokens must be recognized
const glass = detectDictionaryMatches('A frosted translucent glass panel reveal');
assert.ok(glass.some((match) => match.entry.id === 'style-glassmorphism'));
assert.equal(new Map(glass.map((match) => [match.entry.category, match])).size, glass.length, 'at most one match per category');

// scores are matched/total tokens
const glassMatch = glass.find((match) => match.entry.id === 'style-glassmorphism');
assert.ok(glassMatch && glassMatch.score >= DICTIONARY_CONFIDENCE_THRESHOLD);
assert.equal(glassMatch?.matchedTokens.length, 3);

// pick returns exactly one entry per category
const picked = pickDictionaryMatches('A frosted translucent glass product showcase reveal');
assert.equal(picked.length, DICTIONARY_CATEGORIES.length);
for (const category of DICTIONARY_CATEGORIES) assert.ok(picked.some((match) => match.entry.category === category));
assert.equal(picked.find((match) => match.entry.category === 'style')?.entry.id, 'style-glassmorphism');
assert.equal(picked.find((match) => match.entry.category === 'motion')?.entry.id, 'motion-product-showcase');
assert.equal(picked.find((match) => match.entry.category === 'palette')?.entry.fallback, true);

// unrelated text falls back to neutral entries everywhere
assert.ok(pickDictionaryMatches('zzzz qqqq xxx').every((match) => match.entry.fallback === true && match.score === 0));

// a single weak token stays below the confidence threshold -> fallback
assert.equal(pickDictionaryMatches('isometric').find((match) => match.entry.category === 'style')?.entry.fallback, true);

// formatting
const context = formatDictionaryContext(picked);
assert.match(context, /DICTIONARY ART DIRECTION:/);
for (const category of DICTIONARY_CATEGORIES) assert.ok(context.includes(category.toUpperCase()));
assert.equal(formatDictionaryContext([]), '');
console.log('prompt dictionary checks passed');
