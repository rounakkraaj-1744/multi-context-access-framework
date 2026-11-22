import { CANONICAL_NETWORK_CLASSES } from "./types";

const canonicalNetworkClasses: ReadonlySet<string> = new Set(CANONICAL_NETWORK_CLASSES);
const numericComparators: ReadonlySet<string> = new Set(["lt", "lte", "gt", "gte"]);

/** Returns Θ-specific policy errors without trusting the draft's JSON shape. */
export function thetaPolicyErrors(policy: unknown): readonly string[] {
  if (!isRecord(policy)) return Object.freeze([]);
  const interactions = isRecord(policy["interactions"]) ? policy["interactions"] : undefined;
  const enabled = interactions?.["environmentConditionedThresholds"];
  const errors: string[] = [];
  const rules = policy["rules"];
  if (!Array.isArray(rules)) return Object.freeze(errors);

  for (const [ruleIndex, rule] of rules.entries()) {
    if (!isRecord(rule)) continue;
    for (const category of ["environmental", "behavioral"] as const) {
      const conditions = rule[category];
      if (!Array.isArray(conditions)) continue;
      for (const [conditionIndex, condition] of conditions.entries()) {
        if (
          !isRecord(condition) ||
          !isRecord(condition["parameter"]) ||
          !("by" in condition["parameter"])
        )
          continue;
        const location = `rule ${String(rule["id"] ?? ruleIndex)} condition ${String(condition["id"] ?? conditionIndex)}`;
        const parameter = condition["parameter"];
        if (Object.keys(parameter).length !== 2 || !("values" in parameter)) {
          errors.push(`${location}: Θ must contain exactly the dependency and values mapping.`);
        }
        if (parameter["by"] !== "network") {
          errors.push(
            `${location}: unsupported Θ dependency; only the network dependency is defined.`,
          );
          continue;
        }
        if (enabled !== true)
          errors.push(`${location}: a network-conditioned threshold requires Θ to be enabled.`);
        if (category !== "behavioral")
          errors.push(`${location}: Θ network thresholds are only valid on behavioral conditions.`);
        if (
          typeof condition["comparator"] !== "string" ||
          !numericComparators.has(condition["comparator"])
        ) {
          errors.push(`${location}: Θ network thresholds require a numeric comparison.`);
        }

        const values = parameter["values"];
        if (!isRecord(values)) {
          errors.push(`${location}: Θ values must be an explicit network-class mapping.`);
          continue;
        }
        const configuredClasses = Object.keys(values);
        for (const networkClass of configuredClasses) {
          if (!canonicalNetworkClasses.has(networkClass))
            errors.push(`${location}: noncanonical network class ${networkClass} in Θ.`);
          if (typeof values[networkClass] !== "number" || !Number.isFinite(values[networkClass])) {
            errors.push(`${location}: Θ value for ${networkClass} must be a finite number.`);
          }
        }
        for (const networkClass of CANONICAL_NETWORK_CLASSES) {
          if (!Object.hasOwn(values, networkClass))
            errors.push(`${location}: Θ is missing required network class ${networkClass}.`);
        }
      }
    }
  }
  return Object.freeze(errors);
}

/** Enforces Θ integrity at the evaluator boundary as well as draft validation. */
export function assertValidThetaPolicy(policy: unknown): void {
  const errors = thetaPolicyErrors(policy);
  if (errors.length > 0) throw new Error(`Invalid Θ policy configuration: ${errors.join(" ")}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
