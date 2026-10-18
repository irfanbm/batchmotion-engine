import type { Settings } from './types';

export function mergeStored<T>(parsed: unknown, fallback: T): T {
  if (Array.isArray(fallback)) {
    if (Array.isArray(parsed)) return parsed as T;
    // ponytail: recover the numeric-key object written by older builds; remove after migration is no longer needed.
    if (parsed && typeof parsed === 'object') return Object.values(parsed) as T;
    return fallback;
  }
  return parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
}
export function normalizeRenderPreset<T extends Pick<Settings, 'width'|'height'|'fps'>>(value: T): T {
  if (!['2560x1440','3840x2160','7680x4320'].includes(`${value.width}x${value.height}`)) {
    // ponytail: migrate pre-preset render sizes to 2K; add a Custom preset if arbitrary dimensions return.
    value.width = 2560; value.height = 1440;
  }
  if (![30,60].includes(value.fps)) value.fps = 30;
  return value;
}
export function resolveStoredModel(value:Pick<Settings,'model'|'generationModel'|'refinementModel'>){return value.model?.trim()||value.generationModel?.trim()||value.refinementModel?.trim()||'gpt-5'}
// Parse persisted JSON without swallowing corruption. A missing file is an empty result;
// a present-but-invalid file throws so callers can quarantine it instead of replacing it.
export function parseStoredJson<T>(text: string, fallback: T): T {
  return mergeStored(JSON.parse(text), fallback);
}
