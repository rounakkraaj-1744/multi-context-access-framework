import { describe, expect, it } from "vitest";
import { evaluateMcac } from "./decision";
import { getResearchScenario, listResearchScenarios, RESEARCH_POLICY_ID } from "./research-fixtures";

describe("formal MCAC synthetic research fixtures", () => {
  it("executes every registered scenario through evaluateMcac", () => {
    const scenarios = listResearchScenarios();
    expect(scenarios).toHaveLength(11);
    for (const listed of scenarios) {
      const scenario = getResearchScenario(listed.id)!;
      expect(scenario.input.policy.version).toBe(RESEARCH_POLICY_ID);
      expect(() => evaluateMcac(scenario.input), listed.id).not.toThrow();
      const result = evaluateMcac(scenario.input);
      expect(result.trace.requestId).toBe(scenario.input.request.requestId);
      expect(result.trace.policyVersion).toBe(RESEARCH_POLICY_ID);
    }
  });

  it("demonstrates the expected baseline, validity, Θ, and Γ paths", () => {
    const evaluate = (id: string) => evaluateMcac(getResearchScenario(id)!.input);
    expect(evaluate("normal-access").decision).toBe("ALLOW");
    expect(evaluate("baseline-denial").decision).toBe("DENY");
    expect(evaluate("high-risk-action").trace.sensitivity).toBe("H");
    expect(evaluate("high-risk-action").decision).toBe("ALLOW");
    expect(evaluate("missing-context").trace.items.find((item) => item.kind === "frequency")?.validityStatus).toBe("M");
    expect(evaluate("stale-context").trace.items.find((item) => item.kind === "network")?.validityStatus).toBe("S");
    expect(evaluate("unverifiable-context").trace.items.find((item) => item.kind === "device")?.validityStatus).toBe("U");
    const theta = evaluate("theta-network-threshold");
    expect(theta.trace.interactions.find((entry) => entry.kind === "environment_conditioned_threshold")?.result).toBe("APPLIED");
    expect(theta.decision).toBe("VERIFY");
    expect(evaluate("gamma-satisfied").trace.gamma?.constraints[0]?.outcome).toBe("SATISFIED");
    expect(evaluate("gamma-violated").trace.gamma?.constraints[0]?.outcome).toBe("VIOLATED");
    expect(evaluate("gamma-violated").decision).toBe("VERIFY");
    expect(evaluate("gamma-indeterminate").trace.gamma?.constraints[0]?.outcome).toBe("INDETERMINATE");
    expect(evaluate("gamma-indeterminate").decision).toBe("VERIFY");
    expect(evaluate("gamma-contradiction").trace.items.find((item) => item.kind === "network")?.validityStatus).toBe("X");
  });

  it("returns detached immutable fixtures without mutating shared definitions", () => {
    const first = getResearchScenario("normal-access")!;
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.input.context.environmental.network)).toBe(true);
    expect(() => {
      (first.input.context.environmental.network as unknown as { value: string }).value = "unknown";
    }).toThrow();
    const second = getResearchScenario("normal-access")!;
    expect(second.input.context.environmental.network.value).toBe("corporate");
  });
});
