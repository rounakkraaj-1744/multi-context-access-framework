import { digestGammaAst, type GammaAstDigest } from "./gamma-canonical";
import type { GammaConstraint } from "./gamma-types";
import {
  validateGammaConstraints,
  type GammaValidationError,
} from "./gamma-validation";

export type GammaPolicyValidation = Readonly<{
  ok: boolean;
  hasGamma: boolean;
  hasLegacyConstraints: boolean;
  constraints: readonly GammaConstraint[];
  canonicalBytes: number;
  digest: GammaAstDigest | null;
  errors: readonly GammaValidationError[];
}>;

/** Selects AST constraints from a mixed legacy/Gamma formal policy and delegates AST rules to Γ-2. */
export function validatePolicyGammaConstraints(policy: unknown): GammaPolicyValidation {
  const policyRecord = asRecord(policy);
  const rawConstraints = policyRecord?.["consistencyConstraints"];
  if (rawConstraints === undefined)
    return Object.freeze({
      ok: true,
      hasGamma: false,
      hasLegacyConstraints: false,
      constraints: Object.freeze([]),
      canonicalBytes: 0,
      digest: null,
      errors: Object.freeze([]),
    });

  if (!Array.isArray(rawConstraints))
    return Object.freeze({
      ok: false,
      hasGamma: false,
      hasLegacyConstraints: false,
      constraints: Object.freeze([]),
      canonicalBytes: 0,
      digest: null,
      errors: Object.freeze<GammaValidationError[]>([
        {
          code: "INVALID_TYPE",
          path: "$.consistencyConstraints",
          message: "Policy consistencyConstraints must be an array.",
        },
      ]),
    });

  const gammaEntries: { index: number; value: unknown }[] = [];
  const legacyEntries: { index: number; value: unknown }[] = [];
  rawConstraints.forEach((value, index) => {
    (isLegacyConstraintShape(value) ? legacyEntries : gammaEntries).push({ index, value });
  });
  const hasGamma = gammaEntries.length > 0;
  if (!hasGamma)
    return Object.freeze({
      ok: true,
      hasGamma: false,
      hasLegacyConstraints: legacyEntries.length > 0,
      constraints: Object.freeze([]),
      canonicalBytes: 0,
      digest: null,
      errors: Object.freeze([]),
    });

  const interactionRecord = asRecord(policyRecord?.["interactions"]);
  const validation = validateGammaConstraints(
    gammaEntries.map((entry) => entry.value),
    interactionRecord?.["crossCategoryConsistency"],
  );
  const errors: GammaValidationError[] = validation.ok
    ? []
    : validation.errors.map((error) => ({
        ...error,
        path: remapConstraintPath(error.path, gammaEntries),
      }));

  if (validation.ok) {
    const allIds = new Map<string, number>();
    rawConstraints.forEach((entry, index) => {
      const id = asRecord(entry)?.["id"];
      if (typeof id !== "string") return;
      const previousIndex = allIds.get(id);
      if (
        previousIndex !== undefined &&
        (isGammaIndex(index, gammaEntries) || isGammaIndex(previousIndex, gammaEntries))
      ) {
        errors.push({
          code: "DUPLICATE_CONSTRAINT_ID",
          path: `$.consistencyConstraints[${index}].id`,
          message: `Constraint ID ${JSON.stringify(id)} is duplicated in the policy.`,
        });
      } else if (previousIndex === undefined) {
        allIds.set(id, index);
      }
    });
  }

  if (errors.length > 0 || !validation.ok)
    return Object.freeze({
      ok: false,
      hasGamma: true,
      hasLegacyConstraints: legacyEntries.length > 0,
      constraints: Object.freeze([]),
      canonicalBytes: validation.ok ? validation.value.canonicalBytes : 0,
      digest: null,
      errors: Object.freeze(errors),
    });

  const constraints = validation.value.constraints;
  return Object.freeze({
    ok: true,
    hasGamma: true,
    hasLegacyConstraints: legacyEntries.length > 0,
    constraints,
    canonicalBytes: validation.value.canonicalBytes,
    digest: digestGammaAst(constraints),
    errors: Object.freeze([]),
  });
}

function isLegacyConstraintShape(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) return false;
  const keys = Object.keys(record).sort();
  return keys.length === 2 && keys[0] === "id" && keys[1] === "items";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function remapConstraintPath(
  path: string,
  entries: readonly { index: number; value: unknown }[],
): string {
  const match = /^\$\.consistencyConstraints\[(\d+)\](.*)$/.exec(path);
  if (!match) return path;
  const original = entries[Number(match[1])];
  return original ? `$.consistencyConstraints[${original.index}]${match[2]}` : path;
}

function isGammaIndex(index: number, entries: readonly { index: number }[]): boolean {
  return entries.some((entry) => entry.index === index);
}
