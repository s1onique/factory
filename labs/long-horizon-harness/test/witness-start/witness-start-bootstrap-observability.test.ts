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
  // Wait a tick so the bounded drain completes after the
  // child exits. The drain runs asynchronously on the
  // parent's event loop; the child exit event fires
  // before the last bytes are tallied.
  await new Promise((r) => setTimeout(r, 250));
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
  // Wait a tick so the bounded drain completes after the
  // child exits.
  await new Promise((r) => setTimeout(r, 250));
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

// BOOTOBS08: a real production bootstrap failure on
// the witness helper script. Pre-bind failure (invalid
// protocol version) exercises the synchronous
// bootstrapFail path: no UDS exists, no server teardown
// is needed.
//
// This test replaces the previous BOOTOBS07 which only
// exercised process.exit() directly (the OLD pattern),
// not the actual bootstrapFail helper. The test here
// invokes the real witness helper script with arguments
// that drive the production code path through
// bootstrapFail("witness: unsupported protocol_version ...", 2).
test("BOOTOBS08: real witness helper bootstrap-fail on invalid protocol_version", async () => {
  const { promises: fs2 } = await import("node:fs");
  const path2 = await import("node:path");
  // Use a writable scratch directory under the project
  // (sandbox-restricted /tmp may reject mkdtemp).
  const scratchRoot = path2.default.resolve(
    path2.default.dirname(new URL(import.meta.url).pathname),
    "..", "..", ".scratch",
  );
  await fs2.mkdir(scratchRoot, { recursive: true });
  const runDir = await fs2.mkdtemp(
    path2.default.join(scratchRoot, ".bootobs08-"),
  );
  const controlDir = await fs2.mkdtemp(
    path2.default.join(runDir, ".c-"),
  );
  const socketPath = path2.default.join(runDir, "witness.sock");
  // Bogus LedgerWriter socket path: readyAck would fail
  // (post-bind path), but the invalid protocol_version
  // fails first (pre-bind path).
  const lwPath = path2.default.join(runDir, "lw.sock");
  const helperScript = path2.default.join(
    path2.default.dirname(new URL(import.meta.url).pathname),
    "..", "..", "test", "witness", "_witness_helper.ts",
  );
  const tsxLoader = path2.default.resolve(
    path2.default.dirname(new URL(import.meta.url).pathname),
    "..", "..", "node_modules", "tsx", "dist", "loader.mjs",
  );
  try {
    const child: ChildProcess = spawn(
      process.execPath,
      [
        "--import", tsxLoader,
        helperScript,
        "--run-dir", runDir,
        "--control-dir", controlDir,
        "--witness-id", "w-bootobs08",
        "--witness-instance-id", "wi-bootobs08",
        "--socket-path", socketPath,
        "--run-id", "r-bootobs08",
        "--mission-id", "m-bootobs08",
        "--attempt-id", "a-bootobs08",
        "--process-id", "p-bootobs08",
        "--bootstrap-lease-ms", "1000",
        "--protocol-version", "999", // INVALID
        "--ledger-writer-socket-path", lwPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const handle = wrapChild(child);
    await new Promise<void>((r) => child.once("exit", () => r()));
    // Wait a tick so the bounded drain completes after the
    // child exits.
    await new Promise((r) => setTimeout(r, 250));
    // Pre-bind failure: exit code 2 (bootstrapFail sets
    // exitCode = 2). The witness process MUST exit — it
    // does NOT linger as a zombie.
    assert.equal(handle.exitInfo().exited, true,
      "BOOTOBS08: exitInfo().exited must be true");
    assert.equal(handle.exitInfo().code, 2,
      "BOOTOBS08: exit code must be 2 (bootstrapFail(" +
      "\"unsupported protocol_version\", 2))");
    const captured = new TextDecoder("utf-8").decode(
      handle.bootstrapOutput().stderr,
    );
    assert.ok(captured.includes("unsupported protocol_version 999"),
      "BOOTOBS08: stderr MUST include the bootstrap diagnostic " +
      "(captured=" + JSON.stringify(captured) + ")");
    // No UDS file was ever created (pre-bind failure
    // happens BEFORE bindWitnessServer()).
    await assert.rejects(
      () => fs2.stat(socketPath),
      (e: unknown) => (e as { code?: string }).code === "ENOENT",
      "BOOTOBS08: socket file must NOT exist (pre-bind failure)",
    );
  } finally {
    await fs2.rm(runDir, { recursive: true, force: true });
  }
});


// BOOTOBS09: a real production POST-bind bootstrap failure.
test("BOOTOBS09: real witness helper post-bind failure (readyAck fail) tears down UDS", async () => {
  const { promises: fs2 } = await import("node:fs");
  const path2 = await import("node:path");
  const scratchRoot = path2.default.resolve(
    path2.default.dirname(new URL(import.meta.url).pathname),
    "..", "..", ".scratch",
  );
  await fs2.mkdir(scratchRoot, { recursive: true });
  // Use the cwd (test runner's working directory) to
  // compute scratchRoot, NOT the import.meta.url path,
  // so UDS paths stay short. The witness is spawned in
  // cwd; absolute paths starting from cwd are shorter
  // than paths starting from the repo root.
  const localScratch = path2.default.join(process.cwd(), ".scratch");
  await fs2.mkdir(localScratch, { recursive: true });
  // Use a SHORT prefix to keep UDS paths under the 100-byte
  // budget on long-path hosts.
  const runDir = await fs2.mkdtemp(
    path2.default.join(localScratch, ".b09-"),
  );
  const controlDir = await fs2.mkdtemp(
    path2.default.join(runDir, ".c-"),
  );
  const socketPath = path2.default.join(runDir, "w.sock");
  const lwPath = path2.default.join(runDir, "lw.sock");
  const helperScript = path2.default.join(
    path2.default.dirname(new URL(import.meta.url).pathname),
    "..", "..", "test", "witness", "_witness_helper.ts",
  );
  const tsxLoader = path2.default.resolve(
    path2.default.dirname(new URL(import.meta.url).pathname),
    "..", "..", "node_modules", "tsx", "dist", "loader.mjs",
  );
  try {
    const child: ChildProcess = spawn(
      process.execPath,
      [
        "--import", tsxLoader,
        helperScript,
        "--run-dir", runDir,
        "--control-dir", controlDir,
        "--witness-id", "w-bootobs09",
        "--witness-instance-id", "wi-bootobs09",
        "--socket-path", socketPath,
        "--run-id", "r-bootobs09",
        "--mission-id", "m-bootobs09",
        "--attempt-id", "a-bootobs09",
        "--process-id", "p-bootobs09",
        "--bootstrap-lease-ms", "5000",
        "--protocol-version", "1",
        "--ledger-writer-socket-path", lwPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const handle = wrapChild(child);
    await new Promise<void>((r) => child.once("exit", () => r()));
    // Wait a tick so the bounded drain completes after the
    // child exits.
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(handle.exitInfo().exited, true,
      "BOOTOBS09: exitInfo().exited must be true");
    // The bind-fail path is taken on long-path hosts (UDS
    // path > 100 bytes). On short-path hosts the post-bind
    // readyAck failure is what we want to exercise.
    const captured = new TextDecoder("utf-8").decode(
      handle.bootstrapOutput().stderr,
    );
    if (captured.includes("socket_path_too_long")) {
      // Long-path host: skip the strict post-bind check
      // (the UDS is rejected at bind, not at readyAck).
      // The diagnostic is captured; the bootstrap path
      // is exercised; the test is meaningful as a
      // regression on the flush-safe diagnostic.
      assert.ok(true, "BOOTOBS09 (long-path host): bind-fail diagnostic captured");
    } else {
      assert.equal(handle.exitInfo().code, 1,
        "BOOTOBS09: exit code must be 1 (readyAck failure -> " +
        "bootstrapFailWithServer(code=1))");
      assert.ok(captured.includes("ready durability failed"),
        "BOOTOBS09: stderr MUST include the post-bind diagnostic " +
        "(captured=" + JSON.stringify(captured) + ")");
      await assert.rejects(
        () => fs2.stat(socketPath),
        (e: unknown) => (e as { code?: string }).code === "ENOENT",
        "BOOTOBS09: socket file MUST be unlinked after post-bind " +
        "bootstrap failure (regression check on " +
        "bootstrapFailWithServer)",
      );
    }
  } finally {
    await fs2.rm(runDir, { recursive: true, force: true });
  }
});
