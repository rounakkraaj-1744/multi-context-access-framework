/**
 * Independent, deliberately small evaluator for the unambiguous core of
 * manuscript Eqs. (2), (5), and (7)–(11), used as the Eq. (19) reference.
 * It does not call production MCAC code. Ambiguous policy shapes fail closed
 * as "reference blocked" instead of receiving an invented interpretation.
 */
import type { AuthorizationInput, McacDecision, ValidityStatus } from "../types";

export type ReferenceResult = Readonly<{
  decision: McacDecision;
  mEnv: 0 | 1 | 2;
  mBeh: 0 | 1 | 2;
  severity: 0 | 1 | 2;
}>;

export function evaluateReference(input: AuthorizationInput): ReferenceResult {
  if (!input.baselinePermission) return { decision: "DENY", mEnv: 0, mBeh: 0, severity: 0 };
  const profile = input.policy.resourceProfiles[input.request.resourceClass];
  if (!profile) throw new Error("Reference blocked: missing resource profile");
  const statuses = new Map<string, ValidityStatus>();
  const declared = new Map(input.policy.consistencyConstraints.map((c) => [c.id, c]));
  const violations = new Set<string>();
  if (input.policy.interactions.crossCategoryConsistency) {
    for (const evidence of input.consistencyEvidence) {
      if (!declared.has(evidence.id))
        throw new Error(`Reference blocked: undeclared Γ evidence ${evidence.id}`);
      if (evidence.violated)
        for (const kind of declared.get(evidence.id)!.items) violations.add(kind);
    }
    for (const constraint of declared.keys())
      if (!input.consistencyEvidence.some((e) => e.id === constraint))
        throw new Error(`Reference blocked: missing Γ evidence ${constraint}`);
  }
  const groups = [input.context.environmental, input.context.behavioral];
  for (const group of groups)
    for (const [kind, item] of Object.entries(group)) {
      let status: ValidityStatus;
      if (item.value === null) status = "M";
      else if (
        input.policy.verificationRequired[
          kind as keyof typeof input.policy.verificationRequired
        ] === 1 &&
        item.integrityFlag === 0
      )
        status = "U";
      else if (violations.has(kind)) status = "X";
      else if (item.observedAt === null || item.sourceClass === null)
        throw new Error(`Reference blocked: malformed ${kind} evidence`);
      else if (
        (input.request.time - item.observedAt) / 1000 >
        input.policy.freshnessSeconds[kind as keyof typeof input.policy.freshnessSeconds]
      )
        status = "S";
      else status = "V";
      statuses.set(kind, status);
    }

  let mEnv: 0 | 1 | 2 = 0;
  let mBeh: 0 | 1 | 2 = 0;
  for (const rule of input.policy.rules.filter(
    (r) =>
      r.resourceClass === input.request.resourceClass && r.actions.includes(input.request.action),
  )) {
    for (const [category, conditions] of [
      ["environmental", rule.environmental],
      ["behavioral", rule.behavioral],
    ] as const) {
      for (const condition of conditions) {
        const item =
          condition.item === "time" ||
          condition.item === "location" ||
          condition.item === "network" ||
          condition.item === "device"
            ? input.context.environmental[condition.item]
            : input.context.behavioral[condition.item];
        const status = statuses.get(condition.item);
        let parameter: unknown = condition.parameter;
        if (
          typeof parameter === "object" &&
          parameter !== null &&
          !Array.isArray(parameter) &&
          "by" in parameter
        ) {
          const lookup = parameter as { by: string; values?: Record<string, unknown> };
          if (lookup.by !== "network")
            throw new Error(`Reference blocked: unsupported threshold dependency`);
          if (!input.policy.interactions.environmentConditionedThresholds) parameter = undefined;
          else if (statuses.get("network") !== "V") parameter = undefined;
          else {
            const network = input.context.environmental.network.value;
            parameter = typeof network === "string" ? lookup.values?.[network] : undefined;
            if (parameter === undefined)
              throw new Error(
                `AUTHOR DECISION REQUIRED: valid network class absent from Θ (${String(network)})`,
              );
          }
        }
        const outcome =
          status !== "V" || parameter === undefined || item.value === null
            ? "I"
            : compare(condition.comparator, item.value, parameter, input);
        const base = condition.strength === "soft" ? 1 : 2;
        let severity: 0 | 1 | 2 =
          outcome === "T"
            ? 0
            : outcome === "F"
              ? base
              : profile.sensitivity === "H" || input.policy.strictLowSensitivity
                ? base
                : ((Math.min(base, 1) * (1 - rule.failOpen)) as 0 | 1);
        const w = input.waiver;
        const waiverApplies =
          w !== null &&
          w.assuranceMeetsRequired &&
          profile.stepUpAvailable &&
          w.userId === input.request.userId &&
          w.sessionId === input.request.sessionId &&
          w.resourceClass === input.request.resourceClass &&
          w.action === input.request.action &&
          input.request.time >= w.verifiedAt &&
          input.request.time < w.expiresAt;
        if (waiverApplies && severity === 1) severity = 0;
        if (category === "environmental") mEnv = Math.max(mEnv, severity) as 0 | 1 | 2;
        else mBeh = Math.max(mBeh, severity) as 0 | 1 | 2;
      }
    }
  }
  const severity = Math.max(mEnv, mBeh) as 0 | 1 | 2;
  const decision: McacDecision =
    severity === 0 ? "ALLOW" : severity === 2 || !profile.stepUpAvailable ? "DENY" : "VERIFY";
  return { decision, mEnv, mBeh, severity };
}

function compare(
  op: string,
  actual: unknown,
  expected: unknown,
  input: AuthorizationInput,
): "T" | "F" {
  let result: boolean;
  switch (op) {
    case "eq":
      result = same(actual, expected);
      break;
    case "neq":
      result = !same(actual, expected);
      break;
    case "in": {
      if (!Array.isArray(expected))
        throw new Error("Reference blocked: invalid membership parameter");
      const candidate =
        typeof actual === "object" && actual !== null
          ? ((actual as Record<string, unknown>).region ??
            (actual as Record<string, unknown>).actionClass)
          : actual;
      result = expected.some((v) => same(v, candidate));
      break;
    }
    case "registered":
      result =
        typeof actual === "object" &&
        actual !== null &&
        (actual as Record<string, unknown>).registered === expected;
      break;
    case "in_window": {
      const v = actual as { hour?: number; weekday?: number };
      const p = expected as { startHour?: number; endHour?: number; weekdays?: number[] };
      if (
        typeof v.hour !== "number" ||
        typeof p.startHour !== "number" ||
        typeof p.endHour !== "number"
      )
        throw new Error("Reference blocked: unsupported in_window shape");
      const hours =
        p.startHour <= p.endHour
          ? v.hour >= p.startHour && v.hour < p.endHour
          : v.hour >= p.startHour || v.hour < p.endHour;
      result = hours && (p.weekdays === undefined || p.weekdays.includes(v.weekday!));
      break;
    }
    case "lte":
    case "lt":
    case "gte":
    case "gt": {
      const record = actual as Record<string, unknown>;
      const n =
        typeof actual === "number"
          ? actual
          : (record.count ??
            record.ageSeconds ??
            record.tokenAgeSeconds ??
            record.hour ??
            record.transitionCount);
      if (typeof n !== "number" || typeof expected !== "number")
        throw new Error(`Reference blocked: invalid numeric comparator ${op}`);
      result =
        op === "lte"
          ? n <= expected
          : op === "lt"
            ? n < expected
            : op === "gte"
              ? n >= expected
              : n > expected;
      break;
    }
    case "not_novel": {
      const req = input.context.behavioral.request.value;
      const classes = (actual as { classes?: { resourceClass: string; count: number }[] }).classes;
      if (!req || !classes || typeof expected !== "number")
        throw new Error("Reference blocked: invalid not_novel evidence");
      result = (classes.find((x) => x.resourceClass === req.resourceClass)?.count ?? 0) >= expected;
      break;
    }
    case "expected_transition": {
      const nav = actual as {
        previousClass?: string | null;
        currentClass?: string;
        transitionCount?: number;
      };
      if (typeof expected !== "number")
        throw new Error("Reference blocked: invalid expected_transition threshold");
      result =
        input.policy.expectedTransitions.some(
          (x) => x.previousClass === nav.previousClass && x.currentClass === nav.currentClass,
        ) || (nav.transitionCount ?? -1) >= expected;
      break;
    }
    default:
      throw new Error(
        `AUTHOR DECISION REQUIRED: comparator grammar for ⊕ includes no unambiguous definition for ${op}`,
      );
  }
  return result ? "T" : "F";
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => same(v, b[i]))
    );
  const ak = Object.keys(a as object).sort();
  const bk = Object.keys(b as object).sort();
  return (
    ak.length === bk.length &&
    ak.every(
      (k, i) =>
        k === bk[i] && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}
