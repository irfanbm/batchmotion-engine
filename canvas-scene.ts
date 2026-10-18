import { gefootHtml, gefootPrompt } from './gefoot-runtime';
export const BASE_W = 1920;
export const BASE_H = 1080;

/** Appended by the host to every Canvas request, independent of the vendored prompt.js, so a stock clip is always flowing, placed and moved correctly. */
export const MICROSTOCK_CONTRACT = `MICROSTOCK FOOTAGE CONTRACT (this clip is sold as stock footage; it must be usable as delivered):
- FLOW: one continuous shot the viewer can follow from start to end. Keep ONE persistent hero container/object for the whole clip and make every stage a state change of it (move, scale, morph, cross-fade) over overlapping eased windows of at least 0.4 s. Never swap whole drawings with if/else or switch on the time at full alpha, never show an empty or half-built frame between stages. Each element enters from where it logically comes from and leaves toward where it goes.
- START/END: frame 0 is already a resolved, recognisable composition; the last 1.5 s are a calm, complete, held final composition (the intended thumbnail).
- PLACEMENT: all visible content stays inside a safe area (at least 6% margin left/right, 8% top/bottom) at every frame; nothing is clipped by the frame or by its own container, nothing overlaps by accident, and negative/copy space requested by the brief stays truly empty. Align objects to a simple grid with consistent spacing.
- SHAPE: every object is recognisable at thumbnail size for what it is (a cart reads as a cart, a package as a package). Build icons from simple geometric primitives with one stroke width, one corner radius and the brief's palette; no unexplained glyphs, ticks or decorations.
- MOTION: ease-in-out (or a small overshoot) on every move, 60-120 ms stagger between siblings, one motion idea per stage, consistent speed, no sudden jumps, progress/route elements drawn progressively in sync with the story.`;

export function buildGefootPrompt(concept: string, duration: 10 | 11 | 12, fps: number, seed: number, alpha = false): string {
  const prompt = gefootPrompt(concept);
  return `${prompt}\n${MICROSTOCK_CONTRACT}\nHOST OPTIONS: DURATION must be ${duration}; fps=${fps}; seed=${seed}.${alpha ? '\nALPHA override: preserve transparent background instead of painting a full opaque background.' : ''}`;
}

export function extractJavaScript(raw: string, _expectedDuration = 10): string {
  const fences = [...raw.matchAll(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/g)].map(m => m[1]);
  const scripts = [...raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const candidates = fences.length ? fences : scripts;
  const code = (candidates.length ? candidates.sort((a, b) => b.length - a.length)[0] : raw).trim();
  return code.replace(/^(?:javascript|js)[ \t]*(?:\r?\n|(?=\/\/|\/\*))/i, '').trim();
}

export function parseCanvasMeta(code: string) {
  const line = (name: string) => code.match(new RegExp(`^\\s*//\\s*${name}:[ \\t]*(.*)$`, 'im'))?.[1]?.trim() ?? '';
  const seconds = Number(line('DURATION').match(/^\d+(?:\.\d+)?/)?.[0]);
  return { title: line('TITLE'), keywords: [...new Set(line('KEYWORDS').split(',').map(x => x.trim()).filter(Boolean))].join(', '), category: line('CATEGORY'), duration: seconds ? Math.min(60, Math.max(5, Math.round(seconds))) : 0, loop: /^(yes|true)/i.test(line('LOOP')) };
}

export function validateCanvasCode(code: string, expectedDuration: number): string[] {
  const errors: string[] = [];
  const fenceCount = (code.match(/^[ \t]*```/gm) ?? []).length;
  if (fenceCount) errors.push('Output contains a stray or unclosed ``` code fence (response is incomplete or malformed)');
  try { new Function(`${code}\nreturn {setup: typeof setup, draw: typeof draw};`); } catch (e) { errors.push(`JavaScript syntax: ${(e as Error).message}`); }
  if (!/\bfunction\s+setup\s*\(/.test(code) && !/(?:const|let|var)\s+setup\s*=/.test(code)) errors.push('Missing setup(env)');
  if (!/\b(?:function\s+draw\s*\(|(?:const|let|var)\s+draw\s*=)/.test(code)) errors.push('Missing draw(ctx, t, env)');
  return errors;
}

/** Canvas always receives the user's brief verbatim; beautify/structurePrompt only apply to the legacy HTML path. */
export function canvasBrief(job: { prompt: string; originalPrompt?: string }): string { return job.originalPrompt ?? job.prompt; }

/** Host duration is the single source of truth; model metadata is advisory only. */
export function hostCanvasDuration(requested: number): 10 | 11 | 12 { return requested === 11 || requested === 12 ? requested : 10; }

export function canvasHtml(code: string, fps: number, seed: number, alpha = false, duration?: number): string {
  return gefootHtml(code, duration === undefined ? (parseCanvasMeta(code).duration || 10) : hostCanvasDuration(duration), fps, seed, alpha);
}
