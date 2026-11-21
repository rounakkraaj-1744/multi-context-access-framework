import { evaluateMcac } from "./decision";
import type { AuthorizationInput, AuthorizationResult } from "./types";

export type ApplicationAuthorizationInput = Omit<AuthorizationInput, "baselinePermission"> & Readonly<{
  effectivePermissions: readonly string[];
  requiredPermission: string;
}>;

export type ApplicationAuthorizationResult = AuthorizationResult & Readonly<{
  enforcement: "CONTENT_ALLOWED" | "VERIFICATION_REQUIRED" | "ACCESS_DENIED";
}>;

/**
 * Boundary adapter for a future App Router integration. It translates only the
 * existing effective-permission set into the formal RBAC predicate; callers
 * must supply paper-shaped evidence and an immutable MCAC policy snapshot.
 */
export function evaluateMcacForApplication(input: ApplicationAuthorizationInput): ApplicationAuthorizationResult {
  const { effectivePermissions, requiredPermission, ...domainInput } = input;
  const result = evaluateMcac({ ...domainInput, baselinePermission: effectivePermissions.includes(requiredPermission) });
  const enforcement = result.decision === "ALLOW" ? "CONTENT_ALLOWED" : result.decision === "VERIFY" ? "VERIFICATION_REQUIRED" : "ACCESS_DENIED";
  return Object.freeze({ ...result, enforcement });
}
