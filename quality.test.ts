import assert from 'node:assert/strict';
import vm from 'node:vm';
import { beatCoherenceReport, blackSlabReport, cameraMotionReport, colorConsistencyReport, contrastRatio, cropBitmap, flickerReport, parseCssColor, relativeLuminance, sampleBackdropColor, stageContentReport, subjectDriftReport, subjectRegionContrast, TEXT_LEGIBILITY_PROBE, textFindings, textLegibilityReport, type TextSkippedItem } from './quality';

// flicker: monotonic change is fine, oscillation is not
assert.ok(flickerReport([0.01, 0.02, 0.03, 0.04]).ok);
assert.ok(flickerReport([]).ok);
const oscillating = flickerReport([0.01, 0.08, 0.01, 0.08, 0.01, 0.08]);
assert.equal(oscillating.ok, false);
assert.ok(oscillating.reversals >= 3);
assert.ok(oscillating.maxSwing >= 0.07 - 1e-9);

// subject drift: small shifts pass, large repositioning fails
assert.ok(subjectDriftReport([{ x: 100, y: 100, width: 200, height: 200 }, { x: 110, y: 105, width: 200, height: 200 }], 1920, 1080).ok);
const drifted = subjectDriftReport([{ x: 0, y: 0, width: 100, height: 100 }, { x: 900, y: 0, width: 100, height: 100 }], 1920, 1080);
assert.equal(drifted.ok, false);
assert.ok(drifted.drift > 0.12);
assert.ok(subjectDriftReport([], 1920, 1080).ok);

// color consistency: identical frames pass, a wholesale palette swap fails
const black = Buffer.alloc(64 * 4);
assert.ok(colorConsistencyReport([black, Buffer.from(black)]).ok);
const white = Buffer.alloc(64 * 4, 255);
const swapped = colorConsistencyReport([black, white]);
assert.equal(swapped.ok, false);
assert.ok(swapped.newColorRatio > 0.9);
assert.ok(colorConsistencyReport([black]).ok);

// text legibility: contrast + minimum size
assert.ok(textLegibilityReport([{ label: 'title', fontSize: 48, color: '#ffffff', background: '#000000' }]).ok);
const unreadable = textLegibilityReport([{ label: 'tiny', fontSize: 8, color: '#777777', background: '#888888' }]);
assert.equal(unreadable.ok, false);
assert.equal(unreadable.findings.length, 2);
assert.ok(contrastRatio('#ffffff', '#000000') > 20);
assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 1e-6);
assert.equal(relativeLuminance('not-a-color'), 0);

// beat coherence: parses the BEATS table comment
assert.equal(beatCoherenceReport('no table here', 5).ok, false);
assert.equal(beatCoherenceReport('no table here', 5).reason, 'BEATS table missing');
assert.ok(beatCoherenceReport('// BEATS: t=0.00s intro | t=0.60s pop | t=1.20s settle', 5).ok);
assert.equal(beatCoherenceReport('// BEATS: t=0.00s intro | t=3.00s pop', 5).ok, false);
assert.equal(beatCoherenceReport('// BEATS: t=0.00s only', 5).ok, false);
assert.equal(beatCoherenceReport('// BEATS: t=0.00s a | t=0.60s b | t=9.00s c', 5).ok, false);

// stage content: flat helpers, 64x64 RGBA frames in byte order r,g,b,a
const flat = (w: number, h: number, r: number, g: number, b: number) => {
  const buf = Buffer.alloc(w * h * 4);
  for (let i = 0; i < buf.length; i += 4) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; }
  return buf;
};
const paintBox = (frame: Buffer, w: number, x: number, y: number, bw: number, bh: number, r: number, g: number, b: number) => {
  for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) {
    const i = (yy * w + xx) * 4; frame[i] = r; frame[i + 1] = g; frame[i + 2] = b; frame[i + 3] = 255;
  }
};

// empty stage: fails the opening-frame floor with a coverage reason
const emptyStage = stageContentReport(flat(64, 64, 243, 242, 235), 64, 64);
assert.equal(emptyStage.ok, false);
assert.ok(emptyStage.coverage < 0.01);
assert.match(emptyStage.reason ?? '', /content covers/);

// high-contrast subject on a flat ground: coverage and contrast both clear
const strongFrame = flat(64, 64, 243, 242, 235);
paintBox(strongFrame, 64, 16, 16, 32, 32, 40, 40, 48);
const strong = stageContentReport(strongFrame, 64, 64);
assert.ok(strong.ok);
assert.ok(strong.coverage > 0.2);
assert.ok(strong.contrast > 4);
assert.ok(strong.flat);

// near-identical tones: content is detectable but the contrast floor fails
const paleFrame = flat(64, 64, 243, 242, 235);
paintBox(paleFrame, 64, 16, 16, 32, 32, 200, 198, 190);
const pale = stageContentReport(paleFrame, 64, 64);
assert.equal(pale.ok, false);
assert.ok(pale.coverage > 0.2, 'the pale subject is still detected as content');
assert.ok(pale.contrast > 1 && pale.contrast < 2.5);
assert.match(pale.reason ?? '', /contrast/);
assert.match(pale.reason ?? '', /measured content ~#.+ on ground #.+/, 'the contrast failure names the measured hex pair');

// region: the film stage measures separately from the strip below it
const board = flat(64, 64, 243, 242, 235);
paintBox(board, 64, 0, 44, 64, 20, 16, 16, 20);
assert.ok(stageContentReport(board, 64, 64).ok, 'the whole frame counts the strip as content');
assert.equal(
  stageContentReport(board, 64, 64, 0.1, 2.5, { x0: 0, y0: 0, x1: 64, y1: 41 }).ok,
  false,
  'the film region stays empty while the strip carries the content',
);

// cropBitmap: split diagnostics measure the stage without the strip's pixels
const region = { x0: 0, y0: 0, x1: 64, y1: 41 };
const cropped = cropBitmap(board, 64, 64, region);
assert.equal(cropped.length, 64 * 41 * 4);
assert.equal(stageContentReport(cropped, 64, 41).ok, false, 'the cropped stage reads empty while the strip holds the content');
const fullCrop = cropBitmap(board, 64, 64, { x0: 0, y0: 0, x1: 64, y1: 64 });
assert.equal(fullCrop.length, board.length);
assert.ok(fullCrop.equals(board), 'a full-region crop is the original bitmap');

// text probe: stub-DOM run of the injected script (visibility, scale, strip, skips)
type StubEl = {
  style: Record<string, string>;
  parent: StubEl | null;
  rect: { w: number; h: number };
  strip: boolean;
};
function stubRun(texts: { value: string; el: StubEl }[]) {
  const styles = new Map<StubEl, Record<string, string>>();
  const reg = (el: StubEl): void => {
    styles.set(el, {
      display: 'block', visibility: 'visible', opacity: '1', transform: 'none',
      backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none',
      fontSize: '16px', color: 'rgb(16, 16, 20)', ...el.style,
    });
    if (el.parent) reg(el.parent);
  };
  for (const t of texts) reg(t.el);
  let i = 0;
  const sandbox = {
    document: {
      body: {},
      createTreeWalker: () => ({ nextNode: () => (i < texts.length ? { nodeValue: texts[i].value, parentElement: texts[i++].el } : null) }),
    },
    NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: (el: StubEl) => styles.get(el),
  };
  for (const t of texts) {
    (t.el as StubEl & { getBoundingClientRect?: unknown }).getBoundingClientRect = () => ({ width: t.el.rect.w, height: t.el.rect.h });
    (t.el as StubEl & { closest?: unknown }).closest = (sel: string) => (sel === '#split-drafts' && t.el.strip ? {} : null);
    let n: StubEl | null = t.el.parent;
    while (n) {
      (n as StubEl & { getBoundingClientRect?: unknown }).getBoundingClientRect ??= () => ({ width: 100, height: 100 });
      (n as StubEl & { closest?: unknown }).closest ??= () => null;
      n = n.parent;
    }
  }
  return vm.runInNewContext(TEXT_LEGIBILITY_PROBE, sandbox) as { items: { label: string; fontSize: number; color: string; background: string }[]; skipped: TextSkippedItem[]; small: { label: string; fontSize: number }[] };
}
const root: StubEl = { style: { backgroundColor: 'rgb(240, 238, 229)' }, parent: null, rect: { w: 100, h: 100 }, strip: false };
const tinyHidden: StubEl = { style: { fontSize: '11px', display: 'none' }, parent: root, rect: { w: 0, h: 0 }, strip: false };
const scaledDown: StubEl = { style: { fontSize: '18px', transform: 'matrix(0.5, 0, 0, 0.5, 0, 0)', color: 'rgb(16, 16, 20)', backgroundColor: 'rgb(240, 238, 229)' }, parent: root, rect: { w: 50, h: 10 }, strip: false };
const stripLabel: StubEl = { style: { fontSize: '9px' }, parent: root, rect: { w: 30, h: 8 }, strip: true };
const gradientLabel: StubEl = { style: { fontSize: '16px', color: 'rgb(16, 16, 20)', backgroundImage: 'linear-gradient(#fff, #000)' }, parent: root, rect: { w: 60, h: 14 }, strip: false };
const probeOut = stubRun([
  { value: 'HIDDEN TINY', el: tinyHidden },
  { value: 'SCALED', el: scaledDown },
  { value: 'STRIP', el: stripLabel },
  { value: 'GRAD', el: gradientLabel },
]);
assert.ok(probeOut.small.some((s) => s.label === 'HIDDEN TINY'), 'an 11px label is reported as small even while hidden');
assert.ok(!probeOut.items.some((x) => x.label === 'HIDDEN TINY'), 'a hidden label contributes no painted item');
assert.deepEqual(
  textFindings([{ label: 'NOISE', fontSize: 11.999997, color: '#101014', background: '#f0eee5' }]).filter((f) => f.includes('font size')),
  [],
  'float noise just under 12px is measurement slack, not a violation',
);
assert.ok(!probeOut.items.some((x) => x.label === 'STRIP') && !probeOut.small.some((s) => s.label === 'STRIP'), 'strip chrome is excluded from every probe bucket');
assert.ok(probeOut.skipped.some((x) => x.label.includes('GRAD')), 'a gradient-backed label is reported as skipped');
const scaled = probeOut.items.find((x) => x.label === 'SCALED');
assert.equal(scaled?.fontSize, 9, 'ancestor scale multiplies the measured size');
assert.equal(scaled?.background, '#f0eee5', 'the background passes through already hexed, never double-encoded');
assert.ok(textFindings(probeOut.items).some((f) => f.startsWith('SCALED: font size 9px')), 'the scaled size feeds the findings');

// css color parsing: comma, space-separated, and slash-alpha forms all resolve;
// transparent, var() residue, and non-colors return null instead of NaN channels
assert.deepEqual(parseCssColor('rgb(38, 50, 56)'), { r: 38, g: 50, b: 56 });
assert.deepEqual(parseCssColor('rgba(16, 20, 22, 1)'), { r: 16, g: 20, b: 22 });
assert.deepEqual(parseCssColor('rgb(38 50 56)'), { r: 38, g: 50, b: 56 });
assert.deepEqual(parseCssColor('rgb(38 50 56 / 1)'), { r: 38, g: 50, b: 56 });
assert.equal(parseCssColor('rgba(38, 50, 56, 0.02)'), null, 'near-transparent resolves to null');
assert.equal(parseCssColor('rgb(38 50 56 / 0)'), null, 'zero slash-alpha resolves to null');
assert.deepEqual(parseCssColor('rgb(38 50 56 / var(--a))'), { r: 38, g: 50, b: 56 }, 'unresolvable alpha is treated as opaque');
assert.equal(parseCssColor('rgb(38, foo, 56)'), null, 'non-numeric channels never yield NaN');
assert.equal(parseCssColor('color(srgb 0.1 0.2 0.3)'), null, 'non-rgb() formats are unmeasurable');
assert.equal(parseCssColor('transparent'), null);

// text findings: labels with unparseable colors are skipped, never gated
assert.deepEqual(
  textFindings([{ label: 'GHOST', fontSize: 40, color: '#263238', background: '#NaNNaNNaN' }]),
  [],
  'a NaN background skips the label instead of failing it on garbage',
);
assert.deepEqual(
  textFindings([{ label: 'PALE', fontSize: 18, color: '#ffffff', background: '#f2f2f2' }]).length,
  1,
  'a real low-contrast pair still reports with its hex pair',
);
assert.match(
  textFindings([{ label: 'PALE', fontSize: 18, color: '#ffffff', background: '#f2f2f2' }])[0],
  /text #ffffff on #f2f2f2/,
  'the finding names the measured pair for the repair',
);

// black slab: exact-black mass fails, specks and transparency pass
const night = flat(64, 64, 240, 238, 232);
paintBox(night, 64, 8, 8, 48, 48, 0, 0, 0);
const slab = blackSlabReport(night, 64, 64);
assert.ok(!slab.ok && slab.share > 0.5, 'a black slab fails the mass floor');
assert.match(slab.reason ?? '', /#101014/, 'the slab failure names the replacement tone');
const specks = flat(64, 64, 240, 238, 232);
paintBox(specks, 64, 30, 30, 4, 4, 0, 0, 0);
assert.ok(blackSlabReport(specks, 64, 64).ok, 'hairlines and small type stay below the floor');

// backdrop sampling: quartile tones, so a pale chip around pale text reads as pale
const card = flat(96, 96, 16, 16, 20);
paintBox(card, 96, 28, 28, 40, 16, 240, 238, 229);
paintBox(card, 96, 30, 32, 36, 8, 250, 250, 250);
const chipSample = sampleBackdropColor(card, 96, 96, { x: 28, y: 28, width: 40, height: 16 }, '#fafafa');
assert.ok(chipSample !== null, 'a label box always resolves a ground tone');
assert.ok(
  contrastRatio('#fafafa', chipSample) < 1.5,
  'white text on a pale chip measures near-identical, not the dark card behind it',
);
const darkSample = sampleBackdropColor(card, 96, 96, { x: 28, y: 28, width: 40, height: 16 }, '#101014');
assert.ok(darkSample !== null && contrastRatio('#101014', darkSample) > 5, 'dark text on the pale chip reads high contrast');
assert.equal(
  sampleBackdropColor(card, 96, 96, { x: 28, y: 28, width: 40, height: 16 }, '#zzzzzz'),
  null,
  'an unparseable text color yields no sample',
);
assert.equal(
  sampleBackdropColor(card, 96, 96, { x: 0, y: 0, width: 2, height: 2 }, '#fafafa'),
  null,
  'a degenerate box yields no sample',
);
// subject-region contrast: local subject-vs-neighborhood on busy backdrops
const busy = flat(96, 96, 243, 242, 235);
paintBox(busy, 96, 0, 0, 96, 30, 230, 225, 215);
paintBox(busy, 96, 0, 60, 96, 36, 250, 248, 244);
paintBox(busy, 96, 28, 28, 40, 40, 22, 22, 26);
const local = subjectRegionContrast(busy, 96, 96, { x: 28, y: 28, width: 40, height: 40 });
assert.ok(local && local.ok && local.contrast > 5, 'a dark subject on a pale neighborhood passes locally');
const paleBox = flat(96, 96, 242, 240, 234);
paintBox(paleBox, 96, 28, 28, 40, 40, 232, 228, 220);
const paleLocal = subjectRegionContrast(paleBox, 96, 96, { x: 28, y: 28, width: 40, height: 40 });
assert.ok(paleLocal && !paleLocal.ok, 'a pale subject on a pale neighborhood fails locally');
assert.match(paleLocal?.reason ?? '', /below the required 2\.5/, 'the region failure names the floor');
assert.match(paleLocal?.reason ?? '', /subject tones ~#[0-9a-f]{6} on nearby #[0-9a-f]{6}/, 'the region failure names the measured pair');
// line art: dark strokes on a pale fill over a pale neighborhood passes on the strokes
const lineArt = flat(96, 96, 242, 240, 234);
paintBox(lineArt, 96, 28, 28, 40, 40, 232, 228, 220);
paintBox(lineArt, 96, 42, 28, 12, 40, 22, 22, 26);
const strokes = subjectRegionContrast(lineArt, 96, 96, { x: 28, y: 28, width: 40, height: 40 });
assert.ok(strokes && strokes.ok && strokes.contrast > 5, 'dark strokes read against a pale neighborhood even with a pale fill');
assert.equal(
  subjectRegionContrast(busy, 96, 96, { x: 28, y: 28, width: 2, height: 2 }),
  null,
  'a degenerate box skips instead of failing',
);

// camera motion: translating content passes on translation alone
const c1 = flat(64, 64, 243, 242, 235); paintBox(c1, 64, 4, 24, 16, 16, 40, 40, 48);
const c2 = flat(64, 64, 243, 242, 235); paintBox(c2, 64, 20, 24, 16, 16, 40, 40, 48);
const c3 = flat(64, 64, 243, 242, 235); paintBox(c3, 64, 40, 24, 16, 16, 40, 40, 48);
const moving = cameraMotionReport([c1, c2, c3], 64, 64, 0.008);
assert.ok(moving.ok);
assert.ok(moving.translation > 0.1);

// identical frames: the old active-ratio pass is gone, this now fails
const still = cameraMotionReport([c1, c1, c1], 64, 64, 0.008);
assert.equal(still.ok, false);
assert.equal(still.strongRatio, 0);
assert.match(still.reason ?? '', /locked static/);

// strong in-place transformation without translation: passes on strong frame change
const s1 = flat(64, 64, 243, 242, 235); paintBox(s1, 64, 24, 24, 16, 16, 40, 40, 48);
const s2 = flat(64, 64, 243, 242, 235); paintBox(s2, 64, 24, 24, 16, 16, 231, 92, 63);
const inPlace = cameraMotionReport([s1, s2], 64, 64, 0.008);
assert.ok(inPlace.ok);
assert.ok(inPlace.strongRatio > 0.02);
assert.ok(inPlace.translation < 0.008);

// subtle same-place shimmer: no translation and no strong change fails
const n2 = flat(64, 64, 243, 242, 235); paintBox(n2, 64, 24, 24, 16, 16, 55, 55, 63);
const shimmer = cameraMotionReport([s1, n2], 64, 64, 0.008);
assert.equal(shimmer.ok, false, 'a barely-brighter box in the same spot is not camera motion');
console.log('quality metric checks passed');
