import { formatDictionaryContext } from './prompt-dictionary';
import type { DictionaryMatch } from './types';

// Helper library the AI must copy into the generated <script>; feeds geometry and colors
// while GSAP tweens (mandatory skeleton) own every animated property.
export const helperPreamble = `DETERMINISTIC HELPER LIBRARY: copy these utilities VERBATIM into your <script> exactly as written — do NOT retype, reformat, or paraphrase them (retyping introduces syntax errors). mulberry32/lerp/clamp/lerpColor/beatProgress compute geometry, colors, and canvas state at init or inside tween onUpdate; tweened properties move on the single paused gsap timeline from the mandatory skeleton (ease() is only for canvas math, tween curves use gsap eases like 'power2.out'). Never call Math.random; derive the PRNG seed from a constant hash of the prompt.
function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function lerp(a,b,t){return a+(b-a)*t}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function lerpColor(a,b,t){/* interpolate two "#rrggbb" hex colors and return "#rrggbb" */}
function ease(name,t){/* easing curves: 'sine','quad','cubic','elastic','bounce' with in/out/inOut variants */}
function beatProgress(beats,t){/* map absolute time t onto the active BEATS segment; return local progress 0..1 */}`;

export const beatsContract = `BEATS TABLE: near the top of the script include a comment of the form:
// BEATS: t=0.00s <label> | t=0.60s <label> | ...
Place one accent every 0.5-0.8 seconds (denser only for energetic styles). Every major accent (pop, impact, flash, word reveal) must land exactly on a listed beat, and beat spacing must stay regular.`;

export const geometryPreservationContract = `GEOMETRY PRESERVATION: keep icon, badge, and label shapes within 1.5x of their base size (base <= 120px) for the entire loop; characters keep consistent head-to-body proportion and limb lengths; text-bearing elements stay readable at all times; crop the subject only when the brief explicitly asks for close crop or off-frame placement. ANTI-POP / NO ABRUPT GEOMETRY (hard): no element may appear, disappear, teleport, or change scale suddenly between frames. Every reveal must grow continuously from 0.01 with an ease curve over at least 0.3 seconds (never snap from 0 to full size); every exit must shrink continuously toward 0.01 (never vanish); every length, radius, and scale must interpolate smoothly frame-to-frame with no jumps. If an element goes off-frame it must travel off smoothly, never teleport. CANVAS SAFETY: every value passed as a radius, size, width, or height to a Canvas/SVG drawing call must be clamped non-negative — write radius as Math.max(0.5, r) (or Math.abs) so a computed value can never go negative (a negative arc() radius throws IndexSizeError and kills the render). Apply the same guard to scale factors and rect dimensions. CANVAS API EXACTNESS: use only real Canvas2D methods on a 2D context — moveTo, lineTo, bezierCurveTo, quadraticCurveTo, arc, ellipse, rect, fill, stroke, createLinearGradient — and never invent methods that do not exist on CanvasRenderingContext2D (for example cubicCurveTo, curveTo, or drawPath), because an unknown method throws "is not a function" and kills the render. If a curve helper is needed, define it once using bezierCurveTo/quadraticCurveTo.`;

export const timelineContract = `STRICT TIMELINE CONTRACT:
- Start with the first visible state already on screen at time 0; no empty or blank intro frame.
- Every requested stage must visibly occur, in order, on its own timeline segment.
- End on the intended final composition for a clear visual finish.`;

// Creative-direction contracts (Fase 1 anti-slop). These teach the LLM *how* to make
// footage worth selling, instead of leaving style to the model's generic defaults.

export const kineticContract = `KINETIC MOTION CONTRACT (organic, never mechanical):
- NEVER use linear/'none' easing for any primary motion on the timeline. Nothing may slide, grow, or rotate at a constant rate.
- Every significant movement follows: anticipation (small counter-move) -> acceleration -> overshoot -> settle. Use gsap eases with overshoot such as 'back.out(1.7)', 'elastic.out(1, 0.4)', or 'bounce.out', not 'none' or 'power1.in'.
- Vary duration and delay per element so motion feels layered and alive, not synchronized/metronomic. 'none' is allowed only for canvas redraw drivers and constant-speed scans/conveyors.
- Continuous ambient motion (drift, breathe, shimmer) should be slow sinusoids with irrational-ish frequency ratios so it never looks like a robotic loop.`;

export const antiSlopContract = `ANTI-SLOP / ORIGINALITY CONTRACT (avoid stock clichés):
- FORBIDDEN unless the brief explicitly demands it: purple/blue neon cyberpunk grids, generic floating dust/particles, "data stream" lines, glowing HUD rings, Bootstrap/CodePen template looks, flat dark-tech vector aesthetic, random geometric confetti.
- Choose ONE specific, ownable art direction and commit: name the palette (3-5 hex colors), name the style family (e.g. soft gradient mesh, isometric flat, editorial minimal, glassmorphism, organic paper-cut, Bauhaus geometry), and define ONE distinctive motif that carries the whole piece.
- SUBJECT RULE: when the brief names a concrete object, build that object with real anatomy and let the style serve it; abstract subjects (backgrounds, seamless textures, gradient meshes, minimal shapes, nature/macro textures) are for briefs that are actually abstract, rendered with craft, not a generic template.
- Restraint beats decoration: fewer, well-executed elements with intentional negative space, not a busy collage.
- STYLE IS BORN FROM THE SUBJECT: derive the palette and motif from the exact subject named in the brief, never from a generic preset. Two different subjects must not come out wearing the same look.`;

export const objectContract = `OBJECT REALISM CONTRACT (every named object must be recognizable):
- NAME IT FIRST: before drawing, write the exact object class (bottle, shopping cart, smartphone) and list its real-world parts. The hero and every support object that came from the brief must be that object, not a shape that merely suggests it.
- ANATOMY: draw every named part at its correct attachment (cap on neck, handle on basket, wheels under the body, strap at the bag edge). Part count matches the real object; never reduce a cart to a box or a bottle to a capsule.
- PROPORTIONS: keep real-world height:width (bottle near 3:1, phone near 2:1) and relative part sizes; scale uniformly, never stretch axes independently.
- SILHOUETTE TEST: at thumbnail size the outline alone must identify the object. Build a filled closed contour first, details inside it second.
- NO SHAPE SUBSTITUTES: for a concrete brief, forbidden stand-ins are blobs, orbs, plain capsules, featureless rounded rectangles, and glow-only forms. Abstract shapes are allowed only when the brief itself is abstract.
- ABSTRACT BRIEFS: when the brief is genuinely abstract, shapes stay intentional and labeled (grid, wave, field), never pseudo-objects that look like a failed real thing.`;

export const craftContract = `RENDER CRAFT CONTRACT (what separates sellable footage from a flat draft):
- DEPTH IS MANDATORY: build the scene in at least three readable layers — a far background surface, a mid layer, and a hero subject — with real value/blur/scale separation. A single flat plane with one shape on a solid color FAILS.
- SURFACE, NOT FLAT COLOR: the background must be a living surface — a soft multi-stop gradient, a subtle grain/texture, a gentle light falloff, or a slow ambient wash — never one dead hex fill.
- LIGHT: every scene has one clear light direction. The subject receives a key light, a softer fill, and (where suitable) a rim/accent light. Shadows and highlights must agree with that single direction.
- MATERIAL REALISM: glass refracts and shows a specular streak; metal has anisotropic highlights; matte surfaces have soft, broad shading. Name the material and render its tell.
- COLOR GRADE: pick a refined, harmonious palette (analogous, complementary, or split-complementary) with one dominant hue, one supporting, one accent. Avoid muddy mid-tones and avoid pure #000/#fff unless the style is strictly monochrome. Slightly lift blacks and roll off highlights for a premium grade.
- POLISH: add the small tells that read as "premium": a soft contact shadow under the subject, a faint ambient occlusion at layer boundaries, a subtle vignette that does not darken the focal point, and clean antialiased edges.`;

export const continuousWorldContract = `CONTINUOUS WORLD CONTRACT (move like video, not slides):
- ONE WORLD: the whole clip happens inside one continuous scene. There are no discrete "slides" or full-frame cuts to a new layout. Elements enter, develop, and exit within the same persistent world.
- NO FADE-TO-NEW-SCENE: never transition by fading the entire frame to a solid color and back in. Scenes change because the camera moves or the world transforms, not because a section fades.
- PERSISTENT SUBJECT: the hero subject (or the shared world) persists across the timeline; it is never destroyed and recreated between "scenes".
- MOTION EVERY SECOND: something is always moving — the camera, the hero, an ambient layer, or light. There is no dead, frozen beat longer than ~0.4s.
- VARIED, PHYSICAL TRANSITIONS: use at least two transition types (e.g. push-through, glide, scale-settle, orbital reveal), and at least one must read as real depth (an object/camera moving in Z or parallax), not a flat block wiping the frame.`;

export const cameraContractV2 = `CAMERA CHOREOGRAPHY CONTRACT (the frame must live):
- The virtual camera ALWAYS moves for the whole duration: a slow drift, a gentle dolly/zoom (a few percent over the clip), or a parallax shift between background / midground / foreground.
- Choreograph it as: settle on a close/mid framing -> glide or push through -> pull back to reveal -> hold on the resolved composition. Text/labels (if any) appear only AFTER the pull-back finishes.
- A single continuous, smooth move reads better than several jittery ones. Keep it slow, deterministic, and driven by motionforge:frame time and the seeded PRNG.
- Use parallax: distant layers move less than near layers, so depth reads on screen.`;

export const designFundamentalsContract = `DESIGN FUNDAMENTALS CONTRACT (mandatory graphic-design craft):
- LAYOUT: build on a clear grid or intentional asymmetric structure; align elements to a baseline; keep consistent spacing; respect generous negative space. Never scatter elements randomly.
- VISUAL HIERARCHY: exactly one dominant focal element; supporting elements are clearly subordinate in size, contrast, and detail. The eye must know where to go first, second, third.
- CONTRAST: ensure strong value contrast between subject and background (focal element readable at thumbnail size). Do not let key shapes melt into the backdrop.
- COLOR: use a deliberate 3-5 color scheme with a clear dominant, secondary, and one accent; keep hues harmonious (analogous, complementary, or monochromatic) — never a random rainbow. Maintain color consistency across the whole clip.
- BALANCE & PROXIMITY: distribute visual weight so the frame feels stable; group related items, separate unrelated ones.
- TYPOGRAPHY (if any text): at most two text levels (one headline level, one support level). Sentence case, medium weight, one highlighted keyword per line, high legibility, short labels only; text never fights the visuals and stays readable at thumbnail size.`;

export const narrativeContract = `VISUAL NARRATIVE CONTRACT (give the clip a point of view):
- Decide the single focal point and make the viewer's eye land there within the first second.
- Structure the clip as: establish -> reveal/develop -> resolve. Even an abstract background should evolve (a gradient travels, a shape breathes and shifts, light moves across the frame).
- Every element must earn its place: it either supports the focal point, adds depth, or carries the motif. Remove anything that is just "sitting there".
- The final frame should feel like a resolved composition, not a frozen mid-state.`;

export const selfReviewChecklist = `SELF-REVIEW (check silently before returning; fix anything that fails):
1. Loop seam: state at t=0 equals state at t=duration (for looping output).
2. Coverage: background full bleed; subject sized per the GEOMETRY COVERAGE rules.
3. Readability: any text stays legible at its smallest displayed size.
4. Contradictions: no conflicting instructions remain between brief and contracts.
5. Determinism: no Math.random, no timers, no hand-written property-lerp frame loop; all motion lives on the one paused gsap timeline, seeked from motionforge:frame.
6. Helpers: mulberry32/lerp/clamp/ease/beatProgress are present and actually used; every animated property is a gsap tween, not manual per-frame math.
7. Beats: major accents land on the BEATS table entries.
8. Motion: no primary movement uses linear easing; each has anticipation/overshoot/settle.
9. Camera: the frame or its layers move for the full duration (no locked static shot).
10. Originality: no forbidden clichés; one named palette + one style family + one motif.
11. Object realism: every named object passes the silhouette test at thumbnail size; no blob, orb, or capsule stand-in for a concrete subject.`;

const vaguePromptTerms: { term: string; suggestion: string }[] = [
  { term: 'keren', suggestion: 'replace with a concrete look: style family, palette, and the key motion' },
  { term: 'bagus', suggestion: 'replace with concrete visual qualities: shapes, colors, lighting, speed' },
  { term: 'cool', suggestion: 'replace with a concrete look: style family, palette, and the key motion' },
  { term: 'nice', suggestion: 'replace with concrete visual qualities: shapes, colors, lighting, speed' },
  { term: 'awesome', suggestion: 'replace with concrete visual qualities instead of a judgement word' },
  { term: 'epic', suggestion: 'replace with scale and motion specifics: camera move, speed, intensity' },
  { term: 'sleek', suggestion: 'replace with material and finish specifics: gloss, metal, edge lighting' },
  { term: 'smooth', suggestion: 'name the easing and speed, e.g. ease-out glide over 0.6 seconds' },
  { term: 'modern', suggestion: 'name a concrete style: glassmorphism, corporate-clean, cyber-neon, pastel-minimal' },
  { term: 'good', suggestion: 'replace with concrete visual qualities instead of a judgement word' },
];

export interface VaguePromptTerm { term: string; suggestion: string }

// Detects vague words that usually yield generic output; warnings only, never blocking.
export function detectAntiPatterns(text: string): VaguePromptTerm[] {
  const found: VaguePromptTerm[] = [];
  const lower = text.toLowerCase();
  for (const item of vaguePromptTerms) {
    const pattern = new RegExp(`(^|[^a-z0-9])${item.term}([^a-z0-9]|$)`, 'i');
    if (pattern.test(lower)) found.push(item);
  }
  return found;
}

export interface AssemblePromptInput {
  userBrief: string;
  dictionaryMatches: DictionaryMatch[];
  duration: number;
  looping: boolean;
  width: number;
  height: number;
  fps?: number;
  // Technical contracts supplied by the caller (interpretation, motion direction, pacing, timing, fidelity).
  contracts?: string[];
}

// Assembles the final generation prompt in a stable block order:
// 1 system role, 2 helper preamble, 3 dictionary context, 4 user brief, 5 technical contracts, 6 self-review.
export function assemblePrompt(input: AssemblePromptInput): string {
  const blocks: string[] = ['Create one complete self-contained HTML for the brief below.'];
  blocks.push(helperPreamble);
  const dictionaryContext = formatDictionaryContext(input.dictionaryMatches);
  if (dictionaryContext) blocks.push(dictionaryContext);
  blocks.push(`Technical constraints:
- Resolution: ${input.width} x ${input.height} px
- Frame rate: ${input.fps ? `${input.fps} fps, ` : ''}driven by motionforge:frame
- Duration: ${input.duration} seconds
- Looping: ${input.looping ? 'yes; t=0 must equal t=duration' : 'no; finite ending'}`);
  blocks.push(input.userBrief);
  // Creative direction comes before the caller's technical contracts so the model
  // commits to an art direction first, then fits it to the technical constraints.
  const contracts = [
    antiSlopContract,
    craftContract,
    designFundamentalsContract,
    continuousWorldContract,
    cameraContractV2,
    kineticContract,
    narrativeContract,
    ...(input.contracts ?? []),
    timelineContract,
    beatsContract,
    geometryPreservationContract,
  ];
  blocks.push(contracts.join('\n\n'));
  blocks.push(selfReviewChecklist);
  return blocks.join('\n\n');
}
