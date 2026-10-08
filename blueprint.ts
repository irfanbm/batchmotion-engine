import { z } from 'zod';
import { sceneCraftContract } from './scene-craft';

// Production Blueprint: the Creative Director's output. This is the single contract
// that the Coder translates into HTML. Every visual/motion decision is numeric and
// code-translatable — no ambiguous prose. Adapted and extended from the two-AI
// creative-direction workflow; strengthened with stricter numeric requirements.

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'hex color #rrggbb');

// Normalized rect in viewport fractions (0..1). The Coder maps to the target resolution.
export const rectSchema = z.object({
  x: z.number().min(-1).max(2),
  y: z.number().min(-1).max(2),
  w: z.number().min(0).max(2),
  h: z.number().min(0).max(2),
});

export const paletteSchema = z.object({
  base: hexColor,
  primary: hexColor,
  secondary: hexColor,
  accent: hexColor,
});

export const materialSchema = z.object({
  name: z.enum(['matte', 'metallic', 'glass', 'plastic', 'paper', 'ceramic', 'neon', 'fabric', 'liquid', 'glossy']),
  // How the material look is *constructed* (the "tell"), so the coder renders it correctly.
  construction: z.string().min(8),
});

export const sceneObjectSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['hero', 'support', 'interaction', 'background']),
  shape: z.string().min(1), // primitive + construction, e.g. "3-layer rim coin: outer ring, recessed face, embossed symbol"
  details: z.array(z.string()).min(1), // >=3 for hero (enforced by quality gate)
  material: materialSchema,
  rect: rectSchema,
  zIndex: z.number().int().min(0).max(40).default(1),
  opacity: z.number().min(0).max(1).default(1),
  functionalRole: z.string().min(1), // why this object exists
  geometry: z.object({
    silhouette: z.string().min(12),
    aspectRatio: z.number().positive(), // local width / height, independent of viewport
    parts: z.array(z.object({ name: z.string().min(1), rect: rectSchema })).min(2),
    attachment: z.string().min(8),
  }).optional(), // Older saved blueprints did not carry a construction specification.
});

export const motionSegmentSchema = z.object({
  from: z.number().min(0), // seconds
  to: z.number().min(0),   // seconds
  objectId: z.string().min(1),
  property: z.string().min(1), // e.g. "translate", "rotate", "scale", "opacity", "path-offset"
  fromValue: z.string().min(1),
  toValue: z.string().min(1),
  trajectory: z.string().optional(), // e.g. "cubic-bezier path", "arc via Math.cos/sin", "linear"
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring', 'bounce', 'custom']),
  easingSpec: z.string().optional(), // e.g. cubic-bezier(...) or spring params
  physical: z.string().optional(),   // anticipation/impact/overshoot/settle note
  trigger: z.string().optional(),    // cause for action-reaction
  reaction: z.string().optional(),   // the reaction consequence
});

export const loopMathSchema = z.object({
  durationSec: z.number().min(1).max(300),
  fps: z.number().int().min(12).max(60),
  enabled: z.boolean().default(true),
  returnMechanism: z.string().min(4), // how the end returns to the start state
});

export const blueprintSchema = z.object({
  concept: z.string().min(4),
  commercialIntent: z.string().min(4),
  visualMetaphor: z.string().min(4),
  visualHook: z.string().min(4),
  signatureMotion: z.string().min(4),
  visualPayoff: z.string().min(4),
  style: z.string().min(3),
  palette: paletteSchema,
  heroObjectId: z.string().min(1),
  objects: z.array(sceneObjectSchema).min(1),
  composition: z.array(sceneObjectSchema).min(1), // alias of objects laid out; kept for clarity
  choreography: z.array(motionSegmentSchema).min(1),
  loop: loopMathSchema,
  background: z.string().min(3),
  safeZone: rectSchema.optional(),
  negativeSpace: z.string().optional(),
  microMotion: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]),
});

export type Blueprint = z.infer<typeof blueprintSchema>;

// ---- Quality gate (the anti-generic test). Returns a list of failures; empty = pass.

// Abstract stand-ins are only acceptable when the brief itself is abstract.
const ABSTRACT_HERO_PATTERN = /\b(orb|energy (field|ball|wave)|aura|glow(?:ing)? (?:ball|sphere|shape)|blob|swirl|nebula|plasma|wisp)\b/i;
const ABSTRACT_BRIEF_PATTERN = /\b(abstract|gradient background|ink (?:in|in the) water|smoke|bokeh|particles|fluid|aurora|texture|mesh background)\b/i;

export function blueprintQualityGate(bp: Blueprint, brief = ''): string[] {
  const fail: string[] = [];
  const hero = bp.objects.find((o) => o.id === bp.heroObjectId && o.role === 'hero');
  if (!hero) fail.push('no hero object defined');
  else {
    if (hero.details.length < 3) fail.push(`hero object "${hero.id}" has fewer than 3 concrete details (${hero.details.length})`);
    if (!hero.functionalRole.trim()) fail.push(`hero object "${hero.id}" has no functional role`);
    if (!hero.geometry) fail.push('hero geometry must specify silhouette, aspectRatio, local parts and attachment anchors');
    else if (hero.geometry.parts.length < 3) fail.push(`hero object "${hero.id}" has ${hero.geometry.parts.length} geometry parts; a real-world object needs at least 3 canonical parts`);
    if (!ABSTRACT_BRIEF_PATTERN.test(brief)) {
      const hit = `${hero.shape} ${hero.geometry?.silhouette ?? ''}`.match(ABSTRACT_HERO_PATTERN);
      if (hit) fail.push(`hero object "${hero.id}" is described with an abstract stand-in ("${hit[0]}") in its shape/silhouette; keep the concrete hero but rewrite shape and silhouette using the object's canonical real-world form and parts`);
    }
  }
  const ids = new Set(bp.objects.map(o => o.id));
  if (ids.size !== bp.objects.length) fail.push('object IDs must be unique');
  if (bp.objects.filter(o => o.role === 'hero').length !== 1) fail.push('exactly one hero role is required');
  for (const segment of bp.choreography) {
    if (!ids.has(segment.objectId)) fail.push(`motion references unknown object #${segment.objectId}`);
    if (segment.to <= segment.from || segment.to > bp.loop.durationSec)
      fail.push(`invalid motion interval ${segment.from}-${segment.to}s for #${segment.objectId}`);
    if (['spring', 'bounce', 'custom'].includes(segment.easing) && !segment.easingSpec)
      fail.push(`numeric easingSpec required for ${segment.easing} on #${segment.objectId}`);
  }
  if (bp.objects.filter((o) => o.role !== 'background').length < 2) fail.push('concept needs at least a hero and one supporting/interaction object');
  // Motion coverage (live defect 2026-10-06: both test clips froze seconds before
  // their own duration because the director parked them with dead segments).
  const valueChanges = (s: { fromValue: string; toValue: string }) =>
    s.fromValue.replace(/\s+/g, ' ').trim() !== s.toValue.replace(/\s+/g, ' ').trim();
  for (const segment of bp.choreography) {
    if (!valueChanges(segment))
      fail.push(`motion segment ${segment.from}-${segment.to}s on #${segment.objectId} has identical start and end values ("${segment.fromValue}"); drop it or animate a real value change`);
  }
  const duration = bp.loop.durationSec;
  const heroLastEnd = bp.choreography
    .filter((s) => s.objectId === bp.heroObjectId && valueChanges(s))
    .reduce((max, s) => Math.max(max, s.to), 0);
  if (heroLastEnd < duration / 2)
    fail.push(`hero #${bp.heroObjectId} stops moving at ${heroLastEnd}s of ${duration}s; keep the hero active past the midpoint (reveal, follow, settle or exit) instead of freezing it`);
  const lastChangeEnd = bp.choreography.filter(valueChanges).reduce((max, s) => Math.max(max, s.to), 0);
  if (lastChangeEnd < duration * 0.75)
    fail.push(`motion ends at ${lastChangeEnd}s of ${duration}s; carry changing motion into the final quarter (from ${(duration * 0.75).toFixed(1)}s onward) so the ending is not a frozen frame`);
  // Signature motion must not be a generic transform.
  if (/\b(float|rotate|pulse|scale|fade|zoom)\b/i.test(bp.signatureMotion) && bp.signatureMotion.length < 24)
    fail.push('signature motion is a generic transform (float/rotate/pulse/scale/fade/zoom); make it concept-specific');
  // Object relationship: at least one choreography segment should carry trigger/reaction.
  if (!bp.choreography.some((s) => (s.trigger && s.trigger.trim()) || (s.reaction && s.reaction.trim())))
    fail.push('no object relationship: add at least one motion segment with a trigger or reaction (action -> reaction)');
  // Loop math sanity.
  if (!(bp.loop.durationSec > 0)) fail.push('loop duration must be positive');
  // Generic-decoration detector: if removing the hook/payoff leaves nothing, concept is empty.
  if (!bp.visualHook.trim() || !bp.visualPayoff.trim()) fail.push('concept has no visual hook or payoff (decoration-only concept)');
  // Composition numeric sanity: hero should be meaningfully sized.
  if (hero && hero.rect.w * hero.rect.h < 0.004) fail.push(`hero object "${hero.id}" occupies a negligible area (${(hero.rect.w * hero.rect.h * 100).toFixed(1)}%); enlarge it`);
  return fail;
}

// ---------------------------------------------------------------------------
// Normalize known representation differences, not missing creative decisions.
// Incomplete geometry/timing must be corrected by the director, never fabricated.
// ---------------------------------------------------------------------------

const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v.trim() ? v.trim() : fallback);
const num = (v: unknown, fallback: number, min = -1e9, max = 1e9): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const strArr = (v: unknown, fallback: string[]): string[] => arr(v).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);

function normalizeHex(v: unknown, fallback: string): string {
  if (typeof v === 'string') {
    const m = v.trim().match(/^#?[0-9a-fA-F]{6}$/);
    if (m) return ('#' + m[0].replace('#', '')).toLowerCase();
    // Handle "rgb(r,g,b)"
    const rgb = v.match(/(\d+)\D+(\d+)\D+(\d+)/);
    if (rgb) return '#' + [rgb[1], rgb[2], rgb[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, '0')).join('');
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.hex === 'string') return normalizeHex(o.hex, fallback);
    if (typeof o.value === 'string') return normalizeHex(o.value, fallback);
  }
  return fallback;
}

const ROLE_MAP: Record<string, 'hero' | 'support' | 'interaction' | 'background'> = {
  hero: 'hero', subject: 'hero', main: 'hero', focal: 'hero', 'main subject': 'hero',
  support: 'support', supporting: 'support', secondary: 'support', prop: 'support',
  interaction: 'interaction', interactive: 'interaction', reactor: 'interaction',
  background: 'background', backdrop: 'background', bg: 'background', environment: 'background', ambient: 'background',
};
function normalizeRole(v: unknown, fallback: 'hero' | 'support' | 'interaction' | 'background'): 'hero' | 'support' | 'interaction' | 'background' {
  const key = str(v, '').toLowerCase();
  return ROLE_MAP[key] || fallback;
}

const MATERIAL_NAMES = ['matte', 'metallic', 'glass', 'plastic', 'paper', 'ceramic', 'neon', 'fabric', 'liquid', 'glossy'] as const;
function normalizeMaterial(v: unknown): { name: (typeof MATERIAL_NAMES)[number]; construction: string } {
  if (typeof v === 'string') {
    const lower = v.toLowerCase();
    const name = (MATERIAL_NAMES as readonly string[]).find((n) => lower.includes(n)) as (typeof MATERIAL_NAMES)[number] | undefined;
    return { name: name || 'matte', construction: v.length >= 8 ? v : `${name || 'matte'} surface treatment` };
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const name = (MATERIAL_NAMES as readonly string[]).find((n) => str(o.name, '').toLowerCase().includes(n)) as (typeof MATERIAL_NAMES)[number] | undefined;
    return { name: name || 'matte', construction: str(o.construction, str(o.description, `${name || 'matte'} surface treatment`)) };
  }
  return { name: 'matte', construction: 'matte surface treatment' };
}

function normalizeRect(v: unknown): { x: number; y: number; w: number; h: number } {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    x: num(o.x, NaN), y: num(o.y, NaN),
    w: num(o.w ?? o.width, NaN), h: num(o.h ?? o.height, NaN),
  };
}

function normalizeObject(v: unknown, index: number): z.infer<typeof sceneObjectSchema> {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const id = str(o.id, str(o.name, `object-${index + 1}`));
  return {
    id,
    role: normalizeRole(o.role, index === 0 ? 'hero' : 'support'),
    shape: str(o.shape, str(o.primitive, '')),
    details: strArr(o.details, []),
    material: normalizeMaterial(o.material),
    rect: normalizeRect(o.rect ?? o.position ?? o.layout),
    zIndex: Math.round(num(o.zIndex ?? o.z, 1, 0, 40)),
    opacity: num(o.opacity, 1, 0, 1),
    functionalRole: str(o.functionalRole, str(o.purpose, '')),
    geometry: o.geometry as z.infer<typeof sceneObjectSchema>['geometry'],
  };
}

const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring', 'bounce', 'custom'] as const;
function normalizeEasing(v: unknown): (typeof EASINGS)[number] {
  const lower = str(v, '').toLowerCase();
  if (lower.includes('spring')) return 'spring';
  if (lower.includes('bounce')) return 'bounce';
  if (lower.includes('inout') || (lower.includes('in') && lower.includes('out'))) return 'ease-in-out';
  if (lower.includes('out')) return 'ease-out';
  if (lower.includes('in')) return 'ease-in';
  if (lower.includes('linear') || lower.includes('constant')) return 'linear';
  if (lower.includes('cubic') || lower.includes('bezier') || lower.includes('custom')) return 'custom';
  return 'ease-in-out';
}

function normalizeSegment(v: unknown): z.infer<typeof motionSegmentSchema> {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const from = num(o.from ?? o.start ?? o.t0, NaN);
  const to = num(o.to ?? o.end ?? o.t1, NaN);
  return {
    from, to,
    objectId: str(o.objectId ?? o.object ?? o.id ?? o.target, ''),
    property: str(o.property ?? o.prop, ''),
    fromValue: String(o.fromValue ?? o.startValue ?? ''),
    toValue: String(o.toValue ?? o.endValue ?? ''),
    trajectory: o.trajectory ? str(o.trajectory, '') : undefined,
    easing: normalizeEasing(o.easing ?? o.ease),
    easingSpec: o.easingSpec ? str(o.easingSpec, '') : undefined,
    physical: o.physical ? str(o.physical, '') : undefined,
    trigger: o.trigger ? str(o.trigger, '') : undefined,
    reaction: o.reaction ? str(o.reaction, '') : undefined,
  };
}

// Coerce arbitrary AI output into a valid Blueprint. Never throws on shape; the
// quality gate afterwards still enforces creative substance.
export function normalizeBlueprint(raw: unknown, opts: { durationSec: number; fps: number; looping?: boolean }): Blueprint {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const palRaw = (r.palette && typeof r.palette === 'object' ? r.palette : {}) as Record<string, unknown>;
  // Merge placement-only composition rows by ID; never turn a layout table into
  // anonymous replacement objects (which discarded the hero construction before).
  const placements = Array.isArray(r.composition) ? r.composition as Record<string, unknown>[] : [];
  const objects = arr(r.objects).map((value, index) => {
    const object = value as Record<string, unknown>;
    const placement = placements.find(row => row?.id === object?.id);
    return normalizeObject({ ...object, rect: placement?.rect ?? object?.rect ?? object?.position }, index);
  });
  const composition = objects;
  const choreography = arr(r.choreography ?? r.motion ?? r.timeline).map(normalizeSegment);
  const loopRaw = (r.loop && typeof r.loop === 'object' ? r.loop : {}) as Record<string, unknown>;
  const heroId = str(r.heroObjectId ?? r.hero, objects.find(o => o.role === 'hero')?.id ?? '');
  const bp: Blueprint = {
    concept: str(r.concept ?? r.idea, ''),
    commercialIntent: str(r.commercialIntent ?? r.intent ?? r.useCase, ''),
    visualMetaphor: str(r.visualMetaphor ?? r.metaphor, ''),
    visualHook: str(r.visualHook ?? r.hook, ''),
    signatureMotion: str(r.signatureMotion ?? r.signature, ''),
    visualPayoff: str(r.visualPayoff ?? r.payoff, ''),
    style: str(r.style ?? r.artDirection, ''),
    palette: {
      base: normalizeHex(palRaw.base ?? palRaw.background, ''),
      primary: normalizeHex(palRaw.primary, ''),
      secondary: normalizeHex(palRaw.secondary, ''),
      accent: normalizeHex(palRaw.accent ?? palRaw.highlight, ''),
    },
    heroObjectId: heroId,
    objects,
    composition,
    choreography,
    loop: {
      durationSec: opts.durationSec,
      fps: opts.fps,
      enabled: opts.looping ?? true,
      returnMechanism: str(loopRaw.returnMechanism ?? loopRaw.return, ''),
    },
    background: str(r.background ?? r.backdrop, ''),
    safeZone: r.safeZone ? normalizeRect(r.safeZone) : undefined,
    negativeSpace: r.negativeSpace ? str(r.negativeSpace, '') : undefined,
    microMotion: strArr(r.microMotion, []),
    avoid: strArr(r.avoid ?? r.exclusions, []),
  };
  return blueprintSchema.parse(bp);
}

// Compact human-readable summary used to drive the Coder prompt.
export function blueprintToCoderBrief(bp: Blueprint): string {
  const lines: string[] = [];
  lines.push(`CONCEPT: ${bp.concept}`);
  lines.push(`COMMERCIAL INTENT: ${bp.commercialIntent}`);
  lines.push(`VISUAL METAPHOR: ${bp.visualMetaphor}`);
  lines.push(`VISUAL HOOK: ${bp.visualHook}`);
  lines.push(`SIGNATURE MOTION: ${bp.signatureMotion}`);
  lines.push(`VISUAL PAYOFF: ${bp.visualPayoff}`);
  lines.push(`STYLE: ${bp.style}`);
  lines.push(`PALETTE: base ${bp.palette.base}, primary ${bp.palette.primary}, secondary ${bp.palette.secondary}, accent ${bp.palette.accent}`);
  lines.push(`BACKGROUND: ${bp.background}`);
  lines.push('');
  lines.push('OBJECTS (layout in viewport fractions; map to target resolution):');
  const hero = bp.composition.find((o) => o.id === bp.heroObjectId);
  if (hero) lines.push(`HERO: #${hero.id}: build its canonical real-world anatomy first (named parts at correct attachments, real proportions); supports must not outgrow it.`);
  for (const o of bp.composition) {
    lines.push(`- #${o.id} [${o.role}] ${o.shape} | material ${o.material.name} (${o.material.construction}) | rect X:${o.rect.x} Y:${o.rect.y} W:${o.rect.w} H:${o.rect.h} | z:${o.zIndex} | opacity:${o.opacity} | role: ${o.functionalRole} | details: ${o.details.join('; ')}`);
    if (o.geometry) lines.push(`  GEOMETRY LOCK: ${JSON.stringify(o.geometry)}`);
  }
  lines.push('');
  lines.push('CHOREOGRAPHY (timestamps in seconds; all motion time-based on the single paused GSAP timeline):');
  for (const s of bp.choreography) {
    lines.push(`- [${s.from}s–${s.to}s] #${s.objectId} ${s.property}: ${s.fromValue} -> ${s.toValue}${s.trajectory ? ` via ${s.trajectory}` : ''} | easing ${s.easing}${s.easingSpec ? ` ${s.easingSpec}` : ''}${s.physical ? ` | physical: ${s.physical}` : ''}${s.trigger ? ` | trigger: ${s.trigger}` : ''}${s.reaction ? ` | reaction: ${s.reaction}` : ''}`);
  }
  lines.push('');
  lines.push(`LOOP MATH: duration ${bp.loop.durationSec}s @ ${bp.loop.fps}fps. ${bp.loop.enabled ? `Match state and velocity at 0 and ${bp.loop.durationSec}s.` : 'FINITE clip: no return or reverse required.'} Resolution mechanism: ${bp.loop.returnMechanism}.`);
  if (bp.safeZone) lines.push(`SAFE ZONE: ${JSON.stringify(bp.safeZone)}`);
  if (bp.negativeSpace) lines.push(`COPY SPACE: ${bp.negativeSpace}`);
  if (bp.microMotion.length) lines.push(`MICRO-MOTION: ${bp.microMotion.join('; ')}`);
  if (bp.avoid.length) lines.push(`AVOID: ${bp.avoid.join('; ')}`);
  return lines.join('\n');
}

// The Creative Director system prompt. Adapted structure (not copied verbatim) and
// strengthened with stricter numeric/code-translatable requirements.
export const creativeDirectorSystem = `You are a Senior Creative Director + Senior Motion Designer for premium microstock video (Adobe Stock, Shutterstock). You do NOT write code. You turn an idea into a PRODUCTION BLUEPRINT: a numeric, code-translatable visual system that a coder can implement exactly.

${sceneCraftContract}

Core doctrine:
- Commercial idea BEFORE decoration. If removing decorative elements empties the concept, it FAILS.
- The hero object must be SPECIFIC (not a generic category) with at least 3 concrete visual details, a clear material, and a functional role.
- The hero must be a REAL-WORLD OBJECT when the brief names one: pick the exact class (bottle, cart, phone), list its canonical parts (at least three in geometry.parts), and keep real proportions. When a SUBJECT anatomy recipe is provided in the request, follow it exactly. Stand-ins like orb, energy field, glow blob, or abstract swirl are rejected for concrete briefs; genuinely abstract briefs keep shapes intentional and labeled.
- Every object must have a reason to exist; every motion must have a reason to happen.
- Signature motion must be concept-specific (a physical interaction, transformation, mechanical behavior, collision, deformation, sequential assembly, or cause-and-effect) — never a bare float/rotate/pulse/scale/fade/zoom.
- There must be a VISUAL PAYOFF: object A does X -> object B reacts Y -> produces Z, silent-readable and commercially relevant.
- Composition is NUMERIC. Never "place on the left". Use normalized viewport fractions X/Y/W/H (0..1) with hierarchy, safe zone, negative space, and z-order.
- Motion uses easing appropriate to the object's behavior; linear only when constant velocity is conceptually justified (progress, scan, conveyor, orbit, data stream). Physical contacts consider anticipation/impact/overshoot/settle with subtle controlled bounce (overshoot 1–5%, rebound 1–2, squash 2–5%, settle 0.10–0.30s).
- Motion coverage is numeric: every segment must change its value (identical start and end values are rejected as dead segments), the hero must stay active past the midpoint of the clip, and changing motion must carry into the final quarter of the clip. Never park the scene in a frozen hold before the clip ends.
- Respect the selected timeline mode. Only LOOP clips need matching endpoint state and velocity; FINITE clips develop forward without an artificial return. Never turn a physical launch into a rubbery rise-and-fall just to make it repeat.
- Derive a restrained, harmonious palette (base/primary/secondary/accent) from the subject — never a random rainbow.

Return ONLY a JSON object with EXACTLY these top-level keys (no prose, no markdown, no backticks):
concept, commercialIntent, visualMetaphor, visualHook, signatureMotion, visualPayoff, style, palette, heroObjectId, objects, composition, choreography, loop, background.
- palette: { "base":"#rrggbb", "primary":"#rrggbb", "secondary":"#rrggbb", "accent":"#rrggbb" } (flat strings, NOT objects)
- objects / composition: array of { "id":string, "role":"hero|support|interaction|background", "shape":string, "details":[string,...], "material":{"name":"matte|metallic|glass|plastic|paper|ceramic|neon|fabric|liquid|glossy","construction":string}, "rect":{"x":0-1,"y":0-1,"w":0-1,"h":0-1}, "zIndex":int, "opacity":0-1, "functionalRole":string }
- The hero MUST additionally include geometry: { "silhouette": "explicit closed solid contour construction", "aspectRatio": localWidth/localHeight, "parts": [{"name":"part name","rect":{"x":0.1,"y":0.1,"w":0.4,"h":0.3}}], "attachment":"exact shared anchors, symmetry and parenting" }. Part rectangles are relative to the hero, not the viewport. Give at least three canonical parts. Keep hero width/height physically plausible.
- choreography: array of { "from":sec, "to":sec, "objectId":string, "property":string, "fromValue":string, "toValue":string, "easing":"linear|ease-in|ease-out|ease-in-out|spring|bounce|custom", optional "trajectory","easingSpec","physical","trigger","reaction" }
- loop: { "durationSec":number, "fps":int, "returnMechanism":string }

Make every field concrete and code-translatable.`;

// User-facing instruction to produce the blueprint JSON.
export function blueprintRequest(userPrompt: string, opts: { durationSec: number; fps: number; width: number; height: number; looping: boolean }): string {
  return `Create a production blueprint for this user brief: ${JSON.stringify(userPrompt)}.
Snapshot: ${JSON.stringify(opts)}. All segment times must be within this duration.
Use objects as the construction source; composition repeats the same objects and IDs, never replaces them with anonymous layout rows.
Specify geometry for the hero, actual part anchors, material construction and smooth motion joins. No empty or generic substitute details.
${opts.looping ? 'LOOP: specify a physically credible boundary with continuous velocity, not a mirrored replay.' : 'FINITE: forward development and a resolved final view. No reverse/reset for loop closure.'}
The following JSON Schema is the exact output contract. Return JSON, no comments, no markdown:
${JSON.stringify(z.toJSONSchema(blueprintSchema))}`;
}
