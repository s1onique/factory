/**
 * FOUNDATION04 — B0-CORR01 — canonical envelope builder.
 *
 * The LedgerWriter is the SOLE authority on the sequence
 * number (B0-C01-01). To prove that to the client
 * (B0-C01-02: disk sequence == writer ACK sequence), and to
 * enable client-side tamper detection, both sides must agree
 * on the canonical unsequenced envelope shape that is hashed.
 *
 * The persisted envelope shape matches what
 * `encodeEnvelope` / `encodeProcessEvidenceEnvelope` /
 * `encodeWitnessEvidenceEnvelope` produce after the writer
 * stamps `sequence`. JSON.stringify preserves insertion
 * order in V8 / SpiderMonkey / JavaScriptCore, so the same
 * object graph produces the same byte string before and
 * after stamping sequence. This guarantees B0-C01-02.
 *
 * The hash domain EXCLUDES `sequence` (writer owns it) and
 * EXCLUDES `commitId` (commitId is a dedup key, not part of
 * the evidence content).
 *
 * Persistence contract (B0-C01-03): the writer's persisted
 * record on disk carries `commit_id` and `content_hash`
 * alongside the existing v2 envelope fields. Existing
 * schema-version-2 decoders (which ignore unknown fields)
 * keep working unchanged; the writer has its own decoder
 * that recognises the extra fields.
 */

import { createHash } from "node:crypto";
import type { WriterEvent } from "./ledger-writer-protocol.js";
import type { CommitId } from "./ledger-writer-types.js";

/**
 * The canonical unsequenced envelope shape used both by the
 * client (to compute clientContentHash before submission)
 * and by the writer (to verify the client's claim and to
 * derive the persisted shape).
 */
export type CanonicalUnsequencedEnvelope =
  | {
      readonly schema_version: 2;
      readonly event_id: string;
      readonly run_id: string;
      readonly mission_id: string;
      readonly observed_at: number;
      readonly kind: "lifecycle";
      readonly event: unknown;
    }
  | {
      readonly schema_version: 2;
      readonly event_id: string;
      readonly run_id: string;
      readonly mission_id: string;
      readonly observed_at: number;
      readonly kind: "process_evidence";
      readonly process_evidence: unknown;
    }
  | {
      readonly schema_version: 2;
      readonly event_id: string;
      readonly run_id: string;
      readonly mission_id: string;
      readonly observed_at: number;
      readonly kind: "witness_evidence";
      readonly witness_evidence: unknown;
    };

/**
 * Build the canonical unsequenced envelope from a wire event
 * plus run / mission identity. JSON-stable: any two callers
 * producing the same input MUST produce the same byte string
 * and therefore the same sha256 hash. Property order in the
 * literal matches `encodeEnvelope` family output so the
 * serialized byte string is stable.
 */
export function buildCanonicalUnsequenced(args: {
  readonly runId: string;
  readonly missionId: string;
  readonly event: WriterEvent;
}): CanonicalUnsequencedEnvelope {
  switch (args.event.kind) {
    case "lifecycle":
      return {
        schema_version: 2,
        event_id: args.event.eventId,
        run_id: args.runId,
        mission_id: args.missionId,
        observed_at: args.event.observedAt,
        kind: "lifecycle",
        event: args.event.event,
      };
    case "process_evidence":
      return {
        schema_version: 2,
        event_id: args.event.eventId,
        run_id: args.runId,
        mission_id: args.missionId,
        observed_at: args.event.observedAt,
        kind: "process_evidence",
        process_evidence: args.event.payload,
      };
    case "witness_evidence":
      return {
        schema_version: 2,
        event_id: args.event.eventId,
        run_id: args.runId,
        mission_id: args.missionId,
        observed_at: args.event.observedAt,
        kind: "witness_evidence",
        witness_evidence: args.event.payload,
      };
  }
}

/**
 * SHA-256 of the canonical unsequenced envelope bytes.
 * Excludes `sequence` and `commitId`.
 */
export function canonicalContentHash(args: {
  readonly runId: string;
  readonly missionId: string;
  readonly event: WriterEvent;
}): string {
  const env = buildCanonicalUnsequenced(args);
  const bytes = Buffer.from(JSON.stringify(env), "utf8");
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The on-disk persisted record the LedgerWriter writes to
 * events.jsonl. This is the schema_version 2 envelope shape
 * (unchanged) plus `commit_id` and `content_hash` at the
 * top level. The two new fields are advisory for existing
 * v2 decoders: they ignore unknown top-level fields, so the
 * existing lifecycle replay reducer continues to work.
 *
 * The writer's own replay function (see
 * `ledger-writer-recovery.ts`) consumes these fields as the
 * authoritative source of commitId → (sequence, contentHash)
 * — B0-C01-03.
 */
export type PersistedCommittedRecord = CanonicalUnsequencedEnvelope & {
  readonly sequence: number;
  readonly commit_id: string;
  readonly content_hash: string;
};

/**
 * Serialize a committed record for persistence. Returns the
 * newline-terminated UTF-8 line that the writer appends to
 * events.jsonl. Property order matches the existing
 * `encodeEnvelope` family output, with `sequence` slotted in
 * after `mission_id` and `commit_id` / `content_hash` added
 * at the end.
 */
export function serializePersistedRecord(args: {
  readonly canonical: CanonicalUnsequencedEnvelope;
  readonly sequence: number;
  readonly commitId: CommitId;
  readonly contentHash: string;
}): string {
  let rec: Record<string, unknown>;
  if (args.canonical.kind === "lifecycle") {
    rec = {
      schema_version: args.canonical.schema_version,
      event_id: args.canonical.event_id,
      run_id: args.canonical.run_id,
      mission_id: args.canonical.mission_id,
      sequence: args.sequence,
      observed_at: args.canonical.observed_at,
      kind: "lifecycle",
      event: args.canonical.event,
    };
  } else if (args.canonical.kind === "process_evidence") {
    rec = {
      schema_version: args.canonical.schema_version,
      event_id: args.canonical.event_id,
      run_id: args.canonical.run_id,
      mission_id: args.canonical.mission_id,
      sequence: args.sequence,
      observed_at: args.canonical.observed_at,
      kind: "process_evidence",
      process_evidence: args.canonical.process_evidence,
    };
  } else {
    rec = {
      schema_version: args.canonical.schema_version,
      event_id: args.canonical.event_id,
      run_id: args.canonical.run_id,
      mission_id: args.canonical.mission_id,
      sequence: args.sequence,
      observed_at: args.canonical.observed_at,
      kind: "witness_evidence",
      witness_evidence: args.canonical.witness_evidence,
    };
  }
  rec["commit_id"] = args.commitId;
  rec["content_hash"] = args.contentHash;
  return JSON.stringify(rec) + "\n";
}

/**
 * Parse a single persisted line back into its fields. The
 * result is the raw object plus the parsed commitId /
 * contentHash. We deliberately do NOT validate the inner
 * event payload here — that's the existing codec's job. The
 * writer only needs sequence, commitId, contentHash for
 * rebuildIndexFromLedger.
 */
export type ParsedPersistedLine =
  | { readonly ok: true; readonly sequence: number; readonly commitId: CommitId; readonly contentHash: string; readonly line: string }
  | { readonly ok: false; readonly reason: string };

export function parsePersistedLine(line: string): ParsedPersistedLine {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (e: unknown) {
    return {
      ok: false,
      reason: `malformed JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "not an object" };
  }
  const o = raw as Record<string, unknown>;
  const seq = o["sequence"];
  const cid = o["commit_id"];
  const ch = o["content_hash"];
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
    return { ok: false, reason: "sequence missing or invalid" };
  }
  if (typeof cid !== "string" || cid.length === 0) {
    return { ok: false, reason: "commit_id missing or invalid" };
  }
  if (typeof ch !== "string" || ch.length === 0) {
    return { ok: false, reason: "content_hash missing or invalid" };
  }
  return {
    ok: true,
    sequence: seq,
    commitId: cid as CommitId,
    contentHash: ch,
    line,
  };
}
