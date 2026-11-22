import type { GammaConstraintEvaluation, GammaConstraintOutcome } from "./gamma-evaluator";
import type { GammaConstraint } from "./gamma-types";
import type { ContextItemKind } from "./types";

export type GammaItemEffectKind = "VIOLATED" | "INDETERMINATE" | "NONE";

export type GammaConstraintEffectSource = Readonly<{
  constraintId: string;
  outcome: GammaConstraintOutcome;
}>;

export type GammaCombinedItemEffect = Readonly<{
  itemKind: ContextItemKind;
  effect: GammaItemEffectKind;
  constraints: readonly GammaConstraintEffectSource[];
}>;

export type GammaConditionHandling = Readonly<{
  ruleId: string;
  conditionId: string;
  outcome: "T" | "F" | "I";
  strength: "soft" | "hard";
  severity: 0 | 1 | 2;
  reasonCode: string;
  sensitivity: "L" | "H";
  strictLowSensitivity: boolean;
  failOpen: 0 | 1;
}>;

export type GammaDecisionItemTrace = Readonly<{
  itemKind: ContextItemKind;
  effect: GammaItemEffectKind;
  contributingConstraints: readonly GammaConstraintEffectSource[];
  dependentConditions: readonly GammaConditionHandling[];
}>;

export type GammaDecisionTrace = Readonly<{
  traceSchemaVersion: 1;
  policyVersion: string;
  constraints: readonly GammaConstraintEvaluation[];
  items: readonly GammaDecisionItemTrace[];
}>;

const itemOrder: readonly ContextItemKind[] = [
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

/** Combines eligible constraint outcomes in policy order with VIOLATED > INDETERMINATE > SATISFIED. */
export function combineGammaEffects(
  constraints: readonly GammaConstraint[],
  evaluations: readonly GammaConstraintEvaluation[],
): readonly GammaCombinedItemEffect[] {
  const outcomes = new Map(
    evaluations.map((evaluation) => [evaluation.constraintId, evaluation.outcome]),
  );
  const effects = new Map<ContextItemKind, GammaConstraintEffectSource[]>();
  for (const constraint of constraints) {
    const outcome = outcomes.get(constraint.id);
    if (!outcome) throw new Error(`Missing Γ evaluation for constraint ${constraint.id}`);
    for (const itemKind of constraint.items) {
      const sources = effects.get(itemKind) ?? [];
      sources.push(Object.freeze({ constraintId: constraint.id, outcome }));
      effects.set(itemKind, sources);
    }
  }
  return Object.freeze(
    itemOrder
      .filter((itemKind) => effects.has(itemKind))
      .map((itemKind) => {
        const constraintsForItem = Object.freeze(effects.get(itemKind)!);
        const effect: GammaItemEffectKind = constraintsForItem.some(
          (entry) => entry.outcome === "VIOLATED",
        )
          ? "VIOLATED"
          : constraintsForItem.some((entry) => entry.outcome === "INDETERMINATE")
            ? "INDETERMINATE"
            : "NONE";
        return Object.freeze({ itemKind, effect, constraints: constraintsForItem });
      }),
  );
}
