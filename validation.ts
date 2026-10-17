import vm from 'node:vm';
import { stripGsapRuntime } from './gsap-runtime';

const blocked = [
  [/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/i, 'Network APIs are not allowed'],
  [/\b(alert|prompt|confirm)\s*\(/i, 'Browser dialogs are not allowed'],
  [/<(?:script|link|img|audio|video|iframe)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i, 'Remote assets are not allowed'],
  [/@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i, 'Remote CSS imports are not allowed'],
  [/\bsetInterval\s*\(/i, 'setInterval is not allowed; drive all motion from the single requestAnimationFrame loop'],
  [/\bsetTimeout\s*\(/i, 'setTimeout delays are not allowed; compute delays from frame time inside the requestAnimationFrame loop'],
  [/\bMath\.random\s*\(/i, 'Math.random is not allowed; use a seeded PRNG initialized from the supplied seed'],
  // CSS-driven motion runs on the compositor clock that the renderer cannot seek, so it
  // desyncs from the deterministic frame timeline. All motion must be JavaScript-driven.
  [/@keyframes\b/i, 'CSS @keyframes are not allowed; animate every moving element from JavaScript using frame time'],
  [/\btransition\s*:/i, 'CSS transitions are not allowed; animate every moving element from JavaScript using frame time'],
  [/\banimation\s*:/i, 'CSS animations are not allowed; animate every moving element from JavaScript using frame time']
] as const;

// Time-based scenes must read the (virtual-clock-overridden) performance.now via one
// requestAnimationFrame loop. These are now required, not forbidden.
const requiredTiming = [
  [/\brequestAnimationFrame\s*\(/i, 'A single requestAnimationFrame loop is required to drive animation from frame time'],
  [/\bperformance\.now\s*\(\)|\bDate\.now\s*\(\)/i, 'Time-based motion is required: read performance.now() (or Date.now()) inside the requestAnimationFrame loop']
] as const;

// Object metadata roles are load-bearing downstream (subject geometry, support bounds,
// background coverage), so unknown roles and subject counts fail fast here instead of
// silently degrading into the wrong measurement path at render time. Shared by the
// GSAP validator below and the HyperFrames-mode pipeline (which runs hyperframes lint
// for structure and this check for metadata).
export function validateObjectMetadata(html: string): string[] {
  const errors: string[] = [];
  if(!/__MOTIONFORGE_OBJECTS__/.test(html))errors.push('MotionForge object metadata is missing');
  const objectsMatch = html.match(/__MOTIONFORGE_OBJECTS__\s*=\s*\[([\s\S]*?)\];/);
  if (objectsMatch) {
    const items = [...objectsMatch[1].matchAll(/\{[^}]*\}/g)];
    const roles: string[] = [];
    for (const item of items) {
      const id = item[0].match(/['"]?id['"]?\s*:\s*['"]([^'"]+?)['"]/)?.[1] ?? '?';
      const role = item[0].match(/['"]?role['"]?\s*:\s*['"]([^'"]+?)['"]/)?.[1];
      if (!role) errors.push(`object #${id} is missing its role; use subject, support, or background`);
      else if (role !== 'subject' && role !== 'support' && role !== 'background')
        errors.push(`object #${id} has unknown role '${role}'; use subject, support, or background`);
      else roles.push(role);
    }
    if (items.length && !roles.includes('subject'))
      errors.push('MotionForge object metadata declares no subject; exactly one subject is required');
    if (roles.filter((role) => role === 'subject').length > 1)
      errors.push('MotionForge object metadata declares more than one subject; exactly one subject is required');
  }
  return errors;
}
export function validateHtml(html: string, alpha=false, options?: { requireGsap?: boolean; iconAssets?: { objectId: string; set: string; name: string }[]; split?: boolean; hyperframes?: boolean }): string[] {
  const errors: string[] = [];
  timingWarnings.length = 0;
  const baseRequired = [
    [/^\s*<!doctype\s+html/i, '<!DOCTYPE html> is missing'], [/<html\b/i, '<html> is missing'],
    [/<head\b/i, '<head> is missing'], [/<body\b/i, '<body> is missing'], [/<style\b/i, '<style> is missing'],
    [/<script\b/i, '<script> is missing'], [/window\.__MOTIONFORGE_READY__\s*=\s*true\b/, 'MotionForge readiness flag is missing'], [/<\/html\s*>\s*$/i, 'Closing </html> is missing']
  ] as const;
  const required = options?.hyperframes
    ? baseRequired.filter(([, message]) => message !== 'MotionForge readiness flag is missing')
    : baseRequired;
  for (const [pattern, message] of required) if (!pattern.test(html)) errors.push(message);
  // HyperFrames compositions reference the host-staged GSAP by its exact relative
  // filename; everything else remote stays banned.
  const srcChecked = options?.hyperframes
    ? html.replace(/<script\b[^>]*\bsrc=(["'])gsap\.min\.js\1[^>]*>\s*<\/script\s*>/gi, '<script></script>')
    : html;
  if (/<script\b[^>]*src=/i.test(srcChecked)) errors.push('External scripts are not allowed');
  if (/data-bm-icon\s*=|(?:material-symbols|font-awesome|lucide|tabler)[/:_-]/i.test(html))
    errors.push('Icon assets are disabled: draw the requested subject with custom SVG/DOM geometry');
  if (new RegExp(`(?:html|body|svg|canvas|#(?:stage|scene))[^{}]*\\{[^}]*\\b(?:width|height)\\s*:\\s*${2560}px`, 'i').test(html))
    errors.push('Fixed design-pixel CSS dimensions can blank the render; use width:100%, height:100%, with viewBox/internal coordinates for the design size');
  if (new RegExp(`<meta[^>]+name=["']viewport["'][^>]+width\\s*=\\s*${2560}`, 'i').test(html))
    errors.push('Viewport meta tag must not use the design-pixel width');
  if (/id=["']primary-subject["'][\s\S]{0,12000}gsap\.to\s*\(\s*["']#primary-subject["'][\s\S]{0,500}\bx\s*:/i.test(html) && !/(?:camera|parallax|depth)[-_](?:wrapper|layer)|id=["'][^"']*(?:camera|parallax|depth)[^"']*/i.test(html))
    errors.push('Camera motion must use a camera/depth wrapper, not a single whole-subject x tween');
  errors.push(...validateObjectMetadata(html));
  // The injected GSAP runtime is host-owned, vendored source: pattern and syntax checks
  // grade the LLM-authored document only (the minified source legitimately contains
  // Math.random/setTimeout internally), while structural checks above see the full file.
  const authored = stripGsapRuntime(html);
  for (const [pattern, message] of blocked) if (pattern.test(authored)) errors.push(message);
  // Static SVG path-data check: a malformed literal (a stray "?" from a hurried
  // model) crashes Chromium at readiness and kills the whole render job; catching
  // it here turns a fatal failure into a repair retry.
  for (const match of authored.matchAll(/<[^<>]*\bd\s*=\s*"([^"]*)"|<[^<>]*\bd\s*=\s*'([^']*)'/g)) {
    const data = match[1] ?? match[2] ?? '';
    const bad = data.search(/[^MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]/);
    if (bad >= 0) {
      const context = data.slice(Math.max(0, bad - 12), bad + 13);
      errors.push(`Invalid SVG path data (unexpected '${data[bad]}' near "${context}"); use only valid path commands and numbers`);
    }
  }
  // Fase 1b: freshly generated scenes must run on the paused-timeline contract. The host
  // injects the gsap source itself, so only the *usage* of the contract is checked here.
  if (options?.requireGsap) {
    if (!/\bgsap\.defaults\s*\(\s*\{\s*lazy\s*:\s*false/.test(authored) || !/\bgsap\.timeline\s*\(/.test(authored))
      errors.push('GSAP contract missing: one paused gsap.timeline() built after gsap.defaults({lazy:false}) is required');
    if (!/['"]motionforge:frame['"]/.test(authored)) errors.push('GSAP contract missing: a motionforge:frame seek listener is required');
    if (!/\.seek\s*\(/.test(authored)) errors.push('GSAP contract missing: timeline seek per frame is required');
  }
  // Fase 2a: the host injects asset geometry into an empty marker the model emits.
  // Verify the marker exists as a paired svg and actually carries shapes; a missing
  // or self-closed marker means the model invented its own drawing instead.
  if (options?.iconAssets?.length) {
    for (const asset of options.iconAssets) {
      const needle = `data-bm-icon="${asset.set}:${asset.name}"`;
      // Match only occurrences inside an open <svg> tag; CSS selectors like
      // svg[data-bm-icon="..."] carry the same text but are not markers.
      let at = -1;
      for (let search = 0; at < 0; ) {
        const found = html.indexOf(needle, search);
        if (found < 0) break;
        const open = html.lastIndexOf('<svg', found);
        if (open >= 0 && html.lastIndexOf('<', found) === open && html.indexOf('>', open) > found) at = found;
        else search = found + 1;
      }
      if (at < 0) {
        errors.push(`Object asset #${asset.objectId} (${asset.set}:${asset.name}) marker missing; emit the empty <svg data-bm-icon="${asset.set}:${asset.name}"> marker as instructed`);
        continue;
      }
      const tagEnd = html.indexOf('>', at);
      if (tagEnd < 0 || html[tagEnd - 1] === '/') {
        errors.push(`Object asset #${asset.objectId} (${asset.set}:${asset.name}) marker must use paired <svg>...</svg> tags so the host can inject geometry`);
        continue;
      }
      const close = html.indexOf('</svg>', tagEnd);
      if (close < 0) {
        errors.push(`Object asset #${asset.objectId} (${asset.set}:${asset.name}) marker is not closed with </svg>`);
        continue;
      }
      const inner = html.slice(tagEnd + 1, close);
      if (!shapeTokens(inner).length)
        errors.push(`Object asset #${asset.objectId} (${asset.set}:${asset.name}) carries no geometry after host injection`);
    }
  }
  // Studio Split: the breakdown board structure is structural, not decorative. The
  // playhead sweep is also what keeps the render out of the static-frame gate, so a
  // missing element here must fail before Chromium ever captures a frame.
  if (options?.split) {
    const splitElements = [
      ['split-film', 'the film stage (id="split-film")'],
      ['split-drafts', 'the draft strip (id="split-drafts")'],
      ['split-playhead', 'the sweeping playhead (id="split-playhead")'],
      ...[0, 1, 2, 3].map((k) => [`draft-${k}`, `draft card id="draft-${k}"`]),
    ] as const;
    for (const [id, what] of splitElements)
      if (!new RegExp(`\\bid\\s*=\\s*["']${id}["']`).test(html))
        errors.push(`Studio Split layout missing: ${what} is required (film stage on top, four draft quarters and playhead below)`);
    // The first card must start active in the markup: a set placed at timeline
    // position 0 can be dropped by seek order, which renders quarter one with no
    // highlighted card at all.
    const card0 = [...html.matchAll(/<[a-zA-Z][^>]*>/g)].find((m) => /\bid\s*=\s*["']draft-0["']/.test(m[0]));
    if (card0 && !/\bclass\s*=\s*["'][^"']*\bactive\b/i.test(card0[0]))
      errors.push('Studio Split layout: draft-0 must carry class "draft-card active" in the initial markup so card 0 is active from the first frame');
    // GSAP cannot interpolate a calc() string: the sweep drifts out of step with
    // the highlighted card, so the playhead must move through numeric values.
    if (/(?:tl|gsap)\s*\.\s*(?:to|fromTo)\([^;]{0,300}\bplayhead\b[^;]{0,300}calc\s*\(/i.test(html))
      errors.push("Studio Split playhead: do not tween left/top toward a calc() string; move it with a numeric transform (x) or an onUpdate px position because GSAP cannot interpolate calc()");
    // Callback-based card switches fire on playhead crossings in seek order, so
    // diagnostics that bounce the clock around leave the wrong card active when
    // capture starts; sets are position-determined and survive any seek order.
    if (/(?:tl|gsap)\s*\.\s*call\([^;]{0,200}(?:draft|setCard|active)/i.test(html))
      errors.push("Studio Split card switches: use tl.set(...) at absolute timeline positions, not tl.call callbacks (callbacks fire in seek order and leave the wrong card active on the opening frames)");
  }
  // Warnings (not fatal) for the time-based timing model; the virtual clock still
  // advances CSS-free scenes correctly, but JS-driven time motion is the target style.
  for (const [pattern, message] of requiredTiming) if (!pattern.test(html)) timingWarnings.push(message);
  if(alpha&&/(?:class|id)\s*=\s*["'][^"']*\bchecker(?:board)?\b|(?:background(?:-image)?\s*:|style\s*=\s*["'][^"']*)[^;}"']*repeating-conic-gradient\s*\(/i.test(html))errors.push('Transparency checkerboard previews are not allowed in alpha output; use a genuinely transparent root instead');
  if(alpha&&/(?:html|body|:root)\s*(?:,\s*(?:html|body|:root)\s*)*\{[^}]*\bbackground(?:-color)?\s*:\s*(?!transparent\b|rgba?\([^)]*,\s*0(?:\.0+)?\s*\))[^;}]+|<(?:html|body)\b[^>]*style\s*=\s*["'][^"']*\bbackground(?:-color)?\s*:\s*(?!transparent\b)/i.test(html))errors.push('Alpha output declares an opaque root/background; a native transparent scene is required');
  for (const script of authored.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { new vm.Script(script[1]); } catch (error) { errors.push(`JavaScript syntax: ${(error as Error).message}`); }
  }
  return [...new Set(errors)];
}

// Non-fatal timing-model warnings, populated by validateHtml. Surfaced to the job log
// so the user can see when a scene is not fully JavaScript/time-driven.
export const timingWarnings: string[] = [];

// Canonical geometry tokens: tag plus whitespace-normalized coordinate attributes.
// Attribute order, quoting and styling do not matter; coordinates do.
export function shapeTokens(markup: string): string[] {
  const tokens: string[] = [];
  const geometry = ['d', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'points'];
  for (const match of markup.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*)>/gi)) {
    const parts: string[] = [];
    for (const attr of geometry) {
      const value = match[2].match(new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, 'i'));
      if (value) parts.push(`${attr}=${value[1].replace(/\s+/g, ' ').trim()}`);
    }
    if (parts.length) tokens.push(`${match[1].toLowerCase()};${parts.join(';')}`);
  }
  return tokens;
}

// Non-fatal checks for the v0.10 structure promises (helper library + BEATS table).
export function structurePromiseWarnings(html: string): string[] {
  const warnings: string[] = [];
  if (!/mulberry32\s*\(/i.test(html)) warnings.push('Seeded PRNG helper (mulberry32) not found; deterministic randomness expected.');
  if (!/\blerp\s*\(|\bclamp\s*\(|\beatProgress\s*\(/.test(html)) warnings.push('Helper utilities (lerp/clamp/beatProgress) not found.');
  if (!/\/\/\s*BEATS:/i.test(html)) warnings.push('BEATS table comment not found; beat-driven accents expected.');
  return warnings;
}
