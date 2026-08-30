/**
 * FOUNDATION03 — process-evidence decoder: field-level validators.
 *
 * Numeric PID/PGID bounds (pid >= 1, pgid > 1) and identifier
 * shape validators live here. The per-kind dispatch is in
 * codec-decode-process-evidence.ts.
 *
 * Splitting keeps the dispatcher file under the 400 LOC discipline.
 */

import type { InvalidEvidence } from "../domain/failure.js";
import { err, ok, type Result } from "../domain/result.js";
import { parseAttemptId, type AttemptId } from "../domain/ids.js";
import { makeProcessId, type ProcessId } from "../process/process-types.js";

export function decodeStringField(
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

export function decodeProcessIdField(
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

export function decodeAttemptIdField(
  v: Record<string, unknown>,
  field: string = "attempt_id",
): Result<AttemptId, InvalidEvidence> {
  const raw = v[field];
  if (typeof raw !== "string" || raw.length === 0) {
    return err({
      kind: "invalid_evidence",
      reason: `Field '${field}' must be a non-empty string.`,
    });
  }
  const r = parseAttemptId(raw);
  if (r.ok === false) {
    return err({
      kind: "invalid_evidence",
      reason: `Field '${field}' must be a valid AttemptId: ${r.error.reason}`,
    });
  }
  return ok(r.value);
}

/**
 * PID must be a positive integer (>= 1).
 */
export function decodePidField(
  v: Record<string, unknown>,
  field: string,
): Result<number, InvalidEvidence> {
  const x = v[field];
  if (typeof x !== "number" || !Number.isInteger(x) || x < 1) {
    return err({
      kind: "invalid_evidence",
      reason: `Field '${field}' must be a positive integer; got ${String(x)}`,
    });
  }
  return ok(x);
}

/**
 * PGID must be > 1 (FOUNDATION03 §23). The group of a freshly forked
 * detached child is always > 1; pgid 1 is the process group of the
 * session leader and is unsafe to operate on.
 */
export function decodePgid(
  v: Record<string, unknown>,
  field: string,
): Result<number, InvalidEvidence> {
  const x = v[field];
  if (typeof x !== "number" || !Number.isInteger(x) || x <= 1) {
    return err({
      kind: "invalid_evidence",
      reason: `Field '${field}' must be an integer > 1 (refusing pid/pgid <= 1); got ${String(x)}`,
    });
  }
  return ok(x);
}

export function decodeNonNegativeInt(
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

export function decodeOptionalIntOrNull(
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

export function decodeOptionalStringOrNull(
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
