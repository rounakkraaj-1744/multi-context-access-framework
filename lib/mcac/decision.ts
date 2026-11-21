import { classifyContext, validateContextEvidence } from "./context";
import { evaluateConditions } from "./conditions";
import { evaluateCrossCategoryConsistency } from "./interactions";
import { aggregateCategory, aggregateSeverity } from "./severity";
import { hashTrace } from "./trace";
import { freezePolicyVersion } from "./policy-version";
import type { ActionClass, AuthorizationInput, AuthorizationResult, ConditionEvaluation, McacDecision, McacTrace, PolicyVersion, Rule } from "./types";

export function evaluateMcac(input: AuthorizationInput): AuthorizationResult {
  validateEnvelope(input);
  const policy = freezePolicyVersion(input.policy);
  let profile: PolicyVersion["resourceProfiles"][string] | undefined;
  let applicable: readonly Rule[] = [];
  let items: ReturnType<typeof classifyContext> = Object.freeze([]);
  let conditionEvaluations: readonly ConditionEvaluation[] = Object.freeze([]);
  let interactions: ReturnType<typeof evaluateCrossCategoryConsistency>["interactions"] = Object.freeze([]);
  let mEnv: 0 | 1 | 2 = 0;
  let mBeh: 0 | 1 | 2 = 0;
  let severity: 0 | 1 | 2 = 0;
  let waiverValid = false;
  let decision: McacDecision;

  // Algorithm 1, lines 2–5. No context processing occurs before this baseline gate.
  if (!input.baselinePermission) decision = "DENY";
  else {
    validateModelPolicy(input, policy);
    profile = policy.resourceProfiles[input.request.resourceClass];
    if (!profile) throw new Error(`No sensitivity/step-up profile is configured for resource class ${input.request.resourceClass}`);
    applicable = applicableRules(policy, input.request.resourceClass, input.request.action);
    validateContextEvidence(input.context, policy, input.request.time);
    const requested = input.context.behavioral.request.value;
    if (requested?.resourceClass !== input.request.resourceClass || requested.actionClass !== input.request.action) throw new Error("Behavioral request descriptor does not match the authorization request");
    waiverValid = isWaiverValid(input.waiver, input, profile!);
    const consistency = evaluateCrossCategoryConsistency(policy, input.consistencyEvidence);
    interactions = consistency.interactions;
    items = classifyContext(input.context, policy, consistency.violatedItems, input.request.time);
    const env = evaluateConditions(applicable, "environmental", input.context, items, input.request.time, policy, profile!.sensitivity);
    const behavior = evaluateConditions(applicable, "behavioral", input.context, items, input.request.time, policy, profile!.sensitivity);
    interactions = Object.freeze([...interactions, ...env.interactions, ...behavior.interactions]);
    const all = [...env.evaluations, ...behavior.evaluations].map((evaluation) => Object.freeze({
      ...evaluation,
      severity: waiverValid && evaluation.severity === 1 ? 0 as const : evaluation.severity,
      ...(waiverValid && evaluation.severity === 1 ? { reasonCode: "VALID_STEP_UP_WAIVER", explanation: "A valid class/action/session-bound waiver reduced severity one to zero." } : {}),
    }));
    conditionEvaluations = Object.freeze(all.sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.conditionId.localeCompare(b.conditionId)));
    mEnv = aggregateCategory(conditionEvaluations, "environmental");
    mBeh = aggregateCategory(conditionEvaluations, "behavioral");
    severity = aggregateSeverity(mEnv, mBeh);
    decision = input.waiver !== null && !waiverValid ? "DENY" : decide(input.baselinePermission, severity, profile!.stepUpAvailable);
  }

  const traceRecord: Omit<McacTrace, "hash"> = {
    requestId: input.request.requestId,
    time: new Date(input.request.time).toISOString(),
    user: input.request.userId,
    sessionId: input.request.sessionId,
    resource: input.request.resourceId,
    resourceClass: input.request.resourceClass,
    action: input.request.action,
    policyVersion: policy.version,
    baseline: input.baselinePermission,
    sensitivity: profile?.sensitivity ?? null,
    stepUpAvailable: profile?.stepUpAvailable ?? null,
    consistencyEvidence: Object.freeze([...input.consistencyEvidence].sort((a, b) => a.id.localeCompare(b.id))),
    items,
    conditions: conditionEvaluations,
    interactions,
    mEnv,
    mBeh,
    m: severity,
    decision,
    waiver: input.waiver,
    previousHash: input.previousHash,
  };
  const trace: McacTrace = Object.freeze({ ...traceRecord, hash: hashTrace(traceRecord) });
  return Object.freeze({ decision, baselinePermission: input.baselinePermission, mEnv, mBeh, severity, conditionEvaluations, trace });
}

export function decide(baselinePermission: boolean, severity: 0 | 1 | 2, stepUpAvailable: boolean): McacDecision {
  if (!baselinePermission) return "DENY";
  if (severity === 0) return "ALLOW";
  if (severity === 2) return "DENY";
  return stepUpAvailable ? "VERIFY" : "DENY";
}

export function applicableRules(policy: PolicyVersion, resourceClass: string, action: ActionClass): readonly Rule[] {
  return policy.rules.filter((rule) => rule.resourceClass === resourceClass && rule.actions.includes(action));
}

function validateEnvelope(input: AuthorizationInput): void {
  if (!input.policy.version?.trim()) throw new Error("Policy version is required for a trace");
  if (!Number.isFinite(input.request.time) || Math.abs(input.request.time) > 8.64e15) throw new Error("Request time must be a finite supported timestamp");
  if (!/^[0-9a-f]{64}$/i.test(input.previousHash) && input.previousHash !== "GENESIS") throw new Error("previousHash must be GENESIS or a SHA-256 hex digest");
}

function validateModelPolicy(input: AuthorizationInput, policy: PolicyVersion): void {
  if (typeof policy.strictLowSensitivity !== "boolean" || typeof policy.interactions.environmentConditionedThresholds !== "boolean" || typeof policy.interactions.crossCategoryConsistency !== "boolean") throw new Error("Invalid MCAC policy switches");
  for (const [resourceClass, profile] of Object.entries(policy.resourceProfiles)) {
    if (!resourceClass || (profile.sensitivity !== "L" && profile.sensitivity !== "H") || typeof profile.stepUpAvailable !== "boolean" || !Number.isFinite(profile.waiverDurationSeconds) || profile.waiverDurationSeconds < 0) throw new Error(`Invalid resource profile for ${resourceClass}`);
  }
  const ids = new Set<string>();
  for (const rule of policy.rules) {
    if (ids.has(rule.id)) throw new Error(`Duplicate rule id ${rule.id}`);
    ids.add(rule.id);
    const conditionIds = [...rule.environmental, ...rule.behavioral].map((condition) => condition.id);
    if (new Set(conditionIds).size !== conditionIds.length) throw new Error(`Duplicate condition id in rule ${rule.id}`);
    for (const condition of rule.environmental) validateCondition(condition, "environmental");
    for (const condition of rule.behavioral) validateCondition(condition, "behavioral");
  }
  const declared = new Set(policy.consistencyConstraints.map((constraint) => constraint.id));
  if (declared.size !== policy.consistencyConstraints.length) throw new Error("Duplicate consistency constraint id");
  for (const constraint of policy.consistencyConstraints) {
    if (!constraint.id || constraint.items.length === 0 || new Set(constraint.items).size !== constraint.items.length) throw new Error(`Invalid consistency constraint ${constraint.id}`);
  }
  const evidenceIds = new Set<string>();
  for (const evidence of input.consistencyEvidence) {
    if (!declared.has(evidence.id)) throw new Error(`Undeclared consistency evidence ${evidence.id}`);
    if (evidenceIds.has(evidence.id)) throw new Error(`Duplicate consistency evidence ${evidence.id}`);
    evidenceIds.add(evidence.id);
    if (typeof evidence.violated !== "boolean") throw new Error(`Invalid consistency outcome ${evidence.id}`);
  }
  for (const kind of ["time", "location", "network", "device", "session", "frequency", "history", "navigation", "request"] as const) {
    if (policy.verificationRequired[kind] !== 0 && policy.verificationRequired[kind] !== 1) throw new Error(`Invalid verification requirement for ${kind}`);
  }
}

function isWaiverValid(waiver: AuthorizationInput["waiver"], input: AuthorizationInput, profile: NonNullable<PolicyVersion["resourceProfiles"][string]>): boolean {
  return waiver !== null && waiver.assuranceMeetsRequired && profile.stepUpAvailable &&
    waiver.userId === input.request.userId && waiver.sessionId === input.request.sessionId &&
    waiver.resourceClass === input.request.resourceClass && waiver.action === input.request.action &&
    Number.isFinite(waiver.verifiedAt) && Number.isFinite(waiver.expiresAt) &&
    input.request.time >= waiver.verifiedAt && input.request.time < waiver.expiresAt &&
    waiver.expiresAt - waiver.verifiedAt <= profile.waiverDurationSeconds * 1000;
}

function validateCondition(condition: Rule["environmental"][number], category: "environmental" | "behavioral"): void {
  const environmental = condition.item === "time" || condition.item === "location" || condition.item === "network" || condition.item === "device";
  if ((category === "environmental") !== environmental) throw new Error(`Condition ${condition.id} is assigned to the wrong context category`);
  if (!condition.id || (condition.strength !== "soft" && condition.strength !== "hard")) throw new Error(`Invalid condition definition in rule ${condition.id}`);
  if (condition.comparator !== "eq" && condition.comparator !== "neq" && condition.comparator !== "in" && condition.comparator !== "lt" && condition.comparator !== "lte" && condition.comparator !== "gt" && condition.comparator !== "gte" && condition.comparator !== "in_window" && condition.comparator !== "registered" && condition.comparator !== "not_novel" && condition.comparator !== "expected_transition") throw new Error(`Unsupported condition comparator ${String(condition.comparator)}`);
  if (condition.strength === "hard" && condition.item === "location") throw new Error(`Hard conditions cannot use approximate location evidence (Section XI-C)`);
  if (condition.comparator === "registered" && condition.item !== "device") throw new Error(`registered comparator requires the device item`);
  if (condition.comparator === "not_novel" && condition.item !== "history") throw new Error(`not_novel comparator requires the access-history item`);
  if (condition.comparator === "expected_transition" && condition.item !== "navigation") throw new Error(`expected_transition comparator requires the navigation item`);
  if (condition.comparator === "in_window" && condition.item !== "time") throw new Error(`in_window comparator requires the time item`);
  if (["lt", "lte", "gt", "gte"].includes(condition.comparator) && !["time", "session", "frequency", "device", "navigation"].includes(condition.item)) throw new Error(`Numeric comparator is not supported for ${condition.item}`);
  const parameter = condition.parameter;
  const networkLookup = typeof parameter === "object" && parameter !== null && !Array.isArray(parameter) && "by" in parameter;
  if (networkLookup && (category !== "behavioral" || parameter.by !== "network")) throw new Error(`Environment-conditioned threshold is only valid for behavioral conditions`);
  if (["lt", "lte", "gt", "gte", "not_novel", "expected_transition"].includes(condition.comparator) && typeof parameter !== "number" && !networkLookup) throw new Error(`Comparator ${condition.comparator} requires a numeric parameter`);
  if (condition.comparator === "registered" && typeof parameter !== "boolean") throw new Error("registered comparator requires a Boolean parameter");
  if (condition.comparator === "in" && !Array.isArray(parameter)) throw new Error("in comparator requires a finite set parameter");
  if (condition.comparator === "in_window") {
    const record = typeof parameter === "object" && parameter !== null && !Array.isArray(parameter) ? parameter as Record<string, unknown> : undefined;
    const pair = Array.isArray(parameter) ? parameter : record ? [record["startHour"], record["endHour"]] : [];
    if (pair.length !== 2 || typeof pair[0] !== "number" || typeof pair[1] !== "number" || !pair.every(Number.isFinite)) throw new Error("in_window comparator requires a valid hour range");
    if (record?.["weekdays"] !== undefined && (!Array.isArray(record["weekdays"]) || !record["weekdays"].every((day) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6))) throw new Error("in_window weekdays must be integers from 0 to 6");
  }
  if (networkLookup) {
    if (!["lt", "lte", "gt", "gte"].includes(condition.comparator) || Object.values(parameter.values).some((value) => typeof value !== "number")) throw new Error("Network-conditioned thresholds require numeric comparison and values");
  }
}
