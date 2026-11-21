import { describe, expect, it } from "vitest";
import { assertAuthorApprovals, assertCalibrationSeedSet, assertDisjointSeedSets, assertProtocolSeedSets, assertScenarioApproval, REQUIRED_AUTHOR_DECISION_IDS } from "./decision-gate";
import { generateScenarioStream } from "./harness";
import type { ExperimentConfig } from "./types";

const config: ExperimentConfig = {
  schemaVersion: 1, configId: "gate-fixture", policyVersion: "fixture", generatedAt: "2026-11-17T00:00:00Z",
  seeds: { calibration: [1, 2, 3, 4, 5], test: Array.from({ length: 30 }, (_, i) => i + 101) },
  instancesPerFamily: 250, testFamilies: 12, degradationRates: [0, 0.1, 0.2, 0.4],
  pilot: { instancesPerFamily: 2, latencyWarmups: 2, latencySamples: 4, runs: 1 },
  parameters: { mimicVerificationFailureProbability: 0.25, throughputP95BoundMs: 10 }, decisionsRequired: [], approvals: [], status: "PROVISIONAL_PILOT_ONLY",
};

describe("experiment approval and seed gates", () => {
  it("blocks the second pilot until all six decision approvals are recorded", () => {
    expect(REQUIRED_AUTHOR_DECISION_IDS).toHaveLength(6);
    expect(() => assertAuthorApprovals(config)).toThrow(/Author approval required/);
    const approved = { ...config, approvals: REQUIRED_AUTHOR_DECISION_IDS.map((decisionId) => ({ decisionId, selection: "fixture-selection", approvedAt: "2026-11-17", approvalRef: "fixture-author-record" })) };
    expect(() => assertAuthorApprovals(approved)).not.toThrow();
  });

  it("locks calibration to seeds 1–5 and rejects overlap with test seeds", () => {
    assertCalibrationSeedSet([1, 2, 3, 4, 5], config.seeds.test);
    assertDisjointSeedSets(config.seeds.calibration, config.seeds.test);
    expect(() => assertCalibrationSeedSet([1, 2, 3, 4, 101], config.seeds.test)).toThrow(/only ordered seeds/);
    expect(() => assertDisjointSeedSets([1, 101], [101, 102])).toThrow(/overlap/);
    assertProtocolSeedSets(config.seeds.calibration, config.seeds.test);
    expect(() => assertProtocolSeedSets(config.seeds.calibration, [101, 102])).toThrow(/101–130/);
  });

  it("uses the selected S9 and S12 scenarios only as approval-gate fixtures", () => {
    const s9 = generateScenarioStream(11, 1).find((scenario) => scenario.family === "S9")!;
    const s12 = generateScenarioStream(11, 1).find((scenario) => scenario.family === "S12")!;
    expect(s9.expectedPolicyOutcome).toContain("status X");
    expect(s12.intent).toBe("violating");
    const approval = { decisionId: "s12-mimic-verification-probability", selection: "0.25", approvedAt: "2026-11-17", approvalRef: "fixture" };
    assertScenarioApproval(s12, { ...config, approvals: [approval] });
    expect(() => assertScenarioApproval(s12, { ...config, parameters: { mimicVerificationFailureProbability: 0.5 }, approvals: [approval] })).toThrow(/exactly match/);
  });
});
