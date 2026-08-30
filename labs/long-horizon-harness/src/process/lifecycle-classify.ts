/**
 * CORRECTION06 §26: extracted from lifecycle-runner.
 * classifyCleanupFailure: maps escalation evidence + phase to a typed
 * ProcessFailure cause.
 */
import type { EscalationEvidence, ProcessFailure } from "./process-types.js";

export function classifyCleanupFailure(evidence: EscalationEvidence, phase: "term" | "kill"): ProcessFailure {
  if (evidence.finalGroupProbe.kind === "permission_denied") {
    const signalOpDenied =
      (evidence.termResult !== null && evidence.termResult.kind === "permission_denied") ||
      (evidence.killResult !== null && evidence.killResult.kind === "permission_denied");
    if (signalOpDenied) {
      return { kind: "capability_unavailable", message: "process-group signalling permission denied" };
    }
    return {
      kind: "cleanup_timeout",
      phase,
      message: "group probe returned EPERM after successful signal; ESRCH never observed within bounded grace",
    };
  }
  if (evidence.finalGroupProbe.kind === "probe_error") {
    return { kind: "cleanup_timeout", phase: "kill", message: `group probe error: ${evidence.finalGroupProbe.kind}` };
  }
  if (evidence.finalGroupProbe.kind === "alive") {
    return { kind: "cleanup_timeout", phase: "kill", message: "group still alive after escalation" };
  }
  return { kind: "internal_process_failure", message: `unknown probe result: ${evidence.finalGroupProbe.kind}` };
}
