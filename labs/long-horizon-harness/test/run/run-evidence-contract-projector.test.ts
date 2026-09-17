/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Adversarial corpus cases RUN01–RUN15 + RUN21, RUN22, RUN25.
 * The projector and the append-only store are exercised here.
 * Decoder / boundary cases (RUN16–RUN20, RUN23, RUN24) live in
 * run-evidence-contract-decode.test.ts.
 *
 * Contract matrix references map onto E-M01..E-M15:
 *
 *   RUN01  minimal success run → TERMINAL/SUCCESS (E-M01)
 *   RUN02  agent_says_done with no closure → ACTIVE (E-M02)
 *   RUN03  truncated stream (no terminal) → ACTIVE (E-M03)
 *   RUN04  duplicate sequence → illegal_sequence (E-M04)
 *   RUN05  sequence gap → illegal_sequence (E-M04)
 *   RUN06  reordered events → illegal_sequence (E-M04)
 *   RUN07  wrong run_id binding → identity_mismatch (E-M05)
 *   RUN08  wrong subject_id binding → identity_mismatch (E-M05)
 *   RUN09  duplicate terminal → conflicting_terminal (E-M06)
 *   RUN10  conflicting terminal semantic → conflicting_terminal (E-M06)
 *   RUN11  ACTION_FINISHED without open attempt (E-M07)
 *   RUN12  GATE_STARTED without open attempt (E-M08)
 *   RUN13  REPAIR_FINISHED without open repair (E-M09)
 *   RUN14  REVIEW_FINISHED without open review (E-M10)
 *   RUN15  semantic event after terminal (E-M11)
 *   RUN21  replay parity (E-M12)
 *   RUN22  caller mutation → evidence unchanged (E-M13)
 *   RUN25  store round-trip → projector parity (E-M14)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  InMemoryRunStore,
  makeInMemoryRunStore,
} from "../../src/run/run-store.js";
import {
  projectEmptyRun,
  projectRun,
} from "../../src/run/run-projector.js";
import type { ProjectionResult } from "../../src/run/run-types.js";
import type {
  CommittedRunEvent,
  RunEvent,
  RunEventId,
  RunId,
} from "../../src/run/run-types.js";
import {
  RUN_EVENT_SCHEMA_VERSION,
  makeRunEventId,
} from "../../src/run/run-types.js";

import {
  commitEvent,
  ids,
  makeTestManifest,
  minimalSuccessRun,
  seqEventIds,
} from "./run-evidence-contract-helpers.js";

function commitOne(
  runId: RunId,
  subjectId: ReturnType<typeof makeTestManifest>["subject_id"],
  sequence: number,
  event: RunEvent,
  eventId?: RunEventId,
): CommittedRunEvent {
  return {
    schema_version: RUN_EVENT_SCHEMA_VERSION,
    event_id:
      eventId ?? makeRunEventId(`evt:${runId}:${sequence}`),
    run_id: runId,
    subject_id: subjectId,
    sequence,
    event,
    observed_at: sequence * 1000,
  };
}

// RUN01 — minimal success run (with E-C02 authoritative-success
// predicate satisfied: includes ACTION_FINISHED and
// GATE_FINISHED(pass=true)).
test("RUN01 minimal success run → TERMINAL/SUCCESS", () => {
  const { manifest, events } = minimalSuccessRun();
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "TERMINAL");
  assert.equal(r.value.terminal_outcome, "SUCCESS");
  assert.equal(r.value.event_count, 8);
  assert.equal(r.value.last_sequence, 8);
  assert.equal(r.value.repair_count, 0);
  assert.equal(r.value.review_count, 0);
});

// RUN02 — agent self-report without closure is NOT a terminal claim.
// Per E7, agent_report is OBSERVATION only. Without an explicit terminal
// event the run stays ACTIVE.
test("RUN02 action finished OK without terminal → ACTIVE (not SUCCESS)", () => {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(manifest, { type: "HARNESS_STARTED" }, 2, eids[1]!),
    commitEvent(
      manifest,
      {
        type: "ACTION_STARTED",
        target: { kind: "attempt", attempt_id: ids.attempt },
      },
      3,
      eids[2]!,
    ),
    commitEvent(
      manifest,
      {
        type: "ACTION_FINISHED",
        target: { kind: "attempt", attempt_id: ids.attempt },
        status: "OK",
      },
      4,
      eids[3]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "ACTIVE");
  assert.equal(r.value.terminal_outcome, null);
});

// RUN03 — truncated stream with no terminal observed.
test("RUN03 truncated stream with no terminal → ACTIVE", () => {
  const { manifest, events } = minimalSuccessRun();
  const truncated = events.slice(0, events.length - 1);
  const r = projectRun(manifest, truncated);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.lifecycle_state, "ACTIVE");
  assert.equal(r.value.terminal_outcome, null);
  assert.equal(r.value.event_count, truncated.length);
});

test("RUN03b empty stream → INCOMPLETE", () => {
  const manifest = makeTestManifest();
  const empty = projectEmptyRun(manifest);
  assert.equal(empty.lifecycle_state, "INCOMPLETE");
  assert.equal(empty.terminal_outcome, null);
  assert.equal(empty.event_count, 0);
  assert.equal(empty.last_sequence, 0);
});

// RUN04 — duplicate sequence.
test("RUN04 duplicate sequence → illegal_event", () => {
  const { manifest, events } = minimalSuccessRun();
  const dup = [...events, events[events.length - 1]!];
  const r = projectRun(manifest, dup);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "illegal_event");
});

// RUN05 — sequence gap.
test("RUN05 sequence gap → illegal_event", () => {
  const { manifest, events } = minimalSuccessRun();
  const last = events[events.length - 1]!;
  // Drop the second-to-last event AND renumber the last so
  // a real gap appears between seq 6 and seq 8 (events are
  // 8 entries in minimalSuccessRun; we emit them through seq 6
  // and then jump to seq 8).
  const head = events.slice(0, events.length - 2);
  const gapped = [...head, { ...last, sequence: last.sequence + 1 }];
  // Now head ends at seq 6 (events.length - 2 == 6) and last is
  // at seq 9, skipping 7 and 8. The projector must reject this.
  const r = projectRun(manifest, gapped);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "illegal_event");
});

// RUN06 — reordered events.
test("RUN06 reordered events → illegal_event", () => {
  const { manifest, events } = minimalSuccessRun();
  const swapped = [...events];
  const idx0 = 2;
  const idx1 = 3;
  const a = swapped[idx0]!;
  swapped[idx0] = swapped[idx1]!;
  swapped[idx1] = a;
  const r = projectRun(manifest, swapped);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "illegal_event");
});

// RUN07 — wrong run_id binding.
test("RUN07 event run_id does not match manifest → identity_mismatch", () => {
  const { manifest, events } = minimalSuccessRun();
  const last = events[events.length - 1]!;
  const bogus: CommittedRunEvent = {
    ...last,
    event_id: makeRunEventId(`evt:wrong:6`),
    run_id: "run:0000000000000000000000000000000000000000000000000000000000000000" as RunId,
  };
  const r = projectRun(manifest, [...events.slice(0, -1), bogus]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "identity_mismatch");
  if (r.failure.kind === "identity_mismatch") {
    assert.equal(r.failure.field, "run_id");
  }
});

// RUN08 — wrong subject_id binding.
test("RUN08 event subject_id does not match manifest → identity_mismatch", () => {
  const { manifest, events } = minimalSuccessRun();
  const last = events[events.length - 1]!;
  const bogus: CommittedRunEvent = {
    ...last,
    event_id: makeRunEventId(`evt:wrong-subj:6`),
    subject_id: "subj:other" as typeof last.subject_id,
  };
  const r = projectRun(manifest, [...events.slice(0, -1), bogus]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "identity_mismatch");
  if (r.failure.kind === "identity_mismatch") {
    assert.equal(r.failure.field, "subject_id");
  }
});

// RUN09 — duplicate terminal claim.
test("RUN09 duplicate terminal → illegal_event", () => {
  const { manifest, events } = minimalSuccessRun();
  const last = events[events.length - 1]!;
  const second = commitOne(
    manifest.run_id,
    manifest.subject_id,
    last.sequence + 1,
    { type: "RUN_FINISHED", semantic: "SUCCESS" },
    makeRunEventId(`evt:dup-terminal:7`),
  );
  const r = projectRun(manifest, [...events, second]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "illegal_event");
});

// RUN10 — conflicting terminal semantic.
test("RUN10 conflicting terminal semantic → illegal_event", () => {
  const { manifest, events } = minimalSuccessRun();
  const last = events[events.length - 1]!;
  const conflicting = commitOne(
    manifest.run_id,
    manifest.subject_id,
    last.sequence + 1,
    { type: "RUN_FINISHED", semantic: "HARNESS_FAILURE" },
    makeRunEventId(`evt:conflict-terminal:7`),
  );
  const r = projectRun(manifest, [...events, conflicting]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "illegal_event");
});

// RUN11 — ACTION_FINISHED without open attempt.
test("RUN11 ACTION_FINISHED without open attempt → illegal_event", () => {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(
      manifest,
      {
        type: "ACTION_FINISHED",
        target: { kind: "attempt", attempt_id: ids.attempt },
        status: "OK",
      },
      2,
      eids[1]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "illegal_event");
});

// RUN12 — GATE_STARTED without open attempt.
test("RUN12 GATE_STARTED without open attempt → illegal_event", () => {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(
      manifest,
      {
        type: "GATE_STARTED",
        gate_id: ids.gate,
        attempt_id: ids.attempt,
      },
      2,
      eids[1]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "illegal_event");
});

// RUN13 — REPAIR_FINISHED without open repair.
test("RUN13 REPAIR_FINISHED without open repair → illegal_event", () => {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(
      manifest,
      { type: "REPAIR_FINISHED", repair_id: ids.repair },
      2,
      eids[1]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "illegal_event");
});

// RUN14 — REVIEW_FINISHED without open review.
test("RUN14 REVIEW_FINISHED without open review → illegal_event", () => {
  const manifest = makeTestManifest();
  const eids = seqEventIds(manifest.run_id);
  const events: CommittedRunEvent[] = [
    commitEvent(manifest, { type: "RUN_STARTED" }, 1, eids[0]!),
    commitEvent(
      manifest,
      {
        type: "REVIEW_FINISHED",
        review_id: ids.review,
        pass: true,
      },
      2,
      eids[1]!,
    ),
  ];
  const r = projectRun(manifest, events);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "illegal_event");
});

// RUN15 — semantic event after terminal.
test("RUN15 semantic event after terminal → illegal_event", () => {
  const { manifest, events } = minimalSuccessRun();
  const last = events[events.length - 1]!;
  const late = commitOne(
    manifest.run_id,
    manifest.subject_id,
    last.sequence + 1,
    { type: "HARNESS_STOPPED" },
    makeRunEventId(`evt:late-harness-stop:9`),
  );
  const r = projectRun(manifest, [...events, late]);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "illegal_event");
  if (r.failure.kind === "illegal_event") {
    assert.match(
      r.failure.reason,
      /after terminal/,
      "rejection reason must mention 'after terminal'",
    );
  }
});

// RUN21 — replay parity.
test("RUN21 replay parity — same stream → identical projection", () => {
  const { manifest, events } = minimalSuccessRun();
  const a = projectRun(manifest, events);
  const b = projectRun(manifest, events);
  assert.deepEqual(a, b);
});

// RUN22 — caller mutation of input array does not throw, and the
// projector is total on whatever data it receives.
test("RUN22 caller mutates input array → projector remains total", () => {
  const { manifest, events } = minimalSuccessRun();
  const r1: ProjectionResult = projectRun(manifest, events);
  assert.equal(r1.ok, true);
  // Mutate the input; the projector must remain total.
  (events as CommittedRunEvent[]).length = 0;
  const r2 = projectRun(manifest, events);
  assert.equal(r2.ok, true);
  // r2 should reflect the empty stream.
  if (r2.ok) {
    assert.equal(r2.value.lifecycle_state, "INCOMPLETE");
    assert.equal(r2.value.event_count, 0);
  }
});

// RUN25 — InMemoryRunStore round-trip + projector parity.
//   Includes ACTION_FINISHED + GATE_FINISHED(pass=true) so the
//   E-C02 authoritative-success predicate is satisfied.
//   GATE_STARTED runs INSIDE the open attempt (BEFORE the
//   closing ACTION_FINISHED).
test("RUN25 InMemoryRunStore round-trip → projector parity", () => {
  const manifest = makeTestManifest();
  const clock = { nowMs: () => 12345 };
  const store: InMemoryRunStore = makeInMemoryRunStore(clock);
  store.init(manifest);
  assert.equal(store.append(manifest, { type: "RUN_STARTED" }).ok, true);
  assert.equal(store.append(manifest, { type: "HARNESS_STARTED" }).ok, true);
  assert.equal(
    store.append(manifest, {
      type: "ACTION_STARTED",
      target: { kind: "attempt", attempt_id: ids.attempt },
    }).ok,
    true,
  );
  assert.equal(
    store.append(manifest, {
      type: "GATE_STARTED",
      gate_id: ids.gate,
      attempt_id: ids.attempt,
    }).ok,
    true,
  );
  assert.equal(
    store.append(manifest, {
      type: "GATE_FINISHED",
      gate_id: ids.gate,
      attempt_id: ids.attempt,
      pass: true,
    }).ok,
    true,
  );
  assert.equal(
    store.append(manifest, {
      type: "ACTION_FINISHED",
      target: { kind: "attempt", attempt_id: ids.attempt },
      status: "OK",
    }).ok,
    true,
  );
  assert.equal(store.append(manifest, { type: "HARNESS_STOPPED" }).ok, true);
  assert.equal(
    store.append(manifest, {
      type: "RUN_FINISHED",
      semantic: "SUCCESS",
    }).ok,
    true,
  );

  const events = store.readRun(manifest.run_id);
  assert.equal(events.length, 8);
  const proj = store.project(manifest);
  assert.equal(proj.ok, true);
  if (proj.ok) {
    assert.equal(proj.value.lifecycle_state, "TERMINAL");
    assert.equal(proj.value.terminal_outcome, "SUCCESS");
  }
});
