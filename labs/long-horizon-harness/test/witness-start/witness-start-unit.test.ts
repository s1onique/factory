/**
 * FOUNDATION04 — PHASE A — Unit tests for the witness-start
 * gate. Exercises WS01..WS12 with in-memory fake ports.
 *
 * No real Node.spawn. No real LedgerWriter. Pure unit tests.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { startWitness } from "../../src/witness-start/witness-start-gate.js";
import {
  computeWitnessStartCommitId,
  type WitnessIntentCommitPort,
  type WitnessStartSpec,
} from "../../src/witness-start/witness-start-types.js";
import {
  FAILURES,
  SPAWN_FAILURES,
  SUCCESSES,
  makeFakeCommit,
  makeFakeHandle,
  makeFakeIdentity,
  makeFakeSpawn,
  type FakeCommit,
  type FakeIdentity,
  type FakeSpawn,
} from "./_wstart_unit_helpers.js";

function mkSpec(over: Partial<WitnessStartSpec> = {}): WitnessStartSpec {
  return {
    runDir: "/tmp/run",
    controlDir: "/tmp/ctrl",
    suggestedWitnessId: "w-suggest" as never,
    socketPath: "/tmp/run/s.sock",
    runId: "run-1" as never,
    missionId: "mis-1" as never,
    attemptId: "att-1" as never,
    processId: "proc-1" as never,
    protocolVersion: 1,
    bootstrapLeaseMs: 30000,
    ledgerWriterSocketPath: "/tmp/run/w.sock",
    witnessesEntry: "/dev/null/_witness_helper.ts",
    tsxLoader: "tsx",
    nodePath: process.execPath,
    ...over,
  };
}

function mkPorts(): {
  commit: FakeCommit;
  spawn: FakeSpawn;
  identity: FakeIdentity;
} {
  return {
    commit: makeFakeCommit(),
    spawn: makeFakeSpawn(),
    identity: makeFakeIdentity(),
  };
}

// WS01 — pending ACK blocks spawn
test("WS01: pending commit ACK blocks spawn", async () => {
  const ports = mkPorts();
  const r = startWitness(mkSpec(), ports);
  // While commit is pending, spawn must not have been called.
  assert.equal(ports.spawn.calls, 0,
    "WS01: spawn must not be called while commit is pending");
  // Now settle the pending commit.
  ports.commit.resolvePending({
    ok: true,
    outcome: SUCCESSES.appended(1),
  });
  const result = await r;
  assert.equal(result.ok, true,
    "WS01: result must be ok after ACK resolves");
  if (result.ok) {
    assert.equal(result.value.identity.witnessId, "w-n1",
      "WS01: identity must be the one allocated by the factory");
  }
  assert.equal(ports.spawn.calls, 1,
    "WS01: spawn must be called exactly once after ACK");
});

// WS02 — domain commit failure blocks spawn
test("WS02: ok:false intent commit blocks spawn", async () => {
  const ports = mkPorts();
  ports.commit.fail(FAILURES.append_failed("io"));
  const r = await startWitness(mkSpec(), ports);
  assert.equal(r.ok, false,
    "WS02: result must be ok:false");
  if (!r.ok) {
    assert.equal(r.failure.kind, "intent_persistence_failed",
      "WS02: failure kind must be intent_persistence_failed");
    if (r.failure.kind === "intent_persistence_failed") {
      assert.equal(r.failure.cause.kind, "append_failed",
        "WS02: cause must propagate");
    }
  }
  assert.equal(ports.spawn.calls, 0,
    "WS02: spawn must NOT be called");
  assert.equal(ports.identity.calls, 1,
    "WS02: identity IS allocated (precedes commit) but spawn does not follow");
});

// WS03 — rejected Promise blocks spawn
test("WS03: rejected commit Promise blocks spawn", async () => {
  const ports = mkPorts();
  ports.commit.stageReject("writer crashed mid-request");
  const r = await startWitness(mkSpec(), ports);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "intent_persistence_failed",
      "WS03: rejection is reported as intent_persistence_failed");
    if (r.failure.kind === "intent_persistence_failed") {
      assert.equal(r.failure.cause.kind, "transport_rejected",
        "WS03: cause kind must be transport_rejected");
    }
  }
  assert.equal(ports.spawn.calls, 0,
    "WS03: spawn must NOT be called after Promise rejection");
});

// WS04 — identity allocated exactly once
test("WS04: identity allocated exactly once on success", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  const r = await startWitness(mkSpec(), ports);
  assert.equal(ports.identity.calls, 1,
    "WS04: identity factory must be called exactly once on the success path");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(ports.spawn.lastSpec !== null, true);
    if (ports.spawn.lastSpec !== null) {
      assert.equal(ports.spawn.lastSpec.witnessId,
        r.value.identity.witnessId,
        "WS04: spawn witnessId must equal returned witnessId");
      assert.equal(ports.spawn.lastSpec.witnessInstanceId,
        r.value.identity.witnessInstanceId,
        "WS04: spawn witnessInstanceId must equal returned witnessInstanceId");
    }
  }
});

test("WS04b: invalid spec causes zero identity factory calls", async () => {
  const ports = mkPorts();
  const spec = mkSpec({ runDir: "" });
  const r = await startWitness(spec, ports);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "invalid_spec",
      "WS04b: invalid spec -> invalid_spec failure");
  }
  assert.equal(ports.identity.calls, 0,
    "WS04b: identity must NOT be allocated for invalid spec");
  assert.equal(ports.commit.calls, 0,
    "WS04b: commit must NOT be called for invalid spec");
  assert.equal(ports.spawn.calls, 0,
    "WS04b: spawn must NOT be called for invalid spec");
});

// WS05 — replay allows one spawn
test("WS05: replay outcome allows exactly one spawn", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.replay(7));
  const r = await startWitness(mkSpec(), ports);
  assert.equal(r.ok, true,
    "WS05: replay (like appended) must yield ok:true");
  assert.equal(ports.spawn.calls, 1,
    "WS05: spawn must be called exactly once");
});

// WS06 — conflicting commit blocks spawn
test("WS06: conflicting_commit blocks spawn", async () => {
  const ports = mkPorts();
  ports.commit.fail(FAILURES.conflicting_commit("different content for same commitId"));
  const r = await startWitness(mkSpec(), ports);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "intent_persistence_failed");
    if (r.failure.kind === "intent_persistence_failed") {
      assert.equal(r.failure.cause.kind, "conflicting_commit",
        "WS06: cause must be conflicting_commit, never reinterpreted as replay");
    }
  }
  assert.equal(ports.spawn.calls, 0,
    "WS06: conflicting_commit must block spawn");
});

// WS07 — invalid spec causes no commit/no spawn
test("WS07: invalid spec causes no commit and no spawn", async () => {
  const ports = mkPorts();
  const cases: ReadonlyArray<{ readonly name: string; readonly over: Partial<WitnessStartSpec> }> = [
    { name: "empty runDir", over: { runDir: "" } },
    { name: "empty controlDir", over: { controlDir: "" } },
    { name: "empty socketPath", over: { socketPath: "" } },
    { name: "empty ledgerWriterSocketPath",
      over: { ledgerWriterSocketPath: "" } },
    { name: "empty runId", over: { runId: "" as never } },
    { name: "empty missionId", over: { missionId: "" as never } },
    { name: "empty attemptId", over: { attemptId: "" as never } },
    { name: "empty processId", over: { processId: "" as never } },
    { name: "empty suggestedWitnessId",
      over: { suggestedWitnessId: "" as never } },
    { name: "zero protocolVersion", over: { protocolVersion: 0 } },
    { name: "zero bootstrapLeaseMs", over: { bootstrapLeaseMs: 0 } },
    { name: "negative protocolVersion",
      over: { protocolVersion: -1 } },
  ];
  for (const c of cases) {
    ports.commit.calls = 0;
    ports.identity.calls = 0;
    ports.spawn.calls = 0;
    const r = await startWitness(mkSpec(c.over), ports);
    assert.equal(r.ok, false, "WS07(" + c.name + "): must fail");
    if (!r.ok) {
      assert.equal(r.failure.kind, "invalid_spec",
        "WS07(" + c.name + "): failure kind");
    }
    assert.equal(ports.commit.calls, 0,
      "WS07(" + c.name + "): commit must not be called");
    assert.equal(ports.identity.calls, 0,
      "WS07(" + c.name + "): identity must not be allocated");
    assert.equal(ports.spawn.calls, 0,
      "WS07(" + c.name + "): spawn must not be called");
  }
});

// WS08 — spawn failure after durable intent
test("WS08: spawn failure after durable intent returns spawn_failed", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(42));
  ports.spawn.setNext({
    kind: "failure",
    failure: SPAWN_FAILURES.threw("EACCES"),
  });
  const r = await startWitness(mkSpec(), ports);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "spawn_failed",
      "WS08: failure must be spawn_failed");
    if (r.failure.kind === "spawn_failed") {
      assert.equal(r.failure.cause.kind, "spawn_threw",
        "WS08: cause must be spawn_threw");
      assert.equal(r.failure.identity.witnessId,
        ports.identity.next.witnessId,
        "WS08: identity must be present so recovery can find it");
    }
  }
  assert.equal(ports.commit.calls, 1,
    "WS08: commit WAS called (intent durably present)");
  assert.equal(ports.spawn.calls, 1,
    "WS08: spawn WAS attempted (and failed)");
});

test("WS08b: spawn error_event also yields spawn_failed", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(3));
  ports.spawn.setNext({
    kind: "failure",
    failure: SPAWN_FAILURES.error_event("ENOENT on entry script"),
  });
  const r = await startWitness(mkSpec(), ports);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "spawn_failed",
      "WS08b: error_event must produce spawn_failed");
    if (r.failure.kind === "spawn_failed") {
      assert.equal(r.failure.cause.kind, "spawn_error_event");
    }
  }
});

// WS09 — Real Node spawn semantics exercised in live lane.
test("WS09: success path returns a usable child handle", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  const r = await startWitness(mkSpec(), ports);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(typeof r.value.child.pid, "number",
      "WS09: child pid must be a number");
    assert.equal(typeof r.value.child.kill, "function",
      "WS09: child.kill must be callable");
    assert.equal(typeof r.value.child.on, "function",
      "WS09: child.on must be callable");
  }
});

// WS10 — no duplicate start intent
test("WS10: one startWitness call produces exactly one commit", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  await startWitness(mkSpec(), ports);
  assert.equal(ports.commit.calls, 1,
    "WS10: commit must be called exactly once per startWitness");
});

// WS11 — same CommitId on retry
test("WS11: same identity yields the same CommitId", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  await startWitness(mkSpec(), ports);
  const commitId1 = ports.commit.lastCommitId;
  const fixedId = ports.identity.next;

  // Override allocate to return the SAME fixed identity.
  ports.commit.calls = 0;
  ports.spawn.calls = 0;
  ports.commit.ok(SUCCESSES.replay(1));
  ports.identity.calls = 0;
  ports.identity.allocate = () => {
    ports.identity.calls += 1;
    return fixedId;
  };
  await startWitness(mkSpec(), ports);
  const commitId2 = ports.commit.lastCommitId;
  assert.equal(commitId1, commitId2,
    "WS11: same identity must yield same commitId (writer dedups)");
  assert.equal(computeWitnessStartCommitId(fixedId), commitId1,
    "WS11: commitId matches the canonical derivation");
});

// WS12 — no public bypass
test("WS12: omitting spawn port returns unknown failure", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  const r = await startWitness(mkSpec(), {
    commit: ports.commit as WitnessIntentCommitPort,
    identity: ports.identity,
  });
  assert.equal(r.ok, false,
    "WS12: without spawn port, must not return a StartedWitness");
  if (!r.ok) {
    assert.equal(r.failure.kind, "unknown",
      "WS12: failure kind must be unknown (cannot silently succeed)");
  }
  assert.equal(ports.spawn.calls, 0);
});

// Bonus: identity continuity
test("identity continuity: committed identity equals spawned identity", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  const r = await startWitness(mkSpec(), ports);
  assert.equal(r.ok, true);
  if (r.ok) {
    const v = r.value;
    const s = ports.spawn.lastSpec;
    assert.ok(s !== null);
    if (s !== null) {
      assert.equal(s.witnessId, v.identity.witnessId);
      assert.equal(s.witnessInstanceId, v.identity.witnessInstanceId);
      assert.equal(s.runId, v.identity.runId);
      assert.equal(s.missionId, v.identity.missionId);
      assert.equal(s.attemptId, v.identity.attemptId);
      assert.equal(s.processId, v.identity.processId);
    }
    assert.equal(ports.commit.lastCommitId,
      computeWitnessStartCommitId(v.identity));
  }
});

// Bonus: CommitId namespace law
test("commitId namespace starts with w-start/", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  await startWitness(mkSpec(), ports);
  assert.equal(
    (ports.commit.lastCommitId ?? "").startsWith("w-start/"),
    true,
    "CommitId must be namespaced w-start/",
  );
});

// Bonus: pending-then-resolve order
test("pending then resolve: spawn happens strictly after commit resolves", async () => {
  const ports = mkPorts();
  let spawnCalledAtMs: number | null = null;
  let commitResolvedAtMs: number | null = null;
  const originalSpawn = ports.spawn.spawn.bind(ports.spawn);
  ports.spawn.spawn = (spec) => {
    spawnCalledAtMs = Date.now();
    return originalSpawn(spec);
  };
  const r = startWitness(mkSpec(), ports);
  // Settle the pending commit. resolvePending records
  // the resolve time on its own microtask.
  await new Promise((resolve) => setTimeout(resolve, 5));
  ports.commit.resolvePending({
    ok: true,
    outcome: SUCCESSES.appended(1),
  });
  // The resolve happens synchronously in resolvePending
  // (the original Promise is settled there). The .then()
  // continuation that records commitResolvedAtMs runs on
  // a microtask. Spawn port is sync (returns a handle),
  // so spawnCalledAtMs is set before the next microtask.
  commitResolvedAtMs = Date.now();
  const result = await r;
  assert.equal(result.ok, true);
  assert.notEqual(spawnCalledAtMs, null,
    "spawn must have been called");
  assert.ok(
    spawnCalledAtMs !== null && commitResolvedAtMs !== null &&
      spawnCalledAtMs >= commitResolvedAtMs,
    "spawn time must be >= commit resolve time",
  );
});

// WS04c — missionId preserved when runId != missionId.
// P1#1 correction: production must NOT substitute runId
// for missionId. The committed, spawned, and returned
// missionId must all equal the spec's missionId, even when
// runId and missionId are deliberately distinct.
//
// CORRECTION02: this test now also asserts that the
// commit port received the same runId AND missionId as
// the spec. The previous version verified the eventId
// prefix only — it never proved the commit envelope
// carried the correct missionId. That is the full
// identity-continuity proof.
test("WS04c: missionId preserved when runId != missionId", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  const spec = mkSpec({ runId: "run-X" as never, missionId: "mis-Y" as never });
  const r = await startWitness(spec, ports);
  assert.equal(r.ok, true);
  if (r.ok) {
    // Returned identity.
    assert.equal(r.value.identity.missionId, "mis-Y",
      "WS04c: returned missionId must equal spec.missionId");
    assert.equal(r.value.identity.runId, "run-X",
      "WS04c: returned runId must equal spec.runId");
    assert.notEqual(r.value.identity.missionId, r.value.identity.runId,
      "WS04c: missionId must not collapse into runId");
    // Spawn spec identity.
    assert.equal(ports.spawn.lastSpec !== null, true);
    if (ports.spawn.lastSpec !== null) {
      assert.equal(ports.spawn.lastSpec.missionId, "mis-Y",
        "WS04c: spawn spec missionId must equal spec.missionId");
      assert.equal(ports.spawn.lastSpec.runId, "run-X",
        "WS04c: spawn spec runId must equal spec.runId");
    }
    // Commit port identity.
    assert.equal(ports.commit.lastRunId, "run-X",
      "WS04c: commit port runId must equal spec.runId");
    assert.equal(ports.commit.lastMissionId, "mis-Y",
      "WS04c: commit port missionId must equal spec.missionId (NOT runId)");
    // EventId still grammar-clean (delegates to WS13).
    assert.equal(ports.commit.lastEventId !== null, true);
    assert.equal(
      (ports.commit.lastEventId ?? "").startsWith("w-start-"),
      true,
      "WS04c: eventId must start with w-start- (delegates to WS13)",
    );
  }
});

// WS09a — spawn Promise unresolved before Node 'spawn' event.
// The FakeSpawn is staged as "pending". The gate MUST NOT
// resolve startWitness() before resolvePending is called.
// This is the property that gives the algebra meaning: the
// gate awaits a real Node success boundary.
test("WS09a: spawn Promise unresolved before Node 'spawn' fires", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  ports.spawn.setNext({ kind: "pending" });
  const r = startWitness(mkSpec(), ports);
  await new Promise((resolve) => setTimeout(resolve, 5));
  let settled = false;
  void r.then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(settled, false,
    "WS09a: startWitness must NOT resolve before spawn Promise resolves");
  ports.spawn.resolvePending({ ok: true, handle: makeFakeHandle() });
  const result = await r;
  assert.equal(result.ok, true,
    "WS09a: after resolvePending, result must be ok");
});

// WS09b — pre-spawn 'error' event yields spawn_failed.
// The FakeSpawn stages an immediate failure (mimics Node's
// pre-spawn 'error' that fires before 'spawn'). The gate
// must surface spawn_failed with the same identity so
// recovery can find the durable intent.
test("WS09b: pre-spawn error event yields spawn_failed", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  ports.spawn.setNext({
    kind: "failure",
    failure: { kind: "spawn_error_event", message: "ENOENT on nodePath" },
  });
  const r = await startWitness(mkSpec(), ports);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "spawn_failed",
      "WS09b: failure must be spawn_failed");
    if (r.failure.kind === "spawn_failed") {
      assert.equal(r.failure.cause.kind, "spawn_error_event",
        "WS09b: cause must be spawn_error_event");
      assert.notEqual(r.failure.identity, undefined,
        "WS09b: identity must be present so recovery can find intent");
    }
  }
  assert.equal(ports.commit.calls, 1,
    "WS09b: commit was called before spawn failed");
});

// WS09c — once 'spawn' has fired, a post-spawn 'error'
// MUST NOT relabel the start as spawn_failed.
//
// CORRECTION02: previous WS09c only verified the happy
// path; it did not exercise the spawn->error transition.
//
// CORRECTION03: this test exercises the PRODUCTION
// wiring (`attachSpawnEventHandler`) with a fake
// emitter — proving the production adapter and the
// state machine test share the same code path.
// A regression that re-introduced an inline handler
// in `nodeSpawnWitnessPort` (bypassing the state
// machine) would still pass the pure-SM test but
// would fail THIS test.
test("WS09c: production handler routes events through the state machine", async () => {
  const {
    attachSpawnEventHandler,
    classifySpawnEvent,
  } = await import("../../src/witness-start/witness-start-spawn.js");
  type SpawnEventEmitter = import("../../src/witness-start/witness-start-spawn.js").SpawnEventEmitter;
  type WitnessSpawnSpecResult = import("../../src/witness-start/witness-start-types.js").WitnessSpawnSpecResult;

  // -------- (1) Pure state machine, all 4 transitions. --------
  assert.deepEqual(
    classifySpawnEvent("pending", "spawn"),
    { state: "spawned", terminal: true, ok: true },
    "WS09c SM: pending + spawn -> spawned",
  );
  assert.deepEqual(
    classifySpawnEvent("spawned", "error"),
    { state: "spawned", terminal: true, ok: true },
    "WS09c SM: spawned + error stays spawned (no relabel)",
  );
  assert.deepEqual(
    classifySpawnEvent("pending", "error"),
    { state: "failed", terminal: true, ok: false },
    "WS09c SM: pending + error -> failed",
  );
  assert.deepEqual(
    classifySpawnEvent("failed", "error"),
    { state: "failed", terminal: true, ok: false },
    "WS09c SM: failed + error stays failed",
  );

  // -------- (2) Production wiring: fake emitter fires events
  // through attachSpawnEventHandler. We exercise the SAME
  // helper that `nodeSpawnWitnessPort()` uses in production.

  function makeFakeEmitter(): {
    emitter: SpawnEventEmitter;
    fire(event: "spawn" | "error", err?: Error): void;
  } {
    const spawnListeners: Array<() => void> = [];
    const errorListeners: Array<(err: Error) => void> = [];
    const emitter = {
      once(event: "spawn" | "error", listener: (err?: Error) => void): unknown {
        if (event === "spawn") {
          spawnListeners.push(() => (listener as () => void)());
        } else {
          errorListeners.push((err: Error) =>
            (listener as (e: Error) => void)(err),
          );
        }
        return undefined;
      },
    } as SpawnEventEmitter;
    return {
      emitter,
      fire(event, err) {
        if (event === "spawn") {
          const ls = spawnListeners.splice(0);
          for (const l of ls) l();
        } else {
          const ls = errorListeners.splice(0);
          for (const l of ls) l(err ?? new Error("fake"));
        }
      },
    };
  }

  // (2a) Production handler: spawn only -> ok:true
  {
    const fake = makeFakeEmitter();
    let resolved: WitnessSpawnSpecResult | null = null;
    const fakeChild = { pid: 4242 } as unknown as import("node:child_process").ChildProcess;
    attachSpawnEventHandler(
      fake.emitter,
      fakeChild,
      (r) => { resolved = r; },
    );
    fake.fire("spawn");
    assert.ok(resolved !== null,
      "WS09c (2a): production handler must resolve on spawn");
    const r1 = resolved as WitnessSpawnSpecResult;
    assert.equal(r1.ok, true,
      "WS09c: production handler must yield ok:true on spawn");
  }

  // (2b) Production handler: spawn then error -> ok:true
  // (the whole point of WS09c: no relabel)
  {
    const fake = makeFakeEmitter();
    let resolved: WitnessSpawnSpecResult | null = null;
    const fakeChild = { pid: 7777 } as unknown as import("node:child_process").ChildProcess;
    attachSpawnEventHandler(
      fake.emitter,
      fakeChild,
      (r) => { resolved = r; },
    );
    fake.fire("spawn");
    fake.fire("error", new Error("late unrelated error"));
    assert.ok(resolved !== null,
      "WS09c (2b): production handler must resolve on spawn");
    const r2 = resolved as WitnessSpawnSpecResult;
    assert.equal(r2.ok, true,
      "WS09c: post-spawn 'error' must NOT downgrade ok:true (production wiring)");
  }

  // (2c) Production handler: error only -> ok:false
  {
    const fake = makeFakeEmitter();
    let resolved: WitnessSpawnSpecResult | null = null;
    const fakeChild = { pid: 1111 } as unknown as import("node:child_process").ChildProcess;
    attachSpawnEventHandler(
      fake.emitter,
      fakeChild,
      (r) => { resolved = r; },
    );
    fake.fire("error", new Error("ENOENT"));
    assert.ok(resolved !== null,
      "WS09c (2c): production handler must resolve on error");
    const r3 = resolved as WitnessSpawnSpecResult;
    assert.equal(r3.ok, false,
      "WS09c: production handler must yield ok:false on pre-spawn error");
    if (r3.ok === false) {
      assert.equal(r3.failure.kind, "spawn_error_event");
    }
  }
});

// WS13 — generated EventId satisfies IDENTIFIER_GRAMMAR.
test("WS13: generated EventId satisfies IDENTIFIER_GRAMMAR", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  const r = await startWitness(mkSpec(), ports);
  assert.equal(r.ok, true);
  assert.notEqual(ports.commit.lastEventId, null,
    "WS13: gate must pass an eventId to the commit port");
  const eid = ports.commit.lastEventId ?? "";
  assert.ok(eid.length > 0 && eid.length <= 128,
    "WS13: eventId length must be in [1,128], got " + eid.length);
  assert.equal(/^[A-Za-z0-9_.:-]+$/.test(eid), true,
    "WS13: eventId must match IDENTIFIER_GRAMMAR");
  assert.ok(!eid.includes("/"),
    "WS13: eventId MUST NOT contain slashes (no embedded commitId)");
  assert.ok(eid.startsWith("w-start-"),
    "WS13: eventId namespace must be 'w-start-'");
});

// WS10b — exactly one commit per startWitness (sole-producer).
test("WS10b: startWitness produces exactly one commit (sole-producer)", async () => {
  const ports = mkPorts();
  ports.commit.ok(SUCCESSES.appended(1));
  await startWitness(mkSpec(), ports);
  assert.equal(ports.commit.calls, 1,
    "WS10b: commit must be called exactly once per startWitness");
});

// WS14 — makeEventIdFromIdentity is deterministic and
// uses the full SHA-256 digest (no truncation). Identity
// -> EventId is a pure function: same identity -> same
// EventId. Different identity -> different EventId.
test("WS14: makeEventIdFromIdentity is deterministic (full SHA-256)", async () => {
  const { makeEventIdFromIdentity } = await import(
    "../../src/witness-start/witness-start-types.js"
  );
  const id = {
    runId: "run-X" as never,
    missionId: "mis-Y" as never,
    attemptId: "att-Z" as never,
    processId: "proc-W" as never,
    witnessId: "w-V" as never,
    witnessInstanceId: "wi-V" as never,
  };
  const eid1 = makeEventIdFromIdentity(id);
  const eid2 = makeEventIdFromIdentity(id);
  assert.equal(eid1, eid2,
    "WS14: same identity must yield same eventId (deterministic)");
  // Different identity -> different eventId.
  const eid3 = makeEventIdFromIdentity({ ...id, witnessInstanceId: "wi-DIFF" as never });
  assert.notEqual(eid1, eid3,
    "WS14: different witnessInstanceId must yield different eventId");
  // Format: "w-start-" + 64 hex chars = 72 chars total.
  assert.equal(eid1.length, 72,
    "WS14: eventId must be exactly 72 chars (full SHA-256), got " + eid1.length);
  assert.ok(eid1.startsWith("w-start-"),
    "WS14: eventId namespace");
  assert.ok(/^[A-Za-z0-9_:.-]+$/.test(eid1),
    "WS14: eventId must match IDENTIFIER_GRAMMAR");
});

// WS15a — pure residue-oracle classifier (no real child).
// Always executes on every host. Verifies that:
//   - registerLiveFixture puts an entry in the registry
//   - sweepAndProve() with a non-ChildProcess ref reports
//     it as failed (so the strict lane cannot certify
//     residue=0)
//   - unregisterLiveFixture removes the entry
//   - after unregister, snapshotLiveFixtures does not
//     include it
//
// CORRECTION03: split out from WS15 so the pure
// classifier is always exercised. WS15b exercises the
// real-child path and may SKIP honestly.
test("WS15a: pure registry classifier (register -> residue -> unregister)", async () => {
  const {
    registerLiveFixture,
    unregisterLiveFixture,
    snapshotLiveFixtures,
    sweepAndProve,
  } = await import("../../test/ledger-writer/_live_registry.js");
  const marker = "WS15a-marker-" + Math.random().toString(36).slice(2);
  registerLiveFixture({
    kind: "socket_path",
    ref: undefined,
    path: "/nonexistent/path/" + marker,
    note: marker,
  });
  try {
    const before = snapshotLiveFixtures();
    assert.ok(before.some((x) => x.note === marker),
      "WS15a: entry must be in registry immediately after registration");
    await sweepAndProve();
    const after = snapshotLiveFixtures();
    assert.ok(!after.some((x) => x.note === marker),
      "WS15a: entry must be gone from registry after sweepAndProve (path was absent)");
  } finally {
    const all = snapshotLiveFixtures();
    const e = all.find((x) => x.note === marker);
    if (e !== undefined) unregisterLiveFixture(e);
  }
});

// WS15b — residue oracle catches an unproven witness
// child. This test depends on the harness allowing
// process.kill. On hosts where the harness denies it
// (e.g. macOS dev sandbox returning EPERM), the test
// SKIPs honestly via t.skip() — NOT silent green.
//
// "cannot exercise" must NEVER count as "passed".
test("WS15b: real-child residue oracle (may SKIP)", async (t) => {
  const { spawn } = await import("node:child_process");
  const {
    proveChildAbsent,
    registerLiveFixture,
    unregisterLiveFixture,
    snapshotLiveFixtures,
    sweepAndProve,
  } = await import("../../test/ledger-writer/_live_registry.js");
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},5000)"]);
  let canKill = true;
  try {
    child.kill("SIGTERM");
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "EPERM" || code === "ESRCH") canKill = false;
  }
  if (!canKill) {
    // CORRECTION03: explicit, honest skip. NOT silent pass.
    t.skip(
      "BLOCKED_BY_ENVIRONMENT: harness denied process.kill " +
        "on spawned child (EPERM/ESRCH)",
    );
    try { child.kill("SIGKILL"); } catch { /* */ }
    return;
  }
  const marker = "WS15b-marker";
  registerLiveFixture({
    kind: "helper_child",
    ref: child,
    pid: child.pid,
    note: marker,
  });
  try {
    const before = snapshotLiveFixtures();
    assert.ok(before.some((x) => x.note === marker),
      "WS15b: entry must be in registry immediately after registration");
    const absent = await proveChildAbsent(child);
    assert.equal(absent, true,
      "WS15b: proveChildAbsent must succeed after SIGKILL");
    const all = snapshotLiveFixtures();
    const e = all.find((x) => x.note === marker);
    if (e !== undefined) unregisterLiveFixture(e);
    const after = snapshotLiveFixtures();
    assert.ok(!after.some((x) => x.note === marker),
      "WS15b: entry must be gone from registry after unregister");
  } finally {
    try { child.kill("SIGKILL"); } catch { /* */ }
    await sweepAndProve();
  }
});
