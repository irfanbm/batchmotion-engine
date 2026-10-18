// MF: host-provided motion-design kit for Canvas scenes. The host evaluates it in the scene's own
// scope (same seeded Math and Path2D the scene sees), so every helper is deterministic and pure in t.
// Icons are drawn on a 24-unit grid with one stroke weight and round joins, so a whole scene keeps
// one consistent icon style no matter which objects the concept asks for.
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

  const star = () => {
    let d = '';
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 4.3 : 9.6, a = -Math.PI / 2 + (i * Math.PI) / 5;
      d += `${i ? 'L' : 'M'}${(12 + r * Math.cos(a)).toFixed(2)} ${(12.6 + r * Math.sin(a)).toFixed(2)}`;
    }
    return `${d}Z`;
  };
  const gear = () => {
    let d = '';
    const teeth = 8;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * TAU, s = TAU / teeth;
      const pts = [[7.4, a - s * 0.32], [9.6, a - s * 0.18], [9.6, a + s * 0.18], [7.4, a + s * 0.32]];
      for (const [r, b] of pts) d += `${d ? 'L' : 'M'}${(12 + r * Math.cos(b)).toFixed(2)} ${(12 + r * Math.sin(b)).toFixed(2)}`;
    }
    return `${d}ZM15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0`;
  };

  const ICONS = {
    check: 'M20 6 9 17l-5-5',
    x: 'M18 6 6 18M6 6l12 12',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    arrowRight: 'M5 12h14M13 6l6 6-6 6',
    arrowLeft: 'M19 12H5M11 6l-6 6 6 6',
    arrowUp: 'M12 19V5M6 11l6-6 6 6',
    arrowDown: 'M12 5v14M6 13l6 6 6-6',
    chevronRight: 'M9 6l6 6-6 6',
    circle: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0',
    cart: 'M3 3h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 7H6M10.5 20a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0M19.5 20a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0',
    bag: 'M6 7h12l1 14H5L6 7zM9 9V6a3 3 0 0 1 6 0v3',
    box: 'M21 8 12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5',
    truck: 'M2 6h12v10H2zM14 9h4l3 3v4h-7zM8 18a2 2 0 1 1-4 0a2 2 0 1 1 4 0M19 18a2 2 0 1 1-4 0a2 2 0 1 1 4 0',
    card: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM2 10h20M6 15h4',
    wallet: 'M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9H5a2 2 0 0 1-2-2zM16 14h.01',
    coin: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0M12 6v12M15 9c0-1.1-1.3-2-3-2s-3 .9-3 2 1.3 2 3 2 3 .9 3 2-1.3 2-3 2-3-.9-3-2',
    receipt: 'M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2V2zM9 7h6M9 11h6M9 15h4',
    bank: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18',
    percent: 'M19 5 5 19M9 6.5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0M20 17.5a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0',
    tag: 'M3 3h8l10 10-8 8L3 11V3zM8.5 7.5a1 1 0 1 1-2 0a1 1 0 1 1 2 0',
    gift: 'M3 8h18v4H3zM5 12h14v9H5zM12 8v13M12 8C10 4 6 4 7.5 6.5S12 8 12 8zM12 8c2-4 6-4 4.5-1.5S12 8 12 8z',
    user: 'M16 8a4 4 0 1 1-8 0a4 4 0 1 1 8 0M4 21a8 8 0 0 1 16 0',
    users: 'M13 8a4 4 0 1 1-8 0a4 4 0 1 1 8 0M1 21a8 8 0 0 1 16 0M16 4.3a4 4 0 0 1 0 7.4M19 14.5a8 8 0 0 1 4 6.5',
    lock: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 11V7a4 4 0 0 1 8 0v4',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
    shieldCheck: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4',
    bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 21h4',
    mail: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM22 7l-10 7L2 7',
    send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z',
    chat: 'M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z',
    home: 'M3 11l9-8 9 8M5 9.5V20h5v-6h4v6h5V9.5',
    pin: 'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12zM14.5 10a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0',
    globe: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z',
    barChart: 'M3 20h18M6 16v-4M10 16V8M14 16v-6M18 16V5',
    lineChart: 'M3 3v18h18M7 15l4-4 3 3 6-6',
    trendUp: 'M3 17l6-6 4 4 8-8M15 7h6v6',
    pie: 'M21 12A9 9 0 1 1 12 3v9h9zM15 3.3A9 9 0 0 1 20.7 9H15V3.3z',
    gear: gear(),
    search: 'M18 11a7 7 0 1 1-14 0a7 7 0 1 1 14 0M16 16l5 5',
    heart: 'M12 20s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.2-8 11-8 11z',
    star: star(),
    sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
    clock: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0M12 7v5l3 2',
    calendar: 'M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM3 10h18M8 3v4M16 3v4',
    phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
    laptop: 'M5 5h14a1 1 0 0 1 1 1v10H4V6a1 1 0 0 1 1-1zM2 19h20l-2-3H4l-2 3z',
    cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
    wifi: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01',
    battery: 'M3 7h15a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM22 10v4M6 10v4M9 10v4',
    cloud: 'M7 19a5 5 0 0 1-.6-10A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1-.5 9.5H7z',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    upload: 'M12 15V3M7 8l5-5 5 5M4 21h16',
    bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
    leaf: 'M5 19C5 10 10 5 20 4c-1 10-6 15-15 15zM5 19l8-8',
    doc: 'M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM14 2v5h5M8 13h8M8 17h6',
    folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z',
    play: 'M7 4l13 8-13 8V4z',
    camera: 'M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM16 13a4 4 0 1 1-8 0a4 4 0 1 1 8 0',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0',
    rocket: 'M12 2c4 3 5 8 4 13H8C7 10 8 5 12 2zM8 15l-3 3 1 3 3-2M16 15l3 3-1 3-3-2M10 19h4M13.5 9a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0',
  };
  const ALIASES = {
    shoppingcart: 'cart', basket: 'cart', shoppingbag: 'bag', package: 'box', parcel: 'box', delivery: 'truck', shipping: 'truck',
    creditcard: 'card', payment: 'card', money: 'coin', dollar: 'coin', cash: 'coin', invoice: 'receipt', bill: 'receipt',
    discount: 'percent', sale: 'percent', price: 'tag', person: 'user', profile: 'user', account: 'user', team: 'users',
    security: 'shield', secure: 'shieldCheck', verified: 'shieldCheck', password: 'lock', notification: 'bell', email: 'mail',
    message: 'chat', location: 'pin', map: 'pin', world: 'globe', analytics: 'barChart', chart: 'barChart', growth: 'trendUp',
    settings: 'gear', cog: 'gear', time: 'clock', schedule: 'calendar', mobile: 'phone', smartphone: 'phone', computer: 'laptop',
    chip: 'cpu', energy: 'bolt', power: 'bolt', eco: 'leaf', file: 'doc', document: 'doc', video: 'play', photo: 'camera',
    success: 'check', done: 'check', close: 'x', launch: 'rocket', favorite: 'heart', like: 'heart', rating: 'star', magic: 'sparkle',
  };
  const keyOf = (name) => {
    const k = String(name || '').replace(/[-_\s]/g, '').toLowerCase();
    const direct = Object.keys(ICONS).find((n) => n.toLowerCase() === k);
    return direct || ALIASES[k] || 'circle';
  };
  const cache = {};
  const pathOf = (name) => {
    const k = keyOf(name);
    return cache[k] || (cache[k] = new Path2D(ICONS[k]));
  };
  const DASH = 160;

  // Line icon centred on (x, y), `size` px wide. progress < 1 draws the strokes on.
  const icon = (ctx, name, x, y, size = 96, o = {}) => {
    const { color = '#0f172a', width = 2, progress = 1, alpha = 1, rotate = 0, fillAlpha = 0.14 } = o;
    if (progress <= 0 || alpha <= 0) return;
    const p = pathOf(name);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(x, y);
    if (rotate) ctx.rotate(rotate);
    const k = size / 24;
    ctx.scale(k, k);
    ctx.translate(-12, -12);
    if (o.fill) {
      ctx.save();
      ctx.globalAlpha *= fillAlpha * clamp(progress);
      ctx.fillStyle = o.fill === true ? color : o.fill;
      ctx.fill(p);
      ctx.restore();
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    if (progress < 1) ctx.setLineDash([progress * DASH, DASH]);
    ctx.stroke(p);
    ctx.restore();
  };
  // Solid circle / squircle with a centred icon: the standard "app icon" look.
  const badge = (ctx, name, x, y, size = 120, o = {}) => {
    const { bg = '#2563eb', fg = '#ffffff', shape = 'circle', progress = 1, alpha = 1, ring = null, iconScale = 0.5, width = 2.2 } = o;
    if (alpha <= 0) return;
    const sh = o.shadow ?? true;
    ctx.save();
    ctx.globalAlpha *= alpha;
    if (sh) shadow(ctx, size * 0.3, size * 0.1, 'rgba(15,23,42,0.18)');
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, TAU);
    } else rr(ctx, x - size / 2, y - size / 2, size, size, size * 0.28);
    ctx.fillStyle = bg;
    ctx.fill();
    noShadow(ctx);
    if (ring) {
      ctx.strokeStyle = ring;
      ctx.lineWidth = size * 0.04;
      ctx.stroke();
    }
    ctx.restore();
    icon(ctx, name, x, y, size * iconScale, { color: fg, width, progress, alpha });
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
    rgba, mixColor, rr, shadow, noShadow, card, icon, badge, icons: Object.keys(ICONS), text, fmt,
    enter, camera, bar, ring, line,
  };
})();
