import type { ExperimentConfig, GeneratedScenario } from "./types";

export const REQUIRED_AUTHOR_DECISION_IDS = [
  "gamma-scope-s9",
  "s12-mimic-verification-probability",
  "calibration-objective-search-and-tie-break",
  "appendix-b-population-distributions",
  "throughput-p95-bound-and-load-procedure",
  "equation-18-zero-denominator",
] as const;

export function assertAuthorApprovals(
  config: ExperimentConfig,
  required: readonly string[] = REQUIRED_AUTHOR_DECISION_IDS,
): void {
  assertProtocolSeedSets(config.seeds.calibration, config.seeds.test);
  const valid = new Set(
    config.approvals
      .filter(
        (entry) => entry.selection.trim() && entry.approvalRef.trim() && entry.approvedAt.trim(),
      )
      .map((entry) => entry.decisionId),
  );
  const missing = required.filter((id) => !valid.has(id));
  if (missing.length)
    throw new Error(`Author approval required before second pilot: ${missing.join(", ")}`);
}

export function assertScenarioApproval(
  scenario: GeneratedScenario,
  config: ExperimentConfig,
): void {
  const required =
    scenario.family === "S9"
      ? "gamma-scope-s9"
      : scenario.family === "S12"
        ? "s12-mimic-verification-probability"
        : null;
  if (!required) return;
  const approval = config.approvals.find(
    (entry) =>
      entry.decisionId === required &&
      entry.selection.trim() &&
      entry.approvalRef.trim() &&
      entry.approvedAt.trim(),
  );
  if (!approval)
    throw new Error(
      `Scenario ${scenario.family} is blocked pending explicit author approval: ${required}`,
    );
  if (scenario.family === "S9")
    throw new Error(
      "S9 has an approval record, but the selected Γ semantics are not wired into the scenario evaluator; refusing to infer a mapping",
    );
  if (scenario.family === "S12") {
    const probability = Number(config.parameters["mimicVerificationFailureProbability"]);
    if (!Number.isFinite(probability) || String(probability) !== approval.selection)
      throw new Error(
        "S12 configured mimic probability must exactly match the author-approved selection",
      );
  }
}

export function assertCalibrationSeedSet(
  seeds: readonly number[],
  testSeeds: readonly number[],
): void {
  const expected = [1, 2, 3, 4, 5];
  if (seeds.length !== expected.length || expected.some((seed, i) => seeds[i] !== seed))
    throw new Error("Calibration may use only ordered seeds 1–5");
  if (seeds.some((seed) => testSeeds.includes(seed)))
    throw new Error("Test seeds must never be used for calibration");
}

export function assertDisjointSeedSets(
  calibration: readonly number[],
  test: readonly number[],
): void {
  const overlap = calibration.filter((seed) => test.includes(seed));
  if (overlap.length) throw new Error(`Calibration/test seed overlap: ${overlap.join(", ")}`);
}

export function assertProtocolSeedSets(
  calibration: readonly number[],
  test: readonly number[],
): void {
  assertCalibrationSeedSet(calibration, test);
  const expectedTest = Array.from({ length: 30 }, (_, i) => i + 101);
  if (test.length !== expectedTest.length || expectedTest.some((seed, i) => test[i] !== seed))
    throw new Error("Test evaluation may use only ordered seeds 101–130");
}
