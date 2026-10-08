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
console.log('preview approval checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
