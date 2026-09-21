/**
 * LH-06 supervisor failure-artifact durability tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * L06-CORRECTION10 L06-C41: `writeSupervisorResult` was
 * previously implemented as a divergent one-corrective-write
 * durability loop in the supervisor script. It now
 * delegates to the SAME `publishReconciledJson` primitive
 * the worker writer uses. These tests pin the supervisor
 * primitive to:
 *
 *   - a converging sequence (writes succeed normally,
 *     returns the final durability class)
 *
 *   - a non-converging adversarial sequence (every
 *     corrective publish observes the opposite class
 *     from the one it just wrote; the budget exhausts
 *     and the primitive throws
 *     `DurabilityReconciliationError`)
 *
 *   - the supervisor-schema invariant: a supervisor
 *     failure artifact uses `lh06.supervisor-terminal-result/v1`,
 *     never the worker schema.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writeSupervisorResult,
  __resetTestDurabilitySequence,
  DurabilityReconciliationError,
} from "../../soak/result-io.js";
import type { LH06FailureRecord } from "../../soak/result.js";

interface SupervisorArgs {
  path: string;
  profile: string;
  supervisor_run_id: string;
  worker_result_path: string | null;
  verdict: "FAIL_WORKER";
  failure: LH06FailureRecord;
  child_exit_code: number | null;
  child_exit_signal: NodeJS.Signals | null;
  supervisor_reason: string;
  started_at_ms: number;
  finished_at_ms: number;
  duration_ms: number;
}

function makeFakeSupervisorArgs(): SupervisorArgs {
  const dir = mkdtempSync(join(tmpdir(), "lh06-c41-"));
  return {
    path: join(dir, "sup.json"),
    profile: "CI_SMOKE",
    supervisor_run_id: "sup-c41-test",
    worker_result_path: null,
    verdict: "FAIL_WORKER",
    failure: {
      kind: "WORKER_CRASH",
      epoch: null,
      last_completed_case: null,
      minimal_diff: {},
      message: "test artifact",
    },
    child_exit_code: 137,
    child_exit_signal: null,
    supervisor_reason: "test_artifact",
    started_at_ms: 1_000_000,
    finished_at_ms: 1_000_001,
    duration_ms: 1,
  };
}

function cleanupDir(path: string): void {
  rmSync(join(path, ".."), { recursive: true, force: true });
}

test(
  "L06-C41: writeSupervisorResult on POSIX returns CRASH_DURABLE and writes the supervisor schema",
  () => {
    __resetTestDurabilitySequence();
    const args = makeFakeSupervisorArgs();
    try {
      // No durabilitySequence: exercise the real POSIX
      // publisher. On POSIX the dir-fsync succeeds so
      // the returned class is CRASH_DURABLE and the
      // canonical artifact exists on disk.
      const out = writeSupervisorResult(args);
      assert.equal(out.publication_durability, "CRASH_DURABLE");
      const onDisk = JSON.parse(readFileSync(out.path, "utf8")) as {
        publication_durability: string;
        schema: string;
        verdict: string;
      };
      assert.equal(onDisk.publication_durability, "CRASH_DURABLE");
      assert.equal(onDisk.schema, "lh06.supervisor-terminal-result/v1");
      assert.equal(onDisk.verdict, "FAIL_WORKER");
    } finally {
      cleanupDir(args.path);
    }
  },
);

test(
  "L06-C41: writeSupervisorResult with non-converging alternating sequence throws DurabilityReconciliationError",
  () => {
    __resetTestDurabilitySequence();
    const args = makeFakeSupervisorArgs();
    try {
      assert.throws(
        () =>
          writeSupervisorResult({
            ...args,
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
      cleanupDir(args.path);
    }
  },
);

test(
  "L06-C41: writeSupervisorResult emits the supervisor schema, not the worker schema",
  () => {
    __resetTestDurabilitySequence();
    const args = makeFakeSupervisorArgs();
    try {
      const out = writeSupervisorResult(args);
      const onDisk = JSON.parse(readFileSync(out.path, "utf8")) as {
        schema: string;
        verdict: string;
        supervisor_termination: { supervisor_reason: string };
        failure: { kind: string; message: string };
      };
      assert.equal(
        onDisk.schema,
        "lh06.supervisor-terminal-result/v1",
      );
      assert.equal(onDisk.verdict, "FAIL_WORKER");
      assert.equal(
        onDisk.supervisor_termination.supervisor_reason,
        "test_artifact",
      );
      assert.equal(onDisk.failure.kind, "WORKER_CRASH");
      assert.equal(onDisk.failure.message, "test artifact");
    } finally {
      cleanupDir(args.path);
    }
  },
);
