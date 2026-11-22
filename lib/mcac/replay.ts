import { evaluateMcac } from "./decision";
import { verifyTraceHash } from "./trace";
import type { AuthorizationInput, McacTrace, PolicyVersion } from "./types";

export function replayTrace(
  trace: McacTrace,
  policy: PolicyVersion,
): ReturnType<typeof evaluateMcac> {
  if (trace.policyVersion !== policy.version)
    throw new Error(
      `Trace requires policy version ${trace.policyVersion}, received ${policy.version}`,
    );
  if (!verifyTraceHash(trace)) throw new Error("Trace hash verification failed");
  if (
    trace.baseline &&
    (policy.resourceProfiles[trace.resourceClass]?.sensitivity !== trace.sensitivity ||
      policy.resourceProfiles[trace.resourceClass]?.stepUpAvailable !== trace.stepUpAvailable)
  )
    throw new Error("Trace resource profile does not match its immutable policy version");
  const { previousHash, items, consistencyEvidence } = trace;
  const context: AuthorizationInput["context"] = {
    environmental: Object.fromEntries(
      items
        .filter(
          (item) =>
            item.kind === "time" ||
            item.kind === "location" ||
            item.kind === "network" ||
            item.kind === "device",
        )
        .map((item) => [
          item.kind,
          {
            kind: item.kind,
            value: item.value,
            observedAt: item.observedAt,
            sourceClass: item.sourceClass,
            integrityFlag: item.integrityFlag,
          },
        ]),
    ) as AuthorizationInput["context"]["environmental"],
    behavioral: Object.fromEntries(
      items
        .filter(
          (item) =>
            item.kind === "session" ||
            item.kind === "frequency" ||
            item.kind === "history" ||
            item.kind === "navigation" ||
            item.kind === "request",
        )
        .map((item) => [
          item.kind,
          {
            kind: item.kind,
            value: item.value,
            observedAt: item.observedAt,
            sourceClass: item.sourceClass,
            integrityFlag: item.integrityFlag,
          },
        ]),
    ) as AuthorizationInput["context"]["behavioral"],
  };
  const input: AuthorizationInput = {
    request: {
      requestId: trace.requestId,
      time: Date.parse(trace.time),
      userId: trace.user,
      sessionId: trace.sessionId,
      resourceId: trace.resource,
      resourceClass: trace.resourceClass,
      action: trace.action,
    },
    baselinePermission: trace.baseline,
    policy,
    context,
    consistencyEvidence,
    waiver: trace.waiver,
    previousHash,
  };
  const replayed = evaluateMcac(input);
  if (
    replayed.decision !== trace.decision ||
    replayed.trace.mEnv !== trace.mEnv ||
    replayed.trace.mBeh !== trace.mBeh ||
    replayed.trace.m !== trace.m
  )
    throw new Error("Replay did not reproduce the recorded authorization result");
  return replayed;
}
