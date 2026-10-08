import assert from 'node:assert/strict';
import { generateBlueprint, generateHtmlFromBlueprint } from './ai';
import { blueprintQualityGate } from './blueprint';
import type { Settings } from './types';

const hero = {
  id: 'rocket', role: 'hero', shape: 'Closed solid cylindrical booster and ogive nose',
  details: ['Continuous filled hull', 'Paired attached fins', 'Bell nozzle below hull'],
  material: { name: 'metallic', construction: 'One broad key light across the filled hull' },
  rect: { x: 0.5, y: 0.3, w: 0.15, h: 0.45 }, zIndex: 2, opacity: 1,
  functionalRole: 'Launches under thrust',
  geometry: { silhouette: 'Filled closed contour with a rounded nose and parallel body walls', aspectRatio: 0.25,
    parts: [{ name: 'body', rect: { x: 0.2, y: 0, w: 0.6, h: 0.9 } },
      { name: 'fins', rect: { x: 0.05, y: 0.7, w: 0.9, h: 0.2 } },
      { name: 'nozzle', rect: { x: 0.35, y: 0.9, w: 0.3, h: 0.1 } }],
    attachment: 'Nozzle center coincides with hull centerline; both share one transform' },
};
const valid = {
  concept: 'Rocket launching at dawn', commercialIntent: 'Aerospace innovation footage',
  visualMetaphor: 'Progress through thrust', visualHook: 'Ignition lights the launch pad',
  signatureMotion: 'Ignition builds pressure then the rocket accelerates upward', visualPayoff: 'Rocket clears the skyline',
  style: 'Technical illustration', palette: { base: '#10243c', primary: '#f1eee5', secondary: '#e7a04a', accent: '#3c82b5' },
  heroObjectId: 'rocket', objects: [hero, { ...hero, id: 'pad', role: 'support', functionalRole: 'Supports the rocket before ignition' }],
  composition: [], choreography: [{ from: 0, to: 6, objectId: 'rocket', property: 'translate-y', fromValue: '0', toValue: '-240',
    easing: 'ease-in', trigger: 'Engine ignition', reaction: 'Vehicle accelerates upward' }],
  loop: { durationSec: 6, fps: 30, returnMechanism: 'Finite forward launch with final view' },
  background: 'Dawn city silhouette',
};
const settings = { baseUrl: 'https://provider.invalid/v1', model: 'test', apiKey: 'test-only',
  duration: 6, fps: 30, width: 1280, height: 720, looping: false, outputFormat: 'mp4-h264' } as Settings;

void (async () => {
  const realFetch = globalThis.fetch;
  const requests: { messages: { content: string }[] }[] = [];
  const responses: unknown[] = [{ palette: { base: { hex: '#10243c' } } }, valid, '<!DOCTYPE html><html>test output</html>'];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const next = responses.shift();
    const content = typeof next === 'string' ? next : JSON.stringify(next);
    // The pipeline streams, so the stub must speak Server-Sent Events too.
    return new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
      'data: [DONE]',
      '',
    ].join('\n'), { status: 200 });
  };
  try {
    const blueprint = await generateBlueprint(settings, 'Rocket launch', 417);
    assert.equal(requests.length, 2, 'malformed director response gets a bounded correction request');
    assert.deepEqual(blueprintQualityGate(blueprint), []);
    assert.equal(blueprint.loop.enabled, false);
    assert.match(requests[0].messages[1].content, /"\$schema"/);
    assert.match(requests[1].messages[1].content, /Correct this previous blueprint/);
    await generateHtmlFromBlueprint(settings, blueprint, 417, undefined, {
      html: 'old-scene',
      errors: [
        'nozzle detached',
        'stage contrast quality gate: subject and stage background contrast is 1.80, below the required 2.5 (measured content ~#a7a399 on ground #c4c0b8)',
        'text legibility quality gate: title: contrast 2.40 below 4.5 (text #f0ede6 on #e8e4da, 18px)',
        'subject bounds quality gate: t=6.000s shopping-cart clipped px L0.0 T0.0 R978.6 B0.0',
        'black slab quality gate: pure-black mass covers 17.8% of the stage, above the allowed 8%',
      ],
    });
    const coder = requests[2].messages.map(m => m.content).join('\n');
    assert.match(coder, /GEOMETRY LOCK/);
    assert.match(coder, /SEED=417/);
    assert.match(coder, /FINITE clip/);
    assert.match(coder, /nozzle detached/);
    assert.match(coder, /old-scene/);
    assert.match(coder, /STAGE QUALITY CONTRACT/, 'the measured stage floors ride along on every coder render');
    assert.match(coder, /at least 2\.5:1 luminance contrast against the stage background/);
    assert.match(coder, /covering at least 10% of the stage area/, 'the opening frame may not be empty');
    assert.match(coder, /hidden at t=0 must declare visibleFrom/, 'delayed entrances declare themselves up front');
    assert.match(coder, /near-black #101014 instead of pure #000000/);
    assert.match(coder, /rim light and grounded contact shadow/, 'contrast failures steer toward lighting the subject');
    assert.match(coder, /straddle the ramp/, 'contrast repairs pair tones from opposite ramp halves');
    assert.match(coder, /set the stage ground to #101014/, 'contrast repairs carry an exact computed hex');
    assert.match(coder, /translucent or frosted subject/, 'translucent subjects get the outline-and-accents recipe');
    assert.match(coder, /measured pair \(content ~#XXXXXX on ground #YYYYYY/, 'contrast steering points at the measured hex pair');
    assert.match(coder, /raise small labels to at least 12px/, 'text failures steer toward readable type');
    assert.match(coder, /both hexes dark.*white #FFFFFF text/, 'text repairs swap ramp sides instead of nudging');
    assert.match(coder, /Palette preservation does NOT apply to text colors/, 'text repairs may break the palette');
    assert.match(coder, /Badge discipline:/, 'badges stay parented to their subject and in-frame');
    assert.match(coder, /settled endcard/, 'the final frame must compose as an endcard');
    assert.match(coder, /declare its visibleUntil|declare visibleUntil/, 'bound rejections steer toward declared exits');
    assert.match(coder, /WRAPPER box/, 'bounds repairs measure the wrapper, not the glyph');
    assert.match(coder, /visible subject tightly/, 'bounds repairs forbid stage-filling subject wrappers');
    assert.match(coder, /only the roles subject, support, and background/, 'repairs ban invented metadata roles');
    assert.match(coder, /allowCrop:true/, 'edge-crossing effects steer toward an allowCrop declaration');
    assert.match(coder, /Text paint:/, 'the contract pins text onto solid opaque chips');
    assert.match(coder, /fully opaque solid background chip/, 'text repairs name the solid-chip fix');
    assert.match(coder, /set "title" to #101014/, 'text repairs carry an exact computed hex');
    assert.match(coder, /replace every pure #000000 fill/, 'black slabs steer toward near-black tones');
    assert.doesNotMatch(coder, /STUDIO SPLIT LAYOUT CONTRACT/);
    assert.doesNotMatch(coder, /SEED = 123456789|Never start a requestAnimationFrame/);

    responses.push('<!DOCTYPE html><html>split output</html>');
    await generateHtmlFromBlueprint(settings, blueprint, 417, undefined, undefined, undefined, true);
    const splitCoder = requests[3].messages.map(m => m.content).join('\n');
    assert.match(splitCoder, /STUDIO SPLIT LAYOUT CONTRACT/);
    assert.match(splitCoder, /id="split-film"/);
    assert.match(splitCoder, /split-playhead/);
    assert.match(splitCoder, /draft-0, draft-1, draft-2, draft-3/);
    assert.match(splitCoder, /1\.5s to 3s/, 'quarter boundaries are derived from the job duration');
    assert.match(splitCoder, /IN THE INITIAL MARKUP/, 'card 0 starts active in markup, not in a set at time 0');
    assert.match(splitCoder, /never switch the cards with tl\.call callbacks/, 'callback switches are banned: seek-order dependent');
    assert.match(splitCoder, /fully inside the stage by t=0\.5s/, 'film stage may not open empty');
    assert.match(splitCoder, /never clipped by the stage's top edge/, 'hero clipping at the stage bounds is called out');
    assert.match(splitCoder, /Never list layout chrome in window\.__MOTIONFORGE_OBJECTS__/, 'the stage container never becomes a gated object');
    assert.match(splitCoder, /the row's left edge/, 'playhead track is anchored to the card row bounds');
    assert.match(splitCoder, /never from the viewport width/, 'track travel must not come from the viewport');
    assert.match(splitCoder, /STAGE QUALITY CONTRACT/, 'the split film stage keeps the same measured floors');
    assert.match(splitCoder, /the stage is #split-film \(the top 64% of the viewport\)/);
    assert.doesNotMatch(splitCoder, /NullMotion/, 'disguised naming stays out of the prompt');

    responses.push('<!DOCTYPE html><html>hyperframes output</html>');
    await generateHtmlFromBlueprint(settings, blueprint, 417, undefined, undefined, undefined, false, true);
    const hfCoder = requests[4].messages.map(m => m.content).join('\n');
    assert.match(hfCoder, /HYPERFRAMES COMPOSITION CONTRACT/, 'the HF engine mode carries its own runtime shape');
    assert.match(hfCoder, /data-composition-id="main"/, 'the composition id is pinned for the harness');
    assert.match(hfCoder, /window\.__timelines\["main"\]/, 'one paused timeline registers under the composition id');
    assert.match(hfCoder, /window\.__timelines = window\.__timelines \|\| {};/, 'the registry guard keeps Electron preflight working');
    assert.match(hfCoder, /window\.__MOTIONFORGE_OBJECTS__ = \[\{ id: 'primary-subject'/, 'metadata opens the script as a global assignment');
    assert.match(hfCoder, /STAGE QUALITY CONTRACT/, 'the measured stage floors ride along in HF mode too');
    assert.match(hfCoder, /<script src="gsap\.min\.js"><\/script>/, 'GSAP arrives only via the host-staged file, never CDN');
    assert.match(hfCoder, /linear -> none, ease-in -> power2\.in/, 'easing spellings are deterministic GSAP names');
    assert.doesNotMatch(hfCoder, /motionforge:frame/, 'no MotionForge clock leaks into the HF composition prompt');
    assert.doesNotMatch(hfCoder, /FINAL MANDATORY CHECK/, 'the GSAP skeleton append is skipped for HF prompts');
    assert.doesNotMatch(hfCoder, /STUDIO SPLIT LAYOUT CONTRACT/, 'HF film is plain, no draft strip');

    responses.push('<!DOCTYPE html><html>endcard repair</html>');
    await generateHtmlFromBlueprint(settings, blueprint, 417, undefined, {
      html: 'old-scene',
      errors: ['subject bounds quality gate: t=7.992s primary-subject clipped px L0.0 T131.2 R0.0 B0.0'],
    });
    const endcardCoder = requests[5].messages.map(m => m.content).join('\n');
    assert.match(endcardCoder, /failure is in the FINAL FRAME/, 'endcard clips steer toward a settled final frame');
    assert.doesNotMatch(coder, /failure is in the FINAL FRAME/, 'mid-clip bounds errors get no endcard lecture');

    requests.length = 0;
    responses.push({}, {}, {});
    await assert.rejects(() => generateBlueprint(settings, 'Rocket', 417), /Blueprint quality gate failed/);
    assert.equal(requests.length, 3, 'invalid blueprint never escapes as fabricated geometry');
    console.log('blueprint pipeline checks passed');
  } finally { globalThis.fetch = realFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
