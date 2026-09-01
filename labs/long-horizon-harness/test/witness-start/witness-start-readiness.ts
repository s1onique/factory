/**
 * FOUNDATION04 — `awaitWitnessReady`.
 *
 * Deterministic readiness barrier for live tests.
 *
 * Doctrine (readiness-evidence law):
 *   Process creation is not readiness. A witness is
 *   ready only when its identity-bound readiness fact
 *   is durably committed in the LedgerWriter's
 *   authoritative history.
 *
 * Race outcomes (priority order):
 *   - ready
 *       (durable witness_ready verified against the
 *        FULL expected identity AND the child is
 *        still alive at observation time)
 *   - ready_but_child_exited
 *       (durable witness_ready verified against the
 *        full identity BUT the child has already
 *        exited by the time the ledger snapshot was
 *        taken; the authority is gone)
 *   - evidence_invalid
 *       (a line in events.jsonl failed authoritative
 *        decoding; we fail closed, never ignore)
 *   - child_exited_before_ready
 *       (child exit observed before the ledger shows
 *        a matching witness_ready)
 *   - ready_timeout
 *       (deadline elapsed; no exit; no readiness)
 *
 * Race order is ledger-FIRST, child-SECOND. A durable
 * witness_ready for the expected identity proves
 * capability existed; if the authority has since
 * exited, that is a stronger failure (the readiness
 * was real but the witness is gone).
 *
 * Decoder fidelity (CORRECTION03):
 *   Durable bytes crossing back from storage into the
 *   domain are validated by the AUTHORITATIVE decoders,
 *   never by handwritten checks and never by trusting
 *   that a writer validated them at some point in the
 *   past. The envelope goes through FOUNDATION01's
 *   `decodeEnvelopeFromJsonLine`
 *   (`src/evidence/ledger-internals.js`), which validates
 *   schema_version, sequence, observed_at and every
 *   branded identifier, and which dispatches the
 *   `witness_evidence` payload to the authoritative
 *   `decodePersistedWitnessEvidence`. There are no `as`
 *   assertions at this trust boundary and no parallel
 *   validator.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { decodeEnvelopeFromJsonLine } from "../../src/evidence/ledger-internals.js";
import type { EventEnvelope } from "../../src/evidence/codec-types.js";
import type { WitnessSpawnHandle } from "../../src/witness-start/witness-start-types.js";

export type ExpectedBinding = {
  readonly runId: string;
  readonly missionId: string;
  readonly witnessId: string;
  readonly witnessInstanceId: string;
  readonly socketPath: string;
};

export type AwaitWitnessReadyArgs = {
  readonly runDir: string;
  readonly expected: ExpectedBinding;
  readonly child: WitnessSpawnHandle;
  readonly deadlineMs?: number;
  readonly pollIntervalMs?: number;
};

export type AwaitWitnessReadyResult =
  | { readonly kind: "ready"; readonly observedAt: number; readonly sequence: number }
  | {
      readonly kind: "ready_but_child_exited";
      readonly exit: { readonly code: number | null; readonly signal: NodeJS.Signals | null };
      readonly observedAt: number;
      readonly sequence: number;
    }
  | {
      readonly kind: "evidence_invalid";
      readonly reason: string;
      readonly lineNumber: number;
    }
  | {
      readonly kind: "child_exited_before_ready";
      readonly exit: { readonly code: number | null; readonly signal: NodeJS.Signals | null };
      readonly stdoutSeen: number;
      readonly stderrSeen: number;
      readonly stdoutBytes: Uint8Array;
      readonly stderrBytes: Uint8Array;
      readonly stdoutTruncated: boolean;
      readonly stderrTruncated: boolean;
    }
  | { readonly kind: "ready_timeout" };

/**
 * Decode a single events.jsonl line through the
 * authoritative pipeline:
 *
 *   durable bytes
 *     → decodeEnvelopeFromJsonLine (FOUNDATION01
 *       authoritative envelope decoder: schema_version,
 *       sequence, observed_at, branded identifiers)
 *     → kind === "witness_evidence"
 *     → decodePersistedWitnessEvidence (authoritative
 *       witness-evidence decoder, invoked BY the envelope
 *       decoder)
 *
 * No handwritten envelope checks; no `as` casts. A
 * malformed durable envelope is `evidence_invalid`, even
 * if its witness payload happens to be well-formed.
 */
function decodeLine(
  raw: string,
):
  | {
      readonly ok: true;
      readonly envelope: Extract<EventEnvelope, { readonly kind: "witness_evidence" }>;
    }
  | { readonly ok: false; readonly reason: string } {
  // A non-witness_evidence envelope is not an error: the
  // ledger legitimately interleaves lifecycle and
  // process_evidence records. We must distinguish "not for
  // us" from "invalid", so peek at the discriminator with a
  // parse that carries no authority.
  let peeked: unknown;
  try {
    peeked = JSON.parse(raw);
  } catch (e: unknown) {
    return {
      ok: false,
      reason: "malformed JSON: " + (e instanceof Error ? e.message : String(e)),
    };
  }
  if (typeof peeked !== "object" || peeked === null) {
    return { ok: false, reason: "envelope is not an object" };
  }
  if ((peeked as Record<string, unknown>)["kind"] !== "witness_evidence") {
    return { ok: false, reason: "not_witness_evidence" };
  }
  // Authoritative decode. This is the trust boundary.
  const envR = decodeEnvelopeFromJsonLine(raw);
  if (envR.ok === false) {
    return { ok: false, reason: envR.error.reason };
  }
  const env = envR.value;
  if (!(env.schema_version === 2 && env.kind === "witness_evidence")) {
    return {
      ok: false,
      reason: "authoritative decode did not yield a witness_evidence envelope",
    };
  }
  return { ok: true, envelope: env };
}

export async function awaitWitnessReady(
  args: AwaitWitnessReadyArgs,
): Promise<AwaitWitnessReadyResult> {
  const deadline = Date.now() + (args.deadlineMs ?? 5000);
  const interval = args.pollIntervalMs ?? 50;
  const eventsPath = path.join(args.runDir, "events.jsonl");
  let lastLineNumber = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 1) Ledger-FIRST. The capability proof is the
    //    durable record; check the authoritative
    //    events.jsonl first.
    let raw: string;
    try {
      raw = await fs.readFile(eventsPath, "utf8");
    } catch {
      raw = "";
    }
    if (raw.length > 0) {
      const lines = raw.split("\n");
      for (let i = lastLineNumber; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === undefined || line.length === 0) continue;
        lastLineNumber = i + 1;
        const decoded = decodeLine(line);
        if (decoded.ok === false) {
          if (decoded.reason === "not_witness_evidence") continue;
          return {
            kind: "evidence_invalid",
            reason: decoded.reason,
            lineNumber: i,
          };
        }
        const env = decoded.envelope;
        const payload = env.witness_evidence;
        if (payload.kind !== "witness_ready") continue;
        const e = args.expected;
        const matches =
          env.run_id === e.runId &&
          env.mission_id === e.missionId &&
          payload.witness_id === e.witnessId &&
          payload.witness_instance_id === e.witnessInstanceId &&
          payload.socket_path === e.socketPath;
        if (!matches) {
          return {
            kind: "evidence_invalid",
            reason: "witness_ready identity does not match expected binding " +
              "(runId/missionId/witnessId/witnessInstanceId/socketPath)",
            lineNumber: i,
          };
        }
        // 2) Child-SECOND. The durable record proves
        //    capability existed. Verify the authority
        //    is still alive at observation time.
        const exit = args.child.exitInfo();
        if (exit.exited) {
          return {
            kind: "ready_but_child_exited",
            exit: { code: exit.code, signal: exit.signal },
            observedAt: env.observed_at,
            sequence: env.sequence,
          };
        }
        return {
          kind: "ready",
          observedAt: env.observed_at,
          sequence: env.sequence,
        };
      }
    }

    // 3) Child-exit-before-ready. The child died without
    //    leaving a matching durable record. Surface a
    //    typed diagnostic with the bounded bootstrap
    //    output.
    const exit = args.child.exitInfo();
    if (exit.exited) {
      const out = args.child.bootstrapOutput();
      return {
        kind: "child_exited_before_ready",
        exit: { code: exit.code, signal: exit.signal },
        stdoutSeen: out.stdoutBytesSeen,
        stderrSeen: out.stderrBytesSeen,
        stdoutBytes: out.stdout,
        stderrBytes: out.stderr,
        stdoutTruncated: out.stdoutTruncated,
        stderrTruncated: out.stderrTruncated,
      };
    }

    if (Date.now() >= deadline) {
      return { kind: "ready_timeout" };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
