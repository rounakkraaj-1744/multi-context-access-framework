import type { AuthorizationInput, McacDecision, McacTrace } from "../types";

export type ScenarioId = `S${number}`;
export type Intent = "benign" | "violating";
export type SystemId = "B1" | "B2" | "B3" | "B4" | "B5" | "B6";
export type AuthorApproval = Readonly<{ decisionId: string; selection: string; approvedAt: string; approvalRef: string }>;
export type PrimaryIntent = Intent | "mixed";
export type PrimaryContextCategory = "Both" | "Environmental" | "Behavioral" | "Baseline";
export type GeneratedScenario = Readonly<{
  id: string; seed: number; family: ScenarioId; familyLabel: string; primaryIntent: PrimaryIntent;
  primaryContextCategory: PrimaryContextCategory; expectedPolicyOutcome: string;
  intent: Intent; resourceSensitivity: "L" | "H"; input: AuthorizationInput;
  degradation: null | readonly Readonly<{ rate: number; seed: number; operation: "missing" | "stale" | "unverifiable" | "contradictory"; item: string }>[];
}>;
export type EvaluationRow = Readonly<{
  system: SystemId; scenario: GeneratedScenario; decision: McacDecision;
  trace: McacTrace | null; input: AuthorizationInput | null;
  stepUpPassed: boolean | null; endToEndAccepted: boolean;
  latencyMs: number; latencyStartMonotonicMs: number; latencyEndMonotonicMs: number;
  coreEvaluatorLatencyMs: number; traceComplete: boolean | null; replayMatches: boolean | null;
}>;
export type SystemEvaluator = (input: AuthorizationInput, config: ExperimentConfig) => Readonly<{ decision: McacDecision; trace: McacTrace | null; replayInput: AuthorizationInput | null; coreEvaluatorLatencyMs?: number }>;
export type ExperimentConfig = Readonly<{
  schemaVersion: 1; configId: string; policyVersion: string; generatedAt: string;
  seeds: Readonly<{ calibration: readonly number[]; test: readonly number[] }>;
  instancesPerFamily: number; testFamilies: number; degradationRates: readonly number[];
  pilot: Readonly<{ instancesPerFamily: number; latencyWarmups: number; latencySamples: number; runs: number }>;
  parameters: Readonly<Record<string, unknown>>;
  decisionsRequired: readonly string[];
  approvals: readonly AuthorApproval[];
  status: "PROVISIONAL_PILOT_ONLY" | "FROZEN_FOR_TEST";
}>;
export type MetricSet = Readonly<Record<string, number | null | number[]>>;
