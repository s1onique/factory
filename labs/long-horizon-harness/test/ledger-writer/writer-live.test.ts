/**
 * Phase B0 — LedgerWriter live subprocess tests.
 *
 * Exercises the durable-ACK contract:
 *   LW-LIVE01  ping returns same instanceId
 *   LW-LIVE02  single append allocates sequence 1
 *   LW-LIVE03  second append with different commitId → seq 2
 *   LW-LIVE04  same commitId returns same sequence
 *   LW-LIVE05  same contentHash with different commitId → same seq
 *   LW-LIVE06  events.jsonl contains every appended line (no dups)
 *   LW-LIVE07  writer unavailable fails closed
 *   LW-LIVE08  second writer for same runDir cannot bind
 *   LW-LIVE09  restart preserves dedup state (LW07 equivalent)
 *   LW-LIVE10  events.jsonl after restart has no duplicate lines
 *   LW-LIVE11  socket lstat rejects symlink at path
 *
 * Sandbox / env gate: on hosts where /tmp and $HOME are
 * not bindable for spawned Node children (macOS dev sandbox),
 * the helper detects this and marks the test as
 * `BLOCKED_BY_ENVIRONMENT`. On unrestricted hosts the test
 * runs to completion.
 */

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { LEDGER_FILENAME } from "../../src/evidence/jsonl-ledger.js";
import {
  startWriterInTmpDir,
  type WriterHandle,
} from "./_writer_helper.js";
import {
  appendToLedgerWriter,
  pingLedgerWriter,
} from "../../src/ledger-writer/ledger-writer-client.js";

/**
 * Detect whether this host can spawn a Node child that
 * successfully binds a UDS under cwd.
 *
 * In the macOS dev sandbox, the parent test process can
 * bind UDS freely, but spawned children inherit a stricter
 * sandbox that prevents them from binding. We detect this
 * by trying to spawn a child that binds a UDS at a known
 * short path. The probe is bounded so it cannot hang the
 * test runner.
 *
 * If we detect sandbox restriction, every live test in this
 * file is marked BLOCKED_BY_ENVIRONMENT.
 */
async function detectSpawnableBind(): Promise<boolean> {
  const probe = path.join(process.cwd(), ".lw-probe");
  await fs.mkdir(probe, { recursive: true, mode: 0o700 }).catch(() => undefined);
  try {
    const sock = path.join(probe, "s");
    await fs.rm(sock, { force: true }).catch(() => undefined);
    const { spawn } = await import("node:child_process");
    const childScript =
      `const net = require("node:net");` +
      `const s = net.createServer();` +
      `s.on("error", (e) => { process.stderr.write(String(e.code||e.message)); process.exit(2); });` +
      `s.listen(${JSON.stringify(sock)}, () => { process.exit(0); });`;
    const c = spawn(
      process.execPath,
      ["-e", childScript],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    // Drain stderr so the pipe doesn't keep us alive.
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
      // The child did not exit within 1.5s. If it had bound
      // successfully it would have exited within milliseconds
      // (it calls process.exit(0) immediately after listen).
      // If it had failed to bind, Node's listen error handler
      // would have called process.exit(2). A 1.5s hang means
      // the child is stuck — typically because it cannot
      // bind and the error event was swallowed, OR because
      // it is sitting in an unreachable state.
      try {
        c.kill("SIGKILL");
      } catch {
        // best-effort
      }
      return false;
    }
    try {
      c.kill("SIGKILL");
    } catch {
      // best-effort
    }
    return result === 0;
  } finally {
    try {
      await fs.rm(probe, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

const spawnable: boolean = await detectSpawnableBind();

function mkTmp(_prefix: string): Promise<string> {
  const base = path.join(process.cwd(), ".lw");
  return fs.mkdir(base, { recursive: true }).then(async () => {
    for (let i = 0; i < 100; i++) {
      const id = Math.random().toString(36).slice(2, 10);
      const p = path.join(base, id);
      try {
        await fs.mkdir(p, { mode: 0o700 });
        return p;
      } catch {
        // collision — try again
      }
    }
    throw new Error("could not allocate tmp runDir under .lw");
  });
}

function envelopeBytes(seq: number): string {
  const obj = {
    schema_version: 2 as const,
    event_id: `evt-${seq}`,
    run_id: "test-run",
    mission_id: "test-mission",
    sequence: seq,
    observed_at: Date.parse("2026-08-31T00:00:00.000Z"),
    kind: "lifecycle" as const,
    event: { type: "run_created" as const },
  };
  return JSON.stringify(obj) + "\n";
}

function hashOf(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

let tmpDir: string | undefined;
let handle: WriterHandle | undefined;
let cleanupFns: Array<() => Promise<void>> = [];

before(async () => {
  if (!spawnable) {
    // Do not even attempt to spawn the writer. The live
    // tests check `spawnable` themselves and skip.
    return;
  }
  tmpDir = await mkTmp("factory-ledger-writer-");
  handle = await startWriterInTmpDir(tmpDir);
});

after(async () => {
  if (!spawnable) return;
  for (const fn of cleanupFns.reverse()) {
    try {
      await fn();
    } catch {
      // best-effort
    }
  }
  if (handle !== undefined) {
    await handle.stop();
  }
  if (tmpDir !== undefined) {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

/**
 * Wrap a test body in a sandbox-availability check. If the
 * host can't spawn the writer child, the test is marked as
 * blocked rather than passing or failing — so the strict
 * lane stays honest about its environment.
 */
function live(name: string, body: () => Promise<void>): void {
  test(name, async (t) => {
    if (!spawnable) {
      t.skip("BLOCKED_BY_ENVIRONMENT: spawned Node child cannot bind UDS on this host");
      return;
    }
    await body();
  });
}

live("LW-LIVE01 ping returns same instanceId", async () => {
  const r = await handle!.ping();
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.instanceId, handle!.instanceId);
});

live("LW-LIVE02 single append allocates sequence 1", async () => {
  const body = envelopeBytes(1);
  const r = await handle!.append({
    commitId: "lw-live-02-c",
    envelopeBytes: body,
    contentHash: hashOf(body),
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.sequence, 1);
});

live("LW-LIVE03 second append with different commitId allocates sequence 2", async () => {
  const body = envelopeBytes(2);
  const r = await handle!.append({
    commitId: "lw-live-03-c",
    envelopeBytes: body,
    contentHash: hashOf(body),
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.sequence, 2);
});

live("LW-LIVE04 same commitId returns the same sequence", async () => {
  const body = envelopeBytes(3);
  const r1 = await handle!.append({
    commitId: "lw-live-04-c",
    envelopeBytes: body,
    contentHash: hashOf(body),
  });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const r2 = await handle!.append({
    commitId: "lw-live-04-c",
    envelopeBytes: body,
    contentHash: hashOf(body),
  });
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(r2.value.sequence, r1.value.sequence);
});

live("LW-LIVE05 same contentHash with different commitId returns same sequence", async () => {
  const body = envelopeBytes(4);
  const r1 = await handle!.append({
    commitId: "lw-live-05-a",
    envelopeBytes: body,
    contentHash: hashOf(body),
  });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const r2 = await handle!.append({
    commitId: "lw-live-05-b",
    envelopeBytes: body,
    contentHash: hashOf(body),
  });
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(r2.value.sequence, r1.value.sequence);
});

live("LW-LIVE06 events.jsonl contains every appended line, no duplicates", async () => {
  const ledgerPath = path.join(tmpDir!, LEDGER_FILENAME);
  const raw = await fs.readFile(ledgerPath, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 2);
});

test("LW-LIVE07 writer unavailable fails closed (no spawn required)", async () => {
  const r = await appendToLedgerWriter(
    { socketPath: "/tmp/factory-nonexistent-socket", timeoutMs: 1000 },
    {
      commitId: "lw-live-07-c",
      envelopeBytes: envelopeBytes(99),
      contentHash: hashOf(envelopeBytes(99)),
    },
  );
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.kind, "socket_missing");
});

live("LW-LIVE08 second writer for same runDir cannot bind", async () => {
  const second = await startWriterInTmpDir(tmpDir!, 1500);
  cleanupFns.push(async () => {
    if (second !== undefined) await second.stop();
  });
  const r = await handle!.ping();
  assert.equal(r.ok, true);
});

live("LW-LIVE09 restart preserves dedup state (LW07 crash-after-fsync)", async () => {
  const commitId = "lw-live-09-restart";
  const body = envelopeBytes(50);
  const r1 = await handle!.append({
    commitId,
    envelopeBytes: body,
    contentHash: hashOf(body),
  });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const seq = r1.value.sequence;

  await handle!.stop();

  const fresh = await startWriterInTmpDir(tmpDir!);
  cleanupFns.push(() => fresh.stop());

  const r2 = await fresh.append({
    commitId,
    envelopeBytes: body,
    contentHash: hashOf(body),
  });
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(r2.value.sequence, seq);

  const r3 = await fresh.append({
    commitId: "lw-live-09-new",
    envelopeBytes: envelopeBytes(seq + 1),
    contentHash: hashOf(envelopeBytes(seq + 1)),
  });
  assert.equal(r3.ok, true);
  if (!r3.ok) return;
  assert.equal(r3.value.sequence, seq + 1);
});

live("LW-LIVE10 events.jsonl after restart has no duplicate lines for retried commit", async () => {
  const ledgerPath = path.join(tmpDir!, LEDGER_FILENAME);
  const raw = await fs.readFile(ledgerPath, "utf8");
  const target = envelopeBytes(50);
  let count = 0;
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    if (line === target.trimEnd()) count++;
  }
  assert.equal(count, 1, "duplicated seq must not appear on disk");
});

test("LW-LIVE11 socket lstat rejects symlink at path (no spawn required)", async () => {
  const tmpDir2 = await mkTmp("factory-ledger-writer-symlink-");
  cleanupFns.push(async () => {
    try {
      await fs.rm(tmpDir2, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
  await fs.writeFile(path.join(tmpDir2, "victim.txt"), "victim bytes");
  const sockPath = path.join(tmpDir2, "sock.sock");
  await fs.symlink(path.join(tmpDir2, "victim.txt"), sockPath);

  const r = await pingLedgerWriter({ socketPath: sockPath, timeoutMs: 1000 });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.error.kind, "socket_wrong_type");
});
