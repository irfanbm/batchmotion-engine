import fs from "node:fs/promises";
import path from "node:path";
import { shell } from "electron";
import {
  adaptImportedHtml,
  checkAiProvider,
  generateBlueprint,
  generateConceptHtml,
  generateHtml,
  generateHtmlFromBlueprint,
  providerUnavailable,
  refineSingleLoop,
} from "./ai";
import {
  adaptationCacheMatches,
  adaptationCacheSignature,
  HTML_ADAPTATION_CONTRACT_VERSION,
  MAX_HTML_BYTES,
  scanImportedHtml,
} from "./html-import";
import { promptFileName, renderVideo, saveProject, isRenderQualityError, type RenderQualityError, type RenderReport } from "./render";
import { consecutiveIdenticalErrors, type JobTrace } from "./harness/trace";
import {
  renderHyperframesVideo,
  runHyperframesLint,
  stageHyperframesComposition,
  validateHyperframesComposition,
} from "./hyperframes";
import { validateHtml, structurePromiseWarnings } from "./validation";
import { injectVirtualClock } from "./virtual-clock";
import { capturePreviewStills } from "./preflight";
import { markTxtDone } from "./txt";
import type { EnginePaths, EngineStore, HistoryItem, Job, LogEntry, PreviewDecision, Settings } from "./types";
import {
  assertOutputSizePolicy,
  normalizeOutputFormat,
  outputExtension,
} from "./output-format";
import { normalizeThrown, type ErrorStage } from "./errors";
import { ensureGsapRuntime } from "./gsap-runtime";
import { installSalt, saltedSeed } from "./seed";
import { blueprintSchema } from "./blueprint";
import { resolveIconAssets } from "./icon-source";

export class QueueService {
  jobs: Job[] = [];
  history: HistoryItem[] = [];
  private running = false;
  private controller?: AbortController;
  private saving = Promise.resolve();
  constructor(
    private emit: (channel: string, data: unknown) => void,
    private store: EngineStore,
    private paths: EnginePaths,
  ) {}
  // Preview-gate approvals: prepare() parks here until the user picks
  // render / revise / remake, or deletes the job.
  private previewWaiters = new Map<string, { resolve: (d: PreviewDecision) => void; reject: (e: Error) => void }>();
  private static readonly previewDeleted = "Job removed during preview.";
  private async runPreviewGate(args: {
    job: Job;
    html: string;
    renderSettings: Settings;
    signal: AbortSignal;
    projectFolder: string;
    baseName: string;
    alpha: boolean;
    isHf: boolean;
    isSplit: boolean;
  }): Promise<string> {
    const { job, renderSettings, signal, projectFolder, baseName } = args;
    let html = args.html;
    const validateCandidate = async (candidate: string): Promise<string[]> =>
      args.isHf
        ? await this.validateHyperframesCandidate(candidate, args.alpha, job, projectFolder, signal)
        : validateHtml(candidate, args.alpha, { requireGsap: true, iconAssets: job.iconAssets, split: args.isSplit });
    this.set(job, "preview", 10);
    for (;;) {
      if (signal.aborted) throw signal.reason || new Error("Stopped.");
      try {
        const loadFile = args.isHf
          ? (await stageHyperframesComposition(projectFolder, job.id, html)).index
          : path.join(projectFolder, `${baseName}.preview-load.html`);
        if (!args.isHf) await fs.writeFile(loadFile, injectVirtualClock(ensureGsapRuntime(html)));
        job.previewStills = await capturePreviewStills({
          mode: job.mode ?? "background",
          width: job.width,
          height: job.height,
          duration: job.duration,
          loadFile,
          outDir: projectFolder,
          prefix: baseName,
          signal,
        });
        job.error = undefined;
      } catch (error) {
        job.error = `Preview capture failed: ${(error as Error).message}`;
      }
      this.update();
      this.log("info", "Preview ready · awaiting approval (Render / Revise / Remake / Delete)", job.id);
      const decision = await this.waitForPreviewDecision(job, signal);
      if (decision.action === "render") {
        this.set(job, "ready", 10);
        return html;
      }
      if (decision.action === "remake" && !job.blueprint) throw new Error("Remake needs a blueprint job.");
      if (decision.action === "revise" && !job.blueprint) throw new Error("Revise needs a blueprint job.");
      if (decision.action === "remake")
        job.seed = saltedSeed(crypto.getRandomValues(new Uint32Array(1))[0], installSalt());
      this.set(job, "generating", 5);
      this.log("info", decision.action === "remake" ? "Preview remake requested · Regenerating from blueprint" : "Preview revision requested · Regenerating scene", job.id);
      const candidate = await this.waitForProvider(job, signal, () =>
        generateHtmlFromBlueprint(
          renderSettings,
          blueprintSchema.parse(job.blueprint),
          job.seed,
          signal,
          decision.action === "revise" ? { html, errors: [decision.note] } : undefined,
          job.iconAssets,
          args.isSplit,
          args.isHf,
        ));
      this.set(job, "validating", 8);
      const errors = await validateCandidate(candidate);
      if (errors.length) {
        job.error = `Preview regeneration failed validation: ${errors.join("; ")}`;
        this.update();
        continue;
      }
      html = candidate;
      job.rawResponse = html;
      job.error = undefined;
      await saveProject(job, html, projectFolder, baseName);
      job.htmlPath = path.join(projectFolder, `${baseName}.html`);
    }
  }
  private async waitForProvider<T>(
    job: Job,
    signal: AbortSignal,
    request: () => Promise<T>,
    health?: () => Promise<unknown>,
  ) {
    // Bounded: an unavailable upstream must eventually fail the job with a real reason
    // instead of looping until an external deadline kills the whole run.
    const maxAttempts = 4;
    for (let attempt = 1; ; attempt++)
      try {
        return await request();
      } catch (error) {
        if (signal.aborted || !providerUnavailable(error)) throw error;
        if (attempt >= maxAttempts)
          throw new Error(`AI provider stayed unavailable after ${maxAttempts} attempts: ${(error as Error).message}`);
        this.log(
          "warning",
          `${(error as Error).message} Upstream/gateway unavailable; retry ${attempt}/${maxAttempts - 1} in 15 seconds.`,
          job.id,
        );
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 15000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(signal.reason || new Error("Stopped."));
            },
            { once: true },
          );
        });
        if (health) {
          this.log("info", "Checking AI provider connection…", job.id);
          try {
            await health();
          } catch (checkError) {
            this.log("warning", (checkError as Error).message, job.id);
            continue;
          }
        }
      }
  }
  async init() {
    const [history, jobs] = await Promise.all([
      this.store.history(),
      this.store.queue(),
    ]);
    this.history = history;
    this.jobs = restoreQueue(jobs);
    await this.store.saveQueue(this.jobs);
  }
  snapshot() {
    return { jobs: this.jobs, history: this.history };
  }
  add(prompts: string[], settings: Settings, sourceTxtPath?: string, conceptData?: unknown) {
    assertOutputSizePolicy(
      settings.outputFormat,
      settings.width,
      settings.height,
      settings.fps,
      settings.duration,
      settings.encodeAnywayLarge,
    );
    const mode = settings.defaultMode || 'background';
    if (mode === 'split' && settings.outputFormat === 'mov-prores4444-alpha')
      throw new Error('Studio Split renders an opaque breakdown board. Switch Output format to MP4 (opaque) before queueing.');
    const created = prompts
      .map((prompt) => ({
        id: crypto.randomUUID(),
        prompt: prompt.trim(),
        // Salted seed: same prompt from a different install yields different visuals.
        seed: saltedSeed(crypto.getRandomValues(new Uint32Array(1))[0], installSalt()),
        status: "queued" as const,
        progress: 0,
        duration: settings.duration,
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        // The playhead sweep crosses the strip once; a loop would snap it back to zero.
        // HyperFrames mode renders finite clips through the CLI; looping stays GSAP-only.
        looping: mode === 'split' || mode === 'hyperframes' ? false : settings.looping,
        motionStyle: settings.motionStyle,
        mode,
        conceptData: conceptData as Job['conceptData'],
        model: settings.model,
        sourceTxtPath,
        createdAt: new Date().toISOString(),
      }))
      .filter((x) => x.prompt);
    const snapshots = created.map((job) => ({
      ...job,
      outputFormat: settings.outputFormat,
      encodeAnywayLarge: settings.encodeAnywayLarge,
    }));
    this.jobs.push(...snapshots);
    this.update();
    return snapshots;
  }
  addImportedSources(
    items: { filename: string; id: string; sourcePath: string }[],
    settings: Settings,
  ) {
    const policy = assertOutputSizePolicy(
      settings.outputFormat,
      settings.width,
      settings.height,
      settings.fps,
      settings.duration,
      settings.encodeAnywayLarge,
    );
    if (policy.warning)
      this.log(
        "warning",
        `Estimated output ${(policy.bytes / 1e9).toFixed(2)} GB exceeds the 2.5 GB warning threshold; each imported job keeps the current Encode Anyway snapshot.`,
      );
    const jobs = items.map((item) => ({
      id: crypto.randomUUID(),
      prompt: `Imported HTML · ${item.filename}`,
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
      status: "queued" as const,
      progress: 0,
      duration: settings.duration,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      looping: settings.looping,
      motionStyle: settings.motionStyle,
      model: settings.model,
      outputFormat: settings.outputFormat,
      encodeAnywayLarge: settings.encodeAnywayLarge,
      sourceKind: "importedHtml" as const,
      importFilename: item.filename,
      importId: item.id,
      sourceHtmlPath: item.sourcePath,
      createdAt: new Date().toISOString(),
    }));
    this.jobs.push(...jobs);
    this.update();
    return jobs;
  }
  remove(ids: string[]) {
    for (const id of ids) this.rejectPreview(id, new Error(QueueService.previewDeleted));
    this.jobs = this.jobs.filter(
      (x) =>
        !ids.includes(x.id) ||
        ![
          "generating",
          "adapting",
          "validating",
          "ready",
          "preview",
          "rendering",
          "encoding",
        ].includes(x.status),
    );
    this.update();
  }
  clear() {
    this.jobs = this.jobs.filter((x) =>
      [
        "generating",
        "adapting",
        "validating",
        "ready",
        "preview",
        "rendering",
        "encoding",
      ].includes(x.status),
    );
    this.update();
  }
  stop() {
    this.controller?.abort();
  }
  async start(settings: Settings) {
    if (this.running) return;
    this.running = true;
    const pending = this.jobs.filter((job) => job.status === "queued");
    const batchFolder = path.join(
      settings.outputFolder,
      `Batch-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`,
    );
    const projectFolder = path.join(
      this.paths.userData,
      "projects",
      path.basename(batchFolder),
    );
    await this.cleanupProjects(settings.retentionDays);
    const names = new Map<string, number>();
    const work = pending.map((job) => {
      const root = promptFileName(job.prompt);
      const count = (names.get(root.toLowerCase()) || 0) + 1;
      names.set(root.toLowerCase(), count);
      return { job, baseName: count === 1 ? root : `${root}-${count}` };
    });
    this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      let prepared = work[0]
        ? this.prepare(
            work[0].job,
            settings,
            signal,
            batchFolder,
            projectFolder,
            work[0].baseName,
          )
        : undefined;
      for (let index = 0; index < work.length; index++) {
        const current = await prepared!;
        prepared = work[index + 1]
          ? this.prepare(
              work[index + 1].job,
              settings,
              signal,
              batchFolder,
              projectFolder,
              work[index + 1].baseName,
            )
          : undefined;
        if (current) await this.renderPrepared(current, settings, signal);
      }
    } finally {
      this.running = false;
      this.controller = undefined;
    }
  }
  async deleteHistory(id: string) {
    const item = this.history.find((x) => x.id === id);
    if (item?.output && !item.baseName)
      await fs.rm(item.output, { recursive: true, force: true });
    else if (item) {
      await Promise.all(
        [
          item.htmlPath,
          item.videoPath,
          item.thumbnail,
          item.projectPath && item.baseName
            ? path.join(item.projectPath, `${item.baseName}.metadata.json`)
            : undefined,
          item.output && item.baseName
            ? path.join(item.output, `${item.baseName}.metadata.json`)
            : undefined,
          item.output && item.baseName
            ? path.join(item.output, `${item.baseName}.html`)
            : undefined,
          item.output && item.baseName
            ? path.join(item.output, `${item.baseName}.jpg`)
            : undefined,
        ]
          .filter(Boolean)
          .map((file) => fs.rm(file!, { force: true })),
      );
    }
    this.history = this.history.filter((x) => x.id !== id);
    await this.store.saveHistory(this.history);
    this.update();
  }
  async clearHistory() {
    for (const item of [...this.history]) await this.deleteHistory(item.id);
  }
  async openFolder(folder: string) {
    if (folder) await shell.openPath(folder);
  }
  regenerate(id: string, settings: Settings) {
    const item = this.history.find((x) => x.id === id);
    if (item) this.add([item.prompt], settings);
  }
  async preview(id: string) {
    const job = this.jobs.find((x) => x.id === id);
    const html =
      job?.htmlPath || (job?.output ? path.join(job.output, "index.html") : "");
    if (html) await shell.openPath(html);
  }
  private previewJob(id: string): Job {
    const job = this.jobs.find((x) => x.id === id);
    if (!job || job.status !== "preview") throw new Error("Job is not awaiting preview approval.");
    return job;
  }
  private resolvePreview(id: string, decision: PreviewDecision): void {
    const waiter = this.previewWaiters.get(id);
    if (!waiter) throw new Error("Job is not awaiting preview approval.");
    this.previewWaiters.delete(id);
    waiter.resolve(decision);
  }
  private rejectPreview(id: string, error: Error): void {
    const waiter = this.previewWaiters.get(id);
    if (!waiter) return;
    this.previewWaiters.delete(id);
    waiter.reject(error);
  }
  private waitForPreviewDecision(job: Job, signal: AbortSignal): Promise<PreviewDecision> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason || new Error("Stopped."));
        return;
      }
      const onAbort = () => {
        this.previewWaiters.delete(job.id);
        reject(signal.reason || new Error("Stopped."));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.previewWaiters.set(job.id, {
        resolve: (decision) => {
          signal.removeEventListener("abort", onAbort);
          resolve(decision);
        },
        reject: (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      });
    });
  }
  approvePreview(id: string): void {
    this.previewJob(id);
    this.log("info", "Preview approved · Rendering", id);
    this.resolvePreview(id, { action: "render" });
  }
  revisePreview(id: string, note: string): void {
    this.previewJob(id);
    if (!note.trim()) throw new Error("A revision note is required.");
    this.log("info", "Preview revision requested · Regenerating scene", id);
    this.resolvePreview(id, { action: "revise", note: note.trim().slice(0, 2000) });
  }
  remakePreview(id: string): void {
    this.previewJob(id);
    this.log("info", "Preview remake requested · Regenerating from blueprint", id);
    this.resolvePreview(id, { action: "remake" });
  }
  retry(id: string, settings: Settings) {
    const job = this.jobs.find((x) => x.id === id);
    if (!job || !["failed", "stopped"].includes(job.status)) return;
    job.status = "queued";
    job.progress = 0;
    job.error = undefined;
    job.retryCount = 0;
    this.update();
    void this.start(settings);
  }
  // HyperFrames-mode static validation: Batchmotion metadata rules first (cheap),
  // then hyperframes lint on the staged project file (structure, clips, determinism).
  private async validateHyperframesCandidate(
    html: string,
    alpha: boolean,
    job: Job,
    projectFolder: string,
    signal: AbortSignal,
  ): Promise<string[]> {
    const errors = validateHyperframesComposition(html, alpha, job.iconAssets);
    if (errors.length) return errors;
    const { dir } = await stageHyperframesComposition(projectFolder, job.id, html);
    const lint = await runHyperframesLint(dir, signal, (line) => {
      if (/error|failed/i.test(line)) this.log("warning", line.slice(-240), job.id);
    });
    return lint.map((finding) => `hyperframes lint: ${finding}`);
  }
  private async prepare(
    job: Job,
    settings: Settings,
    signal: AbortSignal,
    batchFolder: string,
    projectFolder: string,
    baseName: string,
  ) {
    const started = Date.now();
    let retries = 0;
    const renderSettings = effectiveRenderSettings(job, settings);
    try {
      const imported =
          job.sourceKind === "importedHtml" || job.sourceKind === "html-import",
        alpha = renderSettings.outputFormat === "mov-prores4444-alpha",
        // Concept mode keeps its frozen WAAPI runtime, so the GSAP contract is exempt.
        isConcept = job.mode === "concept" && !!job.conceptData,
        // Studio Split adds a breakdown-board structure check to every validation pass.
        isSplit = job.mode === "split",
        // HyperFrames engine mode: same blueprint pipeline, composition shape and
        // renderer differ (hyperframes.ts). Imported HTML stays GSAP-only.
        isHf = job.mode === "hyperframes";
      if (isHf && imported)
        throw new Error("HyperFrames engine mode supports blueprint prompt jobs; imported HTML runs on the GSAP engine. Switch mode to Background or Split for imports.");
      let html: string;
      if (imported) {
        const sourcePath = job.sourceHtmlPath || job.importedSourcePath;
        if (!sourcePath)
          throw new Error("Persisted imported source is unavailable.");
        if ((await fs.stat(sourcePath)).size > MAX_HTML_BYTES)
          throw new Error("Persisted imported source exceeds 2 MB.");
        this.log("info", "Scanning HTML", job.id);
        const source = await fs.readFile(sourcePath, "utf8"),
          report = scanImportedHtml(source),
          rejected = report.findings.filter((x) => x.level === "rejected");
        if (rejected.length)
          throw new Error(
            `HTML compatibility rejected: ${rejected.map((x) => `${x.code}: ${x.message}`).join("; ")}`,
          );
        let cached: string | undefined;
        if (
          job.adaptedHtmlPath &&
          adaptationCacheMatches(
            job.adaptationSignature,
            renderSettings.model,
            renderSettings.duration,
            renderSettings.fps,
            renderSettings.looping,
            renderSettings.outputFormat,
          )
        )
          try {
            const value = await fs.readFile(job.adaptedHtmlPath, "utf8");
            if (!validateHtml(value, alpha, { requireGsap: true }).length) cached = value;
          } catch {}
        if (cached) {
          html = cached;
          this.log("info", "Using validated adapted HTML cache", job.id);
        } else {
          // Imported source is untrusted data. Never execute it directly, even when its static
          // scan reports it already matches the runtime contract; always adapt it first.
          this.set(job, "adapting", 4);
          this.log("info", "Adapting HTML", job.id);
          html = await this.waitForProvider(
            job,
            signal,
            () =>
              adaptImportedHtml(
                renderSettings,
                source,
                report.findings.map(
                  (x) => `${x.level}: ${x.code} — ${x.message}`,
                ),
                job.seed,
                signal,
              ),
            () => checkAiProvider(renderSettings),
          );
        }
        if (signal.aborted) throw signal.reason || new Error("Stopped.");
      } else {
        this.log("info", "Prompt accepted", job.id);
        this.set(job, "generating", 2);
        if (isConcept) {
          html = await this.waitForProvider(
            job,
            signal,
            () => generateConceptHtml(renderSettings, job.conceptData!, job.seed, signal),
            () => checkAiProvider(renderSettings),
          );
          job.rawResponse = html;
          this.log("info", "AI connected · Concept HTML generated", job.id);
        } else {
          // Two-AI hybrid: Creative Director (blueprint) -> Coder (HTML from scratch).
          this.log("info", "Creative Director drafting production blueprint", job.id);
          const blueprint = await this.waitForProvider(
            job,
            signal,
            () => generateBlueprint(renderSettings, job.prompt, job.seed, signal),
            () => checkAiProvider(renderSettings),
          );
          job.blueprint = blueprint;
          this.log("info", `Blueprint ready: hero #${blueprint.heroObjectId} · ${blueprint.objects.length} objects · ${blueprint.choreography.length} motion segments`, job.id);
          // Fase 2a: resolve fresh vector assets for every non-background object.
          // Failures degrade to the geometry-lock path; they never fail the job.
          try {
            job.iconAssets = await resolveIconAssets(blueprint, {
              ledgerPath: path.join(this.paths.userData, "icon-usage.json"),
              seed: job.seed,
            });
          } catch (error) {
            job.iconAssets = [];
            this.log("warning", `Object asset search unavailable: ${(error as Error).message}`, job.id);
          }
          if (job.iconAssets.length)
            this.log("info", `Object assets: ${job.iconAssets.map((a) => `#${a.objectId} <- ${a.set}:${a.name}`).join(" · ")}`, job.id);
          else this.log("info", "Object assets: none matched; coder draws from the geometry lock", job.id);
          this.set(job, "generating", 5);
          this.log("info", "Coder translating blueprint to HTML", job.id);
          html = await this.waitForProvider(
            job,
            signal,
            () => generateHtmlFromBlueprint(renderSettings, blueprint, job.seed, signal, undefined, job.iconAssets, isSplit, isHf),
            () => checkAiProvider(renderSettings),
          );
          job.rawResponse = html;
          this.log("info", "AI connected · Blueprint HTML generated", job.id);
        }
      }
      let iconMarkerFailures = 0;
      while (true) {
        this.set(job, "validating", 8);
        const errors = isHf
          ? await this.validateHyperframesCandidate(html, alpha, job, projectFolder, signal)
          : validateHtml(html, alpha, { requireGsap: !isConcept, iconAssets: job.iconAssets, split: isSplit });
        // Fase 2a safety: icon markers are an enhancement, never a reason to kill a
        // job. One guided retry; if the model still cannot emit the marker, drop the
        // assets and continue with the existing geometry-lock path.
        if (job.iconAssets?.length && errors.some((e) => e.startsWith("Object asset"))) {
          iconMarkerFailures++;
          if (iconMarkerFailures >= 2) {
            this.log(
              "warning",
              `Object assets dropped after repeated marker failures; continuing with the geometry lock (${errors.filter((e) => e.startsWith("Object asset")).join("; ")})`,
              job.id,
            );
            job.iconAssets = [];
            continue;
          }
        }
        if (!errors.length) {
          const warnings = structurePromiseWarnings(html);
          if (warnings.length)
            this.log("warning", `Structure promise: ${warnings.join(" · ")}`, job.id);
          break;
        }
        if (retries >= settings.retryCount)
          throw new Error(`Validation failed: ${errors.join("; ")}`);
        retries++;
        job.retryCount = retries;
        this.log(
          "warning",
          `HTML validation failed: ${errors.join("; ")} · Retry ${retries}/${settings.retryCount}`,
          job.id,
        );
        this.set(job, imported ? "adapting" : "generating", 5);
        html = await this.waitForProvider(job, signal, () =>
          imported
            ? adaptImportedHtml(
                renderSettings,
                html,
                [`Static repair: ${errors.join("; ")}`],
                job.seed,
                signal,
              )
            : job.blueprint
            ? generateHtmlFromBlueprint(renderSettings, blueprintSchema.parse(job.blueprint), job.seed, signal, { html, errors }, job.iconAssets, isSplit, isHf)
            : generateHtml(
                renderSettings,
                job.prompt,
                job.seed,
                { html, errors },
                signal,
              ),
        );
        job.rawResponse = html;
      }
      const validatedHtml = html;
      // A blueprint already owns choreography. An unrelated second director pass
      // previously rewrote its geometry and contradicted its RAF timing contract.
      if (!job.blueprint && !imported) {
      this.log(
        "info",
        imported
          ? "Import-aware refinement started"
          : "AI timing refinement started",
        job.id,
      );
      try {
        this.set(job, imported ? "adapting" : "generating", 9);
        const refined = await this.waitForProvider(job, signal, () =>
          imported
            ? adaptImportedHtml(
                renderSettings,
                validatedHtml,
                [
                  "Refine while preserving source visual intent/content; enforce staged semantic timing and composition.",
                ],
                job.seed,
                signal,
              )
            : refineSingleLoop(renderSettings, validatedHtml, signal),
        );
        this.set(job, "validating", 9);
        const errors = validateHtml(refined, alpha, { requireGsap: !isConcept });
        if (errors.length)
          this.log(
            "warning",
            `Refinement rejected; using validated original HTML: ${errors.join("; ")}`,
            job.id,
          );
        else html = refined;
      } catch (error) {
        if (signal.aborted) throw error;
        this.log(
          "warning",
          `Refinement failed; using validated original HTML: ${(error as Error).message}`,
          job.id,
        );
      }
      }
      // The host owns the GSAP runtime; inject it once into the final document and
      // re-verify the paused-timeline contract. A candidate that fails (a refinement
      // that drifted from the contract, caught above with the failing check in the
      // log) falls back to the pre-refine HTML instead of failing the job.
      let lastContractErrors: string[] = [];
      const finalize = (candidate: string): string | undefined => {
        // Concept keeps WAAPI; HyperFrames carries its own <script src="gsap.min.js">
        // tag plus the staged file (injecting inline would double-load GSAP).
        const withRuntime = isConcept || isHf ? candidate : ensureGsapRuntime(candidate);
        lastContractErrors = isHf
          ? validateHyperframesComposition(withRuntime, alpha, job.iconAssets)
          : validateHtml(withRuntime, alpha, { requireGsap: !isConcept, iconAssets: job.iconAssets, split: isSplit });
        return lastContractErrors.length ? undefined : withRuntime;
      };
      const refinedFinal = finalize(html);
      const refinedContractErrors = lastContractErrors.slice();
      const finalHtml =
        refinedFinal ?? (html !== validatedHtml ? finalize(validatedHtml) : undefined);
      if (!finalHtml) {
        const detail =
          html !== validatedHtml
            ? `refined HTML: ${refinedContractErrors.join("; ")} | pre-refine HTML: ${lastContractErrors.join("; ")}`
            : refinedContractErrors.join("; ");
        throw new Error(`Final runtime contract validation failed: ${detail}`);
      }
      if (!refinedFinal)
        this.log(
          "warning",
          `Refinement broke the GSAP runtime contract (${refinedContractErrors.join("; ")}); using pre-refine HTML`,
          job.id,
        );
      html = finalHtml;
      if (imported) {
        const sourcePath = job.sourceHtmlPath || job.importedSourcePath!,
          adaptedPath = path.join(path.dirname(sourcePath), "adapted.html"),
          temporary = `${adaptedPath}.tmp`;
        await fs.writeFile(temporary, html);
        await fs.rm(adaptedPath, { force: true });
        await fs.rename(temporary, adaptedPath);
        job.adaptedHtmlPath = adaptedPath;
        job.adaptationModel = renderSettings.model;
        job.adaptationContractVersion = HTML_ADAPTATION_CONTRACT_VERSION;
        job.adaptationSignature = adaptationCacheSignature(
          renderSettings.model,
          renderSettings.duration,
          renderSettings.fps,
          renderSettings.looping,
          renderSettings.outputFormat,
        );
        this.update();
      }
      job.rawResponse = html;
      this.log(
        "info",
        "HTML validation passed after timing refinement",
        job.id,
      );
      this.log("info", "HTML prepared · Waiting for renderer", job.id);
      job.output = batchFolder;
      job.projectPath = projectFolder;
      job.baseName = baseName;
      job.htmlPath = await saveProject(job, html, projectFolder, baseName);
      if (job.blueprint) await fs.writeFile(path.join(projectFolder, `${baseName}.blueprint.json`), JSON.stringify(job.blueprint, null, 2));
      job.videoPath = path.join(batchFolder, `${baseName}.mp4`);
      this.set(job, "ready", 10);
      if (!renderSettings.autoApprove) {
        html = await this.runPreviewGate({ job, html, renderSettings, signal, projectFolder, baseName, alpha, isHf, isSplit });
        job.rawResponse = html;
      }
      return {
        job,
        batchFolder,
        projectFolder,
        baseName,
        started,
        retries,
        renderSettings,
      };
    } catch (error) {
      if ((error as Error).message === QueueService.previewDeleted) return undefined;
      job.error = (error as Error).message;
      this.set(job, signal.aborted ? "stopped" : "failed", job.progress);
      this.log("error", job.error, job.id);
      return undefined;
    }
  }
  private async renderPrepared(
    prepared: {
      job: Job;
      batchFolder: string;
      projectFolder: string;
      baseName: string;
      started: number;
      retries: number;
      renderSettings: Settings;
    },
    settings: Settings,
    signal: AbortSignal,
  ) {
    const {
      job,
      batchFolder,
      projectFolder,
      baseName,
      started,
      retries,
      renderSettings,
    } = prepared;
    const isHf = job.mode === "hyperframes";
    try {
      // Reject-and-retry for enabled visual-quality gates. A render that fails an enabled
      // gate throws RenderQualityError; we regenerate the scene and re-render before finally
      // rejecting the job. Fixed budget of 6 regeneration attempts — gates peel defects one
      // layer at a time (bounds → motion → contrast → text) and measured pairs come back in
      // the errors, so each pass should close its layer; the budget covers a slow climber
      // (`retries` below still governs user-facing retries after the job fails). Hard render
      // failures (crashes, encode errors) still fail immediately — only quality rejections
      // trigger regeneration.
      const maxAttempts = 6;
      const qualityErrors: string[] = [];
      const trace: JobTrace = { attempts: [] };
      let attemptStartedAt = 0;
      let qualityReport: RenderReport | undefined;
      let lastQualityError: string | undefined;
      let html = job.rawResponse ?? (job.htmlPath ? await fs.readFile(job.htmlPath, "utf8") : "");
      const renderOnce = async () => {
        this.log("info", isHf ? "Renderer available · Launching HyperFrames CLI" : "Renderer available · Launching Chromium", job.id);
        this.set(job, "rendering", 10);
        const progress = (value: number) => {
          job.progress = 10 + Math.round(value * 0.9);
          if (value >= 82) job.status = "encoding";
          this.update();
        };
        const lines = (line: string) => {
          if (/^Visual preflight (?:warning|skipped):|^Visual quality gate|^Capture warning/i.test(line))
            this.log("warning", line.slice(-240), job.id);
          else if (line === "Rendering frames")
            this.log("info", line, job.id);
          else if (/error|failed/i.test(line))
            this.log("warning", line.slice(-240), job.id);
        };
        if (isHf)
          return await renderHyperframesVideo({
            projectFolder,
            baseName,
            job,
            settings: renderSettings,
            signal,
            progress,
            onLog: lines,
          });
        return await renderVideo(
          projectFolder,
          baseName,
          job,
          renderSettings,
          signal,
          progress,
          lines,
        );
      };
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        attemptStartedAt = Date.now();
        try {
          if (attempt > 1 && html) {
            // Re-render the regenerated scene.
            job.rawResponse = html;
            await saveProject(job, html, projectFolder, baseName);
          }
          qualityReport = await renderOnce();
          lastQualityError = undefined;
          break;
        } catch (error) {
          if (!isRenderQualityError(error)) throw error; // hard failure: do not retry
          lastQualityError = (error as Error).message;
          if (!qualityErrors.includes(lastQualityError))
            qualityErrors.push(lastQualityError);
          trace.attempts.push({ attempt, errors: [lastQualityError], startedAt: attemptStartedAt, endedAtMs: Date.now() });
          if (consecutiveIdenticalErrors(trace, 3)) {
            lastQualityError = `Stalled: the same failure 3 times in a row (${lastQualityError}). Needs human review of the attempt trace; further regenerations are unlikely to move it.`;
            break;
          }
          if (attempt >= maxAttempts) break;
          this.log(
            "warning",
            `Quality gate rejected render (attempt ${attempt}/${maxAttempts}); regenerating scene. ${lastQualityError}`,
            job.id,
          );
          if (signal.aborted) throw signal.reason || new Error("Stopped.");
          const repair = { html, errors: [...qualityErrors], frames: (error as RenderQualityError).frames };
          const candidate = await this.waitForProvider(job, signal, () =>
            job.blueprint
              ? generateHtmlFromBlueprint(renderSettings, blueprintSchema.parse(job.blueprint), job.seed, signal, repair, job.iconAssets, job.mode === 'split', job.mode === 'hyperframes')
              : job.sourceKind === 'importedHtml' || job.sourceKind === 'html-import'
                ? adaptImportedHtml(renderSettings, html, repair.errors, job.seed, signal)
                : generateHtml(renderSettings, job.prompt, job.seed, repair, signal));
          const errors = isHf
            ? await this.validateHyperframesCandidate(candidate, renderSettings.outputFormat === 'mov-prores4444-alpha', job, projectFolder, signal)
            : validateHtml(candidate, renderSettings.outputFormat === 'mov-prores4444-alpha', { requireGsap: true, iconAssets: job.iconAssets, split: job.mode === 'split' });
          if (errors.length) {
            // A broken repair is just another failed attempt, not a dead job: feed the
            // static errors back into the accumulated repair list and regenerate.
            const message = `static validation: ${errors.join('; ')}`;
            lastQualityError = message;
            if (!qualityErrors.includes(message)) qualityErrors.push(message);
            if (attempt >= maxAttempts) break;
            this.log(
              "warning",
              `Quality repair failed static validation (attempt ${attempt}/${maxAttempts}); regenerating scene. ${message}`,
              job.id,
            );
            if (signal.aborted) throw signal.reason || new Error("Stopped.");
            continue;
          }
          html = isHf ? candidate : ensureGsapRuntime(candidate);
        }
      }
      if (lastQualityError) throw new Error(lastQualityError);
      if (qualityReport) {
        const loopPart = qualityReport.loopChecked
          ? ` · loop endpoint ${((qualityReport.loopEndpointChange ?? 0) * 100).toFixed(2)}% (${qualityReport.loopOk ? "ok" : "seam"})`
          : "";
        const stagePart =
          qualityReport.openCoverage === null
            ? ""
            : ` · opening ${(qualityReport.openCoverage * 100).toFixed(1)}% · stage contrast ${qualityReport.stageContrast ?? "n/a"} · strong change ${(qualityReport.cameraStrongRatio * 100).toFixed(1)}%${qualityReport.textFindings.length ? ` · text ${qualityReport.textFindings.length} finding(s)` : ""}`;
        this.log(
          "info",
          `Render quality: motion max ${(qualityReport.motionMaxDelta * 100).toFixed(2)}% (threshold ${(qualityReport.motionThreshold * 100).toFixed(2)}%), active frames ${qualityReport.activeFramePct}%${stagePart}${loopPart}`,
          job.id,
        );
      }
      const finalVideo = path.join(
        batchFolder,
        `${baseName}${outputExtension(renderSettings.outputFormat)}`,
      );
      job.videoPath = finalVideo;
      await fs.mkdir(batchFolder, { recursive: true });
      await fs.copyFile(
        path.join(
          projectFolder,
          `${baseName}${outputExtension(renderSettings.outputFormat)}`,
        ),
        finalVideo,
      );
      const metadata = {
        prompt: job.prompt,
        seed: job.seed,
        generationTimeMs: Date.now() - started,
        duration: job.duration,
        resolution: `${job.width}x${job.height}`,
        fps: renderSettings.fps,
        llmUsed: settings.model,
        retryCount: retries,
        // Persist the measured quality report so each rendered job carries its
        // motion/flicker/loop/beat verdicts alongside the video for later analysis.
        qualityReport: qualityReport ?? null,
      };
      await fs.writeFile(
        path.join(projectFolder, `${baseName}.metadata.json`),
        JSON.stringify(metadata, null, 2),
      );
      if (settings.artifactMode !== "video")
        await fs.copyFile(
          path.join(projectFolder, `${baseName}.metadata.json`),
          path.join(batchFolder, `${baseName}.metadata.json`),
        );
      if (settings.artifactMode === "debug")
        await Promise.all(
          ["html", "jpg"].map((ext) =>
            fs.copyFile(
              path.join(projectFolder, `${baseName}.${ext}`),
              path.join(batchFolder, `${baseName}.${ext}`),
            ),
          ),
        );
      this.set(job, "completed", 100);
      if (job.sourceTxtPath)
        try {
          await markTxtDone(job.sourceTxtPath, job.prompt);
        } catch (error) {
          this.log(
            "warning",
            `Video completed, but TXT could not be updated: ${(error as Error).message}`,
            job.id,
          );
        }
      this.history.unshift({
        ...job,
        completedAt: new Date().toISOString(),
        thumbnail: path.join(projectFolder, `${baseName}.jpg`),
      });
      await this.store.saveHistory(this.history);
      this.update();
    } catch (error) {
      const stage: ErrorStage = job.status === "encoding" ? "encoding" : "queue";
      const normalized = normalizeThrown(error, stage);
      job.error = normalized.message;
      try {
        await fs.appendFile(
          path.join(projectFolder, ".render-diagnostics.jsonl"),
          `${JSON.stringify({ timestamp: new Date().toISOString(), jobId: job.id, ...normalized })}\n`,
        );
      } catch {}
      this.set(job, signal.aborted ? "stopped" : "failed", job.progress);
      this.log("error", job.error, job.id);
    }
  }
  private set(job: Job, status: Job["status"], progress: number) {
    job.status = status;
    job.progress = progress;
    this.log("info", status[0].toUpperCase() + status.slice(1), job.id);
    this.update();
  }
  private log(level: LogEntry["level"], message: string, jobId?: string) {
    this.emit("log", {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      message,
      jobId,
    } satisfies LogEntry);
  }
  private update() {
    this.emit("queue:update", this.snapshot());
    const snapshot = this.jobs.map((job) => ({ ...job }));
    this.saving = this.saving
      .then(() => this.store.saveQueue(snapshot))
      .catch((error) =>
        this.log(
          "error",
          `Queue could not be saved: ${(error as Error).message}`,
        ),
      );
  }
  flush() {
    return this.saving;
  }
  private async cleanupProjects(retentionDays: number) {
    const root = path.join(this.paths.userData, "projects");
    const cutoff = Date.now() - retentionDays * 86400000;
    try {
      for (const entry of await fs.readdir(root, { withFileTypes: true }))
        if (entry.isDirectory()) {
          const folder = path.join(root, entry.name);
          if ((await fs.stat(folder)).mtimeMs < cutoff)
            await fs.rm(folder, { recursive: true, force: true });
        }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.log(
          "warning",
          `Project cleanup failed: ${(error as Error).message}`,
        );
    }
  }
}

const interrupted: Job["status"][] = [
  "generating",
  "adapting",
  "validating",
  "ready",
  // A waiting preview loses its in-memory approval waiter on restart; retry
  // re-runs prepare and parks at preview again with fresh stills.
  "preview",
  "rendering",
  "encoding",
];
export function restoreQueue(jobs: Job[]) {
  return jobs.map((job) => {
    job.outputFormat = normalizeOutputFormat(job.outputFormat);
    job.encodeAnywayLarge = job.encodeAnywayLarge === true;
    return interrupted.includes(job.status)
      ? {
          ...job,
          status: "stopped" as const,
          error: "Interrupted when Batchmotion was closed. Retry to continue.",
        }
      : job;
  });
}
export function effectiveRenderSettings(
  job: Job,
  settings: Settings,
): Settings {
  return {
    ...settings,
    duration: job.duration,
    width: job.width,
    height: job.height,
    fps: job.fps ?? settings.fps,
    // Studio Split is a one-pass breakdown board; a queued legacy job with looping on
    // would restart the playhead sweep mid-clip. HyperFrames mode renders finite clips.
    looping: job.mode === "split" || job.mode === "hyperframes" ? false : (job.looping ?? settings.looping),
    motionStyle: job.motionStyle ?? settings.motionStyle,
    outputFormat: normalizeOutputFormat(job.outputFormat),
    encodeAnywayLarge: job.encodeAnywayLarge === true,
    model:
      job.model?.trim() ||
      job.generationModel?.trim() ||
      job.refinementModel?.trim() ||
      settings.model,
  };
}
