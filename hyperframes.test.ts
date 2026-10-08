import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildLintArgs,
  buildRenderArgs,
  hyperframesBin,
  parseLintResult,
  parseProgressLine,
  stageHyperframesComposition,
  validateHyperframesComposition,
  withElectronRetry,
} from './hyperframes';

assert.deepEqual(buildLintArgs('/proj'), ['lint', '/proj']);
assert.deepEqual(parseLintResult(0, 'Lint\n  0 error(s), 1 warning(s)\nCheck passed'), []);
assert.ok(parseLintResult(1, 'Lint\n  2 error(s)\n  x clip without data-start\ny missing timeline').some((x) => x.includes('missing timeline')), 'lint errors surface for the repair loop');
assert.ok(parseLintResult(null, '').length === 1, 'a signaled lint run still reports');
assert.deepEqual(
  buildRenderArgs({ projectDir: '/p', output: '/p/job.mp4', fps: 30, alpha: false }),
  ['render', '/p', '-o', '/p/job.mp4', '--fps', '30', '--quality', 'looks', '--workers', '4'],
);
assert.ok(buildRenderArgs({ projectDir: '/p', output: '/p/j.mov', fps: 30, alpha: true }).includes('mov'), 'alpha renders take the MOV path');
assert.equal(parseProgressLine('@hf-progress {"code":"capture","pct":42}'), 42);
assert.equal(parseProgressLine('[INFO] something else'), null);
assert.equal(parseProgressLine('@hf-progress {"code":"x","pct":140}'), 100, 'progress clamps');
{
  const bin = hyperframesBin();
  assert.equal(bin.cmd, process.execPath, 'the bundled CLI spawns under node, never npx');
  assert.ok(bin.prefix[0].endsWith('hyperframes.mjs'), 'the bin entry resolves inside the package');
  assert.ok(fs.existsSync(bin.prefix[0]), 'the resolved bin file exists');
}

const hfHtml = '<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body><div id="root"></div><script>window.__MOTIONFORGE_OBJECTS__=[{id:\'a\',role:\'subject\'}];window.__timelines={};</script></body></html>';
assert.deepEqual(validateHyperframesComposition(hfHtml, false), [], 'a minimal HF composition passes static validation');
assert.ok(validateHyperframesComposition(hfHtml.replace("'subject'", "'hero'"), false).some((x) => x.includes("unknown role 'hero'")), 'metadata roles still enforced on the HF path');

void (async () => {
  {
    let calls = 0;
    const logged: string[] = [];
    const result = await withElectronRetry('op', (l) => logged.push(l), async () => {
      calls++;
      if (calls === 1) throw new Error('');
      return 'recovered';
    });
    assert.equal(result, 'recovered', 'a flaky Electron op recovers on retry');
    assert.equal(calls, 2, 'exactly one retry');
    assert.ok(logged.some((l) => l.includes('retrying once')), 'the retry is logged');
    await assert.rejects(
      () => withElectronRetry('op', () => {}, async () => { throw new Error('nope'); }),
      /nope/,
      'a twice-failing op still throws',
    );
  }
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hf-stage-'));
  try {
    const { dir, index } = await stageHyperframesComposition(tmpDir, 'job-1', hfHtml);
    const saved = await fs.promises.readFile(index, 'utf8');
    assert.ok(!saved.includes('batchmotion-gsap'), 'staging stays raw: lint must grade authored code, not the vendored runtime');
    assert.ok(saved.includes('window.__MOTIONFORGE_OBJECTS__'), 'metadata survives staging');
    assert.ok(dir.endsWith('.hf-job-1'), 'one project dir per job');
    assert.ok(fs.existsSync(path.join(dir, 'gsap.min.js')), 'the vendored GSAP file stages next to the composition');
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
  console.log('hyperframes checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
