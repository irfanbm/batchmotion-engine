import { gefootHtml, gefootPrompt } from './gefoot-runtime';
export const BASE_W = 1920;
export const BASE_H = 1080;

/** Appended to every Canvas request: the host-provided MF kit plus the shape, layout and motion bar a sellable clip must meet. */
export const CRAFT_CONTRACT = `HOST MOTION KIT (already in scope as global MF; do not redefine it):
- Surfaces: MF.card(ctx,x,y,w,h,{r,fill,stroke,shadow,alpha}), MF.rr, MF.shadow, MF.noShadow.
- Typography/data: MF.text, MF.fmt, MF.bar, MF.ring, MF.line, MF.rgba, MF.mixColor.
- Motion: MF.seg, MF.stagger, MF.track, MF.spring, MF.enter, MF.camera, MF.float, MF.ease, MF.lerp, MF.clamp, MF.SAFE. All are deterministic and use 1920x1080 scene units.

CUSTOM OBJECT CRAFT:
- Do NOT use an icon library, named icon set, generic glyph, emoji, or a repeated universal symbol. Do NOT call MF.icon or MF.badge: they do not exist.
- Draw the hero object yourself from 4-10 meaningful parts that explain its identity and function. For a card: body, chip, stripe, number blocks and logo mark. For a package: box planes, flap, tape, label and shadow. For a cart: basket, handle, two wheels, products and a distinct accent. For a phone: bezel, screen, camera, content and side buttons. Each concept needs its own silhouette, proportions and signature detail.
- The hero silhouette must remain recognisable at thumbnail size. Supporting objects may be simpler, but must share the hero's custom palette, corner language, stroke weight and lighting. Never draw a generic circle plus a letter and call it an object.
- Create named draw functions such as drawHeroCard, drawPackage, drawCart, drawCheckmark, drawRoute; keep each object's geometry in one place so it can be refined and animated independently.

FLOW (the viewer must understand it without reading):
- First 0.0-1.0s: establish one complete hero object and its destination; no abstract intro, no empty waiting, no simultaneous object dump.
- Next beats: one action per beat in causal order: object appears -> moves/changes -> result appears. Use 3-5 beats total, each with a clear start and end.
- Keep one persistent hero container through the whole story. Morph its state or move it; never replace the entire drawing with an unrelated composition. Every stage must inherit the previous stage's position or visual element.
- Use one focal area and a consistent reading direction (left-to-right or bottom-to-top). Do not make cards, labels and connectors compete for attention.
- Leave 0.5-0.9s of readable hold after each important state change. The final 1.5s is a clean, complete result frame suitable as a thumbnail.

LAYOUT:
- In setup(), define rectangles for every object inside MF.SAFE before drawing. Reserve non-overlapping zones; keep 6% side and 8% top/bottom margins. Never let text, connectors or shadows collide with another object.
- Exactly one hero element is largest and most contrasted. Supporting elements are smaller, quieter and introduced only when needed. No duplicate object is ever left behind.

MOTION:
- Use MF.seg/MF.stagger with outCubic, outQuart, outExpo or a restrained MF.spring; never linear motion, instant full-alpha pops, random jitter or teleporting.
- Every entrance takes 0.45-0.9s; sibling stagger is 0.06-0.12s. Draw routes, progress, checks and values progressively in causal sync.
- Use object-specific secondary motion: wheels rotate, a flap opens, a card tilts, a check draws on, a label settles. Do not give every object the same slide-in.
- Only one primary motion runs at a time. Other elements hold or have subtle MF.float. Stage transitions overlap the outgoing and incoming states while preserving the shared hero.
- Use a restrained MF.camera push-in of 0.02-0.05 for depth. Avoid excessive zooms, spins, bounces and decoration.
- No visual event may require the viewer to guess what changed.`;

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
