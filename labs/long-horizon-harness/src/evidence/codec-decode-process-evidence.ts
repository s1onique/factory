/**
 * FOUNDATION03 — process-evidence decoder internals.
 *
 * All persisted branded identifiers are validated; numeric PID/PGID
 * are validated as positive integers; group probes and signal
 * results are validated as their discriminated unions. Any failure
 * is translated into typed `invalid_evidence`.
 *
 * Kept in a sibling file so `codec-decode-internals.ts` stays small.
 */

import {
  andThen,
  err,
  ok,
  type Result,
} from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import {
  makeProcessId,
  type ProcessId,
} from "../process/process-types.js";
import type {
  PersistedEscalationEvidence,
  PersistedGroupProbe,
  PersistedOutputSummary,
  PersistedProcessEvidencePayload,
  PersistedProcessFailure,
  PersistedProcessResult,
  PersistedSignalAttemptResult,
} from "./codec-types.js";

const PROCESS_EVIDENCE_KINDS: ReadonlyArray<PersistedProcessEvidencePayload["kind"]> =
  [
    "process_spawn_requested",
    "process_spawned",
    "process_spawn_failed",
    "process_deadline_reached",
    "process_cancel_requested",
    "process_signal_attempted",
    "process_signal_result",
    "process_group_probe",
    "process_close_observed",
    "process_output_summary",
    "process_result_committed",
  ] as const;

function isProcessEvidenceKind(
  value: unknown,
): value is PersistedProcessEvidencePayload["kind"] {
  return (
    typeof value === "string" &&
    (PROCESS_EVIDENCE_KINDS as readonly string[]).includes(value)
  );
}

function decodeStringField(
  v: Record<string, unknown>,
  field: string,
): Result<string, InvalidEvidence> {
  const x = v[field];
  if (typeof x !== "string" || x.length === 0) {
    return err({
      kind: "invalid_evidence",
      reason: `Field '${field}' must be a non-empty string.`,
    });
  }
  return ok(x);
}

function decodeProcessIdField(
  v: Record<string, unknown>,
  field: string = "process_id",
): Result<ProcessId, InvalidEvidence> {
  const raw = v[field];
  if (typeof raw !== "string" || raw.length === 0) {
    return err({
      kind: "invalid_evidence",
      reason: `Field '${field}' must be a non-empty string.`,
    });
  }
  return ok(makeProcessId(raw));
}

function decodePositiveInt(
  v: Record<string, unknown>,
  field: string,
): Result<number, InvalidEvidence> {
  const x = v[field];
  if (typeof x !== "number" || !Number.isInteger(x) || x < 1) {
    return err({
      kind: "invalid_evidence",
      reason: `Field '${field}' must be a positive integer.`,
    });
  }
  return ok(x);
}

function decodeNonNegativeInt(
  v: Record<string, unknown>,
  field: string,
): Result<number, InvalidEvidence> {
  const x = v[field];
  if (typeof x !== "number" || !Number.isInteger(x) || x < 0) {
    return err({
      kind: "invalid_evidence",
      reason: `Field '${field}' must be a non-negative integer.`,
    });
  }
  return ok(x);
}

function decodeOptionalIntOrNull(
  v: Record<string, unknown>,
  field: string,
): Result<number | null, InvalidEvidence> {
  const x = v[field];
  if (x === null) return ok(null);
  if (typeof x !== "number" || !Number.isInteger(x)) {
    return err({
      kind: "invalid_evidence",
      reason: `Field '${field}' must be an integer or null.`,
    });
  }
  return ok(x);
}

function decodeOptionalStringOrNull(
  v: Record<string, unknown>,
  field: string,
): Result<string | null, InvalidEvidence> {
  const x = v[field];
  if (x === null) return ok(null);
  if (typeof x !== "string") {
    return err({
      kind: "invalid_evidence",
      reason: `Field '${field}' must be a string or null.`,
    });
  }
  return ok(x);
}

function decodePersistedProcessFailure(
  raw: unknown,
): Result<PersistedProcessFailure, InvalidEvidence> {
  if (typeof raw !== "object" || raw === null) {
    return err({
      kind: "invalid_evidence",
      reason: "process failure must be a non-null object.",
    });
  }
  const v = raw as Record<string, unknown>;
  const k = v["kind"];
  if (typeof k !== "string") {
    return err({ kind: "invalid_evidence", reason: "process failure missing 'kind'." });
  }
  switch (k) {
    case "invalid_process_spec":
    case "internal_process_failure":
    case "capability_unavailable":
      return andThen(decodeStringField(v, "message"), (message) =>
        ok({ kind: k, message } as PersistedProcessFailure),
      );
    case "spawn_failure": {
      const msg = decodeStringField(v, "message");
      if (msg.ok === false) return err(msg.error);
      const r: PersistedProcessFailure = { kind: "spawn_failure", message: msg.value };
      if (typeof v["code"] === "string") (r as { code?: string }).code = v["code"];
      if (typeof v["syscall"] === "string") (r as { syscall?: string }).syscall = v["syscall"];
      if (typeof v["path"] === "string") (r as { path?: string }).path = v["path"];
      return ok(r);
    }
    case "signal_failure":
      return andThen(decodeStringField(v, "message"), (message) => {
        const sigRaw = v["signal"];
        if (sigRaw !== "SIGTERM" && sigRaw !== "SIGKILL" && sigRaw !== 0) {
          return err({
            kind: "invalid_evidence",
            reason: "signal_failure.signal must be SIGTERM | SIGKILL | 0.",
          });
        }
        const r: PersistedProcessFailure = { kind: "signal_failure", signal: sigRaw, message };
        if (typeof v["code"] === "string") (r as { code?: string }).code = v["code"];
        return ok(r);
      });
    case "cleanup_timeout":
      return andThen(decodeStringField(v, "message"), (message) => {
        const ph = v["phase"];
        if (ph !== "term" && ph !== "kill" && ph !== "close") {
          return err({
            kind: "invalid_evidence",
            reason: "cleanup_timeout.phase must be term | kill | close.",
          });
        }
        return ok({ kind: "cleanup_timeout", phase: ph, message } as PersistedProcessFailure);
      });
    case "stdio_failure":
      return andThen(decodeStringField(v, "message"), (message) => {
        const s = v["stream"];
        if (s !== "stdout" && s !== "stderr") {
          return err({
            kind: "invalid_evidence",
            reason: "stdio_failure.stream must be stdout | stderr.",
          });
        }
        const r: PersistedProcessFailure = { kind: "stdio_failure", stream: s, message };
        if (typeof v["code"] === "string") (r as { code?: string }).code = v["code"];
        return ok(r);
      });
  }
  return err({
    kind: "invalid_evidence",
    reason: `Unknown process failure kind '${k}'.`,
  });
  return err({
    kind: "invalid_evidence",
    reason: `Unknown process failure kind '${k}'.`,
  });
}

function decodePersistedSignalResult(
  raw: unknown,
): Result<PersistedSignalAttemptResult, InvalidEvidence> {
  if (typeof raw !== "object" || raw === null) {
    return err({
      kind: "invalid_evidence",
      reason: "signal result must be a non-null object.",
    });
  }
  const v = raw as Record<string, unknown>;
  const rk = v["result_kind"];
  switch (rk) {
    case "sent":
      if (v["signal"] !== "SIGTERM" && v["signal"] !== "SIGKILL" && v["signal"] !== 0) {
        return err({
          kind: "invalid_evidence",
          reason: "sent.signal must be SIGTERM | SIGKILL | 0.",
        });
      }
      return ok({
        result_kind: "sent",
        signal: v["signal"],
      } as PersistedSignalAttemptResult);
    case "group_absent":
      return ok({ result_kind: "group_absent" });
    case "permission_denied": {
      const r: PersistedSignalAttemptResult = { result_kind: "permission_denied" };
      if (typeof v["code"] === "string") (r as { code?: string }).code = v["code"];
      return ok(r);
    }
    case "error":
      return andThen(decodeStringField(v, "message"), (message) => {
        const r: PersistedSignalAttemptResult = { result_kind: "error", message };
        if (typeof v["code"] === "string") (r as { code?: string }).code = v["code"];
        return ok(r);
      });
  }
  return err({
    kind: "invalid_evidence",
    reason: `Unknown signal result_kind '${String(rk)}'.`,
  });
}

function decodePersistedGroupProbe(
  raw: unknown,
): Result<PersistedGroupProbe, InvalidEvidence> {
  if (typeof raw !== "object" || raw === null) {
    return err({
      kind: "invalid_evidence",
      reason: "group probe must be a non-null object.",
    });
  }
  const v = raw as Record<string, unknown>;
  const pk = v["probe_kind"];
  switch (pk) {
    case "alive":
      return ok({ probe_kind: "alive" });
    case "absent":
      return ok({ probe_kind: "absent" });
    case "permission_denied": {
      const r: PersistedGroupProbe = { probe_kind: "permission_denied" };
      if (typeof v["code"] === "string") (r as { code?: string }).code = v["code"];
      return ok(r);
    }
    case "probe_error":
      return andThen(decodeStringField(v, "message"), (message) => {
        const r: PersistedGroupProbe = { probe_kind: "probe_error", message };
        if (typeof v["code"] === "string") (r as { code?: string }).code = v["code"];
        return ok(r);
      });
  }
  return err({
    kind: "invalid_evidence",
    reason: `Unknown group probe_kind '${String(pk)}'.`,
  });
}

function decodePersistedOutputSummary(
  raw: unknown,
): Result<PersistedOutputSummary, InvalidEvidence> {
  if (typeof raw !== "object" || raw === null) {
    return err({
      kind: "invalid_evidence",
      reason: "output summary must be a non-null object.",
    });
  }
  const v = raw as Record<string, unknown>;
  return andThen(decodeNonNegativeInt(v, "bytes_seen"), (bytes_seen) =>
    andThen(decodeNonNegativeInt(v, "bytes_retained"), (bytes_retained) => {
      if (typeof v["truncated"] !== "boolean") {
        return err({
          kind: "invalid_evidence",
          reason: "output summary 'truncated' must be a boolean.",
        });
      }
      if (bytes_retained > bytes_seen) {
        return err({
          kind: "invalid_evidence",
          reason: `output summary bytes_retained (${bytes_retained}) > bytes_seen (${bytes_seen}).`,
        });
      }
      return ok({ bytes_seen, bytes_retained, truncated: v["truncated"] });
    }),
  );
}

function decodePersistedEscalation(
  raw: unknown,
): Result<PersistedEscalationEvidence, InvalidEvidence> {
  if (typeof raw !== "object" || raw === null) {
    return err({
      kind: "invalid_evidence",
      reason: "escalation evidence must be a non-null object.",
    });
  }
  const v = raw as Record<string, unknown>;
  function b(field: string): Result<boolean, InvalidEvidence> {
    const x = v[field];
    if (typeof x !== "boolean") {
      return err({
        kind: "invalid_evidence",
        reason: `escalation.${field} must be boolean.`,
      });
    }
    return ok(x);
  }
  return andThen(b("term_requested"), (term_requested) =>
    andThen(b("term_sent"), (term_sent) =>
      andThen(b("kill_requested"), (kill_requested) =>
        andThen(b("kill_sent"), (kill_sent) => {
          const termResult = v["term_result"];
          const termResultR: Result<PersistedSignalAttemptResult | null, InvalidEvidence> =
            termResult === null
              ? ok(null)
              : andThen(decodePersistedSignalResult(termResult), (x) => ok(x));
          if (termResultR.ok === false) return err(termResultR.error);
          const killResult = v["kill_result"];
          const killResultR: Result<PersistedSignalAttemptResult | null, InvalidEvidence> =
            killResult === null
              ? ok(null)
              : andThen(decodePersistedSignalResult(killResult), (x) => ok(x));
          if (killResultR.ok === false) return err(killResultR.error);
          const fp = v["final_group_probe"];
          if (typeof fp !== "object" || fp === null) {
            return err({
              kind: "invalid_evidence",
              reason: "escalation.final_group_probe must be a non-null object.",
            });
          }
          const fpR = decodePersistedGroupProbe(fp);
          if (fpR.ok === false) return err(fpR.error);
          return ok({
            term_requested,
            term_sent,
            term_result: termResultR.value,
            kill_requested,
            kill_sent,
            kill_result: killResultR.value,
            final_group_probe: fpR.value,
          });
        }),
      ),
    ),
  );
}

function decodePersistedProcessResult(
  raw: unknown,
): Result<PersistedProcessResult, InvalidEvidence> {
  if (typeof raw !== "object" || raw === null) {
    return err({
      kind: "invalid_evidence",
      reason: "process result must be a non-null object.",
    });
  }
  const v = raw as Record<string, unknown>;
  const ok_ = v["outcome_kind"];
  switch (ok_) {
    case "exited":
      return andThen(decodeOptionalIntOrNull(v, "exit_code"), (exit_code) =>
        ok({ outcome_kind: "exited", exit_code } as PersistedProcessResult),
      );
    case "signaled":
      return andThen(decodeOptionalIntOrNull(v, "exit_code"), (exit_code) =>
        andThen(decodeOptionalStringOrNull(v, "signal"), (signal) =>
          ok({ outcome_kind: "signaled", signal, exit_code } as PersistedProcessResult),
        ),
      );
    case "deadline":
    case "cancelled":
      return andThen(decodePersistedEscalation(v["escalation"]), (escalation) =>
        ok({ outcome_kind: ok_, escalation } as PersistedProcessResult),
      );
    case "spawn_failed":
      return andThen(decodePersistedProcessFailure(v["failure"]), (failure) =>
        ok({ outcome_kind: "spawn_failed", failure } as PersistedProcessResult),
      );
    case "cleanup_failed":
      return andThen(decodePersistedProcessFailure(v["failure"]), (failure) =>
        andThen(decodePersistedEscalation(v["escalation"]), (escalation) =>
          ok({
            outcome_kind: "cleanup_failed",
            failure,
            escalation,
          } as PersistedProcessResult),
        ),
      );
  }
  return err({
    kind: "invalid_evidence",
    reason: `Unknown process outcome_kind '${String(ok_)}'.`,
  });
}

export function decodePersistedProcessEvidence(
  raw: unknown,
): Result<PersistedProcessEvidencePayload, InvalidEvidence> {
  if (typeof raw !== "object" || raw === null) {
    return err({
      kind: "invalid_evidence",
      reason: "process evidence must be a non-null object.",
    });
  }
  const v = raw as Record<string, unknown>;
  const k = v["kind"];
  if (!isProcessEvidenceKind(k)) {
    return err({
      kind: "invalid_evidence",
      reason: `Unknown process evidence kind '${String(k)}'. Expected one of: ${PROCESS_EVIDENCE_KINDS.join(", ")}.`,
    });
  }
  switch (k) {
    case "process_deadline_reached":
    case "process_cancel_requested":
      return andThen(decodeProcessIdField(v), (process_id) =>
        ok({ kind: k, process_id } as PersistedProcessEvidencePayload),
      );
    case "process_spawn_requested":
      return andThen(decodeProcessIdField(v), (process_id) =>
        ok({
          kind: "process_spawn_requested",
          process_id,
        } as PersistedProcessEvidencePayload),
      );
    case "process_spawned":
      return andThen(decodeProcessIdField(v), (process_id) =>
        andThen(decodePositiveInt(v, "pid"), (pid) =>
          andThen(decodePositiveInt(v, "pgid"), (pgid) =>
            ok({
              kind: "process_spawned",
              process_id,
              pid,
              pgid,
            } as PersistedProcessEvidencePayload),
          ),
        ),
      );
    case "process_spawn_failed":
      return andThen(decodeProcessIdField(v), (process_id) =>
        andThen(decodePersistedProcessFailure(v["failure"]), (failure) =>
          ok({
            kind: "process_spawn_failed",
            process_id,
            failure,
          } as PersistedProcessEvidencePayload),
        ),
      );
    case "process_signal_attempted":
      return andThen(decodeProcessIdField(v), (process_id) => {
        const s = v["signal"];
        if (s !== "SIGTERM" && s !== "SIGKILL") {
          return err({
            kind: "invalid_evidence",
            reason: "signal_attempted.signal must be SIGTERM | SIGKILL.",
          });
        }
        return ok({
          kind: "process_signal_attempted",
          process_id,
          signal: s,
        } as PersistedProcessEvidencePayload);
      });
    case "process_signal_result":
      return andThen(decodeProcessIdField(v), (process_id) => {
        const s = v["signal"];
        if (s !== "SIGTERM" && s !== "SIGKILL") {
          return err({
            kind: "invalid_evidence",
            reason: "signal_result.signal must be SIGTERM | SIGKILL.",
          });
        }
        return andThen(decodePersistedSignalResult(v["result"]), (result) =>
          ok({
            kind: "process_signal_result",
            process_id,
            signal: s,
            result,
          } as PersistedProcessEvidencePayload),
        );
      });
    case "process_group_probe":
      return andThen(decodeProcessIdField(v), (process_id) =>
        andThen(decodePersistedGroupProbe(v["probe"]), (probe) =>
          ok({
            kind: "process_group_probe",
            process_id,
            probe,
          } as PersistedProcessEvidencePayload),
        ),
      );
    case "process_close_observed":
      return andThen(decodeProcessIdField(v), (process_id) =>
        andThen(decodeOptionalIntOrNull(v, "exit_code"), (exit_code) =>
          andThen(decodeOptionalStringOrNull(v, "signal"), (signal) =>
            ok({
              kind: "process_close_observed",
              process_id,
              exit_code,
              signal,
            } as PersistedProcessEvidencePayload),
          ),
        ),
      );
    case "process_output_summary":
      return andThen(decodeProcessIdField(v), (process_id) =>
        andThen(decodePersistedOutputSummary(v["stdout"]), (stdout) =>
          andThen(decodePersistedOutputSummary(v["stderr"]), (stderr) =>
            ok({
              kind: "process_output_summary",
              process_id,
              stdout,
              stderr,
            } as PersistedProcessEvidencePayload),
          ),
        ),
      );
    case "process_result_committed":
      return andThen(decodeProcessIdField(v), (process_id) =>
        andThen(decodePersistedProcessResult(v["result"]), (result) =>
          ok({
            kind: "process_result_committed",
            process_id,
            result,
          } as PersistedProcessEvidencePayload),
        ),
      );
  }
}
