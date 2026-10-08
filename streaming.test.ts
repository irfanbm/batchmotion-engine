import assert from 'node:assert/strict';
import { readSseContent } from './ai';

const sse = (lines: string[]) => new Response(lines.join('\n'), { status: 200 });
const delta = (content: string, finish?: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content }, ...(finish ? { finish_reason: finish } : {}) }] })}`;

void (async () => {
  // Chunks are concatenated in order; [DONE] and blank lines are ignored.
  assert.equal(
    await readSseContent(sse([delta('<!DOCTYPE '), delta('html>'), '', delta('done', 'stop'), 'data: [DONE]', ''])),
    '<!DOCTYPE html>done',
  );

  // A truncated generation must fail loudly instead of yielding half a document.
  await assert.rejects(
    () => readSseContent(sse([delta('<!DOCTYPE html><body>'), delta('cut', 'length')])),
    /cut off \(finish_reason=length\)/,
  );

  // Provider-side stream errors surface as errors, not silent empty output.
  await assert.rejects(
    () => readSseContent(sse([delta('partial'), `data: ${JSON.stringify({ error: { message: 'model overloaded' } })}`])),
    /model overloaded/,
  );

  // Empty stream and malformed JSON payloads are rejected, not returned as "".
  await assert.rejects(() => readSseContent(sse(['data: [DONE]'])), /empty response/);
  await assert.rejects(() => readSseContent(sse(['data: {not json'])), /empty response/);
  await assert.rejects(() => readSseContent(new Response(null, { status: 200 })), /no response stream/);

  // Some OpenAI-compatible gateways ignore stream:true and return one JSON completion.
  assert.equal(
    await readSseContent(new Response(JSON.stringify({ choices: [{ message: { content: '<!DOCTYPE html>json' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
    '<!DOCTYPE html>json',
  );

  // A stalled stream fails fast rather than hanging until the gateway drops it.
  const stalled = new Response(new ReadableStream({ start() { /* never enqueues */ } }), { status: 200 });
  await assert.rejects(() => readSseContent(stalled, undefined, 50), /stream stalled/);
  console.log('streaming checks passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
