import { describe, expect, it } from "vitest";
import { comparePaired, holmCorrection, percentile, percentileBootstrapMean, throughputAtApprovedBound, wilcoxonSignedRank } from "./statistics";
import type { ExperimentConfig } from "./types";

describe("experiment statistics", () => {
  it("computes deterministic percentile bootstrap intervals over seed means", () => {
    const first = percentileBootstrapMean([1, 2, 3, 4], 1000, 2026);
    expect(first).toEqual(percentileBootstrapMean([1, 2, 3, 4], 1000, 2026));
    expect(first?.low).toBeLessThanOrEqual(first?.high ?? Infinity);
    expect(percentileBootstrapMean([], 1000, 1)).toBeNull();
    expect(percentile([0, 10], 0.25)).toBe(2.5);
  });

  it("computes paired differences, Wilcoxon and rank-biserial effects", () => {
    const comparison = comparePaired([4, 5, 6, 7], [1, 2, 3, 4], 1000, 23);
    expect(comparison.n).toBe(4);
    expect(comparison.meanDifference).toBe(3);
    expect(comparison.wilcoxonP).not.toBeNull();
    expect(comparison.rankBiserial).toBe(1);
    expect(comparison.rankBiserialInterval?.low).toBeLessThanOrEqual(comparison.rankBiserialInterval?.high ?? Infinity);
    expect(wilcoxonSignedRank([1, 2], [1, 2])).toBeNull();
  });

  it("applies Holm correction to a comparison family", () => {
    const comparisons = [0.01, 0.04, 0.03].map((wilcoxonP) => ({ n: 10, meanDifference: 1, meanDifferenceInterval: { low: 0, high: 2 }, wilcoxonP, rankBiserial: 0.5, rankBiserialInterval: { low: 0.1, high: 0.8 } }));
    const corrected = holmCorrection(comparisons);
    expect(corrected.map((x) => x.holmAdjustedP)).toEqual([0.03, 0.06, 0.06]);
  });

  it("requires the approved p95 threshold for throughput and uses strict-below semantics", () => {
    const base = {
      schemaVersion: 1 as const, configId: "throughput-fixture", policyVersion: "fixture", generatedAt: "2026-11-17T00:00:00Z",
      seeds: { calibration: [1, 2, 3, 4, 5], test: [101] }, instancesPerFamily: 250, testFamilies: 12, degradationRates: [0, 0.1, 0.2, 0.4],
      pilot: { instancesPerFamily: 1, latencyWarmups: 1, latencySamples: 1, runs: 1 }, parameters: { throughputP95BoundMs: 10 }, decisionsRequired: [], approvals: [], status: "PROVISIONAL_PILOT_ONLY" as const,
    } satisfies ExperimentConfig;
    expect(() => throughputAtApprovedBound([{ offeredRequestsPerSecond: 100, p95LatencyMs: 5 }], base)).toThrow(/explicit author approval/);
    const approved = { ...base, approvals: [{ decisionId: "throughput-p95-bound-and-load-procedure", selection: "10", approvedAt: "2026-11-17", approvalRef: "author-record" }] };
    expect(throughputAtApprovedBound([{ offeredRequestsPerSecond: 50, p95LatencyMs: 9 }, { offeredRequestsPerSecond: 100, p95LatencyMs: 10 }], approved)).toEqual({ requestsPerSecond: 50, boundMs: 10 });
    expect(throughputAtApprovedBound([{ offeredRequestsPerSecond: 100, p95LatencyMs: 11 }], approved).requestsPerSecond).toBeNull();
  });
});
