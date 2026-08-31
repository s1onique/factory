/**
 * FOUNDATION04 — B0-CORR02 — LedgerWriter authoritative recovery.
 *
 * Reconstructs two distinct projections of the durable ledger:
 *
 *   1. maxSequence — the SEQUENCE HIGH-WATER MARK. Derived
 *      from EVERY valid historical envelope, regardless of
 *      schema version. A legacy FOUNDATION01/02/03 record
 *      such as `{sequence: 17, ...}` advances this number
 *      even if it does not carry commit_id / content_hash.
 *
 *   2. byCommitId — the SEMANTIC DEDUP PROJECTION. Only
 *      B0+ envelopes that carry a valid commit_id +
 *      content_hash contribute. Legacy envelopes do NOT
 *      contribute entries, but they do NOT corrupt this
 *      projection either; they simply are absent from it.
 *
 * Doctrine (B0-CORR02 §1):
 *
 *   "The authoritative ledger's sequence high-water mark
 *    and the dedup index are different projections. Legacy
 *    records contribute to maxSequence even though they
 *    cannot contribute to commitId → ..."
 *
 * Doctrine (B0-CORR02 §2):
 *
 *   We do NOT introduce a separate ledger-validation policy.
 *   We reuse `readAndValidate()` from the FOUNDATION01
 *   evidence layer. That helper enforces:
 *
 *     - each line must decode to a valid EventEnvelope;
 *     - sequence must be strictly increasing by 1 (no gaps,
 *       no duplicates) — interior corruption → fail closed;
 *     - the file must end in '\n' (torn tail is reported as
 *       an invalid_evidence error, NOT silently skipped).
 *
 *   The LedgerWriter inherits those rules wholesale. A
 *   torn-tail suffix cannot advance maxSequence and cannot
 *   contribute commitId entries; the writer's start path
 *   fails closed if the ledger has interior damage or a torn
 *   tail. The supervisor / operator is expected to recover
 *   the ledger through the existing FOUNDATION01 torn-tail
 *   workflow BEFORE the writer can start.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { LEDGER_FILENAME } from "../evidence/jsonl-ledger.js";
import { type LedgerError } from "../evidence/ledger-read-validate.js";
import type { CommitId, DedupEntry } from "./ledger-writer-types.js";

/**
 * The recovered authoritative state. Two independent
 * projections of the same durable history.
 */
export type RecoveredLedgerWriterState = {
  readonly maxSequence: number;
  readonly byCommitId: Readonly<Record<string, DedupEntry>>;
};

export type RecoverLedgerWriterStateResult =
  | { readonly ok: true; readonly state: RecoveredLedgerWriterState; readonly scannedLines: number }
  | { readonly ok: false; readonly error: LedgerError };

/**
 * Decode the B0+ commitId / contentHash side-channel from a
 * persisted envelope's raw line.
 *
 * B0 introduces the side-channel: every persisted record
 * carries `commit_id` and `content_hash` as sibling fields.
 * The decoder is silent on missing fields — it returns
 * `hasCommitMapping: false` for legacy / mid-era records
 * and `hasCommitMapping: true` for B0 records.
 *
 * The decoder does NOT trust the schema_version field: an
 * attacker (or a writer bug) could stamp
 * `schema_version: 2` on a non-B0 envelope. We therefore
 * require the side-channel fields to actually exist and to
 * satisfy the commitId grammar + a 64-char sha256-like hex
 * contentHash. Anything else is treated as "no commit
 * mapping".
 */
function decodeB0SideChannel(
  o: Record<string, unknown>,
):
  | { readonly hasCommitMapping: true; readonly commitId: CommitId; readonly contentHash: string }
  | { readonly hasCommitMapping: false } {
  const cid = o["commit_id"];
  const ch = o["content_hash"];
  if (typeof cid !== "string" || cid.length === 0) {
    return { hasCommitMapping: false };
  }
  if (typeof ch !== "string" || ch.length === 0) {
    return { hasCommitMapping: false };
  }
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(cid)) {
    // The commitId grammar is the same identifier grammar
    // the rest of the lab uses. A legacy envelope cannot
    // accidentally match — the field simply did not exist
    // before B0.
    return { hasCommitMapping: false };
  }
  if (!/^[0-9a-f]{64}$/.test(ch)) {
    // sha256 hex; legacy envelopes never carry this.
    return { hasCommitMapping: false };
  }
  return {
    hasCommitMapping: true,
    commitId: cid as CommitId,
    contentHash: ch,
  };
}

/**
 * Recover the LedgerWriter's authoritative startup state
 * directly from the durable ledger.
 *
 * B0-CORR03 §7..10 — single-snapshot recovery. The
 * `maxSequence` projection and the `byCommitId` projection
 * MUST be derived from the same validated byte snapshot.
 *
 * We read the ledger ONCE into memory and derive both
 * projections from this single in-memory buffer. This
 * avoids the B0-CORR02 two-snapshot seam where concurrent
 * mutation between two `fs.readFile` calls could disagree
 * the projections.
 *
 * Mirroring FOUNDATION01's `readAndValidate` semantics:
 *   - each line must be a JSON object;
 *   - sequence must be strictly increasing by 1;
 *   - the file must end in '\n' (no torn tail).
 *
 * We do NOT call the existing JsonlLedger codec here
 * (readAndValidate) because it does not surface the raw
 * lines alongside the typed envelope — and we explicitly
 * need the raw text for the B0 side-channel projection.
 * The semantic checks (sequence contiguity, JSON parse,
 * torn-tail detection) are duplicated here as a single-
 * snapshot pass.
 *
 * B0-CORR03 §10: parse anomalies in authoritative recovered
 * history are `invalid_evidence`, not omissions.
 *
 * Doctrine (B0-CORR03):
 *
 *   "For one recovery invocation, maxSequence projection
 *    and byCommitId projection MUST refer to exactly the
 *    same durable byte snapshot."
 *
 * Failure modes:
 *   - internal_failure: file unreadable, IO error other than
 *     ENOENT.
 *   - invalid_evidence: interior corruption, sequence
 *     topology violation, or torn-tail suffix. The writer
 *     refuses to start; the operator must repair the ledger
 *     via the FOUNDATION01 recovery path first.
 *
 * On ENOENT (no ledger yet), returns `{ maxSequence: 0,
 * byCommitId: {} }`.
 */
export async function recoverLedgerWriterState(
  runDir: string,
): Promise<RecoverLedgerWriterStateResult> {
  const ledgerPath = path.join(runDir, LEDGER_FILENAME);

  // Single read of the authoritative history. We read the
  // file once into memory and derive BOTH projections from
  // this single in-memory buffer (B0-CORR03 §7).
  let raw: string;
  try {
    raw = await fs.readFile(ledgerPath, "utf8");
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") {
      return {
        ok: true,
        state: { maxSequence: 0, byCommitId: {} },
        scannedLines: 0,
      };
    }
    return {
      ok: false,
      error: {
        kind: "internal_failure",
        message:
          e instanceof Error ? e.message : String(e),
      },
    };
  }

  // Torn-tail detection (mirrors readAndValidate).
  if (raw.length > 0 && !raw.endsWith("\n")) {
    return {
      ok: false,
      error: {
        kind: "invalid_evidence",
        reason:
          "Ledger ends with a non-empty unterminated suffix; open must be called to recover.",
      },
    };
  }

  // Single-snapshot projection pass. We walk the lines
  // ONCE; for each line we either fail closed (B0-CORR03
  // §10: parse anomalies are `invalid_evidence`, not
  // omissions) or we extract both the sequence and the B0
  // side-channel from the SAME line.
  const byCommitId: Record<string, DedupEntry> = {};
  let maxSequence = 0;
  let scannedLines = 0;
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined || line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e: unknown) {
      return {
        ok: false,
        error: {
          kind: "invalid_evidence",
          reason: `malformed JSON at line ${i + 1}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        },
      };
    }
    if (typeof parsed !== "object" || parsed === null) {
      return {
        ok: false,
        error: {
          kind: "invalid_evidence",
          reason: `non-object record at line ${i + 1}`,
        },
      };
    }
    const o = parsed as Record<string, unknown>;
    const seqRaw = o["sequence"];
    if (
      typeof seqRaw !== "number" ||
      !Number.isInteger(seqRaw) ||
      seqRaw < 1
    ) {
      return {
        ok: false,
        error: {
          kind: "invalid_evidence",
          reason: `invalid sequence at line ${i + 1}: ${String(seqRaw)}`,
        },
      };
    }
    const seq = seqRaw;
    const expectedSeq = scannedLines + 1;
    if (seq !== expectedSeq) {
      return {
        ok: false,
        error: {
          kind: "invalid_evidence",
          reason:
            `Sequence gap at line ${i + 1}: got ${seq}, expected ${expectedSeq}.`,
        },
      };
    }
    scannedLines++;
    maxSequence = seq;

    // B0 side-channel contribution. The side-channel is
    // B0+; legacy lines (FOUNDATION01/02/03) contribute
    // only to maxSequence.
    const side = decodeB0SideChannel(o);
    if (side.hasCommitMapping) {
      const key = side.commitId as unknown as string;
      const existing = byCommitId[key];
      if (existing === undefined || seq > existing.sequence) {
        byCommitId[key] = {
          sequence: seq,
          contentHash: side.contentHash,
        };
      }
    }
  }

  return {
    ok: true,
    state: { maxSequence, byCommitId },
    scannedLines,
  };
}

/**
 * Backwards-compatibility alias. The previous
 * `rebuildIndexFromLedger` returned a DedupIndex; the new
 * shape is `RecoveredLedgerWriterState`. The two are
 * structurally compatible (DedupIndex === { maxSequence,
 * byCommitId }) so existing call sites work unchanged.
 *
 * @deprecated Use {@link recoverLedgerWriterState} directly.
 */
export async function rebuildIndexFromLedger(
  runDir: string,
): Promise<
  | {
      readonly ok: true;
      readonly index: {
        readonly byCommitId: Readonly<Record<string, DedupEntry>>;
        readonly maxSequence: number;
      };
      readonly scannedLines: number;
      readonly parsedLines: number;
    }
  | { readonly ok: false; readonly error: { readonly kind: "io_error"; readonly message: string } }
> {
  const r = await recoverLedgerWriterState(runDir);
  if (r.ok === false) {
    return {
      ok: false,
      error: {
        kind: "io_error",
        message:
          r.error.kind === "invalid_evidence"
            ? `invalid_evidence: ${r.error.reason}`
            : `internal_failure: ${r.error.message}`,
      },
    };
  }
  return {
    ok: true,
    index: r.state,
    scannedLines: r.scannedLines,
    parsedLines: r.scannedLines,
  };
}
