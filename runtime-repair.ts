import { uniqueErrors } from "./quality";

const severe =
  /missing element|runtime error|initialization failed|renderer process ended|opaque background|background gaps|static validation/i;
const metric =
  /subject #[^;]+?occupies ([\d.]+)% width x ([\d.]+)% height \(([\d.]+)% area\)/i;

export function runtimeRepairProgress(previous: string, next: string) {
  const previousSevere = uniqueErrors(previous.split(";")).filter((x) =>
    severe.test(x),
  );
  const nextSevere = uniqueErrors(next.split(";")).filter((x) =>
    severe.test(x),
  );
  if (
    nextSevere.some(
      (error) =>
        !previousSevere.some(
          (old) => old.toLowerCase() === error.toLowerCase(),
        ),
    )
  )
    return false;
  const before = metric.exec(previous),
    after = metric.exec(next);
  if (!before || !after) return false;
  const score = (match: RegExpExecArray) =>
    Math.max(
      Number(match[1]) / 0.3,
      Number(match[2]) / 0.35,
      Math.sqrt(Number(match[3]) / 0.08),
    );
  return score(after) >= score(before) * 1.05;
}

export function latestRuntimeError(message: string) {
  const prefix = "Runtime preflight failed: ";
  const body = message.startsWith(prefix)
    ? message.slice(prefix.length)
    : message;
  return `${prefix}${uniqueErrors(
    body
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean),
  ).join("; ")}`;
}

export type RuntimeRepairKind =
  | "hard"
  | "quality"
  | "coverage"
  | "flicker"
  | "drift"
  | "text"
  | "loop"
  | "color"
  | "beats"
  | "api";
export function runtimeRepairKind(message: string): RuntimeRepairKind {
  if (message.startsWith("Runtime preflight quality target:")) return "quality";
  const lower = message.toLowerCase();
  // Canvas/SVG API misuse (e.g. "ctx.cubicCurveTo is not a function", "arc ... radius is
  // negative", "is not a function"). These need an API-existence/guard fix, not a visual one.
  if (/is not a function|is not defined|radius provided|indexsizeerror/.test(lower)) return "api";
  if (lower.includes("coverage")) return "coverage";
  if (lower.includes("flicker")) return "flicker";
  if (lower.includes("drift")) return "drift";
  if (lower.includes("legib") || lower.includes("contrast")) return "text";
  if (lower.includes("loop seam") || lower.includes("endpoint")) return "loop";
  if (lower.includes("color consistency") || lower.includes("new color")) return "color";
  if (lower.includes("beat")) return "beats";
  return "hard";
}

// Per-kind repair instruction injected into repair prompts.
export const runtimeRepairContract: Record<RuntimeRepairKind, string> = {
  hard: "Fix the runtime failure so the scene initializes, renders deterministically on the single paused gsap timeline seeked from motionforge:frame, and passes static validation (including the GSAP contract). Change only what is necessary; preserve subject, colors, materials, composition, and motion intent.",
  quality: "Raise the measured subject quality: apply the reported scale factor to tight visible subject bounds so the subject occupies the documented minimum area without cropping key parts.",
  coverage: "Coverage repair: extend the background to full bleed (no letterboxing, panels, or margin gaps) and keep every requested element visible within the frame.",
  flicker: "Flicker repair: remove oscillating opacity/position/color values; every property must follow a single eased gsap tween per segment and hold stable values at rest.",
  drift: "Drift repair: re-anchor the subject so it stays within its intended screen region; cumulative offsets must return to the starting anchor by loop end.",
  text: "Text readability repair: increase font size/weight or contrast for unreadable text; keep text inside safe margins and sharp while moving.",
  loop: "Loop repair: make the state at t=0 identical to t=duration for every animated property; align tween start positions and durations so each value returns on the timeline (wrap-safe sin/cos or modulo progress for canvas state).",
  color: "Color consistency repair: lock the palette to the brief's colors; do not introduce new hues mid-animation except deliberate, brief-aligned accents.",
  beats: "Beat coherence repair: realign major accents to the BEATS table entries and keep beat spacing regular (0.5-1.0s).",
  api: "Canvas/SVG API repair: the scene called a drawing API that does not exist or used an invalid argument. Fix it by (1) using only standard Canvas2D methods on a 2D context (getContext('2d')): moveTo/lineTo/bezierCurveTo/quadraticCurveTo/arc/ellipse/rect/fill/stroke — never cubicCurveTo or Path2D-style methods on a 2D context; (2) clamping every radius/size/width/height to a non-negative value with Math.max(0.5, v) so no negative radius can throw IndexSizeError; (3) guarding any helper that wraps context calls so a missing method falls back to a simple primitive (line or circle). Preserve the visual intent.",
};

export const MAX_REPAIR_ATTEMPTS_PER_KIND = 2;
export function maxRepairAttempts(kind: RuntimeRepairKind) {
  return kind === "quality" ? 1 : MAX_REPAIR_ATTEMPTS_PER_KIND;
}

export function canAttemptRuntimeRepair(
  kind: RuntimeRepairKind,
  attempts: number,
  previous: string,
  next: string,
) {
  if (kind === "quality") return attempts < 1;
  return (
    attempts < maxRepairAttempts(kind) &&
    (attempts === 0 || runtimeRepairProgress(previous, next))
  );
}
