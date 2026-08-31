/**
 * FOUNDATION04 — B0-CORR04 — Ledger snapshot validator.
 *
 * Internal helper that combines FOUNDATION01's authoritative
 * envelope decode + sequence validation with retention of the
 * raw record text, so a single-snapshot recovery can
 * derive both projections from one byte buffer.
 *
 * Doctrine (B0-CORR04 §9):
 *   **Single-observation projection law:** multiple
 *   authoritative projections used in one recovery
 *   decision MUST derive from one validated observation
 *   of durable state.
 *
 * This module is used by:
 *   - readAndValidate(path) — reads bytes once, validates,
 *     returns both envelopes and raw records.
 *   - ledger-writer-recovery.ts — reads bytes once,
 *     validates, derives both maxSequence and byCommitId
 *     projections.
 *
 * No new validation policy is introduced; the existing
 * envelope decoder remains the authority.
 */

import {
  decodeEnvelopeFromJsonLine,
} from "./ledger-internals.js";
import {
  type LedgerError,
} from "./ledger-read-validate.js";
import { ok, err, type Result } from "../domain/result.js";
import type { EventEnvelope } from "./codec-types.js";

export type RawRecord = {
  readonly lineNumber: number;
  readonly raw: string;
  readonly parsed: Record<string, unknown>;
};

export type ValidatedSnapshot = {
  readonly envelopes: readonly EventEnvelope[];
  readonly lastSeq: number;
  readonly rawRecords: readonly RawRecord[];
};

/**
 * Validate a single-snapshot in-memory buffer of the
 * authoritative ledger. Mirrors FOUNDATION01's
 * readAndValidate semantics:
 *   - torn-tail detection (must end in '\n' if non-empty)
 *   - JSON parseable per line
 *   - authoritative envelope decode per line (via the
 *     existing decoder; NO alternate schema)
 *   - sequence contiguity (sequence === lastSeq + 1)
 *
 * On success returns both the typed envelopes and the raw
 * records (for side-channel projection).
 *
 * On parse / decode / sequence failure returns the typed
 * LedgerError so the caller can fail closed.
 */
export function validateLedgerSnapshot(
  raw: string,
): Result<ValidatedSnapshot, LedgerError> {
  if (raw.length > 0 && !raw.endsWith("\n")) {
    return err({
      kind: "invalid_evidence",
      reason:
        "Ledger ends with a non-empty unterminated suffix; open must be called to recover.",
    });
  }
  const envelopes: EventEnvelope[] = [];
  const rawRecords: RawRecord[] = [];
  let lastSeq = 0;
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.length === 0) continue;
    const parsed = decodeEnvelopeFromJsonLine(line);
    if (parsed.ok === false) return err(parsed.error);
    const env = parsed.value;
    if (env.sequence <= lastSeq) {
      return err({
        kind: "invalid_evidence",
        reason: `Duplicate or out-of-order sequence at line ${i + 1}: got ${env.sequence}, expected > ${lastSeq}.`,
      });
    }
    if (env.sequence !== lastSeq + 1) {
      return err({
        kind: "invalid_evidence",
        reason: `Sequence gap at line ${i + 1}: got ${env.sequence}, expected ${lastSeq + 1}.`,
      });
    }
    envelopes.push(env);
    lastSeq = env.sequence;
    // Retain the raw JSON object alongside the typed
    // envelope. The side-channel (commit_id, content_hash)
    // lives in the snake_case wire format, not on the
    // branded EventEnvelope. We re-parse to a Record so
    // callers can read both. This is the single snapshot;
    // we do NOT introduce a second read.
    let rawParsed: Record<string, unknown>;
    try {
      rawParsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      rawParsed = env as unknown as Record<string, unknown>;
    }
    rawRecords.push({
      lineNumber: i + 1,
      raw: line,
      parsed: rawParsed,
    });
  }
  return ok({ envelopes, lastSeq, rawRecords });
}
