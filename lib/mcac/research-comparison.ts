import { evaluateRbac } from "../authorization";
import { evaluateMcac } from "./decision";
import type { ResearchScenario } from "./research-fixtures";

export function compareResearchScenario(scenario: ResearchScenario) {
  const input = scenario.input;
  const requiredPermission = `resources:${input.request.resourceClass}:${input.request.action}`;
  const permissions = input.baselinePermission ? [requiredPermission] : [];

  // Both engines derive their baseline from this same fixture permission set and action.
  const rbacDecision = evaluateRbac(permissions, requiredPermission);
  const mcacResult = evaluateMcac(input);
  if (mcacResult.baselinePermission !== (rbacDecision === "ALLOW"))
    throw new Error("Fixture permission baseline differs between RBAC and formal MCAC");
  if (
    mcacResult.trace.resourceClass !== input.request.resourceClass ||
    mcacResult.trace.action !== input.request.action
  )
    throw new Error("Formal MCAC result does not match the fixture resource/action");

  const differs = rbacDecision !== mcacResult.decision;
  const restricted = rbacDecision === "ALLOW" && mcacResult.decision !== "ALLOW";
  const conditions = mcacResult.conditionEvaluations
    .filter((condition) => condition.outcome !== "T" || condition.severity > 0)
    .map((condition) => ({
      conditionId: condition.conditionId,
      category: condition.category,
      itemReferences: condition.itemReferences,
      outcome: condition.outcome,
      severity: condition.severity,
      reasonCode: condition.reasonCode,
      explanation: condition.explanation,
    }));
  const gamma = mcacResult.trace.gamma
    ? {
        constraints: mcacResult.trace.gamma.constraints.map((constraint) => ({
          constraintId: constraint.constraintId,
          outcome: constraint.outcome,
          reasonCodes: constraint.trace.nodes.flatMap((node) => node.reasonCodes),
        })),
        items: mcacResult.trace.gamma.items.map((item) => ({
          itemKind: item.itemKind,
          effect: item.effect,
          contributingConstraints: item.contributingConstraints,
        })),
      }
    : null;
  const theta = mcacResult.trace.interactions.filter(
    (interaction) => interaction.kind === "environment_conditioned_threshold",
  );
  const explanation = restricted
    ? conditions.length
      ? `Baseline RBAC allows the matching permission. Formal MCAC returned ${mcacResult.decision} because its evaluated synthetic context conditions contributed severity under policy ${input.policy.version}.`
      : `Baseline RBAC allows the matching permission. Formal MCAC returned ${mcacResult.decision} under the formal evaluator; inspect the reported trace for the decision path.`
    : differs
      ? `The evaluators returned different decisions (${rbacDecision} versus ${mcacResult.decision}). This synthetic difference is an observed result, not evidence that either result is more accurate.`
      : `Both evaluators returned ${rbacDecision} for this synthetic fixture.`;

  return Object.freeze({
    scenario: { id: scenario.id, name: scenario.name },
    baseline: {
      permission: requiredPermission,
      granted: input.baselinePermission,
      resourceClass: input.request.resourceClass,
      action: input.request.action,
    },
    rbac: { decision: rbacDecision },
    mcac: {
      decision: mcacResult.decision,
      severity: mcacResult.severity,
      mEnv: mcacResult.mEnv,
      mBeh: mcacResult.mBeh,
      policyVersion: input.policy.version,
      conditions,
      gamma,
      theta,
      trace: mcacResult.trace,
    },
    differs,
    restricted,
    explanation,
  });
}

export function summarizeResearchComparisons(
  results: readonly ReturnType<typeof compareResearchScenario>[],
) {
  return Object.freeze({
    synthetic: true as const,
    totalScenarios: results.length,
    rbac: {
      allow: results.filter((result) => result.rbac.decision === "ALLOW").length,
      deny: results.filter((result) => result.rbac.decision === "DENY").length,
    },
    mcac: {
      allow: results.filter((result) => result.mcac.decision === "ALLOW").length,
      verify: results.filter((result) => result.mcac.decision === "VERIFY").length,
      deny: results.filter((result) => result.mcac.decision === "DENY").length,
    },
    decisionDifferenceCount: results.filter((result) => result.differs).length,
    mcacRestrictionCount: results.filter((result) => result.restricted).length,
  });
}
