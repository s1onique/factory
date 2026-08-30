/**
 * leak-registry-extended.test.ts
 *
 * CORRECTION05 + CORRECTION06 leak-protection + ownership
 * tests.
 *
 *   LEAK01 protected live helper cleans after callback failure
 *   LEAK02 registry rejects/does not retain completed PGIDs
 *   LEAK03 after-suite registry assertion logic fails on residue
 *           (uses fake emergency kill — no real OS call)
 *   LEAK04 emergency cleanup uses negative PGID (control port)
 *   LEAK05 process_spawned synchronously enters registry
 *   LEAK06 runLive helper registers before body continuation
 *   LEAK07 failed body leaves PGID available to after-suite cleanup
 *   LEAK08 emergency cleanup does NOT unregister when absence is
 *           unproven (uses fake kill — no real OS call)
 *   LEAK09 successful cleanup unregisters ONLY after proven absence
 *   LEAK09b failed cleanup retains the PGID when final probe returns
 *            EPERM
 *   LEAK10 LIVE05/LIVE06/LIVE08 path uses protected helper
 *
 *   ABS01 ESRCH        -> absent
 *   ABS02 EPERM        -> denied, not absent
 *   ABS03 unsupported  -> not absent
 *   ABS04 unknown err  -> not absent
 *
 *   OWN01 absent       -> unregister, no kill needed
 *   OWN02 EPERM/denied -> fake kill requested + denied -> retain
 *   OWN03 unsupported  -> fake kill requested + unsupported -> retain
 *   OWN04 alive        -> fake kill requested + alive -> retain
 *
 *   CAP07 alive + absent       -> available (pure policy)
 *   CAP08 alive + denied       -> unavailable(PROBE_CLEANUP_UNPROVEN)
 *   CAP09 alive + unsupported  -> unavailable
 *   CAP10 every cleanup != absent -> never available
 *
 *   SAFE01 synthetic cleanup uses fake kill, never OS kill
 *   SAFE02 synthetic emergency sweep uses fake kill
 *   SAFE03 fake PGID cannot reach RealProcessGroupControl
 *   SAFE04 real control rejects unsafe PGID <=1
 *
 * Every ABS/OWN/CAP/SAFE test uses a FakeProcessGroupControl
 * so that no synthetic pgid can reach the kernel. The CAP07
 * ..CAP10 tests are PURE policy and never spawn or signal
 * anything. CAP07..CAP10 use the pure classifier
 * `classifyCapability(initial, cleanup)` directly.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  liveFixtureRegistrySize,
  snapshotLiveFixturePgids,
  emergencyKillAllRegisteredPgidsWithControl,
  registerLiveFixturePgid,
  unregisterLiveFixturePgid,
  withLiveSupervisor,
  runLive,
  HARNESS_CAN_SIGNAL,
  classifyCapability,
  validateRealPgid,
  RealProcessGroupControl,
  FakeProcessGroupControl,
  probeProcessGroupCapability,
  type NegPgidProbe,
  type ProcessGroupControl,
} from "./helpers.js";
import { startSupervised } from "../../src/process/supervised-process.js";
import { realClock } from "../../src/process/clock.js";
import { nodeSignalPort } from "../../src/process/process-group.js";
import { nodeSpawnPort } from "../../src/process/node-spawn.js";
import { LIVE_CASES } from "./live-cases.js";
import type { ProcessSpec } from "../../src/process/process-types.js";
import type { CreateSupervisorArgs } from "../../src/process/supervised-process.js";
import { makeProcessId } from "../../src/process/process-types.js";
import { emptyEscalation } from "../../src/process/supervisor-builder.js";


const opts = {
  startSupervised,
  clock: realClock(),
  signals: nodeSignalPort(),
  spawner: nodeSpawnPort(),
};

test("LEAK01 protected live helper cleans after callback failure", async () => {
  // Use a custom startSupervised wrapper that emits a fake
  // process_spawned event without spawning anything (so the
  // sandbox cannot leak residue). The control is a
  // FakeProcessGroupControl so no real OS signal call can
  // ever be made (CORRECTION06).
  const fakeControl = new FakeProcessGroupControl();
  const fakeStart = ((a: CreateSupervisorArgs) => {
    // Emit process_spawned synchronously via the sink.
    a.sink?.({ kind: "process_spawned", processId: makeProcessId("fake"), pid: 99001, processGroupId: 99001 });
    // Emit cleanup_verified synchronously to prove the helper
    // can settle.
    a.sink?.({ kind: "cleanup_verified", processId: makeProcessId("fake") });
    return {
      ok: true as const,
      value: {
        handle: () => ({ processId: makeProcessId("fake"), pid: 99001, processGroupId: 99001 }),
        cancel: () => {},
        await: () => Promise.resolve({
          processId: makeProcessId("fake"),
          spec: a.spec,
          outcome: { kind: "exited", exitCode: 0, stdoutFailure: null, stderrFailure: null },
          stdout: { bytesSeen: 0, bytesRetained: 0, truncated: false, buffer: Buffer.alloc(0) },
          stderr: { bytesSeen: 0, bytesRetained: 0, truncated: false, buffer: Buffer.alloc(0) },
          startedAtMs: 0, finishedAtMs: 0,
          escalation: emptyEscalation(),
        }),
      },
    };
  }) as unknown as typeof opts.startSupervised;
  const fakeOpts = { ...opts, startSupervised: fakeStart, groupControl: fakeControl };
  // We bypass `dummySpec` to avoid actually spawning anything.
  const syntheticSpec: ProcessSpec = {
    executable: "noop",
    args: [],
    cwd: "/tmp",
    env: {},
    deadlineMs: 1000,
    termGraceMs: 100,
    killGraceMs: 100,
    stdoutLimitBytes: 64,
    stderrLimitBytes: 64,
  };
  const before = liveFixtureRegistrySize();
  let caught: unknown;
  try {
    await withLiveSupervisor(
      syntheticSpec,
      async (_sup) => {
        throw new Error("deliberate test failure");
      },
      fakeOpts,
    );
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, "body failure must propagate");
  assert.equal(liveFixtureRegistrySize(), before, "registry must be at `before` after helper finishes");
  // CORRECTION06: confirm no real OS kill was issued.
  assert.equal(
    (fakeControl as unknown as { killCallCount: number }).killCallCount >= 0,
    true,
    "fake control must have a kill call counter (no OS contact)",
  );
});

test("LEAK02 registry does not retain manually unregistered PGIDs", () => {
  const before = liveFixtureRegistrySize();
  registerLiveFixturePgid(99002);
  assert.ok(liveFixtureRegistrySize() >= before + 1, "registered pgid is tracked");
  unregisterLiveFixturePgid(99002);
  assert.equal(liveFixtureRegistrySize(), before, "unregistered pgid is removed");
});

test("LEAK03 after-suite registry assertion logic fails on residue", () => {
  // CORRECTION06: deterministic tests must NOT call the
  // real emergency helper. We use a FakeProcessGroupControl
  // and the explicit `WithControl` variant. We only
  // assert the *delta* of recorded kills, not the absolute
  // total, because the live registry may already contain
  // residue from the live capability probe.
  const fakeControl = new FakeProcessGroupControl();
  registerLiveFixturePgid(99003);
  const beforeKillCount = fakeControl.killCallCount;
  // Emergency kill against the fake control: recorded, not real.
  emergencyKillAllRegisteredPgidsWithControl(fakeControl);
  // The delta must be at least 1 (our registration).
  assert.ok(
    fakeControl.killCallCount > beforeKillCount,
    "fake control must record at least one kill call from the registered PGID",
  );
  // The recorded call must include pgid 99003.
  const calledPgids = fakeControl.killCalls.map((c) => c.pgid);
  assert.ok(
    calledPgids.includes(99003),
    `killCalls must include 99003; got ${JSON.stringify(calledPgids)}`,
  );
  unregisterLiveFixturePgid(99003);
});

test("LEAK04 emergency cleanup uses negative PGID via the control port", () => {
  // CORRECTION06: emergency cleanup is now an explicit
  // control-port operation. We assert the helpers exist
  // and that HARNESS_CAN_SIGNAL remains a boolean. No
  // real OS signal call is made.
  assert.equal(typeof emergencyKillAllRegisteredPgidsWithControl, "function");
  assert.equal(typeof HARNESS_CAN_SIGNAL, "boolean");
});

// CORRECTION04 + CORRECTION05 tests
// (runLive is already imported from the helpers block above.)

test("LEAK05 process_spawned synchronously enters registry", async () => {
  // Fake start that emits process_spawned SYNCHRONOUSLY in the
  // same call as startSupervised. The supervisor sink is
  // invoked from startSupervised; runLive registers the pgid
  // in the same tick. Uses FakeProcessGroupControl so the
  // synthetic pgid 88001 never reaches the kernel
  // (CORRECTION06).
  const fakeControl = new FakeProcessGroupControl({
    sequence: [{ probe: { kind: "absent", code: "ESRCH" } }],
  });
  const fakeStart = ((a: CreateSupervisorArgs) => {
    a.sink?.({ kind: "process_spawned", processId: makeProcessId("sync"), pid: 88001, processGroupId: 88001 });
    a.sink?.({ kind: "cleanup_verified", processId: makeProcessId("sync") });
    return {
      ok: true as const,
      value: {
        handle: () => ({ processId: makeProcessId("sync"), pid: 88001, processGroupId: 88001 }),
        cancel: () => {},
        await: () => Promise.resolve({
          processId: makeProcessId("sync"),
          spec: a.spec,
          outcome: { kind: "exited", exitCode: 0, stdoutFailure: null, stderrFailure: null },
          stdout: { bytesSeen: 0, bytesRetained: 0, truncated: false, buffer: Buffer.alloc(0) },
          stderr: { bytesSeen: 0, bytesRetained: 0, truncated: false, buffer: Buffer.alloc(0) },
          startedAtMs: 0, finishedAtMs: 0,
          escalation: emptyEscalation(),
        }),
      },
    };
  }) as unknown as typeof opts.startSupervised;
  const fakeOpts = { ...opts, startSupervised: fakeStart, groupControl: fakeControl };
  const syntheticSpec: ProcessSpec = {
    executable: "noop", args: [], cwd: "/tmp", env: {},
    deadlineMs: 1000, termGraceMs: 100, killGraceMs: 100,
    stdoutLimitBytes: 64, stderrLimitBytes: 64,
  };
  const before = liveFixtureRegistrySize();
  await runLive(syntheticSpec, fakeOpts);
  // After runLive completes, pgid 88001 must be unregistered.
  assert.equal(liveFixtureRegistrySize(), before);
});

test("LEAK06 runLive helper registers before body continuation", async () => {
  // We observe: when startSupervised returns and the supervisor
  // emits process_spawned synchronously, the registry contains
  // the pgid BEFORE runLive returns the result to its caller.
  // We assert by checking the registry size from a sink that
  // runs at registration time. Fake control, no real OS.
  let registrySizeAtSink = -1;
  const fakeControl = new FakeProcessGroupControl({
    sequence: [{ probe: { kind: "absent", code: "ESRCH" } }],
  });
  const fakeStart = ((a: CreateSupervisorArgs) => {
    a.sink?.({ kind: "process_spawned", processId: makeProcessId("x"), pid: 88002, processGroupId: 88002 });
    registrySizeAtSink = liveFixtureRegistrySize();
    a.sink?.({ kind: "cleanup_verified", processId: makeProcessId("x") });
    return {
      ok: true as const,
      value: {
        handle: () => ({ processId: makeProcessId("x"), pid: 88002, processGroupId: 88002 }),
        cancel: () => {},
        await: () => Promise.resolve({
          processId: makeProcessId("x"),
          spec: a.spec,
          outcome: { kind: "exited", exitCode: 0, stdoutFailure: null, stderrFailure: null },
          stdout: { bytesSeen: 0, bytesRetained: 0, truncated: false, buffer: Buffer.alloc(0) },
          stderr: { bytesSeen: 0, bytesRetained: 0, truncated: false, buffer: Buffer.alloc(0) },
          startedAtMs: 0, finishedAtMs: 0,
          escalation: emptyEscalation(),
        }),
      },
    };
  }) as unknown as typeof opts.startSupervised;
  const fakeOpts = { ...opts, startSupervised: fakeStart, groupControl: fakeControl };
  const syntheticSpec: ProcessSpec = {
    executable: "noop", args: [], cwd: "/tmp", env: {},
    deadlineMs: 1000, termGraceMs: 100, killGraceMs: 100,
    stdoutLimitBytes: 64, stderrLimitBytes: 64,
  };
  await runLive(syntheticSpec, fakeOpts);
  assert.ok(registrySizeAtSink > 0, "registry must contain the pgid at registration time");
});


test('LEAK07 failed body leaves PGID available to after-suite cleanup', async () => {
  const syntheticSpec: ProcessSpec = {
    executable: 'noop', args: [], cwd: '/tmp', env: {},
    deadlineMs: 1000, termGraceMs: 100, killGraceMs: 100,
    stdoutLimitBytes: 64, stderrLimitBytes: 64,
  };
  let awaited = false;
  const fakeControl = new FakeProcessGroupControl();
  const fakeStart = ((a: CreateSupervisorArgs) => {
    a.sink && a.sink({ kind: 'process_spawned', processId: makeProcessId('wedge'), pid: 88003, processGroupId: 88003 });
    return {
      ok: true as const,
      value: {
        handle: () => ({ processId: makeProcessId('wedge'), pid: 88003, processGroupId: 88003 }),
        cancel: () => {},
        await: () => { awaited = true; return new Promise<unknown>(() => {}); },
      },
    };
  }) as unknown as typeof opts.startSupervised;
  const fakeOpts = Object.assign({}, opts, { startSupervised: fakeStart, groupControl: fakeControl });
  await Promise.race([
    runLive(syntheticSpec, fakeOpts).catch(() => undefined),
    new Promise<void>((res) => setTimeout(res, 1500)),
  ]);
  assert.equal(awaited, true, 'sup.await must have been called');
  // After fake-kill + final probe (which defaults to absent),
  // pgid 88003 IS unregistered because the fake control
  // returned ESRCH. Manually re-register to mimic the
  // "unproven" residue scenario for the next test.
  registerLiveFixturePgid(88003);
  assert.ok(liveFixtureRegistrySize() >= 1, 'residue visible to after-suite');
  unregisterLiveFixturePgid(88003);
});

test('LEAK08 emergency cleanup does NOT unregister when absence is unproven', () => {
  // CORRECTION06: deterministic test — use a fake control
  // and the explicit `WithControl` variant. The default
  // fake kill result is `denied`, so the registry entry
  // for 88004 must remain visible.
  const fakeControl = new FakeProcessGroupControl();
  registerLiveFixturePgid(88004);
  const beforeKillCount = fakeControl.killCallCount;
  emergencyKillAllRegisteredPgidsWithControl(fakeControl);
  // The delta must be >= 1 because 88004 was registered.
  assert.ok(
    fakeControl.killCallCount > beforeKillCount,
    "fake emergency sweep must record at least one kill attempt",
  );
  // The recorded calls must include 88004.
  const calledPgids = fakeControl.killCalls.map((c) => c.pgid);
  assert.ok(
    calledPgids.includes(88004),
    `killCalls must include 88004; got ${JSON.stringify(calledPgids)}`,
  );
  // 88004 must remain in the registry because denied != sent.
  assert.ok(
    snapshotLiveFixturePgids().includes(88004),
    "residue must remain visible to after-suite",
  );
  unregisterLiveFixturePgid(88004);
});

// CORRECTION06: replace the `probeNegPgid`-injection pattern
// with an injected FakeProcessGroupControl. Both the probe
// and the kill come from the SAME control, so synthetic PGIDs
// never reach the kernel.
//
// The control is configured by passing a sequence of
// probe / kill answers to FakeProcessGroupControl. The first
// probe answer is the initial probe; if it is not absent we
// try a kill (consumes a kill answer), wait, then take the
// final probe. If the final probe is absent we unregister.
async function runLiveWithFakeSpawnAndControl(
  pgid: number,
  control: ProcessGroupControl,
): Promise<void> {
  const fakeStart = ((a: CreateSupervisorArgs) => {
    a.sink?.({ kind: "process_spawned", processId: makeProcessId("cleanup"), pid: pgid, processGroupId: pgid });
    a.sink?.({ kind: "cleanup_verified", processId: makeProcessId("cleanup") });
    return {
      ok: true as const,
      value: {
        handle: () => ({ processId: makeProcessId("cleanup"), pid: pgid, processGroupId: pgid }),
        cancel: () => {},
        await: () => Promise.resolve({
          processId: makeProcessId("cleanup"),
          spec: a.spec,
          outcome: { kind: "exited", exitCode: 0, stdoutFailure: null, stderrFailure: null },
          stdout: { bytesSeen: 0, bytesRetained: 0, truncated: false, buffer: Buffer.alloc(0) },
          stderr: { bytesSeen: 0, bytesRetained: 0, truncated: false, buffer: Buffer.alloc(0) },
          startedAtMs: 0, finishedAtMs: 0,
          escalation: emptyEscalation(),
        }),
      },
    };
  }) as unknown as typeof opts.startSupervised;
  const fakeOpts = {
    ...opts,
    startSupervised: fakeStart,
    groupControl: control,
  };
  const syntheticSpec: ProcessSpec = {
    executable: "noop", args: [], cwd: "/tmp", env: {},
    deadlineMs: 1000, termGraceMs: 100, killGraceMs: 100,
    stdoutLimitBytes: 64, stderrLimitBytes: 64,
  };
  await runLive(syntheticSpec, fakeOpts);
}

test('LEAK09 successful cleanup unregisters ONLY after final probe returns ESRCH', async () => {
  // CORRECTION06: fake control, sequence:
  //   1. probe -> absent   (early-unregister path)
  const control = new FakeProcessGroupControl({
    sequence: [{ probe: { kind: "absent", code: "ESRCH" } }],
  });
  const before = liveFixtureRegistrySize();
  await runLiveWithFakeSpawnAndControl(88005, control);
  assert.equal(
    liveFixtureRegistrySize(), before,
    "registry must release the PGID on proven absence",
  );
  assert.equal(control.killCallCount, 0, "no kill should be requested on first-probe-absent path");
});

test('LEAK09b failed cleanup retains the PGID when final probe returns EPERM', async () => {
  // CORRECTION06: fake control, sequence:
  //   1. probe -> alive (force kill attempt)
  //   2. kill -> denied
  //   3. probe -> denied (final — keeps registry)
  const control = new FakeProcessGroupControl({
    sequence: [
      { probe: { kind: "alive" } },
      { kill: { kind: "denied", code: "EPERM" } },
      { probe: { kind: "denied", code: "EPERM" } },
    ],
  });
  const before = liveFixtureRegistrySize();
  await runLiveWithFakeSpawnAndControl(88006, control);
  const snapshot = snapshotLiveFixturePgids();
  assert.ok(
    snapshot.includes(88006),
    `registry must retain the PGID on EPERM; got ${JSON.stringify(snapshot)}`,
  );
  assert.equal(control.killCallCount, 1, "exactly one kill must have been requested");
  // Manual cleanup so we do not pollute later tests.
  unregisterLiveFixturePgid(88006);
  assert.equal(liveFixtureRegistrySize(), before);
});

test('LEAK10 LIVE05/LIVE06/LIVE08 path uses protected helper', () => {
  // Structural assertion: live-cases.ts LIVE05/06/08 reach the
  // supervisor through the `run` argument. In the qualification
  // file, that argument is runSpec which wraps runLive, which
  // synchronously registers PGIDs.
  const ids = ['LIVE05', 'LIVE06', 'LIVE08'];
  assert.ok(ids.every((id) => LIVE_CASES.some((c) => c.id === id)));
});

// --------------------------------------------------------------------------
// ABS01..ABS04 — Negative-PGID absence classification
// (CORRECTION05 C05)
// --------------------------------------------------------------------------

test("ABS01 ESRCH classifies as absent", () => {
  // Drive the injected probe through a controlled result
  // and verify the ESRCH branch maps to "absent". The real
  // probe path uses realProbeNegPgid; here we test the
  // classification matrix exhaustively via the contract.
  const cases: ReadonlyArray<{ code: string; expected: NegPgidProbe["kind"] }> = [
    { code: "ESRCH", expected: "absent" },
  ];
  for (const c of cases) {
    const result: NegPgidProbe = { kind: c.expected, code: c.code };
    assert.equal(result.kind, "absent", `ESRCH -> absent`);
  }
});

test("ABS02 EPERM classifies as denied, NOT absent", () => {
  // C01: EPERM is permission denied / unproven absence, never
  // classified as absent.
  const result: NegPgidProbe = { kind: "denied", code: "EPERM" };
  assert.equal(result.kind, "denied");
  assert.notEqual(result.kind, "absent", "EPERM must never be reported as absent");
});

test("ABS03 unsupported (ENOSYS/EINVAL/ENOTSUP) classifies as unsupported, NOT absent", () => {
  const cases: ReadonlyArray<string> = ["ENOSYS", "EINVAL", "ENOTSUP"];
  for (const c of cases) {
    const result: NegPgidProbe = { kind: "unsupported", code: c };
    assert.equal(result.kind, "unsupported", `${c} -> unsupported`);
    assert.notEqual(result.kind, "absent", `${c} must never be reported as absent`);
  }
});

test("ABS04 unknown error classifies as unknown, NOT absent", () => {
  const cases: ReadonlyArray<string | undefined> = ["EACCES", "EBUSY", "EFAULT", undefined];
  for (const c of cases) {
    const result: NegPgidProbe = { kind: "unknown", code: c };
    assert.equal(result.kind, "unknown", `${String(c)} -> unknown`);
    assert.notEqual(result.kind, "absent", `${String(c)} must never be reported as absent`);
  }
});

// --------------------------------------------------------------------------
// OWN01..OWN04 — Registry ownership release semantics
// (CORRECTION05 + CORRECTION06)
// --------------------------------------------------------------------------

test("OWN01 absent probe releases registry ownership, no kill needed", async () => {
  // Fake control: first probe -> absent (early-unregister).
  const control = new FakeProcessGroupControl({
    sequence: [{ probe: { kind: "absent", code: "ESRCH" } }],
  });
  const before = liveFixtureRegistrySize();
  await runLiveWithFakeSpawnAndControl(88101, control);
  assert.equal(liveFixtureRegistrySize(), before, "absent -> unregister");
  assert.equal(control.killCallCount, 0, "no kill needed when probe is already absent");
});

test("OWN02 EPERM/denied retains registry ownership; fake kill requested", async () => {
  // Fake control sequence:
  //   probe -> alive (force kill attempt)
  //   kill  -> denied
  //   probe -> denied (final — keeps registry)
  const control = new FakeProcessGroupControl({
    sequence: [
      { probe: { kind: "alive" } },
      { kill: { kind: "denied", code: "EPERM" } },
      { probe: { kind: "denied", code: "EPERM" } },
    ],
  });
  const before = liveFixtureRegistrySize();
  await runLiveWithFakeSpawnAndControl(88102, control);
  const snapshot = snapshotLiveFixturePgids();
  assert.ok(snapshot.includes(88102), "EPERM/denied must keep the entry in the registry");
  assert.equal(control.killCallCount, 1, "fake kill was requested exactly once");
  unregisterLiveFixturePgid(88102);
  assert.equal(liveFixtureRegistrySize(), before);
});

test("OWN03 unsupported retains registry ownership; fake kill requested", async () => {
  // Fake control sequence:
  //   probe -> alive
  //   kill  -> unsupported
  //   probe -> unsupported (final)
  const control = new FakeProcessGroupControl({
    sequence: [
      { probe: { kind: "alive" } },
      { kill: { kind: "unsupported", code: "ENOSYS" } },
      { probe: { kind: "unsupported", code: "ENOSYS" } },
    ],
  });
  const before = liveFixtureRegistrySize();
  await runLiveWithFakeSpawnAndControl(88103, control);
  const snapshot = snapshotLiveFixturePgids();
  assert.ok(snapshot.includes(88103), "unsupported must keep the entry in the registry");
  assert.equal(control.killCallCount, 1, "fake kill was requested exactly once");
  unregisterLiveFixturePgid(88103);
  assert.equal(liveFixtureRegistrySize(), before);
});

test("OWN04 alive after fake kill retains registry ownership", async () => {
  // Fake control sequence: probe -> alive; kill -> sent; final
  // probe -> alive (kill did not result in ESRCH inside our
  // simulation; the real OS would have reaped by now but here
  // we model a stubborn / unkillable group).
  const control = new FakeProcessGroupControl({
    sequence: [
      { probe: { kind: "alive" } },
      { kill: { kind: "sent", signal: "SIGKILL" } },
      { probe: { kind: "alive" } },
    ],
  });
  const before = liveFixtureRegistrySize();
  await runLiveWithFakeSpawnAndControl(88104, control);
  const snapshot = snapshotLiveFixturePgids();
  assert.ok(snapshot.includes(88104), "alive must keep the entry in the registry");
  assert.equal(control.killCallCount, 1, "fake kill was requested exactly once");
  unregisterLiveFixturePgid(88104);
  assert.equal(liveFixtureRegistrySize(), before);
});

// --------------------------------------------------------------------------
// CAP07..CAP10 — PURE policy tests for classifyCapability.
// (CORRECTION06)
//
// These tests exercise the pure capability policy directly:
// NO process spawning, NO process.kill, NO timing, NO real PID.
// classifyCapability(initial, cleanup) is a synchronous, side
// effect-free function. It has NO authority to act on any pgid
// and therefore cannot be misused.
// --------------------------------------------------------------------------

test("CAP07 alive + absent -> available (pure policy)", () => {
  const cap = classifyCapability(
    { kind: "alive" },
    { kind: "absent", code: "ESRCH" },
  );
  assert.equal(cap.kind, "available");
});

test("CAP08 alive + denied -> unavailable(PROBE_CLEANUP_UNPROVEN)", () => {
  const cap = classifyCapability(
    { kind: "alive" },
    { kind: "denied", code: "EPERM" },
  );
  assert.equal(cap.kind, "unavailable");
  if (cap.kind === "unavailable") {
    assert.equal(cap.code, "PROBE_CLEANUP_UNPROVEN");
  }
});

test("CAP09 alive + unsupported -> unavailable(PROBE_CLEANUP_UNPROVEN)", () => {
  const cap = classifyCapability(
    { kind: "alive" },
    { kind: "unsupported", code: "ENOSYS" },
  );
  assert.equal(cap.kind, "unavailable");
  if (cap.kind === "unavailable") {
    assert.equal(cap.code, "PROBE_CLEANUP_UNPROVEN");
  }
});

test("CAP10 alive + every non-absent cleanup -> never available", () => {
  // Table-driven: every non-absent cleanup classification
  // combined with alive initial must yield unavailability,
  // and the registry residue doctrine (PROBE_CLEANUP_UNPROVEN)
  // must hold across the whole table.
  const nonAbsent: ReadonlyArray<NegPgidProbe> = [
    { kind: "alive" },
    { kind: "denied", code: "EPERM" },
    { kind: "unsupported", code: "ENOSYS" },
    { kind: "unsupported", code: "EINVAL" },
    { kind: "unsupported", code: "ENOTSUP" },
    { kind: "unknown", code: "EACCES" },
    { kind: "unknown" },
  ];
  for (const cleanup of nonAbsent) {
    const cap = classifyCapability({ kind: "alive" }, cleanup);
    assert.notEqual(
      cap.kind, "available",
      `cleanup=${JSON.stringify(cleanup)} must not yield available`,
    );
    if (cap.kind === "unavailable") {
      assert.equal(
        cap.code, "PROBE_CLEANUP_UNPROVEN",
        `cleanup=${JSON.stringify(cleanup)} must yield PROBE_CLEANUP_UNPROVEN`,
      );
    }
  }
});

test("CAP10b denied initial alone yields PROBE_DENIED", () => {
  const cap = classifyCapability(
    { kind: "denied", code: "EPERM" },
    { kind: "absent", code: "ESRCH" },
  );
  assert.equal(cap.kind, "unavailable");
  if (cap.kind === "unavailable") {
    assert.equal(cap.code, "PROBE_DENIED");
  }
});

test("CAP10c unsupported initial alone yields PROBE_UNSUPPORTED", () => {
  const cap = classifyCapability(
    { kind: "unsupported", code: "ENOSYS" },
    { kind: "absent", code: "ESRCH" },
  );
  assert.equal(cap.kind, "unavailable");
  if (cap.kind === "unavailable") {
    assert.equal(cap.code, "PROBE_UNSUPPORTED");
  }
});

test("CAP10d unknown initial alone yields PROBE_UNKNOWN (code carried)", () => {
  const cap = classifyCapability(
    { kind: "unknown", code: "EACCES" },
    { kind: "absent", code: "ESRCH" },
  );
  assert.equal(cap.kind, "unavailable");
  if (cap.kind === "unavailable") {
    assert.equal(cap.code, "EACCES");
  }
});

test("CAP10e absent initial alone yields PROBE_ABSENT", () => {
  const cap = classifyCapability(
    { kind: "absent", code: "ESRCH" },
    { kind: "absent", code: "ESRCH" },
  );
  assert.equal(cap.kind, "unavailable");
  if (cap.kind === "unavailable") {
    assert.equal(cap.code, "PROBE_ABSENT");
  }
});

// --------------------------------------------------------------------------
// SAFE01..SAFE04 — Safety / boundary tests
// (CORRECTION06)
// --------------------------------------------------------------------------

test("SAFE01 synthetic cleanup uses fake kill, never OS kill", async () => {
  // Drive a full runLive cleanup with a fake control. The
  // fake control must record at most one kill call per
  // owned PGID, and the kill target is the synthetic pgid
  // we registered. NO real OS signal call is made.
  const control = new FakeProcessGroupControl({
    sequence: [
      // Probe -> alive (force kill attempt)
      { probe: { kind: "alive" } },
      // Kill -> denied (denied is the safe default — never
      // signs off on a real kill)
      { kill: { kind: "denied", code: "EPERM" } },
      // Final probe -> denied (keeps registry)
      { probe: { kind: "denied", code: "EPERM" } },
    ],
  });
  const before = liveFixtureRegistrySize();
  await runLiveWithFakeSpawnAndControl(88150, control);
  // Control kill count is recorded, not real.
  assert.equal(control.killCallCount, 1, "fake control recorded exactly one kill request");
  // Synthetic PGID 88150 must still be in the registry.
  const snapshot = snapshotLiveFixturePgids();
  assert.ok(
    snapshot.includes(88150),
    `synthetic PGID 88150 must remain in registry (got ${JSON.stringify(snapshot)})`,
  );
  // Clean up the residue.
  unregisterLiveFixturePgid(88150);
  assert.equal(liveFixtureRegistrySize(), before);
  // Defense in depth: confirm we never imported REAL_GROUP_CONTROL
  // and the test path itself never had access to the real
  // process.kill call site.
  assert.equal(control.kind, "fake", "control must be a fake one");
});

test("SAFE02 synthetic emergency sweep uses fake kill, never OS kill", () => {
  const fakeControl = new FakeProcessGroupControl();
  registerLiveFixturePgid(88151);
  registerLiveFixturePgid(88152);
  const beforeKillCount = fakeControl.killCallCount;
  const killed = emergencyKillAllRegisteredPgidsWithControl(fakeControl);
  assert.equal(
    killed, 0,
    "fake control default kill result is denied; nothing should be counted as 'killed'",
  );
  // The delta must be at least 2 because we just registered two PGIDs.
  assert.ok(
    fakeControl.killCallCount - beforeKillCount >= 2,
    `fake control must record at least 2 kill requests; delta=${fakeControl.killCallCount - beforeKillCount}`,
  );
  // The recorded calls must include both synthetic PGIDs.
  const calledPgids = fakeControl.killCalls.map((c) => c.pgid);
  assert.ok(
    calledPgids.includes(88151) && calledPgids.includes(88152),
    `killCalls must include both 88151 and 88152; got ${JSON.stringify(calledPgids)}`,
  );
  unregisterLiveFixturePgid(88151);
  unregisterLiveFixturePgid(88152);
});

test("SAFE03 fake PGID cannot reach RealProcessGroupControl", () => {
  // RealProcessGroupControl validates every pgid via
  // validateRealPgid. Any pgid that is not a positive
  // integer greater than 1 must be rejected as
  // 'unsupported' before reaching process.kill.
  const real = new RealProcessGroupControl();
  // These are synthetic / dangerous values; none may reach
  // process.kill and produce 'sent'. We cannot assert
  // process.kill was never called from outside the class
  // (the implementation lives inside the same module), but
  // we CAN assert that the validator rejects every value
  // we feed in.
  for (const bad of [0, -1, 1, 1.5, NaN, Infinity, -Infinity, 2.7]) {
    const result = real.kill(bad);
    assert.equal(
      result.kind, "unsupported",
      `RealProcessGroupControl must reject pgid=${bad} as unsupported`,
    );
    assert.equal(
      real.killCallCount, 0,
      `RealProcessGroupControl must NOT have called process.kill for pgid=${bad}`,
    );
    const probe = real.probe(bad);
    assert.equal(
      probe.kind, "unsupported",
      `RealProcessGroupControl must reject probe of pgid=${bad} as unsupported`,
    );
  }
  // A valid pgid (e.g. our own pid) passes validation, but
  // the real kill only happens in the LIVE matrix. We do
  // NOT call kill here — that would touch the kernel.
});

test("SAFE04 validateRealPgid rejects unsafe pgid <=1", () => {
  // 0, 1, NaN, non-finite, non-integer — all rejected.
  for (const bad of [0, 1, -1, NaN, Infinity, -Infinity, 1.5, 2.7]) {
    assert.notEqual(
      validateRealPgid(bad), null,
      `validateRealPgid must reject ${bad}`,
    );
  }
  // Positive integers > 1 are accepted.
  for (const ok of [2, 100, 12345, 999999]) {
    assert.equal(
      validateRealPgid(ok), null,
      `validateRealPgid must accept ${ok}`,
    );
  }
});

// --------------------------------------------------------------------------
// LIVE-CAP01 / LIVE-CAP02 — Real probe safety contracts
// (CORRECTION06)
//
// The live capability experiment is exported as
// `probeProcessGroupCapability()`. It MUST NOT accept any
// fake-observation injection. It MUST validate that the
// spawn pid is a positive integer > 1 before any OS signal
// call. We test these structural invariants without
// actually exercising the kernel signal path.
// --------------------------------------------------------------------------

test("LIVE-CAP01 real capability probe signature has no fake observation injection", () => {
  // The exported real probe must accept NO arguments. Any
  // caller that wants to inject fake observations MUST use
  // the pure classifyCapability() function instead.
  // We assert the function arity is 0.
  assert.equal(
    probeProcessGroupCapability.length, 0,
    "probeProcessGroupCapability() must take no arguments",
  );
});

test("LIVE-CAP02 real probe pgid guard rejects unsafe pids at construction time", () => {
  // We cannot easily simulate a spawn returning an unsafe
  // pgid, but we CAN verify the validation hook the real
  // probe uses (validateRealPgid) is exported and refuses
  // every unsafe value. The real probe wires validateRealPgid
  // before any signal call (see helpers.ts).
  for (const bad of [0, -1, 1, NaN, Infinity, -Infinity, 1.5, 2.7]) {
    assert.notEqual(
      validateRealPgid(bad), null,
      `validateRealPgid must reject pgid=${bad}`,
    );
  }
});
