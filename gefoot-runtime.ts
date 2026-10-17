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

export function gefootHtml(code: string, duration: number, fps: number, seed: number, alpha: boolean): string {
  const runtime = alpha ? gefootRuntime.replace("ctx.fillStyle = '#000';\n    ctx.fillRect(0, 0, BASE_W, BASE_H);", 'ctx.clearRect(0, 0, BASE_W, BASE_H);') : gefootRuntime;
  const script = `${runtime}\nconst canvas=document.querySelector('canvas');
const ctx=canvas.getContext('2d');
window.__MOTIONFORGE_CANVAS_ERROR__='';
try {
const scene=compileScene(${JSON.stringify(code)},${JSON.stringify({ duration, fps, seed })});
window.__GEOF_SCENE__=scene;
function render(seconds){
 try {
 const w=Math.max(16,Math.round(innerWidth));const h=Math.round(w*9/16);
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 scene.drawFrame(ctx,Math.round(seconds*${fps}),w);
 }catch(e){window.__MOTIONFORGE_CANVAS_ERROR__=String(e.stack||e);throw e;}
}
window.addEventListener('motionforge:frame',e=>render(e.detail));
render(0);window.__MOTIONFORGE_READY__=true;
window.dispatchEvent(new Event('motionforge:ready'));
}catch(e){window.__MOTIONFORGE_CANVAS_ERROR__=String(e.stack||e);}
`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${alpha ? 'transparent' : '#000'}}body{display:grid;place-items:center}canvas{display:block;width:min(100vw,177.777777vh);height:auto;aspect-ratio:16/9}</style></head><body><canvas></canvas><script>${script.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
