import { withGammaVersionMetadata } from "./policy-version";
import type {
  AuthorizationInput,
  ContextEvidence,
  ContextEvidenceItem,
  ContextItemKind,
  ContextValueMap,
  PolicyVersion,
  Rule,
} from "./types";
import type { GammaConstraint } from "./gamma-types";

export const RESEARCH_POLICY_ID = "mcac-fixed-synthetic-research-policy-v1" as const;

export type ResearchScenarioId =
  | "normal-access"
  | "baseline-denial"
  | "high-risk-action"
  | "missing-context"
  | "stale-context"
  | "unverifiable-context"
  | "gamma-contradiction"
  | "theta-network-threshold"
  | "gamma-satisfied"
  | "gamma-violated"
  | "gamma-indeterminate";

export type ResearchScenario = Readonly<{
  id: ResearchScenarioId;
  name: string;
  description: string;
  input: AuthorizationInput;
}>;

const evaluationTime = Date.UTC(2026, 0, 5, 12);
const itemKinds: readonly ContextItemKind[] = [
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

const gammaConstraint: GammaConstraint = {
  id: "demo-network-device-consistency",
  items: ["network", "device"],
  expression: {
    kind: "all",
    children: [
      {
        kind: "compare",
        operator: "in",
        left: "environmental.network.class",
        right: {
          kind: "set",
          valueType: "networkClass",
          values: [
            { type: "networkClass", value: "corporate" },
            { type: "networkClass", value: "vpn" },
            { type: "networkClass", value: "known" },
          ],
        },
      },
      { kind: "exists", reference: "environmental.device.registered" },
    ],
  },
};

const conditions = (
  strength: "soft" | "hard",
  frequencyParameter: unknown,
): Pick<Rule, "environmental" | "behavioral"> => ({
  environmental: [
    { id: "network-corporate", item: "network", comparator: "eq", parameter: "corporate", strength },
    { id: "device-registered", item: "device", comparator: "registered", parameter: true, strength },
  ],
  behavioral: [
    {
      id: "frequency-threshold",
      item: "frequency",
      comparator: "gte",
      parameter: frequencyParameter as Rule["behavioral"][number]["parameter"],
      strength,
    },
  ],
});

const networkThreshold = Object.freeze({
  by: "network" as const,
  values: Object.freeze({ corporate: 10, vpn: 5, known: 8, unknown: 4 }),
});
const standardConditions = conditions("soft", networkThreshold);
const highRiskConditions = conditions("hard", networkThreshold);

const sharedPolicy = deepFreeze(
  withGammaVersionMetadata({
    version: RESEARCH_POLICY_ID,
    resourceProfiles: {
      "research-standard": {
        sensitivity: "L",
        stepUpAvailable: true,
        waiverDurationSeconds: 300,
      },
      "research-high-risk": {
        sensitivity: "H",
        stepUpAvailable: true,
        waiverDurationSeconds: 300,
      },
    },
    freshnessSeconds: Object.fromEntries(itemKinds.map((kind) => [kind, 300])) as PolicyVersion["freshnessSeconds"],
    verificationRequired: Object.fromEntries(
      itemKinds.map((kind) => [kind, kind === "device" ? 1 : 0]),
    ) as PolicyVersion["verificationRequired"],
    consistencyConstraints: [gammaConstraint],
    expectedTransitions: [],
    rules: [
      {
        id: "research-standard-rule",
        resourceClass: "research-standard",
        actions: ["read"],
        ...standardConditions,
        failOpen: 0,
      },
      {
        id: "research-high-risk-rule",
        resourceClass: "research-high-risk",
        actions: ["export"],
        ...highRiskConditions,
        failOpen: 0,
      },
    ],
    strictLowSensitivity: false,
    interactions: {
      environmentConditionedThresholds: true,
      crossCategoryConsistency: true,
    },
  } satisfies PolicyVersion),
);

type ScenarioDefinition = Readonly<{
  name: string;
  description: string;
  baselinePermission?: boolean;
  resourceClass?: string;
  action?: "read" | "export";
  network?: ContextValueMap["network"];
  device?: ContextValueMap["device"] | null;
  deviceSource?: "srv" | "ext";
  deviceIntegrity?: 0 | 1;
  deviceObservedAt?: number;
  frequency?: ContextValueMap["frequency"] | null;
  staleNetwork?: boolean;
}>;

const definitions: Readonly<Record<ResearchScenarioId, ScenarioDefinition>> = {
  "normal-access": {
    name: "Normal valid access",
    description: "Valid synthetic evidence satisfies the standard rule and Γ constraint.",
  },
  "baseline-denial": {
    name: "Baseline permission denial",
    description: "The formal evaluator receives a failed baseline permission predicate.",
    baselinePermission: false,
  },
  "high-risk-action": {
    name: "High-risk resource and action",
    description: "An export against a high-sensitivity synthetic resource uses hard conditions.",
    resourceClass: "research-high-risk",
    action: "export",
  },
  "missing-context": {
    name: "Missing context",
    description: "The synthetic frequency item is absent and classified M by the engine.",
    frequency: null,
  },
  "stale-context": {
    name: "Stale context",
    description: "The synthetic network observation is older than its configured freshness bound.",
    network: "vpn",
    staleNetwork: true,
  },
  "unverifiable-context": {
    name: "Unverifiable context",
    description: "Synthetic external device evidence has integrityFlag 0 while verification is required.",
    deviceSource: "ext",
    deviceIntegrity: 0,
  },
  "gamma-contradiction": {
    name: "Contradictory context",
    description: "Γ evaluates the declared network/device relationship as VIOLATED and applies X.",
    network: "unknown",
  },
  "theta-network-threshold": {
    name: "Θ network-conditioned threshold",
    description: "A valid synthetic VPN selects the VPN frequency threshold through Θ.",
    network: "vpn",
    frequency: { count: 6, windowSeconds: 60 },
  },
  "gamma-satisfied": {
    name: "Γ satisfied",
    description: "The corporate network and registered synthetic device satisfy Γ.",
  },
  "gamma-violated": {
    name: "Γ violated",
    description: "The valid unknown network makes the corporate-network comparison false.",
    network: "unknown",
  },
  "gamma-indeterminate": {
    name: "Γ indeterminate",
    description: "The external device item is U, so the Γ relationship is indeterminate.",
    deviceSource: "ext",
    deviceIntegrity: 0,
  },
};

const registry = deepFreeze(
  Object.fromEntries(
    Object.entries(definitions).map(([id, definition]) => {
      const scenarioId = id as ResearchScenarioId;
      const resourceClass = definition.resourceClass ?? "research-standard";
      const action = definition.action ?? "read";
      const input: AuthorizationInput = {
        request: {
          requestId: `synthetic-${scenarioId}`,
          time: evaluationTime,
          userId: "synthetic-research-user",
          sessionId: "synthetic-research-session",
          resourceId: `synthetic-${resourceClass}`,
          resourceClass,
          action,
        },
        baselinePermission: definition.baselinePermission ?? true,
        policy: sharedPolicy,
        context: makeContext(definition, resourceClass, action),
        consistencyEvidence: [],
        waiver: null,
        previousHash: "GENESIS",
      };
      return [
        scenarioId,
        deepFreeze({ id: scenarioId, ...definition, input }) satisfies ResearchScenario,
      ];
    }),
  ) as Record<ResearchScenarioId, ResearchScenario>,
);

export function listResearchScenarios(): readonly Readonly<
  Pick<ResearchScenario, "id" | "name" | "description">
>[] {
  return Object.freeze(
    (Object.values(registry) as ResearchScenario[]).map(({ id, name, description }) =>
      Object.freeze({ id, name, description }),
    ),
  );
}

/** Returns a detached immutable fixture so a caller cannot alter the shared registry. */
export function getResearchScenario(id: string): ResearchScenario | undefined {
  if (!Object.hasOwn(registry, id)) return undefined;
  return deepFreeze(structuredClone(registry[id as ResearchScenarioId]));
}

function makeContext(
  definition: ScenarioDefinition,
  resourceClass: string,
  action: "read" | "export",
): ContextEvidence {
  const observedAt = definition.deviceObservedAt ?? evaluationTime;
  const raw = <K extends ContextItemKind>(
    kind: K,
    value: ContextValueMap[K] | null,
    options: { observedAt?: number; sourceClass?: "srv" | "ext"; integrityFlag?: 0 | 1 } = {},
  ): ContextEvidenceItem<K> => ({
    kind,
    value,
    observedAt: value === null ? null : (options.observedAt ?? evaluationTime),
    sourceClass: value === null ? null : (options.sourceClass ?? "srv"),
    integrityFlag: value === null ? 0 : (options.integrityFlag ?? 1),
  }) as ContextEvidenceItem<K>;

  const device = definition.device ?? {
    registered: true,
    deviceId: "synthetic-device-001",
    tokenAgeSeconds: 30,
  };
  const frequency = definition.frequency === undefined
    ? { count: 12, windowSeconds: 60 }
    : definition.frequency;
  return deepFreeze({
    environmental: {
      time: raw("time", { weekday: 0, hour: 12, timezone: "UTC" }),
      location: raw("location", { country: "ZZ", region: "SYNTHETIC" }),
      network: raw("network", definition.network ?? "corporate", {
        observedAt: definition.staleNetwork ? evaluationTime - 301_000 : evaluationTime,
      }),
      device: raw("device", device, {
        observedAt,
        sourceClass: definition.deviceSource,
        integrityFlag: definition.deviceIntegrity,
      }),
    },
    behavioral: {
      session: raw("session", { method: "synthetic-password", ageSeconds: 60 }),
      frequency: raw("frequency", frequency),
      history: raw("history", {
        classes: [],
        windowDays: 30,
        enrollmentComplete: true,
      }),
      navigation: raw("navigation", {
        previousClass: "synthetic-home",
        currentClass: resourceClass,
        transitionCount: 1,
        enrollmentComplete: true,
      }),
      request: raw("request", { resourceClass, actionClass: action }),
    },
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
