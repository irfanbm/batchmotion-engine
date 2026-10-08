export type MotionObject = {
  id: string;
  role: "subject" | "support" | "background";
  allowCrop: boolean;
  fullBleed?: boolean;
  allowSmallSubject?: boolean;
  visibleFrom?: number;
  visibleUntil?: number;
};
export type MotionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export const REPRESENTATIVE_FRACTIONS = [0.4, 0.5, 0.6, 0.7, 0.75] as const;
export const SUBJECT_HARD_MINIMUM = {
  area: 0.025,
  width: 0.15,
  height: 0.15,
} as const;
export const SUBJECT_QUALITY_TARGET = {
  area: 0.08,
  width: 0.3,
  height: 0.35,
} as const;
export const SMALL_SUBJECT_HARD_MINIMUM = {
  area: 0.005,
  width: 0.08,
  height: 0.08,
} as const;

export function geometryErrors(
  item: MotionObject,
  rect: MotionRect | undefined,
  viewport: { width: number; height: number },
  alpha = false,
) {
  if (alpha && item.role === "background") return [];
  if (!rect) return [`missing element #${item.id}`];
  const right = rect.x + rect.width,
    bottom = rect.y + rect.height;
  if (
    right <= 0 ||
    bottom <= 0 ||
    rect.x >= viewport.width ||
    rect.y >= viewport.height
  )
    return [`${item.id} fully outside viewport`];
  if (rect.width < 2 || rect.height < 2)
    return [
      `${item.id} near-zero size ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`,
    ];
  const clip = {
    left: Math.max(0, -rect.x),
    top: Math.max(0, -rect.y),
    right: Math.max(0, right - viewport.width),
    bottom: Math.max(0, bottom - viewport.height),
  };
  if (item.role === "background" && item.fullBleed) {
    const gaps = {
      left: Math.max(0, rect.x),
      top: Math.max(0, rect.y),
      right: Math.max(0, viewport.width - right),
      bottom: Math.max(0, viewport.height - bottom),
    };
    if (Object.values(gaps).some(Boolean))
      return [
        `${item.id} background gaps px L${gaps.left.toFixed(1)} T${gaps.top.toFixed(1)} R${gaps.right.toFixed(1)} B${gaps.bottom.toFixed(1)}`,
      ];
  }
  // Overflow below 4px is layout rounding and antialiasing, not a visible crop; the
  // taste safe-area rule works in 40px steps, so hairline clips never gate.
  if (!item.allowCrop && Object.values(clip).some((value) => value >= 4))
    return [
      `${item.id} clipped px L${clip.left.toFixed(1)} T${clip.top.toFixed(1)} R${clip.right.toFixed(1)} B${clip.bottom.toFixed(1)}`,
    ];
  return [];
}
export function normalizedVisibility(item: MotionObject) {
  const clamp = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : fallback;
  const from = clamp(item.visibleFrom, 0),
    until = clamp(item.visibleUntil, 1);
  return from <= until ? { from, until } : { from: until, until: from };
}
export function activeAt(item: MotionObject, fraction: number) {
  const { from, until } = normalizedVisibility(item);
  return fraction >= from && fraction <= until;
}
export function subjectMetrics(
  rect: MotionRect,
  viewport: { width: number; height: number },
) {
  const width =
      Math.max(
        0,
        Math.min(viewport.width, rect.x + rect.width) - Math.max(0, rect.x),
      ) / viewport.width,
    height =
      Math.max(
        0,
        Math.min(viewport.height, rect.y + rect.height) - Math.max(0, rect.y),
      ) / viewport.height;
  return { width, height, area: width * height };
}
function passes(
  metrics: { width: number; height: number; area: number },
  target: { width: number; height: number; area: number },
) {
  return (
    metrics.area >= target.area &&
    (metrics.width >= target.width || metrics.height >= target.height)
  );
}
export function subjectHardValid(
  item: MotionObject,
  rect: MotionRect | undefined,
  viewport: { width: number; height: number },
) {
  return (
    !!rect &&
    passes(
      subjectMetrics(rect, viewport),
      item.allowSmallSubject
        ? SMALL_SUBJECT_HARD_MINIMUM
        : SUBJECT_HARD_MINIMUM,
    )
  );
}
export function subjectQualityValid(
  item: MotionObject,
  rect: MotionRect | undefined,
  viewport: { width: number; height: number },
) {
  return (
    !!rect &&
    passes(
      subjectMetrics(rect, viewport),
      item.allowSmallSubject
        ? SMALL_SUBJECT_HARD_MINIMUM
        : SUBJECT_QUALITY_TARGET,
    )
  );
}
export function recommendedSubjectScale(
  item: MotionObject,
  rect: MotionRect,
  viewport: { width: number; height: number },
) {
  const { width, height, area } = subjectMetrics(rect, viewport),
    target = item.allowSmallSubject
      ? SMALL_SUBJECT_HARD_MINIMUM
      : SUBJECT_QUALITY_TARGET,
    areaFactor = Math.sqrt(target.area / Math.max(area, 1e-9)),
    dimensionFactor = Math.min(
      target.width / Math.max(width, 1e-9),
      target.height / Math.max(height, 1e-9),
    );
  return Math.min(
    3,
    Math.max(1.05, 1.1 * Math.max(areaFactor, dimensionFactor)),
  );
}
function subjectDiagnostic(
  item: MotionObject,
  rect: MotionRect | undefined,
  viewport: { width: number; height: number },
  fraction: number,
  target: string,
) {
  if (!rect || rect.width < 2 || rect.height < 2)
    return `subject #${item.id} is not measurable at representative frames; make it visible before scaling`;
  const { width, height, area } = subjectMetrics(rect, viewport),
    factor = recommendedSubjectScale(item, rect, viewport);
  return `subject #${item.id} occupies ${(width * 100).toFixed(1)}% width x ${(height * 100).toFixed(1)}% height (${(area * 100).toFixed(1)}% area) at ${(fraction * 100).toFixed(0)}%; scale by ${factor.toFixed(2)}x around its visual center using tight visible bounds, preserving its silhouette, functional parts, and semantic identity (${target}).`;
}
export function subjectHardError(
  item: MotionObject,
  rect: MotionRect | undefined,
  viewport: { width: number; height: number },
  fraction: number,
) {
  if (item.role !== "subject" || subjectHardValid(item, rect, viewport)) return;
  return subjectDiagnostic(
    item,
    rect,
    viewport,
    fraction,
    item.allowSmallSubject
      ? "hard minimum 0.5% area and 8% width or height"
      : "hard minimum 2.5% area and 15% width or height",
  );
}
export function subjectScaleError(
  item: MotionObject,
  rect: MotionRect | undefined,
  viewport: { width: number; height: number },
  fraction: number,
) {
  if (item.role !== "subject" || subjectQualityValid(item, rect, viewport))
    return;
  return subjectDiagnostic(
    item,
    rect,
    viewport,
    fraction,
    item.allowSmallSubject
      ? "quality target 0.5% area and 8% width or height"
      : "quality target 8% area and 30% width or 35% height",
  );
}
export function representativeSubjectError(
  objects: MotionObject[],
  valid: boolean,
) {
  const subject = objects.find((item) => item.role === "subject");
  return valid
    ? undefined
    : subject
      ? `subject #${subject.id} has no valid representative frame at 40%, 50%, 60%, 70%, or 75%`
      : "primary subject metadata is missing; exactly one recognizable subject is required";
}
