/**
 * FOUNDATION03 — process-evidence bridge: runtime-to-persisted
 * payload encoders. Each encoder takes a runtime-only shape and
 * produces the corresponding bounded persisted form. Used by both
 * the live bridge (emit.ts) and synthetic event handling.
 */

import type {
  PersistedEscalationEvidence,
  PersistedGroupProbe,
  PersistedOutputSummary,
  PersistedProcessFailure,
  PersistedProcessResult,
  PersistedSignalAttemptResult,
} from "../evidence/codec-types.js";
import type {
  CapturedOutput,
  EscalationEvidence as RuntimeEscalationEvidence,
  GroupProbe as RuntimeGroupProbe,
  ProcessFailure as RuntimeProcessFailure,
  ProcessResult,
  SignalAttemptResult,
} from "./process-types.js";

export function encodeFailure(
  f: RuntimeProcessFailure,
): PersistedProcessFailure {
  switch (f.kind) {
    case "invalid_process_spec":
      return { kind: f.kind, message: f.message };
    case "spawn_failure":
      return {
        kind: "spawn_failure",
        message: f.message,
        ...(f.code !== undefined ? { code: f.code } : {}),
        ...(f.syscall !== undefined ? { syscall: f.syscall } : {}),
        ...(f.path !== undefined ? { path: f.path } : {}),
      };
    case "signal_failure":
      return {
        kind: "signal_failure",
        signal: f.signal,
        message: f.message,
        ...(f.code !== undefined ? { code: f.code } : {}),
      };
    case "cleanup_timeout":
      return { kind: "cleanup_timeout", phase: f.phase, message: f.message };
    case "stdio_failure":
      return {
        kind: "stdio_failure",
        stream: f.stream,
        message: f.message,
        ...(f.code !== undefined ? { code: f.code } : {}),
      };
    case "internal_process_failure":
      return { kind: f.kind, message: f.message };
    case "evidence_persistence_failure":
      return { kind: "evidence_persistence_failure", stage: f.stage, message: f.message };
    case "capability_unavailable":
      return { kind: f.kind, message: f.message };
  }
}

export function encodeSignalResult(
  r: SignalAttemptResult,
): PersistedSignalAttemptResult {
  switch (r.kind) {
    case "sent":
      return { result_kind: "sent", signal: r.signal };
    case "group_absent":
      return { result_kind: "group_absent" };
    case "permission_denied":
      return {
        result_kind: "permission_denied",
        ...(r.code !== undefined ? { code: r.code } : {}),
      };
    case "error":
      return {
        result_kind: "error",
        message: r.message,
        ...(r.code !== undefined ? { code: r.code } : {}),
      };
  }
}

export function encodeProbe(
  p: RuntimeGroupProbe,
): PersistedGroupProbe {
  switch (p.kind) {
    case "alive":
      return { probe_kind: "alive" };
    case "absent":
      return { probe_kind: "absent" };
    case "permission_denied":
      return {
        probe_kind: "permission_denied",
        ...(p.code !== undefined ? { code: p.code } : {}),
      };
    case "probe_error":
      return {
        probe_kind: "probe_error",
        message: p.message,
        ...(p.code !== undefined ? { code: p.code } : {}),
      };
  }
}

export function encodeEscalation(
  e: RuntimeEscalationEvidence,
): PersistedEscalationEvidence {
  return {
    term_requested: e.termRequested,
    term_sent: e.termSent,
    term_result:
      e.termResult === null ? null : encodeSignalResult(e.termResult),
    kill_requested: e.killRequested,
    kill_sent: e.killSent,
    kill_result:
      e.killResult === null ? null : encodeSignalResult(e.killResult),
    final_group_probe: encodeProbe(e.finalGroupProbe),
  };
}

export function encodeOutput(
  o: CapturedOutput,
): PersistedOutputSummary {
  return {
    bytes_seen: o.bytesSeen,
    bytes_retained: o.bytesRetained,
    truncated: o.truncated,
  };
}

export function encodeResult(r: ProcessResult): PersistedProcessResult {
  const o = r.outcome;
  switch (o.kind) {
    case "exited":
      return { outcome_kind: "exited", exit_code: o.exitCode };
    case "signaled":
      return {
        outcome_kind: "signaled",
        signal: o.signal,
        exit_code: o.exitCode,
      };
    case "deadline":
      return {
        outcome_kind: "deadline",
        escalation: encodeEscalation(o.escalation),
      };
    case "cancelled":
      return {
        outcome_kind: "cancelled",
        escalation: encodeEscalation(o.escalation),
      };
    case "spawn_failed":
      return {
        outcome_kind: "spawn_failed",
        failure: encodeFailure(o.failure),
      };
    case "cleanup_failed":
      return {
        outcome_kind: "cleanup_failed",
        failure: encodeFailure(o.failure),
        escalation: encodeEscalation(o.escalation),
      };
  }
}
