import { randomUUID } from "node:crypto";
import { canonicalJson } from "./trace";
import type { GammaDecisionTrace } from "./gamma-effects";
import type { McacDecision, McacTrace, PolicyVersion } from "./types";

const MAX_RESEARCH_RUNS = 128;
const RESEARCH_RUN_TTL_MS = 30 * 60 * 1000;

export type ResearchRunRecord = Readonly<{
  runId: string;
  scenarioId: string;
  policyVersion: string;
  traceHash: string;
  decision: McacDecision;
  mEnv: McacTrace["mEnv"];
  mBeh: McacTrace["mBeh"];
  severity: McacTrace["m"];
  gammaTrace: GammaDecisionTrace | null;
  gammaTraceCanonical: string;
  createdAt: number;
}>;

export type ResearchReplayAssessment = Readonly<{
  verified: boolean;
  reasons: readonly string[];
  gammaTraceMatches: boolean;
}>;

const runs = new Map<string, ResearchRunRecord>();
const originalTraces = new WeakMap<ResearchRunRecord, McacTrace>();

/** Keeps only a bounded, short-lived verification anchor; no context or full trace is retained. */
export function rememberResearchRun(scenarioId: string, trace: McacTrace): ResearchRunRecord {
  pruneExpiredRuns();
  const record: ResearchRunRecord = Object.freeze({
    runId: randomUUID(),
    scenarioId,
    policyVersion: trace.policyVersion,
    traceHash: trace.hash,
    decision: trace.decision,
    mEnv: trace.mEnv,
    mBeh: trace.mBeh,
    severity: trace.m,
    gammaTrace: trace.gamma,
    gammaTraceCanonical: canonicalJson(trace.gamma),
    createdAt: Date.now(),
  });
  runs.set(record.runId, record);
  originalTraces.set(record, trace);
  while (runs.size > MAX_RESEARCH_RUNS) {
    const oldest = runs.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    runs.delete(oldest);
  }
  return record;
}

export function findResearchRun(runId: string): ResearchRunRecord | undefined {
  pruneExpiredRuns();
  return runs.get(runId);
}

/** Replays only the original server-generated trace using the matching fixed fixture policy. */
export function replayResearchRun(
  original: ResearchRunRecord,
  policy: PolicyVersion,
  replay: (trace: McacTrace, policy: PolicyVersion) => McacTrace,
): ResearchReplayAssessment {
  try {
    const trace = originalTraces.get(original);
    if (!trace) throw new Error("Original research trace is unavailable");
    const replayed = replay(trace, policy);
    return assessResearchReplay(original, replayed);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Replay verification failed.";
    return Object.freeze({
      verified: false,
      reasons: Object.freeze([`REPLAY_VERIFICATION_FAILED: ${reason}`]),
      gammaTraceMatches: false,
    });
  }
}

/** Compares a replay candidate to the original run anchor, separately from replayTrace's checks. */
export function assessResearchReplay(
  original: ResearchRunRecord,
  replayed: McacTrace,
): ResearchReplayAssessment {
  const reasons: string[] = [];
  if (replayed.decision !== original.decision) reasons.push("ORIGINAL_DECISION_MISMATCH");
  if (
    replayed.mEnv !== original.mEnv ||
    replayed.mBeh !== original.mBeh ||
    replayed.m !== original.severity
  )
    reasons.push("ORIGINAL_SEVERITY_MISMATCH");
  const gammaTraceMatches = canonicalJson(replayed.gamma) === original.gammaTraceCanonical;
  if (!gammaTraceMatches) reasons.push("GAMMA_TRACE_MISMATCH");
  if (replayed.hash !== original.traceHash) reasons.push("ORIGINAL_TRACE_HASH_MISMATCH");
  return Object.freeze({
    verified: reasons.length === 0,
    reasons: Object.freeze(reasons),
    gammaTraceMatches,
  });
}

function pruneExpiredRuns(): void {
  const cutoff = Date.now() - RESEARCH_RUN_TTL_MS;
  for (const [runId, record] of runs)
    if (record.createdAt < cutoff) runs.delete(runId);
}
