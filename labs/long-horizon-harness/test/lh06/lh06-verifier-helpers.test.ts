/**
 * LH-06 C32 / C33 helpers — unit tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * L06-CORRECTION06:
 *
 *   L06-C32 helper (`checkProfileMinima`)
 *     PASS_DETERMINISTIC_SOAK + under-minimum → REJECT
 *     QUALIFICATION_INCOMPLETE + both minima met → REJECT
 *     QUALIFICATION_INCOMPLETE + one minimum not met → ACCEPT
 *     FAIL_* + under-minimum → ACCEPT (truthful negative
 *       evidence preserved)
 *
 *   L06-C33 helper (`checkPublicationDurability`)
 *     PASS + missing publication_durability → REJECT
 *     PASS + ATOMIC_ONLY → REJECT
 *     PASS + CRASH_DURABLE → ACCEPT
 *     non-PASS + ATOMIC_ONLY → ACCEPT (negative
 *       evidence records may be ATOMIC_ONLY)
 *     non-PASS + CRASH_DURABLE → ACCEPT
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkProfileMinima,
  checkPublicationDurability,
} from "../../soak/verifier-helpers.js";

test("L06-C32 helper: PASS_DETERMINISTIC_SOAK under-duration QUALIFICATION → INSUFFICIENT_DURATION", () => {
  const r = checkProfileMinima({
    profile: "QUALIFICATION",
    verdict: "PASS_DETERMINISTIC_SOAK",
    duration_ms: 30 * 60 * 1000,
    epochs_completed: 500,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "INSUFFICIENT_DURATION");
});

test("L06-C32 helper: PASS_DETERMINISTIC_SOAK under-epochs QUALIFICATION → INSUFFICIENT_EPOCHS", () => {
  const r = checkProfileMinima({
    profile: "QUALIFICATION",
    verdict: "PASS_DETERMINISTIC_SOAK",
    duration_ms: 60 * 60 * 1000,
    epochs_completed: 400,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "INSUFFICIENT_EPOCHS");
});

test("L06-C32 helper: PASS_DETERMINISTIC_SOAK full contract QUALIFICATION → ACCEPT", () => {
  const r = checkProfileMinima({
    profile: "QUALIFICATION",
    verdict: "PASS_DETERMINISTIC_SOAK",
    duration_ms: 60 * 60 * 1000,
    epochs_completed: 500,
  });
  assert.equal(r.ok, true);
});

test("L06-C32 helper: QUALIFICATION_INCOMPLETE one minimum not met → ACCEPT", () => {
  const r = checkProfileMinima({
    profile: "CI_SMOKE",
    verdict: "QUALIFICATION_INCOMPLETE",
    duration_ms: 1000,
    epochs_completed: 9,
  });
  assert.equal(r.ok, true);
});

test("L06-C32 helper: QUALIFICATION_INCOMPLETE both minima satisfied → INCONSISTENT_VERDICT", () => {
  const r = checkProfileMinima({
    profile: "CI_SMOKE",
    verdict: "QUALIFICATION_INCOMPLETE",
    duration_ms: 60 * 1000,
    epochs_completed: 10,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "INCONSISTENT_VERDICT");
});

test("L06-C32 helper: FAIL_RESOURCE_STABILITY under-minimum → ACCEPT (truthful negative evidence)", () => {
  const r = checkProfileMinima({
    profile: "QUALIFICATION",
    verdict: "FAIL_RESOURCE_STABILITY",
    duration_ms: 17 * 60 * 1000,
    epochs_completed: 137,
  });
  assert.equal(r.ok, true);
});

test("L06-C32 helper: unknown profile → MISSING_REQUIRED_FIELD", () => {
  const r = checkProfileMinima({
    profile: "PROD",
    verdict: "PASS_DETERMINISTIC_SOAK",
    duration_ms: 60 * 60 * 1000,
    epochs_completed: 500,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "MISSING_REQUIRED_FIELD");
});

test("L06-C33 helper: PASS_DETERMINISTIC_SOAK missing publication_durability → MISSING_REQUIRED_FIELD", () => {
  const r = checkPublicationDurability({
    verdict: "PASS_DETERMINISTIC_SOAK",
    publication_durability: null,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "MISSING_REQUIRED_FIELD");
});

test("L06-C33 helper: PASS_DETERMINISTIC_SOAK ATOMIC_ONLY → INCONSISTENT_VERDICT", () => {
  const r = checkPublicationDurability({
    verdict: "PASS_DETERMINISTIC_SOAK",
    publication_durability: "ATOMIC_ONLY",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "INCONSISTENT_VERDICT");
});

test("L06-C33 helper: PASS_DETERMINISTIC_SOAK CRASH_DURABLE → ACCEPT (closure shape)", () => {
  const r = checkPublicationDurability({
    verdict: "PASS_DETERMINISTIC_SOAK",
    publication_durability: "CRASH_DURABLE",
  });
  assert.equal(r.ok, true);
});

test("L06-C33 helper: non-PASS ATOMIC_ONLY → ACCEPT (negative evidence)", () => {
  const r = checkPublicationDurability({
    verdict: "FAIL_RESOURCE_STABILITY",
    publication_durability: "ATOMIC_ONLY",
  });
  assert.equal(r.ok, true);
});

test("L06-C33 helper: non-PASS CRASH_DURABLE → ACCEPT", () => {
  const r = checkPublicationDurability({
    verdict: "QUALIFICATION_INCOMPLETE",
    publication_durability: "CRASH_DURABLE",
  });
  assert.equal(r.ok, true);
});

test("L06-C33 helper: garbage publication_durability → MISSING_REQUIRED_FIELD", () => {
  const r = checkPublicationDurability({
    verdict: "PASS_DETERMINISTIC_SOAK",
    publication_durability: "MAXIMUM_DURABLE",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "MISSING_REQUIRED_FIELD");
});

/**
 * L06-CORRECTION07 L06-C34: exhaustive verdict
 * derivation. The verifier derives the expected
 * verdict from `failure.kind` and refuses any
 * worker-claimed verdict that disagrees. These tests
 * cover the canonical mapping table plus a battery
 * of cross-category forgeries.
 *
 * The mapping lives in `verdictForFailure`
 * (re-exported from `result-io.ts`); these tests
 * pin its semantics:
 *
 *   SEMANTIC_DRIFT / FAULT_ESCAPE / LIFECYCLE_DRIFT
 *     -> FAIL_SEMANTIC_DRIFT
 *
 *   MEMORY_GROWTH / RESOURCE_LEAK / WORKSPACE_LEAK
 *     -> FAIL_RESOURCE_STABILITY
 *
 *   LATENCY_DRIFT
 *     -> FAIL_LATENCY_STABILITY
 *
 *   FROZEN_MUTATION
 *     -> FAIL_FROZEN_INTEGRITY
 *
 *   WORKER_CRASH / WORKER_HANG /
 *   BASELINE_REGRESSION / INVALID_TELEMETRY
 *     -> FAIL_WORKER
 *
 *   QUALIFICATION_INCOMPLETE
 *     -> QUALIFICATION_INCOMPLETE
 *
 *   INCONCLUSIVE_ENVIRONMENT
 *     -> INCONCLUSIVE_ENVIRONMENT
 */

import {
  expectedVerdictFor,
  checkVerdictMatchesFailure,
} from "../../soak/verifier-helpers.js";

const C34_MATRIX: ReadonlyArray<{
  readonly kind:
    | "SEMANTIC_DRIFT"
    | "FAULT_ESCAPE"
    | "LIFECYCLE_DRIFT"
    | "MEMORY_GROWTH"
    | "RESOURCE_LEAK"
    | "WORKSPACE_LEAK"
    | "LATENCY_DRIFT"
    | "FROZEN_MUTATION"
    | "WORKER_CRASH"
    | "WORKER_HANG"
    | "BASELINE_REGRESSION"
    | "INVALID_TELEMETRY"
    | "QUALIFICATION_INCOMPLETE"
    | "INCONCLUSIVE_ENVIRONMENT";
  readonly expected:
    | "FAIL_SEMANTIC_DRIFT"
    | "FAIL_RESOURCE_STABILITY"
    | "FAIL_LATENCY_STABILITY"
    | "FAIL_FROZEN_INTEGRITY"
    | "FAIL_WORKER"
    | "QUALIFICATION_INCOMPLETE"
    | "INCONCLUSIVE_ENVIRONMENT";
}> = [
  { kind: "SEMANTIC_DRIFT", expected: "FAIL_SEMANTIC_DRIFT" },
  { kind: "FAULT_ESCAPE", expected: "FAIL_SEMANTIC_DRIFT" },
  { kind: "LIFECYCLE_DRIFT", expected: "FAIL_SEMANTIC_DRIFT" },
  { kind: "MEMORY_GROWTH", expected: "FAIL_RESOURCE_STABILITY" },
  { kind: "RESOURCE_LEAK", expected: "FAIL_RESOURCE_STABILITY" },
  { kind: "WORKSPACE_LEAK", expected: "FAIL_RESOURCE_STABILITY" },
  { kind: "LATENCY_DRIFT", expected: "FAIL_LATENCY_STABILITY" },
  { kind: "FROZEN_MUTATION", expected: "FAIL_FROZEN_INTEGRITY" },
  { kind: "WORKER_CRASH", expected: "FAIL_WORKER" },
  { kind: "WORKER_HANG", expected: "FAIL_WORKER" },
  { kind: "BASELINE_REGRESSION", expected: "FAIL_WORKER" },
  { kind: "INVALID_TELEMETRY", expected: "FAIL_WORKER" },
  { kind: "QUALIFICATION_INCOMPLETE", expected: "QUALIFICATION_INCOMPLETE" },
  { kind: "INCONCLUSIVE_ENVIRONMENT", expected: "INCONCLUSIVE_ENVIRONMENT" },
];

for (const row of C34_MATRIX) {
  test(`L06-C34: expectedVerdictFor(${row.kind}) -> ${row.expected}`, () => {
    assert.equal(expectedVerdictFor(row.kind), row.expected);
  });
}

const C34_SWAPS: ReadonlyArray<{
  readonly kind: Parameters<typeof checkVerdictMatchesFailure>[0]["failure"]["kind"];
  readonly wrongVerdict:
    | "FAIL_SEMANTIC_DRIFT"
    | "FAIL_RESOURCE_STABILITY"
    | "FAIL_LATENCY_STABILITY"
    | "FAIL_FROZEN_INTEGRITY"
    | "FAIL_WORKER"
    | "QUALIFICATION_INCOMPLETE"
    | "INCONCLUSIVE_ENVIRONMENT";
}> = [
  // MEMORY_GROWTH must NOT pretend to be a frozen-integrity failure
  { kind: "MEMORY_GROWTH", wrongVerdict: "FAIL_FROZEN_INTEGRITY" },
  { kind: "MEMORY_GROWTH", wrongVerdict: "FAIL_SEMANTIC_DRIFT" },
  // FROZEN_MUTATION must NOT pretend to be a resource failure
  { kind: "FROZEN_MUTATION", wrongVerdict: "FAIL_RESOURCE_STABILITY" },
  // LATENCY_DRIFT must NOT pretend to be a semantic failure
  { kind: "LATENCY_DRIFT", wrongVerdict: "FAIL_SEMANTIC_DRIFT" },
  // WORKER_CRASH must NOT pretend to be a resource failure
  { kind: "WORKER_CRASH", wrongVerdict: "FAIL_RESOURCE_STABILITY" },
  // SEMANTIC_DRIFT must NOT pretend to be a frozen-integrity failure
  { kind: "SEMANTIC_DRIFT", wrongVerdict: "FAIL_FROZEN_INTEGRITY" },
];

for (const row of C34_SWAPS) {
  test(`L06-C34: ${row.kind} failure with ${row.wrongVerdict} verdict is REJECTED (INCONSISTENT_VERDICT)`, () => {
    const r = checkVerdictMatchesFailure({
      verdict: row.wrongVerdict,
      failure: {
        kind: row.kind,
        epoch: 0,
        last_completed_case: "x",
        minimal_diff: {},
        message: "forged",
      },
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "INCONSISTENT_VERDICT");
  });
}

test("L06-C34: matching verdict is ACCEPTED", () => {
  const r = checkVerdictMatchesFailure({
    verdict: "FAIL_RESOURCE_STABILITY",
    failure: {
      kind: "MEMORY_GROWTH",
      epoch: 137,
      last_completed_case: "x",
      minimal_diff: {},
      message: "heap growth observed",
    },
  });
  assert.equal(r.ok, true);
});
