/**
 * LH-06 worker-result verifier helpers.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Split from `worker-result-verifier.ts` for source-size
 * discipline (HYGIENE01). Contains the verdict-aware
 * profile contract check (L06-CORRECTION06 L06-C32) and
 * the publication-durability gate (L06-CORRECTION06
 * L06-C33), both of which can be unit-tested in
 * isolation from the rest of the verifier.
 */
import { LH06_PROFILES } from "./contract.js";
import { verdictForFailure } from "./result-io.js";
import type {
  LH06FailureKind,
  LH06Verdict,
} from "./types.js";
import type { LH06FailureRecord } from "./result.js";

export type HelperReason =
  | "MISSING_REQUIRED_FIELD"
  | "INSUFFICIENT_DURATION"
  | "INSUFFICIENT_EPOCHS"
  | "INCONSISTENT_VERDICT";

export interface HelperFail {
  readonly ok: false;
  readonly reason: HelperReason;
  readonly detail: string;
}

export interface HelperOk {
  readonly ok: true;
}

export function checkProfileMinima(args: {
  readonly profile: string;
  readonly verdict: LH06Verdict;
  readonly duration_ms: number;
  readonly epochs_completed: number;
}): HelperOk | HelperFail;
export function checkProfileMinima(args: {
  readonly profile: string;
  readonly verdict: unknown;
  readonly duration_ms: number;
  readonly epochs_completed: number;
}): HelperOk | HelperFail;
export function checkProfileMinima(args: {
  readonly profile: string;
  readonly verdict: unknown;
  readonly duration_ms: number;
  readonly epochs_completed: number;
}): HelperOk | HelperFail {
  // Narrow the verdict to the union at the call site.
  const verdict = args.verdict as LH06Verdict;
  const pc = LH06_PROFILES[args.profile as keyof typeof LH06_PROFILES];
  if (typeof pc !== "object" || pc === null) {
    return fail("MISSING_REQUIRED_FIELD", `profile ${args.profile} not in LH06_PROFILES`);
  }
  const minDur = pc.minimum_wall_clock_ms;
  const minEp = pc.minimum_epochs;
  if (typeof minDur !== "number" || typeof minEp !== "number") {
    return fail(
      "MISSING_REQUIRED_FIELD",
      `profile ${args.profile} missing minimum_wall_clock_ms or minimum_epochs`,
    );
  }
  if (verdict === "PASS_DETERMINISTIC_SOAK") {
    if (args.duration_ms < minDur) {
      return fail(
        "INSUFFICIENT_DURATION",
        `PASS verdict on profile ${args.profile} requires duration_ms >= ${minDur}, got ${args.duration_ms}`,
      );
    }
    if (args.epochs_completed < minEp) {
      return fail(
        "INSUFFICIENT_EPOCHS",
        `PASS verdict on profile ${args.profile} requires epochs_completed >= ${minEp}, got ${args.epochs_completed}`,
      );
    }
    return ok();
  }
  if (verdict === "QUALIFICATION_INCOMPLETE") {
    if (args.duration_ms >= minDur && args.epochs_completed >= minEp) {
      return fail(
        "INCONSISTENT_VERDICT",
        `QUALIFICATION_INCOMPLETE on profile ${args.profile} but both minima were satisfied — the run is complete`,
      );
    }
    return ok();
  }
  return ok();
}

export function checkPublicationDurability(args: {
  readonly verdict: LH06Verdict;
  readonly publication_durability: unknown;
}): HelperOk | HelperFail;
export function checkPublicationDurability(args: {
  readonly verdict: unknown;
  readonly publication_durability: unknown;
}): HelperOk | HelperFail;
export function checkPublicationDurability(args: {
  readonly verdict: unknown;
  readonly publication_durability: unknown;
}): HelperOk | HelperFail {
  const verdict = args.verdict as LH06Verdict;
  const pd = args.publication_durability;
  if (pd !== "CRASH_DURABLE" && pd !== "ATOMIC_ONLY") {
    return fail(
      "MISSING_REQUIRED_FIELD",
      `publication_durability must be "CRASH_DURABLE" or "ATOMIC_ONLY", got ${JSON.stringify(pd)}`,
    );
  }
  if (verdict === "PASS_DETERMINISTIC_SOAK" && pd !== "CRASH_DURABLE") {
    return fail(
      "INCONSISTENT_VERDICT",
      `PASS verdict requires publication_durability="CRASH_DURABLE", got "${pd}" — canonical artifact not durable across crashes`,
    );
  }
  return ok();
}

/**
 * L06-CORRECTION07 L06-C34: derived verdict from failure.kind.
 *
 * The verifier does NOT trust the worker-claimed
 * `verdict` string for non-PASS results. The
 * architecture invariant is:
 *
 *   worker_failure_facts -> verifier_derived_verdict
 *
 * For every non-PASS verdict the verifier
 * independently recomputes the verdict from the
 * failure kind and accepts ONLY records where the
 * worker's claimed verdict matches the derived
 * verdict. Cross-category forgery
 * (`MEMORY_GROWTH` failure with a
 * `FAIL_FROZEN_INTEGRITY` verdict) is therefore
 * rejected at verification time, not after the
 * fact.
 *
 * The PASS / null case is handled by the caller (no
 * failure kind to derive from).
 */
export function expectedVerdictFor(
  failureKind: LH06FailureKind,
): LH06Verdict {
  return verdictForFailure(failureKind);
}

export function checkVerdictMatchesFailure(args: {
  readonly verdict: LH06Verdict;
  readonly failure: LH06FailureRecord;
}): HelperOk | HelperFail {
  const expected = expectedVerdictFor(args.failure.kind);
  if (args.verdict !== expected) {
    return fail(
      "INCONSISTENT_VERDICT",
      `worker-claimed verdict "${args.verdict}" does not match the ` +
        `verdict derived from failure.kind="${args.failure.kind}" ` +
        `(expected "${expected}"); L06-CORRECTION07 L06-C34 forbids ` +
        `the supervisor from trusting the worker's claimed verdict ` +
        `string independently of the failure record`,
    );
  }
  return ok();
}

function fail(reason: HelperReason, detail: string): HelperFail {
  return { ok: false, reason, detail };
}
function ok(): HelperOk {
  return { ok: true };
}
