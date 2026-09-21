/**
 * LH-06 deterministic long-duration soak laboratory —
 * per-case runners (LH-05 lifecycle + LH-04 fault).
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Each runner returns a canonical semantic digest after
 * stripping volatile fields (timestamps, paths, PIDs,
 * free-text notes).
 */
import { findScenario } from "../lifecycle-corpus/catalog.js";
import { findFault } from "../fault-lab/deterministic/fault-catalog.js";
import { runFaultExperiment } from "../fault-lab/deterministic/runner.js";
import { runScenarioForHarness, semanticReplayShape } from "../lifecycle-corpus/runner.js";
import { semanticDigest, stripVolatile } from "./semantic-ledger.js";
import { withCanonicalTempRoot } from "./canonical-temp-root.js";
import type { SoakWorkerState } from "./worker-state.js";

/**
 * Run a single LH-05 lifecycle scenario. Returns the
 * canonical semantic digest (volatile fields stripped).
 *
 * L06-CORRECTION11 L06-C45: every LH-05 invocation is
 * wrapped in `withCanonicalTempRoot` so the LH-04 frozen
 * bridge receives a workspace whose `realpath` equals
 * its literal path (no `/private` vs `/var` mismatch).
 * The wrapper is process-scope-scoped: it sets TMPDIR for
 * the duration of one bridge call and restores it in a
 * `finally`. The next scenario sees the original TMPDIR.
 */
export async function runLh05Case(
  state: SoakWorkerState,
  caseId: string,
  epochIndex: number,
  predecessor: string | null,
): Promise<{ readonly digest: string; readonly disposition: string }> {
  const scenario = findScenario(caseId);
  if (scenario === undefined) {
    throw new Error(`runLh05Case: unknown scenario ${caseId}`);
  }
  const elig = scenario.eligible_harnesses;
  const harness: "pi" | "cline" | "fake" =
    elig.pi.eligible
      ? "pi"
      : elig.fake_reference_control.eligible
        ? "fake"
        : "cline";
  // Canonical-temp-root wrapper. The wrapper produces a
  // workspace root whose canonical form equals its raw
  // form (no `/private` prefix on macOS), so the LH-04
  // verifier's `realpath` containment check operates on a
  // canonical pair. The wrapper restores TMPDIR on every
  // exit path so later experiments are unaffected.
  const result = await withCanonicalTempRoot({
    prefix: `lh06-${caseId}-`,
    invoke: async (_canonicalRoot: string) => {
      // The actual mkdtempSync inside `runLh04Handoff`
      // reads `process.env["FACTORY_LH05_WORKSPACE_BASE"]`
      // (preferred) or falls back to `tmpdir()` (which
      // honors TMPDIR). We do NOT redirect TMPDIR at the
      // process level here — instead, the wrapper pre
      // canonicalizes the parent dir so any mkdtempSync
      // child returns a path that is already canonical.
      return runScenarioForHarness({
        repoRoot: state.repoRoot,
        scenarioId: caseId,
        harness,
      });
    },
  });
  const shape = stripVolatile(semanticReplayShape(result));
  const digest = semanticDigest(shape);
  state.semanticLedger.recordObservation({
    case_id: caseId,
    source: "LH05",
    epoch_index: epochIndex,
    predecessor,
    digest,
  });
  state.lh05_replays += 1;
  state.cases_completed += 1;
  state.last_completed_case = caseId;
  if (result.disposition !== "PASS") {
    state.lifecycle_drift_count += 1;
    // L06-CORRECTION11 C47: per-scenario attribution.
    // The map is bounded to LC01..LC12; mutation here
    // re-builds a fresh object so we never need to mutate
    // the frozen initial empty-record.
    state.lifecycle_drift_by_scenario = {
      ...state.lifecycle_drift_by_scenario,
      [caseId]: (state.lifecycle_drift_by_scenario[caseId] ?? 0) + 1,
    };
  }
  return { digest, disposition: result.disposition };
}

/**
 * Run a single LH-04 fault experiment.
 */
export async function runLh04Case(
  state: SoakWorkerState,
  caseId: string,
  epochIndex: number,
  predecessor: string | null,
): Promise<{ readonly digest: string; readonly disposition: string }> {
  const fault = findFault(caseId);
  if (fault === undefined) {
    throw new Error(`runLh04Case: unknown fault ${caseId}`);
  }
  const result = await runFaultExperiment({
    repoRoot: state.repoRoot,
    experiment: fault,
  });
  const shape = {
    id: result.id,
    expected_authority: result.expected_authority,
    expected_error_kind: result.expected_error_kind,
    classified_authority: result.classified_authority,
    classified_authority_method: result.classified_authority_method,
    observed_error_kind: result.observed_error_kind,
    disposition: result.disposition,
    baseline_passed: result.baseline_passed,
  };
  const digest = semanticDigest(shape);
  state.semanticLedger.recordObservation({
    case_id: caseId,
    source: "LH04",
    epoch_index: epochIndex,
    predecessor,
    digest,
  });
  state.lh04_executions += 1;
  state.cases_completed += 1;
  state.last_completed_case = caseId;
  if (result.disposition === "ESCAPED") {
    state.fault_escape_count += 1;
  }
  if (
    result.observed_error_kind !== "VERIFIER_OK" &&
    result.observed_error_kind !== "VERIFIER_PARSED_NULL" &&
    result.observed_error_kind !== result.expected_error_kind
  ) {
    state.fault_wrong_kind_count += 1;
  }
  if (
    result.classified_authority !== "verifier_ok" &&
    result.classified_authority !== result.expected_authority
  ) {
    state.fault_wrong_authority_count += 1;
  }
  return { digest, disposition: result.disposition };
}

export async function runCanaryBefore(
  state: SoakWorkerState,
  epochIndex: number,
): Promise<{ readonly digest: string }> {
  const shape = await runLh05Case(state, "LC01", epochIndex, null);
  state.semanticLedger.recordObservation({
    case_id: "CANARY_LC01",
    source: "CANARY",
    epoch_index: epochIndex,
    predecessor: "EPOCH_START",
    digest: shape.digest,
  });
  return { digest: shape.digest };
}

export async function runCanaryAfter(
  state: SoakWorkerState,
  epochIndex: number,
): Promise<{ readonly digest: string }> {
  const shape = await runLh05Case(state, "LC01", epochIndex, "EPOCH_END_PRELUDE");
  state.semanticLedger.recordObservation({
    case_id: "CANARY_LC01",
    source: "CANARY",
    epoch_index: epochIndex,
    predecessor: "EPOCH_END",
    digest: shape.digest,
  });
  return { digest: shape.digest };
}
