import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { evaluateMcac } from "../lib/mcac/decision.ts";
import { assertAuthorApprovals } from "../lib/mcac/experiment/decision-gate.ts";
import {
  applyStepUpOutcome,
  computeMetrics,
  evaluateRows,
  evaluators,
  FAMILIES,
  generateScenarioStream,
  makePolicy,
} from "../lib/mcac/experiment/harness.ts";
import { measureClockReadOverhead } from "../lib/mcac/experiment/latency.ts";
import { callLocalPdp } from "../lib/mcac/experiment/pdp-boundary.ts";
import type {
  EvaluationRow,
  ExperimentConfig,
  GeneratedScenario,
  SystemId,
} from "../lib/mcac/experiment/types.ts";

const out = "research/experiments/pilot";
const require = createRequire(import.meta.url);
const config: ExperimentConfig = {
  schemaVersion: 1,
  configId: "mcac-phase2-provisional-pilot-v1",
  policyVersion: "pilot-provisional-v1",
  generatedAt: new Date().toISOString(),
  seeds: { calibration: [1, 2, 3, 4, 5], test: Array.from({ length: 30 }, (_, i) => i + 101) },
  instancesPerFamily: 250,
  testFamilies: 12,
  degradationRates: [0, 0.1, 0.2, 0.4],
  pilot: { instancesPerFamily: 2, latencyWarmups: 2, latencySamples: 4, runs: 1 },
  parameters: {
    workHours: [9, 17],
    allowedNetworks: ["corporate", "vpn", "known"],
    frequencyLimits: { corporate: 20, vpn: 10, known: 5, unknown: 1 },
    historyNoveltyMinimum: 1,
    expectedTransitionMinimum: 1,
    freshnessSeconds: 300,
    verificationRequiredItems: [
      "time",
      "location",
      "network",
      "device",
      "session",
      "frequency",
      "history",
      "navigation",
      "request",
    ],
    mimicVerificationFailureProbability: 0.5,
    unresolved: [
      "S9 same-category Γ semantics",
      "mimic-verification probability",
      "calibration objective and parameter-search space",
    ],
  },
  decisionsRequired: [
    "S9 Γ semantics",
    "mimic-verification probability",
    "calibration objective/search space",
  ],
  approvals: [],
  status: "PROVISIONAL_PILOT_ONLY",
};
assertAuthorApprovals(config);
mkdirSync(out, { recursive: true });
const scenarios = generateScenarioStream(1, config.pilot.instancesPerFamily);
const rows = evaluateRows(scenarios, config);
const checks: Record<string, { passed: boolean; evidence: unknown }> = {};
const check = (name: string, passed: boolean, evidence: unknown) => {
  checks[name] = { passed, evidence };
};

check("all twelve families generated", new Set(scenarios.map((s) => s.family)).size === 12, {
  count: new Set(scenarios.map((s) => s.family)).size,
  families: FAMILIES.map(([id]) => id),
});
check(
  "S7 baseline denial",
  rows.filter((r) => r.scenario.family === "S7").every((r) => r.decision === "DENY"),
  rows.filter((r) => r.scenario.family === "S7").map((r) => [r.system, r.decision]),
);
const benignDeviant = scenarios.some(
  (s) => s.intent === "benign" && s.input.context.environmental.network.value === "unknown",
);
const violatingNormal = scenarios.some(
  (s) =>
    s.intent === "violating" &&
    s.family === "S1" &&
    s.input.context.environmental.device.value?.registered === true,
);
check("labels independent with both counterfactual classes", benignDeviant && violatingNormal, {
  benignDeviant,
  violatingNormal,
});
check(
  "B1/B2 distinguish static environmental policy",
  rows.find((r) => r.scenario.family === "S2" && r.system === "B1")?.decision !==
    rows.find((r) => r.scenario.family === "S2" && r.system === "B2")?.decision,
  rows
    .filter((r) => r.scenario.family === "S2" && ["B1", "B2"].includes(r.system))
    .map((r) => [r.system, r.decision]),
);
check(
  "B3/B5 distinguish behavioral ablation",
  rows.find((r) => r.scenario.family === "S6" && r.system === "B3")?.decision !==
    rows.find((r) => r.scenario.family === "S6" && r.system === "B5")?.decision,
  rows
    .filter((r) => r.scenario.family === "S6" && ["B3", "B5"].includes(r.system))
    .map((r) => [r.system, r.decision]),
);
check(
  "B4/B5 distinguish environmental ablation",
  rows.find((r) => r.scenario.family === "S3" && r.system === "B4")?.decision !==
    rows.find((r) => r.scenario.family === "S3" && r.system === "B5")?.decision,
  rows
    .filter((r) => r.scenario.family === "S3" && ["B4", "B5"].includes(r.system))
    .map((r) => [r.system, r.decision]),
);
const thresholdCase = generateScenarioStream(1, 1).find((s) => s.family === "S1")!;
const thresholdInput = {
  ...thresholdCase.input,
  policy: makePolicy("H", { gamma: true }),
  context: {
    ...thresholdCase.input.context,
    environmental: {
      ...thresholdCase.input.context.environmental,
      network: { ...thresholdCase.input.context.environmental.network, value: "vpn" as const },
    },
    behavioral: {
      ...thresholdCase.input.context.behavioral,
      frequency: {
        ...thresholdCase.input.context.behavioral.frequency,
        value: { count: 11, windowSeconds: 60 },
      },
    },
  },
};
const thresholdB5 = evaluateMcac(thresholdInput).decision;
const thresholdB6 = (await import("../lib/mcac/experiment/harness.ts")).evaluators.B6(
  thresholdInput,
  config,
).decision;
check("B5/B6 distinguish interaction threshold", thresholdB5 !== thresholdB6, {
  B5: thresholdB5,
  B6: thresholdB6,
});
const repeated = evaluateRows(scenarios, config);
check(
  "paired step-up outcomes reproducible",
  rows.map((r) => r.stepUpPassed).join(",") === repeated.map((r) => r.stepUpPassed).join(","),
  { rows: rows.length },
);
check(
  "mimic step-up semantics",
  !applyStepUpOutcome("violating", "S12", 0.1, 0.5) &&
    applyStepUpOutcome("violating", "S12", 0.9, 0.5),
  { pFailure: 0.5 },
);
const traceRows = rows.filter((r) => r.trace);
check(
  "independent reference replay",
  traceRows.every((r) => r.replayMatches === true),
  { total: traceRows.length, matches: traceRows.filter((r) => r.replayMatches).length },
);
check(
  "trace completeness",
  traceRows.every((r) => r.traceComplete === true),
  { total: traceRows.length, complete: traceRows.filter((r) => r.traceComplete).length },
);

const degradationChecks = [];
const degradationInputs: { rate: number; seed: number; scenarios: GeneratedScenario[] }[] = [];
for (const rate of config.degradationRates) {
  const batch = generateScenarioStream(37, 100, rate);
  degradationInputs.push({ rate, seed: 37 ^ 0x5eed, scenarios: batch });
  const totalItems = batch.length * 9;
  const degradedItems = batch.reduce((n, scenario) => n + (scenario.degradation?.length ?? 0), 0);
  const actualRate = degradedItems / totalItems;
  const opCounts = Object.fromEntries(
    ["missing", "stale", "unverifiable", "contradictory"].map((op) => [
      op,
      batch.flatMap((s) => s.degradation ?? []).filter((x) => x.operation === op).length,
    ]),
  );
  const operationsBalanced =
    degradedItems === 0 ||
    Object.values(opCounts).every((count) => Math.abs(count / degradedItems - 0.25) <= 0.06);
  degradationChecks.push({
    rate,
    seed: 37 ^ 0x5eed,
    totalItems,
    degradedItems,
    actualRate,
    opCounts,
    operationsBalanced,
    withinPilotTolerance: Math.abs(actualRate - rate) <= 0.02 && operationsBalanced,
  });
}
check(
  "degradation rates and operation balance",
  degradationChecks.every((x) => x.withinPilotTolerance),
  degradationChecks,
);
const handFixture = [
  { intent: "violating", decision: "ALLOW", endToEndAccepted: true },
  { intent: "violating", decision: "VERIFY", endToEndAccepted: false },
  { intent: "benign", decision: "DENY", endToEndAccepted: false },
  { intent: "benign", decision: "VERIFY", endToEndAccepted: true },
].map(
  (x, i) =>
    ({
      system: "B1" as SystemId,
      scenario: { ...scenarios[i]!, intent: x.intent } as GeneratedScenario,
      decision: x.decision,
      trace: null,
      input: null,
      stepUpPassed: null,
      endToEndAccepted: x.endToEndAccepted,
      latencyMs: 1,
      latencyStartMonotonicMs: 0,
      latencyEndMonotonicMs: 1,
      coreEvaluatorLatencyMs: 0.5,
      traceComplete: null,
      replayMatches: null,
    }) as EvaluationRow,
);
const fixtureMetrics = computeMetrics(handFixture);
check(
  "hand-checkable metric fixture",
  fixtureMetrics.FAR === 0.5 &&
    fixtureMetrics.FRR === 0.5 &&
    fixtureMetrics.CR === 0.5 &&
    Math.abs(Number(fixtureMetrics.precision) - 1 / 3) < 1e-12 &&
    fixtureMetrics.recall === 0.5 &&
    Math.abs(Number(fixtureMetrics.F1) - 0.4) < 1e-12 &&
    fixtureMetrics.FAR_e2e === 0.5,
  fixtureMetrics,
);
const latencySamples: Record<string, { pepToPdpMs: number[]; coreEvaluatorMs: number[] }> = {};
for (const system of ["B1", "B2", "B3", "B4", "B5", "B6"] as const) {
  const evaluator = evaluators[system];
  const traceAppendBuffer = [];
  let previousHash = "GENESIS";
  const runCall = (scenario: GeneratedScenario) => {
    const call = callLocalPdp({
      request: scenario.input,
      shouldCollectContext: system !== "B1",
      prepareRequest: (request) => ({ ...request, previousHash }),
      collectContext: (request) => ({
        context: request.context,
        consistencyEvidence: request.consistencyEvidence,
      }),
      evaluate: (request) => evaluator(request, config),
      appendTrace: (trace) => {
        traceAppendBuffer.push(trace);
        previousHash = trace.hash;
      },
    });
    return {
      pepToPdpMs: call.measurement.durationMs,
      coreEvaluatorMs: call.evaluation.coreEvaluatorLatencyMs ?? 0,
    };
  };
  for (let i = 0; i < config.pilot.latencyWarmups; i++) runCall(scenarios[i % scenarios.length]!);
  const samples = Array.from({ length: config.pilot.latencySamples }, (_, i) =>
    runCall(scenarios[(i + config.pilot.latencyWarmups) % scenarios.length]!),
  );
  latencySamples[system] = {
    pepToPdpMs: samples.map((x) => x.pepToPdpMs),
    coreEvaluatorMs: samples.map((x) => x.coreEvaluatorMs),
  };
}
const clockOverhead = measureClockReadOverhead();
check(
  "PEP-to-PDP latency sample collection",
  Object.values(latencySamples).every(
    (sample) =>
      sample.pepToPdpMs.length === config.pilot.latencySamples &&
      sample.coreEvaluatorMs.length === config.pilot.latencySamples,
  ),
  "monotonic start before local PDP dispatch; stop after the returned decision; in-memory context lookup, PDP evaluation and pre-return hash-chain trace append included; caller setup/reporting excluded",
);

const failed = Object.entries(checks)
  .filter(([, value]) => !value.passed)
  .map(([name]) => name);
const blocked = [
  "S9 Table IX conflicting-region semantics require Γ scope clarification",
  "mimic verification probability is unspecified",
  "calibration objective/search domain unspecified; provisional policy cannot be frozen",
];
const report = {
  status: failed.length === 0 && blocked.length === 0 ? "PASS" : "FAIL",
  gate: "pilot must pass before test-seed evaluation",
  config,
  pilotSeed: 1,
  generatedRequestCount: scenarios.length,
  evaluatedRowCount: rows.length,
  checks,
  failures: failed,
  blocked,
  decisionStageAndEndToEndMetricsSeparated: true,
  perSystemPilotMetricsExcludingBlockedS9: Object.fromEntries(
    (["B1", "B2", "B3", "B4", "B5", "B6"] as const).map((id) => [
      id,
      computeMetrics(rows.filter((r) => r.system === id && r.scenario.family !== "S9")),
    ]),
  ),
  blockedS9Rows: rows.filter((r) => r.scenario.family === "S9").length,
  latencyMeasurement: {
    samples: latencySamples,
    boundary:
      "PEP local function call to PDP decision response; baseline-authorized in-memory context lookup and in-process hash-chain trace append included",
    warmupsPerSystem: config.pilot.latencyWarmups,
    measuredPerSystem: config.pilot.latencySamples,
    clock: "performance.now() monotonic",
    clockReadOverhead: clockOverhead,
    overheadSubtracted: false,
    fullProtocolLatencyPlan:
      "2,000 warmups; 20,000 measured requests per system/configuration; 10 independent runs",
  },
  environment: {
    platform: `${os.platform()} ${os.release()}`,
    architecture: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? null,
    cores: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
    typescript: ts.version,
    next: (require("next/package.json") as { version: string }).version,
    betterSqlite3: (require("better-sqlite3/package.json") as { version: string }).version,
    commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    workingTreeDirty: true,
    harnessAndServicesShareHost: "no external service is started by this pilot",
  },
};
writeFileSync(
  `${out}/generator-config.json`,
  JSON.stringify(
    {
      seed: 1,
      instancesPerFamily: 2,
      families: FAMILIES,
      degradationRates: config.degradationRates,
    },
    null,
    2,
  ),
);
writeFileSync(
  `${out}/policy-config-provisional.json`,
  JSON.stringify(
    {
      configId: config.configId,
      parameters: config.parameters,
      decisionsRequired: config.decisionsRequired,
      systems: ["B1", "B2", "B3", "B4", "B5", "B6"],
    },
    null,
    2,
  ),
);
writeFileSync(
  `${out}/seed-manifest.json`,
  JSON.stringify(
    {
      generatorVersion: "mcac-pilot-v1",
      pilot: [1],
      calibration: config.seeds.calibration,
      test: config.seeds.test,
      contextGenerator: "Mulberry32-style PRNG seeded per stream",
      familyIntent: "primary label with deterministic index-based counterfactual assignment",
      degradationSeed: "requestSeed XOR 0x5eed",
      pairedRequestsAcrossSystems: true,
    },
    null,
    2,
  ),
);
writeFileSync(`${out}/raw-scenarios.json`, JSON.stringify(scenarios, null, 2));
writeFileSync(`${out}/raw-degradation-scenarios.json`, JSON.stringify(degradationInputs, null, 2));
writeFileSync(`${out}/per-request-decisions.json`, JSON.stringify(rows, null, 2));
writeFileSync(`${out}/latency-samples.json`, JSON.stringify(latencySamples, null, 2));
writeFileSync(`${out}/pilot-report.json`, JSON.stringify(report, null, 2));
writeFileSync(
  `${out}/run.log`,
  `${new Date().toISOString()} status=${report.status}; failures=${failed.join("|")}; blocked=${blocked.join("|")}\n`,
);
console.log(
  JSON.stringify({ status: report.status, failures: failed, blocked, output: out }, null, 2),
);
