import type { ConditionEvaluation, ContextCategory } from "./types";

/** Eqs. (8) and (9): max severity by category; empty maximum is zero. */
export function aggregateCategory(evaluations: readonly ConditionEvaluation[], category: ContextCategory): 0 | 1 | 2 {
  return evaluations.filter((evaluation) => evaluation.category === category).reduce<0 | 1 | 2>((maximum, evaluation) => Math.max(maximum, evaluation.severity) as 0 | 1 | 2, 0);
}

/** Eq. (10): overall severity is the maximum of independently computed categories. */
export function aggregateSeverity(environmental: 0 | 1 | 2, behavioral: 0 | 1 | 2): 0 | 1 | 2 {
  return Math.max(environmental, behavioral) as 0 | 1 | 2;
}
