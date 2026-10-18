// Renders every MF icon/badge in real Chromium, asserts each one leaves ink inside its own cell and stays
// within it (no path exploding across the sheet), then writes a contact sheet PNG for a visual check.
// Run: npx electron canvas-kit-render.cjs [out.png]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { canvasHtml } = require('./dist/canvas-scene');
const { kitIconNames } = require('./dist/gefoot-runtime');

const out = path.resolve(process.argv.find((a) => a.endsWith('.png')) || 'kit-sheet.png');
const COLS = 10, CELL = 160;
const scene = `// TITLE: kit sheet
// DURATION: 10
function setup(env){return {}}
function draw(ctx,t,env){
  ctx.fillStyle='#f8fafc';ctx.fillRect(0,0,1920,1080);
  const names=MF.icons;
  names.forEach((n,i)=>{const cx=80+(i%${COLS})*${CELL}+40, cy=70+Math.floor(i/${COLS})*100;
    MF.icon(ctx,n,cx,cy,64,{color:'#0f172a',width:2});});
}`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1920, height: 1080, webPreferences: { contextIsolation: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(canvasHtml(scene, 30, 1)));
    const r = await win.webContents.executeJavaScript(`(() => {
      if (window.__MOTIONFORGE_CANVAS_ERROR__) return { error: window.__MOTIONFORGE_CANVAS_ERROR__ };
      const c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d',{willReadFrequently:true});
      window.__GEOF_SCENE__.drawFrame(x,0,1920);
      const d=x.getImageData(0,0,1920,1080).data, names=${JSON.stringify(kitIconNames)}, res=[];
      const dark=(px,py)=>{const i=(py*1920+px)*4;return d[i]<160;};
      names.forEach((n,i)=>{const cx=80+(i%${COLS})*${CELL}+40, cy=70+Math.floor(i/${COLS})*100;
        let ink=0,out=0;
        for(let py=cy-48;py<=cy+48;py++)for(let px=cx-48;px<=cx+48;px++){if(!dark(px,py))continue;
          if(Math.abs(px-cx)<=34&&Math.abs(py-cy)<=34)ink++;else out++;}
        res.push({n,ink,out});});
      return { res, png: c.toDataURL('image/png') };
    })()`);
    if (r.error) throw new Error(r.error);
    fs.writeFileSync(out, Buffer.from(r.png.split(',')[1], 'base64'));
    const empty = r.res.filter((x) => x.ink < 60), spill = r.res.filter((x) => x.out > 20);
    for (const x of r.res) console.log(`${x.n.padEnd(14)} ink=${String(x.ink).padStart(5)} spill=${x.out}`);
    console.log(`sheet: ${out}`);
    if (empty.length || spill.length) throw new Error(`empty: ${empty.map((x) => x.n).join(',') || '-'} | spill: ${spill.map((x) => x.n).join(',') || '-'}`);
    console.log(`Kit render passed: ${r.res.length} icons inked inside their own cell.`);
  } finally { win.destroy(); app.quit(); }
}).catch((e) => { console.error(e); app.exit(1); });
