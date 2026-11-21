import type { ContextEvidence, ContextEvidenceItem, ContextItem, ContextItemKind, ContextValueMap, PolicyVersion, ValidityStatus } from "./types";

const kinds: readonly ContextItemKind[] = ["time", "location", "network", "device", "session", "frequency", "history", "navigation", "request"];

/** Applies Γ before Eq. (2), and returns a separate immutable context snapshot. */
export function classifyContext(context: ContextEvidence, policy: PolicyVersion, violated: ReadonlySet<ContextItemKind>, evaluationTime: number): readonly ContextItem[] {
  return kinds.map((kind) => {
    const item = getEvidenceItem(context, kind);
    const status = classifyValidity(item, kind, evaluationTime, policy, violated);
    return Object.freeze({ ...item, validityStatus: status });
  });
}

export function classifyValidity(item: ContextEvidenceItem, kind: ContextItemKind, evaluationTime: number, policy: PolicyVersion, contradictedItems: ReadonlySet<ContextItemKind> = new Set()): ValidityStatus {
  if (item.value === null) return "M";
  if (kind === "history" && (item.value as ContextValueMap["history"]).enrollmentComplete === false) return "M";
  if (kind === "navigation" && (item.value as ContextValueMap["navigation"]).enrollmentComplete === false) return "M";
  if (policy.verificationRequired[kind] === 1 && item.integrityFlag === 0) return "U";
  if (contradictedItems.has(kind)) return "X";
  const freshness = policy.freshnessSeconds[kind];
  if (item.observedAt === null || item.sourceClass === null) throw new Error(`Present context item ${kind} is missing tuple metadata`);
  if (![evaluationTime, item.observedAt, freshness].every(Number.isFinite) || freshness < 0) throw new Error(`Invalid timestamp or freshness bound for ${kind}`);
  if ((evaluationTime - item.observedAt) / 1000 > freshness) return "S";
  return "V";
}

export function getEvidenceItem(context: ContextEvidence, kind: ContextItemKind): ContextEvidenceItem {
  return kind in context.environmental
    ? context.environmental[kind as keyof ContextEvidence["environmental"]]
    : context.behavioral[kind as keyof ContextEvidence["behavioral"]];
}

export function isDegraded(status: ValidityStatus): boolean { return status !== "V"; }

/** Runtime guards protect the typed boundary when data arrives from JSON/SQLite adapters. */
export function validateContextEvidence(context: ContextEvidence, policy: PolicyVersion, evaluationTime: number): void {
  for (const kind of kinds) {
    const item = getEvidenceItem(context, kind);
    const freshness = policy.freshnessSeconds[kind];
    if (!Number.isFinite(freshness) || freshness < 0) throw new Error(`Invalid freshness bound for ${kind}`);
    if (item.value === null) {
      if (kind === "time" || kind === "request") throw new Error(`Context item ${kind} is required by Table VI and cannot be absent`);
      if (item.observedAt !== null || item.sourceClass !== null || item.integrityFlag !== 0) throw new Error(`Absent item ${kind} must use the ⊥ representation`);
      continue;
    }
    if (!Number.isFinite(item.observedAt) || item.sourceClass === null || (item.sourceClass === "srv" && item.integrityFlag !== 1)) throw new Error(`Invalid tuple metadata for ${kind}`);
    if (item.sourceClass !== "srv" && item.sourceClass !== "ext") throw new Error(`Invalid source class for ${kind}`);
    if (item.integrityFlag !== 0 && item.integrityFlag !== 1) throw new Error(`Invalid integrity flag for ${kind}`);
    if (!validValue(kind, item.value)) throw new Error(`Invalid value for context item ${kind}`);
  }
  if (!Number.isFinite(evaluationTime)) throw new Error("Context evaluation time must be finite");
}

export function contextValiditySnapshot(items: readonly ContextItem[]): Readonly<Record<ContextItemKind, ValidityStatus>> {
  return Object.fromEntries(items.map(({ kind, validityStatus }) => [kind, validityStatus])) as Record<ContextItemKind, ValidityStatus>;
}

function validValue(kind: ContextItemKind, value: unknown): boolean {
  if (kind === "network") return value === "corporate" || value === "vpn" || value === "known" || value === "unknown";
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (kind === "time") return Number.isInteger(record["weekday"]) && Number(record["weekday"]) >= 0 && Number(record["weekday"]) <= 6 && finiteBetween(record["hour"], 0, 24, false) && typeof record["timezone"] === "string";
  if (kind === "location") return typeof record["country"] === "string" && typeof record["region"] === "string";
  if (kind === "device") return typeof record["registered"] === "boolean" && (typeof record["deviceId"] === "string" || record["deviceId"] === null) && finiteBetween(record["tokenAgeSeconds"], 0, Infinity, true);
  if (kind === "session") return typeof record["method"] === "string" && finiteBetween(record["ageSeconds"], 0, Infinity, true);
  if (kind === "frequency") return Number.isInteger(record["count"]) && Number(record["count"]) >= 0 && finiteBetween(record["windowSeconds"], 0, Infinity, false);
  if (kind === "history") return Array.isArray(record["classes"]) && record["classes"].every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const count = (entry as Record<string, unknown>)["count"];
    return typeof (entry as Record<string, unknown>)["resourceClass"] === "string" && Number.isInteger(count) && Number(count) >= 0;
  }) && finiteBetween(record["windowDays"], 0, Infinity, false) && typeof record["enrollmentComplete"] === "boolean";
  if (kind === "navigation") return (typeof record["previousClass"] === "string" || record["previousClass"] === null) && typeof record["currentClass"] === "string" && Number.isInteger(record["transitionCount"]) && Number(record["transitionCount"]) >= 0 && typeof record["enrollmentComplete"] === "boolean";
  return typeof record["resourceClass"] === "string" && ["read", "write", "export", "admin"].includes(String(record["actionClass"]));
}

function finiteBetween(value: unknown, minimum: number, maximum: number, inclusiveMinimum: boolean): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return (inclusiveMinimum ? value >= minimum : value > minimum) && value < maximum;
}
