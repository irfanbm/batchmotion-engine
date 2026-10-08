export type ErrorStage =
  | "preparing"
  | "render-initialization"
  | "visual-preflight"
  | "frame-capture"
  | "encoding"
  | "output-verification"
  | "queue";

export type NormalizedError = {
  stage: ErrorStage;
  message: string;
  name: string;
  code?: string;
  stack?: string;
  cause?: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function normalizeThrown(value: unknown, stage: ErrorStage): NormalizedError {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  const name = text(record?.name) || (value instanceof Error ? value.name : "UnknownThrownValue");
  const rawMessage = text(record?.message) || text(value);
  const code = text(record?.code);
  const causeValue = record?.cause;
  const cause = causeValue instanceof Error
    ? text(causeValue.message)
    : typeof causeValue === "string"
      ? text(causeValue)
      : undefined;
  const unknownViz = /UnknownVizError/i.test(`${name} ${rawMessage}`);
  const detail = unknownViz || !rawMessage || rawMessage === "[object Object]"
    ? "Electron could not complete the visual operation. Fully restart Batchmotion and retry; if it repeats, inspect the structured render diagnostic for the native stack and stage."
    : rawMessage;
  const label = stage.replace(/-/g, " ");
  return {
    stage,
    message: `${label[0].toUpperCase()}${label.slice(1)} failed: ${detail}${code ? ` (${code})` : ""}`,
    name,
    code: code || undefined,
    stack: text(record?.stack) || undefined,
    cause,
  };
}

export async function optionalVisualAnalyzer<T>(
  label: string,
  analyze: () => Promise<T> | T,
  onWarning: (message: string, diagnostic?: NormalizedError) => void,
  signal?: AbortSignal,
  fatalRuntimeError?: () => string | undefined,
) {
  try {
    return await analyze();
  } catch (error) {
    if (signal?.aborted) throw error;
    // A measured rejection is not an analyzer crash. Preserve it for queue repair.
    if (error instanceof Error && error.name === 'RenderQualityError') throw error;
    const fatal = fatalRuntimeError?.();
    if (fatal) throw new Error(fatal, { cause: error });
    const normalized = normalizeThrown(error, "visual-preflight");
    try {
      onWarning(`Visual preflight skipped: ${label}: ${normalized.message}`, normalized);
    } catch {}
    return undefined;
  }
}

export function visualGateFinding(
  enabled: boolean,
  message: string,
  onWarning: (message: string) => void,
) {
  if (enabled) throw new Error(`Runtime visual quality gate failed: ${message}`);
  try {
    onWarning(`Visual preflight warning: ${message} (continuing)`);
  } catch {}
}
