/**
 * Lifecycle helpers used by the supervisor.
 * Extracted from supervised-process.ts to keep that file under
 * the 400 LOC discipline.
 */
import { attachBoundedSink } from "./output-capture.js";
import type { EscalationEvidence, ProcessFailure, ProcessOutcome, ProcessResult, ProcessSpec } from "./process-types.js";
import type { Clock } from "./process-ports.js";

export async function drainStdIO(stdoutSink: ReturnType<typeof attachBoundedSink>, stderrSink: ReturnType<typeof attachBoundedSink>, clock: Clock): Promise<void> {
  const deadline = clock.nowMonotonicMs() + 1000;
  while (!(stdoutSink.closed() && stderrSink.closed()) && clock.nowMonotonicMs() < deadline) {
    await clock.sleep(20);
  }
}

export async function waitForChildClose(child: { once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown }, clock: Clock, budgetMs: number): Promise<void> {
  const deadline = clock.nowMonotonicMs() + budgetMs;
  let closed = false;
  child.once("close", () => { closed = true; });
  while (!closed && clock.nowMonotonicMs() < deadline) {
    await clock.sleep(10);
  }
}

function emptyEscalation(): EscalationEvidence {
  return { termRequested: false, termSent: false, termResult: null, killRequested: false, killSent: false, killResult: null, finalGroupProbe: { kind: "absent" } };
}

export function buildOutOutcomeResult(args: {
  spec: ProcessSpec;
  processId: string;
  stdoutSink: ReturnType<typeof attachBoundedSink>;
  stderrSink: ReturnType<typeof attachBoundedSink>;
  closeObserved: { kind: "close"; code: number | null; signal: NodeJS.Signals | null };
  startedAtMs: number;
}): ProcessResult {
  const { spec, processId, stdoutSink, stderrSink, closeObserved, startedAtMs } = args;
  let outcome: ProcessOutcome;
  if (closeObserved.signal !== null) {
    outcome = { kind: "signaled", signal: closeObserved.signal, exitCode: closeObserved.code };
  } else if (closeObserved.code !== null) {
    outcome = { kind: "exited", exitCode: closeObserved.code };
  } else {
    outcome = { kind: "signaled", signal: null, exitCode: null };
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

export function buildOutCleanupFailure(args: {
  spec: ProcessSpec;
  processId: string;
  stdoutSink: ReturnType<typeof attachBoundedSink>;
  stderrSink: ReturnType<typeof attachBoundedSink>;
  failure: ProcessFailure;
  escalation: EscalationEvidence;
  startedAtMs: number;
  finishedAtMs: number;
}): ProcessResult {
  return {
    processId: args.processId as ProcessResult["processId"],
    spec: args.spec,
    outcome: { kind: "cleanup_failed", failure: args.failure, escalation: args.escalation },
    stdout: args.stdoutSink.captured(),
    stderr: args.stderrSink.captured(),
    startedAtMs: args.startedAtMs,
    finishedAtMs: args.finishedAtMs,
    escalation: args.escalation,
  };
}
