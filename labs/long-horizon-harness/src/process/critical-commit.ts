/**
 * FOUNDATION03 — critical-commit policy helper (CORRECTION02 §1/§5).
 *
 * `commitCritical()` returns a `Promise<ProcessEvidenceCommitResult>`
 * where failures are REPORTED as a fulfilled `{ok:false,...}`,
 * not as Promise rejection. Promise rejection is reserved for
 * internal sink malfunction (write loop threw, etc.).
 *
 * `requireCriticalCommit()` centralises the policy so callers
 * never branch on the transport by mistake
 * (CORRECTION02 §1 OG01/OG02/OG03):
 *
 *   - fulfilled `{ok:true}`        -> ok(seq)
 *   - fulfilled `{ok:false,...}`   -> persistence_failure(commit_failed)
 *   - Promise rejection            -> persistence_failure(internal_malfunction)
 *
 * Used by both the spawn-resolution ownership gate
 * (`process_spawned`) and the final-result settlement gate
 * (`process_result_committed`).
 */

import type { ProcessEvidenceCommitResult } from "./process-evidence-sink.js";

export type CriticalCommitOutcome =
  | { readonly kind: "ok"; readonly seq: number }
  | {
      readonly kind: "persistence_failure";
      readonly stage: "commit_failed";
      readonly message: string;
    }
  | {
      readonly kind: "persistence_failure";
      readonly stage: "internal_malfunction";
      readonly message: string;
    };

export async function requireCriticalCommit(
  p: Promise<ProcessEvidenceCommitResult>,
): Promise<CriticalCommitOutcome> {
  try {
    const r = await p;
    if (r.ok) {
      return { kind: "ok", seq: r.seq };
    }
    const e = r.error;
    const message =
      e.kind === "invalid_evidence"
        ? `invalid_evidence: ${e.reason}`
        : `${e.kind}: ${e.message}`;
    return {
      kind: "persistence_failure",
      stage: "commit_failed",
      message,
    };
  } catch (e: unknown) {
    return {
      kind: "persistence_failure",
      stage: "internal_malfunction",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
