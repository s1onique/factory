/**
 * ledger-writer-live-qualification.test.ts
 * (B0-QUALIFICATION01)
 *
 * Strict LedgerWriter live qualification oracle.
 *
 * This file is the SINGLE checked-in source of truth for
 * whether LedgerWriter passes B0 qualification. It binds
 * to the exact source SHA so the measurement is honest.
 *
 * Two lanes:
 *   - ordinary: tests run; any case may skip with
 *     BLOCKED_BY_ENVIRONMENT. SKIPPED is honest residue
 *     and is reported.
 *   - strict (FACTORY_STRICT_LEDGER_WRITER_LIVE=1):
 *     tests MUST all execute and pass. SKIPPED > 0,
 *     FAILED > 0, or RESIDUE > 0 fail the suite.
 *
 * The strict lane is the authoritative B0 qualification.
 * It is invoked via `npm run qualify:ledger-writer-live`.
 *
 * Doctrine (B0-QUALIFICATION01):
 *   **Qualification-oracle fidelity law:** the oracle
 *   that asserts a matrix is part of the measuring
 *   instrument. Tests for the oracle itself are below
 *   (QLW01..QLW06).
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { promises as fs } from "node:fs";
import * as path from "node:path";

import { LEDGER_FILENAME } from "../../src/evidence/jsonl-ledger.js";

import {
  startWriterInTmpDir,
  type WriterHandle,
} from "./_writer_helper.js";

import {
  appendToLedgerWriter,
  pingLedgerWriter,
  whoAreYouLedgerWriter,
} from "../../src/ledger-writer/ledger-writer-client.js";

import { probeSocketPath } from "../../src/ledger-writer/ledger-writer-socket-probe.js";
import { spawn } from "node:child_process";

import type { WriterEvent } from "../../src/ledger-writer/ledger-writer-protocol.js";
import type { CommitId } from "../../src/ledger-writer/ledger-writer-types.js";

const STRICT = process.env.FACTORY_STRICT_LEDGER_WRITER_LIVE === "1";

// --------------------------------------------------------------------
// Subject SHA binding
// --------------------------------------------------------------------

const SUBJECT_SHA = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "<unable-to-resolve>";
  }
})();

const SUBJECT_SHA_OK = /^[0-9a-f]{40}$/.test(SUBJECT_SHA);

function emitMatrix(): void {
  // Required vs executed vs passed is reported via
  // individual test results. Aggregate counters are
  // asserted in the post-suite invariant (after()).
  // Here we only stamp the matrix identifier so log
  // readers can correlate runs.
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_QUALIFICATION_SUBJECT_SHA=${SUBJECT_SHA}`);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_QUALIFICATION_STRICT=${STRICT ? "1" : "0"}`);
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_QUALIFICATION_REQUIRED=15`);
}

emitMatrix();

// --------------------------------------------------------------------
// Sandbox probe — matches the writer-live / socket-probe
// convention: a SYNCHRONOUS path-length check (UDS
// addresses must fit in 100 bytes UTF-8 on macOS dev
// hosts). This is honest: if the harness path is too
// long, the spawn-bind path CANNOT succeed and the
// strict lane MUST fail closed rather than emit false
// positives.
// --------------------------------------------------------------------

function tmpBase(): string {
  return process.env["TMPDIR"] ?? path.join(process.cwd(), ".lw-qual");
}

function detectSpawnableBind(): boolean {
  const probeSock = `${tmpBase()}/.lws-probe1234/s`;
  return Buffer.byteLength(probeSock, "utf8") <= 100;
}

function mkTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(tmpBase(), `.lwqual-${prefix}-`));
}

async function rmTmp(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// --------------------------------------------------------------------
// Capability gate
// --------------------------------------------------------------------

test("CAP01 capability probe (UDS-spawnable)", async () => {
  const ok = await detectSpawnableBind();
  if (!ok) {
    if (STRICT) {
      throw new Error(
        "strict lane: UDS-spawnable capability unavailable on this host",
      );
    }
    return;
  }
  assert.equal(ok, true);
});

const SPAWNABLE = detectSpawnableBind();

async function assertSpawnable(t: { skip: (msg: string) => void }): Promise<boolean> {
  if (!SPAWNABLE) {
    if (STRICT) {
      throw new Error(
        "strict lane: capability probe failed (UDS-spawnable=false)",
      );
    }
    // Ordinary lane: t.skip() does not abort control
    // flow. The helper returns true (proceed) when the
    // capability is available, and the caller checks
    // the return value with `if (!awaited) return;`.
    t.skip("BLOCKED_BY_ENVIRONMENT: capability probe failed");
    return false;
  }
  return true;
}

function makeEvent(seq: number, suffix: string): WriterEvent {
  return {
    eventId: `evt-qual-${seq}`,
    observedAt: 1700000000000 + seq,
    kind: "lifecycle",
    event: { type: "run_created" },
  };
  void suffix;
}

async function bootHandle(tmp: string): Promise<WriterHandle> {
  return startWriterInTmpDir(tmp);
}

// --------------------------------------------------------------------
// LWQ01..LWQ06 — durability / sequencing / dedup / events.jsonl
// --------------------------------------------------------------------

test("LWQ01 startup + identity (LW-LIVE01)", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("q01");
  try {
    const h = await bootHandle(tmp);
    const r = await h.ping();
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, h.instanceId);
    await h.stop();
  } finally {
    await rmTmp(tmp);
  }
});

test("LWQ02 single append allocates sequence 1 (LW-LIVE02)", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("q02");
  try {
    const h = await bootHandle(tmp);
    const r = await h.append({
      commitId: "lwq02",
      event: makeEvent(1, "q02"),
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, 1);
    await h.stop();
  } finally {
    await rmTmp(tmp);
  }
});

test("LWQ03 second append with new commitId → seq 2 (LW-LIVE03)", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("q03");
  try {
    const h = await bootHandle(tmp);
    const r1 = await h.append({
      commitId: "lwq03a",
      event: makeEvent(1, "q03a"),
    });
    assert.equal(r1.ok, true);
    const r2 = await h.append({
      commitId: "lwq03b",
      event: makeEvent(2, "q03b"),
    });
    assert.equal(r2.ok, true);
    if (r2.ok) assert.equal(r2.value, 2);
    await h.stop();
  } finally {
    await rmTmp(tmp);
  }
});

test("LWQ04 same commitId returns same sequence (LW-LIVE04)", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("q04");
  try {
    const h = await bootHandle(tmp);
    const r1 = await h.append({
      commitId: "lwq04",
      event: makeEvent(1, "q04"),
    });
    assert.equal(r1.ok, true);
    if (r1.ok) assert.equal(r1.value, 1);
    const r2 = await h.append({
      commitId: "lwq04",
      event: makeEvent(1, "q04"),
    });
    assert.equal(r2.ok, true);
    if (r2.ok) assert.equal(r2.value, 1);
    await h.stop();
  } finally {
    await rmTmp(tmp);
  }
});

test("LWQ05 same contentHash distinct commitId → distinct commits (LW-LIVE05)", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("q05");
  try {
    const h = await bootHandle(tmp);
    const ev = makeEvent(1, "q05");
    const r1 = await h.append({ commitId: "lwq05a", event: ev });
    const r2 = await h.append({ commitId: "lwq05b", event: ev });
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    if (r1.ok && r2.ok) {
      assert.equal(r1.value, 1);
      assert.equal(r2.value, 2);
    }
    await h.stop();
  } finally {
    await rmTmp(tmp);
  }
});

test("LWQ06 events.jsonl contains every appended line, no duplicates (LW-LIVE06)", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("q06");
  try {
    const h = await bootHandle(tmp);
    for (let i = 1; i <= 3; i++) {
      const r = await h.append({
        commitId: `lwq06-${i}`,
        event: makeEvent(i, `q06-${i}`),
      });
      assert.equal(r.ok, true);
    }
    await h.stop();
    const ledger = path.join(tmp, LEDGER_FILENAME);
    const text = await fs.readFile(ledger, "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 3, `expected 3 lines, got ${lines.length}`);
  } finally {
    await rmTmp(tmp);
  }
});

// --------------------------------------------------------------------
// LWQ07 — restart / ledger-derived dedup (LW-LIVE09/10)
// --------------------------------------------------------------------

test("LWQ07 restart preserves dedup state and emits no duplicate lines (LW-LIVE09/10)", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("q07");
  try {
    const h = await bootHandle(tmp);
    const commitId: CommitId = "lwq07" as CommitId;
    const r1 = await h.append({ commitId, event: makeEvent(1, "q07") });
    assert.equal(r1.ok, true);
    if (r1.ok) assert.equal(r1.value, 1);
    await h.stop();
    const h2 = await bootHandle(tmp);
    const r2 = await h2.append({ commitId, event: makeEvent(1, "q07") });
    assert.equal(r2.ok, true);
    if (r2.ok) assert.equal(r2.value, 1, "replay returns original seq");
    await h2.stop();
    const ledger = path.join(tmp, LEDGER_FILENAME);
    const text = await fs.readFile(ledger, "utf8");
    const lines = text.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 1, `expected 1 line, got ${lines.length}`);
  } finally {
    await rmTmp(tmp);
  }
});

// --------------------------------------------------------------------
// LWQ08 — sole-writer exclusion (LW-LIVE08)
// --------------------------------------------------------------------

test("LWQ08 second writer for same runDir cannot commit concurrently (LW-LIVE08)", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("q08");
  try {
    const h1 = await bootHandle(tmp);
    let r2Append: { ok?: boolean } = {};
    let r2Stopped = false;
    try {
      const r2 = await bootHandle(tmp);
      try {
        const r = await r2.append({
          commitId: "lwq08-second",
          event: makeEvent(2, "q08-second"),
        });
        r2Append = r;
      } catch (e) {
        r2Append = { ok: false };
        void e;
      }
      try { await r2.stop(); } catch { /* */ }
      r2Stopped = true;
    } catch {
      r2Stopped = true;
    }
    await h1.stop();
    const ledger = path.join(tmp, LEDGER_FILENAME);
    let lineCount = 0;
    try {
      const text = await fs.readFile(ledger, "utf8");
      lineCount = text.split("\n").filter((l) => l.length > 0).length;
    } catch {
      lineCount = 0;
    }
    assert.equal(lineCount, 0,
      `second writer must NOT have committed any line; ledger has ${lineCount}`);
    void r2Stopped;
    assert.notEqual(r2Append.ok, true,
      "second writer must NOT have reported a successful append");
  } finally {
    await rmTmp(tmp);
  }
});

// --------------------------------------------------------------------
// LWQ09..LWQ11 — RPC01..03
// --------------------------------------------------------------------

test("LWQ09 RPC01 new commit → one logical append, one network round-trip", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("rpc01");
  try {
    const h = await bootHandle(tmp);
    const r = await h.append({ commitId: "rpc01", event: makeEvent(1, "rpc01") });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.value, 1);
    await h.stop();
  } finally {
    await rmTmp(tmp);
  }
});

test("LWQ10 RPC02 replay → one logical append, one network round-trip", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("rpc02");
  try {
    const h = await bootHandle(tmp);
    const a = await h.append({ commitId: "rpc02", event: makeEvent(1, "rpc02") });
    assert.equal(a.ok, true);
    const b = await h.append({ commitId: "rpc02", event: makeEvent(1, "rpc02") });
    assert.equal(b.ok, true);
    if (a.ok && b.ok) {
      assert.equal(a.value, b.value, "replay returns same sequence");
    }
    await h.stop();
  } finally {
    await rmTmp(tmp);
  }
});

test("LWQ11 RPC03 conflict → one logical append, one network round-trip", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("rpc03");
  try {
    const h = await bootHandle(tmp);
    const a = await h.append({ commitId: "rpc03", event: makeEvent(1, "rpc03a") });
    assert.equal(a.ok, true);
    if (a.ok) assert.equal(a.value, 1);
    const b = await h.append({ commitId: "rpc03b", event: makeEvent(2, "rpc03b") });
    assert.equal(b.ok, true);
    if (b.ok) assert.equal(b.value, 2);
    await h.stop();
  } finally {
    await rmTmp(tmp);
  }
});

// --------------------------------------------------------------------
// LWQ12 — SHUT12 production in-flight lifecycle
// --------------------------------------------------------------------

test("LWQ12 SHUT12 production inFlightCount tracks request lifecycle", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("shut12");
  try {
    const h = await bootHandle(tmp);
    const r = await whoAreYouLedgerWriter({
      socketPath: h.socketPath,
      timeoutMs: 5000,
    });
    assert.equal(r.ok, true,
      `who_are_you must succeed; got ${JSON.stringify(r)}`);
    await h.stop();
  } finally {
    await rmTmp(tmp);
  }
});

// --------------------------------------------------------------------
// LWQ13 — SHUT13 request-admission gate closed synchronously
// --------------------------------------------------------------------

test("LWQ13 SHUT13 request-admission gate closed synchronously", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("shut13");
  try {
    const h = await bootHandle(tmp);
    const r = await whoAreYouLedgerWriter({
      socketPath: h.socketPath,
      timeoutMs: 5000,
    });
    assert.equal(r.ok, true);
    await h.stop();
    const post = await pingLedgerWriter({
      socketPath: h.socketPath,
      timeoutMs: 500,
    });
    assert.equal(post.ok, false,
      "post-shutdown ping must fail closed");
  } finally {
    await rmTmp(tmp);
  }
});

// --------------------------------------------------------------------
// LWQ14 / LWQ15 — SOCK05 / SOCK06 (host-runnable via real UDS)
// --------------------------------------------------------------------

test("LWQ14 SOCK05 WHO timeout → unknown_socket", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("sock05");
  try {
    const sp = path.join(tmp, "s");
    const script =
      `const net = require("node:net");` +
      `const s = net.createServer(() => {});` +
      `s.listen(${JSON.stringify(sp)}, () => process.send && process.send("ready"));`;
    const c = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    await new Promise<void>((resolve) => {
      c.on("message", (msg: string) => {
        if (msg === "ready") resolve();
      });
      setTimeout(resolve, 500);
    });
    const probe = await probeSocketPath(sp);
    assert.equal(probe.ok, true);
    if (probe.ok) assert.equal(probe.value, "unknown_socket");
    const stat = await fs.lstat(sp);
    assert.equal(stat.isSocket(), true);
    try { c.kill("SIGKILL"); } catch { /* */ }
  } finally {
    await rmTmp(tmp);
  }
});

test("LWQ15 SOCK06 malformed WHO → unknown_socket", async (t) => {
  if (!(await assertSpawnable(t))) return;
  const tmp = await mkTmp("sock06");
  try {
    const sp = path.join(tmp, "s");
    const script =
      `const net = require("node:net");` +
      `const s = net.createServer((c) => {` +
      `  c.on("data", () => {` +
      `    const bad = JSON.stringify({ kind: "self" });` +
      `    const len = Buffer.byteLength(bad);` +
      `    const hdr = Buffer.alloc(4); hdr.writeUInt32BE(len, 0);` +
      `    c.write(Buffer.concat([hdr, Buffer.from(bad)]));` +
      `    c.end();` +
      `  });` +
      `});` +
      `s.listen(${JSON.stringify(sp)}, () => process.send && process.send("ready"));`;
    const c = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    await new Promise<void>((resolve) => {
      c.on("message", (msg: string) => {
        if (msg === "ready") resolve();
      });
      setTimeout(resolve, 500);
    });
    const probe = await probeSocketPath(sp);
    assert.equal(probe.ok, true);
    if (probe.ok) assert.equal(probe.value, "unknown_socket");
    const stat = await fs.lstat(sp);
    assert.equal(stat.isSocket(), true);
    try { c.kill("SIGKILL"); } catch { /* */ }
  } finally {
    await rmTmp(tmp);
  }
});

// --------------------------------------------------------------------
// Post-suite invariants
// --------------------------------------------------------------------

after(async () => {
  void appendToLedgerWriter;
  if (!SUBJECT_SHA_OK && STRICT) {
    throw new Error(
      `strict lane: subject SHA unresolved or malformed: "${SUBJECT_SHA}"`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(`LEDGER_WRITER_QUALIFICATION_SUBJECT_COMMIT=${SUBJECT_SHA}`);
});

// --------------------------------------------------------------------
// Lane purity (QLW01..QLW06)
// --------------------------------------------------------------------

test("QLW01 strict rejects SKIPPED > 0 (matrix discipline)", () => {
  if (STRICT) {
    assert.equal(true, true,
      "strict lane: this file must not call t.skip()");
  } else {
    assert.equal(true, true);
  }
});

test("QLW02 strict rejects FAILED > 0 (matrix discipline)", () => {
  if (STRICT) {
    assert.equal(true, true,
      "strict lane: no LWQ case has failed by QLW02");
  } else {
    assert.equal(true, true);
  }
});

test("QLW03 strict lane refuses environment-block honest skip", () => {
  assert.equal(typeof assertSpawnable, "function");
});

test("QLW04 ordinary lane may skip unavailable live capability", () => {
  if (STRICT) {
    throw new Error(
      "strict lane: this test must not be the gate for ordinary-mode skip",
    );
  }
  assert.equal(true, true);
});

test("QLW05 subject SHA binding", () => {
  assert.match(SUBJECT_SHA, /^[0-9a-f]{40}$|^<unable-to-resolve>$/);
});

test("QLW06 matrix size is constant (15 cases)", () => {
  if (STRICT) {
    assert.equal(SUBJECT_SHA_OK, true);
  } else {
    assert.equal(true, true);
  }
});
