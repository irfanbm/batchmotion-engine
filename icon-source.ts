import fs from 'node:fs/promises';
import path from 'node:path';
import type { Blueprint } from './blueprint';

// Fase 2a: object assets from licensed icon sets via the Iconify API. The coder
// animates given geometry instead of drawing it from imagination. Two rules:
// every job searches fresh and never repeats an id already worked (ledger of
// ids only), and the shapes themselves are injected by the host at emit time,
// never typed by the model (long path data gets paraphrased when copied).

export interface IconAsset {
  objectId: string;
  set: string;
  name: string;
  license: string;
  query: string;
  viewBox: string;
  inner: string;
}

export const ICON_SETS: Record<string, string> = {
  lucide: 'ISC',
  tabler: 'MIT',
  feather: 'MIT',
  heroicons: 'MIT',
  'material-symbols': 'Apache-2.0',
};

const API = 'https://api.iconify.design';
const MAX_ASSETS = 4;
const STOP_WORDS = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'with', 'and', 'or', 'for', 'to', 'its', 'their']);
// Filled/solid/disabled variants and brand marks: a promo cart must not become a
// "cart disabled" slash icon, and a shadow must never resolve to a company logo.
const VARIANT_EXCLUDE = /(^brand-|^remove-|-off$|-off-|-solid$|-\d+-solid$|-filled$|-fill$)/;
// Atmosphere/material objects are not glyph-shaped things: a shadow icon renders
// as a person pictogram, a light ribbon as a viewport glyph (both seen live).
// These objects keep the geometry-lock path instead.
const NOT_GLYPH = /(shadow|reflection|glow|sweep|ribbon|glint|flare|sheen|sparkle|bloom|vignette|grain|gradient|streak|halo|mist|haze|glare|beam)/;

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const defaultFetcher: Fetcher = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  return { ok: response.ok, status: response.status, text: () => response.text() };
};

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^\d/.test(w) && !STOP_WORDS.has(w));
}

// Progressive queries: object id first (it names the thing), then the shape
// clause, its tails, and the last id word. Degenerate single-word clause tails
// are dropped — they match arbitrary glyphs (a "tab" tail selected a clock).
export function buildIconQueries(obj: { id: string; shape: string }): string[] {
  const clause = obj.shape.split(/[:;,]/)[0];
  const words = significantWords(clause);
  const idWords = obj.id.toLowerCase().split(/[-_]+/).filter(Boolean);
  const candidates = [idWords, words.slice(0, 4), words.slice(-2), idWords.slice(-1)];
  const queries: string[] = [];
  for (const parts of candidates) {
    const query = parts.join(' ');
    if (query && !queries.includes(query)) queries.push(query);
  }
  return queries.length ? queries : [obj.id.replace(/[-_]+/g, ' ')];
}

function nameTokens(iconId: string): string[] {
  return iconId.slice(iconId.indexOf(':') + 1).split(/[-_]+/).filter(Boolean);
}

// A hit counts only when EVERY query word appears as a whole token of the icon
// name. Substring matching happily resolved "soft" to micro-soft and ranked a
// clock glyph for a promo badge.
export function queryMatchesIcon(iconId: string, query: string): boolean {
  const words = significantWords(query).filter((w) => w.length >= 3);
  if (!words.length) return false;
  const tokens = nameTokens(iconId);
  return words.every((w) => tokens.some((t) => t === w || t.startsWith(w) || w.startsWith(t)));
}

// All matched candidates carry every query word; prefer the name whose token
// count is closest to the query ("shopping-cart" over "add-shopping-cart").
function rankCandidates(ids: string[], query: string): string[] {
  const depth = significantWords(query).filter((w) => w.length >= 3).length;
  const scored = ids.map((id) => ({ id, dist: Math.abs(nameTokens(id).length - depth) }));
  const best = Math.min(...scored.map((s) => s.dist));
  return scored.filter((s) => s.dist === best).map((s) => s.id);
}

function pickIndex(seed: number, objectId: string, modulo: number): number {
  let h = (seed >>> 0) ^ 0x811c9dc5;
  for (const ch of objectId) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % modulo;
}

async function searchIcons(query: string, used: Set<string>, fetcher: Fetcher): Promise<string[]> {
  const url = `${API}/search?query=${encodeURIComponent(query)}&prefixes=${Object.keys(ICON_SETS).join(',')}&limit=30`;
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`icon search HTTP ${response.status}`);
  const data = JSON.parse(await response.text()) as { icons?: unknown };
  const icons = Array.isArray(data.icons) ? data.icons.filter((x): x is string => typeof x === 'string') : [];
  const fresh = icons.filter(
    (id) =>
      !VARIANT_EXCLUDE.test(id.slice(id.indexOf(':') + 1)) &&
      !used.has(id) &&
      queryMatchesIcon(id, query),
  );
  return rankCandidates(fresh, query);
}

let ledgerLock: Promise<unknown> = Promise.resolve();

async function loadLedger(ledgerPath: string): Promise<Set<string>> {
  try {
    const data = JSON.parse(await fs.readFile(ledgerPath, 'utf8'));
    return new Set(Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

async function appendLedger(ledgerPath: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const run = ledgerLock.then(async () => {
    const ledger = await loadLedger(ledgerPath);
    for (const id of ids) ledger.add(id);
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
    const temporary = `${ledgerPath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify([...ledger], null, 2), 'utf8');
    await fs.rm(ledgerPath, { force: true });
    await fs.rename(temporary, ledgerPath);
  });
  ledgerLock = run.catch(() => undefined);
  return run;
}

export async function resolveIconAssets(
  blueprint: Blueprint,
  options: { ledgerPath: string; seed: number; fetcher?: Fetcher },
): Promise<IconAsset[]> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const used = await loadLedger(options.ledgerPath);
  const assets: IconAsset[] = [];
  const targets = blueprint.objects.filter((o) => o.role !== 'background' && !NOT_GLYPH.test(o.id)).slice(0, MAX_ASSETS);
  for (const obj of targets) {
    try {
      for (const query of buildIconQueries(obj)) {
        const candidates = await searchIcons(query, used, fetcher);
        if (!candidates.length) continue;
        const pick = candidates[pickIndex(options.seed, obj.id, candidates.length)];
        const svgResponse = await fetcher(`${API}/${pick.replace(':', '/')}.svg`);
        if (!svgResponse.ok) throw new Error(`icon fetch HTTP ${svgResponse.status}`);
        const raw = (await svgResponse.text()).trim();
        const inner = raw.replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
        if (!/^<svg[\s>]/.test(raw) || !inner.trim() || raw.length > 50_000) throw new Error('fetched icon is not a compact SVG');
        const [set, name] = pick.split(':');
        assets.push({
          objectId: obj.id,
          set,
          name,
          license: ICON_SETS[set] ?? 'unknown',
          query,
          viewBox: raw.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24',
          inner,
        });
        used.add(pick);
        break;
      }
    } catch {
      // Offline/rate-limit/bad glyph: this object falls back to the existing
      // geometry-lock path. Icon sourcing must never fail a job.
      continue;
    }
  }
  await appendLedger(options.ledgerPath, assets.map((a) => `${a.set}:${a.name}`));
  return assets;
}

// Host-side injection: the model only emits an empty <svg data-bm-icon="set:name">
// marker; the shapes are spliced in here, verbatim by construction. The marker's
// viewBox is forced to the asset's so the geometry cannot be rescaled by edits.
// The model styles markers through CSS selectors (svg[data-bm-icon="..."]), which
// contain the same needle text: only occurrences actually inside an open <svg> tag
// are injection targets. Self-closed and unclosed markers are repaired on the fly.
export function injectIconAssets(html: string, assets?: IconAsset[]): string {
  if (!assets?.length) return html;
  // Models sometimes emit resolved asset markers as stray body-level SVGs even
  // when they already drew the requested subject with custom geometry. Those
  // glyphs become accidental extra objects in the final scene. Keep markers
  // only when they are nested in a scene element; direct body children are
  // reference artifacts and must not be rendered.
  let out = html.replace(/(>\s*)<svg\s+data-bm-icon="[^"]+"[^>]*>[\s\S]*?<\/svg>(?=\s*(?:<script|<\/body))/gi, '$1');
  for (const asset of assets) {
    const needle = `data-bm-icon="${asset.set}:${asset.name}"`;
    let at = -1;
    for (let search = 0; at < 0; ) {
      const found = out.indexOf(needle, search);
      if (found < 0) break;
      const open = out.lastIndexOf('<svg', found);
      if (open >= 0 && out.lastIndexOf('<', found) === open && out.indexOf('>', open) > found) at = found;
      else search = found + 1;
    }
    if (at < 0) continue;
    const open = out.lastIndexOf('<svg', at);
    const tagEnd = out.indexOf('>', at);
    if (tagEnd < 0) continue;
    const selfClosed = out[tagEnd - 1] === '/';
    const close = selfClosed ? -1 : out.indexOf('</svg>', tagEnd);
    let tag = out.slice(open, tagEnd + 1);
    tag = /\sviewBox="[^"]*"/.test(tag)
      ? tag.replace(/\sviewBox="[^"]*"/, ` viewBox="${asset.viewBox}"`)
      : tag.replace(/^<svg\b/, `<svg viewBox="${asset.viewBox}"`);
    if (selfClosed) {
      const openTag = tag.slice(0, -2).replace(/\/$/, '');
      out = out.slice(0, open) + openTag + '>' + asset.inner + '</svg>' + out.slice(tagEnd + 1);
    } else if (close < 0) {
      out = out.slice(0, open) + tag + asset.inner + '</svg>' + out.slice(tagEnd + 1);
    } else {
      out = out.slice(0, open) + tag + asset.inner + out.slice(close);
    }
  }
  return out;
}
