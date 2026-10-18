// MF: host-provided motion-design kit for Canvas scenes. The host evaluates it in the scene's own
// scope (same seeded Math and Path2D the scene sees), so every helper is deterministic and pure in t.
// It deliberately ships NO icon set: every object is drawn by the scene itself so it carries the clip's own character.
const MF = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;

  const ease = {
    linear: (x) => x,
    inQuad: (x) => x * x,
    outQuad: (x) => 1 - (1 - x) * (1 - x),
    inOutQuad: (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2),
    inCubic: (x) => x * x * x,
    outCubic: (x) => 1 - (1 - x) ** 3,
    inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
    outQuart: (x) => 1 - (1 - x) ** 4,
    inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
    outQuint: (x) => 1 - (1 - x) ** 5,
    outExpo: (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
    inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2),
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    outBack: (x, s = 1.70158) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2,
    outElastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * (TAU / 3)) + 1),
  };
  const fn = (e) => (typeof e === 'function' ? e : ease[e] || ease.outCubic);

  // Eased 0..1 progress of a window [start, start + dur].
  const seg = (t, start, dur, e = 'outCubic') => fn(e)(clamp((t - start) / Math.max(1e-6, dur)));
  const stagger = (t, i, start, step, dur, e = 'outCubic') => seg(t, start + i * step, dur, e);
  const range = (t, a, b) => clamp((t - a) / Math.max(1e-6, b - a));
  // Damped spring 0 -> 1 (closed form): a settle with a small natural overshoot.
  const spring = (t, o = {}) => {
    if (t <= 0) return 0;
    const w = TAU * (o.freq ?? 1.6);
    const z = clamp(o.damping ?? 0.55, 0.05, 0.999);
    const wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  };
  // Keyframes [[time, value, ease?], ...]; the ease on a key shapes the move INTO that key.
  const track = (t, keys, e = 'inOutCubic') => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, e1] = keys[i];
      if (t <= t1) {
        const [t0, v0] = keys[i - 1];
        return lerp(v0, v1, fn(e1 || e)(clamp((t - t0) / Math.max(1e-6, t1 - t0))));
      }
    }
    return keys[keys.length - 1][1];
  };
  const wave = (t, period = 4, phase = 0) => Math.sin((t / period) * TAU + phase);
  const float = (t, i = 0, amp = 4, period = 3.2) => Math.sin((t / period) * TAU + i * 1.7) * amp;
  const loop = (t, duration) => (((t % duration) + duration) % duration) / duration;
  const mixRect = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) });

  const hex = (c) => {
    let h = String(c).replace('#', '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgba = (c, a = 1) => {
    if (!/^#/.test(String(c))) return c;
    const [r, g, b] = hex(c);
    return `rgba(${r},${g},${b},${a})`;
  };
  const mixColor = (a, b, k) => {
    const x = hex(a), y = hex(b);
    return `rgb(${x.map((v, i) => Math.round(lerp(v, y[i], clamp(k)))).join(',')})`;
  };

  const rr = (ctx, x, y, w, h, r = 16) => {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  const shadow = (ctx, blur = 30, y = 12, color = 'rgba(15,23,42,0.18)') => {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = y;
  };
  const noShadow = (ctx) => {
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  };
  // Rounded panel with a soft drop shadow. x, y = top-left corner.
  const card = (ctx, x, y, w, h, o = {}) => {
    const { r = 24, fill = '#ffffff', stroke = null, lineWidth = 1.5, alpha = 1 } = o;
    const sh = o.shadow ?? true;
    ctx.save();
    ctx.globalAlpha *= alpha;
    rr(ctx, x, y, w, h, r);
    if (sh) {
      const s = sh === true ? {} : sh;
      shadow(ctx, s.blur ?? 40, s.y ?? 16, s.color ?? 'rgba(15,23,42,0.16)');
    }
    ctx.fillStyle = fill;
    ctx.fill();
    noShadow(ctx);
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
    ctx.restore();
  };

  const FONT = "Inter, 'Segoe UI', 'Helvetica Neue', Roboto, Arial, sans-serif";
  const text = (ctx, str, x, y, o = {}) => {
    const { size = 48, weight = 600, color = '#0f172a', align = 'center', baseline = 'middle', font = FONT, tracking = 0, alpha = 1, maxWidth } = o;
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.textBaseline = baseline;
    const s = String(str);
    if (!tracking) {
      ctx.textAlign = align;
      if (maxWidth) ctx.fillText(s, x, y, maxWidth);
      else ctx.fillText(s, x, y);
    } else {
      const chars = [...s];
      const ws = chars.map((ch) => ctx.measureText(ch).width);
      const total = ws.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
      let cx = align === 'center' ? x - total / 2 : align === 'right' || align === 'end' ? x - total : x;
      ctx.textAlign = 'left';
      chars.forEach((ch, i) => {
        ctx.fillText(ch, cx, y);
        cx += ws[i] + tracking;
      });
    }
    ctx.restore();
  };
  const fmt = (v, o = {}) => {
    const { decimals = 0, prefix = '', suffix = '', sep = ',' } = o;
    const [i, d] = Math.abs(v).toFixed(decimals).split('.');
    return `${v < 0 ? '-' : ''}${prefix}${i.replace(/\B(?=(\d{3})+(?!\d))/g, sep)}${d ? `.${d}` : ''}${suffix}`;
  };

  // Draws `draw(ctx)` around a local origin at (x, y) while it enters: fade + travel + slight scale.
  // `from` is the direction the element travels: 'up' rises into place, 'left' slides in leftwards, etc.
  const enter = (ctx, p, x, y, draw, o = {}) => {
    if (p <= 0) return;
    const { from = 'up', dist = 36, scale = 0.94, rotate = 0 } = o;
    const q = 1 - clamp(p);
    const dx = from === 'left' ? dist * q : from === 'right' ? -dist * q : 0;
    const dy = from === 'up' ? dist * q : from === 'down' ? -dist * q : 0;
    ctx.save();
    ctx.globalAlpha *= clamp(p);
    ctx.translate(x + dx, y + dy);
    const s = lerp(scale, 1, p);
    ctx.scale(s, s);
    if (rotate) ctx.rotate(rotate * q);
    draw(ctx);
    ctx.restore();
  };
  // Slow push-in about (cx, cy). Call between ctx.save() and ctx.restore(). loop:true returns to the start frame.
  const camera = (ctx, t, duration, o = {}) => {
    const { zoom = 0.04, pan = 0, cx = 960, cy = 540, loop: looped = false } = o;
    const u = clamp(t / duration);
    const k = looped ? (1 - Math.cos(u * TAU)) / 2 : ease.inOutSine(u);
    const s = 1 + zoom * k;
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx - pan * k, -cy);
  };
  const bar = (ctx, x, y, w, h, p, o = {}) => {
    const { track: tr = 'rgba(15,23,42,0.08)', color = '#2563eb', r = h / 2 } = o;
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = tr;
    ctx.fill();
    const fw = w * clamp(p);
    if (fw > 0.5) {
      rr(ctx, x, y, Math.max(fw, Math.min(w, h)), h, r);
      ctx.fillStyle = color;
      ctx.fill();
    }
  };
  const ring = (ctx, x, y, radius, p, o = {}) => {
    const { width = 14, color = '#2563eb', track: tr = 'rgba(15,23,42,0.08)', start = -Math.PI / 2 } = o;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = width;
    if (tr) {
      ctx.strokeStyle = tr;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.stroke();
    }
    if (p > 0) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, radius, start, start + TAU * clamp(p));
      ctx.stroke();
    }
    ctx.restore();
  };
  // Connector drawn from (x0, y0) toward (x1, y1) up to progress p.
  const line = (ctx, x0, y0, x1, y1, p, o = {}) => {
    if (p <= 0) return;
    const { color = 'rgba(15,23,42,0.25)', width = 3, dash = null } = o;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(lerp(x0, x1, clamp(p)), lerp(y0, y1, clamp(p)));
    ctx.stroke();
    ctx.restore();
  };

  const SAFE = { x0: 116, x1: 1804, y0: 87, y1: 993 };
  return {
    TAU, SAFE, FONT, clamp, lerp, ease, seg, stagger, range, spring, track, wave, float, loop, mixRect,
    rgba, mixColor, rr, shadow, noShadow, card, text, fmt,
    enter, camera, bar, ring, line,
  };
})();
