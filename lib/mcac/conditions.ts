import { resolveEnvironmentConditionedThreshold } from "./interactions";
import type {
  Condition,
  ConditionEvaluation,
  ContextCategory,
  ContextEvidence,
  ContextItem,
  ContextItemKind,
  InteractionEvaluation,
  ItemValue,
  PolicyVersion,
  Rule,
  Sensitivity,
  TruthValue,
} from "./types";

export type EvaluatedCondition = Readonly<{
  evaluation: ConditionEvaluation;
  interaction: InteractionEvaluation | null;
}>;

export function evaluateCondition(
  rule: Rule,
  condition: Condition,
  category: ContextCategory,
  context: ContextEvidence,
  classifiedItems: readonly ContextItem[],
  evaluationTime: number,
  policy: PolicyVersion,
  sensitivity: Sensitivity,
): EvaluatedCondition {
  const target = classifiedItems.find((item) => item.kind === condition.item)!;
  const references: ContextItemKind[] = [condition.item];
  if (condition.comparator === "not_novel") references.push("request");
  const resolution =
    category === "behavioral"
      ? resolveEnvironmentConditionedThreshold(rule, condition, classifiedItems, policy)
      : { value: condition.parameter as ItemValue, interaction: null };
  const parameter = resolution.value;
  if (resolution.interaction) {
    references.push("network");
  }

  const usedItems = references.map((kind) => classifiedItems.find((item) => item.kind === kind)!);
  const outcome: TruthValue =
    usedItems.some((item) => item.validityStatus !== "V") || parameter === undefined
      ? "I"
      : compare(
            target,
            classifiedItems.find((item) => item.kind === "request")!,
            condition.comparator,
            parameter,
            policy,
          )
        ? "T"
        : "F";
  const severity = conditionSeverity(
    outcome,
    condition.strength,
    policy,
    rule.failOpen,
    sensitivity,
  );
  const reasonCode =
    outcome === "T"
      ? "CONDITION_TRUE"
      : outcome === "F"
        ? "CONDITION_FALSE"
        : parameter === undefined && resolution.interaction
          ? "THRESHOLD_CONTEXT_INDETERMINATE"
          : `CONTEXT_${usedItems.find((item) => item.validityStatus !== "V")?.validityStatus ?? "U"}`;
  const explanation =
    outcome === "T"
      ? "The valid context item satisfies the condition."
      : outcome === "F"
        ? "The valid context item does not satisfy the condition."
        : `The condition is indeterminate because required evidence is ${parameter === undefined && resolution.interaction ? "unavailable" : usedItems.map((item) => item.validityStatus).join(", ")}.`;
  return {
    evaluation: Object.freeze({
      ruleId: rule.id,
      conditionId: condition.id,
      category,
      itemReferences: Object.freeze(references),
      items: Object.freeze(usedItems),
      outcome,
      strength: condition.strength,
      severity,
      reasonCode,
      explanation,
    }),
    interaction: resolution.interaction,
  };
}

export function conditionSeverity(
  outcome: TruthValue,
  strength: "soft" | "hard",
  policy: PolicyVersion,
  failOpen: 0 | 1,
  sensitivity: Sensitivity,
): 0 | 1 | 2 {
  const sev = strength === "soft" ? 1 : 2;
  if (outcome === "T") return 0;
  if (outcome === "F") return sev;
  if (sensitivity === "H" || policy.strictLowSensitivity) return sev;
  return (Math.min(sev, 1) * (1 - failOpen)) as 0 | 1;
}

export function evaluateConditions(
  rules: readonly Rule[],
  category: ContextCategory,
  context: ContextEvidence,
  items: readonly ContextItem[],
  time: number,
  policy: PolicyVersion,
  sensitivity: Sensitivity,
): Readonly<{
  evaluations: readonly ConditionEvaluation[];
  interactions: readonly InteractionEvaluation[];
}> {
  const evaluated = rules.flatMap((rule) =>
    (category === "environmental" ? rule.environmental : rule.behavioral).map((condition) =>
      evaluateCondition(rule, condition, category, context, items, time, policy, sensitivity),
    ),
  );
  return Object.freeze({
    evaluations: Object.freeze(evaluated.map((entry) => entry.evaluation)),
    interactions: Object.freeze(
      evaluated.flatMap((entry) => (entry.interaction ? [entry.interaction] : [])),
    ),
  });
}

function compare(
  item: ContextItem,
  requestItem: ContextItem,
  comparator: Condition["comparator"],
  parameter: ItemValue,
  policy: PolicyVersion,
): boolean {
  const value = item.value;
  if (value === null) return false;
  switch (comparator) {
    case "eq":
      return deepEqual(value, parameter);
    case "neq":
      return !deepEqual(value, parameter);
    case "registered":
      return item.kind === "device" && asRecord(value)?.["registered"] === parameter;
    case "in":
      return Array.isArray(parameter) && parameter.includes(extractMembershipValue(item) as never);
    case "lt":
      return (
        numericValue(item) !== undefined &&
        typeof parameter === "number" &&
        numericValue(item)! < parameter
      );
    case "lte":
      return (
        numericValue(item) !== undefined &&
        typeof parameter === "number" &&
        numericValue(item)! <= parameter
      );
    case "gt":
      return (
        numericValue(item) !== undefined &&
        typeof parameter === "number" &&
        numericValue(item)! > parameter
      );
    case "gte":
      return (
        numericValue(item) !== undefined &&
        typeof parameter === "number" &&
        numericValue(item)! >= parameter
      );
    case "in_window": {
      const timeValue = item.kind === "time" ? asRecord(value) : undefined;
      const hour = timeValue?.["hour"];
      const weekday = timeValue?.["weekday"];
      const range = asRecord(parameter);
      const pair = Array.isArray(parameter)
        ? parameter
        : range
          ? [range["startHour"], range["endHour"]]
          : [];
      const hoursMatch =
        typeof hour === "number" &&
        pair.length === 2 &&
        typeof pair[0] === "number" &&
        typeof pair[1] === "number" &&
        (pair[0] <= pair[1]
          ? hour >= pair[0] && hour < pair[1]
          : hour >= pair[0] || hour < pair[1]);
      const weekdays = range?.["weekdays"];
      return (
        hoursMatch &&
        (weekdays === undefined ||
          (Array.isArray(weekdays) && typeof weekday === "number" && weekdays.includes(weekday)))
      );
    }
    case "not_novel": {
      const request = requestItem.value;
      const requestData = asRecord(request);
      const history = asRecord(value);
      if (
        item.kind !== "history" ||
        !history ||
        !requestData ||
        typeof parameter !== "number" ||
        typeof requestData["resourceClass"] !== "string"
      )
        return false;
      const classes = history["classes"];
      if (!Array.isArray(classes)) return false;
      const entry = classes.find(
        (candidate) => asRecord(candidate)?.["resourceClass"] === requestData["resourceClass"],
      );
      const found = asRecord(entry);
      return typeof found?.["count"] === "number" && found["count"] >= parameter;
    }
    case "expected_transition": {
      const nav = item.kind === "navigation" ? asRecord(value) : undefined;
      if (
        !nav ||
        typeof nav["previousClass"] !== "string" ||
        typeof nav["currentClass"] !== "string" ||
        typeof nav["transitionCount"] !== "number" ||
        typeof parameter !== "number"
      )
        return false;
      const listed = policy.expectedTransitions.some(
        (transition) =>
          transition.previousClass === nav["previousClass"] &&
          transition.currentClass === nav["currentClass"],
      );
      return listed || nav["transitionCount"] >= parameter;
    }
  }
}

function numericValue(item: ContextItem): number | undefined {
  const value = asRecord(item.value);
  if (!value) return undefined;
  if (item.kind === "frequency" && typeof value["count"] === "number") return value["count"];
  if (item.kind === "session" && typeof value["ageSeconds"] === "number")
    return value["ageSeconds"];
  if (item.kind === "device" && typeof value["tokenAgeSeconds"] === "number")
    return value["tokenAgeSeconds"];
  if (item.kind === "time" && typeof value["hour"] === "number") return value["hour"];
  if (item.kind === "navigation" && typeof value["transitionCount"] === "number")
    return value["transitionCount"];
}

function extractMembershipValue(item: ContextItem): unknown {
  if (item.kind === "network") return item.value;
  if (item.kind === "request") return asRecord(item.value)?.["actionClass"];
  if (item.kind === "location") return asRecord(item.value)?.["region"];
  return item.value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (!leftRecord || !rightRecord) return false;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && deepEqual(leftRecord[key], rightRecord[key]),
    )
  );
}
