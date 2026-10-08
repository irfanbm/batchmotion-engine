import assert from 'node:assert/strict';
import { QueueService } from './queue';
import type { Job } from './types';

const store = {
  history: async () => [],
  queue: async () => [],
  saveQueue: async () => {},
  saveHistory: async () => {},
};
const queue = new QueueService(() => {}, store, { userData: 'x' });
const previewJob = () =>
  ({ id: 'j1', prompt: 't', seed: 1, status: 'preview', progress: 10, duration: 8, width: 1920, height: 1080, createdAt: '' }) as Job;
(queue.jobs as Job[]).push(previewJob());
assert.throws(() => queue.approvePreview('missing'), /awaiting preview approval/);
assert.throws(() => queue.revisePreview('j1', '   '), /revision note is required/);
assert.throws(() => queue.remakePreview('j1'), /awaiting preview approval/, 'remake on a missing waiter fails closed');
queue.remove(['j1']);
assert.equal(queue.jobs.length, 0, 'a preview job deletes cleanly');
assert.throws(() => queue.approvePreview('j1'), /awaiting preview approval/);
console.log('preview approval checks passed');
