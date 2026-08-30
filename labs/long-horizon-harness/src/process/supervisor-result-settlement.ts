/** * CORRECTION05 §18/§19, CORRECTION06: extracted helper for the * supervisor result settlement (awaitOuter). Keeps supervisor-builder.ts * thin. */
import type { ProcessResult } from "./process-types.js";
import type { OuterSupervisorResult } from "./outer-supervisor-result.js";

export async function settleOuterResult(args: {
  readonly verdict: ProcessResult;
  readonly execution: ProcessResult;
  readonly cachedPgid: number | null;
  readonly cachedPid: number | null;
}): Promise<OuterSupervisorResult> {
  if (args.verdict.outcome.kind === "cleanup_failed" && args.verdict.outcome.failure.kind === "evidence_persistence_failure") {
    if (args.verdict.outcome.failure.stage === "ownership") {
      return { kind: "ownership_not_durable", process: args.execution, failure: { kind: "evidence_persistence_failure" as const, stage: "ownership" as const, message: args.verdict.outcome.failure.message }, observedPgid: args.cachedPgid, observedPid: args.cachedPid };
    }
    return { kind: "settlement_not_durable", process: args.execution, failure: { kind: "evidence_persistence_failure" as const, stage: "settlement" as const, message: args.verdict.outcome.failure.message }, observedPgid: args.cachedPgid, observedPid: args.cachedPid };
  }
  return { kind: "durably_settled", process: args.execution, observedPgid: args.cachedPgid, observedPid: args.cachedPid };
}
