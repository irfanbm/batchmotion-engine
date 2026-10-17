import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Job, Settings } from "./types";
import {
  type MotionObject,
  type MotionRect,
} from "./geometry";
import {
  beatCoherenceReport,
  blackSlabReport,
  cameraMotionReport,
  cropBitmap,
  flickerReport,
  kineticReport,
  motionActivityReport,
  pixelChangeRatio,
  spikeReport,
  stageContentReport,
  canvasLivenessReport,
  type StageRegion,
} from "./quality";
import {
  framePlan,
  renderWindowOptions,
  runSubjectGeometryPreflight,
  runTextLegibilityProbe,
  seekAndFlush,
} from "./preflight";
import {
  alphaReportText,
  alphaTimelineReport,
  normalizeOutputFormat,
  outputExtension,
  requiredDiskBytes,
  verifyEncodedAlpha,
  verifyProbe,
  videoEncodeArgs,
} from "./output-format";
import {
  pixelSceneCoverage,
  type SceneLayout,
} from "./scene-coverage";
import { normalizeThrown, optionalVisualAnalyzer, visualGateFinding } from "./errors";
import { injectVirtualClock } from "./virtual-clock";
import { ensureGsapRuntime } from "./gsap-runtime";
import { validateHtml } from "./validation";

// Gradual quality-gate rollout. Each diagnostic can be enabled independently so we can
// turn on measured enforcement one check at a time and watch its real false-positive rate
// before enabling the next. motionActivity and flicker graduate first (rejects effectively-
// still scenes and strobing output); the rest stay warn-only until their regression
// coverage exists. The env var BATCHMOTION_VISUAL_GATES=off disables enforcement entirely.
const gatesFromEnv = process.env.BATCHMOTION_VISUAL_GATES !== "off";
export const VISUAL_GATES = {
  motionActivity: gatesFromEnv,
  openingFrame: gatesFromEnv, // opening frame must show content; flat-background contrast floor at t=0
  stageContrast: gatesFromEnv, // subject keeps contrast against the stage across the clip
  textLegibility: gatesFromEnv, // DOM text probe: minimum size and contrast per label
  subjectBounds: gatesFromEnv, // subject/support must not be clipped or fully outside at settled frames
  blackSlab: gatesFromEnv, // pure-black mass above 8% of the stage is a void slab, not night
  geometry: false,
  flicker: false, // Sparse frame deltas are not a calibrated flicker detector.
  loopEndpoint: false,
  beatCoherence: false, // recorded for telemetry; enforced later once compliance is measured
  cameraMotion: gatesFromEnv,
  kinetic: false,
  spike: false, // Sparse samples cannot distinguish a cut from intentional acceleration.
} as const;
// Backwards-compatible alias used by the legacy warn-or-throw helper for checks that are
// still warn-only. Once a check graduates it is driven by its own flag above.
export const EXPERIMENTAL_VISUAL_GATES = false;

// A rejected render caused by an enabled visual-quality gate. Distinct from a hard
// render/crash failure so the queue can regenerate the scene and retry instead of
// immediately marking the job failed.
export class RenderQualityError extends Error {
  readonly quality = true;
  // Attached render frames (data URLs, downscaled) for vision-capable repair.
  // Undefined when the failure carries no pixels (DOM gates, GSAP capture loop).
  frames?: string[];
  constructor(message: string) {
    super(message);
    this.name = "RenderQualityError";
  }
}
export const isRenderQualityError = (e: unknown): e is RenderQualityError =>
  e instanceof RenderQualityError ||
  (typeof e === "object" && e !== null && (e as { quality?: unknown }).quality === true);

// Hard-failing variant of visualGateFinding for graduated checks. Throws a
// RenderQualityError so the queue can reject-and-retry; still logs the finding first.
function qualityGateReject(gate: string, message: string, onWarning: (m: string) => void): never {
  try {
    onWarning(`Visual quality gate (${gate}) rejected render: ${message}`);
  } catch {}
  throw new RenderQualityError(`${gate} quality gate: ${message}`);
}

// The text probe string lives in quality.ts (unit-testable); the render below only
// evaluates it inside the page. Findings computation also lives there.

export interface RenderReport {
  motionMaxDelta: number; // max pixel-change ratio between consecutive sampled frames
  motionThreshold: number; // the gate threshold actually applied
  motionPass: boolean; // whether the scene cleared the motion-activity gate
  activeFramePct: number; // % of sampled consecutive frames with change above threshold
  loopChecked: boolean; // whether a loop-endpoint measurement ran this render
  loopEndpointChange: number | null; // first-vs-last pixel-change ratio (looping jobs)
  loopEndpointLimit: number | null;
  loopOk: boolean | null;
  flickerReversals: number; // direction reversals in the motion-activity series
  flickerMaxSwing: number; // largest single swing between consecutive samples
  flickerOk: boolean; // whether the flicker gate was satisfied
  beatChecked: boolean; // whether a beat-coherence measurement ran this render
  beatOk: boolean | null; // beat table present and regular (warning-only for now)
  beatReason: string | null; // e.g. "BEATS table missing"
  cameraTranslation: number; // max content-centroid translation across the clip (frame fraction)
  cameraActiveRatio: number; // share of consecutive sampled frames that change at all
  cameraMotionOk: boolean; // false when the shot is a locked static frame
  cameraStrongRatio: number; // max share of pixels changing >40/255 between sampled frames
  openCoverage: number | null; // content share of the opening stage (null in alpha output)
  stageContrast: number | null; // worst subject-vs-background luminance ratio on flat backgrounds (null when none)
  textFindings: string[]; // text legibility findings from the DOM probe (empty when clear)
  kineticLinearity: number; // 0 = clearly eased/organic, 1 = fully linear/mechanical
  kineticOk: boolean; // false when motion speed is suspiciously constant
  kineticWarning: boolean; // true when motion is mechanical and survived retries (sortable flag)
  spikeOk: boolean | null; // false when an element abruptly appears/disappears/stretches
  spikeCount: number; // number of detected geometry-pop frames
  spikeMaxRatio: number; // worst spike as a multiple of the mean delta
  blackSlabShare: number | null; // worst pure-black share across sampled frames (null when unmeasured)
}

export function defaultRenderReport(): RenderReport {
  return {
    motionMaxDelta: 0,
    motionThreshold: 0,
    motionPass: true,
    activeFramePct: 0,
    loopChecked: false,
    loopEndpointChange: null,
    loopEndpointLimit: null,
    loopOk: null,
    flickerReversals: 0,
    flickerMaxSwing: 0,
    flickerOk: true,
    beatChecked: false,
    beatOk: null,
    beatReason: null,
    cameraTranslation: 0,
    cameraActiveRatio: 1,
    cameraMotionOk: true,
    cameraStrongRatio: 0,
    openCoverage: null,
    stageContrast: null,
    textFindings: [],
    kineticLinearity: 0,
    kineticOk: true,
    kineticWarning: false,
    spikeOk: null,
    spikeCount: 0,
    spikeMaxRatio: 0,
    blackSlabShare: null,
  };
}

function safeName(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
      .trim()
      .slice(0, 64) || "Untitled"
  );
}
export function promptFileName(prompt: string) {
  return safeName(prompt.split(/[.;!?\r\n]/, 1)[0]);
}
export function assertRenderDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error(`Invalid render viewport ${width}x${height}.`);
  if (width > 16384 || height > 16384)
    throw new Error(
      `Render viewport ${width}x${height} exceeds the supported Chromium texture limit of 16384 pixels per axis.`,
    );
}
export async function saveProject(
  job: Job,
  html: string,
  folder: string,
  baseName: string,
) {
  await fs.mkdir(folder, { recursive: true });
  const htmlPath = path.join(folder, `${baseName}.html`);
  await fs.writeFile(htmlPath, html);
  return htmlPath;
}
function runFfmpeg(
  args: string[],
  executable: string,
  signal: AbortSignal,
  onLog: (line: string) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
      onLog(String(data).trim());
    });
    child.on("error", (error) =>
      reject(
        new Error(
          (error as NodeJS.ErrnoException).code === "ENOENT"
            ? "FFmpeg not found. Configure its path in Settings."
            : error.message,
        ),
      ),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`FFmpeg failed (${code}): ${stderr.slice(-600)}`)),
    );
    signal.addEventListener("abort", () => child.kill(), { once: true });
  });
}
export function ffmpegExecutable(configured: string) {
  return app.isPackaged
    ? path.join(process.resourcesPath, "ffmpeg", "ffmpeg.exe")
    : configured;
}
function ffprobeExecutable(configured: string) {
  const ffmpeg = ffmpegExecutable(configured);
  return path.join(
    path.dirname(ffmpeg),
    process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
  );
}
function probeVideo(file: string, configured: string, signal: AbortSignal) {
  return new Promise<any>((resolve, reject) => {
    const child = spawn(
        ffprobeExecutable(configured),
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
        { windowsHide: true },
      ),
      chunks: Buffer[] = [];
    child.stdout.on("data", (x) => chunks.push(x));
    child.on("error", (e) =>
      reject(new Error(`FFprobe is required beside FFmpeg: ${e.message}`)),
    );
    child.on("close", (code) => {
      try {
        if (code !== 0) throw new Error(`FFprobe failed (${code}).`);
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    signal.addEventListener("abort", () => child.kill(), { once: true });
  });
}
export function hasVisualVariation(bitmap: Buffer) {
  return pixelSceneCoverage(bitmap, Math.max(1, bitmap.length / 4), 1)
    .variation;
}
export function hasSceneCoverage(
  bitmap: Buffer,
  width: number,
  height: number,
) {
  const report = pixelSceneCoverage(bitmap, width, height);
  return report.occupiedRatio >= 0.005 && report.boundsRatio >= 0.03;
}
export { pixelChangeRatio } from "./quality";
export function endpointReport(frames: Buffer[], looping: boolean) {
  const ratios = frames
      .slice(1)
      .map((frame, index) => pixelChangeRatio(frames[index], frame)),
    change = Math.max(...ratios),
    limit = looping ? 0.08 : 0.035;
  /* ponytail: sampled RGB thresholds tolerate antialiasing/subtle ambience; tune only from real false-positive telemetry. */ return {
    ok: change <= limit,
    change,
    limit,
    ratios,
  };
}

async function encodeVideo(
  frames: string,
  output: string,
  settings: Settings,
  signal: AbortSignal,
  onLog: (line: string) => void,
) {
  if (settings.outputFormat === "mov-prores4444-alpha") {
    await runFfmpeg(
      videoEncodeArgs(
        settings.outputFormat,
        settings.fps,
        path.join(frames, "frame-%06d.png"),
        output,
      ),
      ffmpegExecutable(settings.ffmpegPath),
      signal,
      onLog,
    );
    return;
  }
  const input = [
    "-y",
    "-framerate",
    String(settings.fps),
    "-i",
    path.join(frames, "frame-%06d.png"),
  ];
  const common = [
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    "-movflags",
    "+faststart",
  ];
  try {
    await runFfmpeg(
      [
        ...input,
        ...common,
        "-preset",
        "medium",
        "-crf",
        "18",
        "-threads",
        "4",
        output,
      ],
      ffmpegExecutable(settings.ffmpegPath),
      signal,
      onLog,
    );
  } catch (firstError) {
    if (signal.aborted) throw firstError;
    // ponytail: software fallback favors reliability; expose hardware encoder selection if 4K throughput becomes a requirement.
    onLog(
      `Primary encoder failed; retrying memory-safe mode: ${(firstError as Error).message}`,
    );
    await fs.rm(output, { force: true });
    try {
      await runFfmpeg(
        [
          ...input,
          ...common,
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-threads",
          "2",
          output,
        ],
        ffmpegExecutable(settings.ffmpegPath),
        signal,
        onLog,
      );
    } catch (fallbackError) {
      throw new Error(
        `4K encoding failed in normal and memory-safe modes. Close memory-intensive applications and verify free disk space. ${(fallbackError as Error).message}`,
      );
    }
  }
}
export async function renderVideo(
  folder: string,
  baseName: string,
  job: Job,
  settings: Settings,
  signal: AbortSignal,
  progress: (value: number) => void,
  onLog: (line: string) => void,
): Promise<RenderReport> {
  assertRenderDimensions(job.width, job.height);
  signal.throwIfAborted();
  const html = await fs.readFile(path.join(folder, `${baseName}.html`), 'utf8');
   const canvasScene = html.includes('window.__GEOF_SCENE__=scene;') && html.includes('scene.drawFrame(ctx,');
   const validation = canvasScene ? [] : validateHtml(html, settings.outputFormat === 'mov-prores4444-alpha', { split: job.mode === 'split' });
  if (validation.length) throw new Error(`Static validation failed before capture: ${validation.join('; ')}`);
  const captureHtml = path.join(folder, `.capture-${job.id}.html`);
  const report = defaultRenderReport();
  const format = normalizeOutputFormat(job.outputFormat),
    alpha = format === "mov-prores4444-alpha",
    disk = await fs.statfs(folder),
    needed = requiredDiskBytes(
      format,
      job.width,
      job.height,
      settings.fps,
      job.duration,
    );
  if (disk.bavail * disk.bsize < needed)
    throw new Error(
      `Insufficient disk space: about ${(needed / 1e9).toFixed(1)} GB required for PNG frames, output, and headroom.`,
    );
  const frames = path.join(folder, `.frames-${job.id}`);
  await fs.mkdir(frames);
  const win = new BrowserWindow(
    renderWindowOptions(job.width, job.height, `motionforge-${job.id}`, alpha),
  );
  win.webContents.session.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !details.url.startsWith("file:") }),
  );
  const runtimeErrors: string[] = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 3) runtimeErrors.push(message);
  });
  win.webContents.on("render-process-gone", (_event, details) =>
    runtimeErrors.push(`Renderer process ended: ${details.reason}`),
  );
  const latestFatalRuntime = () => runtimeErrors[runtimeErrors.length - 1];
  const assertRuntimeHealthy = (stage: string) => {
    const fatal = latestFatalRuntime();
    if (fatal)
      throw new Error(`Browser runtime initialization failed during ${stage}: ${fatal}`);
  };
  const visualWarning = (message: string) => onLog(message);
  const capture = async (stage: string) => {
    let firstError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal.aborted) throw signal.reason || new Error("Generation stopped.");
      const fatal = latestFatalRuntime();
      if (fatal) throw new Error(`Browser runtime initialization failed: ${fatal}`);
      try {
        return await win.webContents.capturePage();
      } catch (error) {
        firstError = error;
        if (attempt === 1) onLog(`Capture warning at ${stage}; retrying once: ${normalizeThrown(error, "frame-capture").message}`);
      }
    }
    const normalized = normalizeThrown(firstError, "frame-capture");
    throw new Error(`${normalized.message} Capture stage: ${stage}.`, { cause: firstError });
  };
  try {
    // A host-generated capture copy installs the clock before any scene script (and any
    // injected GSAP runtime, which loads after the clock). Original HTML remains portable;
    // clock installation failure is never fail-open.
    await fs.writeFile(captureHtml, injectVirtualClock(ensureGsapRuntime(html)));
    await win.loadFile(captureHtml);
    if (!await win.webContents.executeJavaScript(`typeof window.__TIMECUT_SET_TIME__ === 'function' && performance.now() === 0`))
      throw new Error('Deterministic clock initialization failed.');
    // Reassert content bounds after navigation: Windows may constrain framed outer bounds to the work area.
    win.setContentSize(job.width, job.height, false);
    const content = win.getContentBounds();
    if (content.width !== job.width || content.height !== job.height)
      throw new Error(
        `Electron could not allocate the exact ${job.width}x${job.height} content viewport; got ${content.width}x${content.height}. Check OS display limits or Chromium texture support.`,
      );
    const metrics = await win.webContents.executeJavaScript(
      `({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})`,
    );
    if (metrics.dpr !== 1)
      throw new Error(
        `Motion renderer requires DPR 1, got ${metrics.dpr}. Fully restart Batchmotion after changing renderer settings.`,
      );
    const ready = await win.webContents.executeJavaScript(
      `new Promise(resolve=>{if(window.__MOTIONFORGE_READY__===true)return resolve(true);const timer=setTimeout(()=>resolve(false),5000);window.addEventListener('motionforge:ready',()=>{clearTimeout(timer);resolve(window.__MOTIONFORGE_READY__===true)},{once:true})})`,
    );
    if (!ready)
      throw new Error(
        `Motion scene did not signal readiness within 5 seconds.${runtimeErrors.length ? ` Runtime error: ${runtimeErrors.at(-1)}` : " Ensure initialization sets window.__MOTIONFORGE_READY__=true and dispatches motionforge:ready."}`,
      );
    assertRuntimeHealthy("readiness");
    if (runtimeErrors.length)
      throw new Error(
        `Motion scene initialization failed: ${runtimeErrors.at(-1)}`,
      );
    const layout = (await win.webContents.executeJavaScript(
      `(()=>{const rect=e=>{let rs=[...e.getClientRects()];if(!rs.length&&e instanceof SVGGraphicsElement){try{const b=e.getBBox(),m=e.getScreenCTM();if(m){const p=[new DOMPoint(b.x,b.y),new DOMPoint(b.x+b.width,b.y),new DOMPoint(b.x,b.y+b.height),new DOMPoint(b.x+b.width,b.y+b.height)].map(x=>x.matrixTransform(m)),xs=p.map(x=>x.x),ys=p.map(x=>x.y);return{x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)}}}catch{}}const r=rs.length?{left:Math.min(...rs.map(x=>x.left)),top:Math.min(...rs.map(x=>x.top)),right:Math.max(...rs.map(x=>x.right)),bottom:Math.max(...rs.map(x=>x.bottom))}:e.getBoundingClientRect();return{x:r.left,y:r.top,width:r.right-r.left,height:r.bottom-r.top}},visible=s=>s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0,color=s=>{if(s==='transparent'||s==='none')return false;const m=s.match(/rgba?\\(([^)]+)\\)/);return!m||m[1].split(',').length<4||Number(m[1].split(',')[3])>0},html=document.documentElement,body=document.body,paints=[...document.querySelectorAll('*')].flatMap(e=>{const s=getComputedStyle(e);if(!visible(s))return[];const background=color(s.backgroundColor)||s.backgroundImage!=='none',paint=background||e instanceof HTMLCanvasElement||(e instanceof SVGGraphicsElement&&(color(s.fill)||color(s.stroke)));if(!paint)return[];const r=rect(e);return r.width>0&&r.height>0?[{tag:e.tagName.toLowerCase(),rect:r,background,paint}]:[]});return{w:innerWidth,h:innerHeight,html:rect(html),body:rect(body),htmlMargin:getComputedStyle(html).margin,bodyMargin:getComputedStyle(body).margin,paints}})()`,
    )) as SceneLayout & {
      w: number;
      h: number;
      html: MotionRect;
      body: MotionRect;
      htmlMargin: string;
      bodyMargin: string;
    };
    if (layout.w !== job.width || layout.h !== job.height)
      throw new Error(
        `Motion viewport mismatch: expected ${job.width}x${job.height}, got ${layout.w}x${layout.h} at DPR 1.`,
      );
    const fills = (rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) =>
      Math.abs(rect.x) <= 1 &&
      Math.abs(rect.y) <= 1 &&
      rect.width >= job.width - 1 &&
      rect.height >= job.height - 1;
    if (
      layout.htmlMargin !== "0px" ||
      layout.bodyMargin !== "0px" ||
      !fills(layout.html) ||
      !fills(layout.body)
    )
      throw new Error(
        `Motion layout does not fill the ${job.width}x${job.height} viewport: html/body must start at 0,0 with zero margin and cover the viewport.`,
      );
    const objects = (await win.webContents.executeJavaScript(
      `window.__MOTIONFORGE_OBJECTS__`,
    )) as MotionObject[] | undefined;
    if (!canvasScene && (!Array.isArray(objects) || !objects.length))
      throw new Error(
        "Runtime preflight failed: window.__MOTIONFORGE_OBJECTS__ must contain meaningful background, subject, and support metadata.",
      );
    if (alpha) {
      const root = await win.webContents.executeJavaScript(
        `(()=>{const c=e=>getComputedStyle(e).backgroundColor,z=s=>s==='transparent'||/rgba\\([^)]*,\\s*0(?:\\.0+)?\\s*\\)/.test(s);return{html:c(document.documentElement),body:c(document.body),transparent:z(c(document.documentElement))&&z(c(document.body))}})()`,
      );
      if (
        !root.transparent ||
        objects?.some((item) => item.role === "background")
      )
        throw new Error(
          `Runtime preflight failed: metadata or root declares an opaque background (${root.html} / ${root.body}); native transparent scene required. Background removal is not performed.`,
        );
    }
    // Studio Split's geometry truth is the film stage: the draft strip below it is not
    // part of any object's coordinate box, so clips are judged against the stage bounds.
    const boundsViewport =
      job.mode === "split"
        ? { width: job.width, height: Math.round(job.height * 0.64) }
        : { width: job.width, height: job.height };
    if (!canvasScene) await optionalVisualAnalyzer("subject and geometry diagnostics", async () => {
      await runSubjectGeometryPreflight({
        win,
        width: job.width,
        height: job.height,
        duration: job.duration,
        mode: job.mode ?? "background",
        alpha,
        boundsViewport,
        objects: objects ?? [],
        getRuntimeErrors: () => runtimeErrors,
        seek: (time) => seekAndFlush(win, time),
        captureBitmap: async () => (await win.webContents.capturePage()).toBitmap(),
        warn: visualWarning,
        fail: (gate, message) => qualityGateReject(gate, message, visualWarning),
        note: (message) => visualGateFinding(EXPERIMENTAL_VISUAL_GATES, message, visualWarning),
        gates: VISUAL_GATES,
      });
    }, visualWarning, signal, latestFatalRuntime);
    assertRuntimeHealthy("visual preflight");
    await seekAndFlush(win, 0);
    const firstImage = await capture("initial capture"),
      firstSize = firstImage.getSize();
    if (firstSize.width !== job.width || firstSize.height !== job.height)
      throw new Error(
        `Motion capture size mismatch: expected ${job.width}x${job.height}, got ${firstSize.width}x${firstSize.height}.`,
      );
    const plan = framePlan(job.duration, settings.fps);
    // Studio Split stages the film in the top 64% of the viewport; the draft strip below
    // it must not dilute the stage measurements.
    const stageRegion: StageRegion | undefined =
      job.mode === "split"
        ? { x0: 0, y0: 0, x1: job.width, y1: Math.round(job.height * 0.64) }
        : undefined;
    if (alpha) {
      const samples = [];
      for (const timestamp of [0, plan.lastTime / 2, plan.lastTime]) {
        await seekAndFlush(win, timestamp);
        samples.push({
          timestamp,
          bitmap: (await capture(`alpha validation at t=${timestamp.toFixed(3)}s`)).toBitmap(),
        });
      }
      const report = alphaTimelineReport(samples);
      onLog(`Source alpha: ${alphaReportText(report)}`);
      if (!report.valid)
        throw new Error(
          `Runtime preflight failed: alpha timeline ${alphaReportText(report)}. Fully opaque, fully transparent, and antialias-only frames are invalid; native transparent scene required.`,
        );
    }
    if (!alpha) {
      await optionalVisualAnalyzer("opening frame diagnostic", async () => {
        // Gate at 8% while the contract demands 10%: pale subjects are undercounted by
        // the background-distance test, so the floor sits just below the contract line.
        const opening = stageContentReport(firstImage.toBitmap(), job.width, job.height, 0.08, 2.5, stageRegion);
        report.openCoverage = Math.round(opening.coverage * 1000) / 1000;
        report.stageContrast = opening.ok || opening.coverage >= opening.minCoverage ? Math.round(opening.contrast * 100) / 100 : null;
        if (!opening.ok) {
          const message = opening.reason ?? "opening frame stage check failed";
          const gate = opening.coverage < opening.minCoverage ? "empty frame" : "stage contrast";
          if (VISUAL_GATES.openingFrame && !canvasScene) qualityGateReject(gate, message, visualWarning);
          else visualGateFinding(canvasScene ? false : EXPERIMENTAL_VISUAL_GATES, canvasScene ? `[canvas warning] ${message}` : message, visualWarning);
        }
      }, visualWarning, signal, latestFatalRuntime);
    }
    await optionalVisualAnalyzer("motion activity diagnostic", async () => {
    // Sample through the tail (0.9/0.97) as well: a clip that dies at 40% and then
    // parks must fail here, not ship as a frozen last few seconds.
    const activityTimes = [0.15, 0.35, 0.55, 0.75, 0.9, 0.97].map(
        (x) => plan.lastTime * x,
      ),
      activityFrames: Buffer[] = [];
    for (const time of activityTimes) {
      await seekAndFlush(win, time);
      activityFrames.push((await win.webContents.capturePage()).toBitmap());
    }
    // Measure the film stage alone: the strip's sweeping playhead would otherwise keep
    // the activity gate green while the film itself is frozen.
    const activityStage = stageRegion
      ? activityFrames.map((f) => cropBitmap(f, job.width, job.height, stageRegion))
      : activityFrames;
    const activity = motionActivityReport(activityStage, alpha, 0.01);
    const MIN_ACTIVE_FRAME_PCT = 70;
    const activeFrames = activity.ratios.filter((r) => r >= activity.threshold).length;
    const activePct = activity.ratios.length ? (100 * activeFrames) / activity.ratios.length : 0;
    report.motionMaxDelta = activity.change;
    report.motionThreshold = activity.threshold;
    report.activeFramePct = Math.round(activePct * 10) / 10;
    report.motionPass = activity.ok && activePct >= MIN_ACTIVE_FRAME_PCT;
    if (!activity.ok) {
      const message = `scene is effectively still; maximum changed pixels ${(activity.change * 100).toFixed(3)}% is below ${(activity.threshold * 100).toFixed(3)}%`;
      if (VISUAL_GATES.motionActivity && !canvasScene) qualityGateReject("motion activity", message, visualWarning);
      else visualGateFinding(canvasScene ? false : EXPERIMENTAL_VISUAL_GATES, canvasScene ? `[canvas warning] ${message}` : message, visualWarning);
    } else if (activePct < MIN_ACTIVE_FRAME_PCT) {
      const message = `scene barely moves; only ${activePct.toFixed(1)}% of sampled frames change above threshold (minimum ${MIN_ACTIVE_FRAME_PCT}%)`;
      if (VISUAL_GATES.motionActivity && !canvasScene) qualityGateReject("motion activity", message, visualWarning);
      else visualGateFinding(canvasScene ? false : EXPERIMENTAL_VISUAL_GATES, canvasScene ? `[canvas warning] ${message}` : message, visualWarning);
    }
    const flicker = flickerReport(activity.ratios);
    report.flickerReversals = flicker.reversals;
    report.flickerMaxSwing = Math.round(flicker.maxSwing * 10000) / 10000;
    report.flickerOk = flicker.ok;
    if (!flicker.ok) {
      const message = `flicker detected; ${flicker.reversals} direction reversals with maximum swing ${(flicker.maxSwing * 100).toFixed(2)}% between sampled frames`;
      if (VISUAL_GATES.flicker && !canvasScene) qualityGateReject("flicker", message, visualWarning);
      else visualGateFinding(canvasScene ? false : EXPERIMENTAL_VISUAL_GATES, canvasScene ? `[canvas warning] ${message}` : message, visualWarning);
    }
    if (!alpha) {
      let worstContrast = Infinity;
      let contrastReason: string | undefined;
      const empties: string[] = [];
      for (let i = 0; i < activityFrames.length; i++) {
        const stage = stageContentReport(activityFrames[i], job.width, job.height, 0.02, 2.5, stageRegion);
        if (stage.coverage < stage.minCoverage)
          empties.push(`t=${activityTimes[i].toFixed(2)}s: ${stage.reason ?? "stage is empty"}`);
        else if (stage.flat && stage.contrast < worstContrast) {
          worstContrast = stage.contrast;
          contrastReason = stage.reason;
        }
      }
      if (worstContrast !== Infinity) {
        const rounded = Math.round(worstContrast * 100) / 100;
        report.stageContrast = report.stageContrast === null ? rounded : Math.min(report.stageContrast, rounded);
      }
      const contrastFail = worstContrast !== Infinity && worstContrast < 2.5;
      if (empties.length || contrastFail) {
        const message = empties.length ? empties[0] : (contrastReason ?? `subject blends into the stage background: contrast ${worstContrast.toFixed(2)} below 2.5`);
        const gate = empties.length ? "empty frame" : "stage contrast";
        if (VISUAL_GATES.stageContrast && !canvasScene) qualityGateReject(gate, message, visualWarning);
        else visualGateFinding(canvasScene ? false : EXPERIMENTAL_VISUAL_GATES, canvasScene ? `[canvas warning] ${message}` : message, visualWarning);
      }
      let worstBlack = 0;
      let blackReason: string | undefined;
      for (const frame of activityStage) {
        const slab = blackSlabReport(frame, job.width, job.height, 0.08, stageRegion);
        if (slab.share > worstBlack) {
          worstBlack = slab.share;
          blackReason = slab.reason;
        }
      }
      report.blackSlabShare = Math.round(worstBlack * 1000) / 1000;
      if (worstBlack > 0.08) {
        const message = blackReason ?? `pure-black mass covers ${(worstBlack * 100).toFixed(1)}% of the stage, above the allowed 8%`;
        if (VISUAL_GATES.blackSlab && !canvasScene) qualityGateReject("black slab", message, visualWarning);
        else visualGateFinding(canvasScene ? false : EXPERIMENTAL_VISUAL_GATES, canvasScene ? `[canvas warning] ${message}` : message, visualWarning);
      }
    }
    }, visualWarning, signal, latestFatalRuntime);
    if (canvasScene && !alpha) {
      // Canvas: reject ONLY catastrophic output (blank or truly frozen). Everything else above is a warning.
      const liveTimes = Array.from({ length: 12 }, (_, i) => (plan.lastTime * i) / 11);
      const liveFrames: Buffer[] = [];
      for (const time of liveTimes) {
        await seekAndFlush(win, time);
        liveFrames.push((await win.webContents.capturePage()).toBitmap());
      }
      const live = canvasLivenessReport(liveFrames, job.width, job.height);
      report.motionMaxDelta = Math.max(report.motionMaxDelta, live.maxStep);
      if (live.blank) qualityGateReject("blank frame", live.reason, visualWarning);
      if (live.still) qualityGateReject("still scene", live.reason, visualWarning);
    }
    await optionalVisualAnalyzer("text legibility diagnostic", async () => {
      if (alpha) return;
      const { findings, skipped } = await runTextLegibilityProbe({
        win,
        lastTime: plan.lastTime,
        seek: (time) => seekAndFlush(win, time),
        capture: async () => (await capture("text legibility sample")).toBitmap(),
        width: job.width,
        height: job.height,
      });
      if (skipped.length)
        visualGateFinding(EXPERIMENTAL_VISUAL_GATES, `text legibility: ${skipped.length} label(s) over gradients or translucency skipped as unmeasurable (${skipped.slice(0, 3).join('; ')})`, visualWarning);
      report.textFindings = findings;
      if (report.textFindings.length) {
        const message = report.textFindings.slice(0, 4).join('; ');
        if (VISUAL_GATES.textLegibility) qualityGateReject("text legibility", message, visualWarning);
        else visualGateFinding(canvasScene ? false : EXPERIMENTAL_VISUAL_GATES, canvasScene ? `[canvas warning] ${message}` : message, visualWarning);
      }
    }, visualWarning, signal, latestFatalRuntime);
    await optionalVisualAnalyzer("beat coherence diagnostic", async () => {
      const htmlSource = await fs.readFile(path.join(folder, `${baseName}.html`), "utf8");
      const beats = beatCoherenceReport(htmlSource, job.duration);
      report.beatChecked = true;
      report.beatOk = beats.ok;
      report.beatReason = beats.ok ? null : beats.reason ?? "irregular";
      if (!beats.ok) {
        const message = `beat table ${beats.reason ?? "irregular"} (${beats.beats} beats, max gap ${beats.maxGap.toFixed(2)}s)`;
        visualGateFinding(VISUAL_GATES.beatCoherence && EXPERIMENTAL_VISUAL_GATES, message, visualWarning);
      }
    }, visualWarning, signal, latestFatalRuntime);
    // Camera-motion, kinetic, and anti-pop spike diagnostics. Sample 6 frames across the
    // clip: camera checks content translation (parallax/dolly), kinetic checks for
    // suspiciously constant (mechanical) speed, spike catches abrupt geometry pops.
    await optionalVisualAnalyzer("camera, kinetic and spike diagnostic", async () => {
      const times = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95].map((x) => plan.lastTime * x);
      const camFrames: Buffer[] = [];
      for (const time of times) {
        await seekAndFlush(win, time);
        camFrames.push((await win.webContents.capturePage()).toBitmap());
      }
      const camStage = stageRegion
        ? camFrames.map((f) => cropBitmap(f, job.width, job.height, stageRegion))
        : camFrames;
      const cam = cameraMotionReport(
        camStage,
        stageRegion ? stageRegion.x1 - stageRegion.x0 : job.width,
        stageRegion ? stageRegion.y1 - stageRegion.y0 : job.height,
        0.008,
      );
      report.cameraTranslation = Math.round(cam.translation * 10000) / 10000;
      report.cameraActiveRatio = Math.round(cam.activeRatio * 1000) / 1000;
      report.cameraStrongRatio = Math.round(cam.strongRatio * 10000) / 10000;
      report.cameraMotionOk = cam.ok;
      if (!cam.ok) {
        const message = `camera: ${cam.reason ?? "locked static frame"}`;
        if (VISUAL_GATES.cameraMotion && !canvasScene) qualityGateReject("camera motion", message, visualWarning);
        else visualGateFinding(canvasScene ? false : EXPERIMENTAL_VISUAL_GATES, canvasScene ? `[canvas warning] ${message}` : message, visualWarning);
      }
      const kin = kineticReport(camStage);
      report.kineticLinearity = kin.linearity;
      report.kineticOk = kin.ok;
      if (!kin.ok) {
        const message = `kinetic: ${kin.reason ?? "mechanical linear motion"}`;
        report.kineticWarning = true;
        if (VISUAL_GATES.kinetic && !canvasScene) qualityGateReject("kinetic", message, visualWarning);
        else visualGateFinding(canvasScene ? false : EXPERIMENTAL_VISUAL_GATES, canvasScene ? `[canvas warning] ${message}` : message, visualWarning);
      }
      const ratios = camStage.slice(1).map((f, i) => pixelChangeRatio(camStage[i], f));
      const spikes = spikeReport(ratios);
      report.spikeOk = spikes.ok;
      report.spikeCount = spikes.spikes;
      report.spikeMaxRatio = spikes.maxRatio;
      if (!spikes.ok) {
        const message = `spike: ${spikes.reason ?? "abrupt geometry pop"}`;
        if (VISUAL_GATES.spike && !canvasScene) qualityGateReject("spike", message, visualWarning);
        else visualGateFinding(canvasScene ? false : EXPERIMENTAL_VISUAL_GATES, canvasScene ? `[canvas warning] ${message}` : message, visualWarning);
      }
    }, visualWarning, signal, latestFatalRuntime);
    if (settings.looping || job.sourceKind === "importedHtml" || job.sourceKind === "html-import") {
      await optionalVisualAnalyzer("timeline endpoint diagnostic", async () => {
      const times = settings.looping
          ? [0, plan.lastTime]
          : [plan.lastTime * 0.9, plan.lastTime * 0.95, plan.lastTime],
        bitmaps: Buffer[] = [];
      for (const time of times) {
        await seekAndFlush(win, time);
        bitmaps.push((await win.webContents.capturePage()).toBitmap());
      }
      const endpoint = endpointReport(bitmaps, settings.looping);
      report.loopChecked = settings.looping;
      report.loopEndpointChange = endpoint.change;
      report.loopEndpointLimit = endpoint.limit;
      report.loopOk = endpoint.ok;
      if (!endpoint.ok)
        visualGateFinding(EXPERIMENTAL_VISUAL_GATES, `${settings.looping ? "loop seam" : "finite ending"} pixel endpoint change ${(endpoint.change * 100).toFixed(2)}% exceeds ${(endpoint.limit * 100).toFixed(2)}%`, visualWarning);
      }, visualWarning, signal, latestFatalRuntime);
    }
    assertRuntimeHealthy("frame rendering initialization");
    const count = plan.count;
    onLog("Rendering frames");
    for (let frame = 0; frame < count; frame++) {
      if (signal.aborted) throw new Error("Generation stopped.");
      await seekAndFlush(win, frame / settings.fps);
      assertRuntimeHealthy(`frame ${frame}`);
      const image = await capture(`frame ${frame}`);
      const size = image.getSize();
      if (size.width !== job.width || size.height !== job.height)
        throw new Error(
          `Motion capture size changed at frame ${frame}: expected ${job.width}x${job.height}, got ${size.width}x${size.height}.`,
        );
      await fs.writeFile(
        path.join(frames, `frame-${String(frame).padStart(6, "0")}.png`),
        image.toPNG(),
      );
      if (frame % 10 === 0) progress(Math.round((frame / count) * 80));
    }
    progress(82);
    const video = path.join(folder, `${baseName}${outputExtension(format)}`);
    await encodeVideo(
      frames,
      video,
      { ...settings, outputFormat: format },
      signal,
      onLog,
    );
    const probe = await probeVideo(video, settings.ffmpegPath, signal),
      expected = framePlan(job.duration, settings.fps).duration;
    if (
      !verifyProbe(format, probe, job.width, job.height, expected, settings.fps)
    )
      throw new Error(
        "Encoded output verification failed: container, codec/profile, alpha pixel format, dimensions, FPS, duration, or no-audio contract mismatch.",
      );
    if (alpha) {
      const report = await verifyEncodedAlpha(
        video,
        ffmpegExecutable(settings.ffmpegPath),
        expected,
        settings.fps,
      );
      onLog(`Encoded alpha: ${alphaReportText(report)}`);
    }
    await runFfmpeg(
      [
        "-y",
        "-i",
        video,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        path.join(folder, `${baseName}.jpg`),
      ],
      ffmpegExecutable(settings.ffmpegPath),
      signal,
      onLog,
    );
    progress(100);
    return report;
  } finally {
    win.destroy();
    await fs.rm(frames, { recursive: true, force: true });
    await fs.rm(captureHtml, { force: true });
  }
}
