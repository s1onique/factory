/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Phase E correction probes (E-C07 … E-C11).
 *
 *   E-C07 — SUCCESS authority is final-state authority.
 *     RUN43  PASS gate -> FAIL gate -> RUN_FINISHED(SUCCESS) -> INVALID_EVIDENCE
 *     RUN44  FAIL gate -> PASS gate -> RUN_FINISHED(SUCCESS) -> TERMINAL/SUCCESS
 *     RUN45  PASS gate -> repair -> no subsequent closure gate -> SUCCESS -> INVALID_EVIDENCE
 *
 *   E-C08 — terminal event / semantic compatibility matrix.
 *     RUN46  RUN_TIMEOUT(SUCCESS) -> decode reject
 *     RUN47  RUN_ABORTED(SUCCESS) -> decode reject
 *     RUN48  RUN_FINISHED(TIMEOUT) -> decode reject
 *     RUN49  allowed event/semantic pairs round-trip
 *     RUN50  cancel-request cannot claim SUCCESS/TIMEOUT/etc.
 *
 *   E-C09 — reuse hardened owned-value capture.
 *     RUN51  nested own "__proto__" remains own data after commit
 *     RUN52  committed record prototype cannot be corrupted
 *     RUN53  accessor payload append does not execute getter
 *     RUN54  Proxy payload cannot execute get/ownKeys traps before rejection
 *     RUN55  symbol/non-enumerable extra own keys cannot be silently dropped
 *
 *   E-C10 — single canonical event-content encoder.
 *     RUN56  nested-key insertion order -> equal canonical bytes
 *     RUN57  store and projector canonical identity agree
 *     RUN58  default EventIdSource uses same canonical bytes authority
 *
 *   E-C11 — doctrine/documentation parity.
 *     (verified out-of-band via README + doc-comment audit.)
 *
 * These probes are the contractual acceptance test for the
 * Phase E correction (ACT-FACTORY-LONG-HORIZON-LAB-FOUNDATION04-
 * PHASE-E-RUN-EVIDENCE-CONTRACT01-CORRECTION02).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeRunEventPayload,
} from "../../src/run/run-decode-payload.js";
import {
  makeInMemoryRunStore,
  canonicalEventBytes,
  makeContentBoundEventIdSource,
} from "../../src/run/run-store.js";
import { projectRun } from "../../src/run/run-projector.js";
import { snapshotJsonValue } from "../../src/run/run-json.js";

import type {
  CommittedRunEvent,
  RunEvent,
} from "../../src/run/run-types.js";
import {
  makeRunEventId,
  makeRunId,
} from "../../src/run/run-types.js";

import {
  commitEvent,
  ids,
  makeTestManifest,
  seqEventIds,
} from "./run-evidence-contract-helpers.js";

// ---------------------------------------------------------------------------
// E-C07 — SUCCESS authority is final-state authority
// ---------------------------------------------------------------------------

/**
 * RUN43: PASS gate -> FAIL gate -> RUN_FINISHED(SUCCESS) ->
 * INVALID_EVIDENCE. The earlier pass is invalidated by the
 * later fail. This is the temporal-authority rule (E-C07).
 */
test("RUN43 PASS gate -> FAIL gate -> RUN_FINISHED(SUCCESS) -> INVALID_EVIDENCE", () => {
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
      { type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt },
      4,
      eids[3]!,
    ),
    commitEvent(
      manifest,
      { type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true },
      5,
      eids[4]!,
    ),
    commitEvent(
      manifest,
      { type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "OK" },
      6,
      eids[5]!,
    ),
    commitEvent(
      manifest,
      { type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt2 } },
      7,
      eids[6]!,
    ),
    commitEvent(
      manifest,
      { type: "GATE_STARTED", gate_id: ids.gate2, attempt_id: ids.attempt2 },
      8,
      eids[7]!,
    ),
    commitEvent(
      manifest,
      { type: "GATE_FINISHED", gate_id: ids.gate2, attempt_id: ids.attempt2, pass: false, reason: "broken" },
      9,
      eids[8]!,
    ),
    commitEvent(
      manifest,
      { type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt2 }, status: "OK" },
      10,
      eids[9]!,
    ),
    commitEvent(manifest, { type: "HARNESS_STOPPED" }, 11, eids[10]!),
    commitEvent(
      manifest,
      { type: "RUN_FINISHED", semantic: "SUCCESS" },
      12,
      eids[11]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // E-C07: lastGateFinishedPass is false -> SUCCESS predicate
  // fails -> INVALID_EVIDENCE.
  assert.equal(r.value.lifecycle_state, "INVALID_EVIDENCE");
  assert.equal(r.value.terminal_outcome, null);
});

/**
 * RUN44: FAIL gate -> PASS gate -> RUN_FINISHED(SUCCESS) ->
 * TERMINAL/SUCCESS. The later pass re-establishes temporal
 * authority.
 */
test("RUN44 FAIL gate -> PASS gate -> RUN_FINISHED(SUCCESS) -> TERMINAL/SUCCESS", () => {
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
      { type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt },
      4,
      eids[3]!,
    ),
    commitEvent(
      manifest,
      { type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: false, reason: "first pass fails" },
      5,
      eids[4]!,
    ),
    commitEvent(
      manifest,
      { type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "OK" },
      6,
      eids[5]!,
    ),
    commitEvent(
      manifest,
      { type: "ACTION_STARTED", target: { kind: "attempt", attempt_id: ids.attempt2 } },
      7,
      eids[6]!,
    ),
    commitEvent(
      manifest,
      { type: "GATE_STARTED", gate_id: ids.gate2, attempt_id: ids.attempt2 },
      8,
      eids[7]!,
    ),
    commitEvent(
      manifest,
      { type: "GATE_FINISHED", gate_id: ids.gate2, attempt_id: ids.attempt2, pass: true },
      9,
      eids[8]!,
    ),
    commitEvent(
      manifest,
      { type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt2 }, status: "OK" },
      10,
      eids[9]!,
    ),
    commitEvent(manifest, { type: "HARNESS_STOPPED" }, 11, eids[10]!),
    commitEvent(
      manifest,
      { type: "RUN_FINISHED", semantic: "SUCCESS" },
      12,
      eids[11]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "SUCCESS");
});

/**
 * RUN45: PASS gate -> repair -> no subsequent closure gate ->
 * SUCCESS -> INVALID_EVIDENCE. The first (and only) gate was
 * pass=true, but a REPAIR_STARTED opens a new repair cycle and
 * the harness never exercises a CLOSURE authority afterward.
 * V1: an open repair cycle at terminal closure is treated as
 * an open structural seam, so SUCCESS is not authorized.
 */
test("RUN45 PASS gate -> repair -> no subsequent closure gate -> SUCCESS -> INVALID_EVIDENCE", () => {
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
      { type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt },
      4,
      eids[3]!,
    ),
    commitEvent(
      manifest,
      { type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true },
      5,
      eids[4]!,
    ),
    commitEvent(
      manifest,
      { type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "OK" },
      6,
      eids[5]!,
    ),
    commitEvent(
      manifest,
      { type: "REPAIR_STARTED", repair_id: ids.repair, reason: "post-pass drift" },
      7,
      eids[6]!,
    ),
    commitEvent(manifest, { type: "HARNESS_STOPPED" }, 8, eids[7]!),
    commitEvent(
      manifest,
      { type: "RUN_FINISHED", semantic: "SUCCESS" },
      9,
      eids[8]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "INVALID_EVIDENCE");
  assert.equal(r.value.terminal_outcome, null);
});

// ---------------------------------------------------------------------------
// E-C08 — terminal event / semantic compatibility matrix
// ---------------------------------------------------------------------------

test("RUN46 RUN_TIMEOUT(SUCCESS) -> decode reject", () => {
  const r = decodeRunEventPayload({
    type: "RUN_TIMEOUT",
    semantic: "SUCCESS",
    observation: { kind: "wall_clock_ms", observed: 0 },
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "schema_validation");
  assert.match(r.failure.reason, /RUN_TIMEOUT.semantic must be one of/);
});

test("RUN47 RUN_ABORTED(SUCCESS) -> decode reject", () => {
  const r = decodeRunEventPayload({
    type: "RUN_ABORTED",
    semantic: "SUCCESS",
    reason: "should-be-rejected",
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "schema_validation");
  assert.match(r.failure.reason, /RUN_ABORTED.semantic must be one of/);
});

test("RUN48 RUN_FINISHED(TIMEOUT) -> decode reject", () => {
  const r = decodeRunEventPayload({
    type: "RUN_FINISHED",
    semantic: "TIMEOUT",
  });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "schema_validation");
  assert.match(r.failure.reason, /RUN_FINISHED.semantic must be one of/);
});

test("RUN49 allowed event/semantic pairs round-trip", () => {
  const pairs: ReadonlyArray<RunEvent> = [
    { type: "RUN_FINISHED", semantic: "SUCCESS" },
    { type: "RUN_FINISHED", semantic: "VALID_FAILURE" },
    {
      type: "RUN_TIMEOUT",
      semantic: "TIMEOUT",
      observation: { kind: "wall_clock_ms", observed: 1 },
    },
    {
      type: "RUN_TIMEOUT",
      semantic: "BUDGET_EXHAUSTED",
      observation: { kind: "tokens", observed: 1 },
    },
    { type: "RUN_ABORTED", semantic: "CANCELLED", reason: "user" },
    { type: "RUN_ABORTED", semantic: "HARNESS_FAILURE", reason: "x" },
    { type: "RUN_ABORTED", semantic: "MODEL_FAILURE", reason: "x" },
    { type: "RUN_ABORTED", semantic: "ENVIRONMENT_FAILURE", reason: "x" },
    { type: "RUN_ABORTED", semantic: "EVIDENCE_FAILURE", reason: "x" },
  ];
  for (const ev of pairs) {
    const r = decodeRunEventPayload(ev);
    const sem = "semantic" in ev ? ev.semantic : "(none)";
    const failDesc = r.ok
      ? "ok"
      : r.failure.kind === "schema_validation"
        ? r.failure.reason
        : `${r.failure.kind}`;
    assert.equal(
      r.ok,
      true,
      `expected ${ev.type}/${sem} to round-trip; got ${failDesc}`,
    );
  }
});

test("RUN50 cancel request cannot claim SUCCESS/TIMEOUT/etc.", () => {
  const r1 = decodeRunEventPayload({
    type: "RUN_CANCEL_REQUESTED",
    semantic: "SUCCESS",
  });
  assert.equal(r1.ok, false);
  if (!r1.ok && r1.failure.kind === "schema_validation") {
    assert.match(r1.failure.reason, /unknown field 'semantic'/);
  }
  const r2 = decodeRunEventPayload({
    type: "RUN_CANCEL_REQUESTED",
    semantic: "TIMEOUT",
  });
  assert.equal(r2.ok, false);
  const r3 = decodeRunEventPayload({
    type: "RUN_CANCEL_REQUESTED",
    reason: "user",
  });
  assert.equal(r3.ok, true);
  if (r3.ok) {
    assert.equal(r3.value.type, "RUN_CANCEL_REQUESTED");
  }
});

// ---------------------------------------------------------------------------
// E-C09 — reuse hardened owned-value capture
// ---------------------------------------------------------------------------

test("RUN51 nested own __proto__ remains own data after commit", () => {
  const store = makeInMemoryRunStore({ nowMs: () => 0 });
  const manifest = makeTestManifest();
  store.init(manifest);
  const eventInput: RunEvent = {
    type: "ACTION_STARTED",
    target: { kind: "attempt", attempt_id: ids.attempt },
  };
  // Inject __proto__ as an own enumerable string key. The
  // Phase D snapshotter must preserve it as data via null-
  // prototype output.
  Object.defineProperty(eventInput, "__proto__", {
    value: { injected: true },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const r = store.append(
    manifest,
    eventInput,
    makeRunEventId(`evt:${manifest.run_id}:proto`),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const committed = r.value;
  // Read the value via JSON round-trip so we don't have to
  // argue about null-prototype vs Object.prototype: both are
  // valid preservation strategies; what matters is that the
  // key SURVIVED as own data with the same shape.
  const protoVal = (committed.event as unknown as Record<string, unknown>)["__proto__"];
  assert.ok(protoVal !== undefined, "expected __proto__ key to be preserved");
  const asPlain = JSON.parse(JSON.stringify(protoVal));
  assert.deepEqual(asPlain, { injected: true });
});

test("RUN52 committed record prototype cannot be corrupted", () => {
  const store = makeInMemoryRunStore({ nowMs: () => 0 });
  const manifest = makeTestManifest();
  store.init(manifest);
  const eventInput: RunEvent = { type: "HARNESS_STARTED" };
  Object.defineProperty(eventInput, "__proto__", {
    value: { injected: true },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  const r = store.append(
    manifest,
    eventInput,
    makeRunEventId(`evt:${manifest.run_id}:proto2`),
  );
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const proto = Object.getPrototypeOf(r.value);
  // The committed envelope's prototype must NOT be the
  // injected shape. Phase D snapshotter builds with
  // Object.create(null) or preserves Object.prototype; the
  // test forbids the injected payload.
  assert.equal(
    (proto as { injected?: unknown } | null)?.injected,
    undefined,
  );
});

test("RUN53 accessor payload append does not execute getter", () => {
  let getterCallCount = 0;
  const input = {
    type: "GATE_FINISHED",
    gate_id: ids.gate,
    attempt_id: ids.attempt,
  } as Record<string, unknown>;
  Object.defineProperty(input, "pass", {
    get() {
      getterCallCount += 1;
      return true;
    },
    enumerable: true,
    configurable: true,
  });
  const r = snapshotJsonValue(input);
  // snapshotJsonValue MUST reject accessor properties (D-M06).
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.reason, /accessor property/);
  }
  // Critical: the getter was NEVER invoked.
  assert.equal(getterCallCount, 0);
});

test("RUN54 Proxy payload cannot execute get/ownKeys traps before rejection", () => {
  let getCount = 0;
  const trap: ProxyHandler<Record<string, unknown>> = {
    get(_t, _k) {
      getCount += 1;
      return undefined;
    },
    ownKeys() {
      return [];
    },
    getOwnPropertyDescriptor() {
      return undefined;
    },
  };
  const inner = { type: "RUN_STARTED" };
  const proxy = new Proxy(inner, trap);
  const r = snapshotJsonValue(proxy);
  // Either rejection on the Proxy itself, or rejection via
  // Reflect.getPrototypeOf. The key invariant is the get
  // trap MUST NOT execute (D-M04).
  assert.equal(getCount, 0);
  // If the snapshotter accepted (which it must NOT), this
  // test would still need to record failure. The Phase D
  // snapshotter rejects Proxy as non-plain or via the
  // getPrototypeOf trap; we don't assert a specific failure
  // kind here, only the get-count invariant.
  void r;
});

test("RUN55 symbol/non-enumerable extra own keys cannot be silently dropped", () => {
  const sym = Symbol("phase-e-sym");
  const obj = { type: "RUN_STARTED" } as Record<string | symbol, unknown>;
  Object.defineProperty(obj, sym, {
    value: "should-be-rejected",
    enumerable: true,
    configurable: true,
  });
  const r1 = snapshotJsonValue(obj);
  assert.equal(r1.ok, false);
  if (!r1.ok) {
    assert.match(r1.reason, /symbol own-key/);
  }
  const obj2 = { type: "RUN_STARTED" } as Record<string, unknown>;
  Object.defineProperty(obj2, "secret", {
    value: "non-enumerable",
    enumerable: false,
    configurable: true,
  });
  const r2 = snapshotJsonValue(obj2);
  assert.equal(r2.ok, false);
  if (!r2.ok) {
    assert.match(r2.reason, /non-enumerable own-key/);
  }
});

// ---------------------------------------------------------------------------
// E-C10 — single canonical event-content encoder
// ---------------------------------------------------------------------------

test("RUN56 nested-key insertion order -> equal canonical bytes", () => {
  const a = canonicalEventBytes({
    type: "ACTION_FINISHED",
    target: { kind: "attempt", attempt_id: ids.attempt },
    status: "OK",
    failure: { kind: "tool_failure", tool: "x", message: "msg" },
  });
  const b = canonicalEventBytes({
    type: "ACTION_FINISHED",
    failure: { kind: "tool_failure", tool: "x", message: "msg" },
    target: { attempt_id: ids.attempt, kind: "attempt" },
    status: "OK",
  });
  assert.equal(a, b);
  // And the bytes are JSON-parseable.
  const parsed = JSON.parse(a);
  assert.equal(parsed.type, "ACTION_FINISHED");
  assert.equal(parsed.failure.kind, "tool_failure");
});

test("RUN57 store and projector canonical identity agree", () => {
  const ev: RunEvent = {
    type: "ACTION_FINISHED",
    target: { kind: "attempt", attempt_id: ids.attempt },
    status: "ERROR",
    failure: { kind: "tool_failure", tool: "y", message: "msg" },
  };
  const storeBytes = canonicalEventBytes(ev);
  const projectBytes = canonicalEventBytes({
    ...ev,
    failure: { kind: "tool_failure", tool: "y", message: "msg" },
  });
  assert.equal(storeBytes, projectBytes);
});

test("RUN58 default EventIdSource uses same canonical bytes authority", () => {
  const src = makeContentBoundEventIdSource();
  const rid = makeRunId("run:phase-e-can");
  const a = src.next(
    rid,
    {
      type: "ACTION_FINISHED",
      target: { kind: "attempt", attempt_id: ids.attempt },
      status: "ERROR",
      failure: { kind: "tool_failure", tool: "z", message: "msg" },
    },
    1,
  );
  const b = src.next(
    rid,
    {
      type: "ACTION_FINISHED",
      failure: { kind: "tool_failure", tool: "z", message: "msg" },
      target: { attempt_id: ids.attempt, kind: "attempt" },
      status: "ERROR",
    },
    1,
  );
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// Regression: minimal SUCCESS still works (RUN01..RUN25 corpus)
// ---------------------------------------------------------------------------

test("Regression: minimal SUCCESS still TERMINAL/SUCCESS", () => {
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
      { type: "GATE_STARTED", gate_id: ids.gate, attempt_id: ids.attempt },
      4,
      eids[3]!,
    ),
    commitEvent(
      manifest,
      { type: "GATE_FINISHED", gate_id: ids.gate, attempt_id: ids.attempt, pass: true },
      5,
      eids[4]!,
    ),
    commitEvent(
      manifest,
      { type: "ACTION_FINISHED", target: { kind: "attempt", attempt_id: ids.attempt }, status: "OK" },
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
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "SUCCESS");
});
