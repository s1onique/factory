/**
 * FOUNDATION04 — B0-CORR02 — Recovery projection tests.
 *
 * RECSEQ01..04 + RECLEDGER01..05 (B0-CORR02 §1 + §2):
 *   - Every valid historical envelope advances
 *     maxSequence, regardless of schema_version.
 *   - Only B0 envelopes with commit_id + content_hash
 *     contribute to byCommitId.
 *   - Reused readAndValidate: torn tails and interior
 *     corruption fail closed.
 *
 * CACHE01..08 (B0-CORR02 §3):
 *   - Sidecar is byte-equivalent to the authoritative
 *     index, or absent, or discarded.
 *   - Phantom entries in the sidecar do NOT replay.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { LEDGER_FILENAME } from "../../src/evidence/jsonl-ledger.js";
import { recoverLedgerWriterState } from "../../src/ledger-writer/ledger-writer-recovery.js";
import {
  buildIndexFromRecords,
} from "../../src/ledger-writer/ledger-writer-dedup.js";
import { verifySidecarMatch } from "../../src/ledger-writer/ledger-writer-persistence.js";
import { LEDGER_WRITER_STATE_FILENAME } from "../../src/ledger-writer/ledger-writer-process.js";

function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(process.cwd(), ".lw-recovery-"));
}

async function rmTmp(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function legacyLine(seq: number, eventType: string): string {
  return (
    JSON.stringify({
      schema_version: 1,
      event_id: `evt-${seq}`,
      run_id: "r",
      mission_id: "m",
      sequence: seq,
      observed_at: 0,
      event: { type: eventType },
    }) + "\n"
  );
}

function b0Line(seq: number, commitId: string, contentHash: string): string {
  return (
    JSON.stringify({
      schema_version: 2,
      event_id: `evt-${seq}`,
      run_id: "r",
      mission_id: "m",
      sequence: seq,
      observed_at: 0,
      kind: "lifecycle",
      event: { type: "run_created" },
      commit_id: commitId,
      content_hash: contentHash,
    }) + "\n"
  );
}

test("RECSEQ01 legacy-only ledger seq 1..10 → maxSequence=10, byCommitId={}", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    for (let i = 1; i <= 10; i++) {
      ledger += legacyLine(i, "run_created");
    }
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.state.maxSequence, 10);
    assert.deepEqual(r.state.byCommitId, {});
  } finally {
    await rmTmp(tmp);
  }
});

test("RECSEQ02 legacy seq 1..10 + B0 seq 11..12 → maxSequence=12, only B0 mappings", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    for (let i = 1; i <= 10; i++) {
      ledger += legacyLine(i, "run_created");
    }
    ledger += b0Line(11, "cid-11", "a".repeat(64));
    ledger += b0Line(12, "cid-12", "b".repeat(64));
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.state.maxSequence, 12);
    assert.ok(r.state.byCommitId["cid-11"]);
    assert.equal(r.state.byCommitId["cid-11"]!.sequence, 11);
    assert.ok(r.state.byCommitId["cid-12"]);
    assert.equal(r.state.byCommitId["cid-12"]!.sequence, 12);
  } finally {
    await rmTmp(tmp);
  }
});

test("RECSEQ03 mixed lifecycle/process B0 → both contribute", async () => {
  const tmp = await mkTmp();
  try {
    const line1 =
      JSON.stringify({
        schema_version: 2,
        event_id: "evt-1",
        run_id: "r",
        mission_id: "m",
        sequence: 1,
        observed_at: 0,
        kind: "lifecycle",
        event: { type: "run_created" },
        commit_id: "cid-lc-1",
        content_hash: "a".repeat(64),
      }) + "\n";
    const line2 =
      JSON.stringify({
        schema_version: 2,
        event_id: "evt-2",
        run_id: "r",
        mission_id: "m",
        sequence: 2,
        observed_at: 0,
        kind: "process_evidence",
        process_evidence: {
          kind: "process_spawn_requested",
          attempt_id: "att-1",
          process_id: "pid-1",
        },
        commit_id: "cid-pe-1",
        content_hash: "b".repeat(64),
      }) + "\n";
    await fs.writeFile(
      path.join(tmp, LEDGER_FILENAME),
      line1 + line2,
    );
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.state.maxSequence, 2);
    assert.ok(r.state.byCommitId["cid-lc-1"]);
    assert.equal(r.state.byCommitId["cid-lc-1"]!.sequence, 1);
    assert.ok(r.state.byCommitId["cid-pe-1"]);
    assert.equal(r.state.byCommitId["cid-pe-1"]!.sequence, 2);
  } finally {
    await rmTmp(tmp);
  }
});

test("RECSEQ04 sequence gap rejected (readAndValidate semantics)", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    ledger += b0Line(1, "cid-1", "a".repeat(64));
    ledger += b0Line(2, "cid-2", "b".repeat(64));
    ledger += b0Line(4, "cid-4", "d".repeat(64));
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.kind, "invalid_evidence");
  } finally {
    await rmTmp(tmp);
  }
});

test("RECLEDGER01 valid ledger → recovers cleanly", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    for (let i = 1; i <= 5; i++) {
      ledger += b0Line(i, `cid-${i}`, "f".repeat(64));
    }
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
  } finally {
    await rmTmp(tmp);
  }
});

test("RECLEDGER02 torn tail (no terminating newline) → refuses to start", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = b0Line(1, "cid-1", "a".repeat(64));
    ledger += b0Line(2, "cid-2", "b".repeat(64));
    ledger += '{"schema_version":2,"sequence":3,"commit_id":"cid-3"';
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.kind, "invalid_evidence");
  } finally {
    await rmTmp(tmp);
  }
});

test("RECLEDGER03 malformed interior record → refuses to start", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = b0Line(1, "cid-1", "a".repeat(64));
    ledger += "{not json}\n";
    ledger += b0Line(3, "cid-3", "c".repeat(64));
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.kind, "invalid_evidence");
  } finally {
    await rmTmp(tmp);
  }
});

test("RECLEDGER04 duplicate sequence → refuses to start", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    ledger += b0Line(1, "cid-1", "a".repeat(64));
    ledger += b0Line(1, "cid-1-dup", "b".repeat(64));
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error.kind, "invalid_evidence");
  } finally {
    await rmTmp(tmp);
  }
});

test("RECLEDGER05 missing ledger (ENOENT) → empty state, ok", async () => {
  const tmp = await mkTmp();
  try {
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.state.maxSequence, 0);
    assert.deepEqual(r.state.byCommitId, {});
  } finally {
    await rmTmp(tmp);
  }
});

test("CACHE01 no sidecar → exact recovery", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    for (let i = 1; i <= 3; i++) {
      ledger += b0Line(i, `cid-${i}`, "f".repeat(64));
    }
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const match = await verifySidecarMatch(tmp, r.state);
    assert.equal(match.kind, "absent");
  } finally {
    await rmTmp(tmp);
  }
});

test("CACHE02 correct sidecar → equal to authoritative", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    for (let i = 1; i <= 3; i++) {
      ledger += b0Line(i, `cid-${i}`, "f".repeat(64));
    }
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    await fs.writeFile(
      path.join(tmp, LEDGER_WRITER_STATE_FILENAME),
      JSON.stringify({
        version: 2,
        byCommitId: r.state.byCommitId,
        maxSequence: r.state.maxSequence,
      }),
    );
    const match = await verifySidecarMatch(tmp, r.state);
    assert.equal(match.kind, "equal");
  } finally {
    await rmTmp(tmp);
  }
});

test("CACHE03 stale sidecar missing entry → ledger wins", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    for (let i = 1; i <= 3; i++) {
      ledger += b0Line(i, `cid-${i}`, "f".repeat(64));
    }
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const driftSidecar = {
      version: 2,
      byCommitId: {
        "cid-1": { sequence: 1, contentHash: "f".repeat(64) },
        "cid-2": { sequence: 2, contentHash: "f".repeat(64) },
      },
      maxSequence: 3,
    };
    await fs.writeFile(
      path.join(tmp, LEDGER_WRITER_STATE_FILENAME),
      JSON.stringify(driftSidecar),
    );
    const match = await verifySidecarMatch(tmp, r.state);
    assert.equal(match.kind, "drifted");
  } finally {
    await rmTmp(tmp);
  }
});

test("CACHE04 phantom sidecar entry seq<=ledgerMax → MUST NOT replay", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    for (let i = 1; i <= 10; i++) {
      ledger += legacyLine(i, "run_created");
    }
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const phantomSidecar = {
      version: 2,
      byCommitId: {
        "commit-X": { sequence: 7, contentHash: "f".repeat(64) },
      },
      maxSequence: 10,
    };
    await fs.writeFile(
      path.join(tmp, LEDGER_WRITER_STATE_FILENAME),
      JSON.stringify(phantomSidecar),
    );
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.state.maxSequence, 10);
    assert.equal(r.state.byCommitId["commit-X"], undefined);
    const fromRecords = buildIndexFromRecords(
      Object.entries(r.state.byCommitId).map(([commitId, e]) => ({
        sequence: e.sequence,
        commitId: commitId as never,
        contentHash: e.contentHash,
      })),
    );
    assert.equal(fromRecords.byCommitId["commit-X"], undefined);
  } finally {
    await rmTmp(tmp);
  }
});

test("CACHE05 sidecar changed contentHash → ledger wins", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    for (let i = 1; i <= 3; i++) {
      ledger += b0Line(i, `cid-${i}`, "f".repeat(64));
    }
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const wrongHash = "0".repeat(64);
    const driftSidecar = {
      version: 2,
      byCommitId: {
        "cid-1": { sequence: 1, contentHash: wrongHash },
        "cid-2": { sequence: 2, contentHash: wrongHash },
        "cid-3": { sequence: 3, contentHash: wrongHash },
      },
      maxSequence: 3,
    };
    await fs.writeFile(
      path.join(tmp, LEDGER_WRITER_STATE_FILENAME),
      JSON.stringify(driftSidecar),
    );
    const match = await verifySidecarMatch(tmp, r.state);
    assert.equal(match.kind, "drifted");
  } finally {
    await rmTmp(tmp);
  }
});

test("CACHE06 sidecar max > ledger max → ledger wins", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    for (let i = 1; i <= 3; i++) {
      ledger += b0Line(i, `cid-${i}`, "f".repeat(64));
    }
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const inflatedSidecar = {
      version: 2,
      byCommitId: {
        "cid-1": { sequence: 1, contentHash: "f".repeat(64) },
        "cid-2": { sequence: 2, contentHash: "f".repeat(64) },
        "cid-3": { sequence: 3, contentHash: "f".repeat(64) },
      },
      maxSequence: 99,
    };
    await fs.writeFile(
      path.join(tmp, LEDGER_WRITER_STATE_FILENAME),
      JSON.stringify(inflatedSidecar),
    );
    const match = await verifySidecarMatch(tmp, r.state);
    assert.equal(match.kind, "drifted");
  } finally {
    await rmTmp(tmp);
  }
});

test("CACHE07 corrupt sidecar → discarded, ledger wins", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    for (let i = 1; i <= 3; i++) {
      ledger += b0Line(i, `cid-${i}`, "f".repeat(64));
    }
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    await fs.writeFile(
      path.join(tmp, LEDGER_WRITER_STATE_FILENAME),
      "{not json}",
    );
    const r = await recoverLedgerWriterState(tmp);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const match = await verifySidecarMatch(tmp, r.state);
    assert.equal(match.kind, "drifted");
  } finally {
    await rmTmp(tmp);
  }
});

test("CACHE08 delete sidecar between runs → byte-equivalent semantics", async () => {
  const tmp = await mkTmp();
  try {
    let ledger = "";
    for (let i = 1; i <= 3; i++) {
      ledger += b0Line(i, `cid-${i}`, "f".repeat(64));
    }
    await fs.writeFile(path.join(tmp, LEDGER_FILENAME), ledger);
    const r1 = await recoverLedgerWriterState(tmp);
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    await fs.writeFile(
      path.join(tmp, LEDGER_WRITER_STATE_FILENAME),
      JSON.stringify({
        version: 2,
        byCommitId: r1.state.byCommitId,
        maxSequence: r1.state.maxSequence,
      }),
    );
    await fs.rm(path.join(tmp, LEDGER_WRITER_STATE_FILENAME));
    const r2 = await recoverLedgerWriterState(tmp);
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.deepEqual(r2.state.byCommitId, r1.state.byCommitId);
    assert.equal(r2.state.maxSequence, r1.state.maxSequence);
  } finally {
    await rmTmp(tmp);
  }
});
