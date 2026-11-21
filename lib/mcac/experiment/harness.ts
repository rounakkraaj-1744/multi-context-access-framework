import { performance } from "node:perf_hooks";
import { evaluateMcac } from "../decision";
import { evaluateReference } from "../reference/equation-19";
import { assertScenarioApproval } from "./decision-gate";
import { callLocalPdp } from "./pdp-boundary";
import type { AuthorizationInput, ContextEvidence, ContextEvidenceItem, ContextItemKind, ContextValueMap, McacTrace, PolicyVersion } from "../types";
import type { EvaluationRow, ExperimentConfig, GeneratedScenario, Intent, MetricSet, PrimaryContextCategory, PrimaryIntent, SystemEvaluator, SystemId } from "./types";

export const FAMILIES = [
  ["S1", "Registered device, expected window, corporate network", "benign", "ALLOW", "Both"],
  ["S2", "Stolen credential from a new device on an unknown network", "violating", "VERIFY or DENY by sensitivity", "Environmental"],
  ["S3", "Legitimate user on a replacement device", "benign", "VERIFY (accepted friction)", "Environmental"],
  ["S4", "Unfamiliar network with a known device", "mixed", "VERIFY", "Environmental"],
  ["S5", "Request outside the configured time window", "mixed", "VERIFY (L); DENY if hard (H)", "Environmental"],
  ["S6", "Sudden burst of requests (scripted extraction)", "violating", "VERIFY or DENY", "Behavioral"],
  ["S7", "Resource outside the user's baseline permissions", "violating", "DENY by baseline (all systems)", "Baseline"],
  ["S8", "Change in navigation or resource-access pattern", "mixed", "VERIFY", "Behavioral"],
  ["S9", "Conflicting signals (e.g., known device but inconsistent region)", "mixed", "VERIFY (L); DENY (H) via status X", "Both"],
  ["S10", "Missing or stale context (PIP outage, stale token)", "mixed", "VERIFY (L); DENY (H)", "Both"],
  ["S11", "Legitimate user whose circumstances changed (new project, emergency)", "benign", "VERIFY (accepted friction)", "Behavioral"],
  ["S12", "Mimic reproducing normal context and behavior", "violating", "ALLOW (residual risk, reported)", "Both"],
] as const;
const KINDS: readonly ContextItemKind[] = ["time", "location", "network", "device", "session", "frequency", "history", "navigation", "request"];
const E_KINDS = new Set<ContextItemKind>(["time", "location", "network", "device"]);
function gammaPartner(kind: ContextItemKind): ContextItemKind { return E_KINDS.has(kind) ? "frequency" : "network"; }

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function raw<K extends ContextItemKind>(kind: K, value: ContextValueMap[K] | null, at: number, sourceClass: "srv" | "ext" = "srv", integrityFlag: 0 | 1 = 1): ContextEvidenceItem<K> {
  return { kind, value, observedAt: value === null ? null : at, sourceClass: value === null ? null : sourceClass, integrityFlag: value === null ? 0 : integrityFlag } as ContextEvidenceItem<K>;
}
function buildContext(at: number, change: "normal" | "new-device" | "unknown-network" | "new-device-unknown-network" | "outside-time" | "burst" | "new-navigation" | "changed-project" | "network-shift" | "missing-context" | "stale-context" = "normal"): ContextEvidence {
  const network = change === "unknown-network" || change === "new-device-unknown-network" ? "unknown" : change === "network-shift" ? "vpn" : "corporate";
  const deviceOk = change !== "new-device" && change !== "new-device-unknown-network";
  const hour = change === "outside-time" ? 22 : 11;
  const frequency = change === "burst" ? 25 : change === "network-shift" ? 15 : change === "changed-project" ? 8 : 4;
  const historyCount = change === "changed-project" ? 0 : 5;
  const navCount = change === "new-navigation" ? 0 : 4;
  return {
    environmental: {
      time: raw("time", { weekday: 2, hour, timezone: "UTC" }, at),
      location: raw("location", { country: "IN", region: change === "network-shift" ? "east" : "south" }, at, "ext", 1),
      network: change === "missing-context" ? raw("network", null, at)
        : change === "stale-context" ? { ...raw("network", network, at), observedAt: at - 3600_000 }
        : raw("network", network, at),
      device: raw("device", { registered: deviceOk, deviceId: deviceOk ? "device-1" : "replacement-device", tokenAgeSeconds: 30 }, at),
    },
    behavioral: {
      session: raw("session", { method: "password", ageSeconds: 60 }, at),
      frequency: raw("frequency", { count: frequency, windowSeconds: 60 }, at),
      history: raw("history", { classes: [{ resourceClass: "payroll", count: historyCount }], windowDays: 30, enrollmentComplete: true }, at),
      navigation: raw("navigation", { previousClass: "engineering", currentClass: "payroll", transitionCount: navCount, enrollmentComplete: true }, at),
      request: raw("request", { resourceClass: "payroll", actionClass: "export" }, at),
    },
  };
}

function familyChange(family: string, i: number): Parameters<typeof buildContext>[1] {
  switch (family) {
    case "S2": return "new-device-unknown-network";
    case "S3": return "new-device";
    case "S4": return i % 2 === 0 ? "unknown-network" : "normal";
    case "S5": return i % 2 === 0 ? "outside-time" : "normal";
    case "S6": return "burst";
    case "S8": return "new-navigation";
    case "S9": return "network-shift";
    case "S10": return i % 2 === 0 ? "missing-context" : "stale-context";
    case "S11": return "changed-project";
    default: return "normal";
  }
}
function degrade(input: AuthorizationInput, operation: NonNullable<GeneratedScenario["degradation"]>[number]["operation"], kind: ContextItemKind, at: number): AuthorizationInput {
  const group = E_KINDS.has(kind) ? input.context.environmental : input.context.behavioral;
  const old = group[kind as keyof typeof group] as ContextEvidenceItem;
  let next: ContextEvidenceItem;
  if (operation === "missing") next = raw(kind, null, at);
  else if (operation === "stale") next = { ...old, observedAt: at - 3600_000 } as ContextEvidenceItem;
  else if (operation === "unverifiable") next = { ...old, sourceClass: "ext", integrityFlag: 0 } as ContextEvidenceItem;
  else next = old; // Contradiction is injected through an explicit cross-category Γ outcome below.
  const context = E_KINDS.has(kind)
    ? { ...input.context, environmental: { ...input.context.environmental, [kind]: next } }
    : { ...input.context, behavioral: { ...input.context.behavioral, [kind]: next } };
  const evidence = operation === "contradictory"
    ? input.consistencyEvidence.map((entry) => entry.id === `pilot-${kind}` ? { ...entry, violated: true } : entry)
    : input.consistencyEvidence;
  return { ...input, context: context as ContextEvidence, consistencyEvidence: evidence };
}

export function makePolicy(sensitivity: "L" | "H", options: { gamma?: boolean; interactions?: boolean; noEnvironmental?: boolean; noBehavioral?: boolean } = {}): PolicyVersion {
  const window = { id: "work-window", item: "time" as const, comparator: "in_window" as const, parameter: { startHour: 9, endHour: 17 }, strength: "soft" as const };
  const device = { id: "registered-device", item: "device" as const, comparator: "registered" as const, parameter: true, strength: "soft" as const };
  const network = { id: "allowed-network", item: "network" as const, comparator: "in" as const, parameter: ["corporate", "vpn", "known"], strength: "soft" as const };
  const frequency = { id: "request-rate", item: "frequency" as const, comparator: "lte" as const, parameter: { by: "network" as const, values: { corporate: 20, vpn: 10, known: 5, unknown: 1 } }, strength: "soft" as const };
  const history = { id: "history-non-novel", item: "history" as const, comparator: "not_novel" as const, parameter: 1, strength: "soft" as const };
  const navigation = { id: "expected-navigation", item: "navigation" as const, comparator: "expected_transition" as const, parameter: 1, strength: "soft" as const };
  const rule = { id: "main", resourceClass: "payroll", actions: ["export"] as const,
    environmental: options.noEnvironmental ? [] : [window, device, network],
    behavioral: options.noBehavioral ? [] : [frequency, history, navigation], failOpen: 0 as const };
  const gamma = options.gamma ? KINDS.map((kind) => ({ id: `pilot-${kind}`, items: [kind, gammaPartner(kind)] as const })) : [];
  return {
    version: "pilot-provisional-v1", resourceProfiles: { payroll: { sensitivity, stepUpAvailable: true, waiverDurationSeconds: 300 } },
    freshnessSeconds: Object.fromEntries(KINDS.map((k) => [k, 300])) as PolicyVersion["freshnessSeconds"],
    verificationRequired: Object.fromEntries(KINDS.map((k) => [k, 1])) as PolicyVersion["verificationRequired"],
    consistencyConstraints: gamma, expectedTransitions: [{ previousClass: "engineering", currentClass: "payroll" }], rules: [rule], strictLowSensitivity: false,
    interactions: { environmentConditionedThresholds: options.interactions ?? true, crossCategoryConsistency: options.interactions ?? true },
  };
}

export function generateScenarioStream(seed: number, perFamily: number, degradationRate = 0, degradationSeed = seed ^ 0x5eed): GeneratedScenario[] {
  const contextRng = rng(seed), degradationRng = rng(degradationSeed);
  const at = Date.UTC(2026, 0, 1, 11);
  const rows: GeneratedScenario[] = [];
  for (const [family, label, primary, expectedPolicyOutcome, category] of FAMILIES) for (let i = 0; i < perFamily; i++) {
    const sensitivity = i % 2 === 0 ? "H" : "L";
    const basePermission = family !== "S7";
    let intent: Intent = primary === "mixed" ? (i % 2 === 0 ? "benign" : "violating") : primary;
    // Independent label stream creates counterfactual normal violations and deviant benign requests.
    if (family !== "S7" && family !== "S12" && primary !== "mixed" && i % 10 === 0) intent = intent === "benign" ? "violating" : "benign";
    // Consume but do not branch on the context stream; intent remains independent of context/evaluators.
    const jitter = Math.floor(contextRng() * 2);
    let input: AuthorizationInput = {
      request: { requestId: `${seed}-${family}-${i}`, time: at, userId: `user-${i % 17}`, sessionId: `session-${i % 11}`, resourceId: family === "S7" ? "restricted" : "payroll-${i % 3}", resourceClass: "payroll", action: "export" },
      baselinePermission: basePermission, policy: makePolicy(sensitivity, { gamma: true }), context: buildContext(at, familyChange(family, i + jitter)), consistencyEvidence: KINDS.map((kind) => ({ id: `pilot-${kind}`, violated: false })), waiver: null, previousHash: "GENESIS",
    };
    const degradationOperations: NonNullable<GeneratedScenario["degradation"]>[number][] = [];
    if (degradationRate > 0) for (const kind of KINDS) {
      const selection = degradationRng();
      const operationDraw = degradationRng();
      if (selection < degradationRate) {
        const op = (["missing", "stale", "unverifiable", "contradictory"] as const)[Math.floor(operationDraw * 4)]!;
        input = degrade(input, op, kind, at);
        degradationOperations.push({ rate: degradationRate, seed: degradationSeed, operation: op, item: kind });
      }
    }
    const degradation: GeneratedScenario["degradation"] = degradationOperations.length ? degradationOperations : null;
    rows.push({ id: input.request.requestId, seed, family, familyLabel: label, primaryIntent: primary as PrimaryIntent, primaryContextCategory: category as PrimaryContextCategory, expectedPolicyOutcome, intent, resourceSensitivity: sensitivity, input, degradation });
  }
  return rows;
}

const withPolicy = (input: AuthorizationInput, policy: PolicyVersion): AuthorizationInput => ({ ...input, policy });
export const evaluators: Readonly<Record<SystemId, SystemEvaluator>> = {
  B1: (input) => {
    const start = performance.now();
    const decision = input.baselinePermission ? "ALLOW" : "DENY";
    return { decision, trace: null, replayInput: null, coreEvaluatorLatencyMs: performance.now() - start };
  },
  B2: (input) => {
    const start = performance.now();
    if (!input.baselinePermission) return { decision: "DENY", trace: null, replayInput: null, coreEvaluatorLatencyMs: performance.now() - start };
    const e = input.context.environmental;
    const ok = e.time.value !== null && e.network.value !== null && e.device.value !== null &&
      e.time.value.hour >= 9 && e.time.value.hour < 17 && ["corporate", "vpn", "known"].includes(e.network.value) && e.device.value.registered;
    return { decision: ok ? "ALLOW" : "DENY", trace: null, replayInput: null, coreEvaluatorLatencyMs: performance.now() - start };
  },
  B3: (input) => runAblation(input, makePolicy(input.policy.resourceProfiles.payroll!.sensitivity, { gamma: true, noBehavioral: true })),
  B4: (input) => runAblation(input, makePolicy(input.policy.resourceProfiles.payroll!.sensitivity, { gamma: true, noEnvironmental: true })),
  B5: (input) => runMcac(input),
  B6: (input) => {
    const p = makePolicy(input.policy.resourceProfiles.payroll!.sensitivity, { gamma: false, interactions: false });
    const constant = p.rules.map((r) => ({ ...r, behavioral: r.behavioral.map((c) => c.id === "request-rate" ? { ...c, parameter: 12 } : c) }));
    return runAblation(input, { ...p, rules: constant });
  },
};
function runAblation(input: AuthorizationInput, p: PolicyVersion) {
  return runMcac({ ...withPolicy(input, p), consistencyEvidence: p.interactions.crossCategoryConsistency ? input.consistencyEvidence : [] });
}
function runMcac(input: AuthorizationInput) {
  const start = performance.now();
  const result = evaluateMcac(input);
  return { decision: result.decision, trace: result.trace, replayInput: input, coreEvaluatorLatencyMs: performance.now() - start };
}

export function evaluateRows(scenarios: readonly GeneratedScenario[], config: ExperimentConfig, ids: readonly SystemId[] = ["B1", "B2", "B3", "B4", "B5", "B6"]): EvaluationRow[] {
  const output: EvaluationRow[] = [];
  const traceAppendBuffers = new Map<SystemId, McacTrace[]>();
  const chainHeads = new Map<SystemId, string>();
  for (const scenario of scenarios) for (const system of ids) {
    const evaluator = evaluators[system];
    assertScenarioApproval(scenario, config);
    let coreEvaluatorLatencyMs = 0;
    const pdpCall = callLocalPdp({
      request: scenario.input,
      shouldCollectContext: system !== "B1",
      prepareRequest: (request) => ({ ...request, previousHash: chainHeads.get(system) ?? request.previousHash }),
      collectContext: (request) => ({ context: request.context, consistencyEvidence: request.consistencyEvidence }),
      evaluate: (request) => {
        const result = evaluator(request, config);
        coreEvaluatorLatencyMs = result.coreEvaluatorLatencyMs ?? 0;
        return result;
      },
      appendTrace: (trace) => {
        const appendBuffer = traceAppendBuffers.get(system) ?? [];
        appendBuffer.push(trace);
        traceAppendBuffers.set(system, appendBuffer);
        chainHeads.set(system, trace.hash);
      },
    });
    const result = pdpCall.evaluation;
    const measurement = pdpCall.measurement;
    const latencyMs = measurement.durationMs;
    const reference = result.replayInput ? evaluateReference(result.replayInput) : null;
    const replayMatches = result.trace ? reference?.decision === result.decision : null;
    const conditionCount = result.trace?.conditions.length ?? 0;
    const expectedConditions = scenario.input.baselinePermission
      ? result.replayInput?.policy.rules.filter((r) => r.resourceClass === scenario.input.request.resourceClass && r.actions.includes(scenario.input.request.action)).reduce((n, r) => n + r.environmental.length + r.behavioral.length, 0) ?? -1
      : 0;
    const traceComplete = result.trace ? conditionCount === expectedConditions : null;
    const stepUpPassed = result.decision === "VERIFY" ? applyStepUpOutcome(
      scenario.intent, scenario.family, seededStepUpRandom(scenario.id, scenario.seed),
      Number(config.parameters["mimicVerificationFailureProbability"]),
    ) : null;
    const endToEndAccepted = result.decision === "ALLOW" || (result.decision === "VERIFY" && stepUpPassed === true);
    output.push({ system, scenario, decision: result.decision, trace: result.trace, input: result.replayInput, stepUpPassed, endToEndAccepted,
      latencyMs, latencyStartMonotonicMs: measurement.startMonotonicMs, latencyEndMonotonicMs: measurement.endMonotonicMs,
      coreEvaluatorLatencyMs, traceComplete, replayMatches });
  }
  return output;
}

export function computeMetrics(rows: readonly EvaluationRow[]): MetricSet {
  const viol = rows.filter((r) => r.scenario.intent === "violating"); const benign = rows.filter((r) => r.scenario.intent === "benign");
  const tp = viol.filter((r) => r.decision !== "ALLOW").length;
  const fn = viol.filter((r) => r.decision === "ALLOW").length;
  const fp = benign.filter((r) => r.decision !== "ALLOW").length;
  const den = (n: number, d: number): number | null => d === 0 ? null : n / d;
  const precision = den(tp, tp + fp); const recall = den(tp, tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall);
  const e2e = viol.filter((r) => r.endToEndAccepted).length;
  const traceRows = rows.filter((r) => r.trace !== null);
  const covByTrace = traceRows.map((r) => {
    const refs = r.trace!.conditions.flatMap((c) => c.itemReferences);
    return refs.length === 0 ? null : refs.filter((kind) => r.trace!.items.find((item) => item.kind === kind)?.validityStatus === "V").length / refs.length;
  });
  const coverage = covByTrace.length === 0 || covByTrace.some((x) => x === null) ? null : covByTrace.reduce<number>((a, x) => a + x!, 0) / covByTrace.length;
  const pct = (xs: number[], q: number): number | null => xs.length ? [...xs].sort((a,b)=>a-b)[Math.ceil(q*xs.length)-1]! : null;
  return {
    n: rows.length, benignN: benign.length, violatingN: viol.length,
    FAR: den(fn, viol.length), FRR: den(benign.filter((r) => r.decision === "DENY").length, benign.length),
    CR: den(benign.filter((r) => r.decision === "VERIFY").length, benign.length),
    precision, recall, F1: f1, FAR_e2e: den(e2e, viol.length), contextCoverage: coverage,
    traceCompleteness: den(traceRows.filter((r) => r.traceComplete).length, traceRows.length),
    replayFidelity: den(traceRows.filter((r) => r.replayMatches).length, traceRows.length),
    p50Ms: pct(rows.map((r) => r.latencyMs), 0.50), p95Ms: pct(rows.map((r) => r.latencyMs), 0.95), p99Ms: pct(rows.map((r) => r.latencyMs), 0.99),
    coreEvaluatorP50Ms: pct(rows.map((r) => r.coreEvaluatorLatencyMs), 0.50), coreEvaluatorP95Ms: pct(rows.map((r) => r.coreEvaluatorLatencyMs), 0.95), coreEvaluatorP99Ms: pct(rows.map((r) => r.coreEvaluatorLatencyMs), 0.99),
  };
}

export function applyStepUpOutcome(intent: Intent, family: string, random: number, mimicFailureProbability: number): boolean {
  if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error("step-up random variate must be in [0, 1)");
  if (!Number.isFinite(mimicFailureProbability) || mimicFailureProbability < 0 || mimicFailureProbability > 1) throw new Error("mimic verification failure probability must be in [0, 1]");
  if (family !== "S12") return intent === "benign";
  return !(random < mimicFailureProbability);
}

function seededStepUpRandom(requestId: string, seed: number): number {
  let requestHash = 2166136261;
  for (const character of requestId) requestHash = Math.imul(requestHash ^ character.charCodeAt(0), 16777619);
  return rng(seed ^ requestHash)();
}
