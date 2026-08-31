/**
 * FOUNDATION04 — B0-CORR02 — LedgerWriter client append layer.
 *
 * Composes the low-level transport with the writer's
 * single-flight append semantics:
 *
 *   - send ONE logical RPC.
 *   - accept "appended" OR "replay" as successful durable
 *     outcomes (B0-CORR02 §7: single-RPC replay).
 *   - on "writer_busy", retry with linear backoff + jitter
 *     up to 256 attempts.
 *
 * Extracted from `ledger-writer-client.ts` to keep the
 * public client module under the 400-LOC source-size
 * discipline (FOUNDATION03 §29).
 */

import {
  type LedgerWriterClientError,
  type LedgerWriterClientOptions,
  type LedgerWriterClientResult,
  sendLedgerWriterRequest,
} from "./ledger-writer-client-transport.js";
import {
  LEDGER_WRITER_PROTOCOL_VERSION,
  type LedgerWriterRequest,
  type WriterEvent,
} from "./ledger-writer-protocol.js";

export type LedgerWriterAppendError =
  | LedgerWriterClientError
  | { readonly kind: "writer_busy"; readonly message: string }
  | { readonly kind: "writer_busy_retries_exhausted"; readonly message: string };

export type LedgerWriterAppendResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly sequence: number;
        readonly commitId: string;
        readonly contentHash: string;
        readonly committed: "appended" | "replay";
      };
    }
  | { readonly ok: false; readonly error: LedgerWriterAppendError };

const MAX_BUSY_RETRIES = 256;

/**
 * One logical append invocation = at most ONE wire
 * request (B0-CORR02 §7).
 *
 * The wire response is either "appended" (a fresh
 * sequence was allocated and persisted) or "replay" (the
 * commitId was already on disk with matching contentHash;
 * we return the original sequence). Both carry the durable
 * (sequence, contentHash) for the commitId. The caller
 * sees them as equivalent durability: the commitId IS
 * committed at that sequence.
 */
export async function appendToLedgerWriter(
  opts: LedgerWriterClientOptions,
  args: {
    readonly commitId: string;
    readonly clientContentHash: string;
    readonly event: WriterEvent;
  },
): Promise<LedgerWriterAppendResult> {
  const request: LedgerWriterRequest = {
    kind: "append",
    protocolVersion: LEDGER_WRITER_PROTOCOL_VERSION,
    commitId: args.commitId as LedgerWriterRequest extends { kind: "append"; commitId: infer C } ? C : never,
    clientContentHash: args.clientContentHash,
    event: args.event,
  };
  for (let attempt = 0; attempt < MAX_BUSY_RETRIES; attempt++) {
    const r = await sendOneAppend(opts, request);
    if (r.ok) return r;
    if (r.error.kind === "writer_busy") {
      if (attempt < MAX_BUSY_RETRIES - 1) {
        const baseMs = (attempt + 1) * 5;
        const jitter = Math.floor(Math.random() * baseMs);
        await new Promise((res) => setTimeout(res, jitter));
        continue;
      }
      return {
        ok: false,
        error: {
          kind: "writer_busy_retries_exhausted",
          message: `writer stayed busy for ${MAX_BUSY_RETRIES} attempts`,
        },
      };
    }
    return r;
  }
  return {
    ok: false,
    error: {
      kind: "writer_busy_retries_exhausted",
      message: "writer_busy retries exhausted (no attempt succeeded)",
    },
  };
}

async function sendOneAppend(
  opts: LedgerWriterClientOptions,
  request: LedgerWriterRequest,
): Promise<
  | LedgerWriterClientResult<{
      readonly sequence: number;
      readonly commitId: string;
      readonly contentHash: string;
      readonly committed: "appended" | "replay";
    }>
  | { readonly ok: false; readonly error: { readonly kind: "writer_busy"; readonly message: string } }
> {
  // B0-CORR02 §7: ONE logical append = ONE wire request.
  // The transport returns the raw response; we dispatch on
  // its `kind` discriminator. This avoids a second RPC
  // when the writer replies "replay" or "error" — both of
  // which are valid one-RPC outcomes.
  const r = await sendLedgerWriterRequest(opts, request);
  if (!r.ok) return r;
  const resp = r.value;
  switch (resp.kind) {
    case "appended":
      return {
        ok: true,
        value: {
          sequence: resp.sequence,
          commitId: resp.commitId,
          contentHash: resp.contentHash,
          committed: "appended",
        },
      };
    case "replay":
      return {
        ok: true,
        value: {
          sequence: resp.sequence,
          commitId: resp.commitId,
          contentHash: resp.contentHash,
          committed: "replay",
        },
      };
    case "error": {
      const inner = resp.error;
      if (
        typeof inner === "object" &&
        inner !== null &&
        (inner as { kind?: unknown }).kind === "writer_busy"
      ) {
        return {
          ok: false,
          error: {
            kind: "writer_busy",
            message:
              typeof (inner as { message?: unknown }).message === "string"
                ? (inner as { message: string }).message
                : "writer busy",
          },
        };
      }
      return {
        ok: false,
        error: { kind: "protocol_error", error: inner },
      };
    }
    case "pong":
    case "self":
      // The writer replied with the wrong kind. The single-
      // RPC contract is preserved — the response was
      // returned on the same request, no second wire
      // operation. We surface the unexpected kind as a
      // typed error so the caller can diagnose.
      return {
        ok: false,
        error: {
          kind: "protocol_error",
          error: { kind: "unexpected_response_kind", got: resp.kind },
        },
      };
  }
}
