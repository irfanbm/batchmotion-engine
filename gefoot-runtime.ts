import { readFileSync } from 'node:fs';
import path from 'node:path';

export const gefootRuntime = readFileSync(path.join(__dirname, 'gefoot-runtime.source'), 'utf8').replace(/^export /gm, '');
// prompt.js imports stockCsvText from csv.js; the imports are stripped here, so csv.js is evaluated first
// in the same scope to keep buildStockCsv() functional.
const stripModuleSyntax = (source: string) => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const csvSource = stripModuleSyntax(readFileSync(path.join(__dirname, 'gefoot-csv.source'), 'utf8'));
const promptSource = stripModuleSyntax(readFileSync(path.join(__dirname, 'gefoot-prompt.source'), 'utf8'));
const gefootModule: { buildPrompt: (idea: string) => string; buildStockCsv: (fileName: string, meta: { title?: string; keywords: string[]; category?: number }) => string } = new Function(`${csvSource}\n${promptSource}\n; return { buildPrompt, buildStockCsv };`)();
export const gefootPrompt: (idea: string) => string = gefootModule.buildPrompt;
export const gefootStockCsv = gefootModule.buildStockCsv;
// Motion-design kit (window-free, Math/Path2D from the scene scope) prepended to every scene so `MF.*` is in scope.
export const canvasKit = readFileSync(path.join(__dirname, 'gefoot-kit.source'), 'utf8');
export const withKit = (code: string) => `${canvasKit}\n${code}`;
// Icon names listed in the prompt are read from the kit itself, so the prompt can never advertise a missing icon.
export const kitIconNames: string[] = new Function('Path2D', `${canvasKit}\n;return MF.icons;`)(class {});

// The runtime pre-paints every frame black. That only shows when a scene fails to cover the frame (scenes that
// paint their own background are unaffected: measured 0 differing pixels), so opaque output keeps it as a visible
// safety net. Alpha output must clear instead. Whitespace-tolerant so CRLF checkouts work, and loud on mismatch:
// a silent no-op here would ship an opaque black "alpha" video.
const OPAQUE_PREFILL = /ctx\.fillStyle\s*=\s*'#000';\s*ctx\.fillRect\(0,\s*0,\s*BASE_W,\s*BASE_H\);/;
export function makeAlphaRuntime(runtime: string): string {
  if (!OPAQUE_PREFILL.test(runtime)) throw new Error('Gefoot runtime: opaque background pre-fill not found; cannot build an alpha Canvas page.');
  return runtime.replace(OPAQUE_PREFILL, 'ctx.clearRect(0, 0, BASE_W, BASE_H);');
}

export interface EngineBuildInfo { name: string; version: string; commit: string; sources: Record<string, string> }
function readBuildInfo(): EngineBuildInfo {
  try { return JSON.parse(readFileSync(path.join(__dirname, 'build-info.json'), 'utf8')) as EngineBuildInfo; } catch { return { name: 'batchmotion-engine', version: 'unknown', commit: 'unknown', sources: {} }; }
}
export const engineBuildInfo: EngineBuildInfo = readBuildInfo();
// Short, attribute-safe stamp embedded in every Canvas page: "batchmotion-engine@0.4.5+e2e426e runtime=ab12cd34 prompt=... csv=... gsap=..."
export const engineStamp = `${engineBuildInfo.name}@${engineBuildInfo.version}+${engineBuildInfo.commit} ${Object.entries(engineBuildInfo.sources).map(([k, v]) => `${k}=${v}`).join(' ')}`.trim();

export function gefootHtml(code: string, duration: number, fps: number, seed: number, alpha: boolean): string {
  const runtime = alpha ? makeAlphaRuntime(gefootRuntime) : gefootRuntime;
  const script = `${runtime}\nconst canvas=document.querySelector('canvas');
const ctx=canvas.getContext('2d');
window.__MOTIONFORGE_CANVAS_ERROR__='';
window.__MOTIONFORGE_ALPHA__=${alpha ? 'true' : 'false'};
try {
const scene=compileScene(${JSON.stringify(withKit(code))},${JSON.stringify({ duration, fps, seed })});
window.__GEOF_SCENE__=scene;
function renderFrame(f){
 try {
 const w=Math.max(16,Math.round(innerWidth));const h=Math.round(w*9/16);
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 scene.drawFrame(ctx,f,w);
 window.__MOTIONFORGE_LAST_FRAME__=f;
 }catch(e){window.__MOTIONFORGE_CANVAS_ERROR__=String(e.stack||e);throw e;}
}
function render(seconds){renderFrame(Math.round(seconds*${fps}));}
window.__MOTIONFORGE_LAST_FRAME__=-1;
// Host capture hook: draw frame f synchronously and return the canvas pixels of exactly that draw (no paint event involved).
window.__MOTIONFORGE_CAPTURE_FRAME__=function(f){renderFrame(f);return {frame:window.__MOTIONFORGE_LAST_FRAME__,png:canvas.toDataURL('image/png')};};
window.addEventListener('motionforge:frame',e=>render(e.detail));
render(0);window.__MOTIONFORGE_READY__=true;
window.dispatchEvent(new Event('motionforge:ready'));
}catch(e){window.__MOTIONFORGE_CANVAS_ERROR__=String(e.stack||e);}
`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="batchmotion-engine" content="${engineStamp.replace(/[^A-Za-z0-9@+._= -]/g, '')}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${alpha ? 'transparent' : '#000'}}body{display:grid;place-items:center}canvas{display:block;width:min(100vw,177.777777vh);height:auto;aspect-ratio:16/9}</style></head><body><canvas></canvas><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
