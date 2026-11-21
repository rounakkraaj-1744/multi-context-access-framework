import { describe, expect, it } from "vitest";
import { measureClockReadOverhead, measurePdpBoundary } from "./latency";
import { callLocalPdp } from "./pdp-boundary";
import { generateScenarioStream } from "./harness";
import type { McacTrace } from "../types";

describe("manuscript PDP latency instrumentation", () => {
  it("includes PDP evaluation and trace append through returned decision", () => {
    let monotonicMs = 0;
    const setupOutsideBoundaryMs = 40;
    monotonicMs += setupOutsideBoundaryMs;
    const measured = measurePdpBoundary(() => {
      monotonicMs += 5; // PDP validation/evaluation
      monotonicMs += 2; // trace creation
      monotonicMs += 3; // trace append before return
      return "ALLOW" as const;
    }, () => monotonicMs);
    expect(measured.startMonotonicMs).toBe(40);
    expect(measured.endMonotonicMs).toBe(50);
    expect(measured.durationMs).toBe(10);
    expect(measured.response).toBe("ALLOW");
    monotonicMs += 100; // post-return reporting is outside the interval
    expect(measured.durationMs).toBe(10);
  });

  it("excludes request construction and reporting and rejects a nonmonotonic clock", () => {
    let now = 100;
    now += 20; // PEP setup before invoking PDP
    const measured = measurePdpBoundary(() => { now += 4; return { decision: "DENY" }; }, () => now);
    now += 50; // serialization/reporting after return
    expect(measured.durationMs).toBe(4);
    expect(() => measurePdpBoundary(() => 1, (() => { let i = 0; return () => [2, 1][i++]!; })())).toThrow(/monotonic/);
  });

  it("reports clock-read overhead without subtracting it from timings", () => {
    let value = 0;
    const overhead = measureClockReadOverhead(3, () => value++);
    expect(overhead).toEqual({ samples: 3, p50Ms: 1, p95Ms: 1, p99Ms: 1 });
  });

  it("measures request preparation, PIP lookup, PDP evaluation, trace append and return", () => {
    let now = 100;
    const request = generateScenarioStream(19, 1).find((scenario) => scenario.family === "S1")!.input;
    const fakeTrace = { hash: "trace-hash" } as McacTrace;
    const call = callLocalPdp({
      request,
      prepareRequest: (value) => { now += 1; return value; },
      collectContext: (value) => { now += 2; return { context: value.context, consistencyEvidence: value.consistencyEvidence }; },
      evaluate: () => { now += 4; return { decision: "VERIFY" as const, trace: fakeTrace }; },
      appendTrace: () => { now += 3; },
      clock: () => now,
    });
    expect(call.measurement.startMonotonicMs).toBe(100);
    expect(call.measurement.endMonotonicMs).toBe(110);
    expect(call.measurement.durationMs).toBe(10);
    expect(call.measurement.response).toBe("VERIFY");
    expect(call.evaluation.trace).toBe(fakeTrace);
    now += 50; // metric reporting and persistence after return are outside
    expect(call.measurement.durationMs).toBe(10);
  });

  it("skips context collection after a failed baseline gate", () => {
    let now = 0;
    const allowed = generateScenarioStream(19, 1).find((scenario) => scenario.family === "S1")!.input;
    const call = callLocalPdp({
      request: { ...allowed, baselinePermission: false },
      collectContext: () => { throw new Error("must not collect after baseline denial"); },
      evaluate: () => { now += 1; return { decision: "DENY" as const, trace: null }; },
      appendTrace: () => { throw new Error("no MCAC trace in this fixture"); },
      clock: () => now,
    });
    expect(call.measurement.response).toBe("DENY");
    expect(call.measurement.durationMs).toBe(1);
  });
});
