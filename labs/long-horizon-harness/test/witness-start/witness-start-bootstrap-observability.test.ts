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


// BOOTOBS09A/09B: a real production POST-bind bootstrap failure.
//
// CORRECTION03 (test-truthfulness law):
//   On a long-path host (UDS path > 100 bytes) the witness
//   fails at BIND, never reaching the post-bind rollback this
//   test names. Counting that pre-bind failure as PASS
//   evidence for post-bind cleanup is a false green. The test
//   is therefore split:
//     09A — pre-bind long-path diagnostic (informational)
//     09B — REQUIRED post-bind rollback; explicitly skipped
//           as BLOCKED_BY_ENVIRONMENT on a long-path host and
//           mandatory in the short-path qualification lane.
test("BOOTOBS09: real witness helper post-bind failure (readyAck fail) tears down UDS", async (t) => {
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
      // BOOTOBS09A (pre-bind long-path diagnostic). This host
      // cannot execute the post-bind capability. We record that
      // truthfully instead of asserting ok(true): the named
      // capability (post-bind rollback) is NOT proven here.
      process.stdout.write(
        "BOOTOBS09B=BLOCKED_BY_ENVIRONMENT " +
        "reason=socket_path_too_long uds_bytes=" +
        String(Buffer.byteLength(socketPath, "utf8")) + "\n",
      );
      assert.equal(handle.exitInfo().code, 1,
        "BOOTOBS09A: pre-bind long-path failure must exit 1");
      t.skip(
        "BOOTOBS09B=BLOCKED_BY_ENVIRONMENT: UDS path exceeds the " +
        "100-byte budget on this host, so the witness fails at bind " +
        "and the post-bind rollback capability is NOT exercised. " +
        "The short-path qualification lane MUST execute BOOTOBS09B.",
      );
      return;
    }
    // BOOTOBS09B (required post-bind rollback).
    assert.equal(handle.exitInfo().code, 1,
      "BOOTOBS09B: exit code must be 1 (readyAck failure -> " +
      "bootstrapFailWithServer(code=1))");
    assert.ok(captured.includes("ready durability failed"),
      "BOOTOBS09B: stderr MUST include the post-bind diagnostic " +
      "(captured=" + JSON.stringify(captured) + ")");
    assert.ok(captured.includes("server_closed=true"),
      "BOOTOBS09B: rollback MUST observe the real net.Server " +
      "'close' event, not merely call close() " +
      "(captured=" + JSON.stringify(captured) + ")");
    assert.ok(captured.includes("close_timed_out=false"),
      "BOOTOBS09B: the bounded close MUST NOT time out " +
      "(captured=" + JSON.stringify(captured) + ")");
    await assert.rejects(
      () => fs2.stat(socketPath),
      (e: unknown) => (e as { code?: string }).code === "ENOENT",
      "BOOTOBS09B: socket file MUST be unlinked after post-bind " +
      "bootstrap failure (regression check on " +
      "bootstrapFailWithServer)",
    );
  } finally {
    await fs2.rm(runDir, { recursive: true, force: true });
  }
});

// BOOTOBS10: post-bind COMPLETE resource closure with an
// adversarial accepted connection.
//
// Doctrine (post-bind resource-closure law):
//   `net.Server.close()` only stops admission; the server
//   is closed only once every accepted connection has ended
//   and the `'close'` event fires. A connected-but-idle peer
//   would otherwise pin the event loop forever, so
//   `process.exitCode` would never be honored and the
//   witness would not exit.
//
// This exercises the REAL production transport
// (`listenOnUnixSocket` + `closeServerBounded`) rather than a
// simulation, and does so with a short UDS path so it runs on
// every host (long-path hosts cannot spawn a bound witness).
test("BOOTOBS10: bounded close reaps an accepted connection and observes 'close'", async () => {
  const { promises: fs2 } = await import("node:fs");
  const path2 = await import("node:path");
  const net2 = await import("node:net");
  const { listenOnUnixSocket, closeServerBounded, rollbackSocketAfterClose } =
    await import("../../src/witness/witness-server.js");

  // The socket directory must be 0o700 (ensureSocketDirectory).
  //
  // UDS paths have a ~100-byte budget and the per-user tmpdir on
  // macOS (/var/folders/...) already exceeds it. A RELATIVE
  // socket path resolved against the test runner's cwd is short
  // on every host, so this capability is never
  // environment-blocked (unlike BOOTOBS09B, which must spawn a
  // real witness process with absolute paths).
  const scratch = path2.default.join(process.cwd(), ".scratch");
  await fs2.mkdir(scratch, { recursive: true });
  const dir = await fs2.mkdtemp(path2.default.join(scratch, ".b10-"));
  await fs2.chmod(dir, 0o700);
  const socketPath = path2.default.join(
    path2.default.relative(process.cwd(), dir),
    "w.sock",
  );
  try {
    const bindR = await listenOnUnixSocket({
      socketPath,
      onFrame: () => null,
    });
    assert.equal(bindR.ok, true,
      "BOOTOBS10: the real transport must bind (error=" +
      JSON.stringify(bindR.ok ? null : bindR.error) + ")");
    if (!bindR.ok) return;
    const server = bindR.value;

    // Adversarial client: connects and stays connected, sending
    // nothing. This is the interleaving that made the previous
    // rollback unprovable.
    const client = net2.default.createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("error", reject);
    });
    await new Promise((r) => setImmediate(r));
    assert.equal(server.listening, true,
      "BOOTOBS10: precondition — server is listening with a live peer");

    const outcome = await closeServerBounded(server, 2000);
    assert.equal(outcome.closed, true,
      "BOOTOBS10: the server's real 'close' event MUST be observed " +
      "even with an accepted connection outstanding");
    assert.equal(outcome.timedOut, false,
      "BOOTOBS10: the bounded close MUST NOT hit its deadline");
    assert.equal(outcome.destroyedConnections, 1,
      "BOOTOBS10: the accepted connection MUST be owned and destroyed " +
      "by the rollback (got: " + outcome.destroyedConnections + ")");
    assert.equal(server.listening, false,
      "BOOTOBS10: the server handle must no longer be listening");

    // CORRECTION05 — close-before-unlink integration proof:
    // the rollback helper above closeServerBounded sees a
    // proven-close outcome and removes the path. This is
    // the production counterpart to BOOTOBS11's pure-policy
    // test of the timeout branch.
    await rollbackSocketAfterClose(server, socketPath, 2000);
    await assert.rejects(
      () => fs2.stat(socketPath),
      (e: unknown) => (e as { code?: string }).code === "ENOENT",
      "BOOTOBS10: socket pathname MUST be absent after a " +
      "rollbackSocketAfterClose that observed a proven close",
    );
    client.destroy();
  } finally {
    await fs2.rm(dir, { recursive: true, force: true });
  }
});

// BOOTOBS11: close-before-unlink timeout — pathname MUST be
// retained, residue MUST surface.
//
// Doctrine (close-before-unlink law, CORRECTION04):
//   A pathname for an authority-bearing Unix socket may be
//   removed ONLY after the kernel close boundary has been
//   positively observed. POSIX/Linux explicitly permits
//   unlinking a Unix-domain socket pathname while processes
//   still hold the socket; existing references keep working.
//
// `timeout !== absence of resource death`, and
// `timeout !== permission to erase identity`.
//
// CORRECTION05 — observation API purity:
//   `closeServerBounded` is the AUTHORITATIVE observation of
//   the server's `'close'` boundary. It MUST NOT be told
//   what to claim by callers — including tests. The
//   deterministic timeout branch is exercised by testing the
//   PURE policy function `decideSocketRollback`, which is
//   the single source of truth for the close-before-unlink
//   law. No fabrication seam exists in `closeServerBounded`,
//   `rollbackSocketAfterClose`, or `decideSocketRollback`
//   itself.
test("BOOTOBS11: decideSocketRollback is the single source of truth for close-before-unlink", async () => {
  const { decideSocketRollback } = await import(
    "../../src/witness/witness-server.js"
  );

  // Proven close ⇒ remove_path (kernel close was observed).
  {
    const d = decideSocketRollback({
      closed: true,
      destroyedConnections: 0,
      timedOut: false,
    });
    assert.equal(d.kind, "remove_path",
      "BOOTOBS11[policy]: proven close MUST yield remove_path");
  }

  // Close timed out ⇒ retain_path (do NOT erase identity).
  {
    const d = decideSocketRollback({
      closed: false,
      destroyedConnections: 0,
      timedOut: true,
    });
    assert.equal(d.kind, "retain_path",
      "BOOTOBS11[policy]: timed-out close MUST yield retain_path");
  }

  // Close timed out but some connections were reaped ⇒ still
  // retain_path. The reaped-connections counter is residue,
  // not proof.
  {
    const d = decideSocketRollback({
      closed: false,
      destroyedConnections: 3,
      timedOut: true,
    });
    assert.equal(d.kind, "retain_path",
      "BOOTOBS11[policy]: close boundary not observed ⇒ " +
      "retain_path regardless of destroyedConnections count");
  }

  // Closed=false with timedOut=false is a degenerate
  // observation the production API never emits; the policy
  // MUST still refuse to unlink (fail-closed on any
  // non-proven-close observation).
  {
    const d = decideSocketRollback({
      closed: false,
      destroyedConnections: 0,
      timedOut: false,
    });
    assert.equal(d.kind, "retain_path",
      "BOOTOBS11[policy]: a non-proven close (any reason) MUST " +
      "yield retain_path; close-before-unlink is fail-closed");
  }
});

// BOOTOBS11-INTEGRATION (CORRECTION05 deliberately omitted):
// A real-transport test that exercises the unproven-close
// branch cannot be produced without a fabrication seam in
// `closeServerBounded`. CORRECTION03's accepted-socket
// ownership registry is intentionally aggressive: any peer
// delivered to the `'connection'` listener is owned by the
// server and is destroyed by `closeServerBounded` before the
// bounded deadline. The remaining in-the-kernel race window
// (a connection accepted by the kernel but not yet delivered
// to the `'connection'` listener) is not reachable from a
// Node test driver without racing the SUT. The pure policy
// test BOOTOBS11 covers the timeout branch deterministically;
// the proven-close branch is covered by BOOTOBS10's
// `rollbackSocketAfterClose` integration. The unproven-close
// integration test would require either the fabrication
// seam (now removed by CORRECTION05) or a concurrency
// control surface that is out of scope for Phase A.
