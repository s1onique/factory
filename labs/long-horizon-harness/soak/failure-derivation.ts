/**
 * LH-06 deterministic long-duration soak laboratory —
 * failure derivation helpers.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Split from `result-builder.ts` for source-size
 * discipline.
 *
 * L06-CORRECTION03 L06-C16: a frozen-tree integrity
 * digest that cannot be computed (missing / unreadable /
 * duplicate-identity / invalid declaration) is surfaced
 * as `FROZEN_MUTATION`. The integrity oracle is a
 * pass-gate; an undecidable result is treated as a
 * mutation, not as a benign absence.
 */
import type { SoakWorkerState } from "./worker-state.js";
import type {
  LH06FailureRecord,
  LH06FrozenTreeSection,
  LH06LatencySection,
  LH06ResourceSection,
  LH06SemanticSection,
  LH06SubstrateBinding,
} from "./result.js";

/**
 * L06-CORRECTION03 L06-C21: helper for the
 * INCONCLUSIVE_ENVIRONMENT message. Returns the list of
 * substrate field names that are null.
 */
export function listMissingSubstrate(
  b: LH06SubstrateBinding,
): readonly string[] {
  const out: string[] = [];
  if (b.phase_e_head === null) out.push("phase_e_head");
  if (b.lh02_head === null) out.push("lh02_head");
  if (b.lh03_frozen_commit === null) out.push("lh03_frozen_commit");
  if (b.lh04_frozen_commit === null) out.push("lh04_frozen_commit");
  if (b.lh05_corpus_commit === null) out.push("lh05_corpus_commit");
  if (b.repo_commit === null) out.push("repo_commit");
  return Object.freeze(out);
}

/**
 * Internal failure derivation. Surfaces the first
 * internal violation if no external failure was
 * supplied.
 *
 * Order of checks (most fundamental first):
 *
 *   1. Frozen-tree integrity (`status.ok` + content
 *      change) — L06-C16: any non-OK status surfaces
 *      FROZEN_MUTATION. An undecidable digest is treated
 *      as a mutation.
 *   2. Heap / latency / semantic / fault / lifecycle /
 *      predecessor dependencies.
 */
export function deriveInternalFailure(args: {
  readonly state: SoakWorkerState;
  readonly external: LH06FailureRecord | null;
  readonly semantic: LH06SemanticSection;
  readonly resources: LH06ResourceSection;
  readonly latency: LH06LatencySection;
  readonly frozenTree: LH06FrozenTreeSection;
}): LH06FailureRecord | null {
  if (args.external !== null) return args.external;
  const r = args.resources;
  const l = args.latency;
  const s = args.semantic;
  const f = args.frozenTree;
  // Frozen-tree integrity (L06-C16): the digest itself
  // could not be computed, OR the digest changed.
  if (!f.status.ok) {
    return {
      kind: "FROZEN_MUTATION",
      epoch: null,
      last_completed_case: args.state.last_completed_case,
      minimal_diff: { frozen_tree_status: f.status },
      message: `frozen tree integrity cannot be evaluated: ${f.status.kind} (${f.status.path})`,
    };
  }
  if (f.changed === true) {
    return {
      kind: "FROZEN_MUTATION",
      epoch: null,
      last_completed_case: args.state.last_completed_case,
      minimal_diff: f,
      message: "frozen tree changed during soak",
    };
  }
  if (r.heap_verdict !== null && !r.heap_verdict.pass) {
    // INSUFFICIENT_SAMPLES is informational — the run
    // was too short for the steady-state window to be
    // defined. Only surface as a hard failure when we
    // actually have data showing growth.
    if (r.heap_verdict.reason !== "INSUFFICIENT_SAMPLES") {
      return {
        kind: "MEMORY_GROWTH",
        epoch: null,
        last_completed_case: args.state.last_completed_case,
        minimal_diff: r.heap_verdict,
        message: `heap verdict: ${r.heap_verdict.reason}`,
      };
    }
  }
  if (l.verdict !== null && !l.verdict.pass) {
    // INSUFFICIENT_SAMPLES is informational.
    if (l.verdict.reason !== "INSUFFICIENT_SAMPLES") {
      return {
        kind: "LATENCY_DRIFT",
        epoch: null,
        last_completed_case: args.state.last_completed_case,
        minimal_diff: l.verdict,
        message: `latency verdict: ${l.verdict.reason}`,
      };
    }
  }
  if (s.drift_count > 0) {
    return {
      kind: "SEMANTIC_DRIFT",
      epoch: null,
      last_completed_case: args.state.last_completed_case,
      minimal_diff: { semantic_drift_count: s.drift_count },
      message: "semantic drift detected",
    };
  }
  if (s.fault_escape_count > 0) {
    return {
      kind: "FAULT_ESCAPE",
      epoch: null,
      last_completed_case: args.state.last_completed_case,
      minimal_diff: { fault_escape_count: s.fault_escape_count },
      message: "fault escape detected",
    };
  }
  if (s.lifecycle_drift_count > 0) {
    return {
      kind: "LIFECYCLE_DRIFT",
      epoch: null,
      last_completed_case: args.state.last_completed_case,
      minimal_diff: { lifecycle_drift_count: s.lifecycle_drift_count },
      message: "lifecycle drift detected",
    };
  }
  if (s.predecessor_dependency_count > 0) {
    return {
      kind: "SEMANTIC_DRIFT",
      epoch: null,
      last_completed_case: args.state.last_completed_case,
      minimal_diff: {
        predecessor_dependency_count: s.predecessor_dependency_count,
      },
      message: "predecessor-dependent semantics detected",
    };
  }
  return null;
}
