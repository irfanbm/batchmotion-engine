import { popReport, type PopReport } from './quality';

// Hard cuts (a whole drawing swapped for another inside one frame) read as "chaotic" even when every frame is valid.
// This is NOT a gate: at most ONE extra repair request is made, the result is accepted only when it is valid AND measurably calmer,
// and otherwise the original scene is kept untouched.

export const POP_REPAIR_MIN_COUNT = 3;
export const POP_REPAIR_MIN_STEP = 0.02;

export function needsTransitionRepair(report: PopReport): boolean {
  return report.pops.length >= POP_REPAIR_MIN_COUNT || report.pops.some((p) => p.step >= POP_REPAIR_MIN_STEP);
}

/** Lower is calmer: the biggest single-frame jump dominates, the number of jumps breaks ties. */
export function popScore(report: PopReport): number {
  return Math.max(0, ...report.pops.map((p) => p.step)) + report.pops.length * 0.001;
}

export function transitionRepairErrors(report: PopReport, fps: number): string[] {
  const list = report.pops.slice(0, 8).map((p) => `${(p.frame / fps).toFixed(2)}s (${(p.step * 100).toFixed(1)}% of the frame changes in ONE frame)`).join(', ');
  return [
    `HARD CUTS between otherwise calm frames at: ${list}. The scene swaps whole drawings (typically if/else or switch on the time/stage, or content drawn at full alpha the moment a stage starts) instead of transforming persistent objects.`,
    'Fix: keep ONE persistent panel/card/frame for the whole scene and animate it (position, scale, alpha, width) with overlapping eased windows of at least 0.35 s. Content that leaves must fade/slide out while the next fades/slides in over the same window; nothing may appear or disappear at alpha 1 inside a single frame. Do not branch on the stage to draw different content at full opacity. Keep the composition, palette, objects and timing; change only how states are connected.',
  ];
}

export interface RefineDeps {
  steps: (code: string) => Promise<number[]>;
  /** Returns hard errors (syntax/probe/NaN/…); empty array means the candidate is valid. */
  validate: (code: string) => Promise<string[]>;
  regenerate: (code: string, errors: string[]) => Promise<string>;
  fps: number;
  log: (message: string) => void;
}

/** Returns the scene to use: the repaired one only when valid and calmer, otherwise the original. */
export async function refineTransitions(code: string, deps: RefineDeps): Promise<string> {
  let before: PopReport;
  try { before = popReport(await deps.steps(code)); } catch { return code; }
  if (!needsTransitionRepair(before)) return code;
  deps.log(`Canvas transition check: ${before.pops.length} hard cut(s), max ${(before.maxStep * 100).toFixed(1)}% in one frame · one repair attempt (not a gate)`);
  try {
    const candidate = await deps.regenerate(code, transitionRepairErrors(before, deps.fps));
    if ((await deps.validate(candidate)).length) { deps.log('Transition repair discarded: candidate failed validation; keeping the original scene.'); return code; }
    const after = popReport(await deps.steps(candidate));
    if (popScore(after) < popScore(before) * 0.7) { deps.log(`Transition repair accepted: ${before.pops.length} → ${after.pops.length} hard cut(s), max ${(before.maxStep * 100).toFixed(1)}% → ${(after.maxStep * 100).toFixed(1)}%.`); return candidate; }
    deps.log('Transition repair discarded: not measurably calmer; keeping the original scene.');
  } catch (e) { deps.log(`Transition repair skipped: ${(e as Error).message}`); }
  return code;
}
