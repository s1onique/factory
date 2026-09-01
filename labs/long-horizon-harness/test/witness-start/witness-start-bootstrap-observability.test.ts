/**
 * FOUNDATION04 — PHASE A FINAL CLOSURE — BOOTOBS01..06.
 *
 *   Bootstrap-observability law and pipe-drain law.
 *
 * Doctrine (bootstrap-observability law):
 *   A spawned process that dies before readiness MUST
 *   leave bounded diagnostic evidence sufficient to
 *   classify the bootstrap failure; an exit code alone
 *   is not a diagnosis.
 *
 * Doctrine (pipe-drain law):
 *   If a long-lived child is spawned with piped
 *   stdout/stderr, the owner MUST continuously drain
 *   those pipes even after the retained evidence cap is
 *   reached.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { Readable } from "node:stream";
import { Buffer } from "node:buffer";

import {
  drainBounded,
} from "../../src/witness-start/witness-start-bootstrap-output.js";
import {
  wrapChild,
} from "../../src/witness-start/witness-start-spawn.js";

test("BOOTOBS01: drainBounded continuously drains a stream past the cap", async () => {
  const r = new Readable({ read() { /* pull-mode */ } });
  const d = drainBounded(r, 4096);
  // Push 100 chunks of 1024 bytes.
  for (let i = 0; i < 100; i += 1) {
    r.push(Buffer.from("x".repeat(1024)));
  }
  r.push(null);
  // Wait for the end event to propagate.
  await new Promise<void>((resolve) => r.on("end", () => resolve()));
  await new Promise((r) => setImmediate(r));
  const stats = d.stats();
  assert.equal(stats.bytesSeen, 100 * 1024,
    "BOOTOBS01: all 100 * 1024 bytes must be observed");
  assert.equal(stats.bytesRetained, 4096,
    "BOOTOBS01: only 4096 bytes may be retained");
  assert.equal(stats.truncated, true,
    "BOOTOBS01: truncation bit must be true");
});

test("BOOTOBS02: drainBounded reports truthful seen/retained counts", async () => {
  const r = new Readable({ read() { /* pull-mode */ } });
  const d = drainBounded(r, 1024);
  r.push(Buffer.from("hello"));
  r.push(null);
  await new Promise<void>((resolve) => r.on("end", () => resolve()));
  await new Promise((r) => setImmediate(r));
  const stats = d.stats();
  assert.equal(stats.bytesSeen, 5, "BOOTOBS02: seen must equal payload size");
  assert.equal(stats.bytesRetained, 5, "BOOTOBS02: retained must equal seen when under cap");
  assert.equal(stats.truncated, false, "BOOTOBS02: truncated must be false when under cap");
});

test("BOOTOBS03: retention cap is honored (bytes() never grows past cap)", async () => {
  const r = new Readable({ read() { /* pull-mode */ } });
  const d = drainBounded(r, 2000);
  for (let i = 0; i < 1000; i += 1) {
    r.push(Buffer.from("y".repeat(100)));
  }
  r.push(null);
  await new Promise<void>((resolve) => r.on("end", () => resolve()));
  await new Promise((r) => setImmediate(r));
  const buf = d.bytes();
  assert.ok(buf.length <= 2000, "BOOTOBS03: bytes() must not exceed cap");
  assert.equal(d.stats().bytesSeen, 100000,
    "BOOTOBS03: seen must be all 1000 * 100 bytes");
  assert.equal(d.stats().truncated, true,
    "BOOTOBS03: truncated must be true");
});

test("BOOTOBS04: wrapChild exposes a read-only bootstrapOutput() surface", async () => {
  const child: ChildProcess = spawn(
    process.execPath,
    ["-e", "process.stdout.write('hi-stdout'); process.stderr.write('hi-stderr'); process.exit(0);"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const handle = wrapChild(child);
  await new Promise<void>((r) => child.once("exit", () => r()));
  await new Promise((r) => setTimeout(r, 50));
  const out = handle.bootstrapOutput();
  assert.equal(typeof out.stdoutBytesSeen, "number",
    "BOOTOBS04: stdoutBytesSeen must be a number");
  assert.equal(typeof out.stderrBytesSeen, "number",
    "BOOTOBS04: stderrBytesSeen must be a number");
  assert.equal(out.stdoutTruncated, false,
    "BOOTOBS04: tiny output must not be truncated");
  assert.equal(out.stderrTruncated, false,
    "BOOTOBS04: tiny output must not be truncated");
  assert.equal(out.stdoutBytesSeen, 9,
    "BOOTOBS04: stdout must contain the 9 bytes we wrote ('hi-stdout')");
  assert.equal(out.stderrBytesSeen, 9,
    "BOOTOBS04: stderr must contain the 9 bytes we wrote ('hi-stderr')");
  const exit = handle.exitInfo();
  assert.equal(exit.exited, true,
    "BOOTOBS04: exitInfo().exited must be true after natural exit");
  assert.equal(exit.code, 0,
    "BOOTOBS04: exit code must be 0");
});

test("BOOTOBS05: wrapChild captures exit code and signal", async () => {
  const child: ChildProcess = spawn(
    process.execPath,
    ["-e", "process.exit(7);"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const handle = wrapChild(child);
  await new Promise<void>((r) => child.once("exit", () => r()));
  await new Promise((r) => setTimeout(r, 50));
  const exit = handle.exitInfo();
  assert.equal(exit.exited, true, "BOOTOBS05: exited must be true");
  assert.equal(exit.code, 7, "BOOTOBS05: code must be 7");
  assert.equal(exit.signal, null, "BOOTOBS05: signal must be null on normal exit");
});

test("BOOTOBS06: child emitting >> cap cannot deadlock the parent (pipe-drain law)", async () => {
  // Generate enough output to fill any kernel pipe
  // buffer (64 KiB default on macOS, 64 KiB on Linux) and
  // also exceed the 64 KiB default bounded-buffer cap.
  // If the supervisor stopped reading, the child would
  // block on the next write, the test would time out,
  // and the host burn would deadlock in production.
  const child: ChildProcess = spawn(
    process.execPath,
    ["-e",
     "for (let i = 0; i < 256; i++) { process.stdout.write('A'.repeat(1024)); } process.exit(0);",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const handle = wrapChild(child);
  const start = Date.now();
  await new Promise<void>((r) => child.once("exit", () => r()));
  await new Promise((r) => setTimeout(r, 100));
  const dt = Date.now() - start;
  assert.ok(dt < 5000,
    "BOOTOBS06: child must exit promptly even with >cap stdout (took " + dt + "ms)");
  const out = handle.bootstrapOutput();
  assert.ok(out.stdoutBytesSeen >= 256 * 1024,
    "BOOTOBS06: stdoutBytesSeen must reflect all bytes written");
  assert.equal(out.stdoutTruncated, true,
    "BOOTOBS06: stdout must be marked truncated past the cap");
});

// BOOTOBS07: a real Node child emitting a multi-line
// diagnostic on stderr and exiting non-zero must be
// captured completely by the harness bounded drain.
// This proves the flush-safe bootstrap-diagnostic
// pattern: the diagnostic IS delivered to the parent.
test("BOOTOBS07: real Node child diagnostic is captured completely on non-zero exit", async () => {
  const expected = "DIAG-LINE-1: bootstrap-failure\nDIAG-LINE-2: details\n";
  const child: ChildProcess = spawn(
    process.execPath,
    ["-e",
     "process.stderr.write(" + JSON.stringify(expected) + "); " +
     "process.exit(2);",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const handle = wrapChild(child);
  await new Promise<void>((r) => child.once("exit", () => r()));
  await new Promise((r) => setTimeout(r, 200));
  // The diagnostic is captured completely; the exact exit
  // code is a regression check on exitInfo() round-trip.
  assert.equal(handle.exitInfo().exited, true,
    "BOOTOBS07: exitInfo().exited must be true");
  assert.equal(handle.exitInfo().code, 2,
    "BOOTOBS07: exit code must round-trip");
  const out = handle.bootstrapOutput();
  const captured = new TextDecoder("utf-8").decode(out.stderr);
  assert.equal(captured, expected,
    "BOOTOBS07: stderr diagnostic must reach the parent COMPLETE " +
    "(no truncation, no loss). captured=" + JSON.stringify(captured));
  assert.equal(out.stderrBytesSeen, expected.length,
    "BOOTOBS07: stderrBytesSeen must equal the bytes written");
  assert.equal(out.stderrTruncated, false,
    "BOOTOBS07: tiny diagnostic must not be truncated");
});
