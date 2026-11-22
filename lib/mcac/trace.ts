import { createHash } from "node:crypto";
import type { McacTrace } from "./types";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

export function hashTrace(record: Omit<McacTrace, "hash">): string {
  return createHash("sha256").update(canonicalJson(record), "utf8").digest("hex");
}

export function verifyTraceHash(trace: McacTrace): boolean {
  const { hash, ...record } = trace;
  return hashTrace(record) === hash;
}
