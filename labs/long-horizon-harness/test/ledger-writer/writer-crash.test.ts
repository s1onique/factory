/**
 * Phase B0 — LedgerWriter CRASH RECOVERY tests (B0-CORR01).
 *
 * Exercises the dangerous cut the previous design failed to
 * prove: ledger fsync succeeded, sidecar fsync did NOT, writer
 * crashes. The new design MUST survive this cut via the
 * derived-index law (B0-C01-04): the ledger is the source of
 * truth; the sidecar is a cache that the next writer rebuilds
 * by scanning events.jsonl.
 *
 * The crucial test is LW-CRASH01: after a successful append,
 * delete ledger-writer-state.json entirely, restart the
 * writer, retry the same commitId. The retry MUST return the
 * original sequence and MUST NOT duplicate the line on disk.
 *
 * Sandbox gate: spawn-required tests skip with
 * BLOCKED_BY_ENVIRONMENT on hosts where spawned Node
 * children cannot bind a UDS.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { LEDGER_FILENAME } from "../../src/evidence/jsonl-ledger.js";
import {
  startWriterInTmpDir,
  type WriterHandle,
} from "./_writer_helper.js";
import { LEDGER_WRITER_STATE_FILENAME } from "../../src/ledger-writer/ledger-writer-process.js";
import type { WriterEvent } from "../../src/ledger-writer/ledger-writer-protocol.js";
import type { CommitId } from "../../src/ledger-writer/ledger-writer-types.js";

/**
 * Same sandbox probe as the live tests.
 */
async function detectSpawnableBind(): Promise<boolean> {
  const probe = path.join(process.cwd(), ".lw-probe-crash");
  await fs.mkdir(probe, { recursive: true, mode: 0o700 }).catch(() => undefined);
  try {
    const sock = path.join(probe, "s");
    await fs.rm(sock, { force: true }).catch(() => undefined);
    const { spawn } = await import("node:child_process");
    const childScript =
      `const net = require("node:net");` +
      `const s = net.createServer();` +
      `s.on("error", () => process.exit(2));` +
      `s.listen(${JSON.stringify(sock)}, () => process.exit(0));`;
    const c = spawn(process.execPath, ["-e", childScript], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    c.stderr?.resume();
    const exitPromise = new Promise<number | null>((resolve) => {
      c.on("exit", (code) => resolve(code));
      c.on("error", () => resolve(null));
    });
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 1500);
    });
    const result = await Promise.race([exitPromise, timeoutPromise]);
    if (result === "timeout") {
      try { c.kill("SIGKILL"); } catch { /* */ }
      return false;
    }
    try { c.kill("SIGKILL"); } catch { /* */ }
    return result === 0;
  } finally {
    try {
      await fs.rm(probe, { recursive: true, force: true });
    } catch { /* */ }
  }
}

const spawnable: boolean = await detectSpawnableBind();

function mkTmp(): Promise<string> {
  const base = path.join(process.cwd(), ".lw");
  return fs.mkdir(base, { recursive: true }).then(async () => {
    for (let i = 0; i < 100; i++) {
      const id = Math.random().toString(36).slice(2, 10);
      const p = path.join(base, id);
      try {
        await fs.mkdir(p, { mode: 0o700 });
        return p;
      } catch {
        // try again
      }
    }
    throw new Error("could not allocate tmp runDir");
  });
}

function makeEvent(seq: number, attemptId: string): WriterEvent {
  return {
    kind: "lifecycle",
    eventId: `evt-crash-${seq}`,
    observedAt: Date.parse("2026-08-31T00:00:00.000Z"),
    event: { type: "attempt_started", attempt_id: attemptId },
  };
}

let tmpDir: string | undefined;
let handle: WriterHandle | undefined;

before(async () => {
  if (!spawnable) return;
  tmpDir = await mkTmp();
  handle = await startWriterInTmpDir(tmpDir);
});

after(async () => {
  if (handle !== undefined) {
    try { await handle.stop(); } catch { /* */ }
  }
  if (tmpDir !== undefined) {
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  }
});

function live(name: string, body: () => Promise<void>): void {
  test(name, async (t) => {
    if (!spawnable) {
      t.skip("BLOCKED_BY_ENVIRONMENT: spawned Node child cannot bind UDS on this host");
      return;
    }
    await body();
  });
}

live("LW-CRASH01 crash after ledger fsync, sidecar deleted → retry returns original seq", async () => {
  // 1. Submit a fresh append.
  const commitId = "lwcrash01";
  const event = makeEvent(1, "attempt-crash01");
  const r1 = await handle!.append({ commitId, event });
  if (!r1.ok) {
    throw new Error(`initial append failed: ${JSON.stringify(r1)}`);
  }
  const originalSeq = r1.value.sequence;
  assert.equal(originalSeq, 1);

  // 2. Verify the sidecar exists.
  const sidecarPath = path.join(tmpDir!, LEDGER_WRITER_STATE_FILENAME);
  const sidecarBefore = await fs.readFile(sidecarPath, "utf8");
  assert.ok(sidecarBefore.length > 0);

  // 3. Delete the sidecar entirely. This simulates the
  //    crash-after-ledger-fsync-before-sidecar-fsync cut.
  await fs.rm(sidecarPath, { force: true });

  // 4. Kill the writer (without graceful shutdown) and start
  //    a fresh one. The fresh writer MUST reconstruct the
  //    dedup index from the ledger (B0-C01-04).
  await handle!.stop();
  const fresh = await startWriterInTmpDir(tmpDir!);
  try {
    // 5. Retry the SAME commitId. The writer MUST return the
    //    original sequence (replay) and MUST NOT append a new
    //    line.
    const r2 = await fresh.append({ commitId, event });
    if (!r2.ok) {
      throw new Error(`retry append failed: ${JSON.stringify(r2)}`);
    }
    assert.equal(r2.value.sequence, originalSeq, "retry must return original seq");
    assert.equal(r2.value.committed, "replay");

    // 6. Confirm the ledger has exactly one line for this
    //    commitId (no duplicate).
    const ledgerRaw = await fs.readFile(
      path.join(tmpDir!, LEDGER_FILENAME),
      "utf8",
    );
    let count = 0;
    for (const line of ledgerRaw.split("\n")) {
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { commit_id?: unknown }).commit_id === commitId
      ) {
        count++;
      }
    }
    assert.equal(count, 1, "duplicate line on disk after retry");
  } finally {
    await fresh.stop();
  }
});

test("LW-CRASH_PURE01 rebuildIndexFromLedger does not require the sidecar", async () => {
  // Pure test (no spawn): build a temporary ledger with
  // commitIds in the writer's v2+commit_id+content_hash
  // format, delete the sidecar, and verify the recovery
  // helper produces a complete dedup index from the ledger
  // alone.
  const { rebuildIndexFromLedger } = await import(
    "../../src/ledger-writer/ledger-writer-recovery.js"
  );
  const { serializePersistedRecord, buildCanonicalUnsequenced } = await import(
    "../../src/ledger-writer/ledger-writer-canonicalize.js"
  );
  const { createHash } = await import("node:crypto");

  const runDir = path.join(process.cwd(), ".lw-crashpure-" + Date.now());
  await fs.mkdir(runDir, { recursive: true, mode: 0o700 });

  try {
    const lines: string[] = [];
    for (let seq = 1; seq <= 3; seq++) {
      const event = {
        kind: "lifecycle" as const,
        eventId: `evt-${seq}`,
        observedAt: Date.parse("2026-08-31T00:00:00.000Z"),
        event: { type: "run_created" as const },
      };
      const canonical = buildCanonicalUnsequenced({
        runId: "r",
        missionId: "m",
        event,
      });
      const contentHash = createHash("sha256")
        .update(JSON.stringify(canonical))
        .digest("hex");
      lines.push(
        serializePersistedRecord({
          canonical,
          sequence: seq,
          commitId: `cid-${seq}` as CommitId,
          contentHash,
        }),
      );
    }
    await fs.writeFile(path.join(runDir, LEDGER_FILENAME), lines.join(""));

    const r = await rebuildIndexFromLedger(runDir);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.index.maxSequence, 3);
    assert.ok(r.index.byCommitId["cid-1"]);
    assert.ok(r.index.byCommitId["cid-2"]);
    assert.ok(r.index.byCommitId["cid-3"]);
  } finally {
    try { await fs.rm(runDir, { recursive: true, force: true }); } catch { /* */ }
  }
});
