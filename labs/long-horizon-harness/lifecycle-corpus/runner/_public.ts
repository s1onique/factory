/**
 * LH-05 runner — public module (split for source-size discipline).
 *
 * L05-C08: parent runner.ts is the SINGLE logical authority.
 */
import type { HarnessKind, LifecycleReplayResult } from "../types.js";
import { LIFECYCLE_CORPUS_CATALOG, findScenario } from "../catalog.js";
import { runReplay } from "./_replay.js";

export async function runScenarioForHarness(args: {
  readonly repoRoot: string;
  readonly scenarioId: string;
  readonly harness: HarnessKind;
}): Promise<LifecycleReplayResult> {
  const scenario = findScenario(args.scenarioId);
  if (scenario === undefined) {
    throw new Error(`runScenarioForHarness: unknown scenario '${args.scenarioId}'`);
  }
  return runReplay({
    repoRoot: args.repoRoot,
    scenario,
    harness: args.harness,
  });
}

export async function runCorpus(args: {
  readonly repoRoot: string;
}): Promise<ReadonlyArray<LifecycleReplayResult>> {
  const out: LifecycleReplayResult[] = [];
  for (const scenario of LIFECYCLE_CORPUS_CATALOG) {
    if (scenario.eligible_harnesses.pi.eligible) {
      out.push(
        await runReplay({
          repoRoot: args.repoRoot,
          scenario,
          harness: "pi",
        }),
      );
    }
    if (scenario.eligible_harnesses.fake_reference_control.eligible) {
      out.push(
        await runReplay({
          repoRoot: args.repoRoot,
          scenario,
          harness: "fake",
        }),
      );
    }
  }
  return out;
}

/**
 * Strip fields that legitimately vary between runs (free-text
 * notes) and keep only the semantically meaningful fields.
 * Used for TWO_RUN_SEMANTIC_REPEATABILITY.
 */
export function semanticReplayShape(
  result: LifecycleReplayResult,
): Omit<LifecycleReplayResult, "notes"> {
  return {
    scenario_id: result.scenario_id,
    scenario_version: result.scenario_version,
    scenario_class: result.scenario_class,
    harness: result.harness,
    execution_mode: result.execution_mode,
    adapter_disposition: result.adapter_disposition,
    adapter_error_kind: result.adapter_error_kind,
    phase_e_lifecycle_state: result.phase_e_lifecycle_state,
    phase_e_terminal_outcome: result.phase_e_terminal_outcome,
    phase_e_predicates: result.phase_e_predicates,
    lh02_predicates: result.lh02_predicates,
    forbidden_outcomes: result.forbidden_outcomes,
    success_normalized_metrics_emitted: result.success_normalized_metrics_emitted,
    disposition: result.disposition,
  };
}
