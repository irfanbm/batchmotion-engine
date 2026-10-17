import { BrowserWindow } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function probeCanvas(html: string, folder: string, duration: number, signal: AbortSignal): Promise<string[]> {
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
      for(const t of [0,${duration / 2},${duration - 1 / 60}]) {
        window.dispatchEvent(new CustomEvent('motionforge:frame',{detail:t}));
        if(window.__MOTIONFORGE_CANVAS_ERROR__) errors.push(window.__MOTIONFORGE_CANVAS_ERROR__);
      }
      return errors;
    })()`);
  } finally {
    signal.removeEventListener('abort', abort);
    if (!win.isDestroyed()) win.destroy();
    await fs.rm(file, { force: true });
  }
}
