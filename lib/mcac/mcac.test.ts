import { describe, expect, it } from "vitest";
import { evaluateReference } from "./reference/equation-19";
import { assertPolicyVersionTransition, classifyContext, classifyValidity, decide, evaluateMcac, evaluateMcacForApplication, freezePolicyVersion, replayTrace, verifyTraceHash, type AuthorizationInput, type ContextEvidence, type ContextEvidenceItem, type ContextItemKind, type ContextValueMap, type PolicyVersion } from "./index";

const at = Date.UTC(2026, 0, 1, 12);
const kinds: readonly ContextItemKind[] = ["time", "location", "network", "device", "session", "frequency", "history", "navigation", "request"];
const raw = <K extends ContextItemKind>(kind: K, value: ContextValueMap[K] | null, observedAt: number | null = at, sourceClass: "srv" | "ext" | null = "srv", integrityFlag: 0 | 1 = 1): ContextEvidenceItem<K> => value === null
  ? { kind, value, observedAt: null, sourceClass: null, integrityFlag: 0 } as ContextEvidenceItem<K>
  : { kind, value, observedAt, sourceClass, integrityFlag } as ContextEvidenceItem<K>;
const context: ContextEvidence = {
  environmental: { time: raw("time", { weekday: 4, hour: 12, timezone: "Asia/Kolkata" }), location: raw("location", { country: "IN", region: "IN-KA" }), network: raw("network", "corporate"), device: raw("device", { registered: true, deviceId: "device-1", tokenAgeSeconds: 1 }) },
  behavioral: {
    session: raw("session", { method: "password", ageSeconds: 60 }), frequency: raw("frequency", { count: 12, windowSeconds: 60 }),
    history: raw("history", { classes: [{ resourceClass: "payroll", count: 8 }], windowDays: 30, enrollmentComplete: true }),
    navigation: raw("navigation", { previousClass: "engineering", currentClass: "payroll", transitionCount: 5, enrollmentComplete: true }),
    request: raw("request", { resourceClass: "payroll", actionClass: "export" }),
  },
};
const policy = (rules: PolicyVersion["rules"] = [], overrides: Partial<PolicyVersion> = {}): PolicyVersion => ({
  version: "policy-v1",
  resourceProfiles: { payroll: { sensitivity: "H", stepUpAvailable: true, waiverDurationSeconds: 300 } },
  freshnessSeconds: Object.fromEntries(kinds.map((kind) => [kind, 300])) as PolicyVersion["freshnessSeconds"],
  verificationRequired: Object.fromEntries(kinds.map((kind) => [kind, 1])) as PolicyVersion["verificationRequired"],
  consistencyConstraints: [], expectedTransitions: [], rules, strictLowSensitivity: false,
  interactions: { environmentConditionedThresholds: true, crossCategoryConsistency: true },
  ...overrides,
});
type InputOverrides = Partial<AuthorizationInput> & { sensitivity?: "L" | "H"; stepUpAvailable?: boolean };
const input = (overrides: InputOverrides = {}): AuthorizationInput => {
  const { sensitivity, stepUpAvailable, ...domainOverrides } = overrides;
  const selectedPolicy = domainOverrides.policy ?? policy();
  return {
    request: { requestId: "req-1", time: at, userId: "user-1", sessionId: "session-1", resourceId: "payroll-1", resourceClass: "payroll", action: "export" },
    baselinePermission: true, context, consistencyEvidence: [], waiver: null, previousHash: "GENESIS", ...domainOverrides,
    policy: { ...selectedPolicy, resourceProfiles: { ...selectedPolicy.resourceProfiles, payroll: { ...selectedPolicy.resourceProfiles.payroll!, sensitivity: sensitivity ?? "H", stepUpAvailable: stepUpAvailable ?? true } } },
  };
};
const rule = (environmental: PolicyVersion["rules"][number]["environmental"] = [], behavioral: PolicyVersion["rules"][number]["behavioral"] = [], failOpen: 0 | 1 = 0): PolicyVersion["rules"][number] => ({ id: "r1", resourceClass: "payroll", actions: ["export"], environmental, behavioral, failOpen });

describe("MCAC validity and context definitions (Eq. 2; Sections VIII, XI)", () => {
  it.each([
    ["M", raw("device", null)] as const,
    ["U", raw("device", { registered: true, deviceId: "d", tokenAgeSeconds: 1 }, at, "ext", 0)] as const,
    ["X", raw("device", { registered: true, deviceId: "d", tokenAgeSeconds: 1 })] as const,
    ["S", raw("device", { registered: true, deviceId: "d", tokenAgeSeconds: 1 }, at - 301_000)] as const,
    ["V", raw("device", { registered: true, deviceId: "d", tokenAgeSeconds: 1 })] as const,
  ])("classifies status %s", (expected, item) => {
    const p = policy([], { consistencyConstraints: [{ id: "c1", items: ["device"] }] });
    expect(classifyValidity(item, "device", at, p, expected === "X" ? new Set(["device"]) : new Set())).toBe(expected);
  });
  it("applies the Eq. 2 precedence M, U, X, S, V", () => {
    const p = policy([], { freshnessSeconds: { ...policy().freshnessSeconds, device: 1 } });
    expect(classifyValidity(raw("device", null, at - 99_000, "ext", 0), "device", at, p, new Set(["device"]))).toBe("M");
    const device = { registered: true, deviceId: "d", tokenAgeSeconds: 1 };
    expect(classifyValidity(raw("device", device, at - 99_000, "ext", 0), "device", at, p, new Set(["device"]))).toBe("U");
    expect(classifyValidity(raw("device", device, at - 99_000), "device", at, p, new Set(["device"]))).toBe("X");
    expect(classifyValidity(raw("device", device, at - 99_000), "device", at, p)).toBe("S");
  });
  it("retains separate environmental and behavioral tuples and classifies all nine item types", () => {
    expect(classifyContext(context, policy(), new Set(), at).map((item) => item.kind)).toEqual(kinds);
  });
  it("rejects malformed present tuple metadata rather than silently treating it as valid", () => {
    expect(() => classifyValidity(raw("network", "corporate", null), "network", at, policy())).toThrow(/metadata/);
  });
  it("marks history and navigation missing during behavioral enrollment", () => {
    const notEnrolled = { ...context, behavioral: {
      ...context.behavioral,
      history: raw("history", { classes: [], windowDays: 30, enrollmentComplete: false }),
      navigation: raw("navigation", { previousClass: null, currentClass: "payroll", transitionCount: 0, enrollmentComplete: false }),
    } };
    const items = classifyContext(notEnrolled, policy(), new Set(), at);
    expect(items.find((item) => item.kind === "history")?.validityStatus).toBe("M");
    expect(items.find((item) => item.kind === "navigation")?.validityStatus).toBe("M");
  });
  it("requires the Table VI time/request values and binds request context to q", () => {
    const missingRequest = { ...context, behavioral: { ...context.behavioral, request: raw("request", null) } };
    expect(() => evaluateMcac(input({ context: missingRequest })).decision).toThrow(/cannot be absent/);
    const inconsistent = { ...context, behavioral: { ...context.behavioral, request: raw("request", { resourceClass: "engineering", actionClass: "read" }) } };
    expect(() => evaluateMcac(input({ context: inconsistent })).decision).toThrow(/does not match/);
  });
});

describe("three-valued conditions and severity (Eqs. 5, 7)", () => {
  const c = (id: string, item: ContextItemKind, comparator: "gte" | "eq", parameter: string | number | boolean, strength: "soft" | "hard" = "soft") => ({ id, item, comparator, parameter, strength });
  it.each([
    [{ count: 12, windowSeconds: 60 }, "T"], [{ count: 3, windowSeconds: 60 }, "F"],
  ] as const)("returns %s as an observed condition outcome", (value, expected) => {
    const changed = { ...context, behavioral: { ...context.behavioral, frequency: raw("frequency", value) } };
    const result = evaluateMcac(input({ policy: policy([rule([], [c("f", "frequency", "gte", 10)])]), context: changed }));
    expect(result.conditionEvaluations[0]?.outcome).toBe(expected);
  });
  it.each(["M", "S", "U", "X"] as const)("maps degraded status %s to I", (status) => {
    const frequency = { count: 12, windowSeconds: 60 };
    const freq = status === "M" ? raw("frequency", null) : status === "S" ? raw("frequency", frequency, at - 301_000) : status === "U" ? raw("frequency", frequency, at, "ext", 0) : raw("frequency", frequency);
    const constraints = status === "X" ? [{ id: "cx", items: ["frequency"] as const }] : [];
    const result = evaluateMcac(input({ policy: policy([rule([], [c("f", "frequency", "gte", 10)])], { consistencyConstraints: constraints }), context: { ...context, behavioral: { ...context.behavioral, frequency: freq } }, consistencyEvidence: status === "X" ? [{ id: "cx", violated: true }] : [] }));
    expect(result.conditionEvaluations[0]?.outcome).toBe("I");
  });
  it("maps soft/hard false to 1/2 and high sensitivity indeterminate to equal-strength severity", () => {
    for (const [strength, falseSeverity] of [["soft", 1], ["hard", 2]] as const) {
      const falseResult = evaluateMcac(input({ policy: policy([rule([], [c("f", "frequency", "gte", 99, strength)])]) }));
      const indeterminateContext = { ...context, behavioral: { ...context.behavioral, frequency: raw("frequency", null) } };
      const indeterminate = evaluateMcac(input({ policy: policy([rule([], [c("f", "frequency", "gte", 99, strength)])]), context: indeterminateContext }));
      expect(falseResult.conditionEvaluations[0]?.severity).toBe(falseSeverity);
      expect(indeterminate.conditionEvaluations[0]?.severity).toBe(falseSeverity);
    }
  });
  it("evaluates the paper's history novelty and navigation transition examples", () => {
    const historyRule = rule([], [{ id: "history", item: "history", comparator: "not_novel", parameter: 8, strength: "soft" }]);
    const expectedHistory = evaluateMcac(input({ policy: policy([historyRule]) }));
    expect(expectedHistory.conditionEvaluations[0]?.outcome).toBe("T");
    const novelHistory = { ...context, behavioral: { ...context.behavioral, history: raw("history", { classes: [{ resourceClass: "payroll", count: 7 }], windowDays: 30, enrollmentComplete: true }) } };
    expect(evaluateMcac(input({ policy: policy([historyRule]), context: novelHistory })).conditionEvaluations[0]?.outcome).toBe("F");
    const navigation = { ...context, behavioral: { ...context.behavioral, navigation: raw("navigation", { previousClass: "engineering", currentClass: "payroll", transitionCount: 4, enrollmentComplete: true }) } };
    const transitionRule = rule([], [{ id: "navigation", item: "navigation", comparator: "expected_transition", parameter: 5, strength: "soft" }]);
    expect(evaluateMcac(input({ policy: policy([transitionRule]), context: navigation })).conditionEvaluations[0]?.outcome).toBe("F");
    expect(evaluateMcac(input({ policy: policy([transitionRule], { expectedTransitions: [{ previousClass: "engineering", currentClass: "payroll" }] }), context: navigation })).conditionEvaluations[0]?.outcome).toBe("T");
  });
  it("implements low sensitivity fail-open, default cap, and strict mode exactly", () => {
    const soft = [rule([], [c("f", "frequency", "gte", 1, "soft")])];
    const hard = [rule([], [c("f", "frequency", "gte", 1, "hard")])];
    const missing = { ...context, behavioral: { ...context.behavioral, frequency: raw("frequency", null) } };
    expect(evaluateMcac(input({ sensitivity: "L", policy: policy(soft), context: missing })).severity).toBe(1);
    expect(evaluateMcac(input({ sensitivity: "L", policy: policy(hard), context: missing })).severity).toBe(1);
    expect(evaluateMcac(input({ sensitivity: "L", policy: policy(hard, { strictLowSensitivity: true }), context: missing })).severity).toBe(2);
    expect(evaluateMcac(input({ sensitivity: "L", policy: policy(hard), context: missing })).severity).toBe(1);
    expect(evaluateMcac(input({ sensitivity: "L", policy: policy([rule([], [c("f", "frequency", "gte", 1, "hard")], 1)]), context: missing })).severity).toBe(0);
  });
  it("retains independently attributable environmental and behavioral category maxima", () => {
    const result = evaluateMcac(input({ policy: policy([rule([c("time", "time", "gte", 30)], [c("f", "frequency", "gte", 99)])]) }));
    expect(result.mEnv).toBe(1);
    expect(result.mBeh).toBe(1);
    expect(result.severity).toBe(1);
  });
  it("covers category-only violations, comparator boundaries, and sensitivity-dependent decisions", () => {
    const environmentalOnly = evaluateMcac(input({ policy: policy([rule([{ id: "t", item: "time", comparator: "in_window", parameter: { startHour: 9, endHour: 13 }, strength: "soft" }])]) }));
    expect(environmentalOnly.mEnv).toBe(0);
    expect(environmentalOnly.mBeh).toBe(0);
    const outside = evaluateMcac(input({ policy: policy([rule([{ id: "t", item: "time", comparator: "in_window", parameter: { startHour: 13, endHour: 18 }, strength: "soft" }])]) }));
    expect(outside.mEnv).toBe(1);
    expect(outside.mBeh).toBe(0);
    expect(outside.decision).toBe("VERIFY");
    const highSoft = evaluateMcac(input({ sensitivity: "H", policy: policy([rule([{ id: "t", item: "time", comparator: "in_window", parameter: { startHour: 13, endHour: 18 }, strength: "soft" }])]) }));
    expect(highSoft.decision).toBe("VERIFY");
    const noStepUp = evaluateMcac(input({ stepUpAvailable: false, policy: policy([rule([{ id: "t", item: "time", comparator: "in_window", parameter: { startHour: 13, endHour: 18 }, strength: "soft" }])]) }));
    expect(noStepUp.decision).toBe("DENY");
    const exactFreshness = raw("frequency", { count: 1, windowSeconds: 60 }, at - 300_000);
    expect(classifyValidity(exactFreshness, "frequency", at, policy())).toBe("V");
  });
});

describe("interactions, decision mapping and formal properties (Eqs. 6, 8–12; Section XIII)", () => {
  it("differentially checks the independent Eq. (19) evaluator on defined cases", () => {
    const cases = [
      input({ baselinePermission: false }),
      input(),
      input({ policy: policy([rule([], [{ id: "f", item: "frequency", comparator: "gte", parameter: 99, strength: "soft" }])]) }),
      input({ sensitivity: "L", policy: policy([rule([], [{ id: "f", item: "frequency", comparator: "gte", parameter: 99, strength: "hard" }])]) }),
      input({ policy: policy([rule([{ id: "t", item: "time", comparator: "in_window", parameter: { startHour: 13, endHour: 18 }, strength: "soft" }])]) }),
    ];
    for (const testInput of cases) {
      const actual = evaluateMcac(testInput);
      expect(evaluateReference(testInput)).toEqual({ decision: actual.decision, mEnv: actual.mEnv, mBeh: actual.mBeh, severity: actual.severity });
    }
  });
  it("selects environment-conditioned thresholds and returns an indeterminate result for degraded network", () => {
    const condition = { id: "freq", item: "frequency" as const, comparator: "lte" as const, parameter: { by: "network" as const, values: { corporate: 20, vpn: 10 } }, strength: "soft" as const };
    const p = policy([rule([], [condition])]);
    const good = evaluateMcac(input({ policy: p }));
    expect(good.conditionEvaluations[0]?.outcome).toBe("T");
    expect(good.trace.interactions.some((item) => item.kind === "environment_conditioned_threshold" && item.result === "APPLIED")).toBe(true);
    const degradedNetwork = { ...context, environmental: { ...context.environmental, network: raw("network", "corporate", at - 999_000) } };
    const unknown = evaluateMcac(input({ policy: p, context: degradedNetwork }));
    expect(unknown.conditionEvaluations[0]?.outcome).toBe("I");
    const atThreshold = { ...context, behavioral: { ...context.behavioral, frequency: raw("frequency", { count: 20, windowSeconds: 60 }) } };
    const aboveThreshold = { ...context, behavioral: { ...context.behavioral, frequency: raw("frequency", { count: 21, windowSeconds: 60 }) } };
    expect(evaluateMcac(input({ policy: p, context: atThreshold })).conditionEvaluations[0]?.outcome).toBe("T");
    expect(evaluateMcac(input({ policy: p, context: aboveThreshold })).conditionEvaluations[0]?.outcome).toBe("F");
    const unconfiguredClass = { ...context, environmental: { ...context.environmental, network: raw("network", "unknown") } };
    expect(() => evaluateMcac(input({ policy: p, context: unconfiguredClass }))).toThrow(/does not define a fallback/);
  });
  it("can disable the two interactions independently and records each switch outcome", () => {
    const dynamic = { id: "freq", item: "frequency" as const, comparator: "lte" as const, parameter: { by: "network" as const, values: { corporate: 20 } }, strength: "soft" as const };
    const p = policy([rule([], [dynamic])], { consistencyConstraints: [{ id: "pair", items: ["device", "network"] }] });
    const onlyConsistency = evaluateMcac(input({ policy: { ...p, interactions: { environmentConditionedThresholds: false, crossCategoryConsistency: true } }, consistencyEvidence: [{ id: "pair", violated: true }] }));
    expect(onlyConsistency.trace.interactions.map((interaction) => interaction.result)).toEqual(["APPLIED", "DISABLED"]);
    expect(onlyConsistency.trace.items.find((item) => item.kind === "network")?.validityStatus).toBe("X");
    const onlyThreshold = evaluateMcac(input({ policy: { ...p, interactions: { environmentConditionedThresholds: true, crossCategoryConsistency: false } }, consistencyEvidence: [{ id: "pair", violated: true }] }));
    expect(onlyThreshold.trace.interactions.map((interaction) => interaction.result)).toEqual(["DISABLED", "APPLIED"]);
    expect(onlyThreshold.trace.items.find((item) => item.kind === "network")?.validityStatus).toBe("V");
  });
  it("applies cross-category consistency by degrading only involved items to X", () => {
    const p = policy([rule([], [{ id: "f", item: "frequency", comparator: "gte", parameter: 1, strength: "soft" }])], { consistencyConstraints: [{ id: "pair", items: ["device", "network"] }] });
    const satisfied = evaluateMcac(input({ policy: p, consistencyEvidence: [{ id: "pair", violated: false }] }));
    expect(satisfied.trace.interactions[0]?.result).toBe("NOT_VIOLATED");
    expect(satisfied.trace.items.find((item) => item.kind === "network")?.validityStatus).toBe("V");
    const result = evaluateMcac(input({ policy: p, consistencyEvidence: [{ id: "pair", violated: true }] }));
    expect(result.trace.items.find((item) => item.kind === "device")?.validityStatus).toBe("X");
    expect(result.trace.items.find((item) => item.kind === "network")?.validityStatus).toBe("X");
    expect(result.trace.items.find((item) => item.kind === "frequency")?.validityStatus).toBe("V");
    expect(result.trace.interactions[0]?.result).toBe("APPLIED");
  });
  it.each([
    [false, 0, false, "DENY"], [true, 0, false, "ALLOW"], [true, 1, true, "VERIFY"], [true, 1, false, "DENY"], [true, 2, true, "DENY"],
  ] as const)("maps baseline=%s severity=%s step-up=%s to %s", (baseline, severity, stepUp, expected) => {
    expect(decide(baseline, severity, stepUp)).toBe(expected);
  });
  it("never bypasses failed RBAC and does not inspect malformed context", () => {
    for (const sensitivity of ["L", "H"] as const) for (const failOpen of [0, 1] as const) {
      const p = policy([rule([], [{ id: "f", item: "frequency", comparator: "gte", parameter: 1, strength: "hard" }], failOpen)]);
      const result = evaluateMcac(input({ baselinePermission: false, sensitivity, policy: p, context: {} as ContextEvidence }));
      expect(result.decision).toBe("DENY");
      expect(result.trace.items).toEqual([]);
    }
    const malformedPolicy = { ...policy(), rules: [{ ...rule(), environmental: [{ id: "wrong", item: "frequency", comparator: "lt", parameter: "bad", strength: "hard" }] }] } as unknown as PolicyVersion;
    expect(evaluateMcac(input({ baselinePermission: false, policy: malformedPolicy, context: {} as ContextEvidence })).decision).toBe("DENY");
  });
  it("adapts application permissions explicitly and maps VERIFY to a workflow request", () => {
    const appInput = input({ policy: policy([rule([], [{ id: "f", item: "frequency", comparator: "gte", parameter: 99, strength: "soft" }])]) });
    const result = evaluateMcacForApplication({ ...appInput, effectivePermissions: ["payroll:export"], requiredPermission: "payroll:export" });
    expect(result.decision).toBe("VERIFY");
    expect(result.enforcement).toBe("VERIFICATION_REQUIRED");
    const denied = evaluateMcacForApplication({ ...appInput, effectivePermissions: [], requiredPermission: "payroll:export" });
    expect(denied.decision).toBe("DENY");
    expect(denied.enforcement).toBe("ACCESS_DENIED");
  });
  it("satisfies Proposition 1 and samples Proposition 2 order invariance", () => {
    const conditions = [
      { id: "a", item: "time" as const, comparator: "gte" as const, parameter: 9, strength: "soft" as const },
      { id: "b", item: "frequency" as const, comparator: "lte" as const, parameter: 10, strength: "hard" as const },
    ];
    const secondRule = { ...rule([], []), id: "r2", environmental: [conditions[0]!] };
    const firstRule = { ...rule([], []), id: "r1", behavioral: [conditions[1]!] };
    const first = evaluateMcac(input({ policy: policy([firstRule, secondRule]) }));
    const reordered = evaluateMcac(input({ policy: policy([secondRule, firstRule]) }));
    expect(first.decision).toBe(reordered.decision);
    expect(first.trace.m).toBe(reordered.trace.m);
    expect(first.trace.conditions).toEqual(reordered.trace.conditions);
    expect(evaluateMcac(input({ baselinePermission: false })).decision).toBe("DENY");
  });
  it("freezes detached policy snapshots and requires a new version for changed policy content", () => {
    const mutable = { ...policy(), rules: [rule()] };
    const snapshot = freezePolicyVersion(mutable);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.rules)).toBe(true);
    expect(() => assertPolicyVersionTransition(snapshot, { ...snapshot, version: "policy-v1", strictLowSensitivity: true })).toThrow(/new immutable version/);
    expect(() => assertPolicyVersionTransition(snapshot, { ...snapshot, version: "policy-v2", strictLowSensitivity: true })).not.toThrow();
    expect(() => assertPolicyVersionTransition(snapshot, { ...snapshot, version: "policy-v2" })).not.toThrow();
  });
  it("satisfies the sampled Proposition 3 high-sensitivity degradation ordering", () => {
    const order = { ALLOW: 0, VERIFY: 1, DENY: 2 } as const;
    const condition = { id: "f", item: "frequency" as const, comparator: "gte" as const, parameter: 10, strength: "hard" as const };
    const p = policy([rule([], [condition])]);
    const valid = evaluateMcac(input({ policy: p, sensitivity: "H" }));
    const degradations: ContextEvidence[] = [
      { ...context, behavioral: { ...context.behavioral, frequency: raw("frequency", { count: 12, windowSeconds: 60 }, at - 999_000) } },
      { ...context, behavioral: { ...context.behavioral, frequency: raw("frequency", null) } },
      { ...context, behavioral: { ...context.behavioral, frequency: raw("frequency", { count: 12, windowSeconds: 60 }, at, "ext", 0) } },
      { ...context, behavioral: { ...context.behavioral, frequency: raw("frequency", { count: 12, windowSeconds: 60 }) } },
    ];
    for (let i = 0; i < degradations.length; i++) {
      const evidence = i === 3 ? [{ id: "cx", violated: true }] : [];
      const policyForCase = i === 3 ? policy([rule([], [condition])], { consistencyConstraints: [{ id: "cx", items: ["frequency"] }] }) : p;
      const degraded = evaluateMcac(input({ policy: policyForCase, context: degradations[i]!, consistencyEvidence: evidence }));
      expect(order[degraded.decision]).toBeGreaterThanOrEqual(order[valid.decision]);
    }
    const soft = policy([rule([], [{ ...condition, strength: "soft" }])]);
    const waiver = { assuranceMeetsRequired: true, userId: "user-1", sessionId: "session-1", resourceClass: "payroll", action: "export", verifiedAt: at - 10_000, expiresAt: at + 10_000 };
    const waivedValid = evaluateMcac(input({ policy: soft, waiver }));
    expect(waivedValid.decision).toBe("ALLOW");
    for (let i = 0; i < degradations.length; i++) {
      const softCase = i === 3 ? policy([rule([], [{ ...condition, strength: "soft" }])], { consistencyConstraints: [{ id: "cx", items: ["frequency"] }] }) : soft;
      const waivedDegraded = evaluateMcac(input({ policy: softCase, waiver, context: degradations[i]!, consistencyEvidence: i === 3 ? [{ id: "cx", violated: true }] : [] }));
      expect(order[waivedDegraded.decision]).toBeGreaterThanOrEqual(order[waivedValid.decision]);
    }
  });
  it("records a deterministic SHA-256 trace and replays against the exact immutable version", () => {
    const p = policy([rule([], [{ id: "f", item: "frequency", comparator: "lte", parameter: 20, strength: "soft" }])]);
    const result = evaluateMcac(input({ policy: p }));
    expect(result.trace).toEqual(evaluateMcac(input({ policy: p })).trace);
    expect(result.trace.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyTraceHash(result.trace)).toBe(true);
    expect(replayTrace(result.trace, p).decision).toBe(result.decision);
    expect(() => replayTrace(result.trace, { ...p, version: "policy-v2" })).toThrow(/requires policy version/);
    expect(() => replayTrace({ ...result.trace, decision: "DENY" }, p)).toThrow(/hash verification/);
  });
  it("applies step-up waiver only to severity one, never severity two", () => {
    const soft = policy([rule([], [{ id: "f", item: "frequency", comparator: "gte", parameter: 99, strength: "soft" }])]);
    const hard = policy([rule([], [{ id: "f", item: "frequency", comparator: "gte", parameter: 99, strength: "hard" }])]);
    const waiver = { assuranceMeetsRequired: true, userId: "user-1", sessionId: "session-1", resourceClass: "payroll", action: "export", verifiedAt: at - 60_000, expiresAt: at + 60_000 };
    expect(evaluateMcac(input({ policy: soft, waiver })).decision).toBe("ALLOW");
    expect(evaluateMcac(input({ policy: hard, waiver })).decision).toBe("DENY");
    expect(evaluateMcac(input({ policy: soft, waiver: { ...waiver, sessionId: "other-session" } })).decision).toBe("DENY");
    expect(evaluateMcac(input({ policy: soft, waiver: { ...waiver, assuranceMeetsRequired: false } })).decision).toBe("DENY");
    expect(evaluateMcac(input({ policy: soft, waiver: { ...waiver, expiresAt: at + 600_000 } })).decision).toBe("DENY");
    expect(evaluateMcac(input({ policy: soft, waiver: { ...waiver, expiresAt: at } })).decision).toBe("DENY");
  });
  it("takes the maximum across conflicting conditions regardless of a satisfied condition", () => {
    const result = evaluateMcac(input({ policy: policy([rule([], [
      { id: "pass", item: "frequency", comparator: "lte", parameter: 20, strength: "soft" },
      { id: "fail", item: "frequency", comparator: "gte", parameter: 99, strength: "hard" },
    ])]) }));
    expect(result.conditionEvaluations.map((item) => item.outcome)).toEqual(["F", "T"]);
    expect(result.severity).toBe(2);
    expect(result.decision).toBe("DENY");
  });
});
