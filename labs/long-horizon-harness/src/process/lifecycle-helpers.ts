/**
 * Lifecycle helpers used by the supervisor.
 *
 * Extracted from supervised-process.ts to keep that file under
 * the 400 LOC discipline.
 */

import type {
  CapturedOutput,
  EscalationEvidence,
  ProcessFailure,
  ProcessOutcome,
  ProcessResult,
  ProcessSpec,
} from "./process-types.js";
import type { Clock } from "./process-ports.js";

export type SinkLike = {
  readonly captured: () => CapturedOutput;
  readonly closed: () => boolean;
  readonly stdioFailure: () => import("./process-types.js").ProcessFailure | null;
};

/**
 * Wait for both bounded sinks to report closed, with a bounded
 * budget (one second) above Node's natural close boundary. This
 * is a defensive cap in case a stream fails to emit 'end'/'close'
 * for some reason; the supervisor's settle gate still requires
 * Node's actual child 'close' event.
 */
export async function drainStdIO(
  stdoutSink: SinkLike,
  stderrSink: SinkLike,
  clock: Clock,
  signal: AbortSignal,
): Promise<void> {
  if (stdoutSink.closed() && stderrSink.closed()) return;
  const deadline = clock.nowMonotonicMs() + 1000;
  while (
    !(stdoutSink.closed() && stderrSink.closed()) &&
    clock.nowMonotonicMs() < deadline &&
    !signal.aborted
  ) {
    await clock.sleep(20, signal);
  }
}

function emptyEscalation(): EscalationEvidence {
  // CORRECTION12 §1: truthful neutral is `not_observed`.
  return {
    termRequested: false,
    termSent: false,
    termResult: null,
    killRequested: false,
    killSent: false,
    killResult: null,
    finalGroupProbe: { kind: "not_observed" },
  };
}

/**
 * Build a successful or signaled outcome from a close observation.
 */
export function buildOutOutcomeResult(args: {
  spec: ProcessSpec;
  processId: string;
  stdoutSink: SinkLike;
  stderrSink: SinkLike;
  closeObserved: { kind: "close"; code: number | null; signal: NodeJS.Signals | null };
  startedAtMs: number;
}): ProcessResult {
  const { spec, processId, stdoutSink, stderrSink, closeObserved, startedAtMs } = args;
  const soF = stdoutSink.stdioFailure();
  const seF = stderrSink.stdioFailure();
  let outcome: ProcessOutcome;
  if (closeObserved.signal !== null) {
    outcome = {
      kind: "signaled",
      signal: closeObserved.signal,
      exitCode: closeObserved.code,
      stdoutFailure: soF,
      stderrFailure: seF,
    };
  } else if (closeObserved.code !== null) {
    outcome = { kind: "exited", exitCode: closeObserved.code, stdoutFailure: soF, stderrFailure: seF };
  } else {
    outcome = { kind: "signaled", signal: null, exitCode: null, stdoutFailure: soF, stderrFailure: seF };
  }
  return {
    processId: processId as ProcessResult["processId"],
    spec,
    outcome,
    stdout: stdoutSink.captured(),
    stderr: stderrSink.captured(),
    startedAtMs,
    finishedAtMs: Date.now(),
    escalation: emptyEscalation(),
  };
}

/**
 * Build a typed cleanup-failure outcome.
 */
export function buildOutCleanupFailure(args: {
  spec: ProcessSpec;
  processId: string;
  stdoutSink: SinkLike;
  stderrSink: SinkLike;
  failure: ProcessFailure;
  escalation: EscalationEvidence;
  startedAtMs: number;
  finishedAtMs: number;
}): ProcessResult {
  return {
    processId: args.processId as ProcessResult["processId"],
    spec: args.spec,
    outcome: {
      kind: "cleanup_failed",
      failure: args.failure,
      escalation: args.escalation,
      stdoutFailure: args.stdoutSink.stdioFailure(),
      stderrFailure: args.stderrSink.stdioFailure(),
    },
    stdout: args.stdoutSink.captured(),
    stderr: args.stderrSink.captured(),
    startedAtMs: args.startedAtMs,
    finishedAtMs: args.finishedAtMs,
    escalation: args.escalation,
  };
}
