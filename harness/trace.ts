export interface AttemptRecord {
  attempt: number;
  errors: string[];
  startedAt: number;
  endedAtMs?: number;
}
export interface JobTrace {
  attempts: AttemptRecord[];
}
// True when the last `times` attempts failed with the identical error set.
// Identical repeats mean the repair is stuck in a local optimum: more attempts
// with the same steering will not move it, so the loop should stop early and
// hand the trace to a human instead of burning budget.
export function consecutiveIdenticalErrors(trace: JobTrace, times = 3): boolean {
  if (trace.attempts.length < times) return false;
  const tail = trace.attempts.slice(-times);
  const key = (errors: string[]) => [...errors].sort().join('\n');
  const first = key(tail[0].errors);
  return tail.every((a) => key(a.errors) === first);
}
export function traceElapsedMs(trace: JobTrace): number {
  if (!trace.attempts.length) return 0;
  const first = trace.attempts[0].startedAt;
  const last = trace.attempts[trace.attempts.length - 1];
  return (last.endedAtMs ?? Date.now()) - first;
}
