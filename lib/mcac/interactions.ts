import type {
  Condition,
  ContextItem,
  ContextItemKind,
  InteractionEvaluation,
  ItemValue,
  PolicyVersion,
  Rule,
} from "./types";

export type ThresholdResolution = Readonly<{
  value: ItemValue | undefined;
  interaction: InteractionEvaluation | null;
}>;

/** Section IX-B: a behavioral threshold lookup depends on a valid environmental network item. */
export function resolveEnvironmentConditionedThreshold(
  rule: Rule,
  condition: Condition,
  items: readonly ContextItem[],
  policy: PolicyVersion,
): ThresholdResolution {
  if (!isNetworkThreshold(condition.parameter))
    return { value: condition.parameter, interaction: null };
  const interaction: InteractionEvaluation = !policy.interactions.environmentConditionedThresholds
    ? {
        id: `${rule.id}:${condition.id}:threshold`,
        kind: "environment_conditioned_threshold",
        inputReferences: ["network", condition.id],
        result: "DISABLED",
        explanation:
          "Environment-conditioned behavioral threshold interaction is disabled in this policy version.",
      }
    : {
        id: `${rule.id}:${condition.id}:threshold`,
        kind: "environment_conditioned_threshold",
        inputReferences: ["network", condition.id],
        result: "INDETERMINATE",
        explanation:
          "The network context required to select a threshold is unavailable or degraded.",
      };
  if (!policy.interactions.environmentConditionedThresholds)
    return { value: undefined, interaction };
  const network = items.find((item) => item.kind === "network");
  if (!network || network.validityStatus !== "V" || typeof network.value !== "string")
    return { value: undefined, interaction };
  const value = condition.parameter.values[network.value];
  if (value === undefined)
    throw new Error(
      `MCAC policy integrity error: valid canonical network class ${network.value} has no configured Θ threshold for ${rule.id}:${condition.id}`,
    );
  return {
    value,
    interaction: {
      ...interaction,
      result: value === undefined ? "INDETERMINATE" : "APPLIED",
      explanation:
        value === undefined
          ? `No configured threshold exists for network class ${network.value}.`
          : `Selected the configured behavioral threshold for network class ${network.value}.`,
    },
  };
}

/** Section IX-B: declared Γ outcomes can only degrade involved item statuses to X. */
export function evaluateCrossCategoryConsistency(
  policy: PolicyVersion,
  evidence: readonly { id: string; violated: boolean }[],
): Readonly<{
  interactions: readonly InteractionEvaluation[];
  violatedItems: ReadonlySet<ContextItemKind>;
}> {
  const byId = new Map(evidence.map((item) => [item.id, item.violated]));
  const interactions: InteractionEvaluation[] = [];
  const violatedItems = new Set<ContextItemKind>();
  for (const constraint of policy.consistencyConstraints) {
    const state = byId.get(constraint.id);
    if (!policy.interactions.crossCategoryConsistency) {
      interactions.push({
        id: constraint.id,
        kind: "cross_category_consistency",
        inputReferences: [...constraint.items],
        result: "DISABLED",
        explanation: "Cross-category consistency interaction is disabled in this policy version.",
      });
      continue;
    }
    if (state === undefined)
      throw new Error(`Missing explicit consistency evidence for constraint ${constraint.id}`);
    if (state) for (const kind of constraint.items) violatedItems.add(kind);
    interactions.push({
      id: constraint.id,
      kind: "cross_category_consistency",
      inputReferences: [...constraint.items],
      result: state ? "APPLIED" : "NOT_VIOLATED",
      explanation: state
        ? "The declared consistency constraint is violated; involved item statuses are degraded to X."
        : "The declared consistency constraint is satisfied.",
    });
  }
  return { interactions: Object.freeze(interactions), violatedItems };
}

function isNetworkThreshold(
  parameter: Condition["parameter"],
): parameter is Extract<Condition["parameter"], { by: "network" }> {
  return (
    typeof parameter === "object" &&
    parameter !== null &&
    !Array.isArray(parameter) &&
    "by" in parameter
  );
}
