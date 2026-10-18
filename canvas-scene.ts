import { gefootHtml, gefootPrompt, kitIconNames } from './gefoot-runtime';
export const BASE_W = 1920;
export const BASE_H = 1080;

/** Appended to every Canvas request: the host-provided MF kit plus the shape, layout and motion bar a sellable clip must meet. */
export const CRAFT_CONTRACT = `HOST KIT (already in scope as the global MF; do not redefine it, do not paste it, just call it). Every helper is deterministic and draws in 1920x1080 units:
- Icons: MF.icon(ctx, name, cx, cy, size, {color, width:2, progress, alpha, rotate, fill}) draws a professional line icon centred on (cx,cy) on a 24-unit grid; progress<1 draws its strokes on. MF.badge(ctx, name, cx, cy, size, {bg, fg, shape:'circle'|'squircle', progress, alpha, ring}) is a solid app-icon style badge. Names: ${kitIconNames.join(', ')}. Aliases such as package, parcel, payment, creditcard, money, invoice, discount, profile, settings, analytics, growth, location also resolve.
- Surfaces: MF.card(ctx, x, y, w, h, {r, fill, stroke, shadow, alpha}) (x,y = top-left) is a rounded panel with a soft drop shadow; MF.rr(ctx, x, y, w, h, r) builds a rounded-rect path; MF.shadow / MF.noShadow set one consistent shadow.
- Data UI: MF.bar(ctx, x, y, w, h, p, {color, track}), MF.ring(ctx, cx, cy, r, p, {width, color, track}), MF.line(ctx, x0, y0, x1, y1, p, {color, width, dash}), MF.text(ctx, str, x, y, {size, weight, color, align, tracking, alpha}), MF.fmt(value, {decimals, prefix, suffix}).
- Motion: MF.seg(t, start, dur, ease) -> eased 0..1 of a window; MF.stagger(t, i, start, step, dur, ease); MF.track(t, [[time, value, ease], ...]) keyframes; MF.spring(t - start, {freq, damping}) a settle with natural overshoot; MF.enter(ctx, p, x, y, (c) => {...draw at local 0,0...}, {from:'up'|'down'|'left'|'right', dist, scale}) fade + travel + scale in; MF.camera(ctx, t, duration, {zoom:0.04, loop}) a slow push-in (call inside save/restore); MF.float(t, i, amp) idle drift; MF.ease.outCubic / outQuart / outExpo / outBack / inOutCubic / inOutSine; MF.mixColor, MF.rgba, MF.lerp, MF.clamp; MF.SAFE = {x0, x1, y0, y1} safe area.

OBJECT CRAFT (this is what makes the clip sellable):
- Every recognisable object (cart, card, package, truck, coin, user, lock, bell, chart, phone, document...) is drawn with MF.icon or MF.badge, not hand-drawn from ad-hoc lines. Hand-draw only what the kit cannot express (a custom illustration, the hero product shape), and then with the same stroke weight, the same round joins and the same palette as the kit icons.
- One visual system for the whole clip: one corner radius family, one icon stroke weight, one shadow, a palette of at most 3 colours plus neutrals, one font (MF.FONT) in at most 3 sizes. UI-like content sits on MF.card surfaces.
- At thumbnail size every object must still be named correctly. No unexplained glyphs, ticks, dashes or decorative marks.
- UNIQUENESS: each persistent object is drawn exactly once per frame and keeps its identity and anchor while it moves; never leave a duplicate copy standing.

LAYOUT:
- Plan the layout first: compute every object's rectangle in setup() from a simple grid inside MF.SAFE and draw from those rectangles. Nothing overlaps by accident, every object keeps a clear gap to its neighbours, text never sits on another object or on a moving part, reserved negative space stays empty.
- Hierarchy: exactly one hero element at a time is clearly the largest and most contrasted; supporting elements are smaller and calmer.

MOTION (professional, not template):
- Every entrance is MF.enter with an eased progress (outCubic / outQuart / outExpo, or MF.spring for a small overshoot) lasting 0.45-0.9 s; groups stagger 0.06-0.12 s with MF.stagger. No linear moves, no instant pops, no element appearing at full alpha.
- Lines, routes, icons and progress fill with draw-on (progress) in sync with the story. Values count up with an ease (MF.fmt on an eased value).
- Exactly one primary motion at a time; everything else holds with at most a subtle MF.float idle. Stage changes overlap: the outgoing element eases out while the incoming one eases in, the shared container stays and morphs (MF.mixRect, MF.track).
- Wrap the scene in a slow MF.camera push-in (zoom 0.02-0.05) for depth; use loop:true when the clip loops.
- The final 1.5 s hold a complete, calm composition that works as the thumbnail.`;

export function buildGefootPrompt(concept: string, duration: 10 | 11 | 12, fps: number, seed: number, alpha = false): string {
  const prompt = gefootPrompt(concept);
  return `${prompt}\n${CRAFT_CONTRACT}\nHOST OPTIONS: DURATION must be ${duration}; fps=${fps}; seed=${seed}.${alpha ? '\nALPHA override: preserve transparent background instead of painting a full opaque background.' : ''}`;
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
