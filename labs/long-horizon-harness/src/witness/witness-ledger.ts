/**
 * FOUNDATION04 — witness evidence ledger appender.
 *
 * Reuses the existing JsonlLedger durability guarantees by
 * computing the next sequence from the authoritative file and
 * writing a witness_evidence envelope via the existing
 * `appendCommittedLineToFile` fsync helper.
 *
 * This module does NOT write a second JSONL file. It only adds
 * witness_evidence envelopes to the existing events.jsonl (F04-D84).
 *
 * The JsonlLedger class itself is frozen at FOUNDATION03 §29; we
 * cannot modify its internals. We CAN call its exported fsync
 * helper directly because that helper is the existing
 * durability primitive.
 */

import { promises as fs } from "node:fs";
import { LEDGER_FILENAME } from "../evidence/jsonl-ledger.js";
import { appendCommittedLineToFile } from "../evidence/ledger-internals.js";
import { encodeWitnessEvidenceEnvelope } from "../evidence/codec-encode.js";
import { decodeJsonText } from "./witness-codec-decode.js";
import type { EventId, MissionId, RunId } from "../domain/ids.js";
import type { PersistedWitnessEvidence } from "./witness-types-persisted.js";

export type WitnessLedgerError =
  | { readonly kind: "read_failed"; readonly message: string }
  | { readonly kind: "decode_failed"; readonly reason: string }
  | { readonly kind: "append_failed"; readonly message: string };

export type WitnessLedgerResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WitnessLedgerError };

/**
 * Append a witness-evidence record to the run's events.jsonl.
 *
 * The witness MUST be a separate process from the supervisor
 * (F04-D20). Concurrent appends from supervisor + witness
 * contend on the same file; F04-D33/D48 require the witness to
 * observe the durability ACK before invoking any kernel action.
 *
 * In practice the witness is the SOLE writer during its own
 * bootstrap phases; the supervisor appends only between phases.
 * The ledger's per-process mutex is not visible to the witness
 * process — that is why this helper reads-then-appends under a
 * single fsync. The supervisor is responsible for not racing the
 * witness during bootstrap (F04-D33: start_requested durability
 * before spawn; F04-D34: ready durability before activate).
 */
export async function appendWitnessEvidence(args: {
  readonly runDir: string;
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly eventId: EventId;
  readonly observedAt: number;
  readonly payload: PersistedWitnessEvidence;
}): Promise<WitnessLedgerResult<{ readonly seq: number }>> {
  const filePath = args.runDir + "/" + LEDGER_FILENAME;
  let nextSeq = 1;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    // Extract just the sequence number from each envelope without
    // doing full validation. We trust the previously-committed
    // envelopes to be well-formed (the ledger has its own torn-
    // tail recovery); we only need to know the next sequence
    // number for our append.
    let maxSeq = 0;
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = decodeJsonText(line);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      const seq = (parsed as { sequence?: unknown }).sequence;
      if (typeof seq === "number" && Number.isInteger(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
    nextSeq = maxSeq + 1;
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code !== "ENOENT") {
      return {
        ok: false,
        error: { kind: "read_failed", message: e instanceof Error ? e.message : String(e) },
      };
    }
  }
  const envelope = encodeWitnessEvidenceEnvelope({
    eventId: args.eventId,
    runId: args.runId,
    missionId: args.missionId,
    seq: nextSeq,
    observedAt: args.observedAt,
    payload: args.payload,
  });
  const line = JSON.stringify(envelope) + "\n";
  const r = await appendCommittedLineToFile(filePath, line);
  if (r.ok === false) {
    return {
      ok: false,
      error: { kind: "append_failed", message: r.error.message },
    };
  }
  return { ok: true, value: { seq: nextSeq } };
}
