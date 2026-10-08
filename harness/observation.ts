export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
// Repair observation for vision-capable repairs: the text task plus up to three
// downscaled render frames. Text-only providers receive the text part alone;
// the caller degrades explicitly (see requestHtml), never silently.
export function buildObservationMessage(task: string, frames: string[]): string | ChatPart[] {
  if (!frames.length) return task;
  return [
    { type: 'text', text: task },
    ...frames.slice(0, 3).map((url) => ({ type: 'image_url', image_url: { url } }) as ChatPart),
  ];
}
