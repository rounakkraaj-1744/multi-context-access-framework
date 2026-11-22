import { canonicalJson } from "./trace";
import { digestGammaAst } from "./gamma-canonical";
import { GAMMA_EVALUATOR_SEMANTICS_VERSION, GammaEvaluationError } from "./gamma-evaluator";
import { validatePolicyGammaConstraints } from "./gamma-policy";
import type { PolicyVersion } from "./types";

export type StoredGammaPolicyMetadata = NonNullable<PolicyVersion["gammaMetadata"]>;

/** Creates a detached, deeply frozen snapshot suitable for a decision and later replay. */
export function freezePolicyVersion(policy: PolicyVersion): PolicyVersion {
  if (!policy.version.trim()) throw new Error("Policy version is required");
  const snapshot = structuredClone(policy);
  return deepFreeze(snapshot);
}

/** Adds verifiable Γ semantic identifiers to an immutable snapshot before it is stored. */
export function withGammaVersionMetadata(policy: PolicyVersion): PolicyVersion {
  const validation = validatePolicyGammaConstraints(policy);
  if (!validation.ok) throw new GammaEvaluationError("INVALID_GAMMA_POLICY", validation.errors);
  if (!validation.hasGamma) {
    if (policy.gammaMetadata !== undefined)
      throw new Error("Γ metadata is present on a policy without Γ constraints");
    return policy;
  }
  const expected: StoredGammaPolicyMetadata = Object.freeze({
    constraintsDigest: digestGammaAst(validation.constraints),
    evaluatorSemanticsVersion: GAMMA_EVALUATOR_SEMANTICS_VERSION,
  });
  if (
    policy.gammaMetadata !== undefined &&
    canonicalJson(policy.gammaMetadata) !== canonicalJson(expected)
  )
    throw new Error("Γ policy metadata does not match the constraint AST");
  return Object.freeze({ ...policy, gammaMetadata: expected });
}

/** Immutable storage loads fail closed if stored Γ metadata is missing, stale, or malformed. */
export function assertGammaVersionMetadata(policy: PolicyVersion): void {
  const validation = validatePolicyGammaConstraints(policy);
  if (!validation.ok) throw new GammaEvaluationError("INVALID_GAMMA_POLICY", validation.errors);
  if (!validation.hasGamma) {
    if (policy.gammaMetadata !== undefined)
      throw new Error("Γ metadata is present on a policy without Γ constraints");
    return;
  }
  if (policy.gammaMetadata === undefined)
    throw new Error("Immutable Γ policy version is missing semantic metadata");
  const expected: StoredGammaPolicyMetadata = {
    constraintsDigest: digestGammaAst(validation.constraints),
    evaluatorSemanticsVersion: GAMMA_EVALUATOR_SEMANTICS_VERSION,
  };
  if (canonicalJson(policy.gammaMetadata) !== canonicalJson(expected))
    throw new Error("Immutable Γ policy metadata does not match its constraint AST");
}

/** A changed policy body must use a new version identifier. */
export function assertPolicyVersionTransition(previous: PolicyVersion, next: PolicyVersion): void {
  const { version: previousVersion, ...previousBody } = previous;
  const { version: nextVersion, ...nextBody } = next;
  if (canonicalJson(previousBody) !== canonicalJson(nextBody) && previousVersion === nextVersion) {
    throw new Error(
      `Policy content changed without a new immutable version (version ${previousVersion})`,
    );
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
