/**
 * FOUNDATION03 — process-evidence decoder dispatcher.
 *
 * Validates the outer envelope, dispatches by `kind`, and assembles
 * the typed {@link PersistedProcessEvidencePayload}. Field-level
 * validators live in codec-decode-process-evidence-helpers.ts;
 * the shape decoders for the union variants
 * (PersistedProcessFailure / SignalAttemptResult / GroupProbe /
 * OutputSummary / EscalationEvidence / ProcessResult) live here.
 *
 * Numeric PID/PGID bounds are enforced through the helpers:
 *   pid  >= 1
 *   pgid > 1
 */

import { andThen, err, ok, type Result } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import type { PersistedProcessEvidencePayload } from "./codec-types.js";
import {
  decodeAttemptIdField,
  decodeOptionalIntOrNull,
  decodeOptionalStringOrNull,
  decodePgid,
  decodePidField,
  decodeProcessIdField,
} from "./codec-decode-process-evidence-helpers.js";
import {
  decodePersistedGroupProbe,
  decodePersistedOutputSummary,
  decodePersistedProcessFailure,
  decodePersistedProcessResult,
  decodePersistedSignalResult,
} from "./codec-decode-process-evidence-shapes.js";

const PROCESS_EVIDENCE_KINDS: ReadonlyArray<
  PersistedProcessEvidencePayload["kind"]
> = [
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
];

function isProcessEvidenceKind(
  value: unknown,
): value is PersistedProcessEvidencePayload["kind"] {
  return (
    typeof value === "string" &&
    (PROCESS_EVIDENCE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Public dispatcher. Validates the envelope, dispatches by
 * `kind`, and returns the typed {@link PersistedProcessEvidencePayload}.
 */
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
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        andThen(decodeProcessIdField(v), (process_id) =>
          ok({ kind: k, attempt_id, process_id } as PersistedProcessEvidencePayload),
        ),
      );
    case "process_spawn_requested":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        andThen(decodeProcessIdField(v), (process_id) =>
          ok({
            kind: "process_spawn_requested",
            attempt_id,
            process_id,
          } as PersistedProcessEvidencePayload),
        ),
      );
    case "process_spawned":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        andThen(decodeProcessIdField(v), (process_id) =>
          andThen(decodePidField(v, "pid"), (pid) =>
            andThen(decodePgid(v, "pgid"), (pgid) =>
              ok({
                kind: "process_spawned",
                attempt_id,
                process_id,
                pid,
                pgid,
              } as PersistedProcessEvidencePayload),
            ),
          ),
        ),
      );
    case "process_spawn_failed":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        andThen(decodeProcessIdField(v), (process_id) =>
          andThen(decodePersistedProcessFailure(v["failure"]), (failure) =>
            ok({
              kind: "process_spawn_failed",
              attempt_id,
              process_id,
              failure,
            } as PersistedProcessEvidencePayload),
          ),
        ),
      );
    case "process_signal_attempted":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        andThen(decodeProcessIdField(v), (process_id) => {
          const s = v["signal"];
          if (s !== "SIGTERM" && s !== "SIGKILL") {
            return err({
              kind: "invalid_evidence",
              reason: "signal_attempted.signal must be SIGTERM | SIGKILL.",
            });
          }
          return ok({
            kind: "process_signal_attempted",
            attempt_id,
            process_id,
            signal: s,
          } as PersistedProcessEvidencePayload);
        }),
      );
    case "process_signal_result":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        andThen(decodeProcessIdField(v), (process_id) => {
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
              attempt_id,
              process_id,
              signal: s,
              result,
            } as PersistedProcessEvidencePayload),
          );
        }),
      );
    case "process_group_probe":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        andThen(decodeProcessIdField(v), (process_id) =>
          andThen(decodePersistedGroupProbe(v["probe"]), (probe) =>
            ok({
              kind: "process_group_probe",
              attempt_id,
              process_id,
              probe,
            } as PersistedProcessEvidencePayload),
          ),
        ),
      );
    case "process_close_observed": {
      const closeCode = v["exit_code"];
      const closeSignal = v["signal"];
      // CORRECTION02 §9 (A13): on a genuine post-spawn close,
      // exactly one of exit_code / signal MUST be non-null.
      // Node guarantees code XOR signal on the 'close' event
      // for successful spawns. Spawn-failure close records
      // are not produced (the lifecycle emits process_spawn_failed
      // instead).
      if (closeCode === null && closeSignal === null) {
        return err({
          kind: "invalid_evidence",
          reason: "process_close_observed exit_code AND signal cannot both be null",
        });
      }
      if (
        typeof closeCode === "number" &&
        closeCode !== null &&
        typeof closeSignal === "string" &&
        closeSignal !== null
      ) {
        return err({
          kind: "invalid_evidence",
          reason: "process_close_observed exit_code AND signal cannot both be non-null",
        });
      }
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        andThen(decodeProcessIdField(v), (process_id) =>
          andThen(decodeOptionalIntOrNull(v, "exit_code"), (exit_code) =>
            andThen(decodeOptionalStringOrNull(v, "signal"), (signal) =>
              ok({
                kind: "process_close_observed",
                attempt_id,
                process_id,
                exit_code,
                signal,
              } as PersistedProcessEvidencePayload),
            ),
          ),
        ),
      );
    }
    case "process_output_summary":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        andThen(decodeProcessIdField(v), (process_id) =>
          andThen(decodePersistedOutputSummary(v["stdout"]), (stdout) =>
            andThen(decodePersistedOutputSummary(v["stderr"]), (stderr) =>
              ok({
                kind: "process_output_summary",
                attempt_id,
                process_id,
                stdout,
                stderr,
              } as PersistedProcessEvidencePayload),
            ),
          ),
        ),
      );
    case "process_result_committed":
      return andThen(decodeAttemptIdField(v), (attempt_id) =>
        andThen(decodeProcessIdField(v), (process_id) =>
          andThen(decodePersistedProcessResult(v["result"]), (result) =>
            ok({
              kind: "process_result_committed",
              attempt_id,
              process_id,
              result,
            } as PersistedProcessEvidencePayload),
          ),
        ),
      );
  }
}
