/**
 * FOUNDATION04 — B0-CORR05 — Socket probe + bind policy.
 *
 * Doctrine:
 *   **Endpoint-uncertainty law:** possession of
 *   filesystem authority does not prove death of an
 *   independently live kernel endpoint.
 *
 * The probe is the authority on whether the listener at a
 * UDS path is a live writer. Three outcomes:
 *
 *   - absent → safe to bind.
 *   - live_writer_present → refuse to bind.
 *   - unknown_socket (WHO timeout / malformed) →
 *     `startWriterServer()` returns path_collision and
 *     does NOT unlink. This is the B0-CORR05 §8 contract.
 *
 * Path-classification tests (SOCK01..SOCK04) cover the
 * absent / file / directory / symlink cases that the
 * probe short-circuits before any connect attempt. The
 * WHO-roundtrip cases (SOCK05, SOCK06) require a live
 * UDS listener and are exercised in production via the
 * spawned-writer RPC tests under RPC01..03 (those run
 * under a child process where Node 26.0.0's
 * AsyncHooks-on-uds bug does not fire).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

import { probeSocketPath } from "../../src/ledger-writer/ledger-writer-socket-probe.js";

function mkTmp(): Promise<string> {
  // Use TMPDIR (sandbox) when present to fit the UDS
  // 100-byte budget on this host.
  const base = process.env["TMPDIR"] ?? path.join(process.cwd(), ".lw");
  return fs.mkdtemp(path.join(base, ".lws-"));
}

function detectSpawnableBind(): boolean {
  const base = process.env["TMPDIR"] ?? path.join(process.cwd(), ".lw");
  const probeSock = `${base}/.lws-probe1234/s`;
  return Buffer.byteLength(probeSock, "utf8") <= 100;
}

async function rmTmp(p: string): Promise<void> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

test("SOCK01 absent path → absent (B0-CORR05 §12)", async () => {
  const tmp = await mkTmp();
  try {
    const sp = path.join(tmp, "nope.sock");
    const probe = await probeSocketPath(sp);
    assert.equal(probe.ok, true);
    if (!probe.ok) return;
    assert.equal(probe.value, "absent");
  } finally {
    await rmTmp(tmp);
  }
});

test("SOCK02 regular file at path → path_collision (B0-CORR05 §8)", async () => {
  const tmp = await mkTmp();
  try {
    const sp = path.join(tmp, "not-a-sock");
    await fs.writeFile(sp, "regular file");
    const probe = await probeSocketPath(sp);
    assert.equal(probe.ok, false);
    if (probe.ok) return;
    assert.equal(probe.error.kind, "path_collision");
  } finally {
    await rmTmp(tmp);
  }
});

test("SOCK03 directory at path → path_collision (B0-CORR05 §8)", async () => {
  const tmp = await mkTmp();
  try {
    const sp = path.join(tmp, "subdir");
    await fs.mkdir(sp);
    const probe = await probeSocketPath(sp);
    assert.equal(probe.ok, false);
    if (probe.ok) return;
    assert.equal(probe.error.kind, "path_collision");
  } finally {
    await rmTmp(tmp);
  }
});

test("SOCK04 symlink at path → path_collision (B0-CORR05 §8)", async () => {
  const tmp = await mkTmp();
  try {
    const target = path.join(tmp, "real-sock");
    const link = path.join(tmp, "link-sock");
    await fs.writeFile(target, "x");
    await fs.symlink(target, link);
    const probe = await probeSocketPath(link);
    assert.equal(probe.ok, false);
    if (probe.ok) return;
    assert.equal(probe.error.kind, "path_collision");
  } finally {
    await rmTmp(tmp);
  }
});

/**
 * SOCK05 (B0-CORR06): real UDS listener that accepts
 * but never replies to WHO. probeSocketPath must
 * classify this as unknown_socket without unlinking.
 *
 * Spawned in a child process to avoid Node 26.0.0's
 * AsyncHooks-on-UDS bug (which crashes when UDS server
 * and client run in the same process).
 *
 * Skipped on hosts where the UDS path exceeds 100
 * bytes (BLOCKED_BY_ENVIRONMENT).
 */
test("SOCK05 WHO timeout → unknown_socket (B0-CORR06)", async (t) => {
  if (!detectSpawnableBind()) {
    t.skip(
      "BLOCKED_BY_ENVIRONMENT: harness path is too long for UDS on this host",
    );
    return;
  }
  const tmp = await mkTmp();
  try {
    const sp = path.join(tmp, "s");
    // Spawn a listener that accepts but never replies.
    const script =
      `const net = require("node:net");` +
      `const s = net.createServer(() => {});` +
      `s.listen(${JSON.stringify(sp)}, () => process.send && process.send("ready"));`;
    const c = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    // Wait for the listener to be ready.
    await new Promise<void>((resolve) => {
      c.on("message", (msg: string) => {
        if (msg === "ready") resolve();
      });
      setTimeout(resolve, 500);
    });
    const probe = await probeSocketPath(sp);
    assert.equal(probe.ok, true);
    if (!probe.ok) return;
    assert.equal(probe.value, "unknown_socket");
    // Verify the socket path was NOT unlinked.
    const stat = await fs.lstat(sp);
    assert.equal(stat.isSocket(), true);
    try { c.kill("SIGKILL"); } catch { /* */ }
  } finally {
    await rmTmp(tmp);
  }
});

/**
 * SOCK06 (B0-CORR06): real UDS listener that replies
 * to WHO with a malformed envelope (missing
 * protocolVersion). probeSocketPath must classify this
 * as unknown_socket without unlinking.
 *
 * Skipped on hosts where the UDS path exceeds 100
 * bytes.
 */
test("SOCK06 malformed WHO → unknown_socket (B0-CORR06)", async (t) => {
  if (!detectSpawnableBind()) {
    t.skip(
      "BLOCKED_BY_ENVIRONMENT: harness path is too long for UDS on this host",
    );
    return;
  }
  const tmp = await mkTmp();
  try {
    const sp = path.join(tmp, "s");
    // Spawn a listener that replies to WHO with a
    // malformed envelope (no protocolVersion).
    const script =
      `const net = require("node:net");` +
      `const { encodeFrame } = require(${JSON.stringify(
        path.resolve(
          path.dirname(import.meta.dirname),
          "../dist-test/witness/witness-codec-framing.js",
        ),
      )});` +
      `const s = net.createServer((socket) => {` +
      `  socket.on("data", () => {` +
      `    const enc = encodeFrame(JSON.stringify({ kind: "self" }));` +
      `    if (enc.ok) socket.write(Buffer.from(enc.bytes));` +
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
    if (!probe.ok) return;
    // The reply is structurally a "self" envelope but
    // protocolVersion is missing — authoritative
    // decoder rejects it; the probe must NOT classify
    // this as live_writer_present.
    assert.equal(probe.value, "unknown_socket");
    // Verify the socket path was NOT unlinked.
    const stat = await fs.lstat(sp);
    assert.equal(stat.isSocket(), true);
    try { c.kill("SIGKILL"); } catch { /* */ }
  } finally {
    await rmTmp(tmp);
  }
});
