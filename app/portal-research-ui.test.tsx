// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Portal, {
  GammaInspector,
  ResearchContextPanel,
  ResearchTracePanel,
  ThetaInspector,
} from "./portal";
import { evaluateMcac } from "@/lib/mcac/decision";
import { getResearchScenario } from "@/lib/mcac/research-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const scenario = getResearchScenario("theta-network-threshold")!;
const result = evaluateMcac(scenario.input);
const evaluation = {
  scenario: {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    baselinePermission: scenario.input.baselinePermission,
    request: scenario.input.request,
  },
  context: scenario.input.context,
  policy: scenario.input.policy,
  evaluator: "lib/mcac/decision.ts:evaluateMcac",
  runId: "test-run-id",
  result,
  replay: {
    verified: false,
    originalDecision: result.decision,
    replayedDecision: "DENY",
    reasons: ["ORIGINAL_DECISION_MISMATCH"],
    gammaTraceComparison: { matches: false, original: result.trace.gamma, replayed: null },
  },
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { scenarios: [], policyId: "test-policy", policy: {}, recentRuns: [] } }), { headers: { "Content-Type": "application/json" } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Formal research UI", () => {
  it("renders fixture values with evaluator-classified context validity", () => {
    const validity = new Map(result.trace.items.map((item) => [item.kind, item.validityStatus]));
    render(<ResearchContextPanel evaluation={evaluation} validityByKind={validity} />);
    expect(screen.getByText("Environmental context")).toBeTruthy();
    expect(screen.getByText("Behavioral context")).toBeTruthy();
    expect(screen.getAllByText("V").length).toBeGreaterThan(0);
    expect(screen.getByText("Fixture inputs, not live context")).toBeTruthy();
  });

  it("renders Γ AST outcomes, evidence references, and item effects from the trace", () => {
    render(<GammaInspector evaluation={evaluation} />);
    expect(screen.getByText("Strong Kleene three-valued logic")).toBeTruthy();
    expect(screen.getAllByText(/demo-network-device-consistency/).length).toBeGreaterThan(0);
    expect(screen.getByText("Policy AST")).toBeTruthy();
    expect(screen.getByText("Combined item effects and condition propagation")).toBeTruthy();
  });

  it("renders Θ threshold configuration and the evaluator interaction", () => {
    render(<ThetaInspector evaluation={evaluation} />);
    expect(screen.getByText("Network evidence and configured thresholds")).toBeTruthy();
    expect(screen.getAllByText(/vpn/).length).toBeGreaterThan(0);
    expect(screen.getByText("Θ evaluator interaction")).toBeTruthy();
  });

  it("keeps a replay failure visibly failed and shows its reasons", () => {
    render(<ResearchTracePanel runs={[]} evaluation={evaluation} busy={false} onReplay={vi.fn()} />);
    expect(screen.getByText(/Replay verification: FAILED/)).toBeTruthy();
    expect(screen.getByText(/ORIGINAL_DECISION_MISMATCH/)).toBeTruthy();
  });

  it("shows research navigation to administrators and hides it from employees", async () => {
    const admin = { id: "admin", name: "Admin User", email: "admin@example.test", status: "ACTIVE", roles: ["Admin"], permissions: [] };
    const employee = { ...admin, id: "employee", roles: ["Employee"] };
    render(<Portal actor={admin} resources={[]} notices={[]} initialSection="Research Overview" />);
    expect(await screen.findByRole("button", { name: /Scenario Explorer/ })).toBeTruthy();
    cleanup();
    render(<Portal actor={employee} resources={[]} notices={[]} initialSection="Overview" />);
    expect(screen.queryByRole("button", { name: /Scenario Explorer/ })).toBeNull();
    expect(await screen.findByRole("button", { name: /Access history/ })).toBeTruthy();
  });
});
