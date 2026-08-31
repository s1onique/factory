/**
 * FOUNDATION04 — PHASE A — Live tests for the witness-start
 * gate. WSTART-LIVE01..03 use the real frozen LedgerWriter
 * and a real Node spawn of the witness helper.
 *
 * On hosts where the UDS socket path exceeds the 100-byte
 * budget (macOS dev sandbox), the live tests SKIP
 * honestly. They emit the same matrix counters as the
 * ledger-writer live qualification.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";

import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  startWitness,
  makeProductionWitnessStart,
} from "../../src/witness-start/witness-start-gate.js";
import { nodeSpawnWitnessPort } from "../../src/witness-start/witness-start-spawn.js";
import {
  findStartIntent,
  mkLiveSpec,
  mkTmp,
  readLedger,
  startLiveWriter,
  udsPathTooLong,
  type LiveRunHandle,
} from "./_wstart_live_helpers.js";

const STRICT = process.env.FACTORY_STRICT_WITNESS_START_LIVE === "1";
const REQUIRED = 3;
let exec = 0;
let pass = 0;
let fail = 0;
let skip = 0;
let residue = 0;

function emit(rec: unknown): void {
  process.stdout.write(JSON.stringify(rec) + "\n");
}

async function setupLiveRun(prefix: string): Promise<
  LiveRunHandle | { skip: true; reason: string }
> {
  const runDir = await mkTmp(prefix);
  const controlDir = await fs.mkdtemp(
    path.join(runDir, "..", ".c-" + prefix + "-"),
  );
  // Check UDS path length BEFORE starting the writer. On
  // hosts where tmpdir is too deep (>100 bytes for the UDS
  // path), the writer will fail to bind. Detect and skip
  // honestly.
  const writerSocketPath = path.join(runDir, "ledger-writer.sock");
  const socketPath = path.join(runDir, "witness.sock");
  if (udsPathTooLong(writerSocketPath) || udsPathTooLong(socketPath)) {
    await fs.rm(runDir, { recursive: true, force: true });
    await fs.rm(controlDir, { recursive: true, force: true });
    return { skip: true, reason: "uds path > 100 bytes budget on this host" };
  }
  const writer = await startLiveWriter(runDir);
  return { runDir, controlDir, writer, socketPath, writerSocketPath };
}

async function teardown(run: LiveRunHandle): Promise<void> {
  try { await run.writer.stop(); } catch { /* */ }
  try { await fs.rm(run.runDir, { recursive: true, force: true }); } catch { /* */ }
  try { await fs.rm(run.controlDir, { recursive: true, force: true }); } catch { /* */ }
}

test("WSTART-LIVE01: durable intent then real spawn", async () => {
  exec += 1;
  let run: LiveRunHandle | { skip: true; reason: string } | null = null;
  let r: Awaited<ReturnType<typeof startWitness>> | null = null;
  try {
    const s = await setupLiveRun("a");
    if ("skip" in s) { skip += 1; return; }
    run = s;
    const spec = mkLiveSpec({
      runDir: run.runDir,
      controlDir: run.controlDir,
      socketPath: run.socketPath,
      writerSocketPath: run.writerSocketPath,
    });
    const start = makeProductionWitnessStart();
    r = await start(spec);
    if (r.ok) {
      assert.ok(r.value.identity.witnessId.length > 0);
      assert.notEqual(r.value.child.pid, null,
        "WSTART-LIVE01: child.pid must be set after successful spawn");
      try { r.value.child.kill("SIGTERM"); } catch { /* */ }
    } else {
      assert.fail("WSTART-LIVE01: start must succeed on a live run; got " + JSON.stringify(r.failure));
    }
    const ledger = await readLedger(run.runDir);
    const intent = findStartIntent(ledger);
    assert.notEqual(intent, null,
      "WSTART-LIVE01: ledger must contain witness_start_requested");
    const commitId = (intent as Record<string, unknown>)["commit_id"];
    if (typeof commitId === "string") {
      assert.ok(commitId.startsWith("w-start/"),
        "WSTART-LIVE01: commitId must be in w-start/ namespace");
    }
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    void r;
    if (run !== null && !("skip" in run)) {
      await teardown(run);
    }
  }
});

test("WSTART-LIVE02: ledger failure then zero child", async () => {
  exec += 1;
  const liveRun = await setupLiveRun("b");
  if ("skip" in liveRun) { skip += 1; return; }
  const run: LiveRunHandle = liveRun;
  let r: Awaited<ReturnType<typeof startWitness>> | null = null;
  let spawnCalls = 0;
  try {
    const spec = mkLiveSpec({
      runDir: run.runDir,
      controlDir: run.controlDir,
      socketPath: run.socketPath,
      writerSocketPath: "/tmp/no-such-writer-socket-" + Date.now() + ".sock",
    });
    const spawnPort = {
      spawn: () => {
        spawnCalls += 1;
        return {
          ok: true as const,
          handle: {
            pid: 1,
            kill: (_signal?: NodeJS.Signals): boolean => true,
            on: (_event: "exit" | "error", _listener: unknown): unknown => ({}),
          },
        };
      },
    };
    r = await startWitness(spec, { spawn: spawnPort });
    assert.equal(r.ok, false,
      "WSTART-LIVE02: result must be ok:false");
    if (!r.ok) {
      assert.equal(r.failure.kind, "intent_persistence_failed",
        "WSTART-LIVE02: failure must be intent_persistence_failed");
      if (r.failure.kind === "intent_persistence_failed") {
        assert.equal(r.failure.cause.kind, "writer_unavailable",
          "WSTART-LIVE02: cause must be writer_unavailable");
      }
    }
    assert.equal(spawnCalls, 0,
      "WSTART-LIVE02: spawn must NOT be called");
    const ledger = await readLedger(run.runDir);
    assert.equal(ledger.length, 0,
      "WSTART-LIVE02: events.jsonl must have 0 records");
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    void r;
    await teardown(run);
  }
});

test("WSTART-LIVE03: durable intent then spawn ENOENT", async () => {
  exec += 1;
  const liveRun = await setupLiveRun("c");
  if ("skip" in liveRun) { skip += 1; return; }
  const run: LiveRunHandle = liveRun;
  let r: Awaited<ReturnType<typeof startWitness>> | null = null;
  try {
    const spec = mkLiveSpec({
      runDir: run.runDir,
      controlDir: run.controlDir,
      socketPath: run.socketPath,
      writerSocketPath: run.writerSocketPath,
    });
    const badSpec = { ...spec, witnessesEntry: "/no/such/witness/entry.ts" };
    r = await startWitness(badSpec, { spawn: nodeSpawnWitnessPort() });
    // The gate currently returns ok:true synchronously
    // (spawn returns a handle; the error event fires
    // asynchronously). For the test we accept either:
    //   - ok:true, with the ledger containing intent but
    //     NOT witness_ready
    //   - ok:false with spawn_failed (some Node versions
    //     surface ENOENT synchronously)
    if (r.ok) {
      const ledger = await readLedger(run.runDir);
      const intent = findStartIntent(ledger);
      assert.notEqual(intent, null,
        "WSTART-LIVE03: ledger must contain witness_start_requested");
      const hasReady = ledger.some(
        (env) =>
          env["kind"] === "witness_evidence" &&
          env["witness_evidence"] !== undefined &&
          (env["witness_evidence"] as Record<string, unknown>)["kind"]
            === "witness_ready",
      );
      assert.equal(hasReady, false,
        "WSTART-LIVE03: ledger must NOT contain witness_ready");
      try { r.value.child.kill("SIGKILL"); } catch { /* */ }
    } else {
      assert.equal(r.failure.kind, "spawn_failed",
        "WSTART-LIVE03: synchronous ENOENT must yield spawn_failed");
    }
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    void r;
    await teardown(run);
  }
});

after(async () => {
  if (STRICT && residue > 0) {
    fail += 1;
  }
  emit({
    kind: "witness_start_live_matrix",
    strict: STRICT,
    required: REQUIRED,
    executed: exec,
    passed: pass,
    failed: fail,
    skipped: skip,
    residue,
    disposition:
      fail === 0 && skip === 0 && residue === 0 && pass === REQUIRED
        ? "OK" : "FAIL",
  });
});

void assert;
void path;
