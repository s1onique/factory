/**
 * LH-06 commit-witness publisher.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * L06-CORRECTION07 L06-C35: the canonical result file
 * alone is NEVER sufficient for LH-06 closure. A
 * separate `*.commit.json` witness is the closure
 * authority.
 *
 * The publish sequence is:
 *
 *   1. Compute SHA-256 over the result bytes.
 *   2. Atomically publish the witness to
 *      `<result-path>.commit.json` through the SAME
 *      crash-durable write (temp-write + fsync +
 *      rename + parent-dir fsync) that the result was
 *      published with.
 *   3. Return the durability class of the witness
 *      publish. PASS closure requires CRASH_DURABLE.
 *
 * The witness binds to:
 *
 *   result_sha256       — sha256(result bytes)
 *   result_path         — the canonical result path
 *   supervisor_run_id   — the supervisor's generation
 *   run_id              — the worker's run-id
 *   profile             — CI_SMOKE / QUALIFICATION / EXTENDED
 *   schema              — literal lh06.commit-witness/v1
 *   durability          — CRASH_DURABLE (or ATOMIC_ONLY)
 *   captured_at_ms      — monotonic timestamp
 *   verdict             — the result's verdict
 *
 * The witness is NOT self-certifying: it is committed
 * BEFORE the closure read is attempted. If the machine
 * crashes before the witness publish, the result file
 * still exists on disk but the absence of the witness
 * prevents it from being treated as PASS closure.
 *
 * The verifier computes sha256(canonical bytes) and
 * compares to `witness.result_sha256` — there is no
 * way the witness could be tampered to bind to a
 * different result.
 */

import { createHash } from "node:crypto";
import { publishAtomicDurableBytes, DurabilityReconciliationError } from "./result-io.js";

export const LH06_COMMIT_WITNESS_SCHEMA = "lh06.commit-witness/v1" as const;

export interface LH06CommitWitness {
  readonly schema: typeof LH06_COMMIT_WITNESS_SCHEMA;
  readonly result_path: string;
  readonly result_sha256: string;
  readonly supervisor_run_id: string;
  readonly run_id: string;
  readonly profile: "CI_SMOKE" | "QUALIFICATION" | "EXTENDED";
  readonly verdict:
    | "PASS_DETERMINISTIC_SOAK"
    | "FAIL_SEMANTIC_DRIFT"
    | "FAIL_RESOURCE_STABILITY"
    | "FAIL_LATENCY_STABILITY"
    | "FAIL_CLEANUP"
    | "FAIL_FROZEN_INTEGRITY"
    | "FAIL_WORKER"
    | "QUALIFICATION_INCOMPLETE"
    | "INCONCLUSIVE_ENVIRONMENT";
  readonly durability: "CRASH_DURABLE" | "ATOMIC_ONLY";
  readonly captured_at_ms: number;
}

/**
 * Publish a commit witness for the given canonical
 * result.
 *
 * Returns the witness and its durability class. PASS
 * closure requires `durability === "CRASH_DURABLE"` —
 * the supervisor must treat ATOMIC_ONLY as a refusal
 * to qualify, not as a soft warning.
 */
export function publishCommitWitness(args: {
  readonly result_path: string;
  readonly result_bytes: Uint8Array;
  readonly supervisor_run_id: string;
  readonly run_id: string;
  readonly profile: "CI_SMOKE" | "QUALIFICATION" | "EXTENDED";
  readonly verdict: LH06CommitWitness["verdict"];
  /** TEST-ONLY: deterministic durability sequence. */
  readonly durabilitySequence?: ReadonlyArray<
    "CRASH_DURABLE" | "ATOMIC_ONLY"
  >;
}): {
  readonly witness_path: string;
  readonly witness: LH06CommitWitness;
  readonly durability: "CRASH_DURABLE" | "ATOMIC_ONLY";
} {
  const result_sha256 = createHash("sha256")
    .update(args.result_bytes)
    .digest("hex");
  let witness: LH06CommitWitness = {
    schema: LH06_COMMIT_WITNESS_SCHEMA,
    result_path: args.result_path,
    result_sha256,
    supervisor_run_id: args.supervisor_run_id,
    run_id: args.run_id,
    profile: args.profile,
    verdict: args.verdict,
    durability: "CRASH_DURABLE",
    captured_at_ms: Date.now(),
  };
  const witness_path = `${args.result_path}.commit.json`;
  // L06-CORRECTION08 L06-C37 / L06-CORRECTION09 L06-C40:
  // bounded reconciliation loop. Every publish CAPTURES
  // its returned durability class. The loop continues
  // until `recorded_class == last_observed_class` (the
  // bytes that just hit disk have the class that the
  // publication actually achieved) OR the retry budget
  // is exhausted.
  //
  // L06-C40 (CORRECTION09): on budget exhaustion we
  // fail-closed with `DURABILITY_RECONCILIATION_FAILED`
  // instead of fabricating agreement. The CORRECTION08
  // implementation returned an in-memory witness
  // rewritten to `observed` even when the on-disk JSON
  // still claimed the previous observation's class,
  // because the loop sets the JSON field to the
  // previous observation, then obtains a NEW observation
  // from that publication.
  //
  // The invariant we now enforce:
  //   the LAST publication's bytes claim the LAST
  //   publication's observed class.
  // On exhaustion, no such equality was obtained, so
  // we return a typed failure rather than a forged
  // agreement.
  const MAX_RECONCILE_ATTEMPTS = 4;
  let observed: "CRASH_DURABLE" | "ATOMIC_ONLY" = publishAtomicDurableBytes(
    witness_path,
    JSON.stringify(witness, null, 2) + "\n",
    args.durabilitySequence,
  );
  let attempts = 0;
  // `last_written_class` tracks what the on-disk JSON
  // currently claims. After the initial publish it
  // equals `witness.durability` (CRASH_DURABLE).
  let last_written_class: "CRASH_DURABLE" | "ATOMIC_ONLY" =
    witness.durability;
  while (last_written_class !== observed && attempts < MAX_RECONCILE_ATTEMPTS) {
    witness = {
      ...witness,
      durability: observed,
    };
    last_written_class = observed;
    observed = publishAtomicDurableBytes(
      witness_path,
      JSON.stringify(witness, null, 2) + "\n",
      args.durabilitySequence,
    );
    attempts++;
  }
  // L06-C40: if we still disagree on disk vs. observed,
  // the publisher is non-converging beyond our retry
  // budget. Fail-closed with a typed reason; never
  // return a witness whose on-disk JSON disagrees with
  // its claimed `durability`.
  if (last_written_class !== observed) {
    throw new DurabilityReconciliationError(
      `commit-witness: durability reconciliation failed after ${String(attempts)} attempts; ` +
        `last_written_class=${last_written_class} observed=${observed}; ` +
        `refusing to fabricate agreement`,
    );
  }
  return {
    witness_path,
    witness: {
      ...witness,
      durability: observed,
    },
    durability: observed,
  };
}

/**
 * Witness reason vocabulary for the closure gate.
 * Mirrors the verifier's reason union for the
 * witness-specific failure modes (the general
 * verifier reasons live in `verifier-helpers.ts`).
 */
export type WitnessReason =
  | "BAD_COMMIT_WITNESS_SCHEMA"
  | "COMMIT_WITNESS_RESULT_PATH_MISMATCH"
  | "COMMIT_WITNESS_SHA_MISMATCH"
  | "COMMIT_WITNESS_SUPERVISOR_RUN_ID_MISMATCH"
  | "COMMIT_WITNESS_RUN_ID_MISMATCH"
  | "COMMIT_WITNESS_NOT_CRASH_DURABLE";

export interface WitnessCheckOk {
  readonly ok: true;
}
export interface WitnessCheckFail {
  readonly ok: false;
  readonly reason: WitnessReason;
  readonly detail: string;
}

/**
 * L06-CORRECTION07 L06-C35: closure gate.
 *
 * Returns `{ok:true}` ONLY when every binding
 * invariant holds simultaneously:
 *
 *   - schema literal match
 *   - durability === "CRASH_DURABLE"
 *   - result_sha256 matches sha256(result bytes)
 *   - supervisor_run_id matches the verifier's
 *     expected id
 *   - run_id matches the worker's run-id from
 *     `result.environment_identity.soak_run_id`
 *   - result_path matches the path the verifier
 *     was asked to bind (L06-C38 — closes the
 *     "looks authoritative but isn't checked"
 *     gap noted in CORRECTION07 review)
 *
 * Any single failure is sufficient to refuse PASS
 * closure.
 */
export function checkCommitWitness(args: {
  readonly result_bytes: Uint8Array;
  readonly commit_witness_raw: unknown;
  readonly expected_supervisor_run_id: string;
  readonly result_run_id: string | undefined;
  readonly expected_result_path: string;
}): WitnessCheckOk | WitnessCheckFail {
  const w = args.commit_witness_raw as Record<string, unknown>;
  if (
    typeof w !== "object" ||
    w === null ||
    w["schema"] !== LH06_COMMIT_WITNESS_SCHEMA
  ) {
    return {
      ok: false,
      reason: "BAD_COMMIT_WITNESS_SCHEMA",
      detail: `commit witness must be ${LH06_COMMIT_WITNESS_SCHEMA}, got ${String(w["schema"])}`,
    };
  }
  const rpath = w["result_path"];
  if (rpath !== args.expected_result_path) {
    return {
      ok: false,
      reason: "COMMIT_WITNESS_RESULT_PATH_MISMATCH",
      detail:
        `commit witness result_path=${String(rpath)} does not match expected ${args.expected_result_path}; ` +
        `a witness must bind to the exact canonical artifact the verifier is closing (L06-C38)`,
    };
  }
  const dur = w["durability"];
  if (dur !== "CRASH_DURABLE") {
    return {
      ok: false,
      reason: "COMMIT_WITNESS_NOT_CRASH_DURABLE",
      detail:
        `commit witness durability must be "CRASH_DURABLE", got ${JSON.stringify(dur)}; ` +
        `a power loss between the rename and the directory fsync would otherwise ` +
        `silently lose the witness, leaving a dangling PASS JSON to qualify (L06-C35)`,
    };
  }
  const sha = w["result_sha256"];
  if (typeof sha !== "string") {
    return {
      ok: false,
      reason: "COMMIT_WITNESS_SHA_MISMATCH",
      detail:
        `commit witness result_sha256 missing or not a string: ${String(sha)}`,
    };
  }
  const computed = createHash("sha256")
    .update(args.result_bytes)
    .digest("hex");
  if (sha !== computed) {
    return {
      ok: false,
      reason: "COMMIT_WITNESS_SHA_MISMATCH",
      detail:
        `commit witness result_sha256=${sha} does not match sha256(canonical result bytes)=${computed}; ` +
        `the witness does not bind to the artifact it claims to bind (L06-C35)`,
    };
  }
  const supId = w["supervisor_run_id"];
  if (supId !== args.expected_supervisor_run_id) {
    return {
      ok: false,
      reason: "COMMIT_WITNESS_SUPERVISOR_RUN_ID_MISMATCH",
      detail:
        `commit witness supervisor_run_id=${String(supId)} does not match expected ${args.expected_supervisor_run_id}; ` +
        `a witness from a stale generation cannot qualify a new run (L06-C35)`,
    };
  }
  const runId = w["run_id"];
  if (runId !== args.result_run_id) {
    return {
      ok: false,
      reason: "COMMIT_WITNESS_RUN_ID_MISMATCH",
      detail:
        `commit witness run_id=${String(runId)} does not match result.environment_identity.soak_run_id=${String(args.result_run_id)}; ` +
        `the witness does not bind to the artifact's worker run (L06-C35)`,
    };
  }
  return { ok: true };
}

/**
 * L06-CORRECTION09 L06-C40: typed error for the case where
 * the bounded reconciliation loop exhausts its retry budget
 * without ever observing agreement between the on-disk
 * witness JSON and the FINAL publication's durability
 * class. The CORRECTION08 implementation silently rewrote
 * the returned witness to the last observation while the
 * on-disk JSON still claimed the previous observation's
 * class — i.e., it fabricated agreement. This typed error
 * makes the failure observable to the supervisor and the
 * test harness. (Defined in `./result-io.ts`; re-exported
 * from this module for ergonomic imports.)
 */
export { DurabilityReconciliationError } from "./result-io.js";
