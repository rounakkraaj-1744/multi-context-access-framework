import { describe, expect, it } from "vitest";
import { CANONICAL_NETWORK_CLASSES } from "./types";
import { assertValidThetaPolicy, thetaPolicyErrors } from "./theta-validation";

const completeValues = Object.fromEntries(
  CANONICAL_NETWORK_CLASSES.map((networkClass, index) => [networkClass, index + 1]),
);
const draft = (parameter: unknown, enabled = true): unknown => ({
  interactions: { environmentConditionedThresholds: enabled },
  rules: [
    {
      id: "frequency-rule",
      environmental: [],
      behavioral: [{ id: "frequency", comparator: "lte", parameter }],
    },
  ],
});

describe("Θ policy validation", () => {
  it("accepts explicit finite thresholds for all canonical network classes", () => {
    expect(thetaPolicyErrors(draft({ by: "network", values: completeValues }))).toEqual([]);
    expect(() =>
      assertValidThetaPolicy(draft({ by: "network", values: completeValues })),
    ).not.toThrow();
  });

  it.each(CANONICAL_NETWORK_CLASSES)("rejects a missing %s mapping", (missingClass) => {
    const values = { ...completeValues };
    delete values[missingClass];
    expect(thetaPolicyErrors(draft({ by: "network", values })).join(" ")).toContain(
      `missing required network class ${missingClass}`,
    );
  });

  it("rejects empty mappings, noncanonical aliases, and non-finite/non-numeric values", () => {
    expect(thetaPolicyErrors(draft({ by: "network", values: {} })).length).toBe(4);
    expect(
      thetaPolicyErrors(draft({ by: "network", values: { ...completeValues, corp: 2 } })).join(" "),
    ).toContain("noncanonical network class corp");
    expect(
      thetaPolicyErrors(
        draft({ by: "network", values: { ...completeValues, corporate: Number.NaN } }),
      ).join(" "),
    ).toContain("must be a finite number");
    expect(
      thetaPolicyErrors(
        draft({ by: "network", values: { ...completeValues, corporate: "2" } }),
      ).join(" "),
    ).toContain("must be a finite number");
  });

  it("rejects network-dependent thresholds when Θ is disabled", () => {
    expect(
      thetaPolicyErrors(draft({ by: "network", values: completeValues }, false)).join(" "),
    ).toContain("requires Θ to be enabled");
  });

  it("allows constant thresholds when Θ is enabled or disabled", () => {
    expect(thetaPolicyErrors(draft(10, true))).toEqual([]);
    expect(thetaPolicyErrors(draft(10, false))).toEqual([]);
  });

  it("rejects unsupported dependency, category, and comparator shapes", () => {
    const unsupported = draft({ by: "location", values: {} });
    expect(thetaPolicyErrors(unsupported).join(" ")).toContain("unsupported Θ dependency");
    expect(
      thetaPolicyErrors({
        interactions: { environmentConditionedThresholds: true },
        rules: [
          {
            environmental: [
              { comparator: "lte", parameter: { by: "network", values: completeValues } },
            ],
            behavioral: [],
          },
        ],
      }).join(" "),
    ).toContain("only valid on behavioral conditions");
    expect(
      thetaPolicyErrors({
        interactions: { environmentConditionedThresholds: true },
        rules: [
          {
            environmental: [],
            behavioral: [
              { comparator: "in", parameter: { by: "network", values: completeValues } },
            ],
          },
        ],
      }).join(" "),
    ).toContain("require a numeric comparison");
  });
});
