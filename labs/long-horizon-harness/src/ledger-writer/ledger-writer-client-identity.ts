/**
 * FOUNDATION04 — B0-CORR02 — LedgerWriter client identity helpers.
 *
 * Wraps the low-level transport for the two identity-only
 * RPCs: ping and who_are_you. These do NOT touch the
 * append path.
 */

import {
  type LedgerWriterClientError,
  type LedgerWriterClientOptions,
  type LedgerWriterClientResult,
  sendLedgerWriterRequestOfKind,
} from "./ledger-writer-client-transport.js";
import { LEDGER_WRITER_PROTOCOL_VERSION } from "./ledger-writer-protocol.js";

export type WhoAreYouClientResult =
  | {
      readonly ok: true;
      readonly instanceId: string;
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

export type PingClientResult =
  | {
      readonly ok: true;
      readonly value: { readonly instanceId: string; readonly maxSequence: number };
    }
  | { readonly ok: false; readonly error: LedgerWriterClientError };

/**
 * pingLedgerWriter — round-trip liveness probe with
 * instanceId + maxSequence. Useful for supervisor health
 * checks.
 */
export async function pingLedgerWriter(
  opts: LedgerWriterClientOptions,
): Promise<PingClientResult> {
  const r = await sendLedgerWriterRequestOfKind(
    opts,
    { kind: "ping", protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION },
    "pong",
  );
  if (!r.ok) return r;
  return {
    ok: true,
    value: {
      instanceId: r.value.instanceId,
      maxSequence: r.value.maxSequence,
    },
  };
}

/**
 * whoAreYouLedgerWriter — identity probe.
 *
 * Returns the writer's instanceId + runId + missionId +
 * startedAt + maxSequence on a successful handshake, or a
 * typed failure otherwise. Used by:
 *   - startLedgerWriter() to verify a freshly-bound writer
 *     matches the expected instanceId/runId/missionId.
 *   - Stale-socket recovery probes (B0-CORR02 §4).
 *   - Tests that exercise the identity handshake.
 */
export async function whoAreYouLedgerWriter(
  opts: LedgerWriterClientOptions,
): Promise<WhoAreYouClientResult> {
  const r = await sendLedgerWriterRequestOfKind(
    opts,
    { kind: "who_are_you", protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION },
    "self",
  );
  if (!r.ok) {
    if (r.error.kind === "connect_failed") {
      return {
        ok: false,
        error: { kind: "no_response", message: r.error.message },
      };
    }
    if (r.error.kind === "frame_decode_failed") {
      return {
        ok: false,
        error: { kind: "protocol_error", message: r.error.reason },
      };
    }
    return {
      ok: false,
      error: { kind: "protocol_error", message: r.error.kind },
    };
  }
  return {
    ok: true,
    instanceId: r.value.instanceId,
    runId: r.value.runId,
    missionId: r.value.missionId,
    socketPath: r.value.socketPath,
    startedAt: r.value.startedAt,
    maxSequence: r.value.maxSequence,
  };
}

// Re-export the transport-level types so consumers of this
// module can use the same error shape.
export type { LedgerWriterClientError, LedgerWriterClientResult };
