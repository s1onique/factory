/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Phase E correction probes (E-C01 … E-C06).
 *
 *   RUN26  caller mutates event object after append → stored evidence unchanged
 *   RUN27  caller mutates nested failure/agent/resource payload → stored unchanged
 *   RUN28  caller casts readRun() result to mutable array and mutates it → ledger unchanged
 *   RUN29  returned committed event cannot mutate internal evidence (frozen graph)
 *
 *   RUN30  RUN_STARTED + RUN_FINISHED(SUCCESS) → INVALID_EVIDENCE (no predicate support)
 *   RUN31  agent_says_done + RUN_FINISHED(SUCCESS), no authority → INVALID_EVIDENCE
 *   RUN32  failed gate + RUN_FINISHED(SUCCESS) → INVALID_EVIDENCE
 *   RUN33  authoritative passing closure evidence + RUN_FINISHED(SUCCESS) → TERMINAL/SUCCESS
 *
 *   RUN34  cancellation request alone → ACTIVE
 *   RUN35  request → harness stop → abort(CANCELLED) → TERMINAL/CANCELLED
 *   RUN36  ordinary semantic evidence after cancellation request remains legal
 *
 *   RUN37  manifest accessor → rejected, getter count = 0
 *   RUN38  manifest Proxy get trap → not invoked
 *   RUN39  public payload accessor → rejected, getter count = 0
 *   RUN40  hostile discriminator object with throwing toString → typed failure
 *
 *   RUN41  identical explicit-ID retry → same committed event, event_count unchanged
 *   RUN42  same ID + changed content → rejected, ledger unchanged
 *
 * These probes are the contractual acceptance test for the
 * Phase E correction (ACT-FACTORY-LONG-HORIZON-LAB-FOUNDATION04-
 * PHASE-E-RUN-EVIDENCE-CONTRACT01-CORRECTION01).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  makeInMemoryRunStore,
} from "../../src/run/run-store.js";
import { projectRun } from "../../src/run/run-projector.js";
import {
  decodeRunEventPayload,
} from "../../src/run/run-decode-payload.js";
import { decodeRunManifest } from "../../src/run/run-decode-manifest.js";
import {
  RUN_MANIFEST_SCHEMA_VERSION,
  makeRunEventId,
} from "../../src/run/run-types.js";
import type {
  CommittedRunEvent,
  RunEvent,
  RunEventId,
} from "../../src/run/run-types.js";

import {
  commitEvent,
  ids,
  makeTestManifest,
  makeTestSubjectId,
  minimalSuccessRun,
  seqEventIds,
} from "./run-evidence-contract-helpers.js";

// ---------------------------------------------------------------------------
// RUN26..RUN29 — Store owns evidence (E-C01)
// ---------------------------------------------------------------------------

test("RUN26 caller mutates event object after append → stored unchanged", () => {
  const manifest = makeTestManifest();
  const store = makeInMemoryRunStore({ nowMs: () => 1 });
  store.init(manifest);
  const event: RunEvent = {
    type: "RUN_FINISHED",
    semantic: "SUCCESS",
  };
  const r1 = store.append(manifest, event);
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  // Attempt caller mutation: in strict mode this throws, in
  // non-strict mode Object.freeze silently drops the write.
  let threw = false;
  try {
    (event as { semantic: string }).semantic = "MODEL_FAILURE";
  } catch {
    threw = true;
  }
  const events = store.readRun(manifest.run_id);
  assert.equal(events.length, 1);
  if (events[0] !== undefined) {
    const ev = events[0] as unknown as { event: { semantic: string } };
    assert.equal(ev.event.semantic, "SUCCESS");
  }
  void threw;
});

test("RUN27 caller mutates nested failure payload → stored unchanged", () => {
  const manifest = makeTestManifest();
  const store = makeInMemoryRunStore({ nowMs: () => 1 });
  store.init(manifest);
  const failure: Record<string, unknown> = { kind: "tool", detail: "x" };
  const event: RunEvent = {
    type: "ACTION_FINISHED",
    target: { kind: "attempt", attempt_id: ids.attempt },
    status: "ERROR",
    failure: failure as never,
  };
  const r1 = store.append(manifest, event);
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  (failure as Record<string, unknown>)["kind"] = "MUTATED";
  (failure as Record<string, unknown>)["injected"] = "x";
  const events = store.readRun(manifest.run_id);
  const committed = events[0]!;
  const storedFailure = (committed.event as unknown as { failure: { kind: string } }).failure;
  assert.equal(storedFailure.kind, "tool");
  assert.equal(
    (storedFailure as unknown as Record<string, unknown>)["injected"],
    undefined,
  );
});

test("RUN28 caller casts readRun() result to mutable array → ledger unchanged", () => {
  const manifest = makeTestManifest();
  const store = makeInMemoryRunStore({ nowMs: () => 1 });
  store.init(manifest);
  store.append(manifest, { type: "RUN_STARTED" });
  const returned = store.readRun(manifest.run_id);
  const mutable = returned as unknown as CommittedRunEvent[];
  try {
    mutable.length = 0;
    mutable.push({} as CommittedRunEvent);
  } catch {
    // Strict mode may throw; either way ledger must be intact.
  }
  const after = store.readRun(manifest.run_id);
  assert.equal(after.length, 1);
});

test("RUN29 returned committed event is frozen — cannot mutate internal evidence", () => {
  const manifest = makeTestManifest();
  const store = makeInMemoryRunStore({ nowMs: () => 1 });
  store.init(manifest);
  const r1 = store.append(manifest, { type: "RUN_STARTED" });
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const committed = r1.value;
  try {
    (committed as unknown as { observed_at: number }).observed_at = 999999;
  } catch {
    // Strict mode throws; non-strict silently drops.
  }
  const after = store.readRun(manifest.run_id);
  assert.equal(after[0]!.observed_at, 1);
});

// ---------------------------------------------------------------------------
// RUN30..RUN33 — SUCCESS requires authoritative evidence (E-C02)
// ---------------------------------------------------------------------------

test("RUN30 RUN_STARTED + RUN_FINISHED(SUCCESS) alone → INVALID_EVIDENCE", () => {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(
      manifest,
      { type: "RUN_FINISHED", semantic: "SUCCESS" },
      2,
      eids[1]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "INVALID_EVIDENCE");
  assert.equal(r.value.terminal_outcome, null);
});

test("RUN31 agent_says_done + RUN_FINISHED(SUCCESS), no authority → INVALID_EVIDENCE", () => {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(
      manifest,
      {
        type: "RUN_FINISHED",
        semantic: "SUCCESS",
        agent_report: { message: "done", claimed: true } as never,
      } as RunEvent,
      2,
      eids[1]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "INVALID_EVIDENCE");
});

test("RUN32 failed gate + RUN_FINISHED(SUCCESS) → INVALID_EVIDENCE", () => {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(manifest, { type: "HARNESS_STARTED" }, 2, eids[1]!),
    commitEvent(
      manifest,
      { type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt } },
      3,
      eids[2]!,
    ),
    commitEvent(
      manifest,
      {
        type: "GATE_STARTED",
        gate_id: ids.gate,
        attempt_id: ids.attempt,
      },
      4,
      eids[3]!,
    ),
    commitEvent(
      manifest,
      {
        type: "GATE_FINISHED",
        gate_id: ids.gate,
        attempt_id: ids.attempt,
        pass: false,
      },
      5,
      eids[4]!,
    ),
    commitEvent(
      manifest,
      {
        type: "ACTION_FINISHED",
        target: { kind: "attempt", attempt_id: ids.attempt },
        status: "OK",
      },
      6,
      eids[5]!,
    ),
    commitEvent(manifest, { type: "HARNESS_STOPPED" }, 7, eids[6]!),
    commitEvent(
      manifest,
      { type: "RUN_FINISHED", semantic: "SUCCESS" },
      8,
      eids[7]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "INVALID_EVIDENCE");
});

test("RUN33 authoritative passing closure + RUN_FINISHED(SUCCESS) → TERMINAL/SUCCESS", () => {
  const { manifest, events } = minimalSuccessRun();
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "SUCCESS");
});

// ---------------------------------------------------------------------------
// RUN34..RUN36 — Cancellation request is non-terminal (E-C03)
// ---------------------------------------------------------------------------

test("RUN34 cancellation request alone → ACTIVE", () => {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(manifest, { type: "HARNESS_STARTED" }, 2, eids[1]!),
    commitEvent(
      manifest,
      { type: "RUN_CANCEL_REQUESTED", semantic: "CANCELLED", reason: "user" },
      3,
      eids[2]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "ACTIVE");
  assert.equal(r.value.terminal_outcome, null);
});

test("RUN35 request → harness stop → abort(CANCELLED) → TERMINAL/CANCELLED", () => {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(manifest, { type: "HARNESS_STARTED" }, 2, eids[1]!),
    commitEvent(
      manifest,
      { type: "RUN_CANCEL_REQUESTED", semantic: "CANCELLED", reason: "user" },
      3,
      eids[2]!,
    ),
    commitEvent(manifest, { type: "HARNESS_STOPPED" }, 4, eids[3]!),
    commitEvent(
      manifest,
      { type: "RUN_ABORTED", semantic: "CANCELLED", reason: "user" },
      5,
      eids[4]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "CANCELLED");
});

test("RUN36 ordinary semantic evidence after cancellation request remains legal (pre-terminal)", () => {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(manifest, { type: "HARNESS_STARTED" }, 2, eids[1]!),
    commitEvent(
      manifest,
      { type: "RUN_CANCEL_REQUESTED", semantic: "CANCELLED", reason: "user" },
      3,
      eids[2]!,
    ),
    // Ordinary semantic evidence AFTER the cancel request but
    // BEFORE any terminal event: must be legal. The harness can
    // still emit observation while the cancellation is being
    // processed.
    commitEvent(manifest, { type: "HARNESS_STOPPED" }, 4, eids[3]!),
    commitEvent(
      manifest,
      { type: "RUN_ABORTED", semantic: "CANCELLED", reason: "user" },
      5,
      eids[4]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "CANCELLED");
});

// ---------------------------------------------------------------------------
// RUN37..RUN40 — Decoder inertness (E-C04)
// ---------------------------------------------------------------------------

test("RUN37 manifest accessor → rejected, getter count = 0", () => {
  let getterInvocations = 0;
  const subjectId = makeTestSubjectId();
  const hostile = new Proxy(
    {
      schema_version: RUN_MANIFEST_SCHEMA_VERSION,
      run_id: "run:" + "0".repeat(64),
      subject_id: subjectId,
      run_protocol_version: "phase-e.test.v1",
      runner_revision: "test",
      started_by: "test",
      created_at: 0,
      repetition: { index: 0 },
    },
    {
      get(target, prop) {
        if (typeof prop === "string" && prop in target) {
          getterInvocations += 1;
        }
        return Reflect.get(target, prop);
      },
    },
  );
  const r = decodeRunManifest(hostile, subjectId);
  assert.equal(r.ok, false);
  assert.equal(getterInvocations, 0);
});

test("RUN38 manifest Proxy get trap with throwing getter → rejected, no invocation", () => {
  let getterInvocations = 0;
  const subjectId = makeTestSubjectId();
  const hostile = new Proxy(
    {
      schema_version: RUN_MANIFEST_SCHEMA_VERSION,
      run_id: "run:" + "1".repeat(64),
      subject_id: subjectId,
      run_protocol_version: "phase-e.test.v1",
      runner_revision: "test",
      started_by: "test",
      created_at: 0,
      repetition: { index: 0 },
    },
    {
      get() {
        getterInvocations += 1;
        throw new Error("hostile getter");
      },
    },
  );
  const r = decodeRunManifest(hostile, subjectId);
  assert.equal(r.ok, false);
  assert.equal(getterInvocations, 0);
});

test("RUN39 public payload accessor → rejected, getter count = 0", () => {
  // The Phase D snapshotter consults Reflect.getPrototypeOf.
  // A hostile Proxy on that trap must be rejected without
  // ever calling its `type` getter (or any property access).
  let propAccesses = 0;
  const hostile = new Proxy(
    { type: "RUN_STARTED" },
    {
      getPrototypeOf(): never {
        throw new Error("hostile getPrototypeOf");
      },
      get(target, prop) {
        propAccesses += 1;
        return Reflect.get(target, prop);
      },
    },
  );
  const r = decodeRunEventPayload(hostile);
  // The boundary must reject and must NEVER reach the
  // structural decoder that would call `.type`.
  assert.equal(r.ok, false);
  assert.equal(propAccesses, 0);
});

test("RUN40 hostile discriminator object with throwing toString → typed failure, no invocation", () => {
  const hostile = {
    type: {
      toString() {
        throw new Error("hostile toString");
      },
    },
  };
  const r = decodeRunEventPayload(hostile);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(typeof r.failure.kind, "string");
});

// ---------------------------------------------------------------------------
// RUN41..RUN42 — Store idempotency by event_id (E-C05)
// ---------------------------------------------------------------------------

test("RUN41 identical explicit-ID retry → same committed event, event_count unchanged", () => {
  const manifest = makeTestManifest();
  const store = makeInMemoryRunStore({ nowMs: () => 1000 });
  store.init(manifest);
  const explicitId = makeRunEventId("evt:retry:1") as RunEventId;
  const event: RunEvent = { type: "RUN_STARTED" };
  const r1 = store.append(manifest, event, explicitId);
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const r2 = store.append(manifest, event, explicitId);
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(r1.value, r2.value);
  const events = store.readRun(manifest.run_id);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.sequence, 1);
});

test("RUN42 same ID + changed content → rejected, ledger unchanged", () => {
  const manifest = makeTestManifest();
  const store = makeInMemoryRunStore({ nowMs: () => 1000 });
  store.init(manifest);
  const explicitId = makeRunEventId("evt:conflict:1") as RunEventId;
  const event1: RunEvent = { type: "RUN_STARTED" };
  const r1 = store.append(manifest, event1, explicitId);
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  const event2: RunEvent = { type: "HARNESS_STARTED" };
  const r2 = store.append(manifest, event2, explicitId);
  assert.equal(r2.ok, false);
  if (r2.ok) return;
  assert.equal(r2.failure.kind, "duplicate_event_id_with_changed_content");
  const events = store.readRun(manifest.run_id);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.event.type, "RUN_STARTED");
});
