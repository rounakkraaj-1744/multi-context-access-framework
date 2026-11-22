import { describe, expect, it } from "vitest";
import {
  evaluateMcac,
  replayTrace,
  type AuthorizationInput,
  type ContextEvidence,
  type ContextEvidenceItem,
  type ContextItemKind,
  type ContextValueMap,
  type GammaConstraint,
  type PolicyVersion,
} from "./index";

const at = Date.UTC(2026, 0, 1, 12);
const kinds: readonly ContextItemKind[] = [
  "time",
  "location",
  "network",
  "device",
  "session",
  "frequency",
  "history",
  "navigation",
  "request",
];
const raw = <K extends ContextItemKind>(
  kind: K,
  value: ContextValueMap[K] | null,
  observedAt: number | null = at,
  sourceClass: "srv" | "ext" | null = "srv",
  integrityFlag: 0 | 1 = 1,
): ContextEvidenceItem<K> =>
  value === null
    ? ({
        kind,
        value,
        observedAt: null,
        sourceClass: null,
        integrityFlag: 0,
      } as ContextEvidenceItem<K>)
    : ({ kind, value, observedAt, sourceClass, integrityFlag } as ContextEvidenceItem<K>);

const context: ContextEvidence = {
  environmental: {
    time: raw("time", { weekday: 3, hour: 12, timezone: "UTC" }),
    location: raw("location", { country: "US", region: "CA" }),
    network: raw("network", "corporate"),
    device: raw("device", { registered: true, deviceId: "device-secret", tokenAgeSeconds: 5 }),
  },
  behavioral: {
    session: raw("session", { method: "password", ageSeconds: 30 }),
    frequency: raw("frequency", { count: 2, windowSeconds: 60 }),
    history: raw("history", { classes: [], windowDays: 30, enrollmentComplete: true }),
    navigation: raw("navigation", {
      previousClass: "home",
      currentClass: "payroll",
      transitionCount: 1,
      enrollmentComplete: true,
    }),
    request: raw("request", { resourceClass: "payroll", actionClass: "export" }),
  },
};

const basePolicy = (overrides: Partial<PolicyVersion> = {}): PolicyVersion => ({
  version: "gamma-effects-v1",
  resourceProfiles: {
    payroll: { sensitivity: "H", stepUpAvailable: true, waiverDurationSeconds: 300 },
  },
  freshnessSeconds: Object.fromEntries(
    kinds.map((kind) => [kind, 300]),
  ) as PolicyVersion["freshnessSeconds"],
  verificationRequired: Object.fromEntries(
    kinds.map((kind) => [kind, 1]),
  ) as PolicyVersion["verificationRequired"],
  consistencyConstraints: [],
  expectedTransitions: [],
  rules: [],
  strictLowSensitivity: false,
  interactions: { environmentConditionedThresholds: true, crossCategoryConsistency: true },
  ...overrides,
});

const networkRule = (strength: "soft" | "hard" = "soft", failOpen: 0 | 1 = 0) => ({
  id: "r-network",
  resourceClass: "payroll",
  actions: ["export"] as const,
  environmental: [
    {
      id: "c-network",
      item: "network" as const,
      comparator: "eq" as const,
      parameter: "corporate",
      strength,
    },
  ],
  behavioral: [],
  failOpen,
});

const networkConstraint = (
  id: string,
  expected: "corporate" | "vpn" = "corporate",
): GammaConstraint => ({
  id,
  items: ["network", "device"],
  expression: {
    kind: "all",
    children: [
      {
        kind: "compare",
        operator: "eq",
        left: "environmental.network.class",
        right: { kind: "literal", value: { type: "networkClass", value: expected } },
      },
      { kind: "exists", reference: "environmental.device.registered" },
    ],
  },
});

const networkLocationConstraint = (id: string, expected: "corporate" | "vpn"): GammaConstraint => ({
  id,
  items: ["network", "location"],
  expression: {
    kind: "all",
    children: [
      {
        kind: "compare",
        operator: "eq",
        left: "environmental.network.class",
        right: { kind: "literal", value: { type: "networkClass", value: expected } },
      },
      { kind: "exists", reference: "environmental.location.country" },
    ],
  },
});

const makeInput = (
  constraints: readonly GammaConstraint[],
  overrides: Partial<AuthorizationInput> = {},
): AuthorizationInput => {
  const selectedPolicy =
    overrides.policy ??
    basePolicy({
      consistencyConstraints: constraints,
      rules: [networkRule()],
    });
  return {
    request: {
      requestId: "req-gamma",
      time: at,
      userId: "user-1",
      sessionId: "session-1",
      resourceId: "payroll-1",
      resourceClass: "payroll",
      action: "export",
    },
    baselinePermission: true,
    policy: selectedPolicy,
    context,
    consistencyEvidence: [],
    waiver: null,
    previousHash: "GENESIS",
    ...overrides,
  };
};

describe("Γ effect combination and condition propagation", () => {
  it("turns a violated constraint into the existing degraded-condition path", () => {
    const result = evaluateMcac(makeInput([networkConstraint("bad", "vpn")]));
    expect(result.trace.gamma?.constraints[0]?.outcome).toBe("VIOLATED");
    expect(result.trace.gamma?.items.find((item) => item.itemKind === "network")?.effect).toBe(
      "VIOLATED",
    );
    expect(result.trace.items.find((item) => item.kind === "network")?.validityStatus).toBe("X");
    expect(result.conditionEvaluations[0]?.outcome).toBe("I");
    expect(result.conditionEvaluations[0]?.severity).toBe(1);
    expect(result.decision).toBe("VERIFY");
  });

  it("combines constraints on the same item with VIOLATED precedence", () => {
    const indeterminate = networkConstraint("uncertain");
    const staleDeviceContext = {
      ...context,
      environmental: {
        ...context.environmental,
        device: raw(
          "device",
          { registered: true, deviceId: "device-secret", tokenAgeSeconds: 5 },
          at - 500_000,
        ),
      },
    };
    const result = evaluateMcac(
      makeInput([networkLocationConstraint("violated", "vpn"), indeterminate], {
        context: staleDeviceContext,
      }),
    );
    expect(result.trace.gamma?.constraints.map((entry) => entry.outcome)).toEqual([
      "VIOLATED",
      "INDETERMINATE",
    ]);
    expect(result.trace.gamma?.items.find((item) => item.itemKind === "network")?.effect).toBe(
      "VIOLATED",
    );
  });

  it("applies indeterminate effects when no violation exists and retains X evidence", () => {
    const stale = {
      ...context,
      environmental: {
        ...context.environmental,
        device: raw(
          "device",
          { registered: true, deviceId: "device-secret", tokenAgeSeconds: 5 },
          at - 500_000,
        ),
      },
    };
    const uncertain = evaluateMcac(makeInput([networkConstraint("uncertain")], { context: stale }));
    expect(uncertain.trace.gamma?.items.find((item) => item.itemKind === "network")?.effect).toBe(
      "INDETERMINATE",
    );
    expect(uncertain.conditionEvaluations[0]?.outcome).toBe("I");
    expect(uncertain.conditionEvaluations[0]?.reasonCode).toBe("GAMMA_INDETERMINATE");

    const withOriginalX = evaluateMcac(
      makeInput([networkConstraint("references-x")], {
        policy: basePolicy({
          consistencyConstraints: [
            { id: "legacy-x", items: ["network"] },
            networkConstraint("references-x"),
          ],
          rules: [networkRule()],
        }),
        consistencyEvidence: [{ id: "legacy-x", violated: true }],
      }),
    );
    expect(withOriginalX.trace.gamma?.constraints[0]?.outcome).toBe("INDETERMINATE");
    expect(withOriginalX.trace.items.find((item) => item.kind === "network")?.validityStatus).toBe(
      "X",
    );
  });

  it("leaves satisfied constraints effect-free and traces constraints with no dependent conditions", () => {
    const satisfied = evaluateMcac(makeInput([networkConstraint("ok")]));
    expect(satisfied.trace.gamma?.constraints[0]?.outcome).toBe("SATISFIED");
    expect(satisfied.trace.gamma?.items.find((item) => item.itemKind === "network")?.effect).toBe(
      "NONE",
    );

    const unused = networkConstraint("unused");
    const noConditions = evaluateMcac(
      makeInput([unused], { policy: basePolicy({ consistencyConstraints: [unused] }) }),
    );
    expect(noConditions.trace.gamma?.constraints).toHaveLength(1);
    expect(noConditions.trace.gamma?.items).toEqual([]);
    expect(noConditions.decision).toBe("ALLOW");
  });

  it("evaluates all constraints against the same pre-effect snapshot", () => {
    const first = networkConstraint("violates", "vpn");
    const second = networkConstraint("satisfied");
    const testInput = makeInput([first, second]);
    const beforeContext = structuredClone(testInput.context);
    const beforePolicy = structuredClone(testInput.policy);
    const result = evaluateMcac(testInput);
    expect(result.trace.gamma?.constraints.map((entry) => entry.outcome)).toEqual([
      "VIOLATED",
      "SATISFIED",
    ]);
    expect(result.trace.gamma?.items.find((item) => item.itemKind === "network")?.effect).toBe(
      "VIOLATED",
    );
    expect(testInput.context).toEqual(beforeContext);
    expect(testInput.policy).toEqual(beforePolicy);
  });

  it("uses existing sensitivity/severity rules, preserves baseline denial, and keeps Γ traces value-free", () => {
    const violated = networkConstraint("restrict", "vpn");
    const hard = evaluateMcac(
      makeInput([violated], {
        policy: basePolicy({ consistencyConstraints: [violated], rules: [networkRule("hard")] }),
      }),
    );
    expect(hard.decision).toBe("DENY");

    const failOpen = evaluateMcac(
      makeInput([violated], {
        policy: basePolicy({
          resourceProfiles: {
            payroll: { sensitivity: "L", stepUpAvailable: true, waiverDurationSeconds: 300 },
          },
          consistencyConstraints: [violated],
          rules: [networkRule("hard", 1)],
        }),
      }),
    );
    expect(failOpen.conditionEvaluations[0]?.severity).toBe(0);

    const baselineDenied = evaluateMcac(makeInput([violated], { baselinePermission: false }));
    expect(baselineDenied.decision).toBe("DENY");
    expect(baselineDenied.trace.gamma).toBeNull();

    const gammaText = JSON.stringify(hard.trace.gamma);
    expect(gammaText).not.toContain("corporate");
    expect(gammaText).not.toContain("device-secret");
    expect(evaluateMcac(makeInput([violated])).trace.gamma).toEqual(
      evaluateMcac(makeInput([violated])).trace.gamma,
    );
    const replayInput = makeInput([violated]);
    const replayResult = evaluateMcac(replayInput);
    expect(replayTrace(replayResult.trace, replayInput.policy).trace.gamma).toEqual(
      replayResult.trace.gamma,
    );
  });
});
