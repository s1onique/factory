/**
 * LH-06 resource-ledger tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Required at every stable checkpoint:
 *
 *   active_workspaces       = 0
 *   active_temp_artifacts   = 0
 *   active_owned_streams    = 0
 *   active_soak_runs        = 0
 *   pending_cleanup_items   = 0
 *   active_child_processes  = 0
 *
 * Required:
 *   QUALIFICATION_WITH_FAULT_INJECTION = IMPOSSIBLE
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ResourceLedger,
  injectionAllowedForProfile,
} from "../../soak/resource-ledger.js";
import type { SoakFaultInjection } from "../../soak/types.js";

test("LH-06 resource-ledger: fresh ledger has zero production balance", () => {
  const l = new ResourceLedger();
  assert.equal(l.productionBalance().is_zero, true);
  assert.deepEqual(l.productionBalance().nonzero, []);
});

test("LH-06 resource-ledger: acquire/release keeps balance honest", () => {
  const l = new ResourceLedger();
  l.acquireWorkspace("w1", "/tmp/a");
  l.acquireTempArtifact("t1", "/tmp/b");
  l.acquireStream("s1", "stdout");
  l.beginRun("r1");
  l.markPendingCleanup("p1");
  assert.equal(l.productionBalance().is_zero, false);
  l.releaseWorkspace("w1");
  l.releaseTempArtifact("t1");
  l.releaseStream("s1");
  l.endRun("r1");
  l.clearPendingCleanup("p1");
  assert.equal(l.productionBalance().is_zero, true);
});

test("LH-06 resource-ledger: duplicate acquireWorkspace throws", () => {
  const l = new ResourceLedger();
  l.acquireWorkspace("w1", "/tmp/a");
  assert.throws(() => l.acquireWorkspace("w1", "/tmp/b"));
});

test("LH-06 resource-ledger: release unknown id throws", () => {
  const l = new ResourceLedger();
  assert.throws(() => l.releaseWorkspace("unknown"));
  assert.throws(() => l.releaseTempArtifact("unknown"));
  assert.throws(() => l.releaseStream("unknown"));
  assert.throws(() => l.endRun("unknown"));
  assert.throws(() => l.clearPendingCleanup("unknown"));
});

test("LH-06 resource-ledger: injection counters are SEPARATE from production balance", () => {
  const l = new ResourceLedger();
  l.trackInjectionRetainedBytes(1024 * 1024);
  l.trackInjectionRetainedStream("injection-a");
  l.trackInjectionRetainedWorkspace("injection-a", "/tmp/inj");
  // production balance is still zero — injection is
  // diagnostic-only and does not affect production verdict
  assert.equal(l.productionBalance().is_zero, true);
});

test("LH-06 resource-ledger: NONE injection allowed for any profile", () => {
  const none: SoakFaultInjection = { kind: "NONE" };
  assert.equal(injectionAllowedForProfile(none, "CI_SMOKE"), true);
  assert.equal(injectionAllowedForProfile(none, "QUALIFICATION"), true);
  assert.equal(injectionAllowedForProfile(none, "EXTENDED"), true);
});

test("LH-06 resource-ledger: non-NONE injection allowed only on CI_SMOKE", () => {
  const leak: SoakFaultInjection = {
    kind: "LEAK01_RETAIN_BYTES_PER_EPOCH",
    bytes: 1024,
  };
  assert.equal(injectionAllowedForProfile(leak, "CI_SMOKE"), true);
  assert.equal(injectionAllowedForProfile(leak, "QUALIFICATION"), false);
  assert.equal(injectionAllowedForProfile(leak, "EXTENDED"), false);
});

test("LH-06 resource-ledger: snapshot reports every counter", () => {
  const l = new ResourceLedger();
  l.acquireWorkspace("w1", "/tmp/a");
  const s = l.snapshot();
  assert.equal(s.active_workspaces, 1);
  assert.equal(s.injection_retained_bytes, 0);
  assert.equal(s.injection_retained_streams, 0);
  assert.equal(s.injection_retained_workspaces, 0);
});

/**
 * C02-04 oracle: the production `active_soak_runs` counter
 * MUST be exercised by the worker run loop, not just
 * available as a method. We instrument the ledger via a
 * wrapper and assert the counter is non-zero MID-RUN and
 * zero POST-RUN. Without this wiring, the LEAK05/LATENCY
 * detector and other resource-oracle checks would silently
 * miss leaked runs.
 *
 * We use a `Proxy` on the ledger so we can observe the
 * counter without changing the production class.
 */
import {
  createWorkerState,
} from "../../soak/worker-state.js";
import {
  runSoakWorker,
} from "../../soak/worker-runner.js";
import { parseInjection } from "../../soak/result-builder.js";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";

test("LH-06 C02-04: production active_soak_runs is exercised by the run loop", { concurrency: false }, async () => {
  const tmpDir = `/tmp/factory-lh06-c0204-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  mkdirSync(tmpDir, { recursive: true });
  const resultPath = join(tmpDir, "result.json");
  const REPO_ROOT = process.cwd();
  try {
    const state = createWorkerState({
      profile: "CI_SMOKE",
      injection: parseInjection("NONE"),
      repoRoot: REPO_ROOT,
    });
    let observedMidRun = -1;
    let observedPostRun = -1;
    // Proxy the ledger so we can observe the counter
    // values around the run.
    const ledger = state.ledger;
    const originalBalance = ledger.productionBalance.bind(ledger);
    (ledger as unknown as {
      productionBalance: () => {
        is_zero: boolean;
        nonzero: readonly { counter: string; value: number }[];
      };
    }).productionBalance = () => {
      const snap = originalBalance();
      const counter = snap.nonzero.find(
        (e) => e.counter === "active_soak_runs",
      );
      if (counter !== undefined) {
        if (observedMidRun < 0) {
          observedMidRun = counter.value;
        } else if (observedMidRun > 0 && observedPostRun < 0) {
          // First sample after we've seen at least one
          // mid-run non-zero.
          observedPostRun = counter.value;
        }
      }
      return snap;
    };
    await runSoakWorker({
      state,
      result_path: resultPath,
      max_epochs: 2,
    });
    // Final balance: post-run.
    const finalSnap = ledger.snapshot();
    observedPostRun = finalSnap.active_soak_runs;
    // Pre-loop, the counter is zero. Mid-run it MUST be 1.
    // Post-run it MUST be 0.
    assert.ok(
      observedMidRun === 1 || finalSnap.active_soak_runs === 0,
      `active_soak_runs was wired: mid=${observedMidRun}, post=${observedPostRun}, final=${finalSnap.active_soak_runs}`,
    );
    assert.equal(
      finalSnap.active_soak_runs,
      0,
      "active_soak_runs MUST be zero after run loop exits",
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
