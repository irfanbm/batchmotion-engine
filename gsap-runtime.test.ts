import assert from 'node:assert/strict';
import { ensureGsapRuntime, hasGsapRuntime, stripGsapRuntime } from './gsap-runtime';
import { validateHtml } from './validation';

const head = (body: string) => `<!DOCTYPE html><html><head><style>body{}</style></head><body>${body}</body></html>`;

// injects the vendored source once, as the first element of head, with the license banner
const withRuntime = ensureGsapRuntime(head('<script>window.__MOTIONFORGE_READY__=true;</script>'));
assert.ok(hasGsapRuntime(withRuntime));
assert.ok(withRuntime.includes('@license'), 'GSAP license banner must survive injection');
assert.ok(withRuntime.includes('/*batchmotion:gsap*/'), 'injected script must carry the host marker');
const firstScript = withRuntime.indexOf('<script id="batchmotion-gsap">');
const styleIndex = withRuntime.indexOf('<style>');
assert.ok(firstScript >= 0 && firstScript < styleIndex, 'runtime loads before any scene content');

// idempotent: a second ensure produces the identical document
assert.equal(ensureGsapRuntime(withRuntime), withRuntime, 'ensure must be idempotent');

// strip removes every injected copy, even after tampering
assert.equal(hasGsapRuntime(stripGsapRuntime(withRuntime)), false);
const duplicated = withRuntime.replace('</head>', `<script id="batchmotion-gsap">/*batchmotion:gsap*/fake</script></head>`);
assert.equal(hasGsapRuntime(stripGsapRuntime(duplicated)), false, 'duplicate injected scripts are stripped too');

// missing head is a hard error, never a silent no-op
assert.throws(() => ensureGsapRuntime('<html><body></body></html>'), /missing head/);

// the file never loads remote assets or network APIs through the runtime
assert.equal(/src\s*=/.test(withRuntime.slice(0, firstScript + 64)), false);

// validation: GSAP contract enforcement is opt-in and independent of the injected tag
const gsapContract = `<!DOCTYPE html><html><head><style>x</style></head><body><script>
gsap.defaults({ lazy: false });
const tl = gsap.timeline({ paused: true });
function applyFrame(seconds){ tl.seek(seconds, false); }
window.addEventListener('motionforge:frame', (e) => applyFrame(e.detail));
window.__MOTIONFORGE_OBJECTS__ = [];
window.__MOTIONFORGE_READY__ = true;
</script></body></html>`;
assert.ok(!validateHtml(gsapContract, false, { requireGsap: true }).some((x) => x.startsWith('GSAP contract')));
assert.ok(validateHtml(gsapContract.replace('gsap.timeline({ paused: true });', 'const tl = {};'), false, { requireGsap: true }).some((x) => x.includes('paused gsap.timeline()')));
assert.ok(validateHtml(gsapContract.replace("window.addEventListener('motionforge:frame', (e) => applyFrame(e.detail));", ''), false, { requireGsap: true }).some((x) => x.includes('motionforge:frame seek listener')));
assert.ok(validateHtml(gsapContract.replace('.seek(seconds, false)', '.time(seconds)'), false, { requireGsap: true }).some((x) => x.includes('timeline seek per frame')));
// legacy scenes without the option still validate exactly as before
assert.ok(!validateHtml(gsapContract).some((x) => x.startsWith('GSAP contract')));
console.log('gsap runtime checks passed');
