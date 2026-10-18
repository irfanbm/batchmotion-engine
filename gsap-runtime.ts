import fs from 'node:fs';
import path from 'node:path';

// Fase 1b: the host owns the GSAP runtime (vendored from the npm `gsap` package,
// GSAP No-Charge Standard License by Webflow; the minified banner must stay intact).
// The LLM writes code against the global `gsap` but never receives or emits its source;
// we inject one marked <script> after generation and strip it from every repair prompt.

const GSAP_SCRIPT_ID = 'batchmotion-gsap';
const GSAP_MARKER = '/*batchmotion:gsap*/';
const injectedScriptPattern = new RegExp(`<script\\b[^>]*id=["']${GSAP_SCRIPT_ID}["'][^>]*>[\\s\\S]*?</script>\\s*`, 'gi');

let cachedSource: string | undefined;

export function vendoredGsapPath(): string {
  // Shared by the GSAP injector below and the HyperFrames stager (which copies
  // this exact file next to the composition so <script src="gsap.min.js"> resolves).
  return path.join(__dirname, '..', 'resources', 'gsap.min.js');
}

function loadGsapSource(): string {
  if (cachedSource !== undefined) return cachedSource;
  // dev/test: <repo>/dist-electron -> <repo>/resources/gsap.min.js
  // packaged: <app.asar>/dist-electron -> <app.asar>/resources/gsap.min.js (files includes resources/**)
  const sourcePath = vendoredGsapPath();
  try {
    const source = fs.readFileSync(sourcePath, 'utf8');
    if (!/gsap/i.test(source) || !/@license/i.test(source))
      throw new Error('not the licensed GSAP build');
    cachedSource = source;
    return source;
  } catch (error) {
    throw new Error(`GSAP runtime source missing or unusable at ${sourcePath}: ${(error as Error).message}`);
  }
}

// Removes any injected runtime (also cleans LLM tampering) so re-injection is exact.
// Same fingerprint render.ts uses to recognise a Gefoot Canvas page; legacy HTML/GSAP pages never contain it.
export function isCanvasHtml(html: string): boolean {
  return html.includes('window.__GEOF_SCENE__=scene;') && html.includes('scene.drawFrame(ctx,');
}

export function stripGsapRuntime(html: string): string {
  return html.replace(injectedScriptPattern, '');
}

// Idempotent: strips first, then injects the current vendored source as the first
// element of <head> so it loads before scene scripts (and after the virtual clock
// at capture time, which is itself inserted at the very start of <head>).
export function ensureGsapRuntime(html: string): string {
  const stripped = stripGsapRuntime(html);
  // Canvas pages (gefootHtml) never use GSAP: injecting 73 KB there only slows load and pollutes the page.
  // Also removes a copy injected by an older version when a saved Canvas project is reopened.
  if (isCanvasHtml(stripped)) return stripped;
  const script = `<script id="${GSAP_SCRIPT_ID}">${GSAP_MARKER}${loadGsapSource()}</script>`;
  if (!/<head\b[^>]*>/i.test(stripped))
    throw new Error('Cannot inject GSAP runtime: missing head');
  return stripped.replace(/<head\b[^>]*>/i, (head) => `${head}${script}`);
}

export function hasGsapRuntime(html: string): boolean {
  return new RegExp(`id=["']${GSAP_SCRIPT_ID}["']`).test(html);
}
