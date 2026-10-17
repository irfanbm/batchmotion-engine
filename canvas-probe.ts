import { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function probeCanvas(html: string, folder: string, duration: number, signal: AbortSignal, fps = 30): Promise<string[]> {
  const count = Math.max(2, Math.round(duration * fps)), samples = Array.from({ length: 16 }, (_, i) => Math.round(((count - 1) * i) / 15) / fps); // frame-aligned, includes the real last frame
  const file = path.join(folder, 'canvas-probe.html');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(file, html);
  const win = new BrowserWindow({ show: false, width: 640, height: 360, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  const abort = () => { if (!win.isDestroyed()) win.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new Error('Stopped');
    await win.loadFile(file);
    return await win.webContents.executeJavaScript(`(() => {
      const errors=[];
      if(window.__MOTIONFORGE_CANVAS_ERROR__) return [window.__MOTIONFORGE_CANVAS_ERROR__];
      if(!window.__MOTIONFORGE_READY__) return ['Canvas did not become ready'];
      // NaN/Infinity guard: count non-finite numeric arguments passed to 2D context methods while drawing.
      let bad=0,first='';
      const P=CanvasRenderingContext2D.prototype;
      for(const name of ['moveTo','lineTo','arc','arcTo','ellipse','rect','roundRect','bezierCurveTo','quadraticCurveTo','translate','scale','rotate','transform','fillRect','strokeRect','clearRect','drawImage','createLinearGradient','createRadialGradient','fillText','strokeText','setLineDash']){
        const fn=P[name]; if(typeof fn!=='function') continue;
        P[name]=function(...a){ for(const v of a){ if(typeof v==='number'&&!Number.isFinite(v)){bad++; if(!first) first=name+'('+a.join(',')+')'; break;} if(Array.isArray(v)&&v.some(x=>typeof x==='number'&&!Number.isFinite(x))){bad++; if(!first) first=name+'(['+v.join(',')+'])'; break;} } return fn.apply(this,a); };
      }
      for(const t of ${JSON.stringify(samples)}) {
        window.dispatchEvent(new CustomEvent('motionforge:frame',{detail:t}));
        if(window.__MOTIONFORGE_CANVAS_ERROR__) errors.push(window.__MOTIONFORGE_CANVAS_ERROR__);
      }
      if(bad) errors.push('Non-finite number (NaN/Infinity) passed to canvas API '+bad+' time(s), first: '+first);
      return [...new Set(errors)];
    })()`);
  } finally {
    signal.removeEventListener('abort', abort);
    if (!win.isDestroyed()) win.destroy();
    await fs.rm(file, { force: true });
  }
}
