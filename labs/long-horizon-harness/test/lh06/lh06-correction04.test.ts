/**
 * LH-06 L06-CORRECTION04 oracle tests (C25/C26).
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Split from `lh06-correction03.test.ts` for
 * source-size discipline.
 *
 * C25: writeResult performs crash-durable
 * publication (fsync file + rename + fsync parent
 * directory).
 *
 * C26: adversarial verifier tests. Each test forges
 * one field of the worker result and confirms
 * `verifyWorkerResult` returns `{ok:false, reason}`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { runSoakWorker } from "../../soak/worker-runner.js";
import { createWorkerState } from "../../soak/worker-state.js";
import { verifyWorkerResult } from "../../soak/worker-result-verifier.js";
import { publishCommitWitness } from "../../soak/commit-witness.js";

/**
 * L06-CORRECTION07 L06-C35 helper: build a valid
 * commit witness for the given result. Tests that
 * exercise legitimate PASS closures call this to
 * generate the witness before calling the verifier.
 * Tests that exercise PASS-closure failure modes
 * build the witness explicitly (with wrong SHA, wrong
 * supervisor_run_id, etc.).
 */
function makeValidCommitWitness(
  result: Record<string, unknown>,
  resultBytes: Uint8Array,
) {
  const ei = result["environment_identity"] as
    | Record<string, unknown>
    | undefined;
  const runId = ei && typeof ei["soak_run_id"] === "string"
    ? (ei["soak_run_id"] as string)
    : (result["supervisor_run_id"] as string);
  const profile = result["profile"] as
    "CI_SMOKE" | "QUALIFICATION" | "EXTENDED";
  const verdict = result["verdict"] as Parameters<
    typeof publishCommitWitness
  >[0]["verdict"];
  return publishCommitWitness({
    result_path: "/tmp/lh06-test/result.json",
    result_bytes: resultBytes,
    supervisor_run_id: String(result["supervisor_run_id"]),
    run_id: runId,
    profile,
    verdict,
  }).witness;
}

function makeResultBytes(result: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(result, null, 2) + "\n",
  );
}

const REPO_ROOT = process.cwd();

function withCompleteSubstrate(s: ReturnType<typeof createWorkerState>) {
  return {
    ...s,
    substrateOverride: {
      phase_e_head: "x",
      lh02_head: "x",
      lh03_frozen_commit: "x",
      lh04_frozen_commit: "x",
      lh05_corpus_commit: "x",
      repo_commit: "x",
    },
  } as ReturnType<typeof createWorkerState>;
}

test(
  "L06-C25: writeResult crash-durable publication leaves no stale state",
  { concurrency: false },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "lh06-c25-"));
    try {
      const state = createWorkerState({
        profile: "CI_SMOKE",
        injection: { kind: "NONE" },
        repoRoot: REPO_ROOT,
      });
      const resultPath = join(dir, "result.json");
      await runSoakWorker({
        state: withCompleteSubstrate(state),
        result_path: resultPath,
        max_epochs: 2,
      });
      assert.equal(existsSync(resultPath), true);
      const stray = readdirSync(dir).filter((f) => f.endsWith(".tmp"));
      assert.deepEqual(stray, [], "temp files left behind after publish");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("L06-C26: verifyWorkerResult rejects wrong telemetry_sha256 (hash drift)", () => {
  const dir = mkdtempSync(join(tmpdir(), "lh06-c26a-"));
  try {
    const result = makeFakeWorkerResult();
    const tp = join(dir, "lh06-test.telemetry.jsonl");
    writeFileSync(tp, '{"type":"LH06_HEARTBEAT","epoch":0}\n');
    result.telemetry_path = tp;
    result.telemetry_sha256 =
      "0000000000000000000000000000000000000000000000000000000000000000";
    result.telemetry_bytes = readFileSync(tp).length;
    result.telemetry_line_count = 1;
    const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: result.supervisor_run_id,
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "TELEMETRY_HASH_DRIFT");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("L06-C26: verifyWorkerResult rejects wrong supervisor_run_id", () => {
  const result = makeFakeWorkerResult();
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: "wrong-id-1234",
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "SUPERVISOR_RUN_ID_MISMATCH");
});

test("L06-C26: verifyWorkerResult rejects forged duration (negative)", () => {
  const result = makeFakeWorkerResult();
  (result as Record<string, unknown>)["duration_ms"] = -1;
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: result.supervisor_run_id,
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "MALFORMED_DURATION");
});

test("L06-C26: verifyWorkerResult rejects forged epochs_completed (NaN)", () => {
  const result = makeFakeWorkerResult();
  (result as Record<string, unknown>)["epochs_completed"] = Number.NaN;
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: result.supervisor_run_id,
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "MALFORMED_EPOCH_COUNTER");
});

test("L06-C26: verifyWorkerResult rejects PASS verdict with non-null failure", () => {
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["verdict"] = "PASS_DETERMINISTIC_SOAK";
  result["failure"] = {
    kind: "RESOURCE_LEAK",
    epoch: 0,
    last_completed_case: "x",
    minimal_diff: {},
    message: "forged",
  };
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "INCONSISTENT_VERDICT");
});

test("L06-C26: verifyWorkerResult rejects incomplete substrate", () => {
  // L06-CORRECTION11 L06-C44: INCOMPLETE_SUBSTRATE is
  // ONLY raised on a PASS verdict. A non-PASS verdict
  // with an incomplete substrate is ACCEPTED (negative
  // evidence is preserved). To exercise the
  // INCOMPLETE_SUBSTRATE branch the test fixture MUST
  // claim PASS_DETERMINISTIC_SOAK.
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  const substrate = result["substrate"] as Record<string, unknown>;
  substrate["phase_e_head"] = null;
  result["substrate_complete"] = false;
  result["verdict"] = "PASS_DETERMINISTIC_SOAK";
  result["failure"] = null;
  // Substrate semantic check requires PASS to also be
  // profile-minimum compliant: duration_ms >= profile
  // minimum (60min for QUALIFICATION, smaller for
  // CI_SMOKE) and epochs_completed >= minimum (10 for
  // CI_SMOKE). The fake result already has
  // duration_ms=3,600,000 and epochs_completed=20.
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "INCOMPLETE_SUBSTRATE");
});

test("L06-C26: verifyWorkerResult rejects bad profile (closed-union violation)", () => {
  const result = makeFakeWorkerResult();
  (result as Record<string, unknown>)["profile"] = "PROD";
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: result.supervisor_run_id,
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "BAD_PROFILE");
});

/**
 * L06-CORRECTION05 L06-C28: forged PASS with
 * positive-but-under-minimum counters. The verifier
 * recomputes the contract from `LH06_PROFILES[profile]`
 * exactly as `buildResult` does. A QUALIFICATION
 * profile with `duration_ms = 59min` and 500 epochs, or
 * `60min` and 499 epochs, must be rejected.
 */
test("L06-C28: forged PASS QUALIFICATION 59min / 500 epochs is rejected (INSUFFICIENT_DURATION)", () => {
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "QUALIFICATION";
  result["duration_ms"] = 59 * 60 * 1000;
  result["epochs_completed"] = 500;
  result["verdict"] = "PASS_DETERMINISTIC_SOAK";
  result["failure"] = null;
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "INSUFFICIENT_DURATION");
});

test("L06-C28: forged PASS QUALIFICATION 60min / 499 epochs is rejected (INSUFFICIENT_EPOCHS)", () => {
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "QUALIFICATION";
  result["duration_ms"] = 60 * 60 * 1000;
  result["epochs_completed"] = 499;
  result["verdict"] = "PASS_DETERMINISTIC_SOAK";
  result["failure"] = null;
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "INSUFFICIENT_EPOCHS");
});

test("L06-C28: forged PASS CI_SMOKE 9 epochs is rejected (INSUFFICIENT_EPOCHS)", () => {
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "CI_SMOKE";
  result["duration_ms"] = 60 * 60 * 1000;
  result["epochs_completed"] = 9;
  result["verdict"] = "PASS_DETERMINISTIC_SOAK";
  result["failure"] = null;
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "INSUFFICIENT_EPOCHS");
});

test("L06-C28: legitimate PASS QUALIFICATION 60min / 500 epochs is accepted", () => {
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "QUALIFICATION";
  result["duration_ms"] = 60 * 60 * 1000;
  result["epochs_completed"] = 500;
  result["verdict"] = "PASS_DETERMINISTIC_SOAK";
  result["failure"] = null;
  // L06-CORRECTION07 L06-C35: legitimate PASS
  // closure requires a commit witness with
  // CRASH_DURABLE + matching result_sha256 +
  // matching supervisor_run_id + matching run_id.
  const resultBytes = makeResultBytes(result);
  const witness = makeValidCommitWitness(result, resultBytes);
  const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
    result_bytes: resultBytes,
    commit_witness_raw: witness,
  });
  assert.equal(v.ok, true);
});

/**
 * L06-CORRECTION05 L06-C29: the worker must record
 * `telemetry_bytes` / `telemetry_line_count` that match
 * the on-disk file. A worker that claims 9 million
 * lines / 0 bytes is rejected.
 */
test("L06-C29: forged telemetry_bytes is rejected (TELEMETRY_BYTES_DRIFT)", () => {
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["telemetry_bytes"] = 999_999_999;
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "TELEMETRY_BYTES_DRIFT");
});

test("L06-C29: forged telemetry_line_count is rejected (TELEMETRY_LINE_COUNT_DRIFT)", () => {
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["telemetry_line_count"] = 9_000_000;
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "TELEMETRY_LINE_COUNT_DRIFT");
});

/**
 * L06-CORRECTION05 L06-C30: publication durability is
 * exposed explicitly. On a normal POSIX filesystem the
 * full fsync-file + rename + fsync-parent-dir sequence
 * succeeds and `writeResult` reports
 * `publication_durability = "CRASH_DURABLE"`. The new
 * field replaces the silently-caught error path of C25;
 * callers can inspect it to know whether the result is
 * usable as crash-durable qualification evidence.
 */
test("L06-C30: writeResult reports publication_durability=CRASH_DURABLE on POSIX", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lh06-c30-"));
  try {
    const resultPath = join(dir, "result.json");
    const built = makeMinimalPassResult() as unknown as Parameters<
      typeof import("../../soak/result-io.js").writeResult
    >[0]["result"];
    const {
      writeResult,
    } = await import("../../soak/result-io.js");
    const r = writeResult({ path: resultPath, result: built });
    assert.equal(r.publication_durability, "CRASH_DURABLE");
    assert.equal(r.sha256.length, 64);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * L06-CORRECTION06 L06-C32: verdict-aware profile minima.
 *
 * Verifier mirrors the producer's failure-priority logic.
 * A real `failure` takes precedence over contract minima,
 * so a legitimate early FAIL_* terminal record is NOT
 * silently destroyed by a verdict-agnostic duration /
 * epochs gate.
 */

test("L06-C32: FAIL_MEMORY_GROWTH @ QUALIFICATION epoch=137 is ACCEPTED", () => {
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "QUALIFICATION";
  result["duration_ms"] = 17 * 60 * 1000; // 17 minutes < 60
  result["epochs_completed"] = 137; // < 500
  result["verdict"] = "FAIL_RESOURCE_STABILITY";
  result["failure"] = {
    kind: "MEMORY_GROWTH",
    epoch: 137,
    last_completed_case: "x",
    minimal_diff: {},
    message: "fake memory growth",
  };
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, true);
});

test("L06-C32: FAIL_RESOURCE_STABILITY @ CI_SMOKE epoch=3 is ACCEPTED", () => {
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "CI_SMOKE";
  result["duration_ms"] = 100;
  result["epochs_completed"] = 3; // < 10 minimum
  result["verdict"] = "FAIL_RESOURCE_STABILITY";
  result["failure"] = {
    kind: "RESOURCE_LEAK",
    epoch: 3,
    last_completed_case: "x",
    minimal_diff: {},
    message: "fake leak",
  };
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, true);
});

test("L06-C32: QUALIFICATION_INCOMPLETE @ 9 CI epochs is ACCEPTED (one minimum not met)", () => {
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "CI_SMOKE";
  result["duration_ms"] = 1000;
  result["epochs_completed"] = 9; // < 10 minimum
  result["verdict"] = "QUALIFICATION_INCOMPLETE";
  result["failure"] = {
    kind: "QUALIFICATION_INCOMPLETE",
    epoch: null,
    last_completed_case: null,
    minimal_diff: {},
    message: "caller imposed max_epochs before contract met",
  };
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, true);
});

test("L06-C32: QUALIFICATION_INCOMPLETE @ 10 CI epochs is REJECTED (INCONSISTENT_VERDICT)", () => {
  // A run that satisfies both minima but claims
  // QUALIFICATION_INCOMPLETE is incoherent — the run is
  // contract-complete and the verdict is wrong.
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "CI_SMOKE";
  result["duration_ms"] = 60 * 1000;
  result["epochs_completed"] = 10; // exactly meets minimum
  result["verdict"] = "QUALIFICATION_INCOMPLETE";
  result["failure"] = {
    kind: "QUALIFICATION_INCOMPLETE",
    epoch: null,
    last_completed_case: null,
    minimal_diff: {},
    message: "forged incomplete claim",
  };
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "INCONSISTENT_VERDICT");
});

test("L06-C32: PASS @ CI_SMOKE 9 epochs is REJECTED (INSUFFICIENT_EPOCHS)", () => {
  // Defensive control — re-confirms the original C28
  // gate for the PASS verdict path.
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "CI_SMOKE";
  result["duration_ms"] = 60 * 60 * 1000;
  result["epochs_completed"] = 9;
  result["verdict"] = "PASS_DETERMINISTIC_SOAK";
  result["failure"] = null;
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "INSUFFICIENT_EPOCHS");
});

/**
 * L06-CORRECTION06 L06-C33: publication durability is a
 * required field, and PASS_DETERMINISTIC_SOAK requires
 * the artifact to be CRASH_DURABLE.
 */

test("L06-C33: missing publication_durability is REJECTED (MISSING_REQUIRED_FIELD)", () => {
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "QUALIFICATION";
  result["duration_ms"] = 60 * 60 * 1000;
  result["epochs_completed"] = 500;
  result["verdict"] = "PASS_DETERMINISTIC_SOAK";
  result["failure"] = null;
  delete result["publication_durability"];
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "MISSING_REQUIRED_FIELD");
});

test("L06-C33: forged publication_durability=ATOMIC_ONLY on PASS verdict is REJECTED", () => {
  // PASS_DETERMINISTIC_SOAK qualification closure requires
  // CRASH_DURABLE — the canonical artifact must survive a
  // power loss between the rename and any later read. A
  // forgery claiming PASS with ATOMIC_ONLY is exactly the
  // C33 mismatch the verifier must catch.
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "QUALIFICATION";
  result["duration_ms"] = 60 * 60 * 1000;
  result["epochs_completed"] = 500;
  result["verdict"] = "PASS_DETERMINISTIC_SOAK";
  result["failure"] = null;
  result["publication_durability"] = "ATOMIC_ONLY";
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "INCONSISTENT_VERDICT");
});

test("L06-C33: PASS @ QUALIFICATION 60min / 500 epochs / CRASH_DURABLE is ACCEPTED (closure shape)", () => {
  // The control — this is the artifact shape the real
  // 60-minute qualification run will produce IF it
  // qualifies. Verifier accepts. Earlier C28 controls
  // omitted publication_durability and would now fail
  // MISSING_REQUIRED_FIELD; this C33 control completes
  // the closure shape.
  //
  // L06-CORRECTION07 L06-C35: legitimate PASS closure
  // ALSO requires a commit witness.
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "QUALIFICATION";
  result["duration_ms"] = 60 * 60 * 1000;
  result["epochs_completed"] = 500;
  result["verdict"] = "PASS_DETERMINISTIC_SOAK";
  result["failure"] = null;
  result["publication_durability"] = "CRASH_DURABLE";
  const resultBytes = makeResultBytes(result);
  const witness = makeValidCommitWitness(result, resultBytes);
  const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
    result_bytes: resultBytes,
    commit_witness_raw: witness,
  });
  assert.equal(v.ok, true);
});

test("L06-C33: ATOMIC_ONLY publication is ACCEPTED for non-PASS verdicts", () => {
  // A FAIL_* terminal record preserves the worker-side
  // observed failure even when publication survived
  // only as ATOMIC_ONLY. ATOMIC_ONLY is sufficient for
  // non-closure records.
  const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
  result["profile"] = "QUALIFICATION";
  result["duration_ms"] = 17 * 60 * 1000;
  result["epochs_completed"] = 137;
  result["verdict"] = "FAIL_RESOURCE_STABILITY";
  result["failure"] = {
    kind: "MEMORY_GROWTH",
    epoch: 137,
    last_completed_case: "x",
    minimal_diff: {},
    message: "fake",
  };
  result["publication_durability"] = "ATOMIC_ONLY";
  const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
    raw: result,
    expected_supervisor_run_id: String(result["supervisor_run_id"]),
  });
  assert.equal(v.ok, true);
});

/**
 * Build a minimal-but-verifiable worker result.
 * Includes a real telemetry file so the verifier's
 * file-existence + hash checks succeed unless
 * intentionally mutated.
 *
 * L06-CORRECTION07 L06-C35: end-to-end verifier test
 * for the commit-witness gate.
 */
test(
  "L06-C35: PASS closure with wrong-SHA witness is REJECTED (COMMIT_WITNESS_SHA_MISMATCH)",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 60 * 60 * 1000;
    result["epochs_completed"] = 500;
    result["verdict"] = "PASS_DETERMINISTIC_SOAK";
    result["failure"] = null;
    result["publication_durability"] = "CRASH_DURABLE";
    const resultBytes = makeResultBytes(result);
    const witness = makeValidCommitWitness(result, resultBytes);
    const forged = { ...witness, result_sha256: "ff".repeat(32) };
    const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      result_bytes: resultBytes,
      commit_witness_raw: forged,
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "COMMIT_WITNESS_SHA_MISMATCH");
  },
);

test(
  "L06-C35: PASS closure with stale supervisor_run_id witness is REJECTED",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 60 * 60 * 1000;
    result["epochs_completed"] = 500;
    result["verdict"] = "PASS_DETERMINISTIC_SOAK";
    result["failure"] = null;
    result["publication_durability"] = "CRASH_DURABLE";
    const resultBytes = makeResultBytes(result);
    const witness = makeValidCommitWitness(result, resultBytes);
    const forged = {
      ...witness,
      supervisor_run_id: "stale-supervisor-from-prior-run",
    };
    const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      result_bytes: resultBytes,
      commit_witness_raw: forged,
    });
    assert.equal(v.ok, false);
    if (!v.ok)
      assert.equal(v.reason, "COMMIT_WITNESS_SUPERVISOR_RUN_ID_MISMATCH");
  },
);

test(
  "L06-C35: PASS closure with ATOMIC_ONLY witness is REJECTED",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 60 * 60 * 1000;
    result["epochs_completed"] = 500;
    result["verdict"] = "PASS_DETERMINISTIC_SOAK";
    result["failure"] = null;
    result["publication_durability"] = "CRASH_DURABLE";
    const resultBytes = makeResultBytes(result);
    const witness = makeValidCommitWitness(result, resultBytes);
    const forged = { ...witness, durability: "ATOMIC_ONLY" };
    const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      result_bytes: resultBytes,
      commit_witness_raw: forged,
    });
    assert.equal(v.ok, false);
    if (!v.ok)
      assert.equal(v.reason, "COMMIT_WITNESS_NOT_CRASH_DURABLE");
  },
);

test(
  "L06-C35: PASS closure with bad-schema witness is REJECTED",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 60 * 60 * 1000;
    result["epochs_completed"] = 500;
    result["verdict"] = "PASS_DETERMINISTIC_SOAK";
    result["failure"] = null;
    result["publication_durability"] = "CRASH_DURABLE";
    const resultBytes = makeResultBytes(result);
    const witness = makeValidCommitWitness(result, resultBytes);
    const forged = { ...witness, schema: "lh06.something-else/v1" };
    const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      result_bytes: resultBytes,
      commit_witness_raw: forged,
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "BAD_COMMIT_WITNESS_SCHEMA");
  },
);

test(
  "L06-C35: PASS closure with stale run_id witness is REJECTED",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 60 * 60 * 1000;
    result["epochs_completed"] = 500;
    result["verdict"] = "PASS_DETERMINISTIC_SOAK";
    result["failure"] = null;
    result["publication_durability"] = "CRASH_DURABLE";
    const resultBytes = makeResultBytes(result);
    const witness = makeValidCommitWitness(result, resultBytes);
    const forged = {
      ...witness,
      run_id: "stale-worker-run-id-from-prior-run",
    };
    const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      result_bytes: resultBytes,
      commit_witness_raw: forged,
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "COMMIT_WITNESS_RUN_ID_MISMATCH");
  },
);

test(
  "L06-C35: non-PASS verdict in PROMOTION mode does NOT require a commit witness",
  () => {
    // L06-CORRECTION08 L06-C36: negative evidence
    // records use PROMOTION mode — the supervisor
    // records them as terminal failures without
    // publishing a closure witness. The witness gate
    // only applies to CLOSURE mode for PASS verdicts.
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 17 * 60 * 1000;
    result["epochs_completed"] = 137;
    result["verdict"] = "FAIL_RESOURCE_STABILITY";
    result["failure"] = {
      kind: "MEMORY_GROWTH",
      epoch: 137,
      last_completed_case: "x",
      minimal_diff: {},
      message: "heap growth observed",
    };
    result["publication_durability"] = "ATOMIC_ONLY";
    const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
    });
    assert.equal(v.ok, true);
  },
);

test(
  "L06-C36: PROMOTION mode REJECTS supplying result_bytes (INCOMPLETE_COMMIT)",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 17 * 60 * 1000;
    result["epochs_completed"] = 137;
    result["verdict"] = "FAIL_RESOURCE_STABILITY";
    result["failure"] = {
      kind: "MEMORY_GROWTH",
      epoch: 137,
      last_completed_case: "x",
      minimal_diff: {},
      message: "heap growth observed",
    };
    result["publication_durability"] = "ATOMIC_ONLY";
    const resultBytes = makeResultBytes(result);
    const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      result_bytes: resultBytes,
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "INCOMPLETE_COMMIT");
  },
);

test(
  "L06-C36: CLOSURE mode REJECTS bytes-without-witness (INCOMPLETE_COMMIT)",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 60 * 60 * 1000;
    result["epochs_completed"] = 500;
    result["verdict"] = "PASS_DETERMINISTIC_SOAK";
    result["failure"] = null;
    result["publication_durability"] = "CRASH_DURABLE";
    const resultBytes = makeResultBytes(result);
    const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      result_bytes: resultBytes,
      // commit_witness_raw intentionally omitted
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "INCOMPLETE_COMMIT");
  },
);

test(
  "L06-C36: CLOSURE mode REJECTS witness-without-bytes (INCOMPLETE_COMMIT)",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 60 * 60 * 1000;
    result["epochs_completed"] = 500;
    result["verdict"] = "PASS_DETERMINISTIC_SOAK";
    result["failure"] = null;
    result["publication_durability"] = "CRASH_DURABLE";
    const resultBytes = makeResultBytes(result);
    const witness = makeValidCommitWitness(result, resultBytes);
    const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      // result_bytes intentionally omitted
      commit_witness_raw: witness,
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "INCOMPLETE_COMMIT");
  },
);

// L06-CORRECTION09 L06-C39: CLOSURE + PASS + empty
// arguments must NOT bypass the witness gate. This
// is the exact fail-open path the CORRECTION08 review
// identified: `hasBytes=false, hasWitness=false`
// makes `hasBytes!==hasWitness` false, so the
// CORRECTION08 verifier silently returned `ok:true`
// for a PASS closure with neither bytes nor witness.
// L06-C39 adds the explicit PASS-required predicate.
test(
  "L06-C39: CLOSURE + PASS + neither bytes nor witness is INCOMPLETE_COMMIT",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 60 * 60 * 1000;
    result["epochs_completed"] = 500;
    result["verdict"] = "PASS_DETERMINISTIC_SOAK";
    result["failure"] = null;
    result["publication_durability"] = "CRASH_DURABLE";
    const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      // NEITHER result_bytes NOR commit_witness_raw:
      // this is the regression case that the
      // CORRECTION08 implementation accepted.
    });
    assert.equal(v.ok, false);
    if (!v.ok) {
      assert.equal(v.reason, "INCOMPLETE_COMMIT");
      // The detail message MUST call out the empty
      // closure so a forensic reader can tell at a
      // glance which predicate failed.
      assert.match(v.detail, /PASS_DETERMINISTIC_SOAK requires BOTH/);
    }
  },
);

test(
  "L06-C39: CLOSURE + non-PASS + empty arguments is ALLOWED (no negative evidence recorded)",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 17 * 60 * 1000;
    result["epochs_completed"] = 137;
    result["verdict"] = "FAIL_RESOURCE_STABILITY";
    result["failure"] = {
      kind: "MEMORY_GROWTH",
      epoch: 137,
      last_completed_case: "x",
      minimal_diff: {},
      message: "heap growth observed",
    };
    result["publication_durability"] = "ATOMIC_ONLY";
    const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      // no bytes, no witness — supervisor records the
      // negative evidence directly; this is the only
      // empty-closure path that is allowed.
    });
    assert.equal(v.ok, true);
  },
);

test(
  "L06-C39: CLOSURE + non-PASS + bytes-without-witness is INCOMPLETE_COMMIT",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 17 * 60 * 1000;
    result["epochs_completed"] = 137;
    result["verdict"] = "FAIL_RESOURCE_STABILITY";
    result["failure"] = {
      kind: "MEMORY_GROWTH",
      epoch: 137,
      last_completed_case: "x",
      minimal_diff: {},
      message: "heap growth observed",
    };
    result["publication_durability"] = "ATOMIC_ONLY";
    const resultBytes = makeResultBytes(result);
    const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      result_bytes: resultBytes,
      // witness intentionally omitted
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "INCOMPLETE_COMMIT");
  },
);

test(
  "L06-C38: wrong result_path in witness is REJECTED (COMMIT_WITNESS_RESULT_PATH_MISMATCH)",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 60 * 60 * 1000;
    result["epochs_completed"] = 500;
    result["verdict"] = "PASS_DETERMINISTIC_SOAK";
    result["failure"] = null;
    result["publication_durability"] = "CRASH_DURABLE";
    const resultBytes = makeResultBytes(result);
    const witness = makeValidCommitWitness(result, resultBytes);
    const v = verifyWorkerResult({
      mode: "CLOSURE",
      result_path: "/tmp/different-canonical-path/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
      result_bytes: resultBytes,
      commit_witness_raw: witness,
    });
    assert.equal(v.ok, false);
    if (!v.ok)
      assert.equal(v.reason, "COMMIT_WITNESS_RESULT_PATH_MISMATCH");
  },
);
test(
  "L06-C34: MEMORY_GROWTH failure presented with FAIL_FROZEN_INTEGRITY verdict is REJECTED",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 17 * 60 * 1000;
    result["epochs_completed"] = 137;
    result["verdict"] = "FAIL_FROZEN_INTEGRITY";
    result["failure"] = {
      kind: "MEMORY_GROWTH",
      epoch: 137,
      last_completed_case: "x",
      minimal_diff: {},
      message: "heap growth observed",
    };
    result["publication_durability"] = "ATOMIC_ONLY";
    const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "INCONSISTENT_VERDICT");
  },
);

test(
  "L06-C34: FROZEN_MUTATION failure presented with FAIL_RESOURCE_STABILITY verdict is REJECTED",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 17 * 60 * 1000;
    result["epochs_completed"] = 137;
    result["verdict"] = "FAIL_RESOURCE_STABILITY";
    result["failure"] = {
      kind: "FROZEN_MUTATION",
      epoch: 137,
      last_completed_case: "x",
      minimal_diff: {},
      message: "frozen fixture mutated",
    };
    result["publication_durability"] = "ATOMIC_ONLY";
    const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
    });
    assert.equal(v.ok, false);
    if (!v.ok) assert.equal(v.reason, "INCONSISTENT_VERDICT");
  },
);

test(
  "L06-C34: matching verdict / failure pair is ACCEPTED (control)",
  () => {
    const result = makeFakeWorkerResult() as unknown as Record<string, unknown>;
    result["profile"] = "QUALIFICATION";
    result["duration_ms"] = 17 * 60 * 1000;
    result["epochs_completed"] = 137;
    result["verdict"] = "FAIL_RESOURCE_STABILITY";
    result["failure"] = {
      kind: "MEMORY_GROWTH",
      epoch: 137,
      last_completed_case: "x",
      minimal_diff: {},
      message: "heap growth observed",
    };
    result["publication_durability"] = "ATOMIC_ONLY";
    const v = verifyWorkerResult({
      mode: "PROMOTION",
      result_path: "/tmp/lh06-test/result.json",
      raw: result,
      expected_supervisor_run_id: String(result["supervisor_run_id"]),
    });
    assert.equal(v.ok, true);
  },
);

/**
 * L06-CORRECTION05 L06-C28: CI_SMOKE requires
 * `epochs_completed >= 10`. The helper defaults to 20
 * so the verifier's profile-contract check passes for
 * tests that don't intentionally mutate the counter.
 */
function makeFakeWorkerResult() {
  const dir = mkdtempSync(join(tmpdir(), "lh06-c26base-"));
  const tp = join(dir, "lh06-base.telemetry.jsonl");
  const lines = [
    '{"type":"LH06_HEARTBEAT","epoch":0}',
    '{"type":"LH06_HEARTBEAT","epoch":1}',
    '{"type":"LH06_HEARTBEAT","epoch":2}',
  ];
  writeFileSync(tp, lines.join("\n") + "\n");
  const realBytes = readFileSync(tp);
  const realSha = createHash("sha256").update(realBytes).digest("hex");
  const runId = `test-${Date.now()}`;
  return {
    schema: "lh06.deterministic.soak.result.v1",
    contract_version: "lh06.soak.contract.v1",
    profile: "CI_SMOKE",
    supervisor_run_id: runId,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 60 * 60 * 1000,
    environment_identity: {
      soak_run_id: runId,
      profile: "CI_SMOKE",
      contract_version: "lh06.soak.contract.v1",
      repo_commit: "x",
    },
    substrate: {
      phase_e_head: "x",
      lh02_head: "x",
      lh03_frozen_commit: "x",
      lh04_frozen_commit: "x",
      lh05_corpus_commit: "x",
      repo_commit: "x",
    },
    substrate_complete: true,
    frozen_tree: {
      before_sha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      after_sha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      changed: false,
      status: { ok: true, kind: "VALID" },
    },
    epochs_completed: 20,
    cases_completed: 20,
    semantic: {
      cases_observed: 20,
      drift_count: 0,
      cases_with_multiple_semantic_results: 0,
      lifecycle_drift_by_scenario: {},
      predecessor_dependency_count: 0,
      fault_count: 0,
      fault_escape_count: 0,
    },
    resources: {
      heap_slope_bytes_per_epoch: 0,
      owned_after_release: 0,
      owned_leaked_after_epoch: 0,
    },
    latency: {
      p50_ms: 1,
      p95_ms: 1,
      p99_ms: 1,
      max_ms: 1,
      window_size: 32,
      threshold_p99_ms: 1000,
      observed_drift_ms: 0,
    },
    repeatability: { semantic_repeatability: true },
    telemetry_path: tp,
    telemetry_sha256: realSha,
    telemetry_bytes: realBytes.length,
    telemetry_line_count: lines.length,
    // L06-CORRECTION06 L06-C33: helper claims
    // CRASH_DURABLE so the verifier's PASS-durability
    // gate does not produce false positives in
    // contract-only tests. Tests that want to forge
    // this field mutate it explicitly.
    publication_durability: "CRASH_DURABLE" as const,
    verdict: "FAIL_RESOURCE_STABILITY" as const,
    failure: {
      kind: "RESOURCE_LEAK" as const,
      epoch: 0,
      last_completed_case: "x",
      minimal_diff: {},
      message: "fake",
    },
  };
}

/**
 * Build a minimal worker result suitable for direct
 * disk IO testing. The verifier is not called here —
 * the goal is just to exercise `writeResult` and
 * inspect its return value.
 */
function makeMinimalPassResult() {
  const runId = `test-min-${Date.now()}`;
  return {
    schema: "lh06.deterministic.soak.result.v1",
    contract_version: "lh06.soak.contract.v1",
    profile: "CI_SMOKE",
    supervisor_run_id: runId,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    duration_ms: 1000,
    environment_identity: {
      soak_run_id: runId,
      profile: "CI_SMOKE",
      contract_version: "lh06.soak.contract.v1",
      repo_commit: "x",
    },
    substrate: {
      phase_e_head: "x",
      lh02_head: "x",
      lh03_frozen_commit: "x",
      lh04_frozen_commit: "x",
      lh05_corpus_commit: "x",
      repo_commit: "x",
    },
    substrate_complete: true,
    frozen_tree: {
      before_sha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      after_sha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      changed: false,
      status: { ok: true, kind: "VALID" },
    },
    epochs_completed: 10,
    cases_completed: 10,
    semantic: {
      cases_observed: 10,
      drift_count: 0,
      cases_with_multiple_semantic_results: 0,
      lifecycle_drift_by_scenario: {},
      predecessor_dependency_count: 0,
      fault_count: 0,
      fault_escape_count: 0,
    },
    resources: {
      heap_slope_bytes_per_epoch: 0,
      owned_after_release: 0,
      owned_leaked_after_epoch: 0,
    },
    latency: {
      p50_ms: 1,
      p95_ms: 1,
      p99_ms: 1,
      max_ms: 1,
      window_size: 32,
      threshold_p99_ms: 1000,
      observed_drift_ms: 0,
    },
    repeatability: { semantic_repeatability: true },
    telemetry_path: null,
    telemetry_sha256: null,
    telemetry_bytes: null,
    telemetry_line_count: null,
    publication_durability: "CRASH_DURABLE" as const,
    verdict: "FAIL_RESOURCE_STABILITY" as const,
    failure: {
      kind: "RESOURCE_LEAK" as const,
      epoch: 0,
      last_completed_case: "x",
      minimal_diff: {},
      message: "x",
    },
  };
}
