/**
 * FOUNDATION04 — B0-CORR04 — Witness-evidence result/outcome
 * sub-decoders.
 *
 * Extracted from witness-evidence-decode.ts to keep that
 * file under the 400-LOC source-size discipline.
 */

import { ok, err } from "../domain/result.js";
import type { InvalidEvidence } from "../domain/failure.js";
import type {
  PersistedCommandOutcome,
  PersistedWitnessPersistedResult,
} from "./witness-types-persisted.js";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

export function validateResult(
  value: unknown,
):
  | { readonly ok: true; readonly value: PersistedWitnessPersistedResult }
  | { readonly ok: false; readonly error: InvalidEvidence } {
  if (!isRecord(value)) {
    return err({
      kind: "invalid_evidence",
      reason: "witness result must be an object",
    });
  }
  if (value["outcome_kind"] === "exited") {
    const exitCode = value["exit_code"];
    if (
      exitCode !== null &&
      (typeof exitCode !== "number" ||
        !Number.isInteger(exitCode) ||
        exitCode < -1)
    ) {
      return err({
        kind: "invalid_evidence",
        reason: "exit_code must be null or integer >= -1",
      });
    }
    return ok({
      outcome_kind: "exited",
      exit_code: exitCode as number | null,
    });
  }
  if (value["outcome_kind"] === "signaled") {
    const sig = value["signal"];
    if (sig !== null && typeof sig !== "string") {
      return err({
        kind: "invalid_evidence",
        reason: "signal must be null or string",
      });
    }
    const exitCode = value["exit_code"];
    if (
      exitCode !== null &&
      (typeof exitCode !== "number" || !Number.isInteger(exitCode))
    ) {
      return err({
        kind: "invalid_evidence",
        reason: "exit_code must be null or integer",
      });
    }
    return ok({
      outcome_kind: "signaled",
      signal: sig as string | null,
      exit_code: exitCode as number | null,
    });
  }
  return err({
    kind: "invalid_evidence",
    reason: `unknown outcome_kind ${String(value["outcome_kind"])}`,
  });
}

export function validateOutcome(
  value: unknown,
):
  | { readonly ok: true; readonly value: PersistedCommandOutcome }
  | { readonly ok: false; readonly error: InvalidEvidence } {
  if (!isRecord(value)) {
    return err({
      kind: "invalid_evidence",
      reason: "witness outcome must be an object",
    });
  }
  const kind = value["kind"];
  if (kind === "authority_unavailable") {
    if (typeof value["reason"] !== "string") {
      return err({
        kind: "invalid_evidence",
        reason: "authority_unavailable.reason must be string",
      });
    }
    return ok({
      kind: "authority_unavailable",
      reason: value["reason"] as string,
    });
  }
  if (
    kind === "cancelled" ||
    kind === "terminated" ||
    kind === "already_settled" ||
    kind === "cleanup_failed"
  ) {
    const res = validateResult(value["result"]);
    if (!res.ok) return res;
    return ok({
      kind,
      result: res.value,
    });
  }
  return err({
    kind: "invalid_evidence",
    reason: `unknown outcome kind ${String(kind)}`,
  });
}
