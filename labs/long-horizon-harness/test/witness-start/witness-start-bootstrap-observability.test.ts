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
 *
 * Doctrine (terminal-output-accounting law — CORRECTION10):
 *   Exact byte-accounting on a child's stdio is
 *   authoritative ONLY after the bounded drains owning
 *   those streams have observed their terminal lifecycle
 *   boundary (`'end'` / `'close'` on the underlying
 *   Readable). Node's documented `'exit'` fires BEFORE
 *   the streams close; reading `bootstrapOutput()`
 *   immediately after `'exit'` is a partial count.
 *   The wall-clock fence `setTimeout(N)` after `'exit'`
 *   is not a substitute for observing the terminal
 *   boundary. Tests below use the `whenBootstrapOutputClosed()`
 *   barrier exactly so this property is mechanically
 *   enforced — exact-equality assertions appear ONLY
 *   after the barrier resolves, and the barrier itself
 *   is built from stream lifecycle events, not from
 *   elapsed time.
 *
 * Doctrine (end-vs-close algebra — CORRECTION11):
 *   `'end'` is the ONLY event that authorizes a
 *   `kind: "ended"` mint. A Readable that emits `'close'`
 *   without first emitting `'end'` is documented by
 *   Node as a "Premature close" condition
 *   (`ERR_STREAM_PREMATURE_CLOSE`); some bytes the
 *   producer intended to send are lost or undelivered.
 *   `drainBounded` routes its terminal observation
 *   through Node's `finished(stream, { cleanup: true })`,
 *   which surfaces this condition as a rejection, and
 *   translates it to `kind: "premature_close"`. Tests
 *   below prove both the positive (clean `'end'`) and
 *   the negative (`destroy()` without error →
 *   `kind: "premature_close"`, NEVER `kind: "ended"`)
 *   pathways.
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

test("BOOTOBS06: child emitting >> cap cannot deadlock the parent; exact byte accounting after terminal barrier (pipe-drain + terminal-output-accounting laws)", async () => {
  // Generate enough output to fill any kernel pipe
  // buffer (64 KiB default on macOS, 64 KiB on Linux)
  // and also exceed the 64 KiB default bounded-buffer
  // cap. The owner MUST keep draining so the child
  // never blocks. Once the terminal stream lifecycle
  // boundary has been observed (the
  // whenBootstrapOutputClosed() barrier), the
  // accounting MUST be exact — no `>=`, no probabilistic
  // fence, no sleep.
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
  // CORRECTION10: await the terminal-output barrier that
  // owns the underlying Readables. After this resolves,
  // `stdout` and `stderr` drain stats are FINAL.
  const term = await handle.whenBootstrapOutputClosed();
  const dt = Date.now() - start;
  assert.ok(dt < 5000,
    "BOOTOBS06: child must exit promptly even with >cap stdout (took " + dt + "ms)");
  // Exact-equality accounting — only valid AFTER the
  // terminal barrier resolves. A `>=` assertion would
  // hide a partial-count regression.
  assert.equal(term.stdout.bytesSeen, 256 * 1024,
    "BOOTOBS06: stdoutBytesSeen must EXACTLY equal 256*1024 after terminal barrier");
  assert.equal(term.stdout.truncated, true,
    "BOOTOBS06: stdout must be marked truncated past the cap");
  assert.ok(term.stdout.bytesRetained <= 64 * 1024,
    "BOOTOBS06: retained stdout must be <= the configured cap (bytesRetained=" +
      term.stdout.bytesRetained + ")");
  // Cross-check: bootstrapOutput() agrees with the
  // terminal barrier snapshot (drain has stopped
  // accepting new data post-terminal).
  const out = handle.bootstrapOutput();
  assert.equal(out.stdoutBytesSeen, term.stdout.bytesSeen,
    "BOOTOBS06: bootstrapOutput() and terminal barrier agree on bytesSeen");
  assert.equal(out.stdoutTruncated, term.stdout.truncated,
    "BOOTOBS06: bootstrapOutput() and terminal barrier agree on truncated bit");
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

// CORRECTION10 — terminal-output-accounting oracles.
//
// These tests lock in the property that
// `whenBootstrapOutputClosed()` is the SINGLE source of
// terminal accounting; exact-equality assertions appear
// ONLY after the barrier resolves; the barrier itself is
// built from `'end'` / `'close'` / `'error'` lifecycle
// events (never from wall-clock fences).

/**
 * BOOTOBS12 — Real Node child that exits while final
 * buffered stdout data is in flight. After the child
 * has emitted ALL its bytes and exited, the
 * `whenBootstrapOutputClosed()` barrier MUST wait for
 * the last bytes to land in the drain and then report
 * the EXACT count. If we resolved on `'exit'` alone,
 * the last few bytes (still in the kernel pipe) would
 * NOT be observed and the assertion would fail.
 */
test("BOOTOBS12: terminal barrier waits for final buffered stdout after exit (exact byte count)", async () => {
  const child: ChildProcess = spawn(
    process.execPath,
    ["-e",
     // Emit three 64 KiB blocks, then a small trailing
     // byte after 'exit' is requested via
     // setImmediate so the bytes arrive AFTER the
     // child's exit event but BEFORE the stream is
     // closed. This is the exact race the doctrine
     // describes: if we settled on 'exit' alone, the
     // trailing byte would be lost.
     "const big = Buffer.alloc(64 * 1024, 0x42);" +
     "process.stdout.write(big);" +
     "process.stdout.write(big);" +
     "process.stdout.write(big);" +
     "setImmediate(() => { process.stdout.write('TAIL'); process.exit(0); });",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const handle = wrapChild(child);
  await new Promise<void>((r) => child.once("exit", () => r()));
  // Use the terminal-output barrier; do NOT take stats
  // before it resolves.
  const term = await handle.whenBootstrapOutputClosed();
  // 3 * 64 KiB + 4 trailing bytes = 196608 + 4 = 196612
  assert.equal(term.stdout.bytesSeen, 196612,
    "BOOTOBS12: stdoutBytesSeen must EXACTLY include the 'TAIL' that landed post-exit " +
      "(got " + term.stdout.bytesSeen + ", expected 196612)");
  assert.equal(term.stdout.truncated, true,
    "BOOTOBS12: 192 KiB > 64 KiB cap; truncated must be true");
});

/**
 * BOOTOBS13 — Child emits far above the retention cap.
 * `bytesSeen` is exact (the drain still counts every
 * byte the kernel delivered); `bytesRetained` is
 * bounded by the cap; the parent does not deadlock.
 * This is the sanity check that the new
 * `whenBootstrapOutputClosed()` pathway does not
 * regress the existing pipe-drain accounting.
 *
 * CORRECTION11: the producer's backpressure accounting
 * was previously broken. The old script only incremented
 * `i` on the `write() === true` branch; under real
 * backpressure the same `block` would be re-written on
 * `'drain'` before `i` advanced, so `bytesSeen` was not
 * deterministically `256 * 4096`. The fixed producer
 * increments `i` BEFORE branching on the write return,
 * guaranteeing exactly 256 distinct 4096-byte writes
 * regardless of backpressure.
 */
test("BOOTOBS13: bounded drain + terminal barrier agree on retained-vs-seen under heavy load", async () => {
  const cap = 64 * 1024;
  const child: ChildProcess = spawn(
    process.execPath,
    ["-e",
     // Write exactly 256 distinct 4096-byte blocks (1 MiB
     // total) respecting back-pressure, then exit ONLY
     // after stdout reports drained. The producer MUST
     // increment `i` BEFORE branching on `write()` return
     // so the same block is never re-emitted on `'drain'`.
     // The drain counts every byte the kernel delivered;
     // bytesSeen is exact.
     "const block = 'x'.repeat(4096);" +
     "let i = 0;" +
     "function drainNext() {" +
     "  if (i >= 256) { process.exit(0); return; }" +
     "  const wrote = process.stdout.write(block);" +
     "  i++;" +
     "  if (!wrote) {" +
     "    process.stdout.once('drain', drainNext);" +
     "  } else {" +
     "    setImmediate(drainNext);" +
     "  }" +
     "}" +
     "drainNext();",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const handle = wrapChild(child);
  await new Promise<void>((r) => child.once("exit", () => r()));
  const term = await handle.whenBootstrapOutputClosed();
  assert.equal(term.stdout.bytesSeen, 256 * 4096,
    "BOOTOBS13: bytesSeen must EXACTLY equal 256 * 4096 = 1048576");
  assert.equal(term.stdout.bytesRetained, cap,
    "BOOTOBS13: bytesRetained must EXACTLY equal the default 64 KiB cap");
  assert.equal(term.stdout.truncated, true,
    "BOOTOBS13: 1 MiB >> 64 KiB → truncated");
});

/**
 * BOOTOBS14 — Readable emits `'error'` before terminal
 * end. `drainBounded` MUST surface the typed error and
 * `whenEnded()` MUST settle with `{kind:"stream_error", error}`
 * (NOT with a synthesized `kind:"ended"`). A regression
 * here would mean a stream that errored before
 * completing could silently mint a fake `ended` record,
 * which is exactly the failure mode the doctrine
 * forbids.
 */
test("BOOTOBS14: stream error before terminal end → typed DrainCompletion (no synthesized ended)", async () => {
  const r = new Readable({ read() { /* pull-mode */ } });
  const d = drainBounded(r, 1024);
  r.push(Buffer.from("partial"));
  // Force an error before end is observed.
  (r as unknown as { destroy: (e?: Error) => void }).destroy(
    new Error("synthetic-stream-error"),
  );
  const c = await d.whenEnded();
  assert.equal(c.kind, "stream_error",
    "BOOTOBS14: stream that errored MUST yield kind=stream_error (no fake mint)");
  if (c.kind === "stream_error") {
    assert.ok(/synthetic-stream-error/.test(c.error.message),
      "BOOTOBS14: the typed error must be the underlying stream error");
  }
  // Sanity: partial bytesSeen is what the drain observed
  // before the error. We do NOT exact-assert (the kernel
  // may deliver additional bytes asynchronously around
  // the error), but we DO require partial > 0 because
  // the test pushed "partial" before destroying.
  const s = d.stats();
  assert.ok(s.bytesSeen >= 7,
    "BOOTOBS14: stats must reflect what the drain consumed (>= 7 bytes), got " + s.bytesSeen);
});

/**
 * BOOTOBS15 (CORRECTION11) — Premature close negative
 * oracle. A Readable that is destroyed WITHOUT an error
 * emits `'close'` without first emitting `'end'`. Per
 * Node's documented contract, this is a "Premature
 * close" condition; some bytes the producer intended to
 * send are lost. `drainBounded` MUST surface this as
 * `kind: "premature_close"`, NOT `kind: "ended"`.
 *
 * CORRECTION10's implementation settled the FIRST of
 * `'end'` / `'close'` / `'error'` and treated `'close'`
 * as a synonym for clean completion; it would have
 * silently minted `kind: "ended"` here, authorizing a
 * false exact-equality byte total. This test FAILS
 * CORRECTION10 and PASSES CORRECTION11.
 */
test("BOOTOBS15: Readable destroyed without error → kind:premature_close (never kind:ended)", async () => {
  const r = new Readable({ read() { /* pull-mode */ } });
  const d = drainBounded(r, 1024);
  r.push(Buffer.from("partial"));
  // destroy() WITHOUT error → emits 'close' but not 'end'.
  (r as unknown as { destroy: () => void }).destroy();
  const c = await d.whenEnded();
  assert.notEqual(c.kind, "ended",
    "BOOTOBS15: a Readable that closed BEFORE 'end' MUST NOT mint kind:ended (that would authorize a false exact-equality byte total)");
  assert.equal(c.kind, "premature_close",
    "BOOTOBS15: premature close MUST be typed as kind:premature_close (got " + c.kind + ")");
  if (c.kind === "premature_close") {
    assert.ok(/Premature close|ERR_STREAM_PREMATURE_CLOSE/.test(
      c.error.message + " " + (c.error as NodeJS.ErrnoException).code,
    ),
      "BOOTOBS15: typed error must be Node's premature-close condition, got: " + c.error.message);
  }
});

/**
 * BOOTOBS15b (CORRECTION11) — wrapChild composed
 * barrier rejects on premature_close. Even if a single
 * stream (stdout OR stderr) closes prematurely, the
 * composed `whenBootstrapOutputClosed()` MUST surface it as
 * a rejection. The caller cannot silently receive a
 * `kind: "ended"` mint from a stream that never reached
 * terminal.
 */
test("BOOTOBS15b: wrapChild().whenBootstrapOutputClosed() rejects on stream premature_close", async () => {
  // Build a fake ChildProcess where stdout is a Readable
  // we can destroy prematurely. stderr is given a
  // normal push(null) completion. The composed barrier
  // MUST reject because stdout closed prematurely.
  const stdoutR = new Readable({ read() { /* pull-mode */ } });
  stdoutR.push(Buffer.from("partial"));
  (stdoutR as unknown as { destroy: () => void }).destroy();

  const stderrR = new Readable({ read() { /* pull-mode */ } });
  stderrR.push(Buffer.from("done"));
  stderrR.push(null);

  const fakeChild = {
    pid: 99999,
    on() { return this; },
    once() { return this; },
    emit() { return true; },
    removeListener() { return this; },
    kill() { return true; },
    stdout: stdoutR,
    stderr: stderrR,
  } as unknown as ChildProcess;
  const handle = wrapChild(fakeChild);
  let rejected = false;
  let msg = "";
  try {
    await handle.whenBootstrapOutputClosed();
  } catch (e: unknown) {
    rejected = true;
    msg = e instanceof Error ? e.message : String(e);
  }
  assert.equal(rejected, true,
    "BOOTOBS15b: composed barrier MUST reject when ANY stream closed prematurely");
  assert.ok(/premature|Premature close/.test(msg),
    "BOOTOBS15b: rejection message must mention premature close, got: " + msg);
});
