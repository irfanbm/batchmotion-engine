import { BrowserWindow, nativeImage } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Job, Settings } from "./types";
import type { MotionObject } from "./geometry";
import {
  beatCoherenceReport,
  blackSlabReport,
  cameraMotionReport,
  flickerReport,
  kineticReport,
  motionActivityReport,
  pixelChangeRatio,
  spikeReport,
  stageContentReport,
} from "./quality";
import { validateHtml, validateObjectMetadata } from "./validation";
import { vendoredGsapPath } from "./gsap-runtime";
import {
  VISUAL_GATES,
  RenderQualityError,
  defaultRenderReport,
  ffmpegExecutable,
  isRenderQualityError,
  type RenderReport,
} from "./render";
import { normalizeOutputFormat, outputExtension } from "./output-format";
import {
  framePlan,
  hfSeekAndFlush,
  renderWindowOptions,
  runSubjectGeometryPreflight,
  runTextLegibilityProbe,
} from "./preflight";

// HyperFrames engine mode: the coder emits a standalone composition (data-* timing,
// one paused timeline, no MotionForge clock) rendered by the HyperFrames CLI. The
// blueprint, icon injection, quality gates, and repair loop are shared with the GSAP
// path; only the composition shape, validation, seeking, and renderer differ.

export function hyperframesBin(): { cmd: string; prefix: string[] } {
  // Prefer the bundled hyperframes package (spawned with node directly: spawning
  // npx.cmd fails with EINVAL and npx needs a shell). HYPERFRAMES_BIN overrides with
  // a direct executable path when set.
  if (process.env.HYPERFRAMES_BIN?.trim()) return { cmd: process.env.HYPERFRAMES_BIN.trim(), prefix: [] };
  try {
    const bin = path.join(
      path.dirname(require.resolve("hyperframes/package.json")),
      "bin",
      "hyperframes.mjs",
    );
    return { cmd: process.execPath, prefix: [bin] };
  } catch {
    return process.platform === "win32"
      ? { cmd: "npx.cmd", prefix: ["-y", "hyperframes"] }
      : { cmd: "npx", prefix: ["-y", "hyperframes"] };
  }
}

export function hfProjectDir(projectFolder: string, jobId: string): string {
  return path.join(projectFolder, `.hf-${jobId}`);
}

export function buildLintArgs(projectDir: string): string[] {
  return ["lint", projectDir];
}

// hyperframes lint prints "N error(s), M warning(s)"; nonzero exit means findings.
// Returns the error lines for the repair loop (empty = clean).
export function parseLintResult(exitCode: number | null, stdout: string): string[] {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (exitCode === 0 && !/([1-9]\d*) error\(s\)/.test(stdout)) return [];
  const findings = lines
    .filter((l) => !/^\S?\s*\d+ error\(s\), \d+ warning\(s\)/.test(l))
    .filter((l) => /error|Error|✖|×|invalid|missing|required/i.test(l)).slice(-12);
  return findings.length ? findings : [`hyperframes lint failed (exit ${exitCode ?? "signal"})`];
}

function runCli(
  args: string[],
  cwd: string,
  signal: AbortSignal,
  onLog: (line: string) => void,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string }> {
  const { cmd, prefix } = hyperframesBin();
  return new Promise((resolve, reject) => {
    let stdout = "";
    let child: ChildProcess;
    try {
      // hyperframesBin resolves to Electron itself in production: run it as plain
      // Node, otherwise the CLI boots an app lifecycle and hangs holding the pipes.
      child = spawn(cmd, [...prefix, ...args], {
        cwd,
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error(`hyperframes ${args[0] ?? "command"} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    if (signal.aborted) {
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch {}
      reject(signal.reason || new Error("Stopped."));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch {}
      reject(signal.reason || new Error("Stopped."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (data) => {
      const text = String(data);
      stdout += text;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) onLog(trimmed.slice(-240));
      }
    });
    child.stderr?.on("data", (data) => {
      const text = String(data).trim();
      if (text) onLog(text.slice(-240));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve({ code, stdout });
    });
  });
}

export async function runHyperframesLint(
  projectDir: string,
  signal: AbortSignal,
  onLog: (line: string) => void,
): Promise<string[]> {
  const { code, stdout } = await runCli(buildLintArgs(projectDir), projectDir, signal, onLog, 120000);
  return parseLintResult(code, stdout);
}

// Static validation for HF compositions: Batchmotion metadata rules plus hyperframes
// lint (structure, clips, determinism). GSAP-skeleton checks do not apply here.
export function validateHyperframesComposition(
  html: string,
  alpha: boolean,
  iconAssets?: { objectId: string; set: string; name: string }[],
): string[] {
  return validateHtml(html, alpha, { iconAssets, hyperframes: true });
}

export async function stageHyperframesComposition(
  projectFolder: string,
  jobId: string,
  html: string,
): Promise<{ dir: string; index: string }> {
  // One HF project dir per job (concurrent jobs in a batch must not share index.html).
  // Staged RAW (no injected runtime): hyperframes lint must grade authored code only,
  // since the vendored GSAP build legitimately contains Math.random/Date.now. GSAP
  // arrives via the contract-mandated <script src="gsap.min.js"> tag plus the staged
  // file copied below, so no injection ever happens on this path (it would double-load).
  const dir = hfProjectDir(projectFolder, jobId);
  await fs.mkdir(dir, { recursive: true });
  const index = path.join(dir, "index.html");
  await fs.writeFile(index, html);
  // The composition references <script src="gsap.min.js"> (lint-mandated, contract
  // dictated): stage the exact vendored file so the reference resolves offline.
  await fs.copyFile(vendoredGsapPath(), path.join(dir, "gsap.min.js"));
  return { dir, index };
}

export function buildRenderArgs(opts: {
  projectDir: string;
  output: string;
  fps: number;
  alpha: boolean;
}): string[] {
  const args = [
    "render",
    opts.projectDir,
    "-o", opts.output,
    "--fps", String(opts.fps),
    "--quality", "looks",
    // Cap parallel Chrome workers: the quality loop already runs Electron, ffmpeg,
    // and repeated CLI renders side by side, and auto-scaled workers exhaust memory
    // into renderer crashes. Deterministic output is unaffected.
    "--workers", "4",
  ];
  if (opts.alpha) args.push("--format", "mov");
  return args;
}

// "@hf-progress {\"code\":...,\"pct\":12}" lines carry render progress.
export function parseProgressLine(line: string): number | null {
  const m = /@hf-progress\s+(\{.*\})/.exec(line);
  if (!m) return null;
  try {
    const pct = (JSON.parse(m[1]) as { pct?: unknown }).pct;
    return typeof pct === "number" && Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null;
  } catch {
    return null;
  }
}

// Retry-once wrapper for flaky Electron ops (GPU paint scheduling under load can
// drop a capture with an empty native error). Mirrors the GSAP capture retry.
export async function withElectronRetry<T>(
  label: string,
  onLog: (line: string) => void,
  op: () => Promise<T>,
): Promise<T> {
  try {
    return await op();
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    onLog(`Capture warning at ${label}; retrying once: ${raw || "empty native error"}`);
    return await op();
  }
}

async function waitForTimeline(
  win: BrowserWindow,
  compositionId: string,
  signal: AbortSignal,
  timeoutMs = 30000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (signal.aborted) throw signal.reason || new Error("Stopped.");
    const ready = await win.webContents.executeJavaScript(
      `!!(window.__timelines && window.__timelines[${JSON.stringify(compositionId)}])`,
    );
    if (ready) return;
    if (Date.now() - start > timeoutMs)
      throw new Error("HyperFrames composition did not register its paused timeline within 30 seconds.");
    await new Promise((r) => setTimeout(r, 250));
  }
}

function runFfmpeg(
  ffmpeg: string,
  args: string[],
  signal: AbortSignal,
  onLog: (line: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
      const line = String(data).trim();
      if (line) onLog(line.slice(-240));
    });
    child.on("error", (error) => reject(error));
    const onAbort = () => {
      try { child.kill("SIGKILL"); } catch {}
      reject(signal.reason || new Error("Stopped."));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => {
      signal.removeEventListener("abort", onAbort);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

async function readBitmap(
  pngPath: string,
  width: number,
  height: number,
): Promise<Buffer> {
  const image = nativeImage.createFromPath(pngPath);
  const size = image.getSize();
  if (size.width !== width || size.height !== height)
    throw new Error(
      `Motion capture size mismatch: expected ${width}x${height}, got ${size.width}x${size.height}.`,
    );
  return image.toBitmap();
}

export interface HyperframesRenderArgs {
  projectFolder: string;
  baseName: string;
  job: Job;
  settings: Settings;
  signal: AbortSignal;
  progress: (value: number) => void;
  onLog: (line: string) => void;
}

// Downscaled gate frames for vision-capable repair: small enough to ride along
// cheaply, never fatal (a sampling failure must not mask the gate rejection).
async function collectGateFrames(framesDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of ["open.png", "act-1.png", "act-3.png", "act-5.png", "act-0.png"]) {
    try {
      const image = nativeImage.createFromPath(path.join(framesDir, name));
      const size = image.getSize();
      if (!size.width || !size.height || image.isEmpty()) continue;
      out.push(`data:image/jpeg;base64,${image.resize({ width: 480 }).toJPEG(60).toString("base64")}`);
      if (out.length >= 3) break;
    } catch {
      continue;
    }
  }
  return out;
}

export async function renderHyperframesVideo(args: HyperframesRenderArgs): Promise<RenderReport> {
  const { projectFolder, baseName, job, settings, signal, progress, onLog } = args;
  const format = normalizeOutputFormat(job.outputFormat);
  const alpha = format === "mov-prores4444-alpha";
  const ffmpeg = ffmpegExecutable(settings.ffmpegPath);
  const report = defaultRenderReport();
  const html = await fs.readFile(path.join(projectFolder, `${baseName}.html`), "utf8");
  const { dir: hfDir, index: hfIndex } = await stageHyperframesComposition(projectFolder, job.id, html);
  const compositionId = "main";
  const plan = framePlan(job.duration, settings.fps);
  const visualWarning = (message: string) => onLog(message);
    const failQuality = (gate: string, message: string): never => {
      try {
        visualWarning(`Visual quality gate (${gate}) rejected render: ${message}`);
      } catch {}
      throw new RenderQualityError(`${gate} quality gate: ${message}`);
    };
    const gateOrWarn = (enabled: boolean, gate: string, message: string): void => {
      if (enabled) failQuality(gate, message);
      else visualWarning(message);
    };

  const win = new BrowserWindow(renderWindowOptions(job.width, job.height, `hyperframes-${job.id}`, alpha));
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
  try {
    signal.throwIfAborted();
    await win.loadFile(hfIndex);
    // Authoring defects (missing timeline registration, missing metadata) are
    // model-fixable: reject them through the quality loop, not as hard failures.
    // Environmental faults (viewport, DPR, crashed renderer) still fail immediately.
    try {
      await waitForTimeline(win, compositionId, signal);
    } catch (error) {
      throw new RenderQualityError(
        `subject bounds quality gate: composition timeline "main" never registered; register exactly one paused gsap.timeline at window.__timelines["main"] after the registry guard (${(error as Error).message})`,
      );
    }
    // Reassert content bounds after navigation: Windows may constrain framed outer
    // bounds to the work area.
    win.setContentSize(job.width, job.height, false);
    const content = win.getContentBounds();
    if (content.width !== job.width || content.height !== job.height)
      throw new Error(
        `Electron could not allocate the exact ${job.width}x${job.height} content viewport; got ${content.width}x${content.height}. Check OS display limits or Chromium texture support.`,
      );
    const metrics = await win.webContents.executeJavaScript(`({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})`);
    if (metrics.dpr !== 1)
      throw new Error(`Motion renderer requires DPR 1, got ${metrics.dpr}. Fully restart Batchmotion after changing renderer settings.`);
    if (metrics.width !== job.width || metrics.height !== job.height)
      throw new Error(`Motion viewport mismatch: expected ${job.width}x${job.height}, got ${metrics.width}x${metrics.height} at DPR 1.`);
    if (runtimeErrors.length)
      throw new Error(`Motion scene initialization failed: ${runtimeErrors.at(-1)}`);
    const objects = (await win.webContents.executeJavaScript(`window.__MOTIONFORGE_OBJECTS__`)) as unknown as
      | MotionObject[]
      | undefined;
    if (!Array.isArray(objects) || !objects.length)
      throw new RenderQualityError(
        "subject bounds quality gate: missing element #primary-subject (window.__MOTIONFORGE_OBJECTS__ is empty at runtime); open the script with the global assignment window.__MOTIONFORGE_OBJECTS__ = [{ id: 'primary-subject', role: 'subject', allowCrop: false }]; on its own line before any animation code",
      );
    if (alpha) {
      const root = await win.webContents.executeJavaScript(
        `(()=>{const c=e=>getComputedStyle(e).backgroundColor,z=s=>s==='transparent'||/rgba\\([^)]*,\\s*0(?:\\.0+)?\\s*\\)/.test(s);return{transparent:z(c(document.documentElement))&&z(c(document.body))}})()`,
      );
      if (!root.transparent || objects.some((item) => item.role === "background"))
        throw new Error("Runtime preflight failed: metadata or root declares an opaque background; native transparent scene required. Background removal is not performed.");
    }
    const boundsViewport = { width: job.width, height: job.height };
    const seek = (time: number) => hfSeekAndFlush(win, compositionId, time);
    const captureBitmap = () => withElectronRetry("preflight capture", onLog, async () => (await win.webContents.capturePage()).toBitmap());
    // DOM gates: identical shared analyzers as the GSAP path, only the seek differs.
    // Log the raw error before it normalizes: empty native failures would otherwise
    // surface as an unactionable generic message.
    const runGates = async () => {
      await runSubjectGeometryPreflight({
      win,
      width: job.width,
      height: job.height,
      duration: job.duration,
      mode: job.mode ?? "hyperframes",
      alpha,
      boundsViewport,
      objects,
      getRuntimeErrors: () => runtimeErrors,
      seek,
      captureBitmap,
      warn: visualWarning,
      fail: (gate, message) => failQuality(gate, message),
      note: (message) => visualWarning(message),
      gates: VISUAL_GATES,
    });
    if (!alpha) {
      const { findings, skipped } = await runTextLegibilityProbe({ win, lastTime: plan.lastTime, seek, capture: captureBitmap, width: job.width, height: job.height });
      if (skipped.length)
        visualWarning(`text legibility: ${skipped.length} label(s) over gradients or translucency skipped as unmeasurable (${skipped.slice(0, 3).join('; ')})`);
      report.textFindings = findings;
      if (report.textFindings.length)
        gateOrWarn(VISUAL_GATES.textLegibility, "text legibility", report.textFindings.slice(0, 4).join('; '));
    }
    // Beat table is static HTML: same audit as the GSAP path, warning-only.
    const beats = beatCoherenceReport(html, job.duration);
    report.beatChecked = true;
    report.beatOk = beats.ok;
    report.beatReason = beats.ok ? null : beats.reason ?? "irregular";
    if (!beats.ok) visualWarning(`beat table ${beats.reason ?? "irregular"} (${beats.beats} beats, max gap ${beats.maxGap.toFixed(2)}s)`);
    };
    try {
      await runGates();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      if (raw) throw error;
      onLog(`Preflight analyzer failed with an empty native error; retrying the visual operation once`);
      await runGates();
    }

    // Render through the HyperFrames CLI straight to the final output path.
    const finalVideo = path.join(projectFolder, `${baseName}${outputExtension(job.outputFormat ?? settings.outputFormat)}`);
    onLog("Renderer available · Launching HyperFrames CLI");
    progress(10);
    const renderArgs = buildRenderArgs({
      projectDir: hfDir,
      output: finalVideo,
      fps: settings.fps,
      alpha,
    });
    // A CLI render crash (GPU/memory under repeated loop renders) is environmental,
    // not a scene defect: retry the identical composition once before failing hard.
    // This retry does not consume quality budget and never regenerates the scene.
    const runCliRender = (): Promise<{ code: number | null }> => new Promise<{ code: number | null }>((resolve, reject) => {
      const { cmd, prefix } = hyperframesBin();
      let child;
      try {
        child = spawn(cmd, [...prefix, ...renderArgs], {
          cwd: projectFolder,
          windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        reject(new Error("hyperframes render timed out after 20 minutes"));
      }, 20 * 60 * 1000);
      if (signal.aborted) {
        clearTimeout(timer);
        try { child.kill("SIGKILL"); } catch {}
        reject(signal.reason || new Error("Stopped."));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        try { child.kill("SIGKILL"); } catch {}
        reject(signal.reason || new Error("Stopped."));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      child.stdout?.on("data", (data) => {
        for (const line of String(data).split(/\r?\n/)) {
          const pct = parseProgressLine(line);
          // Cap CLI progress below the queue's "encoding" status line (82): pixel
          // gates still run after the CLI finishes, and their failures must read as
          // quality rejections, not encoding failures.
          if (pct !== null) progress(10 + Math.round(Math.min(pct, 100) * 0.7));
          else if (line.trim() && /error|failed|warning/i.test(line)) onLog(line.trim().slice(-240));
        }
      });
      child.stderr?.on("data", (data) => {
        const line = String(data).trim();
        if (line && /error|failed/i.test(line)) onLog(line.slice(-240));
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        resolve({ code: exitCode });
      });
    });
    let code = (await runCliRender()).code;
    if (code !== 0) {
      onLog(`HyperFrames CLI render failed (exit ${code ?? "signal"}); retrying the identical composition once`);
      code = (await runCliRender()).code;
    }
    if (code !== 0) throw new Error(`hyperframes render failed (exit ${code ?? "signal"})`);

    // Pixel gates on CLI-rendered frames: same reports, thresholds, and messages as
    // the GSAP capture loop, so repairs steer identically.
    const framesDir = path.join(projectFolder, `.frames-hf-${job.id}`);
    await fs.mkdir(framesDir, { recursive: true });
    const activityTimes = [0.15, 0.35, 0.55, 0.75, 0.9, 0.97].map((x) => plan.lastTime * x);
    const cameraTimes = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95].map((x) => plan.lastTime * x);
    const extractAt = async (time: number, name: string): Promise<Buffer> => {
      const out = path.join(framesDir, `${name}.png`);
      await runFfmpeg(ffmpeg, ["-y", "-loglevel", "error", "-ss", String(time), "-i", finalVideo, "-frames:v", "1", out], signal, () => {});
      return readBitmap(out, job.width, job.height);
    };
    // Pixel gates run on extracted frames; a rejection carries downscaled frames
    // so vision-capable repairs see the failure, not just its measurements.
    try {
    const firstBitmap = await extractAt(0, "open");
    if (!alpha) {
      const opening = stageContentReport(firstBitmap, job.width, job.height, 0.08, 2.5, undefined);
      report.openCoverage = Math.round(opening.coverage * 1000) / 1000;
      report.stageContrast = opening.ok || opening.coverage >= opening.minCoverage ? Math.round(opening.contrast * 100) / 100 : null;
      if (!opening.ok) {
        const message = opening.reason ?? "opening frame stage check failed";
        const gate = opening.coverage < opening.minCoverage ? "empty frame" : "stage contrast";
        gateOrWarn(VISUAL_GATES.openingFrame, gate, message);
      }
    }
    const activityFrames: Buffer[] = [];
    for (let i = 0; i < activityTimes.length; i++) activityFrames.push(await extractAt(activityTimes[i], `act-${i}`));
    const activity = motionActivityReport(activityFrames, alpha, 0.01);
    const MIN_ACTIVE_FRAME_PCT = 70;
    const activeFrames = activity.ratios.filter((r) => r >= activity.threshold).length;
    const activePct = activity.ratios.length ? (100 * activeFrames) / activity.ratios.length : 0;
    report.motionMaxDelta = activity.change;
    report.motionThreshold = activity.threshold;
    report.activeFramePct = Math.round(activePct * 10) / 10;
    report.motionPass = activity.ok && activePct >= MIN_ACTIVE_FRAME_PCT;
    if (!activity.ok) {
      const message = `scene is effectively still; maximum changed pixels ${(activity.change * 100).toFixed(3)}% is below ${(activity.threshold * 100).toFixed(3)}%`;
      gateOrWarn(VISUAL_GATES.motionActivity, "motion activity", message);
    } else if (activePct < MIN_ACTIVE_FRAME_PCT) {
      const message = `scene barely moves; only ${activePct.toFixed(1)}% of sampled frames change above threshold (minimum ${MIN_ACTIVE_FRAME_PCT}%)`;
      gateOrWarn(VISUAL_GATES.motionActivity, "motion activity", message);
    }
    const flicker = flickerReport(activity.ratios);
    report.flickerReversals = flicker.reversals;
    report.flickerMaxSwing = Math.round(flicker.maxSwing * 10000) / 10000;
    report.flickerOk = flicker.ok;
    if (!flicker.ok)
      gateOrWarn(VISUAL_GATES.flicker, "flicker", `flicker detected; ${flicker.reversals} direction reversals with maximum swing ${(flicker.maxSwing * 100).toFixed(2)}% between sampled frames`);
    if (!alpha) {
      let worstContrast = Infinity;
      let contrastReason: string | undefined;
      const empties: string[] = [];
      for (let i = 0; i < activityFrames.length; i++) {
        const stage = stageContentReport(activityFrames[i], job.width, job.height, 0.02, 2.5, undefined);
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
      if (empties.length || (worstContrast !== Infinity && worstContrast < 2.5)) {
        const message = empties.length ? empties[0] : (contrastReason ?? `subject blends into the stage background: contrast ${worstContrast.toFixed(2)} below 2.5`);
        const gate = empties.length ? "empty frame" : "stage contrast";
        gateOrWarn(VISUAL_GATES.stageContrast, gate, message);
      }
      let worstBlack = 0;
      let blackReason: string | undefined;
      for (const frame of activityFrames) {
        const slab = blackSlabReport(frame, job.width, job.height, 0.08, undefined);
        if (slab.share > worstBlack) {
          worstBlack = slab.share;
          blackReason = slab.reason;
        }
      }
      report.blackSlabShare = Math.round(worstBlack * 1000) / 1000;
      if (worstBlack > 0.08)
        gateOrWarn(VISUAL_GATES.blackSlab, "black slab", blackReason ?? `pure-black mass covers ${(worstBlack * 100).toFixed(1)}% of the stage, above the allowed 8%`);
    }
    const camFrames: Buffer[] = [];
    for (let i = 0; i < cameraTimes.length; i++) camFrames.push(await extractAt(cameraTimes[i], `cam-${i}`));
    const cam = cameraMotionReport(camFrames, job.width, job.height, 0.008);
    report.cameraTranslation = Math.round(cam.translation * 10000) / 10000;
    report.cameraActiveRatio = Math.round(cam.activeRatio * 1000) / 1000;
    report.cameraStrongRatio = Math.round(cam.strongRatio * 10000) / 10000;
    report.cameraMotionOk = cam.ok;
    if (!cam.ok)
      gateOrWarn(VISUAL_GATES.cameraMotion, "camera motion", `camera: ${cam.reason ?? "locked static frame"}`);
    const kin = kineticReport(camFrames);
    report.kineticLinearity = kin.linearity;
    report.kineticOk = kin.ok;
    if (!kin.ok) {
      report.kineticWarning = true;
      gateOrWarn(VISUAL_GATES.kinetic, "kinetic", `kinetic: ${kin.reason ?? "mechanical linear motion"}`);
    }
    const ratios = camFrames.slice(1).map((f, i) => pixelChangeRatio(camFrames[i], f));
    const spikes = spikeReport(ratios);
    report.spikeOk = spikes.ok;
    report.spikeCount = spikes.spikes;
    report.spikeMaxRatio = spikes.maxRatio;
    if (!spikes.ok)
      gateOrWarn(VISUAL_GATES.spike, "spike", `spike: ${spikes.reason ?? "abrupt geometry pop"}`);
    } catch (error) {
      if (isRenderQualityError(error)) {
        try {
          error.frames = await collectGateFrames(framesDir);
        } catch {
          // Sampling must never mask the rejection.
        }
      }
      throw error;
    }
    // Poster frame for debug artifacts and UI parity with the GSAP path.
    const posterTime = plan.lastTime / 2;
    await runFfmpeg(ffmpeg, ["-y", "-loglevel", "error", "-ss", String(posterTime), "-i", finalVideo, "-frames:v", "1", path.join(projectFolder, `${baseName}.jpg`)], signal, () => {});
    progress(100);
    return report;
  } finally {
    try { win.destroy(); } catch {}
  }
}
