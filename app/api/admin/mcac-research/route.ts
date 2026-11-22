import { actorOrError, isAdmin, json } from "@/lib/api";
import { evaluateMcac } from "@/lib/mcac/decision";
import { replayTrace } from "@/lib/mcac/replay";
import { compareResearchScenario, summarizeResearchComparisons } from "@/lib/mcac/research-comparison";
import type { AuthorizationResult } from "@/lib/mcac/types";
import {
  getResearchScenario,
  listResearchScenarios,
  RESEARCH_POLICY_ID,
} from "@/lib/mcac/research-fixtures";
import {
  findResearchRun,
  listRecentResearchRuns,
  replayResearchRun,
  rememberResearchRun,
} from "@/lib/mcac/research-run-store";
import { z } from "zod";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("compare"), scenarioIds: z.array(z.string().min(1)).min(1).max(11) }).strict(),
  z.object({ action: z.literal("run"), scenarioId: z.string().min(1) }).strict(),
  z
    .object({
      action: z.literal("replay"),
      scenarioId: z.string().min(1),
      runId: z.string().uuid(),
      policyVersion: z.string().min(1),
    })
    .strict(),
]);

export async function GET() {
  const auth = await actorOrError();
  if ("response" in auth) return auth.response;
  if (!isAdmin(auth.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access required for the research lab." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  const policy = getResearchScenario("normal-access")!.input.policy;
  return json({
    mode: "SYNTHETIC_FORMAL_RESEARCH_ONLY",
    policyId: RESEARCH_POLICY_ID,
    policyStatus: "FIXED_DEMONSTRATION_POLICY_NOT_PUBLISHED_OR_ACTIVE",
    comparison: "POST action compare accepts server-defined scenarioIds; metrics describe executed synthetic fixtures only",
    scenarios: listResearchScenarios().map((entry) => {
      const fixture = getResearchScenario(entry.id)!;
      return {
        ...entry,
        baselinePermission: fixture.input.baselinePermission,
        request: fixture.input.request,
        context: fixture.input.context,
      };
    }),
    policy,
    evaluator: "lib/mcac/decision.ts:evaluateMcac",
    gammaEvaluatorVersion: policy.gammaMetadata?.evaluatorSemanticsVersion ?? null,
    gammaCanonicalizationVersion: policy.gammaMetadata?.constraintsDigest.canonicalizationVersion ?? null,
    recentRuns: listRecentResearchRuns().map((run) => ({
      runId: run.runId,
      scenarioId: run.scenarioId,
      policyVersion: run.policyVersion,
      decision: run.decision,
      severity: run.severity,
      createdAt: run.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await actorOrError();
  if ("response" in auth) return auth.response;
  if (!isAdmin(auth.actor))
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access required for the research lab." } },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Provide a known research scenarioId." } },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  if (parsed.data.action === "compare") {
    const scenarios = parsed.data.scenarioIds.map((scenarioId) => getResearchScenario(scenarioId));
    if (scenarios.some((entry) => !entry))
      return Response.json(
        { error: { code: "UNKNOWN_RESEARCH_SCENARIO", message: "Research scenario was not found." } },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    try {
      const results = scenarios.map((entry) => compareResearchScenario(entry!));
      return json({
        mode: "SYNTHETIC_FORMAL_RESEARCH_ONLY",
        policyVersion: RESEARCH_POLICY_ID,
        results,
        metrics: summarizeResearchComparisons(results),
      });
    } catch {
      return Response.json(
        { error: { code: "RESEARCH_COMPARISON_FAILED", message: "Synthetic comparison failed." } },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const scenario = getResearchScenario(parsed.data.scenarioId);
  if (!scenario)
    return Response.json(
      { error: { code: "UNKNOWN_RESEARCH_SCENARIO", message: "Research scenario was not found." } },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );

  if (parsed.data.action === "replay") {
    if (parsed.data.policyVersion !== RESEARCH_POLICY_ID)
      return Response.json(
        { error: { code: "UNSUPPORTED_RESEARCH_POLICY_VERSION", message: "Research policy version is not supported." } },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    const original = findResearchRun(parsed.data.runId);
    if (!original)
      return Response.json(
        { error: { code: "RESEARCH_RUN_NOT_FOUND", message: "Research run is unknown or expired." } },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    if (original.scenarioId !== scenario.id)
      return Response.json(
        { error: { code: "RESEARCH_RUN_SCENARIO_MISMATCH", message: "Run does not belong to this scenario." } },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    if (original.policyVersion !== RESEARCH_POLICY_ID)
      return Response.json(
        { error: { code: "UNSUPPORTED_RESEARCH_POLICY_VERSION", message: "Original run uses an unsupported research policy version." } },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );

    const replayedResults: AuthorizationResult[] = [];
    const assessment = replayResearchRun(original, scenario.input.policy, (trace, policy) => {
      const replayed = replayTrace(trace, policy);
      replayedResults.push(replayed);
      return replayed.trace;
    });
    const replayed = replayedResults[0] ?? null;
    const reasons = [...assessment.reasons];
    return json({
      mode: "SYNTHETIC_FORMAL_RESEARCH_ONLY",
      replay: {
        verified: assessment.verified && replayed !== null,
        originalDecision: original.decision,
        replayedDecision: replayed?.decision ?? null,
        originalSeverity: original.severity,
        replayedSeverity: replayed?.severity ?? null,
        policyVersion: RESEARCH_POLICY_ID,
        reasons,
        gammaTraceComparison: {
          matches: assessment.gammaTraceMatches,
          original: original.gammaTrace,
          replayed: replayed?.trace.gamma ?? null,
        },
      },
    });
  }

  try {
    const result = evaluateMcac(scenario.input);
    const run = rememberResearchRun(scenario.id, result.trace);
    return json({
      mode: "SYNTHETIC_FORMAL_RESEARCH_ONLY",
      synthetic: true,
      policy: scenario.input.policy,
      scenario: {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        baselinePermission: scenario.input.baselinePermission,
        request: scenario.input.request,
      },
      context: scenario.input.context,
      evaluator: "lib/mcac/decision.ts:evaluateMcac",
      runId: run.runId,
      result,
    });
  } catch {
    return Response.json(
      { error: { code: "RESEARCH_EVALUATION_FAILED", message: "Synthetic evaluation failed." } },
      { status: 422, headers: { "Cache-Control": "no-store" } },
    );
  }
}
