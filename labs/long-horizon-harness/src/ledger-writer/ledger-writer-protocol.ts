/**
 * FOUNDATION04 — CORRECTION01 — LedgerWriter wire protocol.
 *
 * The wire format mirrors the witness protocol: framed JSON
 * with bounded length prefix. Both directions use the same
 * framing (the witness-server framing bug fix is applied
 * here from the start: the server MUST encodeFrame on
 * reply).
 *
 * Messages are deliberately small. The envelope bytes are
 * passed through opaquely — the writer does NOT validate the
 * full envelope schema; it trusts the client. The writer's
 * job is sequencing and durability, not envelope validation.
 *
 * If the envelope is malformed enough to fail the existing
 * ledger decoder on append, the writer returns an
 * `invalid_envelope` error to the client.
 */

import type { CommitId, LedgerWriterInstanceId } from "./ledger-writer-types.js";

export const LEDGER_WRITER_PROTOCOL_VERSION = 1 as const;

/**
 * Client → writer messages.
 */
export type LedgerWriterRequest =
  | {
      readonly kind: "append";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
      readonly commitId: CommitId;
      readonly envelopeBytes: string;
      readonly contentHash: string;
    }
  | {
      readonly kind: "ping";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
    }
  | {
      readonly kind: "who_are_you";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
    };

/**
 * Writer → client responses.
 */
export type LedgerWriterResponse =
  | {
      readonly kind: "appended";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
      readonly commitId: CommitId;
      readonly sequence: number;
    }
  | {
      readonly kind: "error";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
      readonly error:
        | { readonly kind: "invalid_envelope"; readonly reason: string }
        | { readonly kind: "append_failed"; readonly message: string }
        | { readonly kind: "writer_busy"; readonly message: string }
        | { readonly kind: "protocol_version_mismatch"; readonly observed: number }
        | { readonly kind: "malformed_message"; readonly reason: string };
    }
  | {
      readonly kind: "pong";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
      readonly instanceId: LedgerWriterInstanceId;
      readonly maxSequence: number;
    }
  | {
      readonly kind: "self";
      readonly protocolVersion: typeof LEDGER_WRITER_PROTOCOL_VERSION;
      readonly instanceId: LedgerWriterInstanceId;
      readonly socketPath: string;
      readonly runId: string;
      readonly missionId: string;
      readonly startedAt: number;
      readonly maxSequence: number;
    };

/**
 * Wire-format constants. Both request and response frames
 * share the same shape: 4-byte big-endian length prefix
 * followed by UTF-8 JSON. The framing is implemented in
 * ../witness/witness-codec-framing.ts and reused here.
 */
export const MAX_LEDGER_WRITER_FRAME_BYTES = 1024 * 1024;

export function parseLedgerWriterRequest(
  raw: unknown,
):
  | { readonly ok: true; readonly request: LedgerWriterRequest }
  | { readonly ok: false; readonly reason: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "request must be an object" };
  }
  const o = raw as Record<string, unknown>;
  if (o["protocolVersion"] !== LEDGER_WRITER_PROTOCOL_VERSION) {
    return {
      ok: false,
      reason: `unsupported protocol version ${String(o["protocolVersion"])}`,
    };
  }
  const kind = o["kind"];
  if (kind === "append") {
    if (typeof o["commitId"] !== "string") {
      return { ok: false, reason: "append.commitId must be a string" };
    }
    if (typeof o["envelopeBytes"] !== "string") {
      return { ok: false, reason: "append.envelopeBytes must be a string" };
    }
    if (typeof o["contentHash"] !== "string") {
      return { ok: false, reason: "append.contentHash must be a string" };
    }
    return {
      ok: true,
      request: {
        kind: "append",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
        commitId: o["commitId"] as CommitId,
        envelopeBytes: o["envelopeBytes"] as string,
        contentHash: o["contentHash"] as string,
      },
    };
  }
  if (kind === "ping") {
    return {
      ok: true,
      request: {
        kind: "ping",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
      },
    };
  }
  if (kind === "who_are_you") {
    return {
      ok: true,
      request: {
        kind: "who_are_you",
        protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
      },
    };
  }
  return { ok: false, reason: `unknown request kind ${String(kind)}` };
}
