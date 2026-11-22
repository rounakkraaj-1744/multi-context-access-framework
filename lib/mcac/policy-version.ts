import { canonicalJson } from "./trace";
import type { PolicyVersion } from "./types";

/** Creates a detached, deeply frozen snapshot suitable for a decision and later replay. */
export function freezePolicyVersion(policy: PolicyVersion): PolicyVersion {
  if (!policy.version.trim()) throw new Error("Policy version is required");
  const snapshot = structuredClone(policy);
  return deepFreeze(snapshot);
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
