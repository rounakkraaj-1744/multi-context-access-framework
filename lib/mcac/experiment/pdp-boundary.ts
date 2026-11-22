import type { AuthorizationInput, ContextEvidence, McacDecision, McacTrace } from "../types";
import { measurePdpBoundary, type MonotonicClock, type PdpBoundaryMeasurement } from "./latency";

export type PdpEvaluation = Readonly<{ decision: McacDecision; trace: McacTrace | null }>;
export type PdpCallResult<T extends PdpEvaluation> = Readonly<{
  measurement: PdpBoundaryMeasurement<McacDecision>;
  evaluation: T;
}>;


export function callLocalPdp<T extends PdpEvaluation>(args: {
  request: AuthorizationInput;
  prepareRequest?: (request: AuthorizationInput) => AuthorizationInput;
  shouldCollectContext?: boolean;
  collectContext: (request: AuthorizationInput) => Readonly<{
    context: ContextEvidence;
    consistencyEvidence: AuthorizationInput["consistencyEvidence"];
  }>;
  evaluate: (request: AuthorizationInput) => T;
  appendTrace: (trace: McacTrace) => void;
  clock?: MonotonicClock;
}): PdpCallResult<T> {
  let evaluation: T | undefined;
  const measurement = measurePdpBoundary(() => {
    let request = args.prepareRequest ? args.prepareRequest(args.request) : args.request;
    if (request.baselinePermission && args.shouldCollectContext !== false)
      request = { ...request, ...args.collectContext(request) };
    evaluation = args.evaluate(request);
    if (evaluation.trace) 
      args.appendTrace(evaluation.trace);
    return evaluation.decision;
  }, args.clock);
  return { measurement, evaluation: evaluation! };
}