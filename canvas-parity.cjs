const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { canvasHtml, extractJavaScript, validateCanvasCode } = require('./dist/canvas-scene');
const { gefootRuntime } = require('./dist/gefoot-runtime');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
  try {
    const keywords = Array.from({length:48},(_,i)=>`keyword${i}`).join(', ');
    const code = `// TITLE: Parity test\n// KEYWORDS: ${keywords}\n// CATEGORY: 19\n// DURATION: 10\n// LOOP: yes
function setup(env){return {x:env.random()};}
function draw(ctx,t,env){ctx.resetTransform();ctx.fillStyle='#1284c8';ctx.fillRect(0,0,1920,1080);ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='white';ctx.fillRect(Math.random()*100+env.state.x*100+env.time*20,100,150,150);}`;
    assert.equal(extractJavaScript('```javascript\n'+code+'\n```'),code);
    assert.deepEqual(validateCanvasCode(code,10),[]);
    const html=canvasHtml(code,30,42);
    assert(html.includes('// CATEGORY: 19'));
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    const result=await win.webContents.executeJavaScript(`(() => {
      ${gefootRuntime}
      const reference=compileScene(${JSON.stringify(code)},{duration:10,fps:30,seed:42});
      const actual=window.__GEOF_SCENE__;
      const results=[];
      for(const width of [320,1920,3840]){
        const a=document.createElement('canvas'),b=document.createElement('canvas');
        a.width=b.width=width;a.height=b.height=width*9/16;
        for(const frame of [0,150,37,150]){
          actual.drawFrame(a.getContext('2d',{willReadFrequently:true}),frame,width);
          reference.drawFrame(b.getContext('2d',{willReadFrequently:true}),frame,width);
          results.push(a.toDataURL()===b.toDataURL());
          results.push(a.getContext('2d').getImageData(width-1,a.height-1,1,1).data[2]===200);
        }
      }
      return {ready:window.__MOTIONFORGE_READY__,error:window.__MOTIONFORGE_CANVAS_ERROR__,results};
    })()`);
    console.log(result);assert.equal(result.ready,true);assert.equal(result.error,'');assert(result.results.every(Boolean));
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(canvasHtml(code.replace("ctx.fillRect(0,0,1920,1080);",''),30,42,true)));
    assert.equal(await win.webContents.executeJavaScript(`document.querySelector('canvas').getContext('2d').getImageData(0,0,1,1).data[3]`),0);
    console.log('Canvas parity passed: metadata preserved, deterministic frames, scaling 320/1920/3840, alpha.');
  } finally { win.destroy(); app.quit(); }
}).catch(e=>{console.error(e);app.exit(1);});
