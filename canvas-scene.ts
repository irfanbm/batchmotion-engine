import { gefootHtml, gefootPrompt } from './gefoot-runtime';
export const BASE_W = 1920;
export const BASE_H = 1080;

export function buildGefootPrompt(concept: string, duration: 10 | 11 | 12, fps: number, seed: number, alpha = false): string {
  const prompt = gefootPrompt(concept);
  return `${prompt}\nHOST OPTIONS: DURATION must be ${duration}; fps=${fps}; seed=${seed}.${alpha ? '\nALPHA override: preserve transparent background instead of painting a full opaque background.' : ''}`;
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
