/**
 * FOUNDATION04 — B0-CORR01 — LedgerWriter request handler.
 *
 * Implements the per-request lifecycle that allocates the
 * sequence, persists the canonical envelope, and replies.
 * Extracted from `ledger-writer-server.ts` so that file
 * stays under the 400-LOC source-size discipline
 * (FOUNDATION03 §29).
 *
 * Per-request contract (B0-C01-01..12):
 *
 *   1. Compute the canonical unsequenced envelope from the
 *      wire event (no caller-supplied sequence).
 *   2. Hash the canonical envelope (B0-C01-02 writer
 *      authority on the bytes that hit disk).
 *   3. Verify the client's clientContentHash matches
 *      (tamper detection; mismatch → content_hash_mismatch).
 *   4. Look up the commitId in the dedup index
 *      (B0-C01-05..07 replay / conflict / miss).
 *   5. Allocate the next sequence and persist the canonical
 *      record with commit_id + content_hash fields
 *      (B0-C01-03).
 *   6. Update the in-memory dedup index and reply.
 *
 * The handler is single-flight per writer process: only one
 * append runs at a time. Concurrent client requests during
 * an append receive `writer_busy` and retry (with jittered
 * backoff) on the client side.
 */

import * as path from "node:path";

import { LEDGER_FILENAME } from "../evidence/jsonl-ledger.js";
import { appendCommittedLineToFile } from "../evidence/ledger-internals.js";
import {
  buildCanonicalUnsequenced,
  canonicalContentHash,
  serializePersistedRecord,
} from "./ledger-writer-canonicalize.js";
import {
  dedupLookup,
  dedupRecord,
  type DedupIndex,
} from "./ledger-writer-dedup.js";
import type { LedgerWriterInstanceId } from "./ledger-writer-types.js";
import {
  type LedgerWriterRequest,
  type LedgerWriterResponse,
  LEDGER_WRITER_PROTOCOL_VERSION,
} from "./ledger-writer-protocol.js";
import { persistIndex } from "./ledger-writer-persistence.js";

/**
 * Test-only fault-injection hook fired at the EXACT
 * boundary the crash-cut claim is asserted on:
 *
 *     appendCommittedLineToFile() == durable success
 *             ↓
 *       CRASH POINT
 *             ↓
 *     persist optional sidecar
 *             ↓
 *     send ACK
 *
 * B0-CORR02 §5 + B0-CORR04 §26: the hook MUST fire after
 * fsync and before any sidecar write or client ACK.
 * Returning `crash` triggers an abrupt process exit so the
 * test can prove the cut is at the asserted boundary, not
 * at a later point.
 *
 * Production code MUST NOT set this. The child main never
 * sets it.
 */
export type CrashCutHook = {
  readonly onCommit: () => "continue" | "crash";
};

export type WriterState = {
  index: DedupIndex;
  busy: boolean;
  readonly crashCutHook: CrashCutHook | null;
  // B0-CORR03 §1..2: in-flight handler counter. The server
  // exposes a waitForInFlight() that observes this counter;
  // the lease is NOT released until it reaches zero.
  inFlight: number;
};

export type WriterServerArgs = {
  readonly runDir: string;
  readonly runId: string;
  readonly missionId: string;
  readonly socketPath: string;
  readonly instanceId: string;
};

export type WriterError =
  | { readonly kind: "invalid_envelope"; readonly reason: string }
  | { readonly kind: "conflicting_commit"; readonly message: string }
  | { readonly kind: "content_hash_mismatch"; readonly message: string }
  | { readonly kind: "append_failed"; readonly message: string }
  | { readonly kind: "writer_busy"; readonly message: string }
  | { readonly kind: "protocol_version_mismatch"; readonly observed: number }
  | { readonly kind: "malformed_message"; readonly reason: string };

/**
 * Handle a single parsed request. Returns a promise that
 * resolves once the reply has been enqueued for delivery.
 * Errors during the append path are surfaced via replyErr;
 * uncaught errors propagate to the caller (which destroys
 * the connection).
 */
export async function handleRequest(
  req: LedgerWriterRequest,
  args: WriterServerArgs,
  state: WriterState,
  reply: (r: LedgerWriterResponse) => Promise<void>,
  replyErr: (e: WriterError) => Promise<void>,
): Promise<void> {
  if (req.kind === "ping") {
    await reply({
      kind: "pong",
      protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
      instanceId: args.instanceId as LedgerWriterInstanceId,
      maxSequence: state.index.maxSequence,
    });
    return;
  }
  if (req.kind === "who_are_you") {
    await reply({
      kind: "self",
      protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
      instanceId: args.instanceId as LedgerWriterInstanceId,
      socketPath: args.socketPath,
      runId: args.runId,
      missionId: args.missionId,
      startedAt: Date.now(),
      maxSequence: state.index.maxSequence,
    });
    return;
  }

  // ----- append -----
  if (state.busy) {
    await replyErr({
      kind: "writer_busy",
      message: "writer is busy with another append",
    });
    return;
  }
  state.busy = true;
  try {
    const canonical = buildCanonicalUnsequenced({
      runId: args.runId,
      missionId: args.missionId,
      event: req.event,
    });
    const contentHash = canonicalContentHash({
      runId: args.runId,
      missionId: args.missionId,
      event: req.event,
    });

    if (contentHash !== req.clientContentHash) {
      await replyErr({
        kind: "content_hash_mismatch",
        message: `clientContentHash does not match writer-computed contentHash`,
      });
      return;
    }

    const lookup = dedupLookup(state.index, {
      commitId: req.commitId,
      contentHash,
    });
    if (lookup.kind === "replay") {
      await reply({
        kind: "replay",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
        commitId: req.commitId,
        sequence: lookup.sequence,
        contentHash,
      });
      return;
    }
    if (lookup.kind === "conflict") {
      await replyErr({
        kind: "conflicting_commit",
        message:
          `commitId ${req.commitId} is bound to sequence ` +
          `${lookup.existingSequence} with a different contentHash`,
      });
      return;
    }

    const nextSeq = state.index.maxSequence + 1;
    const line = serializePersistedRecord({
      canonical,
      sequence: nextSeq,
      commitId: req.commitId,
      contentHash,
    });

    const io = await appendCommittedLineToFile(
      path.join(args.runDir, LEDGER_FILENAME),
      line,
    );
    if (!io.ok) {
      await replyErr({ kind: "append_failed", message: io.error.message });
      return;
    }

    // B0-CORR02 §5: the crash-cut seam. The ledger is
    // fsync'd; everything past this point — including the
    // sidecar and the ACK — is unsafe under crash. A test
    // hook may abort the process here to prove that no
    // commitId mapping can resurrect from the sidecar if
    // the sidecar is lost (the sidecar is a cache; the
    // ledger is authoritative).
    if (state.crashCutHook !== null) {
      const verdict = state.crashCutHook.onCommit();
      if (verdict === "crash") {
        // B0-CORR04 §26: process.exit(137) is an
        // `abrupt_exit_cut`, NOT a real SIGKILL. Node's
        // process.exit() triggers 'exit' listeners and
        // exits synchronously with the given code; SIGKILL
        // cannot have a listener and unconditionally
        // terminates the process. For the test harness this
        // is sufficient to prove that no commitId mapping
        // can resurrect from the sidecar (the sidecar is a
        // cache; the ledger is authoritative).
        //
        // A strict SIGKILL-equivalent cut is documented in
        // B0-CORR04 §27 and is exercised on unrestricted
        // POSIX hosts separately. The current cut proves
        // the persistence boundary, not signal semantics.
        process.exit(137);
      }
    }

    const newIndex = dedupRecord(state.index, {
      commitId: req.commitId,
      contentHash,
      sequence: nextSeq,
    });
    await persistIndex(args.runDir, newIndex);
    state.index = newIndex;

    await reply({
      kind: "appended",
      protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
      commitId: req.commitId,
      sequence: nextSeq,
      contentHash,
    });
  } finally {
    state.busy = false;
  }
}
