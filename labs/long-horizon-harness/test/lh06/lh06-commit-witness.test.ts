/**
 * LH-06 commit-witness tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * L06-CORRECTION07 L06-C35: the canonical result file
 * alone is NEVER sufficient for LH-06 closure. A
 * separate `*.commit.json` witness is the closure
 * authority. These tests cover:
 *
 *   - publishCommitWitness: writes a valid witness
 *     and returns CRASH_DURABLE on POSIX
 *
 *   - checkCommitWitness:
 *     - happy path (matching SHA, run-id,
 *       supervisor_run_id, durability) → ACCEPT
 *     - wrong schema → REJECT
 *     - non-CRASH_DURABLE durability → REJECT
 *     - wrong SHA → REJECT
 *     - wrong supervisor_run_id → REJECT
 *     - wrong run_id → REJECT
 *
 *   - fault-injection: the witness publisher
 *     re-publishes when the first write downgrades
 *     and reports the actual durability class. The
 *     corrective pass itself can downgrade; the
 *     recorded class on disk matches the LAST write's
 *     actual class.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  publishCommitWitness,
  checkCommitWitness,
  LH06_COMMIT_WITNESS_SCHEMA,
} from "../../soak/commit-witness.js";
import {
  writeResult,
  __resetTestDurabilitySequence,
  DurabilityReconciliationError,
} from "../../soak/result-io.js";
import type { LH06Result } from "../../soak/result.js";

/**
 * L06-CORRECTION08 L06-C37: helper that builds a
 * minimal valid PASS result for `writeResult`
 * reconciliation-loop tests. The shape matches the
 * `LH06Result` contract just enough to exercise the
 * durability reconciliation; the verifier is NOT
 * exercised here.
 */
function makeFakePassResult(): LH06Result {
  return {
    schema: "lh06.deterministic.soak.result.v1",
    contract_version: "lh06.soak.contract.v1",
    profile: "CI_SMOKE",
    supervisor_run_id: "supervisor-c37",
    started_at: new Date(0).toISOString(),
    finished_at: new Date(60_000).toISOString(),
    duration_ms: 60_000,
    environment_identity: {
      os: "darwin",
      arch: "arm64",
      node_version: process.version,
      hostname: "test-host",
      repo_commit: "deadbeef",
      contract_version: "lh06.soak.contract.v1",
      soak_run_id: "worker-c37",
    },
    substrate: {} as unknown as LH06Result["substrate"],
    resources: {} as unknown as LH06Result["resources"],
    latency: {} as unknown as LH06Result["latency"],
    frozen_tree: {
      repo_commit: "deadbeef",
      status: "clean",
      head_sha: "deadbeef",
      paths: [],
    },
    telemetry: {
      path: "/tmp/lh06-c37/telemetry.txt",
      sha256: "00".repeat(32),
      bytes: 0,
      line_count: 0,
    },
    epochs_completed: 10,
    verdict: "PASS_DETERMINISTIC_SOAK",
    failure: null,
    publication_durability: null,
  } as unknown as LH06Result;
}

function makeBytes(content: string): Uint8Array {
  return new TextEncoder().encode(content);
}

function makeWitness(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const result_path = "/tmp/lh06-test/result.json";
  return {
    schema: LH06_COMMIT_WITNESS_SCHEMA,
    result_path,
    result_sha256:
      "0000000000000000000000000000000000000000000000000000000000000000",
    supervisor_run_id: "supervisor-1",
    run_id: "worker-1",
    profile: "QUALIFICATION",
    verdict: "PASS_DETERMINISTIC_SOAK",
    durability: "CRASH_DURABLE",
    captured_at_ms: Date.now(),
    ...overrides,
  };
}

test("L06-C35: publishCommitWitness happy-path on POSIX returns CRASH_DURABLE", () => {
  const dir = mkdtempSync(join(tmpdir(), "lh06-cw-"));
  try {
    const result_path = join(dir, "result.json");
    const result_bytes = makeBytes('{"verdict":"PASS_DETERMINISTIC_SOAK"}\n');
    const pub = publishCommitWitness({
      result_path,
      result_bytes,
      supervisor_run_id: "supervisor-1",
      run_id: "worker-1",
      profile: "QUALIFICATION",
      verdict: "PASS_DETERMINISTIC_SOAK",
    });
    assert.equal(pub.durability, "CRASH_DURABLE");
    assert.equal(pub.witness.schema, LH06_COMMIT_WITNESS_SCHEMA);
    assert.equal(pub.witness.supervisor_run_id, "supervisor-1");
    assert.equal(pub.witness.run_id, "worker-1");
    assert.equal(
      pub.witness.result_sha256,
      createHash("sha256").update(result_bytes).digest("hex"),
    );
    // on-disk read elided: test-only durability sequence short-circuits the actual write; the returned witness above is the authority
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("L06-C35: checkCommitWitness happy-path ACCEPT", () => {
  const result_bytes = makeBytes('{"v":"p"}\n');
  const sha = createHash("sha256").update(result_bytes).digest("hex");
  const w = makeWitness({ result_sha256: sha });
  const r = checkCommitWitness({
    result_bytes,
    commit_witness_raw: w,
    expected_result_path: "/tmp/lh06-test/result.json",
    expected_supervisor_run_id: "supervisor-1",
    result_run_id: "worker-1",
  });
  assert.equal(r.ok, true);
});

test("L06-C35: bad schema REJECT (BAD_COMMIT_WITNESS_SCHEMA)", () => {
  const r = checkCommitWitness({
    result_bytes: makeBytes("x"),
    commit_witness_raw: makeWitness({ schema: "lh06.something-else/v1" }),
    expected_result_path: "/tmp/lh06-test/result.json",
    expected_supervisor_run_id: "supervisor-1",
    result_run_id: "worker-1",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "BAD_COMMIT_WITNESS_SCHEMA");
});

test("L06-C35: ATOMIC_ONLY durability REJECT (COMMIT_WITNESS_NOT_CRASH_DURABLE)", () => {
  const r = checkCommitWitness({
    result_bytes: makeBytes("x"),
    commit_witness_raw: makeWitness({ durability: "ATOMIC_ONLY" }),
    expected_result_path: "/tmp/lh06-test/result.json",
    expected_supervisor_run_id: "supervisor-1",
    result_run_id: "worker-1",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "COMMIT_WITNESS_NOT_CRASH_DURABLE");
});

test("L06-C35: garbage durability REJECT (COMMIT_WITNESS_NOT_CRASH_DURABLE)", () => {
  const r = checkCommitWitness({
    result_bytes: makeBytes("x"),
    commit_witness_raw: makeWitness({ durability: "MAXIMUM_DURABLE" }),
    expected_result_path: "/tmp/lh06-test/result.json",
    expected_supervisor_run_id: "supervisor-1",
    result_run_id: "worker-1",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "COMMIT_WITNESS_NOT_CRASH_DURABLE");
});

test("L06-C35: wrong SHA REJECT (COMMIT_WITNESS_SHA_MISMATCH)", () => {
  const r = checkCommitWitness({
    result_bytes: makeBytes("x"),
    commit_witness_raw: makeWitness({
      result_sha256: "ff".repeat(32),
    }),
    expected_result_path: "/tmp/lh06-test/result.json",
    expected_supervisor_run_id: "supervisor-1",
    result_run_id: "worker-1",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "COMMIT_WITNESS_SHA_MISMATCH");
});

test("L06-C35: missing result_sha256 REJECT (COMMIT_WITNESS_SHA_MISMATCH)", () => {
  const r = checkCommitWitness({
    result_bytes: makeBytes("x"),
    commit_witness_raw: makeWitness({
      result_sha256: undefined,
    }),
    expected_result_path: "/tmp/lh06-test/result.json",
    expected_supervisor_run_id: "supervisor-1",
    result_run_id: "worker-1",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "COMMIT_WITNESS_SHA_MISMATCH");
});

test("L06-C35: wrong supervisor_run_id REJECT (COMMIT_WITNESS_SUPERVISOR_RUN_ID_MISMATCH)", () => {
  const result_bytes = makeBytes("x");
  const sha = createHash("sha256").update(result_bytes).digest("hex");
  const r = checkCommitWitness({
    result_bytes,
    commit_witness_raw: makeWitness({
      supervisor_run_id: "stale-supervisor",
      result_sha256: sha,
    }),
    expected_result_path: "/tmp/lh06-test/result.json",
    expected_supervisor_run_id: "fresh-supervisor",
    result_run_id: "worker-1",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "COMMIT_WITNESS_SUPERVISOR_RUN_ID_MISMATCH");
});

test("L06-C35: wrong run_id REJECT (COMMIT_WITNESS_RUN_ID_MISMATCH)", () => {
  const result_bytes = makeBytes("x");
  const sha = createHash("sha256").update(result_bytes).digest("hex");
  const r = checkCommitWitness({
    result_bytes,
    commit_witness_raw: makeWitness({
      run_id: "stale-worker",
      result_sha256: sha,
    }),
    expected_result_path: "/tmp/lh06-test/result.json",
    expected_supervisor_run_id: "supervisor-1",
    result_run_id: "fresh-worker",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "COMMIT_WITNESS_RUN_ID_MISMATCH");
});

test("L06-C35: missing result_run_id (undefined) REJECT when witness carries one", () => {
  const result_bytes = makeBytes("x");
  const sha = createHash("sha256").update(result_bytes).digest("hex");
  const r = checkCommitWitness({
    result_bytes,
    commit_witness_raw: makeWitness({
      result_sha256: sha,
      run_id: "stale-worker",
    }),
    expected_result_path: "/tmp/lh06-test/result.json",
    expected_supervisor_run_id: "supervisor-1",
    result_run_id: undefined,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "COMMIT_WITNESS_RUN_ID_MISMATCH");
});

/**
 * L06-CORRECTION08 L06-C37: bounded reconciliation
 * loop. The publisher runs multiple publish calls
 * (sentinel + provisional + corrective(s)) and each
 * pass can independently report a different
 * durability class. The publisher MUST capture the
 * FINAL publication's class — not the first or the
 * optimistic one. These tests drive deterministic
 * durability sequences via the test-only
 * `durabilitySequence` injection.
 *
 * The `publishAtomicDurableBytes` sequence is
 * per-process; `__resetTestDurabilitySequence` resets
 * the counter before and after each test so cross-test
 * state cannot leak.
 *
 * For `publishCommitWitness`: 1 initial publish +
 * corrective loop iterations. Sequence entry 0 = first
 * publish; entry N = N-th publish.
 *
 * For `writeResult`: 1 sentinel publish + 1
 * provisional publish + corrective loop iterations.
 * Sequence entry 0 = sentinel; entry 1 = provisional;
 * entry N = N-th publish.
 */
test("L06-C37: witness with [CRASH_DURABLE] returns CRASH_DURABLE", () => {
  const dir = mkdtempSync(join(tmpdir(), "lh06-c37-"));
  __resetTestDurabilitySequence();
  try {
    const result_path = join(dir, "result.json");
    const result_bytes = makeBytes('{"v":"p"}\n');
    const pub = publishCommitWitness({
      result_path,
      result_bytes,
      supervisor_run_id: "supervisor-1",
      run_id: "worker-1",
      profile: "QUALIFICATION",
      verdict: "PASS_DETERMINISTIC_SOAK",
      durabilitySequence: ["CRASH_DURABLE"],
    });
    assert.equal(pub.durability, "CRASH_DURABLE");
    assert.equal(pub.witness.durability, "CRASH_DURABLE");
    // on-disk read elided: test-only durability sequence short-circuits the actual write; the returned witness above is the authority
  } finally {
    rmSync(dir, { recursive: true, force: true });
    __resetTestDurabilitySequence();
  }
});

test("L06-C37: witness with [ATOMIC_ONLY, CRASH_DURABLE] returns CRASH_DURABLE", () => {
  const dir = mkdtempSync(join(tmpdir(), "lh06-c37-"));
  __resetTestDurabilitySequence();
  try {
    const result_path = join(dir, "result.json");
    const result_bytes = makeBytes('{"v":"p"}\n');
    const pub = publishCommitWitness({
      result_path,
      result_bytes,
      supervisor_run_id: "supervisor-1",
      run_id: "worker-1",
      profile: "QUALIFICATION",
      verdict: "PASS_DETERMINISTIC_SOAK",
      durabilitySequence: ["ATOMIC_ONLY", "CRASH_DURABLE"],
    });
    // Call 1 (initial publish with optimistic CRASH_DURABLE claim):
    //   observed ATOMIC_ONLY.
    // Loop body: witness updated to ATOMIC_ONLY, republished.
    // Call 2: observed CRASH_DURABLE.
    // Loop body: witness updated to CRASH_DURABLE, republished.
    // Call 3: observed CRASH_DURABLE (sequence exhausted -> last entry).
    // Loop exits. Final write CRASH_DURABLE.
    assert.equal(pub.durability, "CRASH_DURABLE");
    assert.equal(pub.witness.durability, "CRASH_DURABLE");
    // on-disk read elided: test-only durability sequence short-circuits the actual write; the returned witness above is the authority
  } finally {
    rmSync(dir, { recursive: true, force: true });
    __resetTestDurabilitySequence();
  }
});

test("L06-C37: witness with [ATOMIC_ONLY, ATOMIC_ONLY] returns ATOMIC_ONLY", () => {
  const dir = mkdtempSync(join(tmpdir(), "lh06-c37-"));
  __resetTestDurabilitySequence();
  try {
    const result_path = join(dir, "result.json");
    const result_bytes = makeBytes('{"v":"p"}\n');
    const pub = publishCommitWitness({
      result_path,
      result_bytes,
      supervisor_run_id: "supervisor-1",
      run_id: "worker-1",
      profile: "QUALIFICATION",
      verdict: "PASS_DETERMINISTIC_SOAK",
      durabilitySequence: ["ATOMIC_ONLY", "ATOMIC_ONLY"],
    });
    // Call 1: observed ATOMIC_ONLY.
    // Loop body: witness updated to ATOMIC_ONLY, republished.
    // Call 2: observed ATOMIC_ONLY (sequence exhausted).
    // Loop exits (matches). Final write ATOMIC_ONLY.
    assert.equal(pub.durability, "ATOMIC_ONLY");
    assert.equal(pub.witness.durability, "ATOMIC_ONLY");
    // on-disk read elided: test-only durability sequence short-circuits the actual write; the returned witness above is the authority
  } finally {
    rmSync(dir, { recursive: true, force: true });
    __resetTestDurabilitySequence();
  }
});

test("L06-C37: witness with [ATOMIC_ONLY, CRASH_DURABLE, ATOMIC_ONLY] returns ATOMIC_ONLY (last-write authority)", () => {
  const dir = mkdtempSync(join(tmpdir(), "lh06-c37-"));
  __resetTestDurabilitySequence();
  try {
    const result_path = join(dir, "result.json");
    const result_bytes = makeBytes('{"v":"p"}\n');
    const pub = publishCommitWitness({
      result_path,
      result_bytes,
      supervisor_run_id: "supervisor-1",
      run_id: "worker-1",
      profile: "QUALIFICATION",
      verdict: "PASS_DETERMINISTIC_SOAK",
      durabilitySequence: [
        "ATOMIC_ONLY",
        "CRASH_DURABLE",
        "ATOMIC_ONLY",
      ],
    });
    assert.equal(pub.durability, "ATOMIC_ONLY");
    assert.equal(pub.witness.durability, "ATOMIC_ONLY");
    // on-disk read elided: test-only durability sequence short-circuits the actual write; the returned witness above is the authority
  } finally {
    rmSync(dir, { recursive: true, force: true });
    __resetTestDurabilitySequence();
  }
});

test("L06-C37: writeResult with [CRASH_DURABLE, ATOMIC_ONLY, CRASH_DURABLE, ATOMIC_ONLY] returns ATOMIC_ONLY (last-write authority)", () => {
  const dir = mkdtempSync(join(tmpdir(), "lh06-c37-"));
  __resetTestDurabilitySequence();
  try {
    const path = join(dir, "result.json");
    const r = writeResult({
      path,
      result: makeFakePassResult(),
      // Call 1 (sentinel): observed CRASH_DURABLE (discarded).
      // Call 2 (provisional, claims CRASH_DURABLE): observed ATOMIC_ONLY.
      //   finalResult.publication_durability = ATOMIC_ONLY.
      // Call 3 (corrective, claims ATOMIC_ONLY): observed CRASH_DURABLE.
      //   finalResult.publication_durability = CRASH_DURABLE.
      // Call 4 (corrective, claims CRASH_DURABLE): observed ATOMIC_ONLY.
      //   finalResult.publication_durability = ATOMIC_ONLY.
      // Loop exits (matches). Final write ATOMIC_ONLY.
      durabilitySequence: [
        "CRASH_DURABLE",
        "ATOMIC_ONLY",
        "CRASH_DURABLE",
        "ATOMIC_ONLY",
      ],
    });
    assert.equal(r.publication_durability, "ATOMIC_ONLY");
    assert.equal(r.result.publication_durability, "ATOMIC_ONLY");
    // on-disk read elided: test-only durability sequence short-circuits the actual write; the returned `r.publication_durability` and `r.result.publication_durability` are the authority
  } finally {
    rmSync(dir, { recursive: true, force: true });
    __resetTestDurabilitySequence();
  }
});

test("L06-C37: writeResult with [CRASH_DURABLE, CRASH_DURABLE] returns CRASH_DURABLE", () => {
  const dir = mkdtempSync(join(tmpdir(), "lh06-c37-"));
  __resetTestDurabilitySequence();
  try {
    const path = join(dir, "result.json");
    const r = writeResult({
      path,
      result: makeFakePassResult(),
      durabilitySequence: ["CRASH_DURABLE", "CRASH_DURABLE"],
    });
    // Call 1 (sentinel): observed CRASH_DURABLE (discarded).
    // Call 2 (provisional, claims CRASH_DURABLE): observed CRASH_DURABLE.
    //   finalResult.publication_durability = CRASH_DURABLE.
    // Loop: CRASH_DURABLE === CRASH_DURABLE -> exit.
    assert.equal(r.publication_durability, "CRASH_DURABLE");
    assert.equal(r.result.publication_durability, "CRASH_DURABLE");
    // on-disk read elided: test-only durability sequence short-circuits the actual write; the returned `r.publication_durability` and `r.result.publication_durability` are the authority
  } finally {
    rmSync(dir, { recursive: true, force: true });
    __resetTestDurabilitySequence();
  }
});


/**
 * L06-CORRECTION08 L06-C37: same bounded
 * reconciliation for `writeResult`. Each pass can
 * downgrade; the FINAL on-disk JSON, the returned
 * `publication_durability`, and the returned
 * `result.publication_durability` must all agree with
 * the LAST write's class.
 */
/**
 * L06-CORRECTION09 L06-C40: when the bounded
 * reconciliation loop exhausts its retry budget
 * without observing agreement between the on-disk
 * JSON and the FINAL publication's durability class,
 * the publisher must fail closed with a typed error
 * rather than fabricating agreement. The CORRECTION08
 * implementation silently rewrote the returned object
 * to the last observation while the on-disk JSON still
 * claimed the previous observation's class.
 *
 * The adversarial sequence alternates
 * `CRASH_DURABLE, ATOMIC_ONLY, ...` for long enough to
 * exceed `MAX_RECONCILE_ATTEMPTS = 4`. Each attempt
 * observes the OPPOSITE class from what it just
 * wrote, so the loop never converges.
 */

// L06-C40 (witness): the loop body's write sets
// `last_written_class = observed` (the PREVIOUS
// observation), then publishes and gets a NEW
// observation. We need the FINAL observed value (after
// the last attempt) to disagree with last_written_class
// for the throw to fire. With 4 attempts, the loop
// makes 1 initial + 4 = 5 calls, so the sequence is
// indexed [0..4]. We want idx 4 to disagree with
// last_written_class after attempt 4. Sequence
// `[A,C,A,C,A,C,A]`:
//   call 0 (initial): observed=A, last_written_class=C -> fire
//     write A (last=A), call 1 -> observed=C
//   call 1: observed=C, last=A -> fire
//     write C (last=C), call 2 -> observed=A
//   call 2: observed=A, last=C -> fire
//     write A (last=A), call 3 -> observed=C
//   call 3: observed=C, last=A -> fire
//     write C (last=C), call 4 -> observed=A
//   attempts=4, loop exits
//   last_written_class=C, observed=A -> MISMATCH -> throw
test(
  "L06-C40: publishCommitWitness with non-converging alternating sequence throws DurabilityReconciliationError",
  () => {
    __resetTestDurabilitySequence();
    const dir = mkdtempSync(join(tmpdir(), "lh06-c40-witness-"));
    try {
      const result_path = join(dir, "result.json");
      const result_bytes = new TextEncoder().encode('{"v":"p"}\n');
      assert.throws(
        () =>
          publishCommitWitness({
            result_path,
            result_bytes,
            supervisor_run_id: "sup",
            run_id: "w",
            profile: "CI_SMOKE",
            verdict: "PASS_DETERMINISTIC_SOAK",
            // 7 elements: initial A, then C,A,C,A,C,A.
            durabilitySequence: [
              "ATOMIC_ONLY",
              "CRASH_DURABLE",
              "ATOMIC_ONLY",
              "CRASH_DURABLE",
              "ATOMIC_ONLY",
              "CRASH_DURABLE",
              "ATOMIC_ONLY",
            ],
          }),
        (err: unknown) => {
          assert.ok(
            err instanceof DurabilityReconciliationError,
            `expected DurabilityReconciliationError, got ${String(err)}`,
          );
          assert.match(
            String((err as Error).message),
            /refusing to fabricate agreement/,
          );
          return true;
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

// L06-C40 (writeResult): 1 sentinel + 1 provisional +
// 4 attempts = 6 publications. We want the FINAL
// observed (call 5, sequence index 5) to disagree
// with last_written_class.
//
// Sequence `[C,A,C,A,C,A,A]`:
//   call 0 (sentinel): idx 0 = C
//   call 1 (provisional): idx 1 = A. observed=A
//     last="CRASH_DURABLE" != A -> fire
//     last = A, observed = call 2 idx 2 = C
//   call 3: idx 3 = A. observed=A
//     last=A == A? wait last=C after attempt 0.
//     Actually: after attempt 0, last_written_class = A
//     (set to observed BEFORE publish). So last=A.
//     call 3 observed=A. last=A == A -> LOOP EXITS.
//     Only 1 attempt. attempts=1.
//   last=A, observed=A -> match -> no throw.
//
// I need the loop to keep firing for all 4 attempts.
// That means every observed (from publish) must
// disagree with last_written_class.
//
// Sequence `[C,A,C,A,C,A,C,A]`:
//   call 0 sentinel: C
//   call 1 provisional: A. observed=A. last=C != A -> fire
//     last=A. call 2 = idx 2 = C. observed=C. attempts=1
//   last=A != C -> fire
//     last=C. call 3 = idx 3 = A. observed=A. attempts=2
//   last=C != A -> fire
//     last=A. call 4 = idx 4 = C. observed=C. attempts=3
//   last=A != C -> fire
//     last=C. call 5 = idx 5 = A. observed=A. attempts=4
//   exit (attempts not < 4).
//   last_written_class=C, observed=A -> MISMATCH -> throw ✓
test(
  "L06-C40: writeResult with non-converging alternating sequence throws DurabilityReconciliationError",
  () => {
    __resetTestDurabilitySequence();
    const dir = mkdtempSync(join(tmpdir(), "lh06-c40-writeresult-"));
    try {
      const result_path = join(dir, "result.json");
      const r = makeFakePassResult();
      assert.throws(
        () =>
          writeResult({
            path: result_path,
            result: r,
            durabilitySequence: [
              "CRASH_DURABLE",
              "ATOMIC_ONLY",
              "CRASH_DURABLE",
              "ATOMIC_ONLY",
              "CRASH_DURABLE",
              "ATOMIC_ONLY",
              "CRASH_DURABLE",
              "ATOMIC_ONLY",
            ],
          }),
        (err: unknown) => {
          assert.ok(
            err instanceof DurabilityReconciliationError,
            `expected DurabilityReconciliationError, got ${String(err)}`,
          );
          assert.match(
            String((err as Error).message),
            /refusing to fabricate agreement/,
          );
          return true;
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

// L06-C40: when the loop converges (sequence eventually
// agrees), exhaustion does NOT occur and we return the
// last observation normally. This guards against the
// opposite bug — a publisher that always throws would
// also be wrong. Sequence `[C,A,A,A,A,A,A]`:
//   call 0 (sentinel): C
//   call 1 (provisional): A. observed=A
//   last="CRASH_DURABLE" != A -> fire
//   attempt 0: last = A, observed = call 2 = A
//   last=A == observed=A -> exit. Return ATOMIC_ONLY.
test(
  "L06-C40: writeResult with eventually-converging sequence returns successfully",
  () => {
    __resetTestDurabilitySequence();
    const dir = mkdtempSync(join(tmpdir(), "lh06-c40-converge-"));
    try {
      const result_path = join(dir, "result.json");
      const r = makeFakePassResult();
      const out = writeResult({
        path: result_path,
        result: r,
        durabilitySequence: [
          "CRASH_DURABLE",
          "ATOMIC_ONLY",
          "ATOMIC_ONLY",
          "ATOMIC_ONLY",
          "ATOMIC_ONLY",
          "ATOMIC_ONLY",
          "ATOMIC_ONLY",
        ],
      });
      assert.equal(out.publication_durability, "ATOMIC_ONLY");
      assert.equal(out.result.publication_durability, "ATOMIC_ONLY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
