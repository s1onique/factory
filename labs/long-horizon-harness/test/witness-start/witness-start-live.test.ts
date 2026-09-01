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
  DEFAULT_LIVE_MISSION_ID,
  DEFAULT_LIVE_RUN_ID,
  findStartIntent,
  mkLiveSpec,
  mkTmp,
  readLedger,
  startLiveWriter,
  udsPathTooLong,
  type LiveRunHandle,
} from "./_wstart_live_helpers.js";
import { ledgerWriterSocketPath } from "../../src/ledger-writer/ledger-writer-process.js";
import {
  awaitWitnessReady,
  type ExpectedBinding,
} from "./witness-start-readiness.js";
import {
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
 * CORRECTION04 (Phase A): every real witness child
 * returned by startWitness MUST be registered in the
 * live registry, and MUST be unregistered ONLY after
 * `proveChildAbsent` succeeded.
 *
 * Architectural split (CORRECTION04):
 *
 *   - The TEST SITE owns the child. It is the
 *     authority on cleanup. It MAY send SIGTERM.
 *   - The RESIDUE ORACLE only proves what happened.
 *     It NEVER sends a signal. Calling
 *     `proveChildAbsent` does NOT cause a kill.
 *
 * Signal-sent is not proof-of-cleanup (Q15) — only
 * kernel ESRCH observed via `kill(pid, 0)` is.
 *
 * CORRECTION04 type hygiene: `registerWitnessSpawn`
 * accepts a narrow `OwnedChildPort` (pid + optional
 * kill). The witness's child ref is widened to that
 * port at the registration boundary;
 * `proveChildAbsent` operates on the real
 * ChildProcess (single explicit cast inside this
 * helper).
 */
async function terminateAndProveWitness(
  entry: LiveFixtureEntry,
): Promise<boolean> {
  const child = entry.ref as unknown as import("node:child_process").ChildProcess;
  // TEST-SITE cleanup authority. The oracle is
  // observation-only; THIS call is owned by the test
  // that produced the child.
  try { child.kill("SIGTERM"); } catch { /* */ }
  await new Promise((res) => setTimeout(res, 100));
  // ORACLE call. The oracle performs NO kill, NO
  // signal; it only observes (kill(pid,0), exitCode,
  // signalCode). The previous kill above is the
  // legacy "best effort" signal that the test sends
  // before asking the oracle to PROVE what happened.
  const r = await proveChildAbsent(child);
  // CORRECTION04: Only "pid_absent" clears the
  // registry. All other observations — alive,
  // child_terminated, permission_denied,
  // identity_unavailable — retain the fixture so the
  // strict lane reports residue. "absent" (the old
  // overloaded label) is gone; kernel ESRCH is
  // `pid_absent`, Node's exit boundary is
  // `child_terminated`. `cleanup_failed` is also
  // gone — the oracle never performs cleanup.
  const absent = r.kind === "pid_absent";
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
  // CORRECTION04 (endpoint-binding law):
  //
  //   The capability-owning component (frozen
  //   startLedgerWriter) returns its authoritative socket
  //   path via `r.socketPath`. We MUST propagate that
  //   exact path; we MUST NOT reconstruct it from a naming
  //   convention.
  //
  //   The preflight length probe uses the CANONICAL helper
  //   so it measures the path the writer WILL bind, not a
  //   second-hand guess.
  const writerSocketPath = ledgerWriterSocketPath(runDir);
  const socketPath = path.join(runDir, "witness.sock");
  if (udsPathTooLong(writerSocketPath) || udsPathTooLong(socketPath)) {
    await fs.rm(runDir, { recursive: true, force: true });
    await fs.rm(controlDir, { recursive: true, force: true });
    return { skip: true, reason: "uds path > 100 bytes budget on this host" };
  }
  // CORRECTION07 (context-binding law):
  //
  //   Establish a SINGLE {runId, missionId} tuple here
  //   and thread it into BOTH the writer spawn and the
  //   witness spec. The previous version constructed
  //   ("test-run", "test-mission") inside
  //   startLiveWriter and ("run-live", "mis-live") inside
  //   mkLiveSpec, causing a content_hash_mismatch on the
  //   short-path host.
  const runId = DEFAULT_LIVE_RUN_ID;
  const missionId = DEFAULT_LIVE_MISSION_ID;
  const writer = await startLiveWriter({ runDir, runId, missionId });
  // CORRECTION04: assert the writer bound EXACTLY the
  // canonical path. If startLedgerWriter ever changes its
  // binding convention, this fails fast instead of
  // silently re-deriving a wrong endpoint.
  if (writer.socketPath !== writerSocketPath) {
    throw new Error(
      `CORRECTION04 invariant violated: writer bound ${writer.socketPath} ` +
        `but canonical helper says ${writerSocketPath}`,
    );
  }
  // CORRECTION07: pin that the writer's binding carries
  // the SAME runId / missionId we supplied. The writer
  // returned those via who-are-you during spawn; this
  // is a sanity check that the spawn handshake honored
  // the caller's intent (the spawn-time invariant in
  // startLiveWriter already enforces this at the helper
  // layer; this is a redundant belt-and-braces pin).
  const who = await writer.whoAreYou();
  if (!who.ok) {
    throw new Error(
      `CORRECTION07 invariant probe failed: whoAreYou: ${who.error.kind}`,
    );
  }
  if (who.runId !== runId) {
    throw new Error(
      `CORRECTION07 invariant violated: writer runId=${who.runId} ` +
        `but caller supplied ${runId}`,
    );
  }
  if (who.missionId !== missionId) {
    throw new Error(
      `CORRECTION07 invariant violated: writer missionId=${who.missionId} ` +
        `but caller supplied ${missionId}`,
    );
  }
  return {
    runDir,
    controlDir,
    runId,
    missionId,
    writer,
    socketPath,
    writerSocketPath,
  };
}

async function teardown(run: LiveRunHandle): Promise<void> {
  try { await run.writer.stop(); } catch { /* */ }
  try { await fs.rm(run.runDir, { recursive: true, force: true }); } catch { /* */ }
  try { await fs.rm(run.controlDir, { recursive: true, force: true }); } catch { /* */ }
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
    const spec = mkLiveSpec(run);
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
        // CORRECTION04 type hygiene: r.value.child is a
        // WitnessSpawnHandle (narrow). registerWitnessSpawn
        // accepts the narrower OwnedChildPort (pid +
        // optional kill). No `as unknown as ChildProcess`
        // widening.
        child: r.value.child,
        witnessInstanceId: r.value.identity.witnessInstanceId,
        runDir: run.runDir,
      });
      // CORRECTION04: the witness bootstrap fails closed
      // with exit code 2 if --ledger-writer-socket-path is
      // missing (B0-C01-11). After a short grace period,
      // verify the child did NOT immediately exit — that
      // would prove the writer binding was carried into
      // the bootstrap argv and was a real, bindable path.
      const handle = r.value.child as unknown as {
        on?: (
          e: "exit",
          l: (code: number | null, signal: NodeJS.Signals | null) => void,
        ) => unknown;
      };
      let earlyExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        earlyExit = { code, signal };
      };
      try { handle.on?.("exit", onExit); } catch { /* */ }
      await new Promise((res) => setTimeout(res, 200));
      if (earlyExit !== null) {
        assert.fail(
          "WSTART-LIVE01: witness child exited immediately with " +
            JSON.stringify(earlyExit) +
            " — likely bootstrap argv missing ledgerWriterSocketPath",
        );
      }
    } else {
      assert.fail("WSTART-LIVE01: start must succeed on a live run; got " + JSON.stringify(r.failure));
    }
    // CORRECTION02: the readiness barrier below
    // (awaitWitnessReady) handles its own polling and
    // deadline; no 200ms grace sleep is needed.
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
      // CORRECTION05: the B0 frozen grammar
      // `^[A-Za-z0-9_.:-]{1,128}$` rejects slashes. The
      // namespace separator is ":" (NOT "/"). Mirror the
      // canonical predicate from witness-start-unit.test.ts:
      //   prefix == "w-start:"
      //   no "/"
      assert.equal(commitId.startsWith("w-start:"), true,
        `WSTART-LIVE01: commitId must be in w-start: namespace; got ${commitId}`);
      assert.equal(commitId.includes("/"), false,
        `WSTART-LIVE01: commitId must NOT contain '/' (B0 grammar); got ${commitId}`);
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
    // CORRECTION02 (real readiness proof): the soft
    // check ("if witness_ready happens to exist in the
    // ledger") is replaced with a HARD readiness barrier.
    // We MUST observe a durable witness_ready verified
    // against the FULL identity (runId, missionId,
    // witnessId, witnessInstanceId, socketPath) before
    // LIVE01 PASS. spawn != usable bootstrap; this is
    // the proof that the real witness reached real
    // readiness.
    if (!r.ok) {
      assert.fail("WSTART-LIVE01: start must succeed before readiness check");
      return; // unreachable; the assert.fail throws
    }
    const expectedBinding: ExpectedBinding = {
      runId: run.runId,
      missionId: run.missionId,
      witnessId: "w-start-live",
      witnessInstanceId: r.value.identity.witnessInstanceId as string,
      socketPath: spec.socketPath as string,
    };
    const readyR = await awaitWitnessReady({
      runDir: run.runDir,
      expected: expectedBinding,
      child: r.value.child,
      deadlineMs: 5000,
      pollIntervalMs: 25,
    });
    assert.equal(readyR.kind, "ready",
      "WSTART-LIVE01: real durable witness_ready MUST be observed for " +
      "the FULL expected identity within the deadline " +
      "(spawn != usable bootstrap; got: " + JSON.stringify(readyR) + ")");
    if (readyR.kind === "ready" && intent !== null) {
      // Sequence ordering: witness_ready.seq MUST be >
      // witness_start_requested.seq (durability law:
      // ready cannot precede intent).
      const intentSeq = intent["sequence"] as number;
      assert.ok(readyR.sequence > intentSeq,
        "WSTART-LIVE01: ready.seq (" + readyR.sequence + ") MUST be > " +
        "intent.seq (" + intentSeq + ")");
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
    const spec = mkLiveSpec(run, {
      ledgerWriterSocketPath:
        "/tmp/no-such-writer-socket-" + Date.now() + ".sock",
    });
    const spawnPort = {
      spawn: async (): Promise<{
        ok: true;
        handle: {
          pid: number | null;
          kill: (signal?: NodeJS.Signals) => boolean;
          on: (event: "exit" | "error", listener: unknown) => unknown;
          bootstrapOutput: () => {
            stdout: Uint8Array;
            stderr: Uint8Array;
            stdoutBytesSeen: number;
            stderrBytesSeen: number;
            stdoutTruncated: boolean;
            stderrTruncated: boolean;
          };
          exitInfo: () => {
            pid: number | null;
            code: number | null;
            signal: NodeJS.Signals | null;
            exited: boolean;
          };
        };
      }> => {
        spawnCalls += 1;
        return {
          ok: true,
          handle: {
            pid: 1,
            kill: (_signal?: NodeJS.Signals): boolean => true,
            on: (_event: "exit" | "error", _listener: unknown): unknown => ({}),
            bootstrapOutput: () => ({
              stdout: new Uint8Array(0),
              stderr: new Uint8Array(0),
              stdoutBytesSeen: 0,
              stderrBytesSeen: 0,
              stdoutTruncated: false,
              stderrTruncated: false,
            }),
            exitInfo: () => ({ pid: 1, code: null, signal: null, exited: false }),
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
    const spec = mkLiveSpec(run);
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
  // CORRECTION04: single-source residue count.
  // `sweepAndProve()` returns the set of fixtures that
  // could NOT be proven absent; it ALSO leaves them in
  // the registry (so the strict lane fails closed).
  // Therefore `failed.length === liveFixtureRegistrySize()`.
  // Using `failed.length + liveFixtureRegistrySize()` would
  // double-count. We use one source — `failed.length`.
  const failed = await sweepAndProve();
  residue = failed.length;
  if (STRICT && residue > 0) {
    fail += 1;
  }
  // CORRECTION02: typed residue breakdown so the
  // operator can tell env denial apart from a real
  // ownership defect.
  const breakdown: Record<string, number> = {};
  for (const e of failed) {
    const obs = (e as { observation?: string }).observation ?? "unknown";
    breakdown[obs] = (breakdown[obs] ?? 0) + 1;
  }
  // eslint-disable-next-line no-console
  console.log(`WITNESS_START_LIVE_RESIDUE=${residue}`);
  if (Object.keys(breakdown).length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `WITNESS_START_LIVE_RESIDUE_BREAKDOWN=${JSON.stringify(breakdown)}`,
    );
  }
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
    residueBreakdown: breakdown,
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
