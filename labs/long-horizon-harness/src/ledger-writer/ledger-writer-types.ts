/**
 * FOUNDATION04 — CORRECTION01 — LedgerWriter types.
 *
 * The LedgerWriter is the single process that owns the run's
 * events.jsonl file. Both the supervisor and the witness submit
 * typed evidence append requests to it over a UDS, and the
 * writer allocates the next sequence, appends, fsyncs, and
 * returns an ACK that is durable-ACK-law compliant:
 *
 *   - ACK is sent only after the record is fsync'd
 *   - ACK-loss on the wire is closed by the commitId dedup
 *     index: a retry with the same commitId returns the
 *     original sequence, never a duplicate
 *   - crash-after-fsync-before-ACK is recoverable: the writer
 *     restarts, reads its own dedup index from disk, and any
 *     pending retry with the matching commitId rediscover
 *     the original sequence.
 *
 * The writer is a run-scoped infrastructure durability
 * authority. It is NOT a convenience helper. It MUST be the
 * sole writer for its run's events.jsonl for the duration of
 * the run.
 *
 * Doctrine references:
 *   F04-CORR01-D02 (Serialization-authority law)
 *   F04-CORR01-DurableAckLaw (ACK-loss safe)
 *   F04-CORR01-D08 (writer restart recovers sequence solely
 *   from durable ledger state)
 *   F04-CORR01-D09 (only one LedgerWriter per run ledger)
 *   B0-CORR01 §B0-C01-01..12 (acceptance contract)
 */

import type { RunId, MissionId } from "../domain/ids.js";

/**
 * Stable caller-side identity for a logical evidence commit.
 *
 * The client picks this. Identical commitIds MUST mean the
 * same logical commit. The LedgerWriter uses this both as a
 * dedup key and as the durability boundary's stable identity.
 *
 * Format constraints are deliberately identical to
 * IDENTIFIER_GRAMMAR so the value can be persisted as JSON
 * and round-tripped through a JSON parser without escaping.
 */
export type CommitId = string & { readonly __commitId: unique symbol };

/**
 * Bounded commitId validator. Used both at the wire boundary
 * (incoming messages) and before persisting to the dedup
 * index.
 */
export const COMMIT_ID_GRAMMAR = /^[A-Za-z0-9_.:-]{1,128}$/;

export function makeCommitId(value: string): CommitId {
  if (!COMMIT_ID_GRAMMAR.test(value)) {
    throw new Error(
      `Invalid CommitId: must match ${COMMIT_ID_GRAMMAR}`,
    );
  }
  return value as CommitId;
}

export function parseCommitId(value: unknown): {
  readonly ok: true;
  readonly value: CommitId;
} | { readonly ok: false; readonly reason: string } {
  if (typeof value !== "string") {
    return { ok: false, reason: `expected string, got ${typeof value}` };
  }
  if (!COMMIT_ID_GRAMMAR.test(value)) {
    return {
      ok: false,
      reason: `value does not match commitId grammar ${COMMIT_ID_GRAMMAR}`,
    };
  }
  return { ok: true, value: value as CommitId };
}

/**
 * Identifier for a single LedgerWriter process. Allocated
 * once at startup. Used to detect "second writer for same
 * run" attempts (F04-CORR01-D09) and to bind every ACKed
 * sequence to a specific writer instance.
 */
export type LedgerWriterInstanceId =
  string & { readonly __ledgerWriterInstanceId: unique symbol };

export const LEDGER_WRITER_INSTANCE_ID_GRAMMAR = /^[A-Za-z0-9_.:-]{1,128}$/;

export function makeLedgerWriterInstanceId(value: string): LedgerWriterInstanceId {
  if (!LEDGER_WRITER_INSTANCE_ID_GRAMMAR.test(value)) {
    throw new Error(
      `Invalid LedgerWriterInstanceId: must match ${LEDGER_WRITER_INSTANCE_ID_GRAMMAR}`,
    );
  }
  return value as LedgerWriterInstanceId;
}

/**
 * Per-commitId durable record kept in the dedup index.
 *
 * The LedgerWriter is the SOLE authority on the sequence
 * number (B0-C01-01). The dedup index maps commitId → the
 * sequence the writer actually committed, paired with the
 * contentHash of the canonical envelope bytes so the writer
 * can detect:
 *
 *   - same commitId + same contentHash → replay (B0-C01-05)
 *   - same commitId + different contentHash → CONFLICTING
 *     commit (B0-C01-06). A commitId is the stable caller-
 *     side identity of a logical evidence commit; its
 *     content must not drift underneath the same identity.
 *   - different commitId + identical content → distinct
 *     logical commits (B0-C01-07). Two independently emitted
 *     events can legitimately share bytes; the dedup key
 *     is the commitId alone, not the contentHash.
 *
 * The contentHash is therefore an INTEGRITY field bound to
 * the commitId, NOT an alternate commit identity.
 *
 * Derived-index law (B0-C01-04): a performance index may
 * accelerate recovery, but losing it must never destroy
 * semantic information required for correct recovery. The
 * events.jsonl ledger is the authoritative source of
 * commitId → sequence + contentHash; the dedup sidecar is
 * a cache that the writer rebuilds from the ledger on
 * startup.
 */
export type DedupEntry = {
  readonly sequence: number;
  readonly contentHash: string;
};

export type DedupIndex = {
  readonly byCommitId: Readonly<Record<string, DedupEntry>>;
  readonly maxSequence: number;
};

export function emptyDedupIndex(): DedupIndex {
  return {
    byCommitId: {},
    maxSequence: 0,
  };
}

export type AppendResult =
  | { readonly ok: true; readonly sequence: number }
  | {
      readonly ok: false;
      readonly error:
        | { readonly kind: "writer_unavailable"; readonly socketPath: string }
        | { readonly kind: "writer_busy" }
        | { readonly kind: "writer_crashed"; readonly message: string }
        | { readonly kind: "invalid_envelope"; readonly reason: string }
        | { readonly kind: "conflicting_commit"; readonly message: string }
        | { readonly kind: "append_failed"; readonly message: string }
        | { readonly kind: "writer_rejected"; readonly reason: string };
    };

/**
 * Outcome of a `who_are_you` identity handshake against a
 * writer socket. Used both by the spawn-readiness gate (does
 * the spawned instance own the socket we observed?) and by
 * the stale-socket recovery protocol (does this socket still
 * represent a live, compatible writer?).
 */
export type WhoAreYouResult =
  | {
      readonly ok: true;
      readonly instanceId: LedgerWriterInstanceId;
      readonly runId: string;
      readonly missionId: string;
      readonly socketPath: string;
      readonly startedAt: number;
      readonly maxSequence: number;
    }
  | {
      readonly ok: false;
      readonly error:
        | { readonly kind: "no_response"; readonly message: string }
        | { readonly kind: "protocol_error"; readonly message: string };
    };

/**
 * Outcome of the bind-time path-collision probe. The
 * LedgerWriter MUST NOT blindly unlink a path that already
 * holds a socket: another live writer may own it.
 */
export type PathCollisionResult =
  | { readonly ok: true; readonly observedKind: "absent" }
  | { readonly ok: true; readonly observedKind: "stale_socket"; readonly whoAreYou: WhoAreYouResult }
  | {
      readonly ok: false;
      readonly error:
        | { readonly kind: "live_writer_present"; readonly instanceId?: string; readonly message: string }
        | { readonly kind: "path_collision"; readonly observedKind: "regular" | "symlink" | "directory" }
        | { readonly kind: "probe_failed"; readonly message: string };
    };

export type LedgerWriterBinding = {
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly instanceId: LedgerWriterInstanceId;
  readonly socketPath: string;
  readonly startedAt: number;
};
