// Scene runtime: turns the code pasted from ChatGPT into a deterministic
// frame renderer. Shared by the live preview (main thread) and the export worker.

export const BASE_W = 1920;
export const BASE_H = 1080;

// ChatGPT answers often arrive wrapped in markdown fences or a full HTML page.
export function extractCode(raw) {
  let s = (raw || '').trim();
  const fences = [...s.matchAll(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (fences.length) {
    s = fences.sort((a, b) => b.length - a.length)[0];
  } else {
    s = s.replace(/^```[a-zA-Z]*[ \t]*\r?\n/, '').replace(/```\s*$/, '');
  }
  const scripts = [...s.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (scripts.length) s = scripts.join('\n');
  return s.trim();
}

// One paste may hold several scenes (several code blocks, or several
// "// TITLE:" headers in a row); the queue takes each as its own item.
export function splitScenes(raw) {
  const text = raw || '';
  const fences = [...text.matchAll(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)```/g)]
    .map((m) => m[1].trim())
    .filter((c) => /\bdraw\b/.test(c));
  if (fences.length > 1) return fences;
  const single = extractCode(text);
  if (!single) return [];
  const parts = single.split(/^(?=[ \t]*\/\/[ \t]*TITLE:)/im).map((p) => p.trim()).filter(Boolean);
  const scenes = parts.filter((p) => /\bdraw\b/.test(p));
  return scenes.length > 1 ? scenes : [single];
}

export function parseMeta(code) {
  const title = code.match(/^\s*\/\/\s*TITLE:\s*(.+)$/im)?.[1]?.trim() || '';
  const kw = code.match(/^\s*\/\/\s*KEYWORDS:\s*(.+)$/im)?.[1] || '';
  const keywords = [...new Set(kw.split(',').map((k) => k.trim()).filter(Boolean))];
  const seconds = Number(code.match(/^\s*\/\/\s*DURATION:\s*(\d+(?:\.\d+)?)/im)?.[1]);
  const duration = seconds ? Math.min(60, Math.max(5, Math.round(seconds))) : null;
  const loop = /^\s*\/\/\s*LOOP:\s*(yes|true)/im.test(code);
  const cat = Number(code.match(/^\s*\/\/\s*CATEGORY:\s*(\d+)/im)?.[1]);
  const category = cat >= 1 && cat <= 21 ? cat : null;
  return { title, keywords, duration, loop, category };
}

function mulberry32(seed) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.reseed = (s) => {
    a = s >>> 0;
  };
  return rng;
}

// The scene always draws in 1920x1080 units; the host scales to the real pixel
// size. Scene code calling setTransform/resetTransform would wipe that scale,
// so those two are overridden per context to keep it.
const patched = new WeakSet();
function patchContext(ctx) {
  if (patched.has(ctx)) return;
  patched.add(ctx);
  const proto = Object.getPrototypeOf(ctx);
  const rawSet = proto.setTransform;
  ctx.__scale = 1;
  const scaleProperty = (name, transform = (value, scale) => value * scale) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor || !descriptor.get || !descriptor.set) return;
    Object.defineProperty(ctx, name, {
      configurable: true,
      get() { return descriptor.get.call(this); },
      set(value) { descriptor.set.call(this, transform(value, this.__scale || 1)); },
    });
  };
  scaleProperty('shadowBlur');
  scaleProperty('shadowOffsetX');
  scaleProperty('shadowOffsetY');
  scaleProperty('filter', (value, scale) => typeof value === 'string' ? value.replace(/(-?\d*\.?\d+)px\b/g, (_, n) => `${Number(n) * scale}px`) : value);
  ctx.__rawSetTransform = rawSet;
  ctx.setTransform = function (a, b, c, d, e, f) {
    if (a && typeof a === 'object') ({ a, b, c, d, e, f } = a);
    if (a === undefined) [a, b, c, d, e, f] = [1, 0, 0, 1, 0, 0];
    const s = this.__scale;
    rawSet.call(this, a * s, b * s, c * s, d * s, e * s, f * s);
  };
  ctx.resetTransform = function () {
    const s = this.__scale;
    rawSet.call(this, s, 0, 0, s, 0, 0);
  };
  clipCostlyDraws(ctx, proto, rawSet);
}

// A shape drawn with a filter, or with a shadow under a blend mode other than
// source-over, makes the CPU-backed export canvas composite a layer the size of
// the whole frame: about 75 ms per shape at 4K, where it is otherwise well
// under 1 ms. Clipping the draw to the area the shape and its glow can reach
// keeps that layer small and the picture the same. For that the bounds of
// paths are tracked below; a draw whose bounds are not known is left as it was.

// Bounds of a path while it is built: box is [minX, minY, maxX, maxY], and
// known turns false once the path holds a piece that is not tracked.
const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function addPoint(path, m, x, y) {
  const px = m.a * x + m.c * y + m.e;
  const py = m.b * x + m.d * y + m.f;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;
  const box = path.box;
  if (!box) path.box = [px, py, px, py];
  else {
    if (px < box[0]) box[0] = px;
    if (py < box[1]) box[1] = py;
    if (px > box[2]) box[2] = px;
    if (py > box[3]) box[3] = py;
  }
}
function addRect(path, m, x, y, w, h) {
  addPoint(path, m, x, y);
  addPoint(path, m, x + w, y);
  addPoint(path, m, x, y + h);
  addPoint(path, m, x + w, y + h);
}
// Curves stay inside the hull of their control points; arcs inside their circle.
const PIECES = {
  moveTo: addPoint,
  lineTo: addPoint,
  quadraticCurveTo: (path, m, cx, cy, x, y) => {
    addPoint(path, m, cx, cy);
    addPoint(path, m, x, y);
  },
  bezierCurveTo: (path, m, ax, ay, bx, by, x, y) => {
    addPoint(path, m, ax, ay);
    addPoint(path, m, bx, by);
    addPoint(path, m, x, y);
  },
  arc: (path, m, x, y, r) => addRect(path, m, x - r, y - r, 2 * r, 2 * r),
  ellipse: (path, m, x, y, rx, ry) => {
    const r = Math.max(rx, ry);
    addRect(path, m, x - r, y - r, 2 * r, 2 * r);
  },
  rect: addRect,
  roundRect: addRect,
  arcTo: (path) => {
    path.known = false;
  },
};

// The Path2D that scene code gets: one that knows its bounds, in its own coordinates.
class ScenePath extends Path2D {
  constructor(from) {
    super(from);
    const copied = from instanceof ScenePath;
    this.box = copied && from.box ? [...from.box] : null;
    this.known = from === undefined || (copied && from.known);
  }

  addPath(other, transform) {
    const m = transform || IDENTITY;
    const plain = ['a', 'b', 'c', 'd', 'e', 'f'].every((k) => Number.isFinite(m[k]));
    if (!plain || !(other instanceof ScenePath) || !other.known) this.known = false;
    else if (other.box) {
      const [x0, y0, x1, y1] = other.box;
      addRect(this, m, x0, y0, x1 - x0, y1 - y0);
    }
    return super.addPath(other, transform);
  }
}
for (const [name, track] of Object.entries(PIECES)) {
  const raw = Path2D.prototype[name];
  if (!raw) continue;
  ScenePath.prototype[name] = function (...args) {
    track(this, IDENTITY, ...args);
    return raw.apply(this, args);
  };
}

// How far a filter spreads a shape, in canvas pixels: three times every pixel
// length in it covers blur() and drop-shadow(). Infinity when that cannot be told.
const filterReaches = new Map();
function filterReach(filter) {
  if (!filter || filter === 'none') return 0;
  let reach = filterReaches.get(filter);
  if (reach === undefined) {
    reach = 0;
    if (/url\(|\d(em|rem|ex|ch|vw|vh|vmin|vmax|pt|pc|cm|mm|in|q)\b/i.test(filter)) reach = Infinity;
    else for (const [, px] of filter.matchAll(/(\d*\.?\d+)px/gi)) reach += 3 * Number(px);
    filterReaches.set(filter, reach);
  }
  return reach;
}

function clipCostlyDraws(ctx, proto, rawSet) {
  const current = { box: null, known: true }; // the context's own path, in canvas pixels

  for (const [name, track] of Object.entries(PIECES)) {
    const raw = proto[name];
    if (!raw) continue;
    ctx[name] = function (...args) {
      track(current, this.getTransform(), ...args);
      return raw.apply(this, args);
    };
  }
  for (const name of ['beginPath', 'reset']) {
    const raw = proto[name];
    if (!raw) continue;
    ctx[name] = function () {
      current.box = null;
      current.known = true;
      return raw.call(this);
    };
  }

  // The margin a costly draw needs around its shape, or -1 for a cheap draw.
  // Shadow blur and offsets are in canvas pixels whatever the transform is.
  const margin = (c) => {
    const spread = filterReach(c.filter);
    const shadow = c.shadowBlur > 0 || c.shadowOffsetX !== 0 || c.shadowOffsetY !== 0;
    if (!spread && !(shadow && c.globalCompositeOperation !== 'source-over')) return -1;
    return spread + c.shadowBlur * 2 + 2;
  };
  // How far a stroke reaches beyond its path, in canvas pixels.
  const strokeReach = (c, m) => {
    const w = c.lineWidth * Math.hypot(m.a, m.b, m.c, m.d);
    return c.lineJoin === 'miter' ? (w * Math.max(1, c.miterLimit)) / 2 : w;
  };
  const clipped = (c, m, b, grow, draw) => {
    const x0 = Math.floor(b[0] - grow + Math.min(0, c.shadowOffsetX));
    const y0 = Math.floor(b[1] - grow + Math.min(0, c.shadowOffsetY));
    const x1 = Math.ceil(b[2] + grow + Math.max(0, c.shadowOffsetX));
    const y1 = Math.ceil(b[3] + grow + Math.max(0, c.shadowOffsetY));
    if (![x0, y0, x1, y1].every(Number.isFinite)) return draw();
    // A Path2D, so the scene's own current path is left alone.
    const area = new Path2D();
    area.rect(x0, y0, x1 - x0, y1 - y0);
    c.save();
    rawSet.call(c, 1, 0, 0, 1, 0, 0);
    c.clip(area);
    rawSet.call(c, m.a, m.b, m.c, m.d, m.e, m.f);
    try {
      return draw();
    } finally {
      c.restore();
    }
  };
  // The bounds of a rectangle given in the scene's coordinates, in canvas pixels.
  const rectBox = (m, x, y, w, h) => {
    const path = { box: null };
    addRect(path, m, x, y, w, h);
    return path.box;
  };

  for (const name of ['fill', 'stroke']) {
    const raw = proto[name];
    ctx[name] = function (...args) {
      const draw = () => raw.apply(this, args);
      const grow = margin(this);
      if (grow < 0) return draw();
      const m = this.getTransform();
      let b = current.known ? current.box : null;
      if (args[0] && typeof args[0] === 'object') {
        const { box, known } = args[0];
        b = known && box ? rectBox(m, box[0], box[1], box[2] - box[0], box[3] - box[1]) : null;
      }
      if (!b) return draw();
      return clipped(this, m, b, grow + (name === 'stroke' ? strokeReach(this, m) : 0), draw);
    };
  }
  for (const name of ['fillRect', 'strokeRect']) {
    const raw = proto[name];
    ctx[name] = function (x, y, w, h) {
      const draw = () => raw.call(this, x, y, w, h);
      const grow = margin(this);
      if (grow < 0) return draw();
      const m = this.getTransform();
      const b = rectBox(m, x, y, w, h);
      if (!b) return draw();
      return clipped(this, m, b, grow + (name === 'strokeRect' ? strokeReach(this, m) : 0), draw);
    };
  }
  for (const name of ['fillText', 'strokeText']) {
    const raw = proto[name];
    ctx[name] = function (text, x, y, ...rest) {
      const draw = () => raw.call(this, text, x, y, ...rest);
      const grow = margin(this);
      if (grow < 0) return draw();
      const m = this.getTransform();
      const t = this.measureText(text);
      const up = Math.max(t.actualBoundingBoxAscent, t.fontBoundingBoxAscent || 0);
      const down = Math.max(t.actualBoundingBoxDescent, t.fontBoundingBoxDescent || 0);
      const b = rectBox(m, x - t.actualBoundingBoxLeft, y - up, t.actualBoundingBoxLeft + t.actualBoundingBoxRight, up + down);
      if (!b) return draw();
      return clipped(this, m, b, grow + (name === 'strokeText' ? strokeReach(this, m) : 0), draw);
    };
  }
}

export function compileScene(rawCode, { duration, fps, seed = 1 }) {
  const code = extractCode(rawCode);
  if (!code) throw new Error('Kode masih kosong.');

  const rng = mulberry32(seed);
  const seededMath = Object.create(Math);
  seededMath.random = rng;
  let now = 0;
  const clock = { now: () => now * 1000 };

  let factory;
  try {
    factory = new Function(
      'Math', 'Date', 'performance', 'window', 'document', 'requestAnimationFrame', 'Path2D',
      `let state;\n${code}\n;return {
         setup: typeof setup === 'function' ? setup : null,
         draw: typeof draw === 'function' ? draw : null,
         setState: (value) => { state = value; }
      };`,
    );
  } catch (err) {
    throw new Error(`Syntax error: ${err.message}`);
  }

  const { setup, draw, setState } = factory(seededMath, clock, clock, undefined, undefined, undefined, ScenePath);
  if (!draw) {
    throw new Error('Kode harus punya function draw(ctx, t, env). Pastikan ChatGPT mengikuti format prompt.');
  }

  const totalFrames = Math.max(1, Math.round(duration * fps));
  const baseEnv = { width: BASE_W, height: BASE_H, duration, fps, random: rng };
  rng.reseed(seed);
  const state = setup ? setup({ ...baseEnv, frame: 0, progress: 0, time: 0 }) : undefined;
  if (setState) setState(state);

  function drawFrame(ctx, frame, pixelW) {
    patchContext(ctx);
    const f = ((frame % totalFrames) + totalFrames) % totalFrames;
    const t = f / fps;
    now = t;
    // Reseeded per frame so a stray Math.random() in draw() still exports reproducibly.
    rng.reseed(seed * 7919 + f);
    if (ctx.reset) ctx.reset();
    ctx.__scale = pixelW / BASE_W;
    ctx.__rawSetTransform(ctx.__scale, 0, 0, ctx.__scale, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, BASE_W, BASE_H);
    ctx.save();
    try {
      draw(ctx, t, { ...baseEnv, frame: f, progress: t / duration, time: t, state });
    } finally {
      ctx.restore();
    }
  }

  // Dry run so runtime errors surface at paste time, not mid-export.
  if (typeof OffscreenCanvas !== 'undefined') {
    const probe = new OffscreenCanvas(320, 180).getContext('2d');
    drawFrame(probe, 0, 320);
    drawFrame(probe, Math.floor(totalFrames / 2), 320);
  }

  return { drawFrame, totalFrames, meta: parseMeta(code), code };
}
