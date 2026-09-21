/**
 * LH-06 semantic-ledger tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Required:
 *   SEMANTIC_DRIFT_COUNT = 0
 *   PREDECESSOR_DEPENDENT_SEMANTICS = IMPOSSIBLE
 *   CASES_WITH_MULTIPLE_SEMANTIC_RESULTS = 0
 *   CANARY_BEFORE == CANARY_AFTER
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SemanticLedger,
  deterministicJson,
  semanticDigest,
  stripVolatile,
} from "../../soak/semantic-ledger.js";

test("LH-06 semantic-ledger: deterministicJson sorts object keys", () => {
  const a = deterministicJson({ b: 1, a: 2 });
  const b = deterministicJson({ a: 2, b: 1 });
  assert.equal(a, b);
});

test("LH-06 semantic-ledger: deterministicJson handles nested arrays", () => {
  const a = deterministicJson({ x: [3, 1, 2] });
  const b = deterministicJson({ x: [3, 1, 2] });
  assert.equal(a, b);
});

test("LH-06 semantic-ledger: semanticDigest is stable for same shape", () => {
  const d1 = semanticDigest({ id: "LC01", terminal: "SUCCESS" });
  const d2 = semanticDigest({ terminal: "SUCCESS", id: "LC01" });
  assert.equal(d1, d2);
});

test("LH-06 semantic-ledger: semanticDigest differs for different shape", () => {
  const d1 = semanticDigest({ id: "LC01" });
  const d2 = semanticDigest({ id: "LC02" });
  assert.notEqual(d1, d2);
});

test("LH-06 semantic-ledger: stripVolatile removes timestamp / path / pid / notes", () => {
  const v = {
    id: "LC01",
    emitted_at: "2030-01-01T00:00:00Z",
    pid: 12345,
    path: "/tmp/foo",
    notes: "ignore me",
    payload: { ok: true, timestamp: 1234567 },
  };
  const stripped = stripVolatile(v);
  assert.equal(
    (stripped as Record<string, unknown>)["emitted_at"],
    undefined,
  );
  assert.equal(
    (stripped as Record<string, unknown>)["pid"],
    undefined,
  );
  assert.equal(
    (stripped as Record<string, unknown>)["path"],
    undefined,
  );
  assert.equal(
    (stripped as Record<string, unknown>)["notes"],
    undefined,
  );
  assert.equal(
    ((stripped as { payload: Record<string, unknown> }).payload)["timestamp"],
    undefined,
  );
  assert.equal(
    (stripped as Record<string, unknown>)["id"],
    "LC01",
  );
});

test("LH-06 semantic-ledger: zero drift when same digest repeats", () => {
  const l = new SemanticLedger();
  for (let i = 0; i < 5; i++) {
    l.recordObservation({
      case_id: "LC01",
      source: "LH05",
      epoch_index: i,
      predecessor: "F01",
      digest: "abcd",
    });
  }
  const v = l.verdict();
  assert.equal(v.semantic_drift_count, 0);
  assert.equal(v.predecessor_dependency_count, 0);
  assert.equal(v.unique_digests_per_case["LC01"], 1);
});

test("LH-06 semantic-ledger: drift is detected", () => {
  const l = new SemanticLedger();
  l.recordObservation({
    case_id: "LC01",
    source: "LH05",
    epoch_index: 0,
    predecessor: null,
    digest: "aaaa",
  });
  l.recordObservation({
    case_id: "LC01",
    source: "LH05",
    epoch_index: 1,
    predecessor: null,
    digest: "bbbb",
  });
  assert.equal(l.semanticDriftCount(), 1);
});

test("LH-06 semantic-ledger: predecessor-dependence is detected", () => {
  const l = new SemanticLedger();
  l.recordObservation({
    case_id: "F01",
    source: "LH04",
    epoch_index: 0,
    predecessor: "LC01",
    digest: "x",
  });
  l.recordObservation({
    case_id: "F01",
    source: "LH04",
    epoch_index: 1,
    predecessor: "LC02",
    digest: "y",
  });
  assert.equal(l.predecessorDependencyCount(), 1);
});

test("LH-06 semantic-ledger: canary before == canary after", () => {
  const l = new SemanticLedger();
  l.recordObservation({
    case_id: "CANARY_LC01",
    source: "CANARY",
    epoch_index: 0,
    predecessor: "EPOCH_START",
    digest: "z",
  });
  l.recordObservation({
    case_id: "CANARY_LC01",
    source: "CANARY",
    epoch_index: 0,
    predecessor: "EPOCH_END",
    digest: "z",
  });
  assert.equal(l.canaryStable(), true);
});

test("LH-06 semantic-ledger: seedExpected must precede first observation", () => {
  const l = new SemanticLedger();
  l.recordObservation({
    case_id: "LC01",
    source: "LH05",
    epoch_index: 0,
    predecessor: null,
    digest: "a",
  });
  assert.throws(() =>
    l.seedExpected({ expected: { LC01: "a" } }),
  );
});

test("LH-06 semantic-ledger: seedExpected is honored on subsequent observations", () => {
  const l = new SemanticLedger();
  l.seedExpected({ expected: { LC01: "expected-a" } });
  l.recordObservation({
    case_id: "LC01",
    source: "LH05",
    epoch_index: 0,
    predecessor: null,
    digest: "expected-a",
  });
  l.recordObservation({
    case_id: "LC01",
    source: "LH05",
    epoch_index: 1,
    predecessor: null,
    digest: "wrong-b",
  });
  assert.equal(l.semanticDriftCount(), 1);
});
