import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import {
  activeAt,
  geometryErrors,
  REPRESENTATIVE_FRACTIONS,
  representativeSubjectError,
  subjectHardError,
  subjectHardValid,
  subjectMetrics,
  subjectQualityValid,
  subjectScaleError,
  type MotionObject,
  type MotionRect,
} from "./geometry";
import {
  opaqueBackdropReport,
  type SceneLayout,
} from "./scene-coverage";
import {
  contrastRatio,
  sampleBackdropColor,
  subjectRegionContrast,
  TEXT_LEGIBILITY_PROBE,
  textFindings,
  uniqueErrors,
  type TextLegibilityItem,
  type TextSkippedItem,
} from "./quality";

export interface PreflightScene {
  win: BrowserWindow;
  width: number;
  height: number;
  duration: number;
  mode: string;
  alpha: boolean;
  boundsViewport: { width: number; height: number };
  objects: MotionObject[];
  getRuntimeErrors: () => string[];
  seek: (time: number) => Promise<void>;
  captureBitmap: () => Promise<Buffer>;
  warn: (message: string) => void;
  fail: (gate: string, message: string) => never;
  note: (message: string) => void;
  gates: { subjectBounds: boolean; stageContrast: boolean; textLegibility: boolean };
}

// Subject + support + background geometry, boundary errors, and local subject
// contrast, shared by the GSAP capture loop and the HyperFrames engine path.
// Only the seek mechanism and bitmap source differ per engine.
export async function runSubjectGeometryPreflight(args: PreflightScene): Promise<void> {
    const reports: string[] = [],
      boundaryErrors: string[] = [],
      representative = new Set<number>(REPRESENTATIVE_FRACTIONS),
      subject = args.objects.find((item) => item.role === "subject"),
      supportState = new Map<string, { valid: boolean; errors: string[] }>();
    let bestSubject:
      | { rect: MotionRect; fraction: number; score: number }
      | undefined;
    let settledSubjectHardValid = false,
      settledSubjectQualityValid = false;
    // Worst subject-vs-neighborhood contrast across settled frames; the modal stage
    // number fail-opens on non-flat backgrounds, this one does not.
    let worstRegion: { contrast: number; reason: string } | undefined;
    // An object whose rect covers the whole stage box is layout chrome (the stage
    // container itself), not film content; judging it against the stage it defines
    // would gate on its own rounding.
    const containerSized = (r: MotionRect | undefined) =>
      !!r &&
      r.x <= 1 &&
      r.y <= 1 &&
      r.x + r.width >= args.boundsViewport.width - 1 &&
      r.y + r.height >= args.boundsViewport.height - 1;
    for (const fraction of [0, 0.25, ...REPRESENTATIVE_FRACTIONS, 0.999]) {
      const time = args.duration * fraction;
      await args.seek(time);
      const runtimeErrors = args.getRuntimeErrors();
      if (runtimeErrors.length)
        reports.push(
          `t=${time.toFixed(3)}s runtime error: ${runtimeErrors.at(-1)}`,
        );
      const rects = (await args.win.webContents.executeJavaScript(
        `(()=>{const rect=e=>{const rs=[...e.getClientRects()];if(rs.length)return{x:Math.min(...rs.map(r=>r.left)),y:Math.min(...rs.map(r=>r.top)),width:Math.max(...rs.map(r=>r.right))-Math.min(...rs.map(r=>r.left)),height:Math.max(...rs.map(r=>r.bottom))-Math.min(...rs.map(r=>r.top))};if(e instanceof SVGGraphicsElement)try{const b=e.getBBox(),m=e.getScreenCTM();if(m){const p=[new DOMPoint(b.x,b.y),new DOMPoint(b.x+b.width,b.y+b.height)].map(x=>x.matrixTransform(m));return{x:Math.min(p[0].x,p[1].x),y:Math.min(p[0].y,p[1].y),width:Math.abs(p[1].x-p[0].x),height:Math.abs(p[1].y-p[0].y)}}}catch{}const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return Object.fromEntries((window.__MOTIONFORGE_OBJECTS__||[]).map(o=>{const e=document.getElementById(o.id);return[o.id,e?rect(e):null]}))})()`,
      )) as Record<string, MotionRect | undefined>;
      const backgrounds: MotionRect[] = [];
      for (const item of args.objects) {
        const rect = rects[item.id];
        if (!rect)
          (item.role === "background" || item.allowCrop ? reports : boundaryErrors).push(
            `t=${time.toFixed(3)}s missing element #${item.id}`,
          );
        if (item.role === "background") {
          if (rect) backgrounds.push(rect);
          for (const error of geometryErrors(
            item,
            rect,
            { width: args.width, height: args.height },
            args.alpha,
          ))
            reports.push(`t=${time.toFixed(3)}s ${error}`);
        } else if (
          (representative.has(fraction) || fraction === 0.999) &&
          activeAt(item, fraction)
        ) {
          // Split chrome (playhead, draft strip) sits below the stage box by design;
          // only objects reaching into the film stage are judged against stage bounds.
          const stripOnly =
            args.mode === "split" && !!rect && rect.y >= args.boundsViewport.height;
          const stageSized = containerSized(rect);
          if (item.role === "subject" && rect && (stripOnly || stageSized)) {
            // A subject that fills the stage (inset:0 wrapper) or sits in the strip
            // has no measurable box: fail loudly instead of skipping silently.
            boundaryErrors.push(
              `t=${time.toFixed(3)}s subject #${item.id} ${
                stripOnly
                  ? "sits outside the film stage (in the draft strip); the subject belongs on the film stage"
                  : "covers the whole stage box; wrap the visible subject tightly instead of stretching the wrapper over the stage"
              }`,
            );
          } else if (!stripOnly && !stageSized) {
          // allowCrop declares edge intent: transient effects (light sweeps, glows) may
          // cross or leave the stage, so they contribute nothing to boundary errors.
          const errors = item.allowCrop
            ? []
            : geometryErrors(item, rect, args.boundsViewport, args.alpha);
          if (item.role === "subject") {
            if (rect && errors.length)
              boundaryErrors.push(
                ...errors.map((error) => `t=${time.toFixed(3)}s ${error}`),
              );
            if (rect && !errors.length) {
              const metrics = subjectMetrics(rect, args.boundsViewport),
                score = Math.max(
                  metrics.area / 0.08,
                  metrics.width / 0.3,
                  metrics.height / 0.35,
                );
              if (!bestSubject || score > bestSubject.score)
                bestSubject = { rect, fraction, score };
              settledSubjectHardValid ||= subjectHardValid(
                item,
                rect,
                args.boundsViewport,
              );
              settledSubjectQualityValid ||= subjectQualityValid(
                item,
                rect,
                args.boundsViewport,
              );
              // Local contrast at this settled frame: an environmental subject (one
              // that covers the stage) carries no neighborhood to compare against.
              if (!args.alpha) {
                const stageArea = args.boundsViewport.width * args.boundsViewport.height;
                if ((rect.width * rect.height) / stageArea < 0.9) {
                  const frame = await args.captureBitmap();
                  const rc = subjectRegionContrast(frame, args.width, args.height, rect, 2.5, 48, {
                    x0: 0,
                    y0: 0,
                    x1: args.boundsViewport.width,
                    y1: args.boundsViewport.height,
                  });
                  if (rc && (!worstRegion || rc.contrast < worstRegion.contrast))
                    worstRegion = { contrast: rc.contrast, reason: rc.reason ?? '' };
                }
              }
            }
          } else {
            const state = supportState.get(item.id) || {
              valid: false,
              errors: [],
            };
            state.valid ||= !!rect && !errors.length;
            state.errors.push(
              ...errors.map((error) => `t=${time.toFixed(3)}s ${error}`),
            );
            supportState.set(item.id, state);
          }
          }
        }
      }
      if (!args.alpha) {
        const currentLayout = (await args.win.webContents.executeJavaScript(
          `(()=>{const paints=[...document.querySelectorAll('*')].flatMap(e=>{const s=getComputedStyle(e),visible=s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0,paint=visible&&(s.backgroundColor!=='transparent'&&!/rgba\\([^)]*,\\s*0(?:\\.0+)?\\s*\\)/.test(s.backgroundColor)||s.backgroundImage!=='none'||e instanceof HTMLCanvasElement||e instanceof SVGGraphicsElement);if(!paint)return[];const r=e.getBoundingClientRect();return r.width>0&&r.height>0?[{tag:e.tagName.toLowerCase(),rect:{x:r.x,y:r.y,width:r.width,height:r.height},background:s.backgroundColor!=='transparent'||s.backgroundImage!=='none',paint:true}]:[]});return{paints}})()`,
        )) as SceneLayout;
        const image = await args.captureBitmap(),
          size = { width: args.width, height: args.height },
          backdrop = opaqueBackdropReport(
            currentLayout,
            backgrounds,
            image,
            size.width,
            size.height,
          );
        if (!backdrop.ok)
          reports.push(
            `t=${time.toFixed(3)}s opaque background coverage ${(backdrop.coverage * 100).toFixed(1)}%, pixel occupancy ${(backdrop.pixelOccupied * 100).toFixed(1)}%, bounds ${(backdrop.pixelBounds * 100).toFixed(1)}%`,
          );
      }
    }
    for (const state of supportState.values())
      boundaryErrors.push(...state.errors);
    if (!subject)
      reports.push(representativeSubjectError(args.objects, false)!);
    else if (!settledSubjectHardValid) {
      const error = bestSubject
        ? subjectHardError(
            subject,
            bestSubject.rect,
            args.boundsViewport,
            bestSubject.fraction,
          )
        : undefined;
      reports.push(error || representativeSubjectError(args.objects, false)!);
    }
    const unique = uniqueErrors(reports);
    for (const warning of unique)
      args.note(warning);
    for (const message of uniqueErrors(boundaryErrors)) {
      if (args.gates.subjectBounds)
        args.fail("subject bounds", message);
      else args.note(message);
    }
    if (worstRegion && worstRegion.contrast < 2.5) {
      const message =
        worstRegion.reason ||
        `subject and nearby background contrast is ${worstRegion.contrast.toFixed(2)}, below the required 2.5`;
      if (args.gates.stageContrast)
        args.fail("stage contrast", message);
      else args.note(message);
    }
    if (
      subject &&
      bestSubject &&
      !settledSubjectQualityValid
    ) {
      const quality = subjectScaleError(
        subject,
        bestSubject.rect,
        args.boundsViewport,
        bestSubject.fraction,
      );
      if (quality)
        args.note(quality);
    }
}

// Text legibility probe across sample instants, shared by both engines. Returns the
// combined findings and the unmeasurable-label note (empty when clean); the caller
// records them on its report and applies its own gate.
export async function runTextLegibilityProbe(args: {
  win: BrowserWindow;
  lastTime: number;
  seek: (time: number) => Promise<void>;
  capture?: () => Promise<Buffer>;
  width?: number;
  height?: number;
}): Promise<{ findings: string[]; skipped: string[]; skippedItems: TextSkippedItem[] }> {
  const found: TextLegibilityItem[] = [];
  const skippedLabels: string[] = [];
  const skippedItems: TextSkippedItem[] = [];
  const smallStatic: { label: string; fontSize: number }[] = [];
  const rasterFindings: string[] = [];
  // Nine samples a second apart: promo labels often flash in narrow windows that a
  // sparse probe misses entirely while still reading clearly on screen.
  for (const time of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((f) => args.lastTime * f)) {
    await args.seek(time);
    const probe = (await args.win.webContents.executeJavaScript(TEXT_LEGIBILITY_PROBE, true)) as { items: TextLegibilityItem[]; skipped: (string | TextSkippedItem)[]; small: { label: string; fontSize: number }[] };
    found.push(...(probe.items ?? []));
    const skippedNow: TextSkippedItem[] = [];
    for (const s of probe.skipped ?? []) {
      if (typeof s === "string") skippedLabels.push(s);
      else {
        skippedLabels.push(s.label);
        skippedItems.push(s);
        skippedNow.push(s);
      }
    }
    smallStatic.push(...(probe.small ?? []));
    // Raster fallback for gradient/translucent-backed labels: measure the painted
    // pixels behind the label box instead of guessing from DOM colors.
    if (skippedNow.length && args.capture && args.width && args.height) {
      let bitmap: Buffer | undefined;
      try {
        bitmap = await args.capture();
      } catch {
        bitmap = undefined;
      }
      if (bitmap) {
        for (const s of skippedNow) {
          if (!Number.isFinite(s.fontSize)) continue;
          const bg = sampleBackdropColor(bitmap, args.width, args.height, s, s.color);
          if (!bg) continue;
          const need = s.fontSize >= 24 ? 3 : 4.5;
          const ratio = contrastRatio(s.color, bg);
          if (ratio < need)
            rasterFindings.push(
              `${s.label}: contrast ${ratio.toFixed(2)} below ${need} (text ${s.color} on sampled ${bg}, ${s.fontSize}px)`,
            );
        }
      }
    }
  }
  const skipped = uniqueErrors(skippedLabels);
  const findings = uniqueErrors([
    ...textFindings(found),
    ...smallStatic.map((s) => `${s.label}: font size ${s.fontSize}px below 12px`),
    ...rasterFindings,
  ]);
  return { findings, skipped, skippedItems };
}

export function framePlan(duration: number, fps: number) {
  const count = Math.max(1, Math.round(duration * fps));
  return { count, lastTime: (count - 1) / fps, duration: count / fps };
}
export function renderWindowOptions(
  width: number,
  height: number,
  partition = "motionforge-test",
  alpha = false,
): BrowserWindowConstructorOptions {
  return {
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    transparent: alpha,
    backgroundColor: alpha ? "#00000000" : "#ffffff",
    enableLargerThanScreen: true,
    webPreferences: {
      javascript: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
      offscreen: true,
      partition,
    },
  };
}
export async function seekAndFlush(win: BrowserWindow, time: number) {
  // Advance the deterministic virtual clock to this frame's time and let all queued
  // requestAnimationFrame callbacks run for exactly that timestamp.
  await win.webContents.executeJavaScript(
    `window.__TIMECUT_SET_TIME__(${time});void document.documentElement.offsetHeight`,
  );
  await new Promise<void>((resolve, reject) => {
    const painted = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      win.webContents.removeListener("paint", painted);
      reject(new Error(`Renderer did not paint frame at t=${time.toFixed(3)}s.`));
    }, 5000);
    win.webContents.once("paint", painted);
    win.webContents.invalidate();
  });
}
export async function hfSeekAndFlush(win: BrowserWindow, compositionId: string, time: number): Promise<void> {
  // The HyperFrames runtime owns the clock; the harness seeks the registered paused
  // timeline directly, then waits for a real paint like the GSAP path does.
  await win.webContents.executeJavaScript(`void window.__timelines[${JSON.stringify(compositionId)}].seek(${time}, false)`);
  const waitPaint = () => new Promise<void>((resolve, reject) => {
    const painted = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      win.webContents.removeListener("paint", painted);
      reject(new Error(`Renderer did not paint frame at t=${time.toFixed(3)}s.`));
    }, 5000);
    win.webContents.once("paint", painted);
    win.webContents.invalidate();
  });
  try {
    await waitPaint();
  } catch {
    // One retry like the GSAP capture path: a missed paint frame is transient.
    await win.webContents.executeJavaScript(`void window.__timelines[${JSON.stringify(compositionId)}].seek(${time}, false)`);
    await waitPaint();
  }
}

// Preview stills for the approval gate: head/middle/tail frames captured with the
// engine-appropriate clock, saved as JPEGs for the UI. Not a render. The caller
// prepares loadFile: GSAP gets an injected clock+runtime copy, HyperFrames its
// staged index.html (tag + staged gsap file).
export async function capturePreviewStills(args: {
  mode: string;
  width: number;
  height: number;
  duration: number;
  fps?: number;
  loadFile: string;
  outDir: string;
  prefix: string;
  signal: AbortSignal;
}): Promise<string[]> {
  // Concept mode (WAAPI scenes) has neither the virtual clock nor a HyperFrames
  // timeline to seek; the review page shows its live composition instead.
  const win = new BrowserWindow(renderWindowOptions(args.width, args.height, `preview-${Date.now()}`, false));
  win.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !details.url.startsWith("file:") }),
  );
  const runtimeErrors: string[] = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) runtimeErrors.push(message);
  });
  try {
    if (args.signal.aborted) throw args.signal.reason || new Error("Stopped.");
    await win.loadFile(args.loadFile);
    const canvasScene = await win.webContents.executeJavaScript(`!!window.__GEOF_SCENE__`);
    if (args.mode === 'concept' && !canvasScene) return [];
    if (args.mode === "hyperframes" && !canvasScene) {
      const start = Date.now();
      for (;;) {
        if (args.signal.aborted) throw args.signal.reason || new Error("Stopped.");
        const ready = await win.webContents.executeJavaScript(`!!(window.__timelines && window.__timelines["main"])`);
        if (ready) break;
        if (Date.now() - start > 30000) throw new Error("Preview scene did not register its timeline within 30 seconds.");
        await new Promise((r) => setTimeout(r, 250));
      }
    } else {
      const ready = await win.webContents.executeJavaScript(
        `new Promise(resolve=>{if(window.__MOTIONFORGE_READY__===true)return resolve(true);const timer=setTimeout(()=>resolve(false),5000);window.addEventListener('motionforge:ready',()=>{clearTimeout(timer);resolve(window.__MOTIONFORGE_READY__===true)},{once:true})})`,
      );
      if (!ready) throw new Error("Preview scene did not signal readiness within 5 seconds.");
    }
    win.setContentSize(args.width, args.height, false);
    const metrics = await win.webContents.executeJavaScript(`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})`);
    if (metrics.dpr !== 1 || metrics.width !== args.width || metrics.height !== args.height)
      throw new Error(`Preview viewport mismatch: expected ${args.width}x${args.height} at DPR 1.`);
    if (runtimeErrors.length) throw new Error(`Preview scene initialization failed: ${runtimeErrors.at(-1)}`);
    const paths: string[] = [];
    const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Sleep-settled seeks, not paint-event waits: these windows produce no spontaneous
    // paint events to wait on, while capturePage drives its own frame reliably.
    // Stills are approximate human previews, never measurement frames.
    await settle(1200);
    for (const [index, fraction] of [0, 0.5, 1].entries()) {
      // Canvas wraps at t==duration (frame 300 -> frame 0), so the final still uses the last real frame.
      const time = canvasScene && fraction === 1 ? Math.max(0, args.duration - 1 / (args.fps ?? 30)) : args.duration * fraction;
      if (args.signal.aborted) throw args.signal.reason || new Error("Stopped.");
      if (canvasScene)
        await win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('motionforge:frame',{detail:${time}}))`);
      else if (args.mode === "hyperframes")
        await win.webContents.executeJavaScript(`void window.__timelines["main"].seek(${time}, false)`);
      else await win.webContents.executeJavaScript(`window.__TIMECUT_SET_TIME__(${time})`);
      await settle(400);
      const out = path.join(args.outDir, `${args.prefix}-preview-${index}.jpg`);
      let shot;
      try {
        shot = await win.webContents.capturePage();
      } catch {
        await settle(400);
        shot = await win.webContents.capturePage();
      }
      await fs.writeFile(out, shot.toJPEG(70));
      paths.push(out);
    }
    return paths;
  } finally {
    try { win.destroy(); } catch {}
  }
}
