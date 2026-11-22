import { createHash } from "node:crypto";
import type {
  GammaConstraint,
  GammaExpression,
  GammaOperand,
  GammaTypedLiteral,
} from "./gamma-types";

export const GAMMA_CANONICALIZATION_VERSION = "mcac-gamma-c14n-v1" as const;
export type GammaCanonicalizationVersion = typeof GAMMA_CANONICALIZATION_VERSION;
export type GammaCanonicalizable =
  GammaConstraint | GammaExpression | GammaOperand | GammaTypedLiteral | readonly GammaConstraint[];
export type GammaAstDigest = Readonly<{
  canonicalizationVersion: GammaCanonicalizationVersion;
  algorithm: "SHA-256";
  hex: string;
}>;

/**
 * Canonical JSON for Γ v1. Numbers use ECMAScript JSON number serialization:
 * JSON.stringify's shortest round-trip decimal representation, with -0 first
 * normalized to +0. This is deterministic for the JavaScript Number model and
 * is not a claim of RFC 8785/JCS conformance.
 */
export function canonicalizeGammaAst(value: GammaCanonicalizable): string {
  return serializeJsonValue(value, new Set<object>());
}

/** Returns a fresh UTF-8 byte array for the canonical Γ representation. */
export function canonicalGammaAstBytes(value: GammaCanonicalizable): Uint8Array {
  return new TextEncoder().encode(canonicalizeGammaAst(value));
}

/** SHA-256 covers only the canonical AST/constraint bytes; context evidence is never accepted here. */
export function digestGammaAst(value: GammaCanonicalizable): GammaAstDigest {
  const hex = createHash("sha256").update(canonicalGammaAstBytes(value)).digest("hex");
  return Object.freeze({
    canonicalizationVersion: GAMMA_CANONICALIZATION_VERSION,
    algorithm: "SHA-256",
    hex,
  });
}

function serializeJsonValue(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("Γ canonical JSON does not permit non-finite numbers");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object")
    throw new TypeError(`Γ canonical JSON does not support ${typeof value}`);
  if (ancestors.has(value)) throw new TypeError("Γ canonical JSON does not permit cyclic values");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      const arrayKeys = ownKeys.filter((key) => key !== "length");
      if (
        arrayKeys.length !== value.length ||
        arrayKeys.some((key, index) => key !== String(index))
      ) {
        throw new TypeError(
          "Γ canonical JSON arrays must be dense and have no extra enumerable properties",
        );
      }
      const entries = arrayKeys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          throw new TypeError(
            "Γ canonical JSON arrays must contain enumerable data properties only",
          );
        return serializeJsonValue(descriptor.value, ancestors);
      });
      return `[${entries.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null)
      throw new TypeError("Γ canonical JSON accepts only plain JSON objects");
    if (Reflect.ownKeys(value).some((key) => typeof key !== "string"))
      throw new TypeError("Γ canonical JSON does not permit symbol properties");
    const record = value as Record<string, unknown>;
    const ownKeys = Reflect.ownKeys(record) as string[];
    const keys = ownKeys.sort(compareUnicodeCodePoints);
    return `{${keys
      .map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
          throw new TypeError(
            "Γ canonical JSON objects must contain enumerable data properties only",
          );
        if (descriptor.value === undefined)
          throw new TypeError("Γ canonical JSON does not permit undefined object values");
        return `${JSON.stringify(key)}:${serializeJsonValue(descriptor.value, ancestors)}`;
      })
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Lexicographic comparison of Unicode scalar/code-point sequences, not UTF-16 code units. */
function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const commonLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < commonLength; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}
