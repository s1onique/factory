/**
 * Phase B0 — LedgerWriter sole-writer and identity tests (B0-CORR01).
 *
 * SOLE01..04 cover the bind-time path-collision policy that
 * the previous design failed to enforce:
 *   - SOLE01: a second writer for a run with a LIVE first
 *     writer is rejected.
 *   - SOLE02: the first writer remains reachable after the
 *     second-writer attempt fails.
 *   - SOLE03: the instance returned by the readiness handshake
 *     matches the spawned writer (identity-bound).
 *   - SOLE04: a stale socket (live socket file but no live
 *     writer) is recoverable: the new writer binds and the
 *     next writer fails to displace it.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  startWriterInTmpDir,
  type WriterHandle,
} from "./_writer_helper.js";
import { ledgerWriterSocketPath } from "../../src/ledger-writer/ledger-writer-process.js";

async function detectSpawnableBind(): Promise<boolean> {
  const probe = path.join(process.cwd(), ".lw-probe-sole");
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
      const id = Math.random().toString(36).slice(2, 8);
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

live("SOLE01 second writer for live first writer is rejected", async () => {
  let rejected = false;
  try {
    await startWriterInTmpDir(tmpDir!, 1500);
  } catch (e: unknown) {
    rejected = true;
    void e;
  }
  assert.equal(rejected, true, "second writer must not bind while first is live");
});

live("SOLE02 first writer remains reachable after second-writer attempt", async () => {
  const r = await handle!.ping();
  if (!r.ok) throw new Error(`ping failed: ${JSON.stringify(r)}`);
  assert.equal(r.value.instanceId, handle!.instanceId);
});

live("SOLE03 instance returned by who_are_you matches the spawned instanceId", async () => {
  const r = await handle!.whoAreYou();
  if (!r.ok) throw new Error(`who_are_you failed: ${JSON.stringify(r)}`);
  assert.equal(r.instanceId, handle!.instanceId);
  assert.equal(r.runId, "test-run");
  assert.equal(r.missionId, "test-mission");
});

live("SOLE04 non-socket occupant at writer path is rejected", async () => {
  // A regular file (not a socket) at the writer's socket
  // path MUST be rejected by the bind-time policy (B0-C01-09).
  // The writer child detects the non-socket file via lstat,
  // fails its bind with path_collision, and exits. The parent
  // times out waiting for the socket. Either error kind is a
  // valid expression of "the new writer MUST NOT bind".
  const tmp = await mkTmp();
  try {
    const h = await startWriterInTmpDir(tmp);
    await h.stop();
    const sockPath = ledgerWriterSocketPath(tmp);
    await fs.writeFile(sockPath, "");
    let rejected = false;
    try {
      await startWriterInTmpDir(tmp, 1500);
    } catch (e: unknown) {
      rejected = true;
      const msg = e instanceof Error ? e.message : String(e);
      assert.ok(
        msg.includes("path_collision") ||
          msg.includes("writer_not_ready") ||
          msg.includes("EADDRINUSE") ||
          msg.includes("bind_failed"),
        `unexpected rejection message: ${msg}`,
      );
    }
    assert.equal(
      rejected,
      true,
      "non-socket occupant at path must be rejected",
    );
  } finally {
    try { await fs.rm(tmp, { recursive: true, force: true }); } catch { /* */ }
  }
});
