import { describe, expect, it } from "vitest";
import { evaluateMcac } from "./decision";
import { replayTrace } from "./replay";
import { getResearchScenario } from "./research-fixtures";
import {
  assessResearchReplay,
  rememberResearchRun,
  replayResearchRun,
} from "./research-run-store";
import { hashTrace } from "./trace";
import type { McacTrace } from "./types";

describe("formal research replay verification", () => {
  const scenario = getResearchScenario("gamma-satisfied")!;
  const original = evaluateMcac(scenario.input);

  it("replays a deterministic synthetic run with the existing replay engine", () => {
    const run = rememberResearchRun(scenario.id, original.trace);
    const replayed = replayTrace(original.trace, scenario.input.policy);
    const assessment = assessResearchReplay(run, replayed.trace);
    expect(replayed).toEqual(original);
    expect(assessment).toEqual({ verified: true, reasons: [], gammaTraceMatches: true });
  });

  it("replays the retained original trace and reports successful verification", () => {
    const run = rememberResearchRun(scenario.id, original.trace);
    const assessment = replayResearchRun(run, scenario.input.policy, (trace, policy) =>
      replayTrace(trace, policy).trace,
    );
    expect(assessment).toEqual({ verified: true, reasons: [], gammaTraceMatches: true });
  });

  it("retains only an ephemeral verification anchor, without replay context or a full trace", () => {
    const run = rememberResearchRun(scenario.id, original.trace);
    expect(Object.keys(run).sort()).toEqual(
      [
        "createdAt",
        "decision",
        "gammaTrace",
        "gammaTraceCanonical",
        "mBeh",
        "mEnv",
        "policyVersion",
        "runId",
        "scenarioId",
        "severity",
        "traceHash",
      ].sort(),
    );
    expect(JSON.stringify(run)).not.toContain("synthetic-device-001");
    expect(Object.hasOwn(run, "trace")).toBe(false);
    expect(Object.hasOwn(run, "context")).toBe(false);
  });

  it("detects an evaluator decision change against the original run anchor", () => {
    const run = rememberResearchRun(scenario.id, original.trace);
    const changedTrace = resignTrace(original.trace, { decision: "DENY" });
    const assessment = assessResearchReplay(run, changedTrace);
    expect(assessment.verified).toBe(false);
    expect(assessment.reasons).toContain("ORIGINAL_DECISION_MISMATCH");
    expect(() => replayTrace(changedTrace, scenario.input.policy)).toThrow(
      /Replay did not reproduce the recorded authorization result/,
    );
  });

  it("detects a changed Γ trace and exposes the verifier error", () => {
    const run = rememberResearchRun(scenario.id, original.trace);
    const gamma = original.trace.gamma!;
    const changedGamma = {
      ...gamma,
      constraints: gamma.constraints.map((constraint, index) =>
        index === 0 ? { ...constraint, outcome: "VIOLATED" as const } : constraint,
      ),
    };
    const changedTrace = resignTrace(original.trace, { gamma: changedGamma });
    const assessment = assessResearchReplay(run, changedTrace);
    expect(assessment.verified).toBe(false);
    expect(assessment.gammaTraceMatches).toBe(false);
    expect(assessment.reasons).toContain("GAMMA_TRACE_MISMATCH");
    expect(() => replayTrace(changedTrace, scenario.input.policy)).toThrow(
      /Replay did not reproduce the recorded Γ evaluation trace/,
    );
  });

  it("rejects unsupported policy versions in the existing replay implementation", () => {
    expect(() => replayTrace(original.trace, { ...scenario.input.policy, version: "other-version" })).toThrow(
      /requires policy version/,
    );
  });

  it("surfaces replay verification errors without retrying or restoring a recorded result", () => {
    const run = rememberResearchRun(scenario.id, original.trace);
    const assessment = replayResearchRun(run, scenario.input.policy, (trace, policy) =>
      replayTrace(resignTrace(trace, { decision: "DENY" }), policy).trace,
    );
    expect(assessment).toEqual({
      verified: false,
      reasons: ["REPLAY_VERIFICATION_FAILED: Replay did not reproduce the recorded authorization result"],
      gammaTraceMatches: false,
    });
  });
});

function resignTrace(trace: McacTrace, changes: Partial<Omit<McacTrace, "hash">>): McacTrace {
  const record = Object.fromEntries(
    Object.entries(trace).filter(([key]) => key !== "hash"),
  ) as Omit<McacTrace, "hash">;
  const changed = { ...record, ...changes };
  return { ...changed, hash: hashTrace(changed) };
}
