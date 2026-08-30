/**
 * CORRECTION06 §26: extracted from lifecycle-runner. Holds the
 * SinkLike helper, buildNormalOutcome, and classifyCleanupFailure.
 */
import type { Clock, ProcessFailure, ProcessResult } from "./process-types.js";
import type { ProcessId, ProcessSpec, EscalationEvidence } from "./process-types.js";

export type SinkLike = { readonly captured: () => ProcessResult["stdout"]; readonly stdioFailure: () => ProcessFailure | null };

export function buildNormalOutcome(p: {
  id: ProcessId; spec: ProcessSpec; stdoutSink: SinkLike; stderrSink: SinkLike; startedAtMs: number; clock: Clock;
  close: { kind: "close"; code: number | null; signal: NodeJS.Signals | null };
}): ProcessResult {
  const soF = p.stdoutSink.stdioFailure();
  const seF = p.stderrSink.stdioFailure();
  let outcome: ProcessResult["outcome"];
  if (p.close.signal !== null) {
    outcome = { kind: "signaled", signal: p.close.signal, exitCode: p.close.code, stdoutFailure: soF, stderrFailure: seF };
  } else if (p.close.code !== null) {
    outcome = { kind: "exited", exitCode: p.close.code, stdoutFailure: soF, stderrFailure: seF };
  } else {
    outcome = { kind: "signaled", signal: null, exitCode: null, stdoutFailure: soF, stderrFailure: seF };
  }
  return {
    processId: p.id, spec: p.spec, outcome,
    stdout: p.stdoutSink.captured(),
    stderr: p.stderrSink.captured(),
    startedAtMs: p.startedAtMs, finishedAtMs: p.clock.nowMs(),
    escalation: freshEscalation(),
  };
}

export function freshEscalation(): EscalationEvidence {
  return {
    termRequested: false, termSent: false, termResult: null,
    killRequested: false, killSent: false, killResult: null,
    finalGroupProbe: { kind: "absent" },
  };
}
