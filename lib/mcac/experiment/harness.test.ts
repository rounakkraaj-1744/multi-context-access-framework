import { describe, expect, it } from "vitest";
import { applyStepUpOutcome, computeMetrics, evaluators, evaluateRows, FAMILIES, generateScenarioStream, makePolicy } from "./harness";
import { assertScenarioApproval } from "./decision-gate";
import type { EvaluationRow, ExperimentConfig, GeneratedScenario } from "./types";

const config: ExperimentConfig = {
  schemaVersion: 1, configId: "pilot-test", policyVersion: "pilot-provisional-v1", generatedAt: "2026-01-01T00:00:00.000Z",
  seeds: { calibration: [1, 2, 3, 4, 5], test: [101, 102] }, instancesPerFamily: 250, testFamilies: 12,
  degradationRates: [0, 0.1, 0.2, 0.4], pilot: { instancesPerFamily: 2, latencyWarmups: 2, latencySamples: 4, runs: 1 },
  parameters: { mimicVerificationFailureProbability: 0.5 }, decisionsRequired: [], approvals: [], status: "PROVISIONAL_PILOT_ONLY",
};

function row(intent: GeneratedScenario["intent"], decision: "ALLOW" | "VERIFY" | "DENY", endToEndAccepted: boolean): EvaluationRow {
  const scenario = { id: "fixture", seed: 1, family: "S1", familyLabel: "fixture", primaryIntent: "mixed", primaryContextCategory: "Both", expectedPolicyOutcome: "design intent", intent, resourceSensitivity: "H", input: {} as GeneratedScenario["input"], degradation: null } as GeneratedScenario;
  return { system: "B1", scenario, decision, trace: null, input: null, stepUpPassed: null, endToEndAccepted, latencyMs: 1,
    latencyStartMonotonicMs: 0, latencyEndMonotonicMs: 1, coreEvaluatorLatencyMs: 0.5, traceComplete: null, replayMatches: null };
}

describe("experiment harness", () => {
  it("generates every family and keeps labels independent of evaluator outcomes", () => {
    const generated = generateScenarioStream(17, 5);
    expect(new Set(generated.map((s) => s.family))).toEqual(new Set(FAMILIES.map(([id]) => id)));
    expect(generated.filter((s) => s.family === "S7").every((s) => s.intent === "violating")).toBe(true);
    expect(generated.filter((s) => s.family === "S12").every((s) => s.intent === "violating")).toBe(true);
    expect(generated.some((s) => s.intent === "benign" && s.family !== "S1" && s.family !== "S3" && s.family !== "S11")).toBe(true);
    expect(generated.some((s) => s.intent === "violating" && s.family === "S1")).toBe(true);
  });

  it("preserves Table IX category and family context perturbations", () => {
    const generated = generateScenarioStream(53, 20);
    const family = (id: string) => generated.filter((s) => s.family === id);
    const byValue = (s: GeneratedScenario, kind: string) => [...Object.values(s.input.context.environmental), ...Object.values(s.input.context.behavioral)].find((item) => item.kind === kind)?.value;
    expect(family("S2").every((s) => (byValue(s, "device") as { registered: boolean }).registered === false && byValue(s, "network") === "unknown")).toBe(true);
    expect(family("S3").every((s) => (byValue(s, "device") as { registered: boolean }).registered === false)).toBe(true);
    expect(family("S4").some((s) => byValue(s, "network") === "unknown")).toBe(true);
    expect(family("S5").some((s) => (byValue(s, "time") as { hour: number }).hour === 22)).toBe(true);
    expect(family("S6").every((s) => (byValue(s, "frequency") as { count: number }).count === 25)).toBe(true);
    expect(family("S8").every((s) => (byValue(s, "navigation") as { transitionCount: number }).transitionCount === 0)).toBe(true);
    expect(family("S9").every((s) => (byValue(s, "location") as { region: string }).region === "east")).toBe(true);
    expect(family("S10").every((s) => byValue(s, "network") === null || s.input.request.time - (s.input.context.environmental.network.observedAt ?? 0) > 300_000)).toBe(true);
    expect(family("S11").every((s) => (byValue(s, "history") as unknown as { classes: { count: number }[] }).classes[0]?.count === 0)).toBe(true);
    expect(family("S12").every((s) => byValue(s, "network") === "corporate" && (byValue(s, "device") as { registered: boolean }).registered)).toBe(true);
    expect(family("S5")[0]?.expectedPolicyOutcome).toContain("VERIFY (L)");
    expect(family("S7")[0]?.primaryContextCategory).toBe("Baseline");
  });

  it("keeps the six evaluator implementations distinct and S7 baseline denies", () => {
    const scenarios = generateScenarioStream(23, 2);
    expect(Object.keys(evaluators).sort()).toEqual(["B1", "B2", "B3", "B4", "B5", "B6"]);
    expect(new Set(Object.values(evaluators)).size).toBe(6);
    const s7 = scenarios.filter((s) => s.family === "S7");
    const rows = evaluateRows(s7, config);
    expect(rows).toHaveLength(s7.length * 6);
    expect(rows.every((r) => r.decision === "DENY")).toBe(true);
  });

  it("simulates benign, violating and mimic verification reproducibly", () => {
    expect(applyStepUpOutcome("benign", "S1", 0.9, 0.5)).toBe(true);
    expect(applyStepUpOutcome("violating", "S1", 0.1, 0.5)).toBe(false);
    expect(applyStepUpOutcome("violating", "S12", 0.1, 0.5)).toBe(false);
    expect(applyStepUpOutcome("violating", "S12", 0.9, 0.5)).toBe(true);
    const s12 = generateScenarioStream(31, 1).find((s) => s.family === "S12")!;
    expect(() => assertScenarioApproval(s12, config)).toThrow(/explicit author approval/);
  });

  it("blocks S9 and S12 until their exact semantics have author approval", () => {
    const s9 = generateScenarioStream(31, 1).find((s) => s.family === "S9")!;
    const s12 = generateScenarioStream(31, 1).find((s) => s.family === "S12")!;
    expect(() => evaluateRows([s9], config)).toThrow(/gamma-scope-s9/);
    expect(() => evaluateRows([s12], config)).toThrow(/s12-mimic-verification-probability/);
    expect(() => evaluateRows([s9], { ...config, approvals: [{ decisionId: "gamma-scope-s9", selection: "some-selection", approvedAt: "2026-11-17", approvalRef: "author-email" }] })).toThrow(/not wired/);
  });

  it("records reproducible per-item degradation and derives the requested statuses", () => {
    const first = generateScenarioStream(73, 3, 1, 991);
    expect(first).toEqual(generateScenarioStream(73, 3, 1, 991));
    for (const scenario of first) {
      for (const operation of scenario.degradation ?? []) {
        const item = [...Object.values(scenario.input.context.environmental), ...Object.values(scenario.input.context.behavioral)].find((candidate) => candidate.kind === operation.item);
        expect(operation.seed).toBe(991);
        if (operation.operation === "missing") expect(item?.value).toBeNull();
        if (operation.operation === "stale") expect(scenario.input.request.time - (item?.observedAt ?? 0)).toBeGreaterThan(300_000);
        if (operation.operation === "unverifiable") expect(item?.integrityFlag).toBe(0);
        if (operation.operation === "contradictory") expect(scenario.input.consistencyEvidence.some((e) => e.id === `pilot-${operation.item}` && e.violated)).toBe(true);
      }
    }
  });

  it("computes manuscript denominators and nulls for empty classes", () => {
    const fixture = [row("violating", "ALLOW", true), row("violating", "VERIFY", false), row("benign", "DENY", false), row("benign", "VERIFY", true)];
    const metrics = computeMetrics(fixture);
    expect(metrics.FAR).toBe(0.5);
    expect(metrics.FRR).toBe(0.5);
    expect(metrics.CR).toBe(0.5);
    expect(metrics.precision).toBeCloseTo(1 / 3);
    expect(metrics.recall).toBe(0.5);
    expect(metrics.F1).toBe(0.4);
    expect(metrics.FAR_e2e).toBe(0.5);
    expect(computeMetrics([]).FAR).toBeNull();
    expect(computeMetrics([row("benign", "ALLOW", true)]).precision).toBeNull();
  });

  it("reports per-decision coverage, trace completeness, replay fidelity and latency quantiles", () => {
    const scenario = generateScenarioStream(41, 1).find((s) => s.family === "S1")!;
    const evaluated = evaluateRows([scenario], config, ["B5"]);
    const metrics = computeMetrics(evaluated);
    expect(metrics.contextCoverage).toBeGreaterThanOrEqual(0);
    expect(metrics.contextCoverage).toBeLessThanOrEqual(1);
    expect(metrics.traceCompleteness).toBe(1);
    expect(metrics.replayFidelity).toBe(1);
    expect(metrics.p50Ms).toBeTypeOf("number");
    expect(metrics.p95Ms).toBeTypeOf("number");
    expect(metrics.p99Ms).toBeTypeOf("number");
    expect(metrics.coreEvaluatorP50Ms).toBeTypeOf("number");
    expect(evaluated[0]!.latencyEndMonotonicMs).toBeGreaterThanOrEqual(evaluated[0]!.latencyStartMonotonicMs);
  });

  it("keeps Equation 18 undefined when a traced decision has zero referenced items", () => {
    const s7 = generateScenarioStream(41, 1).find((s) => s.family === "S7")!;
    const row = evaluateRows([s7], config, ["B5"]);
    expect(row[0]?.trace?.conditions).toHaveLength(0);
    expect(computeMetrics(row).contextCoverage).toBeNull();
  });

  it("defines an explicit baseline policy for experiment ablations", () => {
    expect(makePolicy("H").rules[0]?.environmental.length).toBeGreaterThan(0);
  });
});
