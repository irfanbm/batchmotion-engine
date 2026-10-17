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

VISUAL QUALITY: premium and polished. Pick the look that fits the concept - glowing and cinematic for tech or abstract scenes, clean and tactile (soft shadows, paper, glass, friendly colors) for object-based explainer scenes. Build real depth with background, middle and foreground layers, rich gradients, varied sizes and opacities, smooth easing (ease-in-out, overshoot, staggered timing) and a subtle vignette. Add secondary motion and small details so every second stays interesting. Fill the whole 16:9 frame with a balanced composition. It must look like professional motion graphics, not a coding demo.`;
}

export function buildFixPrompt(message) {
  return `The code fails in my renderer with this error:

${message}

Fix it and send the complete corrected code again as ONE javascript code block. Keep the exact same format and rules (header comments, setup(env) + draw(ctx, t, env), pure function of t, no DOM, no requestAnimationFrame).`;
}
