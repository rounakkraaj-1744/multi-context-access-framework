import { performance } from "node:perf_hooks";

export type PdpBoundaryMeasurement<T> = Readonly<{
  response: T;
  startMonotonicMs: number;
  endMonotonicMs: number;
  durationMs: number;
}>;
export type MonotonicClock = () => number;

/**
 * Section XVII boundary: start immediately before the PEP invokes its local
 * PDP function; stop after that function returns the decision. The dispatch
 * callback must include the PDP's evaluation and required pre-return trace
 * append, and must not include caller setup or result reporting.
 */
export function measurePdpBoundary<T>(
  dispatch: () => T,
  clock: MonotonicClock = () => performance.now(),
): PdpBoundaryMeasurement<T> {
  const startMonotonicMs = clock();
  const response = dispatch();
  const endMonotonicMs = clock();
  if (
    !Number.isFinite(startMonotonicMs) ||
    !Number.isFinite(endMonotonicMs) ||
    endMonotonicMs < startMonotonicMs
  ) {
    throw new Error("PDP boundary clock must be finite and monotonic");
  }
  return {
    response,
    startMonotonicMs,
    endMonotonicMs,
    durationMs: endMonotonicMs - startMonotonicMs,
  };
}

/** Reports timer-call overhead; it is diagnostic and is never subtracted. */
export function measureClockReadOverhead(
  samples = 10_000,
  clock: MonotonicClock = () => performance.now(),
): Readonly<{ samples: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null }> {
  if (!Number.isInteger(samples) || samples < 1)
    throw new Error("clock overhead sample count must be a positive integer");
  const durations = Array.from({ length: samples }, () => {
    const start = clock();
    const end = clock();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
      throw new Error("PDP boundary clock must be finite and monotonic");
    return end - start;
  }).sort((a, b) => a - b);
  const quantile = (q: number) => durations[Math.ceil(q * durations.length) - 1] ?? null;
  return { samples, p50Ms: quantile(0.5), p95Ms: quantile(0.95), p99Ms: quantile(0.99) };
}
