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
  countStartIntents,
  findReadyForInstance,
  findStartIntent,
  mkLiveSpec,
  mkTmp,
  readLedger,
  startLiveWriter,
  udsPathTooLong,
  type LiveRunHandle,
} from "./_wstart_live_helpers.js";
import {
  liveFixtureRegistrySize,
  proveChildAbsent,
  registerWitnessSpawn,
  snapshotLiveFixtures,
  sweepAndProve,
  unregisterLiveFixture,
  type LiveFixtureEntry,
} from "../ledger-writer/_live_registry.js";

const STRICT = process.env.FACTORY_STRICT_WITNESS_START_LIVE === "1";
const REQUIRED = 3;
let exec = 0;
let pass = 0;
let fail = 0;
let skip = 0;
let residue = 0;

/**
 * CORRECTION02 (Phase A): every real witness child
 * returned by startWitness MUST be registered in the
 * live registry, and MUST be unregistered ONLY after
 * `proveChildAbsent` succeeded. Signal-sent is not
 * proof-of-cleanup (Q15).
 */
async function terminateAndProveWitness(entry: LiveFixtureEntry): Promise<boolean> {
  const child = entry.ref as import("node:child_process").ChildProcess;
  // Best-effort SIGTERM first; let the witness exit
  // cleanly (it may be writing witness_lost, etc.).
  try { child.kill("SIGTERM"); } catch { /* */ }
  // Give it a small grace period, then escalate.
  await new Promise((res) => setTimeout(res, 100));
  const absent = await proveChildAbsent(child);
  if (absent) {
    unregisterLiveFixture(entry);
  }
  return absent;
}

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

/**
 * Phase A post-suite residue oracle.
 *
 * CORRECTION02: residue is now derived from the live
 * registry (`sweepAndProve()` + `liveFixtureRegistrySize()`),
 * matching the LedgerWriter qualification. A standalone
 * integer set to 0 in setup is no longer enough — every
 * registered fixture MUST be proven absent before it is
 * unregistered.
 */
function computeResidue(): number {
  return liveFixtureRegistrySize();
}

test("WSTART-LIVE01: durable intent then real spawn (sole intent)", async () => {
  exec += 1;
  let run: LiveRunHandle | { skip: true; reason: string } | null = null;
  let r: Awaited<ReturnType<typeof startWitness>> | null = null;
  let witnessEntry: LiveFixtureEntry | null = null;
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
        "WSTART-LIVE01: child.pid must be set after successful spawn (Node 'spawn' fired)");
      // CORRECTION02: register the witness in the live
      // registry so the strict lane's residue oracle
      // cannot certify WITNESS_START_LIVE_RESIDUE=0
      // without proving the witness actually disappeared.
      witnessEntry = registerWitnessSpawn({
        child: r.value.child as unknown as import("node:child_process").ChildProcess,
        witnessInstanceId: r.value.identity.witnessInstanceId,
        runDir: run.runDir,
      });
    } else {
      assert.fail("WSTART-LIVE01: start must succeed on a live run; got " + JSON.stringify(r.failure));
    }
    // Give the witness a moment to write witness_ready
    // before reading the ledger.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const ledger = await readLedger(run.runDir);
    // SOLE INTENT: exactly one witness_start_requested
    // (the supervisor's). The witness process must NOT
    // also have written one (P1#3).
    const intents = countStartIntents(ledger);
    assert.equal(intents, 1,
      "WSTART-LIVE01: ledger must contain EXACTLY ONE witness_start_requested (sole-producer)");
    const intent = findStartIntent(ledger);
    assert.notEqual(intent, null,
      "WSTART-LIVE01: ledger must contain witness_start_requested");
    const commitId = (intent as Record<string, unknown>)["commit_id"];
    if (typeof commitId === "string") {
      assert.ok(commitId.startsWith("w-start/"),
        "WSTART-LIVE01: commitId must be in w-start/ namespace");
    }
    // Identity tuple: the committed intent's runId/missionId
    // envelope (runId lives at the envelope level; missionId
    // at the envelope level too). Verify BOTH equalities.
    // CORRECTION02: previous WSTART-LIVE01 only checked
    // run_id; the committed mission_id was never asserted.
    const envRunId = (intent as Record<string, unknown>)["run_id"];
    assert.equal(envRunId, "run-live",
      "WSTART-LIVE01: committed intent runId must equal spec.runId");
    const envMissionId = (intent as Record<string, unknown>)["mission_id"];
    assert.equal(envMissionId, "mis-live",
      "WSTART-LIVE01: committed intent missionId must equal spec.missionId");
    // Identity tuple: spawn spec carried the same witnessId
    // and witnessInstanceId as the committed intent's
    // payload.
    if (intent === null) {
      assert.fail("WSTART-LIVE01: intent is null after countStartIntents=1");
    }
    const intentPayload = intent["witness_evidence"] as Record<string, unknown>;
    assert.equal(intentPayload["witness_id"], "w-start-live",
      "WSTART-LIVE01: committed witness_id must equal suggestedWitnessId");
    const wiId = intentPayload["witness_instance_id"];
    if (r.ok) {
      assert.equal(wiId, r.value.identity.witnessInstanceId,
        "WSTART-LIVE01: committed witness_instance_id must equal returned witnessInstanceId");
    }
    // Corresponding witness_ready for the same witness
    // instance, if it has been written by the time we read.
    const ready = findReadyForInstance(ledger, wiId as string);
    if (ready !== null) {
      const readyPayload = ready["witness_evidence"] as Record<string, unknown>;
      assert.equal(readyPayload["witness_id"], "w-start-live",
        "WSTART-LIVE01: witness_ready.witness_id must equal suggestedWitnessId");
      assert.equal(readyPayload["witness_instance_id"], wiId,
        "WSTART-LIVE01: witness_ready.witness_instance_id must equal intent's witness_instance_id");
    }
    pass += 1;
  } catch (e) {
    fail += 1;
    throw e;
  } finally {
    // CORRECTION02: prove the witness child is gone BEFORE
    // unregistering it. This is the residue oracle that
    // makes WITNESS_START_LIVE_RESIDUE meaningful.
    if (witnessEntry !== null) {
      const absent = await terminateAndProveWitness(witnessEntry);
      assert.equal(absent, true,
        "WSTART-LIVE01: witness child must be proven absent before unregistering (residue oracle)");
    }
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
      spawn: async (): Promise<{
        ok: true;
        handle: {
          pid: number | null;
          kill: (signal?: NodeJS.Signals) => boolean;
          on: (event: "exit" | "error", listener: unknown) => unknown;
        };
      }> => {
        spawnCalls += 1;
        return {
          ok: true,
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

test("WSTART-LIVE03: durable intent then spawn ENOENT (bad nodePath)", async () => {
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
    // Use a non-existent nodePath. Node.spawn will fail to
    // exec() (ENOENT) and emit a synchronous or near-
    // synchronous 'error' event. The spawn adapter resolves
    // spawn_failed.
    //
    // The previous version of this test pointed at a bad
    // witnessesEntry (the JS file the spawned Node would
    // load). That is NOT a true spawn failure: Node
    // successfully spawned; the child later died when it
    // could not load the script. Node's `'spawn'` event
    // fires for the Node process itself, not for the JS
    // module load.
    const badSpec = {
      ...spec,
      nodePath: "/no/such/node/executable",
    };
    r = await startWitness(badSpec, { spawn: nodeSpawnWitnessPort() });
    // Required: spawn_failed, never ok:true (WS09b).
    assert.equal(r.ok, false,
      "WSTART-LIVE03: invalid nodePath must yield spawn_failed, not ok:true");
    if (!r.ok) {
      assert.equal(r.failure.kind, "spawn_failed",
        "WSTART-LIVE03: failure must be spawn_failed");
      if (r.failure.kind === "spawn_failed") {
        // Pre-spawn 'error' yields spawn_error_event;
        // synchronous throw from spawn() yields spawn_threw.
        assert.ok(
          r.failure.cause.kind === "spawn_error_event" ||
            r.failure.cause.kind === "spawn_threw",
          "WSTART-LIVE03: cause must be spawn_error_event or spawn_threw, got " +
            r.failure.cause.kind,
        );
      }
    }
    // The durable intent must have been written before the
    // spawn attempt.
    const ledger = await readLedger(run.runDir);
    const intent = findStartIntent(ledger);
    assert.notEqual(intent, null,
      "WSTART-LIVE03: ledger must contain witness_start_requested (intent durably committed before spawn)");
    const intents = countStartIntents(ledger);
    assert.equal(intents, 1,
      "WSTART-LIVE03: exactly one witness_start_requested (sole-producer)");
    // No witness_ready may exist (spawn never succeeded).
    const hasReady = ledger.some(
      (env) =>
        env["kind"] === "witness_evidence" &&
        env["witness_evidence"] !== undefined &&
        (env["witness_evidence"] as Record<string, unknown>)["kind"]
          === "witness_ready",
    );
    assert.equal(hasReady, false,
      "WSTART-LIVE03: ledger must NOT contain witness_ready");
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
  // CORRECTION02: residue is now DERIVED from the live
  // registry, not from a standalone integer. The post-
  // suite sweep attempts to prove every registered
  // fixture absent (children: ESRCH via kill loop;
  // paths: lstat ENOENT). Anything that cannot be
  // proven absent is residue.
  const failed = await sweepAndProve();
  residue = failed.length + computeResidue();
  if (STRICT && residue > 0) {
    fail += 1;
  }
  // eslint-disable-next-line no-console
  console.log(`WITNESS_START_LIVE_RESIDUE=${residue}`);
  if (residue > 0) {
    // eslint-disable-next-line no-console
    console.log(
      "WITNESS_START_LIVE_RESIDUE_DETAIL=" +
        JSON.stringify(snapshotLiveFixtures()),
    );
  }
  const disposition =
    fail === 0 && skip === 0 && residue === 0 && pass === REQUIRED
      ? "OK" : "FAIL";
  emit({
    kind: "witness_start_live_matrix",
    strict: STRICT,
    required: REQUIRED,
    executed: exec,
    passed: pass,
    failed: fail,
    skipped: skip,
    residue,
    disposition,
  });
  // eslint-disable-next-line no-console
  console.log(`WITNESS_START_LIVE_DISPOSITION=${disposition}`);
  if (STRICT && disposition !== "OK") {
    throw new Error(
      "WITNESS_START_LIVE_DISPOSITION=FAIL: " +
        "passed=" + pass + " required=" + REQUIRED +
        "; failed=" + fail + "; skipped=" + skip +
        "; residue=" + residue,
    );
  }
});

void assert;
void path;
