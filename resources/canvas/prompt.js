import { stockCsvText } from './csv.js';

export const IDEAS = [
  'Countdown 10 sampai 1 gaya neon futuristik dengan cincin progres yang berputar',
  'Countdown 5 detik gaya film lawas, lingkaran menyapu seperti jarum jam',
  'Countdown 10 detik gaya minimalis putih bersih untuk presentasi bisnis',
  'Countdown 3-2-1 gaya glitch digital dengan garis scan',
  'Countdown 10 detik tema tahun baru, angka emas dengan percikan kembang api',
  'Countdown 60 detik berbentuk timer digital dengan milidetik berjalan',
  'Stopwatch digital yang berjalan dari 00:00 dengan cincin detik',
  'Jam pasir bergaya geometris, butiran titik jatuh dari atas ke bawah',
  'Jam analog minimalis dengan jarum yang berputar cepat (time lapse)',
  'Loading bar futuristik dari 0 sampai 100 persen dengan efek HUD',
  'Lingkaran loading berputar minimalis, loop mulus',
  'Persentase melingkar yang terisi dari 0 sampai 100 dengan angka di tengah',
  'Layar download file dengan progress bar dan kecepatan transfer yang berubah',
  'Layar boot sistem komputer fiksi dengan baris status yang muncul berurutan',
  'Animasi pemindaian sidik jari bergaya garis dengan garis scan naik turun',
  'Kunci gembok digital yang terbuka, tema keamanan siber',
  'Kolom pencarian dengan kursor mengetik dan hasil muncul berupa blok abu-abu',
  'Layar HUD sci-fi dengan radar berputar dan panel data bergerak',
  'Radar sonar hijau dengan titik target yang muncul dan memudar',
  'Hujan kode digital jatuh vertikal dengan karakter acak, loop',
  'Papan sirkuit dengan aliran cahaya berjalan di jalur-jalurnya',
  'Jaringan titik data yang saling terhubung (plexus), melayang pelan',
  'Bola dunia dari titik-titik yang berputar dengan garis koneksi melengkung',
  'Peta dunia titik-titik dengan garis koneksi yang menyala bergantian',
  'Terowongan garis neon yang bergerak maju tanpa henti',
  'Lantai grid retro tahun 80-an dengan matahari garis-garis (synthwave)',
  'Gelombang titik 3D seperti permukaan laut digital',
  'Jaringan saraf tiruan: lapisan node dengan sinyal berjalan antar node',
  'Rantai blok (blockchain) berupa kubus garis yang tersambung satu per satu',
  'Gelombang suara equalizer batang yang bergerak naik turun, loop',
  'Bentuk gelombang audio melingkar yang berdenyut',
  'Detak jantung EKG garis hijau berjalan di layar monitor medis',
  'Untai DNA heliks ganda dari titik dan garis yang berputar',
  'Model atom dengan elektron mengorbit inti',
  'Tata surya sederhana: planet mengorbit matahari dengan jejak orbit',
  'Grafik batang naik yang tumbuh satu per satu, gaya infografis bisnis',
  'Grafik garis saham yang bergerak naik dengan area gradasi di bawahnya',
  'Grafik candlestick trading yang terbentuk dari kiri ke kanan',
  'Diagram lingkaran yang terisi per bagian dengan persentase',
  'Dashboard data dengan beberapa grafik dan angka yang terus berubah',
  'Panah pertumbuhan naik melewati batang grafik, latar gelap elegan',
  'Angka penghitung naik cepat dari 0 sampai 1.000.000',
  'Partikel debu emas yang naik perlahan dengan kilau lembut',
  'Bokeh lampu warna-warni yang melayang lembut, loop',
  'Gradasi warna cair yang bergerak halus, latar presentasi',
  'Pita cahaya sutra yang mengalir dan saling bertumpuk',
  'Garis gelombang tipis berlapis bergerak pelan, latar korporat biru',
  'Kisi heksagon yang menyala bergantian',
  'Pola segitiga low poly yang berubah warna perlahan',
  'Lingkaran konsentris yang berdenyut seperti riak air',
  'Garis kecepatan cahaya memancar dari tengah (warp speed)',
  'Langit berbintang dengan bintang berkelip dan sesekali bintang jatuh',
  'Aurora lembut yang menari di langit malam',
  'Pola geometris gaya Memphis warna pastel yang bergerak ceria',
  'Spiral hipnotis hitam putih yang berputar, loop',
  'Kaleidoskop bentuk geometris simetris yang terus berubah',
  'Tirai kilau glitter emas berkelip, latar acara penghargaan',
  'Sinar lampu sorot panggung yang menyapu kiri kanan',
  'Kembang api warna-warni meledak di langit malam',
  'Confetti warna-warni berjatuhan, latar perayaan',
  'Salju turun perlahan dengan kepingan salju geometris, latar biru malam',
  'Hati-hati kecil melayang naik, latar merah muda untuk Valentine',
  'Balon warna-warni naik perlahan, tema ulang tahun',
  'Lentera dan bintang bulan sabit bergaya geometris, tema Ramadan',
  'Daun-daun gugur bergaya bentuk sederhana, warna musim gugur',
  'Hujan turun dengan percikan riak di permukaan, suasana malam',
  'Transisi bentuk cair warna-warni menyapu layar dari kiri ke kanan',
  'Transisi garis-garis diagonal menutup lalu membuka layar',
  'Bingkai lower third kosong yang muncul dan menghilang dengan animasi garis',
  'Efek glitch layar TV rusak dengan garis noise dan pergeseran warna',
  'Layar TV tanpa sinyal: garis warna dan noise statis',
];

// Category numbers used by the Adobe Stock upload CSV.
export const CATEGORIES = {
  1: 'Animals', 2: 'Buildings and Architecture', 3: 'Business', 4: 'Drinks',
  5: 'The Environment', 6: 'States of Mind', 7: 'Food', 8: 'Graphic Resources',
  9: 'Hobbies and Leisure', 10: 'Industry', 11: 'Landscapes', 12: 'Lifestyle',
  13: 'People', 14: 'Plants and Flowers', 15: 'Culture and Religion', 16: 'Science',
  17: 'Social Issues', 18: 'Sports', 19: 'Technology', 20: 'Transport', 21: 'Travel',
};
export const DEFAULT_CATEGORY = 8;

export function buildStockCsv(fileName, meta) {
  return stockCsvText([
    {
      Filename: fileName,
      Title: (meta.title || '').slice(0, 200),
      Keywords: meta.keywords.slice(0, 49).join(', '),
      Category: meta.category || DEFAULT_CATEGORY,
      Releases: '',
    },
  ]);
}

export function buildPrompt(idea) {
  const concept =
    idea.trim() ||
    'Surprise me - pick one concept that sells well as stock footage (for example a stylish countdown, a tech HUD, an elegant particle background, a data visualization) and execute it beautifully.';
  return `You are a senior motion designer and creative coder. Create ONE animated stock-footage clip (it will be sold on Adobe Stock), written as JavaScript for the HTML5 Canvas 2D API.

CONCEPT: ${concept}

CONCEPT PRIORITY: The CONCEPT is authoritative for subject, composition, density, style and decoration. It overrides every default below when the two conflict. Obey explicit exclusions even when a later quality rule suggests adding or filling something. Only the technical output format, required function signatures and runtime restrictions are non-negotiable.

You are the art director: choose the style, color palette, composition and pacing that make this concept look as premium and commercially useful as possible. If the concept is short or vague, make a strong creative decision yourself - do not ask me questions.

OUTPUT FORMAT - reply with exactly ONE \`\`\`javascript code block and nothing else, using this skeleton:

// TITLE: <descriptive English stock title, max 70 characters>
// KEYWORDS: <exactly 48 relevant English keywords, comma separated, most important first, no duplicates>
// CATEGORY: <one number from the category list below>
// DURATION: <clip length in whole seconds: 10, 11 or 12 only>
// LOOP: <yes or no>

function setup(env) {
  // runs once: pre-generate all random data here (particles, positions, sizes, colors)
  return { /* state */ };
}

function draw(ctx, t, env) {
  // draws ONE frame at time t (seconds)
}

CATEGORY LIST (Adobe Stock): ${Object.entries(CATEGORIES).map(([n, name]) => `${n} ${name}`).join(', ')}. Use 8 for abstract backgrounds and generic motion graphics.

TECHNICAL RULES (strict):
1. The canvas is always 1920x1080 logical units (env.width, env.height). The host upscales to 4K by itself - never resize the canvas, never use devicePixelRatio.
2. env = { width, height, duration, fps, frame, progress, state }. duration = clip length in seconds (the DURATION you declared), progress = t / duration (0 to 1), state = whatever setup() returned.
3. draw() must be a PURE function of t: the same t always gives the same picture. No variables that accumulate between frames, no trails that depend on the previous frame. Compute every position directly from t / env.progress.
4. TIMING - decide from the concept:
   - Backgrounds, ambient scenes and patterns: LOOP: yes. The frame at t = env.duration must be identical to the frame at t = 0. Drive motion with env.progress * Math.PI * 2 * (an integer) inside sin/cos, or move things by a whole number of wrap-around cycles using modulo.
   - Sequences with a beginning and an end (countdowns, timers, intros, reveals, loading or progress bars, charts): LOOP: no. Animate from t = 0 to t = env.duration and end on a clean final frame. For a countdown, show each number for exactly 1 second and fit it inside the allowed length (for example 10 down to 1 in 10 seconds); if the concept asks for a longer or shorter count, adapt it so the clip still lasts 10 to 12 seconds.
   - DURATION is mandatory and must be 10, 11 or 12 seconds for every clip. Never shorter than 10, never longer than 12. Pace the whole animation to fill that length.
5. Math.random() may only be used inside setup(). Never inside draw().
6. Forbidden: requestAnimationFrame, setTimeout, setInterval, Date, performance.now, window, document, DOM, HTML, CSS, images, external fonts or libraries, fetch, getImageData, putImageData.
7. Paint the whole background first on every frame.
8. TEXT: numbers and text are allowed only when the concept needs them (countdown digits, timers, percentages, generic words such as "LOADING"). Use ctx.font with these system fonts only: Arial, 'Arial Black', 'Segoe UI', 'Trebuchet MS', Verdana, Impact, Georgia, 'Times New Roman', 'Courier New', and for a friendly handwritten look 'Comic Sans MS' or 'Segoe Print' (always end the stack with sans-serif, serif or monospace). Set textAlign and textBaseline explicitly. Never draw logos, brand names, watermarks, flags, real people or copyrighted characters.
9. Keep it reasonably fast: avoid ctx.filter, and never use shadowBlur on hundreds of small elements (soft shadows on up to ~15 main objects are fine and encouraged).
10. OBJECTS: when the concept contains real-world objects (paper note, push pin, magnifying glass, calendar, phone, envelope, clock, coin, folder, icons...), make them look tangible, not flat:
   - build each object from several layered shapes, and use new Path2D('<SVG path data>') for outlines that need accurate curves;
   - give every object a soft drop shadow (shadowColor rgba(0,0,0,0.25-0.45), shadowBlur 20-60, shadowOffsetY 8-30) so it floats above the layer below;
   - add volume with linear/radial gradients instead of flat fills, plus a thin highlight edge and a darker inner edge;
   - add small believable details (paper corner curl, glass reflection, metal rim, subtle texture lines);
   - animate objects like physical things: slide or drop in with overshoot, slight rotation, settle, and let shadows move with them.
   Only attempt objects that can be built convincingly from clean shapes; simplify anything else into a stylized icon rather than a detailed illustration.

VISUAL QUALITY: premium and polished. Pick the look that fits the concept - glowing and cinematic for tech or abstract scenes, clean and tactile (soft shadows, paper, glass, friendly colors) for object-based explainer scenes. Build real depth with background, middle and foreground layers, rich gradients, varied sizes and opacities, smooth easing (ease-in-out, overshoot, staggered timing). Unless the CONCEPT explicitly restricts them, you may use a subtle vignette, secondary motion and small details. Draw only elements that carry meaning for the CONCEPT; do not add ambient particles, decorative dots, framing bars, vignettes, glows, ribbons, background ornaments or other decoration unless the CONCEPT asks for them. Do not fill negative space that the CONCEPT reserves. It must look like professional motion graphics, not a coding demo.

SEQUENCE DESIGN: Before coding, plan the actual causal handoffs in short internal steps: what the viewer sees, what action changes it, which object carries forward, and when the result becomes readable. Do not print this plan. Choose timings from the actions rather than dividing the duration into equal icon slides. Keep one dominant focal object. Preserve its identity and anchor during a handoff; draw each persistent object exactly once per frame. A selected product must move into the cart, not remain as a duplicate while another copy moves. A route, if requested, must visibly track the same journey rather than sit behind unrelated panels.

CONTINUITY: Transform persistent containers and carry meaningful objects between steps. Do not force unrelated symbols to morph. Where contents genuinely change, use a short, directed overlapping transition in the same container, with outgoing and incoming weights 1-u and u for the SAME eased u. Never fade the whole scene to zero between steps. Position interpolation must reach the exact endpoint that the next segment starts from. Each temporary layer needs explicit entrance, readable hold and exit times. A processing state must visibly progress and disappear when confirmation takes over. Reserve a readable final hold without a decorative halo or pulse unless requested.

HANDOFF GEOMETRY: Define one absolute anchor for each persistent container and reuse it on both sides of every transition. Compute one normalized handoff u per boundary, then derive outgoing and incoming positions from the same endpoint pair; never use separate pre-boundary and post-boundary offsets that change sign when the integer stage changes. Do not add a second position jump after stage selection. At a boundary, the last outgoing frame and first incoming frame must share the same anchor, size and baseline unless the brief explicitly asks for a move. If a panel stays persistent, draw its shell once and crossfade only its contents.

TRANSITION INTEGRITY: Each meaningful object may be drawn at most once per frame. Never draw the same object once with alpha (1-u) and again with alpha 1; that creates a brightness flash and ghost edge. Never render a helper before its intended translate/transform, especially at the canvas origin. Every helper must receive its absolute anchor or be called inside one explicit save/translate/restore block. At every stage boundary, test the frame immediately before, the boundary frame, and the frame immediately after: no object may jump to (0,0), be clipped by the canvas edge, duplicate, reverse direction, or change size/alpha discontinuously. Use one persistent panel shell; stage content must be mutually exclusive except for the deliberate outgoing/incoming pair during one handoff.

CHECKOUT FLOW: For an online checkout, use a single causal order such as browse product → cart review → address/shipping → payment → processing → package/order confirmation. Do not alternate address and payment repeatedly, and do not introduce a success/package state before processing has completed. Keep the cart, payment card, spinner and package as distinct readable symbols; connect them through the same panel and route rather than drawing unrelated copies at the same anchor.

CANVAS OPACITY CONTRACT: Every reusable drawing helper must preserve inherited opacity. Inside save()/restore(), apply local opacity with ctx.globalAlpha *= alpha, NEVER ctx.globalAlpha = alpha. Pass opacity once at the group level and use local alpha 1 for its children; do not apply the same fade twice. Skip drawing a group whose alpha is zero. Check that future panel backgrounds are invisible at t=0, transition midpoints have a readable focal object, old content has exited after each handoff, and only the intended final state remains at the end. These checks are necessary but do not substitute for visual flow review.

PURPOSE CHECK: Every shape, shadow, accent and movement must represent a requested object, hierarchy or causal action. Prefer a few recognizable objects over stacks of anonymous cards and placeholder bars. Use shadow only to explain elevation during an interaction, not on every object. Honor the concept's palette and reserved negative space. Remove decoration that cannot be tied to the concept.`;
}

export function buildFixPrompt(message) {
  return `The code fails in my renderer with this error:

${message}

Fix it and send the complete corrected code again as ONE javascript code block. Keep the exact same format and rules (header comments, setup(env) + draw(ctx, t, env), pure function of t, no DOM, no requestAnimationFrame).`;
}
