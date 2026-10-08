import type { DictionaryCategory, DictionaryEntry, DictionaryMatch } from './types';

export const DICTIONARY_CATEGORIES: DictionaryCategory[] = ['style', 'motion', 'palette', 'composition', 'material', 'subject'];
export const DICTIONARY_CONFIDENCE_THRESHOLD = 0.34;
// Per-category overrides: two hits on a 6-token preset (2/6 = 0.333) must route
// under 0.34, and a single anatomy keyword ("cart", "botol") is enough for a
// subject recipe while a single weak style word ("isometric") still falls back.
const CATEGORY_THRESHOLD: Partial<Record<DictionaryCategory, number>> = {
  style: 0.33,
  motion: 0.33,
  subject: 0.2,
};

function entry(id: string, category: DictionaryCategory, name: string, description: string, tokens: string[], fallback = false): DictionaryEntry {
  return { id, category, name, description, tokens, ...(fallback ? { fallback: true } : {}) };
}

// 10 style presets + 1 neutral fallback.
const styleEntries: DictionaryEntry[] = [
  entry('style-corporate-clean', 'style', 'Corporate Clean',
    'Crisp flat shapes, generous whitespace, restrained grid-aligned layout, confident corporate polish; avoid decorative noise.',
    ['corporate', 'business', 'professional', 'company', 'enterprise', 'office']),
  entry('style-glassmorphism', 'style', 'Glassmorphism',
    'Frosted translucent panels, soft inner glows, subtle refraction highlights, layered depth over a diffused backdrop.',
    ['glass', 'glassmorphism', 'frosted', 'translucent', 'acrylic', 'blur']),
  entry('style-isometric-tech', 'style', 'Isometric Tech',
    'Isometric 3D diagram look, precise tech components, aligned grid axes, crisp edge lighting on geometric solids.',
    ['isometric', 'tech', 'technology', 'circuit', 'gadget', 'diagram']),
  entry('style-playful-cartoon', 'style', 'Playful Cartoon',
    'Bold rounded cartoon shapes, saturated friendly colors, exaggerated bouncy motion, thick readable silhouettes.',
    ['cartoon', 'playful', 'fun', 'cheerful', 'kids', 'bouncy']),
  entry('style-editorial-poster', 'style', 'Editorial Poster',
    'Poster-grade layout with strong typographic hierarchy, deliberate negative space, high-contrast graphic blocks.',
    ['poster', 'editorial', 'magazine', 'print', 'headline', 'typography']),
  entry('style-cyber-neon', 'style', 'Cyber Neon',
    'Dark futuristic scene lit by neon rims and holographic glows, scanline or grid accents, high-contrast luminous edges.',
    ['cyberpunk', 'cyber', 'futuristic', 'sci-fi', 'hologram', 'holographic']),
  entry('style-pastel-minimal', 'style', 'Pastel Minimal',
    'Minimal airy scene, soft pastel fields, gentle gradients, calm spacing, very restrained detail density.',
    ['pastel', 'minimal', 'minimalist', 'airy', 'soft', 'gentle']),
  entry('style-luxury-premium', 'style', 'Luxury Premium',
    'High-end finish: deep rich base tones, metallic accents, slow elegant motion, immaculate detail and polish.',
    ['luxury', 'premium', 'elegant', 'high-end', 'exclusive', 'sophisticated']),
  entry('style-retro-arcade', 'style', 'Retro Arcade',
    'Retro game aesthetic: chunky pixels or synthwave grids, limited vivid palette, punchy staccato motion.',
    ['retro', 'arcade', 'pixel', '8-bit', 'synthwave', 'vintage']),
  entry('style-blueprint-technical', 'style', 'Blueprint Technical',
    'Technical schematic look: line art on a deep blueprint field, measurement ticks, annotations, precise drafting motion.',
    ['blueprint', 'schematic', 'technical', 'engineering', 'wireframe', 'drafting']),
  entry('style-gradient-mesh', 'style', 'Gradient Mesh',
    'Soft flowing multi-point gradient mesh: smooth color fields that blend and travel, no hard neon lines, premium wallpaper feel.',
    ['gradient', 'mesh', 'aurora', 'blend', 'wallpaper', 'ambient color']),
  entry('style-organic-texture', 'style', 'Organic Texture',
    'Natural tactile texture (grain, ripple, fiber, smoke) rendered as a living surface; subtle continuous micro-motion.',
    ['texture', 'grain', 'ripple', 'smoke', 'organic', 'surface', 'macro']),
  entry('style-neutral', 'style', 'Adaptive Clean',
    'Clean modern neutral style: clear shapes, balanced contrast, contemporary finish matched to the subject.',
    [], true),
];

// 6 motion archetypes + 1 neutral fallback.
const motionEntries: DictionaryEntry[] = [
  entry('motion-product-showcase', 'motion', 'Product Showcase',
    'Hero object reveal: orbit or parallax presentation, staggered supporting props, one clear focal product with premium pacing.',
    ['product', 'showcase', 'reveal', 'hero', 'item', 'bottle', 'device']),
  entry('motion-kinetic-typography', 'motion', 'Kinetic Typography',
    'Words and letters drive the motion: rhythmic reveals, per-letter stagger, strong hierarchy, text timed to beats.',
    ['typography', 'text', 'words', 'headline', 'lyrics', 'letters']),
  entry('motion-mascot-character', 'motion', 'Mascot / Character',
    'Character animation: overlapping action, squash and stretch, anticipation before big moves, lively follow-through.',
    ['mascot', 'character', 'walk', 'run', 'dance', 'wave', 'animal']),
  entry('motion-data-visualization', 'motion', 'Data Visualization',
    'Data-driven motion: bars and lines grow sequentially, counters tick, labels stay readable, chart build in logical order.',
    ['chart', 'graph', 'data', 'dashboard', 'stats', 'analytics', 'metrics']),
  entry('motion-scene-transition', 'motion', 'Scene Transition',
    'Transition/sting motion: one continuous transformation, clean entry and exit, crisp hold at the resolved state.',
    ['transition', 'wipe', 'morph', 'switch', 'sting', 'logo']),
  entry('motion-cinematic-ambient', 'motion', 'Cinematic Ambient',
    'Cinematic ambience: slow parallax depth layers, subtle light shifts, atmospheric drift, restrained graceful speed.',
    ['cinematic', 'ambient', 'atmospheric', 'landscape', 'mood', 'slow']),
  entry('motion-camera-parallax', 'motion', 'Camera Parallax',
    'Virtual camera move: slow dolly/pan/zoom with foreground-midground-background parallax; the frame glides, never locks.',
    ['camera', 'parallax', 'dolly', 'pan', 'zoom', 'tracking', 'depth']),
  entry('motion-spring-reveal', 'motion', 'Spring Reveal',
    'Elements enter with spring physics: anticipation, overshoot, settle; staggered timing so the reveal feels alive, not mechanical.',
    ['spring', 'bounce', 'reveal', 'pop', 'elastic', 'entrance']),
  entry('motion-neutral', 'motion', 'Subject-led Motion',
    'Subject-led motion: the main subject performs the primary action; supporting elements move subtly in support.',
    [], true),
];

// 8 color palettes + 1 neutral fallback.
const paletteEntries: DictionaryEntry[] = [
  entry('palette-corporate-blue', 'palette', 'Corporate Blue',
    'Palette #0B2A4A / #2F6FED / #7FB2FF / #F4F7FB: trustworthy blues with a light neutral field.',
    ['blue', 'navy', 'trust', 'fintech', 'banking', 'finance']),
  entry('palette-sunset-warm', 'palette', 'Sunset Warm',
    'Palette #2A1230 / #FF6B4A / #FFB35C / #FFE3C2: warm sunset gradient tones with glowing accents.',
    ['sunset', 'warm', 'orange', 'coral', 'dusk', 'sunrise']),
  entry('palette-neon-night', 'palette', 'Neon Night',
    'Palette #05060F / #00E5FF / #FF2E88 / #B8FF29: near-black base with electric neon accents.',
    ['neon', 'night', 'club', 'glow', 'electric', 'rave']),
  entry('palette-pastel-soft', 'palette', 'Pastel Soft',
    'Palette #FFF7F2 / #FFD6E0 / #CDE7FF / #DFF5E1: soft pastel tones with low contrast and gentle warmth.',
    ['pastel', 'baby', 'spring', 'candy', 'powder']),
  entry('palette-mono-grayscale', 'palette', 'Mono Grayscale',
    'Palette #0A0A0A / #3D3D3D / #9C9C9C / #F2F2F2: strict grayscale, contrast carried by value only.',
    ['monochrome', 'grayscale', 'black white', 'black-and-white', 'noir']),
  entry('palette-emerald-fresh', 'palette', 'Emerald Fresh',
    'Palette #06231A / #12A150 / #7BE3A1 / #EFFFF2: fresh greens with crisp light highlights.',
    ['green', 'emerald', 'eco', 'nature', 'fresh', 'organic']),
  entry('palette-crimson-bold', 'palette', 'Crimson Bold',
    'Palette #1A0507 / #E5323E / #FF8A5C / #FFE9DC: bold reds with energetic warm highlights.',
    ['red', 'crimson', 'bold', 'energetic', 'sale', 'passion']),
  entry('palette-gold-luxury', 'palette', 'Gold Luxury',
    'Palette #100C08 / #C9A227 / #F3E3B1 / #FFFDF5: deep base with champagne gold highlights.',
    ['gold', 'champagne', 'gilded', 'opulent']),
  entry('palette-neutral', 'palette', 'Balanced Neutral',
    'Balanced palette: one dominant base, one clear accent, one neutral field; keep hues consistent throughout.',
    [], true),
];

// 6 composition presets + 1 neutral fallback.
const compositionEntries: DictionaryEntry[] = [
  entry('composition-center-stage', 'composition', 'Center Stage',
    'Subject anchored at the optical center per the 50% rule; supporting elements arranged radially without stealing focus.',
    ['center', 'centered', 'spotlight', 'focus', 'hero']),
  entry('composition-rule-of-thirds', 'composition', 'Rule of Thirds',
    'Key elements sit on thirds intersections; deliberate asymmetry with balanced counterweight.',
    ['thirds', 'rule of thirds', 'offset', 'asymmetric']),
  entry('composition-diagonal-flow', 'composition', 'Diagonal Flow',
    'Motion path flows bottom-left to top-right along a diagonal; elements stagger along that energy line.',
    ['diagonal', 'dynamic', 'flow', 'sweep', 'energy']),
  entry('composition-split-screen', 'composition', 'Split Screen',
    'Two mirrored halves with a clear divider; compare/contrast staging with synchronized or opposed motion.',
    ['split', 'compare', 'side by side', 'before after', 'versus']),
  entry('composition-radial-focus', 'composition', 'Radial Focus',
    'Elements orbit or radiate around a central anchor; radial symmetry with a single clear focal point.',
    ['radial', 'burst', 'rays', 'orbit', 'mandala']),
  entry('composition-full-bleed-ambient', 'composition', 'Full-bleed Ambient',
    'Full-frame environment: layered depth planes, immersive setting, subject integrated into the scene.',
    ['panorama', 'immersive', 'environment', 'landscape', 'wide']),
  entry('composition-neutral', 'composition', 'Balanced Framing',
    'Balanced framing: subject clearly readable, support elements subordinate, no accidental cropping of key shapes.',
    [], true),
];

// 8 material presets + 1 neutral fallback.
const materialEntries: DictionaryEntry[] = [
  entry('material-matte-flat', 'material', 'Matte Flat',
    'Flat matte surfaces, solid fills, clean vector shading without specular highlights.',
    ['flat', 'matte', 'vector', 'solid', 'illustration']),
  entry('material-glossy-glass', 'material', 'Glossy Glass',
    'Glossy glass surfaces: sharp specular streaks, soft reflections, translucent depth.',
    ['glossy', 'reflective', 'shine', 'polished', 'crystal']),
  entry('material-metallic', 'material', 'Metallic',
    'Brushed or polished metal: anisotropic highlights, crisp edge glints, weighty metallic motion.',
    ['metal', 'metallic', 'chrome', 'steel', 'brushed', 'aluminum']),
  entry('material-soft-fabric', 'material', 'Soft Fabric',
    'Soft fabric feel: gentle folds, fibrous texture, damped organic motion.',
    ['fabric', 'cloth', 'felt', 'woven', 'knit', 'silk']),
  entry('material-paper-cut', 'material', 'Paper Cut',
    'Layered paper-cut look: visible cut edges, stacked depth shadows, handcrafted charm.',
    ['paper', 'cutout', 'craft', 'folded', 'origami', 'cardboard']),
  entry('material-liquid', 'material', 'Liquid',
    'Liquid behavior: fluid waves, splash and viscous flow, smooth surface tension shapes.',
    ['liquid', 'fluid', 'water', 'splash', 'wave', 'viscous']),
  entry('material-neon-glow', 'material', 'Neon Glow',
    'Neon tube surfaces: luminous cores with soft bloom halos against a dark field.',
    ['luminescent', 'tube light', 'glowing', 'light-up']),
  entry('material-wood-organic', 'material', 'Wood Organic',
    'Natural organic surfaces: wood grain, warm fibers, tactile handcrafted finish.',
    ['wood', 'wooden', 'grain', 'bamboo', 'organic', 'natural']),
  entry('material-neutral', 'material', 'Mixed Consistent',
    'Consistent mixed materials: pick one dominant surface treatment and keep it stable across all elements.',
    [], true),
];

// 12 concrete subject recipes + 1 neutral fallback. Each description is an
// anatomy recipe the Director and Coder must draw from: parts, proportion,
// silhouette rule, and an explicit ban on shape substitutes.
const subjectEntries: DictionaryEntry[] = [
  entry('subject-bottle', 'subject', 'Bottle',
    'Bottle anatomy: closed body, shoulder curve, narrow neck, cap on top; height:width near 3:1; one closed silhouette with a concave neck transition; label as a band across the body. Never substitute a capsule or plain rounded rectangle.',
    ['bottle', 'botol', 'flask', 'perfume', 'spray']),
  entry('subject-cart', 'subject', 'Shopping Cart',
    'Shopping cart anatomy: wire basket drawn as parallel bars, not a solid box; push handle rising from the rear; angled frame; four small wheels; side view reads as a trapezoid basket over wheels. Never substitute a plain crate.',
    ['cart', 'troli', 'trolley', 'keranjang']),
  entry('subject-bag', 'subject', 'Bag',
    'Bag anatomy: body panel, at least one strap or handle attached at the top edge, flap or pocket detail, one visible seam; tote reads as a trapezoid, backpack as a rounded body with two straps. Never substitute a featureless rounded box.',
    ['bag', 'tas', 'tote', 'handbag', 'backpack']),
  entry('subject-money', 'subject', 'Money',
    'Money anatomy: coin = disc with a raised rim ring and one embossed mark at center; banknote = rectangle with an inner border pattern; wallet = folded panel with a clasp. Keep denominations abstract; no readable text.',
    ['money', 'cash', 'coin', 'wallet', 'uang']),
  entry('subject-phone', 'subject', 'Smartphone',
    'Smartphone anatomy: rounded rectangle slab about 2:1, screen inset with uniform bezel, camera module in one corner, side buttons on the edge. Never draw the screen as a separate floating panel.',
    ['phone', 'smartphone', 'handphone', 'android', 'iphone']),
  entry('subject-laptop', 'subject', 'Laptop',
    'Laptop anatomy: two hinged panels, upright screen with bezel, base with a keyboard band and trackpad; open angle near 100-110 degrees; three-quarter view shows the base edge thickness. Never flatten into one slab.',
    ['laptop', 'macbook', 'ultrabook', 'chromebook']),
  entry('subject-cup', 'subject', 'Cup or Mug',
    'Cup anatomy: tapered cylinder body, elliptical rim at the top, handle loop attached on one side (mug), stable base; keep the rim ellipse open so depth reads. Never substitute a plain cylinder without rim depth.',
    ['cup', 'mug', 'gelas', 'cangkir', 'coffee']),
  entry('subject-car', 'subject', 'Car',
    'Car anatomy: body with a cabin greenhouse, wheels seated under wheel arches, window band, lights at both ends; side view is a two-box profile with a clear wheel gap. Never omit the wheels or float the body.',
    ['car', 'sedan', 'mobil', 'vehicle', 'kendaraan']),
  entry('subject-house', 'subject', 'House or Building',
    'House anatomy: rectangular body, roof (triangle or slanted), door at ground level, windows in a regular row; buildings repeat floors as bands; base sits on the ground line. Never stack rooms as random boxes.',
    ['house', 'building', 'rumah', 'gedung', 'villa']),
  entry('subject-leaf', 'subject', 'Leaf or Plant',
    'Leaf anatomy: teardrop or oval blade with a center midrib and a short stem; veins branch from the midrib at consistent angles; plant = stem with leaves attached at nodes. Never scatter detached blobs as foliage.',
    ['leaf', 'plant', 'foliage', 'daun', 'tanaman']),
  entry('subject-character', 'subject', 'Character or Mascot',
    'Character anatomy: one locked head-to-body ratio stated before drawing, limbs attached at joints with consistent lengths, hands and feet as simplified mitts or shoes, one consistent outline weight. Never detach floating limbs.',
    ['character', 'mascot', 'person', 'figure', 'people']),
  entry('subject-clock', 'subject', 'Clock or Watch',
    'Clock anatomy: round face inside a rim ring, two hands pivoting at the exact center, tick marks at even angles; a watch adds a strap attached at case lugs. Never place the hands off-center.',
    ['clock', 'watch', 'jam', 'timepiece', 'wristwatch']),
  entry('subject-neutral', 'subject', 'Adaptive Subject',
    'Adaptive subject: if the brief names a concrete object, draw it with its real-world parts and proportions (name every part before coding); if the brief is genuinely abstract, keep shapes intentional and labeled, not pseudo-objects.',
    [], true),
];

export const promptDictionary: DictionaryEntry[] = [
  ...styleEntries,
  ...motionEntries,
  ...paletteEntries,
  ...compositionEntries,
  ...materialEntries,
  ...subjectEntries,
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenHit(text: string, token: string) {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(token.toLowerCase())}([^a-z0-9]|$)`, 'i');
  return pattern.test(text);
}

export function scoreEntry(text: string, candidate: DictionaryEntry): DictionaryMatch | undefined {
  if (!candidate.tokens.length) return undefined;
  const matchedTokens = candidate.tokens.filter((token) => tokenHit(text, token));
  if (!matchedTokens.length) return undefined;
  return { entry: candidate, score: matchedTokens.length / candidate.tokens.length, matchedTokens };
}

// Returns the best scored match per category (only categories that matched at all).
export function detectDictionaryMatches(text: string): DictionaryMatch[] {
  const matches: DictionaryMatch[] = [];
  for (const category of DICTIONARY_CATEGORIES) {
    let best: DictionaryMatch | undefined;
    for (const candidate of promptDictionary) {
      if (candidate.category !== category || candidate.fallback) continue;
      const scored = scoreEntry(text, candidate);
      if (scored && (!best || scored.score > best.score)) best = scored;
    }
    if (best) matches.push(best);
  }
  return matches;
}

function fallbackEntry(category: DictionaryCategory): DictionaryEntry {
  const found = promptDictionary.find((candidate) => candidate.category === category && candidate.fallback);
  if (!found) throw new Error(`Dictionary fallback missing for category ${category}`);
  return found;
}

// One match per category: best entry when confidence >= threshold, otherwise the neutral fallback.
export function pickDictionaryMatches(text: string, threshold = DICTIONARY_CONFIDENCE_THRESHOLD): DictionaryMatch[] {
  return DICTIONARY_CATEGORIES.map((category) => {
    const detected = detectDictionaryMatches(text).find((match) => match.entry.category === category);
    const categoryThreshold = CATEGORY_THRESHOLD[category] ?? threshold;
    if (detected && detected.score >= categoryThreshold) return detected;
    return { entry: fallbackEntry(category), score: 0, matchedTokens: [] };
  });
}

export function formatDictionaryContext(matches: DictionaryMatch[]): string {
  if (!matches.length) return '';
  const lines = matches.map((match) => `- ${match.entry.category.toUpperCase()} (${match.entry.name}): ${match.entry.description}`);
  return `DICTIONARY ART DIRECTION:\n${lines.join('\n')}`;
}
