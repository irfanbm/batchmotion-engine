import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildIconQueries, injectIconAssets, queryMatchesIcon, resolveIconAssets, type IconAsset } from './icon-source';
import { shapeTokens, validateHtml } from './validation';
import { blueprintSchema } from './blueprint';

// buildIconQueries: object id first, then the shape clause, then shorter tails.
{
  const q = buildIconQueries({ id: 'coin', shape: '3-layer rim coin: outer ring, recessed face' });
  assert.deepEqual(q, ['coin', 'rim coin']);
  const b = buildIconQueries({ id: 'perfume-bottle', shape: 'Bottle with cap, tall proportions' });
  assert.equal(b[0], 'perfume bottle');
  assert.ok(b.includes('bottle cap') && b.includes('bottle'), 'clause and id-tail fallbacks present');
  assert.ok(buildIconQueries({ id: 'shopping-cart', shape: ':' }).includes('shopping cart'));
}

// Whole-token matching: substring hits like "soft" in micro-soft are rejected,
// while suffix growth ("coins" for query "coin") still counts.
{
  assert.equal(queryMatchesIcon('tabler:brand-microsoft-teams', 'soft'), false);
  assert.equal(queryMatchesIcon('lucide:shopping-cart', 'shopping cart'), true);
  assert.equal(queryMatchesIcon('lucide:coins', 'coin'), true);
  assert.equal(queryMatchesIcon('lucide:circle-dollar-sign', 'coin'), false);
}

// Fake Iconify: a plausible result set for any query. The overlap filter must
// keep the unrelated glyph (circle-dollar-sign) and the filled variant out.
const searchPayload = { icons: ['lucide:coin', 'lucide:coins', 'lucide:circle-dollar-sign', 'tabler:coin-filled'] };
const svgCoin = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M3 3h2l1 2"/><circle cx="9" cy="20" r="1.5"/></svg>';
const fakeFetcher = async (url: string) => {
  if (url.includes('/search')) return { ok: true, status: 200, text: async () => JSON.stringify(searchPayload) };
  if (/\/lucide\/coins?\.svg$/.test(url)) return { ok: true, status: 200, text: async () => svgCoin };
  return { ok: false, status: 404, text: async () => '' };
};

const bp = blueprintSchema.parse({
  concept: 'coin roll', commercialIntent: 'sale visual', visualMetaphor: 'coin as value', visualHook: 'coin spin', signatureMotion: 'coin flips onto stack', visualPayoff: 'coin settles',
  style: 'flat', palette: { base: '#111111', primary: '#222222', secondary: '#333333', accent: '#444444' },
  heroObjectId: 'coin',
  objects: [
    { id: 'coin', role: 'hero', shape: '3-layer rim coin: outer ring', details: ['d', 'e', 'f'], material: { name: 'metallic', construction: 'darker edge lighter face' }, rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, functionalRole: 'value', geometry: { silhouette: 'circular coin outline', aspectRatio: 1, parts: [{ name: 'rim', rect: { x: 0, y: 0, w: 1, h: 1 } }, { name: 'face', rect: { x: 0, y: 0, w: 1, h: 1 } }], attachment: 'rim around face' } },
    { id: 'floor-shadow', role: 'support', shape: 'soft ellipse under the coin', details: ['d'], material: { name: 'matte', construction: 'gradient falloff' }, rect: { x: 0.3, y: 0.7, w: 0.4, h: 0.1 }, functionalRole: 'contact', geometry: { silhouette: 'flat ellipse', aspectRatio: 4, parts: [{ name: 'core', rect: { x: 0, y: 0, w: 1, h: 1 } }, { name: 'edge', rect: { x: 0, y: 0, w: 1, h: 1 } }], attachment: 'grounded below' } },
  ],
  composition: [{ id: 'coin', role: 'hero', shape: '3-layer rim coin: outer ring', details: ['d', 'e', 'f'], material: { name: 'metallic', construction: 'darker edge lighter face' }, rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, functionalRole: 'value' }],
  choreography: [{ from: 0, to: 1, objectId: 'coin', property: 'translate', fromValue: 'Y:0.1', toValue: 'Y:0.5', easing: 'ease-out' }],
  loop: { durationSec: 4, fps: 30, enabled: false, returnMechanism: 'reverse' },
  background: 'dark field',
});

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'icon-ledger-'));
  const ledgerPath = path.join(tmp, 'icon-usage.json');

  const assets = await resolveIconAssets(bp, { ledgerPath, seed: 7, fetcher: fakeFetcher });
  assert.equal(assets.length, 1, 'one glyph-shaped object resolves one asset; atmosphere objects are skipped');
  assert.ok(!assets.some((a) => a.objectId === 'floor-shadow'), 'shadow objects never source a glyph');
  assert.equal(assets[0].set, 'lucide');
  assert.match(assets[0].name, /^coins?$/, 'overlap filter keeps only name-matching glyphs');
  assert.equal(assets[0].license, 'ISC');
  assert.equal(assets[0].viewBox, '0 0 24 24');
  assert.ok(assets[0].inner.includes('<path'), 'inner shapes extracted without the svg wrapper');
  const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
  assert.deepEqual(ledger, [`lucide:${assets[0].name}`], 'ledger records the used id');

  // Second run excludes the used id and picks its fresh sibling.
  const assets2 = await resolveIconAssets(bp, { ledgerPath, seed: 7, fetcher: fakeFetcher });
  assert.equal(assets2.length, 1, 'a fresh icon is picked on the next run');
  assert.notEqual(`${assets2[0].set}:${assets2[0].name}`, `lucide:${assets[0].name}`, 'previously worked icons are never picked again');
  const ledger2 = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
  assert.equal(ledger2.length, 2, 'ledger accumulates one id per resolved asset');

  // Host injection: marker carries the geometry verbatim and a forced viewBox.
  const icon: IconAsset = assets[0];
  const markerId = `${icon.set}:${icon.name}`;
  const marker = `<div id="coin"><svg data-bm-icon="${markerId}" viewBox="0 0 1 1"></svg></div>`;
  const doc = `<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body>${marker}<script>window.__MOTIONFORGE_OBJECTS__=[];window.__MOTIONFORGE_READY__=true</script></body></html>`;
  const injected = injectIconAssets(doc, [icon]);
  assert.ok(injected.includes('M3 3h2l1 2'), 'host splices the shapes in');
  assert.ok(injected.includes(`viewBox="${icon.viewBox}"`), 'marker viewBox forced to the asset');
  assert.deepEqual(validateHtml(injected, false, { iconAssets: [icon] }), [], 'injected marker passes integrity');

  // CSS styling hooks contain the same needle text and come first in the file;
  // injection must target the real marker and replace any model-drawn interior.
  const decoy = `<div id="coin"><svg data-bm-icon="${markerId}" viewBox="0 0 1 1"><path d="M0 0 model-drawn decoy"/></svg></div>`;
  const styledDoc = doc.replace(marker, `<style>svg[data-bm-icon="${markerId}"]{display:block}</style>${decoy}`);
  const injectedStyled = injectIconAssets(styledDoc, [icon]);
  assert.ok(injectedStyled.includes('M3 3h2l1 2'), 'real marker injected despite the CSS selector');
  assert.ok(!injectedStyled.includes('model-drawn decoy'), 'model-drawn interior replaced by the asset');
  assert.deepEqual(validateHtml(injectedStyled, false, { iconAssets: [icon] }), [], 'styled injection passes integrity');

  // Malformed markers are repaired host-side instead of burning a retry.
  const selfClosedDoc = doc.replace('"></svg>', '"/>');
  const injectedSelf = injectIconAssets(selfClosedDoc, [icon]);
  assert.ok(injectedSelf.includes('M3 3h2l1 2'), 'self-closed marker opened and filled');
  assert.ok(injectedSelf.includes(`<svg data-bm-icon="${markerId}" viewBox="${icon.viewBox}">`), 'repaired marker uses a paired opening tag');
  assert.deepEqual(validateHtml(injectedSelf, false, { iconAssets: [icon] }), [], 'repaired self-closed marker passes integrity');
  const unclosedDoc = doc.replace('</svg></div>', '</div>');
  const injectedUnclosed = injectIconAssets(unclosedDoc, [icon]);
  assert.ok(injectedUnclosed.includes('M3 3h2l1 2'), 'unclosed marker filled and closed');
  assert.deepEqual(validateHtml(injectedUnclosed, false, { iconAssets: [icon] }), [], 'repaired markers pass integrity');

  // Validation failure modes guide the repair prompt.
  assert.ok(validateHtml(doc, false, { iconAssets: [icon] }).some((e) => e.includes('no geometry')), 'un-injected marker fails');
  const noMarker = doc.replace(marker, '<div id="coin"></div>');
  assert.ok(validateHtml(noMarker, false, { iconAssets: [icon] }).some((e) => e.includes('marker missing')), 'absent marker fails');
  const selfClosed = doc.replace('"></svg>', '"/>');
  assert.ok(validateHtml(selfClosed, false, { iconAssets: [icon] }).some((e) => e.includes('paired')), 'self-closed marker fails');

  assert.ok(shapeTokens(svgCoin).some((t) => t.startsWith('circle;')), 'circle geometry tokenized');
  assert.ok(!shapeTokens(svgCoin).some((t) => t.includes('stroke')), 'styling is not part of the token');

  await fs.rm(tmp, { recursive: true, force: true });
  console.log('icon source checks passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
