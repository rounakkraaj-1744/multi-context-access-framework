import { describe, expect, it } from "vitest";
import { evaluateRbac } from "../authorization";
import { evaluateMcac } from "./decision";
import { getResearchScenario, listResearchScenarios } from "./research-fixtures";
import { compareResearchScenario, summarizeResearchComparisons } from "./research-comparison";

describe("formal research RBAC versus MCAC comparison", () => {
  it("uses identical fixture permission, resource, action, and baseline assumptions", () => {
    for (const listed of listResearchScenarios()) {
      const scenario = getResearchScenario(listed.id)!;
      const comparison = compareResearchScenario(scenario);
      const permission = `resources:${scenario.input.request.resourceClass}:${scenario.input.request.action}`;
      expect(comparison.baseline).toMatchObject({
        permission,
        granted: scenario.input.baselinePermission,
        resourceClass: scenario.input.request.resourceClass,
        action: scenario.input.request.action,
      });
      expect(comparison.rbac.decision).toBe(
        evaluateRbac(scenario.input.baselinePermission ? [permission] : [], permission),
      );
      expect(comparison.mcac.trace.baseline).toBe(scenario.input.baselinePermission);
      expect(comparison.mcac.trace.resourceClass).toBe(scenario.input.request.resourceClass);
      expect(comparison.mcac.trace.action).toBe(scenario.input.request.action);
    }
  });

  it("returns decisions from direct execution of both evaluators on the same fixture", () => {
    const scenario = getResearchScenario("gamma-violated")!;
    const comparison = compareResearchScenario(scenario);
    const permission = `resources:${scenario.input.request.resourceClass}:${scenario.input.request.action}`;
    expect(comparison.rbac.decision).toBe(
      evaluateRbac(scenario.input.baselinePermission ? [permission] : [], permission),
    );
    expect(comparison.mcac.trace).toEqual(evaluateMcac(scenario.input).trace);
  });

  it("explains restrictions with actual condition, Γ, and Θ outputs", () => {
    const networkScenario = getResearchScenario("gamma-violated")!;
    const networkComparison = compareResearchScenario(networkScenario);
    expect(networkComparison.restricted).toBe(true);
    expect(networkComparison.mcac.conditions.length).toBeGreaterThan(0);
    expect(networkComparison.mcac.gamma?.constraints[0]?.outcome).toBe("VIOLATED");
    expect(networkComparison.mcac.gamma?.items.some((item) => item.effect === "VIOLATED")).toBe(true);
    expect(networkComparison.explanation).toContain("evaluated synthetic context conditions");

    const theta = compareResearchScenario(getResearchScenario("theta-network-threshold")!);
    expect(theta.mcac.theta).toHaveLength(1);
    expect(theta.mcac.theta[0]?.result).toBe("APPLIED");
  });

  it("rejects invalid fixtures through the formal evaluator", () => {
    const scenario = getResearchScenario("normal-access")!;
    const invalid = {
      ...scenario,
      input: { ...scenario.input, request: { ...scenario.input.request, time: Number.NaN } },
    };
    expect(() => compareResearchScenario(invalid)).toThrow(/Request time/);
  });

  it("derives synthetic-only metrics from the executed result rows", () => {
    const results = [
      compareResearchScenario(getResearchScenario("normal-access")!),
      compareResearchScenario(getResearchScenario("baseline-denial")!),
      compareResearchScenario(getResearchScenario("gamma-violated")!),
    ];
    expect(summarizeResearchComparisons(results)).toEqual({
      synthetic: true,
      totalScenarios: 3,
      rbac: { allow: 2, deny: 1 },
      mcac: { allow: 1, verify: 1, deny: 1 },
      decisionDifferenceCount: 1,
      mcacRestrictionCount: 1,
    });
  });
});
