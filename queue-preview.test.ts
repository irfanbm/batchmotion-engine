import assert from 'node:assert/strict';
import { QueueService } from './queue';
import type { Job, Settings } from './types';

void (async () => {
const store = {
  history: async () => [],
  queue: async () => [],
  saveQueue: async () => {},
  saveHistory: async () => {},
};
const settings = {} as Settings;
const queue = new QueueService(() => {}, store, { userData: 'x' });
const previewJob = () =>
  ({ id: 'j1', prompt: 't', seed: 1, status: 'preview', progress: 10, duration: 8, width: 1920, height: 1080, createdAt: '' }) as Job;
(queue.jobs as Job[]).push(previewJob());
await assert.rejects(() => queue.approvePreview('missing', settings), /not awaiting preview approval/);
await assert.rejects(() => queue.revisePreview('j1', '   ', settings), /revision note is required/);
await assert.rejects(
  () => queue.revisePreview('j1', 'make it blue', settings),
  /need a blueprint job/,
  'revise without a blueprint fails before spending AI calls',
);
await assert.rejects(() => queue.remakePreview('j1', settings), /need a blueprint job/);
queue.remove(['j1']);
assert.equal(queue.jobs.length, 0, 'a preview job deletes cleanly');
await assert.rejects(() => queue.approvePreview('j1', settings), /not awaiting preview approval/);
await assert.rejects(() => queue.renderSelected([], settings), /No jobs selected/);
(queue.jobs as Job[]).push(
  { ...previewJob(), id: 'j2' },
  { ...previewJob(), id: 'j3', status: 'rendering' },
);
await assert.rejects(
  () => queue.renderSelected(['j2'], settings),
  /already running/,
  'a parked job waits while another render is active, but not while others prepare',
);
{
  const q2 = new QueueService(() => {}, store, { userData: 'x' });
  const mk = (id: string, prompt: string) =>
    ({ id, prompt, seed: 1, status: 'queued', progress: 50, duration: 8, width: 1920, height: 1080, createdAt: '' }) as Job;
  (q2.jobs as Job[]).push(
    mk('b1', 'a red balloon'),
    mk('b2', 'Main Subject; Style; Composition; Colors; Motion; Atmosphere; Avoid'),
    mk('b3', 'a blue boat'),
  );
  let calls = 0;
  const beautify = async (prompt: string) => {
    calls++;
    if (prompt === 'a blue boat') throw new Error('provider down');
    return { mainSubject: prompt, styleUseCase: 's', composition: 'c', colorsMaterials: 'c', motion: 'm', atmosphere: 'a', avoid: 'x' };
  };
  const result = await q2.beautifyJobs(['b1', 'b2', 'b3'], beautify);
  assert.equal(calls, 2, 'already-structured prompts skip the provider call');
  assert.deepEqual(result, { beautified: 1, kept: 2 }, 'one beautified, one skipped, one failed-kept');
  assert.match((q2.jobs as Job[])[0].prompt, /a red balloon/, 'beautified prompt keeps its content');
  assert.equal((q2.jobs as Job[])[2].prompt, 'a blue boat', 'a failed item keeps its original prompt');
  console.log('beautify queue checks passed');
}
console.log('preview approval checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
