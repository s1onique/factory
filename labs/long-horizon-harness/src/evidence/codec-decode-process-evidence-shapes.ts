/**
 * FOUNDATION03 — process-evidence decoder: union-shape decoders.
 *
 * Per-shape validation for PersistedProcessFailure,
 * PersistedSignalAttemptResult, PersistedGroupProbe,
 * PersistedOutputSummary, PersistedEscalationEvidence, and
 * PersistedProcessResult.
 *
 * Splitting this out keeps the dispatcher file under the
 * 400 LOC discipline (CORRECTION01 §32).
 */

import { andThen, err, ok, type Result } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import type {
  PersistedEscalationEvidence,
  PersistedGroupProbe,
  PersistedOutputSummary,
  PersistedProcessFailure,
  PersistedProcessResult,
  PersistedSignalAttemptResult,
} from "./codec-types.js";
import {
  decodeNonNegativeInt,
  decodeOptionalIntOrNull,
  decodeOptionalStringOrNull,
  decodeStringField,
} from "./codec-decode-process-evidence-helpers.js";

export function decodePersistedProcessFailure(
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
    case "spawn_failure":
      return andThen(decodeStringField(v, "message"), (message) => {
        const r: PersistedProcessFailure = { kind: "spawn_failure", message };
        if (typeof v["code"] === "string") (r as { code?: string }).code = v["code"];
        if (typeof v["syscall"] === "string")
          (r as { syscall?: string }).syscall = v["syscall"];
        if (typeof v["path"] === "string") (r as { path?: string }).path = v["path"];
        return ok(r);
      });
    case "signal_failure":
      return andThen(decodeStringField(v, "message"), (message) => {
        const sigRaw = v["signal"];
        if (sigRaw !== "SIGTERM" && sigRaw !== "SIGKILL" && sigRaw !== 0) {
          return err({
            kind: "invalid_evidence",
            reason: "signal_failure.signal must be SIGTERM | SIGKILL | 0.",
          });
        }
        const r: PersistedProcessFailure = {
          kind: "signal_failure",
          signal: sigRaw,
          message,
        };
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
        return ok({
          kind: "cleanup_timeout",
          phase: ph,
          message,
        } as PersistedProcessFailure);
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

export function decodePersistedSignalResult(
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
      if (
        v["signal"] !== "SIGTERM" &&
        v["signal"] !== "SIGKILL" &&
        v["signal"] !== 0
      ) {
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

export function decodePersistedGroupProbe(
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

export function decodePersistedOutputSummary(
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

export function decodePersistedEscalation(
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
          const termResultR: Result<
            PersistedSignalAttemptResult | null,
            InvalidEvidence
          > =
            termResult === null
              ? ok(null)
              : andThen(decodePersistedSignalResult(termResult), (x) => ok(x));
          if (termResultR.ok === false) return termResultR;
          const killResult = v["kill_result"];
          const killResultR: Result<
            PersistedSignalAttemptResult | null,
            InvalidEvidence
          > =
            killResult === null
              ? ok(null)
              : andThen(decodePersistedSignalResult(killResult), (x) => ok(x));
          if (killResultR.ok === false) return killResultR;
          const fp = v["final_group_probe"];
          if (typeof fp !== "object" || fp === null) {
            return err({
              kind: "invalid_evidence",
              reason: "escalation.final_group_probe must be a non-null object.",
            });
          }
          const fpR = decodePersistedGroupProbe(fp);
          if (fpR.ok === false) return fpR;
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

export function decodePersistedProcessResult(
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
          ok({
            outcome_kind: "signaled",
            signal,
            exit_code,
          } as PersistedProcessResult),
        ),
      );
    case "deadline":
    case "cancelled":
      return andThen(decodePersistedEscalation(v["escalation"]), (escalation) =>
        ok({
          outcome_kind: ok_,
          escalation,
        } as PersistedProcessResult),
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
