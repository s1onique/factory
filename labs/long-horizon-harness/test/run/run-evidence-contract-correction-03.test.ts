/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Phase E correction probes (E-C12 .. E-C16).
 *
 *   E-C12 — snapshot precedes every semantic observation.
 *     RUN59  store.append accessor event  -> hostile_payload, getter count 0
 *     RUN60  store.append Proxy event     -> hostile_payload, get count 0
 *     RUN61  BigInt in payload -> snapshot stage rejects before canonicalization
 *
 *   E-C13 — store enforces the closed-world RunEvent schema.
 *     RUN62  ACTION_STARTED + extra "__proto__" own key -> reject
 *     RUN63  RUN_STARTED + extra ordinary string key    -> reject
 *     RUN64  symbol / non-enumerable / accessor key     -> reject without observation
 *     RUN65  valid nested schema value containing legal "__proto__" data
 *            -> preserved iff that nested schema permits arbitrary JSON data
 *
 *   E-C14 — closure authority is epoch-bound.
 *     RUN66  PASS -> REPAIR -> REPAIR_FINISHED -> SUCCESS       -> INVALID_EVIDENCE
 *     RUN67  PASS -> REPAIR -> REPAIR_FINISHED -> new PASS      -> TERMINAL/SUCCESS
 *     RUN68  PASS -> completed post-gate ACTION cycle (no regate)
 *            -> SUCCESS                                       -> INVALID_EVIDENCE
 *     RUN69  FAIL -> repair -> PASS -> SUCCESS                  -> TERMINAL/SUCCESS
 *     RUN70  PASS -> completed post-gate ACTION cycle          -> INVALID_EVIDENCE
 *     RUN71  PASS -> completed post-gate ACTION cycle -> new PASS
 *                                                              -> TERMINAL/SUCCESS
 *     RUN72  multiple ACTION cycles -> single final PASS gate  -> TERMINAL/SUCCESS
 *
 *   E-C21 — ACTION_FINISHED(ERROR) invalidates prior positive authority.
 *     RUN73  gate PASS -> ACTION_FINISHED(ERROR) -> SUCCESS     -> INVALID_EVIDENCE
 *     RUN74  gate PASS -> ACTION ERROR -> new work -> new PASS -> TERMINAL/SUCCESS
 *
 *   E-C22 — REVIEW_FINISHED(false) blocks SUCCESS at the current work epoch.
 *     RUN75  gate PASS -> REVIEW FAIL -> SUCCESS                -> INVALID_EVIDENCE
 *     RUN76  gate PASS -> REVIEW FAIL -> REVIEW PASS -> SUCCESS -> TERMINAL/SUCCESS
 *     RUN77  gate PASS -> REVIEW FAIL -> REPAIR -> new PASS -> SUCCESS
 *                                                              -> TERMINAL/SUCCESS
 *
 *   E-C15 — neutral canonical dependency direction.
 *     RUN_GRAPH  run-events MUST NOT import from run-store
 *                run-projector MUST NOT import from run-store
 *
 *   E-C16 — Phase-E hostile append boundary acceptance (RUN59/60/64).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  makeInMemoryRunStore,
  makeContentBoundEventIdSource,
} from "../../src/run/run-store.js";
import { projectRun } from "../../src/run/run-projector.js";
import { snapshotJsonValue } from "../../src/run/run-json.js";

import type {
  CommittedRunEvent,
  RunEvent,
  RunId,
} from "../../src/run/run-types.js";
import {
  makeRunEventId,
  makeRepairCycleId,
} from "../../src/run/run-types.js";

import {
  commitEvent,
  ids,
  makeTestManifest,
  seqEventIds,
} from "./run-evidence-contract-helpers.js";
// ---------------------------------------------------------------------------
// E-C12 — snapshot precedes every semantic observation
// ---------------------------------------------------------------------------

test("RUN59 store.append accessor event → rejected, getter count = 0", () => {
  let getterCount = 0;
  const input: Record<string, unknown> = {
    type: "ACTION_STARTED",
    target: { kind: "attempt", attempt_id: ids.attempt },
  };
  Object.defineProperty(input, "type", {
    get(): string {
      getterCount += 1;
      return "ACTION_STARTED";
    },
    enumerable: true,
    configurable: true,
  });
  const store = makeInMemoryRunStore({ nowMs: () => 0 });
  const manifest = makeTestManifest();
  store.init(manifest);
  const r = store.append(
    manifest,
    input as unknown as RunEvent,
    makeRunEventId(`evt:${manifest.run_id}:acc`),
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "hostile_payload");
  }
  assert.equal(getterCount, 0);
  assert.equal(store.readRun(manifest.run_id).length, 0);
});

test("RUN60 store.append Proxy event → rejected, get-trap count = 0", () => {
  let getCount = 0;
  let ownKeysCount = 0;
  const trap: ProxyHandler<Record<string, unknown>> = {
    get(_t, _k): unknown {
      getCount += 1;
      return undefined;
    },
    ownKeys(): string[] {
      ownKeysCount += 1;
      return [];
    },
    getOwnPropertyDescriptor(): undefined {
      return undefined;
    },
  };
  const inner = { type: "RUN_STARTED" };
  const proxy = new Proxy(inner, trap);
  const store = makeInMemoryRunStore({ nowMs: () => 0 });
  const manifest = makeTestManifest();
  store.init(manifest);
  const r = store.append(
    manifest,
    proxy as unknown as RunEvent,
    makeRunEventId(`evt:${manifest.run_id}:proxy`),
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "hostile_payload");
  }
  assert.equal(getCount, 0);
  assert.ok(ownKeysCount <= 1);
  assert.equal(store.readRun(manifest.run_id).length, 0);
});

test("RUN61 BigInt in payload → snapshot stage rejects before canonicalization", () => {
  const input: Record<string, unknown> = {
    type: "ACTION_STARTED",
    target: { kind: "attempt", attempt_id: ids.attempt },
  };
  // BigInt is non-JSON-safe. The snapshot stage (Phase D) MUST
  // reject it BEFORE any canonicalization, EventIdSource, or
  // idempotency lookup can observe the raw input graph (E-C12).
  Object.defineProperty(input, "extra", {
    value: 1n,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  const store = makeInMemoryRunStore({ nowMs: () => 0 });
  const manifest = makeTestManifest();
  store.init(manifest);
  const r = store.append(
    manifest,
    input as unknown as RunEvent,
    makeRunEventId(`evt:${manifest.run_id}:bigint`),
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "hostile_payload");
    if (r.failure.kind === "hostile_payload") {
      assert.equal(
        r.failure.stage,
        "snapshot",
        "BigInt MUST be rejected at the snapshot stage, never at decode",
      );
    }
  }
  assert.equal(store.readRun(manifest.run_id).length, 0);
});

// ---------------------------------------------------------------------------
// E-C13 — store enforces the closed-world RunEvent schema
// ---------------------------------------------------------------------------

test("RUN62 ACTION_STARTED + extra __proto__ → reject unknown field", () => {
  const eventInput: RunEvent = {
    type: "ACTION_STARTED",
    target: { kind: "attempt", attempt_id: ids.attempt },
  };
  Object.defineProperty(eventInput, "__proto__", {
    value: { injected: true },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const store = makeInMemoryRunStore({ nowMs: () => 0 });
  const manifest = makeTestManifest();
  store.init(manifest);
  const r = store.append(
    manifest,
    eventInput,
    makeRunEventId(`evt:${manifest.run_id}:proto`),
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "hostile_payload");
    if (r.failure.kind === "hostile_payload") {
      assert.equal(r.failure.stage, "decode");
      assert.match(r.failure.reason, /__proto__/);
    }
  }
});

test("RUN63 RUN_STARTED + extra ordinary string key → reject", () => {
  const eventInput = {
    type: "RUN_STARTED",
    injected: "x",
  } as unknown as RunEvent;
  const store = makeInMemoryRunStore({ nowMs: () => 0 });
  const manifest = makeTestManifest();
  store.init(manifest);
  const r = store.append(
    manifest,
    eventInput,
    makeRunEventId(`evt:${manifest.run_id}:extra`),
  );
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.kind, "hostile_payload");
    if (r.failure.kind === "hostile_payload") {
      assert.equal(r.failure.stage, "decode");
      assert.match(r.failure.reason, /injected/);
    }
  }
});

test("RUN64 symbol/non-enumerable/accessor → reject without observation", () => {
  const sym = Symbol("phase-e-sym");
  const a: Record<string | symbol, unknown> = { type: "RUN_STARTED" };
  Object.defineProperty(a, sym, {
    value: "x",
    enumerable: true,
    configurable: true,
  });
  const store1 = makeInMemoryRunStore({ nowMs: () => 0 });
  const m1 = makeTestManifest();
  store1.init(m1);
  const r1 = store1.append(
    m1,
    a as unknown as RunEvent,
    makeRunEventId(`evt:${m1.run_id}:sym`),
  );
  assert.equal(r1.ok, false);
  if (!r1.ok) {
    assert.equal(r1.failure.kind, "hostile_payload");
    if (r1.failure.kind === "hostile_payload") {
      assert.equal(r1.failure.stage, "snapshot");
    }
  }

  const b: Record<string, unknown> = { type: "RUN_STARTED" };
  Object.defineProperty(b, "secret", {
    value: "x",
    enumerable: false,
    configurable: true,
  });
  const store2 = makeInMemoryRunStore({ nowMs: () => 0 });
  const m2 = makeTestManifest();
  store2.init(m2);
  const r2 = store2.append(
    m2,
    b as unknown as RunEvent,
    makeRunEventId(`evt:${m2.run_id}:ne`),
  );
  assert.equal(r2.ok, false);
  if (!r2.ok) {
    assert.equal(r2.failure.kind, "hostile_payload");
    if (r2.failure.kind === "hostile_payload") {
      assert.equal(r2.failure.stage, "snapshot");
    }
  }

  let getterCount = 0;
  const c: Record<string, unknown> = { type: "RUN_STARTED" };
  Object.defineProperty(c, "x", {
    get(): undefined {
      getterCount += 1;
      return undefined;
    },
    enumerable: true,
    configurable: true,
  });
  const store3 = makeInMemoryRunStore({ nowMs: () => 0 });
  const m3 = makeTestManifest();
  store3.init(m3);
  const r3 = store3.append(
    m3,
    c as unknown as RunEvent,
    makeRunEventId(`evt:${m3.run_id}:acc2`),
  );
  assert.equal(r3.ok, false);
  if (!r3.ok) {
    assert.equal(r3.failure.kind, "hostile_payload");
  }
  assert.equal(getterCount, 0);
});

test("RUN65 nested __proto__ as data inside an arbitrary JSON object is preserved by the snapshotter (D-M10)", () => {
  // Phase E RunEvent schema has NO field that accepts arbitrary
  // JSON data — every nested value is closed-world. So this
  // probe exercises the Phase-D D-M10 invariant directly via
  // the snapshotter: a nested object with own `__proto__` as
  // data is preserved honestly through the hardened boundary.
  const inner: Record<string, unknown> = { a: 1 };
  Object.defineProperty(inner, "__proto__", {
    value: { nested_data: "preserved" },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  // Verify the snapshotter preserves __proto__ as data inside a
  // null-prototype record. This is the Phase-D D-M10 invariant
  // that survives CORRECTION03 unchanged.
  const snap = snapshotJsonValue(inner);
  assert.equal(snap.ok, true);
  if (!snap.ok) return;
  const v = snap.value as Record<string, unknown>;
  const nestedProto = v["__proto__"];
  assert.ok(nestedProto !== undefined);
  const asPlain = JSON.parse(JSON.stringify(nestedProto));
  assert.deepEqual(asPlain, { nested_data: "preserved" });
});




// ---------------------------------------------------------------------------
// E-C14 — closure authority is epoch-bound
// ---------------------------------------------------------------------------

function buildStream(
  factories: ReadonlyArray<(seq: number) => RunEvent>,
): {
  readonly manifest: ReturnType<typeof makeTestManifest>;
  readonly events: ReadonlyArray<CommittedRunEvent>;
} {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [];
  for (let i = 0; i < factories.length; i++) {
    events.push(commitEvent(manifest, factories[i]!(i + 1), i + 1, eids[i]!));
  }
  return { manifest, events };
}

test("RUN66 PASS → REPAIR → REPAIR_FINISHED → SUCCESS → INVALID_EVIDENCE", () => {
  const repair = makeRepairCycleId("repair:c3-66");
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "OK" }),
    () => ({ type: "REPAIR_STARTED", repair_id: repair, reason: "fix regression" }),
    () => ({ type: "REPAIR_FINISHED", repair_id: repair }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "INVALID_EVIDENCE");
  assert.equal(r.value.terminal_outcome, null);
  assert.equal(r.value.closure_authority_fresh, false);
  assert.ok(r.value.work_epoch >= 1);
});

test("RUN67 PASS → REPAIR → REPAIR_FINISHED → new PASS → SUCCESS → TERMINAL/SUCCESS", () => {
  const repair = makeRepairCycleId("repair:c3-67");
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "OK" }),
    () => ({ type: "REPAIR_STARTED", repair_id: repair, reason: "fix regression" }),
    () => ({ type: "REPAIR_FINISHED", repair_id: repair }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt2 } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate2, attempt_id: ids.attempt2 }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate2, attempt_id: ids.attempt2, pass: true }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt2 }, status: "OK" }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "SUCCESS");
  assert.equal(r.value.closure_authority_fresh, true);
});

test("RUN68 PASS → completed post-gate ACTION cycle (no regate) → SUCCESS → INVALID_EVIDENCE", () => {
  // CORRECTION04 V2 rule: even when the post-gate action is
  // FULLY CLOSED (no open attempt scope), ACTION_STARTED still
  // advances the work epoch. The prior passing gate is therefore
  // stale at the terminal event:
  //
  //   closureGatePass === true
  //     BUT closureGateEpoch !== workEpoch  (because the post-
  //     gate ACTION_STARTED advanced the epoch)
  //
  // Under V1 this case was incorrectly permitted because
  // ACTION_STARTED did not advance workEpoch and the only
  // structural reject was `openAttemptId !== null`. The
  // projector now reports INVALID_EVIDENCE, demonstrating that
  // completed post-gate work without regate cannot authorize
  // SUCCESS — even when no scope is structurally open.
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "OK" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt2 } }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt2 }, status: "OK" }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "INVALID_EVIDENCE");
  assert.equal(r.value.terminal_outcome, null);
  // The recorded gate authority is stale at the terminal event:
  // workEpoch advanced when the second ACTION_STARTED fired.
  assert.equal(r.value.closure_authority_fresh, false);
});

test("RUN69 FAIL → REPAIR → PASS → SUCCESS → TERMINAL/SUCCESS", () => {
  const repair = makeRepairCycleId("repair:c3-69");
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: false, reason: "first attempt fails" }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "ERROR", failure: { kind: "tool_failure", tool: "x", message: "boom" } }),
    () => ({ type: "REPAIR_STARTED", repair_id: repair, reason: "fix regression" }),
    () => ({ type: "REPAIR_FINISHED", repair_id: repair }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt2 } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate2, attempt_id: ids.attempt2 }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate2, attempt_id: ids.attempt2, pass: true }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt2 }, status: "OK" }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "SUCCESS");
  assert.equal(r.value.closure_authority_fresh, true);
});

// ---------------------------------------------------------------------------
// E-C14 V2 — ACTION_STARTED advances workEpoch; regate required after
// post-gate work. RUN70/71/72 establish the precise temporal rule.
// ---------------------------------------------------------------------------

test("RUN70 PASS → completed post-gate ACTION cycle → SUCCESS → INVALID_EVIDENCE", () => {
  // Work -> PASS gate -> new ACTION_STARTED -> ACTION_FINISHED
  // (closed scope) -> SUCCESS. The completion of an action after
  // the passing gate stales the gate's authority; without a
  // regate, the projector must report INVALID_EVIDENCE.
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "OK" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt2 } }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt2 }, status: "OK" }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "INVALID_EVIDENCE");
  assert.equal(r.value.terminal_outcome, null);
  assert.equal(r.value.closure_authority_fresh, false);
});

test("RUN71 PASS → completed post-gate ACTION cycle → new PASS → SUCCESS → TERMINAL/SUCCESS", () => {
  // Work -> PASS gate -> new ACTION_STARTED -> ACTION_FINISHED
  // -> new PASS gate -> SUCCESS. The fresh gate at the current
  // work epoch re-establishes closure authority and authorizes
  // SUCCESS.
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "OK" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt2 } }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt2 }, status: "OK" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt3 } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate3, attempt_id: ids.attempt3 }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate3, attempt_id: ids.attempt3, pass: true }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt3 }, status: "OK" }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "SUCCESS");
  assert.equal(r.value.closure_authority_fresh, true);
});

test("RUN72 multiple ACTION cycles → single final PASS gate → SUCCESS → TERMINAL/SUCCESS", () => {
  // The projector maintains a single closure-authority
  // record per gate. Multiple ACTION cycles that all complete
  // before the final PASS gate do not require a regate after
  // each one — the final gate captures the current work
  // epoch and authorizes SUCCESS for the whole run.
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "OK" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt2 } }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt2 }, status: "OK" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt3 } }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt3 }, status: "OK" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true }),
    () => ({ type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "OK" }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "SUCCESS");
  assert.equal(r.value.closure_authority_fresh, true);
});

// ---------------------------------------------------------------------------
// E-C21 — ACTION_FINISHED(ERROR) invalidates prior positive authority
// ---------------------------------------------------------------------------

test("RUN73 gate PASS → ACTION_FINISHED(ERROR) → SUCCESS → INVALID_EVIDENCE", () => {
  // The ACTION ran, the gate PASSED, then the action reported
  // ERROR. Per E-C21, an ACTION_FINISHED(ERROR) is authoritative
  // negative execution evidence and must invalidate any prior
  // passing gate. The simplest V1/V3 model: applyActionFinished
  // advances workEpoch on ERROR; the closure-gate epoch then no
  // longer matches the work epoch; the success predicate
  // rejects the SUCCESS claim.
  //
  // The projection also surfaces the negative evidence
  // directly (E-C23):
  //   last_action_status            = "ERROR"
  //   action_failure_at_epoch       = current workEpoch
  //   current_epoch_action_failure  = true
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true }),
    () => ({
      type: "ACTION_FINISHED",
      target: { kind: "attempt", attempt_id: ids.attempt },
      status: "ERROR",
      failure: { kind: "tool_failure", tool: "build", message: "compile failed" },
    }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "INVALID_EVIDENCE");
  assert.equal(r.value.terminal_outcome, null);
  assert.equal(r.value.closure_authority_fresh, false);
  // E-C23: the negative evidence is visible directly in the
  // projection; operators do not need to re-derive it from raw
  // stream archaeology.
  assert.equal(r.value.last_action_status, "ERROR");
  assert.equal(r.value.action_failure_at_epoch, r.value.work_epoch);
  assert.equal(r.value.current_epoch_action_failure, true);
  assert.equal(r.value.current_epoch_review_failure, false);
});

test("RUN74 gate PASS → ACTION ERROR → new work → new gate PASS → SUCCESS → TERMINAL/SUCCESS", () => {
  // The first attempt ran, the gate passed, then the action
  // reported ERROR. Subsequent work (new action + new gate) at
  // a new work epoch re-establishes closure authority and
  // authorizes SUCCESS — the failure is historical at the new
  // epoch.
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true }),
    () => ({
      type: "ACTION_FINISHED",
      target: { kind: "attempt", attempt_id: ids.attempt },
      status: "ERROR",
      failure: { kind: "tool_failure", tool: "build", message: "compile failed" },
    }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt2 } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate2, attempt_id: ids.attempt2 }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate2, attempt_id: ids.attempt2, pass: true }),
    () => ({
      type: "ACTION_FINISHED",
      target: { kind: "attempt", attempt_id: ids.attempt2 },
      status: "OK",
    }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "SUCCESS");
  assert.equal(r.value.closure_authority_fresh, true);
  // E-C23: the historical failure is recorded but no longer
  // current; the current-epoch failure flag is false.
  assert.equal(r.value.last_action_status, "OK");
  assert.equal(r.value.current_epoch_action_failure, false);
});

// ---------------------------------------------------------------------------
// E-C22 — REVIEW_FINISHED(false) blocks SUCCESS at the current work epoch
// ---------------------------------------------------------------------------

test("RUN75 gate PASS → REVIEW FAIL → SUCCESS → INVALID_EVIDENCE", () => {
  // An independent review is explicit verdict evidence.
  // REVIEW_FINISHED(pass=false) at the current work epoch
  // blocks SUCCESS — the gate's pass value is no longer
  // authoritative on its own, and the failing review must
  // be superseded by a later pass OR by later work that
  // advances the work epoch.
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true }),
    () => ({
      type: "ACTION_FINISHED",
      target: { kind: "attempt", attempt_id: ids.attempt },
      status: "OK",
    }),
    () => ({ type: "REVIEW_STARTED", review_id: ids.review, reason: "post-gate audit" }),
    () => ({ type: "REVIEW_FINISHED", review_id: ids.review, pass: false, reason: "lint regression" }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "INVALID_EVIDENCE");
  assert.equal(r.value.terminal_outcome, null);
  // Note: closure_authority_fresh here reports the GATE-only
  // freshness (last closing gate epoch === work epoch, gate
  // pass). The SUCCESS claim is rejected not by gate staleness
  // but by the current-epoch failing review verdict. The two
  // booleans are orthogonal diagnostics of orthogonal concerns.
  assert.equal(r.value.closure_authority_fresh, true);
  // E-C23: the failing review verdict is visible directly.
  assert.equal(r.value.last_review_pass, false);
  assert.equal(r.value.review_failure_at_epoch, r.value.work_epoch);
  assert.equal(r.value.current_epoch_review_failure, true);
  assert.equal(r.value.current_epoch_action_failure, false);
});

test("RUN76 gate PASS → REVIEW FAIL → REVIEW PASS → SUCCESS → TERMINAL/SUCCESS", () => {
  // A later review at the same work epoch with pass=true
  // supersedes the earlier failing verdict. SUCCESS is
  // authorized because the most recent review verdict at
  // the current work epoch is positive.
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true }),
    () => ({
      type: "ACTION_FINISHED",
      target: { kind: "attempt", attempt_id: ids.attempt },
      status: "OK",
    }),
    () => ({ type: "REVIEW_STARTED", review_id: ids.review, reason: "post-gate audit" }),
    () => ({ type: "REVIEW_FINISHED", review_id: ids.review, pass: false, reason: "first reviewer found regression" }),
    () => ({ type: "REVIEW_STARTED", review_id: ids.review2, reason: "second review after fix" }),
    () => ({ type: "REVIEW_FINISHED", review_id: ids.review2, pass: true }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "SUCCESS");
  assert.equal(r.value.closure_authority_fresh, true);
  // E-C23: the LAST review verdict is pass=true, so the
  // current-epoch review-failure flag is false.
  assert.equal(r.value.last_review_pass, true);
  assert.equal(r.value.current_epoch_review_failure, false);
});

test("RUN77 gate PASS → REVIEW FAIL → REPAIR → new gate PASS → SUCCESS → TERMINAL/SUCCESS", () => {
  // The failing review verdict is historical at the new
  // work epoch: REPAIR_STARTED advances workEpoch, and the
  // subsequent fresh gate authorizes SUCCESS at that new
  // epoch. The projection still records the historical
  // failing review for diagnostics, but the current-epoch
  // review-failure flag is false.
  const repair = makeRepairCycleId("repair:c3-77");
  const { manifest, events } = buildStream([
    () => ({ type: "RUN_STARTED" }),
    () => ({ type: "HARNESS_STARTED" }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true }),
    () => ({
      type: "ACTION_FINISHED",
      target: { kind: "attempt", attempt_id: ids.attempt },
      status: "OK",
    }),
    () => ({ type: "REVIEW_STARTED", review_id: ids.review, reason: "post-gate audit" }),
    () => ({ type: "REVIEW_FINISHED", review_id: ids.review, pass: false, reason: "lint regression" }),
    () => ({ type: "REPAIR_STARTED", repair_id: repair, reason: "fix regression" }),
    () => ({ type: "REPAIR_FINISHED", repair_id: repair }),
    () => ({ type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt2 } }),
    () => ({ type: "GATE_STARTED", gate_id: ids.gate2, attempt_id: ids.attempt2 }),
    () => ({ type: "GATE_FINISHED", gate_id: ids.gate2, attempt_id: ids.attempt2, pass: true }),
    () => ({
      type: "ACTION_FINISHED",
      target: { kind: "attempt", attempt_id: ids.attempt2 },
      status: "OK",
    }),
    () => ({ type: "HARNESS_STOPPED" }),
    () => ({ type: "RUN_FINISHED", semantic: "SUCCESS" }),
  ]);
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "SUCCESS");
  assert.equal(r.value.closure_authority_fresh, true);
  // E-C23: the historical failing review is recorded but no
  // longer current.
  assert.equal(r.value.last_review_pass, false);
  assert.ok(r.value.review_failure_at_epoch !== null);
  assert.ok(r.value.review_failure_at_epoch! < r.value.work_epoch);
  assert.equal(r.value.current_epoch_review_failure, false);
});

test("RUN_GRAPH run-events and run-projector MUST NOT import run-store", async () => {
  const { readFile } = await import("node:fs/promises");
  const eventsSrc = await readFile("src/run/run-events.ts", "utf8");
  const projectorSrc = await readFile("src/run/run-projector.ts", "utf8");
  assert.ok(
    !/from\s+["']\.\/run-store\.js["']/.test(eventsSrc),
    "run-events.ts MUST NOT import from run-store (E-C15)",
  );
  assert.ok(
    !/from\s+["']\.\/run-store["']/.test(eventsSrc),
    "run-events.ts MUST NOT import from run-store (E-C15, raw)",
  );
  assert.ok(
    !/from\s+["']\.\/run-store\.js["']/.test(projectorSrc),
    "run-projector.ts MUST NOT import from run-store (E-C15)",
  );
  assert.ok(
    !/from\s+["']\.\/run-store["']/.test(projectorSrc),
    "run-projector.ts MUST NOT import from run-store (E-C15, raw)",
  );
  assert.ok(
    /from\s+["']\.\/run-serialize\.js["']/.test(eventsSrc),
    "run-events.ts MUST import canonicalEventBytes from run-serialize",
  );
});

// ---------------------------------------------------------------------------
// E-C16 — Phase-E hostile-append boundary acceptance
// ---------------------------------------------------------------------------

test("RUN16_E_PHASE_E hostile input MUST NOT reach canonical encoder or EventIdSource", () => {
  let getCount = 0;
  const trap: ProxyHandler<Record<string, unknown>> = {
    get(_t, _k): unknown {
      getCount += 1;
      return undefined;
    },
    ownKeys(): string[] {
      return [];
    },
    getOwnPropertyDescriptor(): undefined {
      return undefined;
    },
  };
  const inner = { type: "RUN_STARTED" };
  const proxy = new Proxy(inner, trap);
  const store = makeInMemoryRunStore({ nowMs: () => 0 });
  const manifest = makeTestManifest();
  store.init(manifest);
  const r = store.append(
    manifest,
    proxy as unknown as RunEvent,
    makeRunEventId(`evt:${manifest.run_id}:proxy`),
  );
  assert.equal(r.ok, false);
  assert.equal(getCount, 0);
});

// ---------------------------------------------------------------------------
// Default EventIdSource consumes the canonical authority (regression)
// ---------------------------------------------------------------------------

test("Default EventIdSource uses the single canonical encoder", () => {
  const src = makeContentBoundEventIdSource();
  const rid = "run:phase-e-c3-graph" as RunId;
  const a = src.next(
    rid,
    {
      type: "ACTION_FINISHED",
      target: { kind: "attempt", attempt_id: ids.attempt },
      status: "OK",
    },
    1,
  );
  const b = src.next(
    rid,
    {
      status: "OK",
      target: { attempt_id: ids.attempt, kind: "attempt" },
      type: "ACTION_FINISHED",
    },
    1,
  );
  assert.equal(a, b);
});
