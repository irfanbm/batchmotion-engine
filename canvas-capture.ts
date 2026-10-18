// Canvas-only frame capture: the page draws frame i synchronously and hands back the canvas pixels of that very draw.
// No paint event, no compositor timing, so frame 0 cannot be stale and frames cannot lag.

export interface CanvasFrameReply { frame: number; png: string }
export type CanvasFrameSource = (frame: number) => Promise<CanvasFrameReply>;

export const CANVAS_CAPTURE_EXPR = (frame: number) => `window.__MOTIONFORGE_CAPTURE_FRAME__(${Math.trunc(frame)})`;

export function decodePngDataUrl(url: string): Buffer {
  const m = /^data:image\/png;base64,(.+)$/.exec(url);
  if (!m) throw new Error('Canvas capture did not return a PNG data URL.');
  return Buffer.from(m[1], 'base64');
}

/** Captures frames 0..count-1 strictly in order and proves each returned frame is the one requested. */
export async function captureCanvasFrames(count: number, source: CanvasFrameSource, onFrame: (frame: number, png: Buffer) => Promise<void>, shouldStop: () => boolean = () => false): Promise<number[]> {
  const mapping: number[] = [];
  for (let frame = 0; frame < count; frame++) {
    if (shouldStop()) throw new Error('Generation stopped.');
    const reply = await source(frame);
    if (reply.frame !== frame) throw new Error(`Canvas capture mismatch: requested scene frame ${frame} but the page drew frame ${reply.frame} (stale or lagging capture).`);
    await onFrame(frame, decodePngDataUrl(reply.png));
    mapping.push(reply.frame);
  }
  if (mapping.length !== count || mapping[count - 1] !== count - 1) throw new Error(`Canvas capture incomplete: last captured scene frame ${mapping[mapping.length - 1]} but expected ${count - 1}.`);
  return mapping;
}
