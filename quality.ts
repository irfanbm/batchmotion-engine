import type { MotionRect } from './geometry';

export function uniqueErrors(messages:string[]){const rows=new Map<string,{message:string;score:number}>();for(const message of messages){const withoutTimestamp=message.replace(/\bt=\d+(?:\.\d+)?s\s*/g,''),key=withoutTimestamp.toLowerCase().replace(/-?\d+(?:\.\d+)?/g,'#').replace(/\s+/g,' ').trim(),score=[...withoutTimestamp.matchAll(/-?\d+(?:\.\d+)?/g)].reduce((sum,x)=>sum+Math.abs(Number(x[0])),0),old=rows.get(key);if(!old||score>old.score)rows.set(key,{message,score})}return [...rows.values()].map(x=>x.message)}

export function motionActivityReport(frames:Buffer[],alpha=false,threshold=.0015){const ratios=frames.slice(1).map((frame,index)=>pixelChangeRatio(frames[index],frame,12,alpha)),change=ratios.length?Math.max(...ratios):0;return{ok:change>=threshold,change,threshold,ratios}}

export function pixelChangeRatio(a:Buffer,b:Buffer,channelThreshold=12,includeAlpha=false){if(a.length!==b.length||a.length<4)return 1;let changed=0,samples=0;const stride=Math.max(4,Math.floor(a.length/65536/4)*4);for(let i=0;i+3<a.length;i+=stride){samples++;if(Math.abs(a[i]-b[i])>channelThreshold||Math.abs(a[i+1]-b[i+1])>channelThreshold||Math.abs(a[i+2]-b[i+2])>channelThreshold||(includeAlpha&&Math.abs(a[i+3]-b[i+3])>channelThreshold))changed++}return changed/samples}

export interface FlickerReport{ok:boolean;reversals:number;maxSwing:number}
export function flickerReport(ratios:number[],swingThreshold=.02,maxReversals=2):FlickerReport{let reversals=0,maxSwing=0,direction=0;for(let i=1;i<ratios.length;i++){const delta=ratios[i]-ratios[i-1];if(Math.abs(delta)<swingThreshold)continue;const dir=Math.sign(delta);maxSwing=Math.max(maxSwing,Math.abs(delta));if(direction!==0&&dir!==direction)reversals++;direction=dir}return{ok:reversals<=maxReversals,reversals,maxSwing}}

export interface DriftReport{ok:boolean;drift:number;tolerance:number}
export function subjectDriftReport(rects:MotionRect[],width:number,height:number,tolerance=.12):DriftReport{if(!rects.length||width<=0||height<=0)return{ok:true,drift:0,tolerance};const base=rects[0];let drift=0;for(const rect of rects){const dx=(rect.x+rect.width/2-(base.x+base.width/2))/width,dy=(rect.y+rect.height/2-(base.y+base.height/2))/height;drift=Math.max(drift,Math.hypot(dx,dy))}return{ok:drift<=tolerance,drift,tolerance}}

export interface ColorConsistencyReport{ok:boolean;newColorRatio:number;threshold:number}
export function colorConsistencyReport(frames:Buffer[],threshold=.25):ColorConsistencyReport{if(frames.length<2)return{ok:true,newColorRatio:0,threshold};const base=frames[0];if(base.length<4)return{ok:true,newColorRatio:0,threshold};const stride=Math.max(4,Math.floor(base.length/65536/4)*4),palette=new Set<string>();for(let i=0;i+3<base.length;i+=stride)palette.add((base[i]>>5)+'-'+(base[i+1]>>5)+'-'+(base[i+2]>>5));let worst=0;for(let f=1;f<frames.length;f++){const frame=frames[f];if(frame.length!==base.length)continue;let fresh=0,samples=0;for(let i=0;i+3<frame.length;i+=stride){samples++;if(!palette.has((frame[i]>>5)+'-'+(frame[i+1]>>5)+'-'+(frame[i+2]>>5)))fresh++}if(samples)worst=Math.max(worst,fresh/samples)}return{ok:worst<=threshold,newColorRatio:worst,threshold}}

export interface TextLegibilityItem{label:string;fontSize:number;color:string;background:string}
export interface TextLegibilityReport{ok:boolean;findings:string[]}
function channelLuminance(value:number){const c=value/255;return c<=.03928?c/12.92:((c+.055)/1.055)**2.4}
function toHex(r:number,g:number,b:number){return[r,g,b].map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')}
export function relativeLuminance(hex:string){const m=/^#?([0-9a-f]{6})$/i.exec(hex.trim());if(!m)return 0;const n=parseInt(m[1],16);return .2126*channelLuminance(n>>16&255)+.7152*channelLuminance(n>>8&255)+.0722*channelLuminance(n&255)}
export function contrastRatio(a:string,b:string){const la=relativeLuminance(a),lb=relativeLuminance(b),hi=Math.max(la,lb),lo=Math.min(la,lb);return(hi+.05)/(lo+.05)}
// Parse a computed CSS color value: comma or space separated channels with an optional
// slash alpha. Returns null for transparent, unparseable, or non-finite values (modern
// space syntax, color-mix output, var() residue) so unmeasurable labels are skipped
// instead of gated on garbage. The DOM probe carries a mirror of this logic.
export function parseCssColor(input:string):{r:number;g:number;b:number}|null{
  const m=/rgba?\(([^)]+)\)/.exec(input||'');
  if(!m)return null;
  const body=m[1].trim(),slash=body.split('/');
  const main=slash[0];
  const toks=(body.indexOf(',')>=0?main.split(','):main.split(/\s+/)).map(s=>s.trim()).filter(s=>s.length>0);
  const nums=toks.map(Number);
  if(nums.length<3||nums.slice(0,3).some(v=>!Number.isFinite(v)))return null;
  const alpha=slash.length>1?Number(slash[1].trim()):nums[3];
  if(alpha!==undefined&&Number.isFinite(alpha)&&alpha<=0.05)return null;
  if(nums.length>3&&Number.isFinite(nums[3])&&nums[3]<=0.05)return null;
  return{r:nums[0],g:nums[1],b:nums[2]};
}
// DOM probe for the text-legibility gate (evaluated inside the render page): every text
// leaf with its rendered font size (computed size times ancestor scale, so scaled-down
// labels measure as seen), color, and nearest solid ancestor background. Labels with an
// authored (unscaled) size below the floor are reported as small regardless of
// visibility, so flash-visible labels cannot hide between samples. Gradients and fully
// transparent chains are unmeasurable, so those labels are reported as skipped.
export const TEXT_LEGIBILITY_PROBE = `(() => {
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null; const body = m[1].trim(), slash = body.split('/'), main = slash[0]; const toks = (body.indexOf(',') >= 0 ? main.split(',') : main.split(/\\s+/)).map((s) => s.trim()).filter((s) => s); const nums = toks.map(Number); if (nums.length < 3 || nums.slice(0, 3).some((v) => !Number.isFinite(v))) return null; const a = slash.length > 1 ? Number(slash[1].trim()) : nums[3]; if (a !== undefined && Number.isFinite(a) && a <= 0.05) return null; if (nums.length > 3 && Number.isFinite(nums[3]) && nums[3] <= 0.05) return null; return { r: nums[0], g: nums[1], b: nums[2] }; };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const shown = (el) => { let n = el; for (let i = 0; n && i < 25; n = n.parentElement, i++) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; } const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const scaleOf = (el) => { let s = 1, n = el; for (let i = 0; n && i < 25; n = n.parentElement, i++) { const t = getComputedStyle(n).transform; if (!t || t === 'none') continue; let m = /matrix\\(([^)]+)\\)/.exec(t), v = m && m[1].split(',').map((x) => Number(x.trim())); if (v && v.length >= 4 && v.slice(0, 4).every(Number.isFinite)) { s *= Math.min(Math.hypot(v[0], v[1]), Math.hypot(v[2], v[3])); continue; } m = /matrix3d\\(([^)]+)\\)/.exec(t); v = m && m[1].split(',').map((x) => Number(x.trim())); if (v && v.length >= 16 && v.slice(0, 16).every(Number.isFinite)) s *= Math.min(Math.hypot(v[0], v[1], v[2]), Math.hypot(v[4], v[5], v[6])); } return s; };
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const s = getComputedStyle(n); if (s.backgroundImage !== 'none' && /gradient|url\\(/.test(s.backgroundImage)) return null; const c = parse(s.backgroundColor); if (c) return hex(c); } return null; };
  const out = [], skipped = [], small = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    if (el.closest && el.closest('#split-drafts')) continue;
    const label = text.slice(0, 40) + (text.length > 40 ? '...' : '');
    const unscaled = parseFloat(getComputedStyle(el).fontSize);
    if (Number.isFinite(unscaled) && unscaled > 0 && unscaled < 11.95) small.push({ label: label, fontSize: unscaled });
    if (!shown(el)) continue;
    const color = parse(getComputedStyle(el).color);
    const size = parseFloat(getComputedStyle(el).fontSize) * scaleOf(el);
    const bg = bgOf(el);
    if (!color) continue;
    if (!bg) { const rc = el.getBoundingClientRect(); skipped.push({ label: label, x: rc.x, y: rc.y, width: rc.width, height: rc.height, fontSize: size, color: hex(color) }); continue; }
    out.push({ label: label, fontSize: size, color: hex(color), background: bg });
  }
  return { items: out, skipped: skipped, small: small };
})()`;
// Findings for the text gate: size floor for every label, contrast floor that scales
// with size (small text at 4.5:1, display type at 24px+ at 3:1). Labels whose measured
// colors are not real hex values are skipped, never gated.
export function textFindings(items: TextLegibilityItem[]): string[] {
  const findings: string[] = [];
  const hex = /^#[0-9a-fA-F]{6}$/;
  for (const item of items) {
    if (!Number.isFinite(item.fontSize) || !hex.test(item.color || '') || !hex.test(item.background || '')) continue;
    // 11.95 floor: authored 12px can compute to 11.99999x through clamp()/em math;
    // genuine 11px labels still fail.
    if (item.fontSize < 11.95) findings.push(`${item.label}: font size ${item.fontSize}px below 12px`);
    const need = item.fontSize >= 24 ? 3 : 4.5;
    const ratio = contrastRatio(item.color, item.background);
    if (ratio < need)
      findings.push(
        `${item.label}: contrast ${ratio.toFixed(2)} below ${need} (text ${item.color} on ${item.background}, ${item.fontSize}px)`,
      );
  }
  return uniqueErrors(findings);
}
export function textLegibilityReport(items:TextLegibilityItem[],minFontSize=12,minContrast=3):TextLegibilityReport{const findings:string[]=[];for(const item of items){if(item.fontSize<minFontSize)findings.push(item.label+': font size '+item.fontSize+'px below '+minFontSize+'px');const ratio=contrastRatio(item.color,item.background);if(ratio<minContrast)findings.push(item.label+': contrast '+ratio.toFixed(2)+' below '+minContrast)}return{ok:!findings.length,findings}}

function luminance(r:number,g:number,b:number){return .2126*channelLuminance(r)+.7152*channelLuminance(g)+.0722*channelLuminance(b)}

export interface StageRegion{x0:number;y0:number;x1:number;y1:number}
// The stage background is the frame's most frequent exact color; everything far from it
// is content. Distances are summed per-channel byte differences.
function backgroundMode(f:Buffer,width:number,height:number,pixelStride=8,region?:StageRegion){
  const x0=Math.max(0,region?.x0??0),y0=Math.max(0,region?.y0??0),x1=Math.min(width,region?.x1??width),y1=Math.min(height,region?.y1??height);
  const bins=new Map<number,number>();let samples=0;
  for(let y=y0;y<y1;y+=pixelStride)for(let x=x0;x<x1;x+=pixelStride){const i=(y*width+x)*4;bins.set((f[i]<<16)|(f[i+1]<<8)|f[i+2],(bins.get((f[i]<<16)|(f[i+1]<<8)|f[i+2])??0)+1);samples++}
  if(!samples)return null;
  let mode=0,count=0;for(const[key,n]of bins)if(n>count){count=n;mode=key}
  return{r:mode>>16&255,g:mode>>8&255,b:mode&255,dominance:count/samples,samples};
}
export const CONTENT_DISTANCE=40;
// Copy a region out of a full-frame bitmap so split-mode diagnostics can measure the
// film stage alone: the draft strip's playhead would otherwise mask a frozen film.
export function cropBitmap(frame:Buffer,width:number,height:number,region:StageRegion):Buffer{
  const x0=Math.max(0,region.x0),y0=Math.max(0,region.y0),x1=Math.min(width,region.x1),y1=Math.min(height,region.y1);
  const out=Buffer.alloc(Math.max(0,(x1-x0))*(Math.max(0,y1-y0))*4);
  for(let y=y0;y<y1;y++)frame.copy(out,(y-y0)*(x1-x0)*4,(y*width+x0)*4,(y*width+x1)*4);
  return out;
}
// Centroid of non-background (content) pixels, used to detect whether the *frame content*
// actually translates (camera/parallax) versus a locked static shot. 4-channel RGBA buffer.
function contentCentroid(f:Buffer,width:number,height:number,stride=8){
  const bg=backgroundMode(f,width,height,stride);
  if(!bg)return null;
  let sx=0,sy=0,n=0;
  for(let y=0;y<height;y+=stride)for(let x=0;x<width;x+=stride){const i=(y*width+x)*4;
    if(Math.abs(f[i]-bg.r)+Math.abs(f[i+1]-bg.g)+Math.abs(f[i+2]-bg.b)>CONTENT_DISTANCE){sx+=x;sy+=y;n++}}
  return n?{x:sx/n,y:sy/n}:null
}

export interface StageContentReport{ok:boolean;coverage:number;contrast:number;flat:boolean;minCoverage:number;minContrast:number;reason?:string}
// Emptiness and subject-vs-background contrast of one frame (optionally a region of it,
// so Studio Split can measure the film stage without the draft strip diluting it).
// Contrast is only meaningful when the background is flat: with a gradient or a busy
// backdrop the modal color is not "the background", so the check fail-opens instead of
// inventing a contrast number.
export function stageContentReport(f:Buffer,width:number,height:number,minCoverage=0.1,minContrast=2.5,region?:StageRegion):StageContentReport{
  const x0=Math.max(0,region?.x0??0),y0=Math.max(0,region?.y0??0),x1=Math.min(width,region?.x1??width),y1=Math.min(height,region?.y1??height);
  const base={coverage:0,contrast:0,flat:false,minCoverage,minContrast};
  if(x1-x0<8||y1-y0<8)return{...base,ok:false,reason:'stage region is degenerate'};
  const bg=backgroundMode(f,width,height,8,region);
  if(!bg)return{...base,ok:false,reason:'stage region has no samples'};
  const flat=bg.dominance>=.4;
  const bgLum=luminance(bg.r,bg.g,bg.b);
  let content=0;const lums:number[]=[];let cr=0,cg=0,cb=0;
  for(let y=y0;y<y1;y+=8)for(let x=x0;x<x1;x+=8){const i=(y*width+x)*4;
    if(Math.abs(f[i]-bg.r)+Math.abs(f[i+1]-bg.g)+Math.abs(f[i+2]-bg.b)>CONTENT_DISTANCE){content++;lums.push(luminance(f[i],f[i+1],f[i+2]));cr+=f[i];cg+=f[i+1];cb+=f[i+2]}}
  const coverage=bg.samples?content/bg.samples:0;
  let contrast=0;
  if(lums.length){lums.sort((a,b)=>a-b);const mid=lums[lums.length>>1],hi=Math.max(mid,bgLum),lo=Math.min(mid,bgLum);contrast=(hi+.05)/(lo+.05)}
  const ok=coverage>=minCoverage&&(!flat||contrast>=minContrast);
  let reason:string|undefined;
  if(coverage<minCoverage)reason=`content covers ${(coverage*100).toFixed(1)}% of the stage, below the required ${(minCoverage*100).toFixed(0)}%`;
  else if(flat&&contrast<minContrast){
    const n=lums.length||1;
    reason=`subject and stage background contrast is ${contrast.toFixed(2)}, below the required ${minContrast} (measured content ~#${toHex(cr/n,cg/n,cb/n)} on ground #${toHex(bg.r,bg.g,bg.b)})`;
  }
  return{ok,coverage,contrast,flat,minCoverage,minContrast,...(reason?{reason}:{})};
}

export interface SubjectRegionContrast{contrast:number;ok:boolean;inside:string;outside:string;reason?:string}
// Subject-vs-neighborhood contrast: the most contrasting inside tones (darkest and
// lightest deciles, so line-art strokes and highlights count even when the wrapper box
// holds mostly padding) against the ring around the subject box. Unlike the modal stage
// report this stays meaningful on gradients and busy backdrops, where no single color
// is "the background". Returns null when either sample set is degenerate.
export function subjectRegionContrast(f:Buffer,width:number,height:number,rect:{x:number;y:number;width:number;height:number},minContrast=2.5,ringPx=48,region?:StageRegion):SubjectRegionContrast|null{
  const bx0=Math.max(0,Math.floor(region?.x0??0)),by0=Math.max(0,Math.floor(region?.y0??0)),bx1=Math.min(width,Math.ceil(region?.x1??width)),by1=Math.min(height,Math.ceil(region?.y1??height));
  const ix0=Math.max(bx0,rect.x+rect.width*0.15),iy0=Math.max(by0,rect.y+rect.height*0.15),ix1=Math.min(bx1,rect.x+rect.width*0.85),iy1=Math.min(by1,rect.y+rect.height*0.85);
  const ox0=Math.max(bx0,rect.x-ringPx),oy0=Math.max(by0,rect.y-ringPx),ox1=Math.min(bx1,rect.x+rect.width+ringPx),oy1=Math.min(by1,rect.y+rect.height+ringPx);
  if(ix1-ix0<8||iy1-iy0<8||ox1-ox0<16||oy1-oy0<16)return null;
  const inside:{l:number;r:number;g:number;b:number}[]=[];
  let mr=0,mg=0,mb=0;
  for(let y=Math.floor(iy0);y<iy1;y+=4)for(let x=Math.floor(ix0);x<ix1;x+=4){const i=(y*width+x)*4;inside.push({l:luminance(f[i],f[i+1],f[i+2]),r:f[i],g:f[i+1],b:f[i+2]});mr+=f[i];mg+=f[i+1];mb+=f[i+2]}
  let or_=0,og=0,ob=0,on=0;
  for(let y=Math.floor(oy0);y<oy1;y+=4)for(let x=Math.floor(ox0);x<ox1;x+=4){
    if(x>=ix0&&x<ix1&&y>=iy0&&y<iy1)continue;
    const i=(y*width+x)*4;or_+=f[i];og+=f[i+1];ob+=f[i+2];on++;
  }
  if(inside.length<16||on<16)return null;
  inside.sort((a,b)=>a.l-b.l);
  const lo=inside[Math.floor((inside.length-1)*0.1)],hi=inside[Math.floor((inside.length-1)*0.9)];
  const outside='#'+toHex(or_/on,og/on,ob/on);
  const clo=contrastRatio('#'+toHex(lo.r,lo.g,lo.b),outside),chi=contrastRatio('#'+toHex(hi.r,hi.g,hi.b),outside);
  const win=clo>=chi?lo:hi,contrast=Math.max(clo,chi);
  const winHex='#'+toHex(win.r,win.g,win.b);
  const insideMean='#'+toHex(mr/inside.length,mg/inside.length,mb/inside.length);
  const ok=contrast>=minContrast;
  return{contrast,ok,inside:insideMean,outside,...(!ok?{reason:`subject and nearby background contrast is ${contrast.toFixed(2)}, below the required ${minContrast} (subject tones ~${winHex} on nearby ${outside})`}:{})};
}

export interface BlackSlabReport{share:number;ok:boolean;reason?:string}
// Pure-black mass: exact #000000 fills (lazy background:#000, default canvas) read as
// a void slab, never as night. Transparent pixels never count. Text and hairlines stay
// far below the share floor, so only slabs trip it.
export function blackSlabReport(f:Buffer,width:number,height:number,maxShare=0.08,region?:StageRegion):BlackSlabReport{
  const x0=Math.max(0,Math.floor(region?.x0??0)),y0=Math.max(0,Math.floor(region?.y0??0)),x1=Math.min(width,Math.ceil(region?.x1??width)),y1=Math.min(height,Math.ceil(region?.y1??height));
  let black=0,samples=0;
  for(let y=y0;y<y1;y+=4)for(let x=x0;x<x1;x+=4){const i=(y*width+x)*4;
    if(f[i+3]<128)continue;
    samples++;
    if(f[i]<=8&&f[i+1]<=8&&f[i+2]<=8)black++;
  }
  const share=samples?black/samples:0,ok=share<=maxShare;
  return{share,ok,...(!ok?{reason:`pure-black mass covers ${(share*100).toFixed(1)}% of the stage, above the allowed ${(maxShare*100).toFixed(0)}%; use near-black #101014 instead of pure #000000 for fills, type, and backgrounds`}:{})};
}

export interface TextSkippedItem{label:string;x:number;y:number;width:number;height:number;fontSize:number;color:string}
// Backdrop sampling for labels the DOM probe cannot measure (gradients, translucency):
// the worse of the 25th/75th percentile box tones against the text color. Percentiles
// (not means, not text-color exclusion) so a pale chip around pale text still reads as
// the pale chip, while glyph ink never dominates either quartile of a normal box.
export function sampleBackdropColor(f:Buffer,width:number,height:number,rect:{x:number;y:number;width:number;height:number},textHex:string):string|null{
  const m=/^#?([0-9a-f]{6})$/i.exec((textHex||'').trim());
  if(!m)return null;
  const ix0=Math.max(0,rect.x+rect.width*0.1),iy0=Math.max(0,rect.y+rect.height*0.1),ix1=Math.min(width,rect.x+rect.width*0.9),iy1=Math.min(height,rect.y+rect.height*0.9);
  if(ix1-ix0<4||iy1-iy0<4)return null;
  const px:{l:number;r:number;g:number;b:number}[]=[];
  for(let y=Math.floor(iy0);y<iy1;y+=2)for(let x=Math.floor(ix0);x<ix1;x+=2){const i=(y*width+x)*4;
    if(f[i+3]<128)continue;
    px.push({l:luminance(f[i],f[i+1],f[i+2]),r:f[i],g:f[i+1],b:f[i+2]});
  }
  if(px.length<12)return null;
  px.sort((a,b)=>a.l-b.l);
  const lo=px[Math.floor((px.length-1)*0.25)],hi=px[Math.floor((px.length-1)*0.75)];
  const n=parseInt(m[1],16),tl=luminance(n>>16&255,n>>8&255,n&255);
  const clo=(Math.max(tl,lo.l)+.05)/(Math.min(tl,lo.l)+.05),chi=(Math.max(tl,hi.l)+.05)/(Math.min(tl,hi.l)+.05);
  const win=clo<=chi?lo:hi;
  return'#'+toHex(win.r,win.g,win.b);
}

export interface CameraMotionReport{ok:boolean;translation:number;activeRatio:number;strongRatio:number;reason?:string}
// A clip has camera/layer motion when EITHER the content translates across the frame OR
// some frame pair changes a real share of its pixels by more than the strong-change
// threshold (an in-place transformation or a bright pass). A locked static shot with a
// subtle low-contrast shimmer fails both. Units are fractions of the frame dimension;
// activeRatio is the share of consecutive frames that change at all (telemetry only).
export function cameraMotionReport(frames:Buffer[],width:number,height:number,translationTolerance=0.004,minStrongRatio=0.02):CameraMotionReport{
  if(frames.length<2)return{ok:true,translation:0,activeRatio:1,strongRatio:1};
  const cents=frames.map(f=>contentCentroid(f,width,height)).filter(Boolean) as {x:number;y:number}[];
  let translation=0;const base=cents[0];
  for(const c of cents){if(!base)break;const dx=(c.x-base.x)/width,dy=(c.y-base.y)/height;translation=Math.max(translation,Math.hypot(dx,dy));}
  const ratios=frames.slice(1).map((f,i)=>pixelChangeRatio(frames[i],f));
  const activeRatio=ratios.length?ratios.filter(r=>r>0.0005).length/ratios.length:1;
  const strongRatio=Math.max(...frames.slice(1).map((f,i)=>pixelChangeRatio(frames[i],f,40)));
  const ok=translation>=translationTolerance||strongRatio>=minStrongRatio;
  return{ok,translation,activeRatio,strongRatio,...(!ok?{reason:`locked static frame: content translation ${(translation*100).toFixed(2)}% < ${(translationTolerance*100).toFixed(2)}% and strong frame change ${(strongRatio*100).toFixed(2)}% < ${(minStrongRatio*100).toFixed(0)}%`}:{})};
}

export interface KineticReport{ok:boolean;linearity:number;reason?:string}
// Detects dominantly-linear (mechanical) motion. Compute per-interval pixel-change deltas
// (a proxy for speed). If the scene is moving but the speed is nearly constant (very low
// coefficient of variation), the motion is linear/robotic. Organic eased motion has varying
// speed, hence a higher CV. Returns linearity = 1 - clampedCV (higher = more linear).
export function kineticReport(frames:Buffer[],minMean=0.002,extremeCvThreshold=0.05,extremeLinearity=0.9):KineticReport{
  if(frames.length<3)return{ok:true,linearity:0};
  const ratios=frames.slice(1).map((f,i)=>pixelChangeRatio(frames[i],f));
  const mean=ratios.reduce((s,r)=>s+r,0)/ratios.length;
  if(mean<minMean)return{ok:true,linearity:0,reason:'too little motion to judge easing'};
  const variance=ratios.reduce((s,r)=>s+(r-mean)*(r-mean),0)/ratios.length;
  const cv=Math.sqrt(variance)/mean;
  const linearity=Math.max(0,1-cv/0.5); // normalize: cv>=0.5 -> clearly eased (0), cv~0 -> fully linear (1)
  // Only reject the extreme, clearly-mechanical cases: speed almost perfectly constant AND
  // the motion is fully linear. Smooth continuous drift (a legitimate microstock style) keeps
  // a moderate linearity and is NOT rejected.
  const ok=!(cv<extremeCvThreshold&&linearity>extremeLinearity);
  return{ok,linearity:Math.round(linearity*1000)/1000,...(!ok?{reason:`mechanical/linear motion: speed is nearly constant (cv=${cv.toFixed(3)}, linearity=${linearity.toFixed(2)})`}:{})};
}

// Spike detection: catches "geometry pops" — an element that abruptly appears/stretches/
// vanishes. A spike is a single-frame delta far above the clip's mean (abrupt, not eased).
export interface SpikeReport{ok:boolean;spikes:number;maxRatio:number;reason?:string}
export function spikeReport(ratios:number[],ratioThreshold=4):SpikeReport{
  if(ratios.length<3)return{ok:true,spikes:0,maxRatio:0};
  const mean=ratios.reduce((s,r)=>s+r,0)/ratios.length;
  if(mean<0.001)return{ok:true,spikes:0,maxRatio:0}; // too still to judge
  const spikes=ratios.filter(r=>r>mean*ratioThreshold).length;
  const maxRatio=mean?Math.max(...ratios)/mean:0;
  const ok=spikes===0;
  return{ok,spikes,maxRatio:Math.round(maxRatio*100)/100,...(!ok?{reason:`abrupt geometry pop: ${spikes} frame${spikes>1?'s':''} jumped ${(maxRatio).toFixed(1)}x the mean delta (anti-pop violation)`}:{})};
}

export interface BeatCoherenceReport{ok:boolean;beats:number;maxGap:number;reason?:string}
export function beatCoherenceReport(source:string,duration:number):BeatCoherenceReport{const line=/\/\/\s*BEATS:([^\n]*)/i.exec(source);if(!line)return{ok:false,beats:0,maxGap:0,reason:'BEATS table missing'};const times=[...line[1].matchAll(/\bt=(\d+(?:\.\d+)?)\s*s/gi)].map(m=>Number(m[1]));if(times.length<2)return{ok:false,beats:times.length,maxGap:0,reason:'expected at least 2 beats'};let maxGap=0;for(let i=1;i<times.length;i++)maxGap=Math.max(maxGap,times[i]-times[i-1]);const ok=maxGap<=1&&times[times.length-1]<=duration+.001;return{ok,beats:times.length,maxGap,...(ok?{}:{reason:maxGap>1?'beat gap too large':'beats extend past duration'})}}

// ---- Canvas liveness (catastrophic-only) -------------------------------------------------
// Resolution independent; robust on gradients and dark scenes (measured on 7 synthetic + 1 real scene).
export interface CanvasLivenessReport{blank:boolean;still:boolean;maxStep:number;maxEdge:number;maxSpan:number;reason:string}
function bgraEdgeDensity(f:Buffer,w:number,h:number,thr=12){let e=0,n=0;const stride=Math.max(1,Math.floor(Math.sqrt((w*h)/250000)));for(let y=0;y<h-stride;y+=stride)for(let x=0;x<w-stride;x+=stride){const i=(y*w+x)*4,r=i+4*stride,d=i+w*4*stride;n++;const m=Math.max(Math.abs(f[i]-f[r]),Math.abs(f[i+1]-f[r+1]),Math.abs(f[i+2]-f[r+2]),Math.abs(f[i]-f[d]),Math.abs(f[i+1]-f[d+1]),Math.abs(f[i+2]-f[d+2]));if(m>thr)e++}return n?e/n:0}
function bgraLumSpan(f:Buffer){const v:number[]=[];for(let i=0;i+3<f.length;i+=16)v.push(.2126*f[i+2]+.7152*f[i+1]+.0722*f[i]);if(!v.length)return 0;v.sort((a,b)=>a-b);return v[Math.floor(v.length*.99)]-v[Math.floor(v.length*.01)]}
function bgraChange(a:Buffer,b:Buffer,thr=4){if(a.length!==b.length||a.length<4)return 1;let c=0,n=0;for(let i=0;i+3<a.length;i+=4){n++;if(Math.abs(a[i]-b[i])>thr||Math.abs(a[i+1]-b[i+1])>thr||Math.abs(a[i+2]-b[i+2])>thr)c++}return c/n}
export function canvasLivenessReport(frames:Buffer[],width:number,height:number):CanvasLivenessReport{
  if(frames.length<2)return{blank:false,still:false,maxStep:1,maxEdge:1,maxSpan:255,reason:''};
  const maxEdge=Math.max(...frames.map(f=>bgraEdgeDensity(f,width,height))),maxSpan=Math.max(...frames.map(bgraLumSpan));
  let maxStep=0;for(let i=1;i<frames.length;i++)maxStep=Math.max(maxStep,bgraChange(frames[i-1],frames[i]),bgraChange(frames[0],frames[i]));
  const blank=maxEdge<.0005&&maxSpan<40,still=maxStep<.0002;
  return{blank,still,maxStep,maxEdge,maxSpan,reason:blank?`all ${frames.length} sampled frames are blank (edge density ${(maxEdge*100).toFixed(3)}%, luminance span ${maxSpan.toFixed(0)})`:still?`all ${frames.length} sampled frames are identical (max pixel change ${(maxStep*100).toFixed(4)}% < 0.02%)`:''}
}
