/**
 * FOUNDATION04 — B0-CORR01 — witness evidence ledger appender.
 *
 * After B0-CORR01: this module is a CLIENT of the
 * LedgerWriter. It does NOT touch events.jsonl directly
 * (B0-C01-11: no direct events.jsonl writer remains in
 * witness/supervisor paths). The LedgerWriter owns the
 * authoritative sequence allocation, the durability
 * boundary, and the on-disk commitId binding.
 *
 * The witness submits an UNSEQUENCED typed witness_evidence
 * payload plus a commitId; the writer constructs the
 * canonical envelope, allocates the sequence, fsyncs the
 * ledger, and ACKs the (sequence, contentHash). The
 * caller treats `appended` and `replay` identically: both
 * mean the witness's commitId is durably committed at that
 * sequence.
 *
 * If a LedgerWriter binding is not provided, the helper
 * fails closed: there is no fallback path that would let
 * the witness write events.jsonl directly, because that
 * would defeat the single-writer authority.
 */

import type { EventId, MissionId, RunId } from "../domain/ids.js";
import type { PersistedWitnessEvidence } from "./witness-types-persisted.js";
import {
  appendToLedgerWriter,
  whoAreYouLedgerWriter,
  type WhoAreYouClientResult,
} from "../ledger-writer/ledger-writer-client.js";
import { canonicalContentHash } from "../ledger-writer/ledger-writer-canonicalize.js";
import {
  ledgerWriterSocketPath,
  type StartLedgerWriterOptions,
} from "../ledger-writer/ledger-writer-process.js";
import { startLedgerWriter } from "../ledger-writer/ledger-writer-process.js";
import { makeCommitId } from "../ledger-writer/ledger-writer-types.js";

export type WitnessLedgerError =
  | { readonly kind: "writer_unavailable"; readonly socketPath: string }
  | { readonly kind: "writer_crashed"; readonly message: string }
  | { readonly kind: "invalid_envelope"; readonly reason: string }
  | { readonly kind: "conflicting_commit"; readonly message: string }
  | { readonly kind: "append_failed"; readonly message: string }
  | { readonly kind: "writer_rejected"; readonly reason: string };

export type WitnessLedgerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WitnessLedgerError };

export type WitnessLedgerBinding = {
  readonly runDir: string;
  readonly socketPath: string;
};

/**
 * Append a witness-evidence record through the LedgerWriter.
 *
 * The caller supplies either a `binding` (a known
 * socketPath) or the spawn-time `opts` (to start a fresh
 * writer — only for tests / first-run bootstrapping). In
 * normal operation the supervisor owns the writer and the
 * witness holds a binding to it.
 */
export async function appendWitnessEvidence(args: {
  readonly binding: WitnessLedgerBinding;
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly eventId: EventId;
  readonly observedAt: number;
  readonly payload: PersistedWitnessEvidence;
  readonly commitId: string;
}): Promise<WitnessLedgerResult<{ readonly seq: number; readonly contentHash: string }>> {
  const event = {
    kind: "witness_evidence" as const,
    eventId: args.eventId,
    observedAt: args.observedAt,
    payload: args.payload,
  };
  const clientContentHash = canonicalContentHash({
    runId: args.runId,
    missionId: args.missionId,
    event,
  });
  const r = await appendToLedgerWriter(
    { socketPath: args.binding.socketPath, timeoutMs: 10000 },
    {
      commitId: args.commitId,
      clientContentHash,
      event,
    },
  );
  if (!r.ok) {
    if (r.error.kind === "socket_missing" || r.error.kind === "connect_failed") {
      return {
        ok: false,
        error: {
          kind: "writer_unavailable",
          socketPath: args.binding.socketPath,
        },
      };
    }
    if (r.error.kind === "protocol_error") {
      const inner = r.error.error as { kind?: string; message?: string; reason?: string };
      if (inner.kind === "conflicting_commit") {
        return {
          ok: false,
          error: { kind: "conflicting_commit", message: inner.message ?? "" },
        };
      }
      if (inner.kind === "invalid_envelope") {
        // CORRECTION05 (rejection-is-not-crash law):
        // a live authority refusing an invalid request is a
        // REJECTION, not a crash. Map to writer_rejected
        // (truthful diagnostic) — NOT writer_crashed.
        return {
          ok: false,
          error: {
            kind: "writer_rejected",
            reason: inner.message ?? inner.reason ?? "invalid_envelope",
          },
        };
      }
      if (inner.kind === "append_failed") {
        return {
          ok: false,
          error: { kind: "append_failed", message: inner.message ?? "" },
        };
      }
      // Unknown protocol-level payload shape: the writer
      // is still alive (we got a response), but the payload
      // is unexpected. Surface as writer_rejected with the
      // raw reason rather than writer_crashed (the writer
      // didn't crash — it just returned something we don't
      // recognize).
      return {
        ok: false,
        error: {
          kind: "writer_rejected",
          reason: `unexpected protocol payload: ${
            inner.kind ?? "unknown"
          } (${inner.message ?? ""})`.trim(),
        },
      };
    }
    if (r.error.kind === "writer_busy_retries_exhausted") {
      // Writer is alive but persistently busy — not a
      // crash, not a rejection. Surface as writer_rejected
      // with a clear reason rather than writer_crashed.
      return {
        ok: false,
        error: {
          kind: "writer_rejected",
          reason: r.error.message,
        },
      };
    }
    // True transport-level failures: socket missing,
    // connect failed, write failed, frame decode failed,
    // timeout. The writer is presumed gone / unreachable.
    return {
      ok: false,
      error: { kind: "writer_crashed", message: r.error.kind },
    };
  }
  return {
    ok: true,
    value: {
      seq: r.value.sequence,
      contentHash: r.value.contentHash,
    },
  };
}

/**
 * Re-export the LedgerWriter spawn primitives so callers can
 * bootstrap a writer. The supervisor already calls these; the
 * witness normally consumes a binding the supervisor hands it.
 */
export {
  startLedgerWriter,
  ledgerWriterSocketPath,
  whoAreYouLedgerWriter,
  type StartLedgerWriterOptions,
  type WhoAreYouClientResult,
};

// Re-export the makeCommitId helper for tests / supervisors.
export { makeCommitId };
