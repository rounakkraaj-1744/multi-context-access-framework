import type { ExperimentConfig } from "./types";

export type Interval = Readonly<{ low: number; high: number }>;
export type PairedComparison = Readonly<{
  n: number;
  meanDifference: number | null;
  meanDifferenceInterval: Interval | null;
  wilcoxonP: number | null;
  rankBiserial: number | null;
  rankBiserialInterval: Interval | null;
  holmAdjustedP?: number;
}>;

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function percentile(values: readonly number[], probability: number): number | null {
  if (values.length === 0) return null;
  if (!Number.isFinite(probability) || probability < 0 || probability > 1)
    throw new Error("percentile probability must be in [0, 1]");
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position),
    fraction = position - lower;
  return (
    ordered[lower]! +
    (ordered[Math.min(lower + 1, ordered.length - 1)]! - ordered[lower]!) * fraction
  );
}

export function percentileBootstrapMean(
  values: readonly number[],
  iterations = 10_000,
  seed = 1,
): Interval | null {
  if (values.length === 0) return null;
  if (iterations < 1 || !Number.isInteger(iterations))
    throw new Error("bootstrap iterations must be a positive integer");
  const random = rng(seed),
    means: number[] = [];
  for (let b = 0; b < iterations; b++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)]!;
    means.push(sum / values.length);
  }
  return { low: percentile(means, 0.025)!, high: percentile(means, 0.975)! };
}

export function wilcoxonSignedRank(
  first: readonly number[],
  second: readonly number[],
): Readonly<{ p: number; rankBiserial: number; nNonzero: number }> | null {
  if (first.length !== second.length) throw new Error("paired samples must have equal lengths");
  const diffs = first.map((value, index) => value - second[index]!).filter((d) => d !== 0);
  if (diffs.length === 0) return null;
  const ordered = diffs
    .map((difference, index) => ({ difference, absolute: Math.abs(difference), index }))
    .sort((a, b) => a.absolute - b.absolute);
  let rankSumPositive = 0,
    rankSumNegative = 0,
    tieTerm = 0;
  for (let start = 0; start < ordered.length;) {
    let end = start + 1;
    while (end < ordered.length && ordered[end]!.absolute === ordered[start]!.absolute) end++;
    const rank = (start + 1 + end) / 2;
    const tieSize = end - start;
    tieTerm += tieSize ** 3 - tieSize;
    for (let i = start; i < end; i++) {
      if (ordered[i]!.difference > 0) rankSumPositive += rank;
      else rankSumNegative += rank;
    }
    start = end;
  }
  const n = diffs.length;
  const mean = (n * (n + 1)) / 4;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieTerm / 48;
  const z =
    variance <= 0 ? 0 : Math.max(0, Math.abs(rankSumPositive - mean) - 0.5) / Math.sqrt(variance);
  return {
    p: Math.min(1, erfc(z / Math.SQRT2)),
    rankBiserial: (rankSumPositive - rankSumNegative) / (rankSumPositive + rankSumNegative),
    nNonzero: n,
  };
}

export function comparePaired(
  first: readonly number[],
  second: readonly number[],
  iterations = 10_000,
  seed = 1,
): PairedComparison {
  if (first.length !== second.length) throw new Error("paired samples must have equal lengths");
  if (first.length === 0)
    return {
      n: 0,
      meanDifference: null,
      meanDifferenceInterval: null,
      wilcoxonP: null,
      rankBiserial: null,
      rankBiserialInterval: null,
    };
  const differences = first.map((value, index) => value - second[index]!);
  const meanDifference = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const meanDifferenceInterval = percentileBootstrapMean(differences, iterations, seed);
  const test = wilcoxonSignedRank(first, second);
  const random = rng(seed ^ 0x43a0f13);
  const effectSizes: number[] = [];
  for (let b = 0; b < iterations; b++) {
    const a: number[] = [],
      c: number[] = [];
    for (let i = 0; i < first.length; i++) {
      const index = Math.floor(random() * first.length);
      a.push(first[index]!);
      c.push(second[index]!);
    }
    effectSizes.push(wilcoxonSignedRank(a, c)?.rankBiserial ?? 0);
  }
  return {
    n: first.length,
    meanDifference,
    meanDifferenceInterval,
    wilcoxonP: test?.p ?? null,
    rankBiserial: test?.rankBiserial ?? null,
    rankBiserialInterval: {
      low: percentile(effectSizes, 0.025)!,
      high: percentile(effectSizes, 0.975)!,
    },
  };
}

export function holmCorrection(comparisons: readonly PairedComparison[]): PairedComparison[] {
  const eligible = comparisons
    .map((value, index) => ({ value, index }))
    .filter((x) => x.value.wilcoxonP !== null)
    .sort((a, b) => a.value.wilcoxonP! - b.value.wilcoxonP!);
  const adjusted = new Map<number, number>();
  let running = 0;
  eligible.forEach(({ value, index }, rank) => {
    running = Math.max(running, Math.min(1, (eligible.length - rank) * value.wilcoxonP!));
    adjusted.set(index, running);
  });
  return comparisons.map((value, index) => ({
    ...value,
    ...(adjusted.has(index) ? { holmAdjustedP: adjusted.get(index)! } : {}),
  }));
}

export type OfferedLoadTrial = Readonly<{ offeredRequestsPerSecond: number; p95LatencyMs: number }>;

/** Returns the highest tested offered rate whose p95 is strictly below the approved bound. */
export function throughputAtApprovedBound(
  trials: readonly OfferedLoadTrial[],
  config: ExperimentConfig,
): Readonly<{ requestsPerSecond: number | null; boundMs: number }> {
  const approval = config.approvals.find(
    (entry) =>
      entry.decisionId === "throughput-p95-bound-and-load-procedure" &&
      entry.selection.trim() &&
      entry.approvalRef.trim() &&
      entry.approvedAt.trim(),
  );
  if (!approval)
    throw new Error(
      "Throughput is blocked until the p95 latency bound/load procedure has explicit author approval",
    );
  const boundMs = Number(config.parameters["throughputP95BoundMs"]);
  if (!Number.isFinite(boundMs) || boundMs <= 0 || String(boundMs) !== approval.selection)
    throw new Error("Throughput bound must match the author-approved selection");
  if (
    trials.some(
      (trial) =>
        !Number.isFinite(trial.offeredRequestsPerSecond) ||
        trial.offeredRequestsPerSecond < 0 ||
        !Number.isFinite(trial.p95LatencyMs) ||
        trial.p95LatencyMs < 0,
    )
  )
    throw new Error("Throughput trials must contain finite nonnegative rates and latencies");
  const sustainable = trials.filter((trial) => trial.p95LatencyMs < boundMs);
  return {
    requestsPerSecond: sustainable.length
      ? Math.max(...sustainable.map((trial) => trial.offeredRequestsPerSecond))
      : null,
    boundMs,
  };
}

function erfc(x: number): number {
  const z = Math.abs(x),
    t = 1 / (1 + z / 2);
  const coefficients = [
    0.17087277, -0.82215223, 1.48851587, -1.13520398, 0.27886807, -0.18628806, 0.09678418,
    0.37409196, 1.00002368,
  ];
  let polynomial = coefficients[0]!;
  for (let i = 1; i < coefficients.length; i++) polynomial = coefficients[i]! + t * polynomial;
  const answer = t * Math.exp(-z * z - 1.26551223 + t * polynomial);
  return x >= 0 ? answer : 2 - answer;
}
