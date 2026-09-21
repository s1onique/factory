/**
 * LH-06 deterministic long-duration soak laboratory —
 * closed-world worker-result verifier.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * L06-CORRECTION03 L06-C20: this module is the SINGLE
 * authority for "is this worker result trustworthy enough
 * to be promoted to the canonical result path?" Both the
 * supervisor and the test harness call
 * `verifyWorkerResult(...)` — they do NOT inspect the
 * result fields individually. Promotion is gated on
 * `ok=true`.
 *
 * The verifier checks (in order):
 *
 *   1. Schema literal match.
 *   2. Contract version match.
 *   3. Profile is a closed-union member.
 *   4. `supervisor_run_id` matches the caller's generation.
 *   5. Every required field is present with the right type.
 *   6. `substrate_complete === true` (L06-C21).
 *   7. Frozen-tree status is `{ok:true}` (L06-C16).
 *   8. Telemetry file exists AND SHA-256 matches
 *      `telemetry_sha256` (L06-C17).
 *   9. Recorded `telemetry_bytes` / `telemetry_line_count`
 *      match the on-disk file (L06-CORRECTION05 L06-C29).
 *  10. `duration_ms` is finite / non-negative.
 *  11. `epochs_completed` is finite / non-negative.
 *  12. Verdict-aware profile minimums (L06-CORRECTION06 L06-C32):
 *        PASS_DETERMINISTIC_SOAK:
 *          duration and epochs MUST satisfy profile minima
 *        QUALIFICATION_INCOMPLETE:
 *          at least one minimum MUST be unsatisfied
 *        FAIL_* / INCONCLUSIVE_*:
 *          minima are NOT required; truthful negative
 *          evidence (e.g. a real memory-growth failure
 *          observed at epoch 137 of a QUALIFICATION run)
 *          is preserved as the worker's terminal record.
 *  13. Verdict / failure / publication_durability fields are
 *      mutually consistent (L06-CORRECTION06 L06-C33).
 *  14. PASS_DETERMINISTIC_SOAK requires `publication_durability
 *      === "CRASH_DURABLE"` (the canonical qualification
 *      artifact must be crash-durable to count as closure
 *      evidence).
 *  15. L06-CORRECTION07 L06-C34: the verifier derives the
 *      expected verdict from `failure.kind` and refuses any
 *      record whose worker-claimed verdict does not match
 *      the derived verdict. Cross-category forgeries
 *      (`MEMORY_GROWTH` failure presented with a
 *      `FAIL_FROZEN_INTEGRITY` verdict) are rejected.
 *  16. L06-CORRECTION07 L06-C35: PASS_DETERMINISTIC_SOAK
 *      closure requires a separate `*.commit.json` witness
 *      whose `result_sha256` matches the canonical result
 *      bytes, whose `supervisor_run_id` matches the
 *      run-id of the supervisor promoting the result, and
 *      whose `durability === "CRASH_DURABLE"`. The result
 *      file alone is NEVER sufficient — the witness is the
 *      closure authority.
 *
 * L06-CORRECTION05 L06-C28: the verifier RE-COMPUTES the
 * profile contract from `LH06_PROFILES[profile]` exactly
 * as `buildResult()` does.
 *
 * L06-CORRECTION06 L06-C32: the producer's verdict
 * logic is failure-priority — a real `failure` takes
 * precedence over contract minima. The verifier
 * mirrors that priority so it does not silently destroy
 * valid FAIL_* terminal records. RESULT_VALIDITY !=
 * QUALIFICATION_SUCCESS.
 *
 * On ANY failure, the verifier returns
 * `{ok:false, reason}` and the supervisor / test harness
 * refuses to promote / trust the result.
 */
import type { LH06Result } from "./result.js";
import type { LH06Verdict } from "./types.js";
import { checkCommitWitness } from "./commit-witness.js";
import { checkResultShape } from "./result-shape.js";
import {
  checkProfileMinima,
  checkPublicationDurability,
  checkVerdictMatchesFailure,
} from "./verifier-helpers.js";

export interface WorkerResultVerifyOk {
  readonly ok: true;
  readonly result: LH06Result;
}

export interface WorkerResultVerifyFail {
  readonly ok: false;
  readonly reason:
    | "BAD_SCHEMA"
    | "BAD_CONTRACT_VERSION"
    | "BAD_PROFILE"
    | "SUPERVISOR_RUN_ID_MISMATCH"
    | "MISSING_REQUIRED_FIELD"
    | "INCONSISTENT_VERDICT"
    | "INCOMPLETE_SUBSTRATE"
    | "INVALID_FROZEN_TREE_STATUS"
    | "TELEMETRY_MISSING"
    | "TELEMETRY_HASH_DRIFT"
    | "TELEMETRY_BYTES_DRIFT"
    | "TELEMETRY_LINE_COUNT_DRIFT"
    | "MALFORMED_DURATION"
    | "MALFORMED_EPOCH_COUNTER"
    | "INSUFFICIENT_DURATION"
    | "INSUFFICIENT_EPOCHS"
    | "INCOMPLETE_COMMIT"
    | "BAD_COMMIT_WITNESS_SCHEMA"
    | "COMMIT_WITNESS_RESULT_PATH_MISMATCH"
    | "COMMIT_WITNESS_SHA_MISMATCH"
    | "COMMIT_WITNESS_SUPERVISOR_RUN_ID_MISMATCH"
    | "COMMIT_WITNESS_RUN_ID_MISMATCH"
    | "COMMIT_WITNESS_NOT_CRASH_DURABLE";
  readonly detail: string;
}

export type WorkerResultVerifyResult =
  | WorkerResultVerifyOk
  | WorkerResultVerifyFail;

/**
 * Decode and verify a worker result. The verifier is the
 * single authority for promotion; the caller does NOT
 * inspect fields directly.
 *
 * L06-CORRECTION07 L06-C35: optional `result_bytes` and
 * `commit_witness_raw`. The witness gate is ONLY
 * enforced when BOTH are supplied to the verifier. This
 * matches the supervisor's two-phase flow:
 *
 *   phase 1 (verify worker per-run artifact):
 *     - no `result_bytes`, no `commit_witness_raw`
 *     - verifier checks everything except the witness
 *     - PASS verdict is accepted at this stage;
 *       witness publication is the supervisor's job
 *
 *   phase 2 (verify canonical artifact post-witness):
 *     - `result_bytes` = canonical bytes
 *     - `commit_witness_raw` = published witness JSON
 *     - verifier recomputes SHA(canonical bytes) and
 *       checks the witness binds correctly
 *
 * If `result_bytes` is supplied WITHOUT a witness,
 * the verifier still rejects PASS_DETERMINISTIC_SOAK
 * with INCOMPLETE_COMMIT — supplying raw bytes
 * signals the caller is at the closure phase.
 *
 * L06-CORRECTION08 L06-C36: explicit `mode` argument.
 * The single source of truth for which phase the
 * verifier is in. PROMOTION = worker per-run artifact
 * (witness MUST NOT be supplied; supplying either
 * bytes or witness in PROMOTION is an
 * INCOMPLETE_COMMIT-style protocol error).
 * CLOSURE = canonical artifact post-witness (bytes
 * and witness MUST be supplied together; supplying
 * only one is INCOMPLETE_COMMIT). This removes the
 * inference from optional arguments that let
 * `bytes-supplied-without-witness` bypass the closure
 * gate in CORRECTION07.
 */
export type VerifyWorkerResultMode = "PROMOTION" | "CLOSURE";

export function verifyWorkerResult(args: {
  readonly raw: unknown;
  readonly expected_supervisor_run_id: string;
  readonly mode: VerifyWorkerResultMode;
  readonly result_path: string;
  readonly result_bytes?: Uint8Array;
  readonly commit_witness_raw?: unknown;
}): WorkerResultVerifyResult {
  // L06-CORRECTION07 source-size discipline: the
  // structural shape checks (schema, contract_version,
  // profile, supervisor_run_id, required fields,
  // substrate completeness, frozen-tree status,
  // telemetry binding + bytes/line_count cross-check,
  // duration / epoch sanity) are delegated to
  // `checkResultShape` in `./result-shape.js`. This
  // keeps the verdict-semantics portion of the verifier
  // (verdict / failure consistency, profile minimums,
  // verdict derivation, witness gate) under the 400 LOC
  // ceiling (HYGIENE01).
  const shape = checkResultShape({
    raw: args.raw,
    expected_supervisor_run_id: args.expected_supervisor_run_id,
  });
  if (!shape.ok) {
    return fail(shape.reason, shape.detail);
  }
  const dur = shape.duration_ms;
  const epochs = shape.epochs_completed;
  const r = args.raw as Record<string, unknown>;
  const profile = r["profile"] as
    | "CI_SMOKE"
    | "QUALIFICATION"
    | "EXTENDED";

  // verdict / failure consistency.
  //
  // L06-CORRECTION06 L06-C32: read the verdict first so the
  // profile-minimum check can branch on it (the producer's
  // `buildResult` is failure-priority — a real failure
  // takes precedence over contract minima, and the
  // verifier mirrors that priority so a legitimate early
  // FAIL_* terminal record is not silently destroyed by a
  // verdict-agnostic duration/epoch gate).
  const verdict = r["verdict"];
  const failure = r["failure"];
  if (
    verdict === "PASS_DETERMINISTIC_SOAK" &&
    failure !== null
  ) {
    return fail(
      "INCONSISTENT_VERDICT",
      "verdict PASS but failure record present",
    );
  }
  if (
    verdict !== "PASS_DETERMINISTIC_SOAK" &&
    failure === null
  ) {
    return fail(
      "INCONSISTENT_VERDICT",
      `non-PASS verdict ${String(verdict)} but no failure record`,
    );
  }
  // L06-CORRECTION07 L06-C34: derive the expected verdict
  // from failure.kind and reject any worker-claimed
  // verdict that disagrees. The verifier does NOT trust
  // the verdict string independently of the failure
  // record. Cross-category forgery (e.g.
  // MEMORY_GROWTH failure presented with a
  // FAIL_FROZEN_INTEGRITY verdict) is rejected here.
  if (failure !== null) {
    const derived = checkVerdictMatchesFailure({
      verdict: verdict as LH06Verdict,
      failure: failure as Parameters<
        typeof checkVerdictMatchesFailure
      >[0]["failure"],
    });
    if (!derived.ok) {
      return fail(derived.reason, derived.detail);
    }
  }
  // Verdict-aware profile-minimum verification (L06-C32).
  // The helper mirrors the producer's failure-priority
  // logic so a legitimate early FAIL_* terminal record is
  // not destroyed by a verdict-agnostic duration/epoch
  // gate.
  const minima = checkProfileMinima({
    profile,
    verdict,
    duration_ms: dur,
    epochs_completed: epochs,
  });
  if (!minima.ok) {
    return fail(minima.reason, minima.detail);
  }
  // Publication durability (L06-C33). PASS verdict
  // requires CRASH_DURABLE.
  const pd = checkPublicationDurability({
    verdict,
    publication_durability: r["publication_durability"],
  });
  if (!pd.ok) {
    return fail(pd.reason, pd.detail);
  }
  // L06-CORRECTION07 L06-C35 / L06-CORRECTION08 L06-C36 /
  // L06-CORRECTION09 L06-C39: explicit closure-phase
  // completeness gate. The single source of truth is the
  // `mode` argument.
  //
  // PROMOTION mode: witness MUST NOT be supplied.
  //   - result_bytes absent AND commit_witness_raw absent
  //     -> OK; the supervisor will publish the witness
  //        and call the verifier again in CLOSURE mode.
  //   - result_bytes present OR commit_witness_raw present
  //     -> INCOMPLETE_COMMIT (protocol violation).
  //
  // CLOSURE mode:
  //   - PASS_DETERMINISTIC_SOAK requires BOTH result_bytes
  //     and commit_witness_raw. Empty closure on a PASS
  //     is INCOMPLETE_COMMIT (L06-C39 — closes the
  //     CORRECTION08 fail-open path where
  //     hasBytes=false, hasWitness=false was silently
  //     accepted because hasBytes!==hasWitness was false).
  //   - Non-PASS verdicts: bytes AND witness must be
  //     supplied together when BOTH are present.
  //     `bytes XOR witness` is a protocol violation
  //     regardless of verdict; `bytes=0 witness=0` is
  //     allowed for non-PASS because the supervisor
  //     records the negative evidence directly.
  //
  // The previous CORRECTION08 implementation let
  // `CLOSURE + PASS + no bytes + no witness` bypass
  // the witness gate because hasBytes!==hasWitness was
  // false. L06-C39 adds the PASS-required predicate
  // that closes that path.
  const hasBytes = args.result_bytes !== undefined;
  const hasWitness = args.commit_witness_raw !== undefined;
  if (args.mode === "PROMOTION") {
    if (hasBytes || hasWitness) {
      return fail(
        "INCOMPLETE_COMMIT",
        "PROMOTION mode forbids result_bytes/commit_witness_raw; " +
          "witness publication is the supervisor's job and is checked in CLOSURE mode",
      );
    }
  } else {
    // CLOSURE mode.
    if (verdict === "PASS_DETERMINISTIC_SOAK") {
      // L06-C39: PASS closure requires the full commit pair.
      if (!hasBytes || !hasWitness) {
        return fail(
          "INCOMPLETE_COMMIT",
          "CLOSURE mode with PASS_DETERMINISTIC_SOAK requires BOTH " +
            "result_bytes and commit_witness_raw; " +
            `received hasBytes=${String(hasBytes)} hasWitness=${String(hasWitness)}`,
        );
      }
    } else {
      // Non-PASS: bytes XOR witness is still a protocol violation.
      if (hasBytes !== hasWitness) {
        return fail(
          "INCOMPLETE_COMMIT",
          "CLOSURE mode requires result_bytes and commit_witness_raw together; " +
            `received hasBytes=${String(hasBytes)} hasWitness=${String(hasWitness)}`,
        );
      }
    }
    if (hasBytes && hasWitness) {
      const witnessCheck = checkCommitWitness({
        result_bytes: args.result_bytes as Uint8Array,
        commit_witness_raw: args.commit_witness_raw,
        expected_supervisor_run_id: args.expected_supervisor_run_id,
        result_run_id: extractRunIdFromResult(r),
        expected_result_path: args.result_path,
      });
      if (!witnessCheck.ok) {
        return fail(witnessCheck.reason, witnessCheck.detail);
      }
    }
  }
  // The result is trustworthy.
  return { ok: true, result: r as unknown as LH06Result };
}

/**
 * Extract the worker run-id from the result's
 * environment identity. The witness binds to this
 * id so a witness for one worker run cannot serve
 * as closure evidence for a different worker run.
 */
function extractRunIdFromResult(
  r: Record<string, unknown>,
): string | undefined {
  const ei = r["environment_identity"];
  if (typeof ei !== "object" || ei === null) {
    return undefined;
  }
  const soakRunId = (ei as Record<string, unknown>)["soak_run_id"];
  return typeof soakRunId === "string" ? soakRunId : undefined;
}

function fail(
  reason: WorkerResultVerifyFail["reason"],
  detail: string,
): WorkerResultVerifyFail {
  return { ok: false, reason, detail };
}
