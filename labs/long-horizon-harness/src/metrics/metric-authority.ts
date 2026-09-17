/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Single pure authority walk over the ordered Phase E
 * evidence stream.
 *
 * CORRECTION02 (M-C08, M-C09) — established the two-channel
 * architecture.
 *
 * CORRECTION03 (M-C10..M-C13) — makes the new canonical walk
 * actually reproduce frozen Phase-E epoch semantics for the
 * review-blocker channel, and tightens the activation-count
 * measurand. Previously the walker let a review-blocker
 * persist past a work-epoch boundary (which disagreed with
 * Phase E's "review failures are epoch-scoped"). And it
 * counted every REVIEW_FINISHED(false) as an activation
 * (rather than the blocker-transition itself), which
 * duplicated `failing_review_count` and was the wrong
 * measurand. This module now:
 *
 *   - explicitly tracks the Phase-E work epoch (M-C10);
 *   - historicalises the review-blocker on every work-epoch
 *     advance (M-C11);
 *   - counts activations as blocker transitions
 *     `not_blocked -> blocked` rather than as raw failing
 *     reviews (M-C12);
 *   - exposes `deriveAuthorityEndState` for an
 *     end-state-parity oracle against Phase E (M-C13).
 *
 *   Authority channels (CORRECTION02 + CORRECTION03):
 *
 *     Closure-authority channel (the "M" channel):
 *
 *       ACTION_STARTED             invalidates fresh authority
 *       REPAIR_STARTED             invalidates fresh authority
 *       ACTION_FINISHED(ERROR)     invalidates fresh authority
 *       GATE_FINISHED(pass=false)  invalidates fresh authority
 *       GATE_FINISHED(pass=true)   RE-ESTABLISHES fresh authority
 *
 *       ACTION_STARTED / REPAIR_STARTED / ACTION_FINISHED(ERROR)
 *       ALSO advance the work epoch.
 *
 *       (REVIEW_FINISHED is NOT on this channel.)
 *
 *     Review-blocker channel (the "R" channel):
 *
 *       REVIEW_FINISHED(pass=false) at work-epoch N raises a
 *         per-epoch blocker if no blocker is currently open
 *         at work-epoch N. Counts as one activation
 *         (transition `not_blocked -> blocked`).
 *       REVIEW_FINISHED(pass=true) at work-epoch N clears
 *         the blocker at work-epoch N.
 *       The blocker is HISTORICAL if the work epoch has
 *         advanced past the epoch at which it was raised —
 *         it does NOT inhibit SUCCESS at later epochs
 *         (M-C11).
 *
 *       Repeated REVIEW FINISHED(false) at the SAME work
 *       epoch does NOT count additional activations while
 *       the blocker is already open (M-C12).
 *
 * The closure-authority channel and the review-blocker
 * channel evolve INDEPENDENTLY of each other. A REVIEW_FINISHED
 * event does NOT modify fresh-authority for the closure
 * channel; a GATE/ACTION/REPAIR event does NOT modify the
 * review-blocker state (except that ACTION_STARTED /
 * REPAIR_STARTED / ACTION_FINISHED(ERROR) advance the work
 * epoch, which historicalises any open review-blocker).
 *
 * This module is pure: no I/O.
 */

import type { CommittedRunEvent, RunProjection } from "../run/run-types.js";

/**
 * Result of a single canonical authority walk over the
 * ordered evidence stream.
 */
export type AuthorityWalk = {
  /**
   * Number of closure-channel invalidation events
   * observed during the walk: ACTION_STARTED,
   * REPAIR_STARTED, ACTION_FINISHED(ERROR), or
   * GATE_FINISHED(pass=false) when fresh positive authority
   * existed. This is the historical closure-authority
   * correction burden. Survives later recovery (a later
   * GATE_FINISHED(pass=true) does NOT decrement the count).
   *
   * REVIEW_FINISHED events are NOT counted here.
   */
  readonly closure_authority_invalidation_count: number;

  /**
   * Number of blocker TRANSITIONS on the review channel
   * (M-C12). Increments when REVIEW_FINISHED(false)
   * observes a `not_blocked -> blocked` transition at the
   * current work epoch. Repeated REVIEW FAIL at the same
   * epoch does NOT count.
   *
   * This is the historical review-friction TRANSITION
   * counter, kept orthogonal to the closure-authority
   * channel.
   */
  readonly review_blocker_activation_count: number;

  /**
   * Closure-authority boolean at the END of the walk.
   * True iff the last freshness-modifying event was a
   * passing closure gate that has not since been
   * invalidated.
   *
   * Reviews never modify this boolean.
   */
  readonly fresh_closure_authority: boolean;

  /**
   * 1-based position of the last passing closure gate
   * observed while fresh closure authority was being
   * maintained (i.e. the last gate that would have
   * authorized SUCCESS at the current walk end). Used by
   * the distance module to anchor the M5
   * `*_to_last_authoritative_pass` fields. `null` if no
   * passing closure gate was observed during the walk.
   */
  readonly last_authoritative_gate_position: number | null;

  /**
   * Phase-E work epoch at the END of the walk (M-C10).
   * Mirrors the frozen transition rule: increments on
   * ACTION_STARTED, REPAIR_STARTED, and
   * ACTION_FINISHED(ERROR). Phase E V1 has `work_epoch`
   * zero at RUN_STARTED.
   */
  readonly work_epoch_at_end: number;

  /**
   * Whether a REVIEW FINISHED(false) blocker is in effect
   * at the CURRENT work epoch (M-C11). False when no such
   * blocker exists at the current work epoch (either no
   * blocker was ever raised, or a prior blocker has been
   * historicalised by a work-epoch advance, or a
   * REVIEW_FINISHED(true) at the current epoch cleared
   * it).
   */
  readonly review_blocker_open_at_end: boolean;
};

/**
 * Walk the ordered event stream once, deriving BOTH
 * authority channels plus the Phase-E work epoch in a
 * single coherent pass. Pure: same input -> same output.
 *
 * The closure-authority channel update rules and the
 * review-blocker channel update rules are interleaved on
 * shared event types (ACTION_STARTED, REPAIR_STARTED,
 * ACTION_FINISHED(ERROR)) because those events also
 * advance the work epoch. The walker handles each event
 * type with all of its channel effects in one branch so
 * the two channels cannot diverge from this implementation.
 */
export function walkAuthority(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): AuthorityWalk {
  // Closure-authority channel state.
  let closureInvalidations = 0;
  let freshClosureAuthority = false;
  let lastAuthoritativeGatePos: number | null = null;

  // Review-blocker channel state (CORRECTION03 M-C10..M-C12).
  // The blocker is epoch-bound: it survives only at the
  // work epoch at which it was raised. We track (a) whether
  // the blocker is currently open at the current work epoch
  // and (b) the work epoch at which it was raised. The
  // public `review_blocker_open_at_end` is derived as
  //   reviewBlockerOpen && reviewBlockerEpoch === workEpoch.
  let reviewBlockerOpen = false;
  let reviewBlockerEpoch: number | null = null;

  // Activation TRANSITION counter (M-C12).
  let reviewActivations = 0;

  // Phase-E work epoch tracked HERE so the walker is the
  // single source of truth for it.
  let workEpoch = 0;

  for (let i = 0; i < orderedEvents.length; i++) {
    const e = orderedEvents[i];
    if (e === undefined) continue;
    const t = e.event.type;

    if (t === "ACTION_STARTED") {
      // Invalidate closure (if fresh) + advance work epoch
      // + historicalise any open review-blocker (M-C11).
      if (freshClosureAuthority) {
        closureInvalidations += 1;
        freshClosureAuthority = false;
      }
      workEpoch += 1;
      if (reviewBlockerOpen && reviewBlockerEpoch !== workEpoch) {
        reviewBlockerOpen = false;
        reviewBlockerEpoch = null;
      }
    } else if (t === "REPAIR_STARTED") {
      if (freshClosureAuthority) {
        closureInvalidations += 1;
        freshClosureAuthority = false;
      }
      workEpoch += 1;
      if (reviewBlockerOpen && reviewBlockerEpoch !== workEpoch) {
        reviewBlockerOpen = false;
        reviewBlockerEpoch = null;
      }
    } else if (
      t === "ACTION_FINISHED" &&
      e.event.status === "ERROR"
    ) {
      if (freshClosureAuthority) {
        closureInvalidations += 1;
        freshClosureAuthority = false;
      }
      workEpoch += 1;
      if (reviewBlockerOpen && reviewBlockerEpoch !== workEpoch) {
        reviewBlockerOpen = false;
        reviewBlockerEpoch = null;
      }
    } else if (t === "ACTION_FINISHED") {
      // OK close: no authority effect.
    } else if (t === "GATE_FINISHED") {
      if (e.event.pass === true) {
        freshClosureAuthority = true;
        lastAuthoritativeGatePos = i + 1;
      } else {
        if (freshClosureAuthority) {
          closureInvalidations += 1;
          freshClosureAuthority = false;
        }
      }
    } else if (t === "REVIEW_STARTED") {
      // No channel effect until REVIEW_FINISHED.
    } else if (t === "REVIEW_FINISHED") {
      // REVIEW_FINISHED NEVER touches closure authority,
      // and NEVER advances the work epoch. It only acts on
      // the review-blocker channel at the CURRENT work
      // epoch.
      if (e.event.pass === false) {
        // Activation iff the blocker transitions
        // `not_blocked -> blocked` at the current work
        // epoch (M-C12). A repeated REVIEW FINISHED(false)
        // at the same epoch while the blocker is already
        // open does NOT count as a new activation — the
        // state did not transition.
        if (!reviewBlockerOpen || reviewBlockerEpoch !== workEpoch) {
          reviewActivations += 1;
          reviewBlockerOpen = true;
          reviewBlockerEpoch = workEpoch;
        }
      } else {
        // pass=true: clear the blocker IF it is currently
        // open at the current work epoch. (Historical
        // blockers are already cleared; this is a no-op.)
        if (
          reviewBlockerOpen &&
          reviewBlockerEpoch !== null &&
          reviewBlockerEpoch === workEpoch
        ) {
          reviewBlockerOpen = false;
          reviewBlockerEpoch = null;
        }
      }
    }
    // Other event types intentionally have no effect on
    // either authority channel or the work epoch.
  }

  // At end-of-walk, a historicalised blocker must be
  // reported as closed. (We already clear `reviewBlockerOpen`
  // on every epoch advance; this defensive step ensures
  // parity with Phase E even if a future event type begins
  // resetting the work epoch without our cooperation.)
  const reviewBlockerOpenAtEnd =
    reviewBlockerOpen &&
    reviewBlockerEpoch !== null &&
    reviewBlockerEpoch === workEpoch;

  return {
    closure_authority_invalidation_count: closureInvalidations,
    review_blocker_activation_count: reviewActivations,
    fresh_closure_authority: freshClosureAuthority,
    last_authoritative_gate_position: lastAuthoritativeGatePos,
    work_epoch_at_end: workEpoch,
    review_blocker_open_at_end: reviewBlockerOpenAtEnd,
  };
}

/**
 * End-state parity oracle between this canonical authority
 * walk and the Phase-E projector (M-C13).
 *
 * The metric has ONE interpretation of the frozen Phase-E
 * precedence model. This function asserts that
 * interpretation:
 *
 *   - closure authority boolean agrees with Phase E's
 *     `RunProjection.closure_authority_fresh`;
 *   - review-blocker boolean agrees with Phase E's
 *     `RunProjection.current_epoch_review_failure`;
 *   - the walker-derived work epoch agrees with Phase E's
 *     `RunProjection.work_epoch`.
 *
 * Returns `{ok: true}` iff every end-state field matches.
 * Any divergence yields `{ok: false, reason}` describing
 * which field(s) disagree. The projector (`metric-projector.ts`)
 * calls this for every report it computes, so any future
 * authority-algebra drift surfaces as a typed metric
 * rejection rather than as silent corruption.
 */
export function assertAuthorityEndStateMatchesProjection(
  walk: AuthorityWalk,
  projection: RunProjection,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (walk.fresh_closure_authority !== projection.closure_authority_fresh) {
    return {
      ok: false,
      reason:
        `authority parity: walk.fresh_closure_authority (` +
        `${walk.fresh_closure_authority}) disagrees with ` +
        `projection.closure_authority_fresh ` +
        `(${projection.closure_authority_fresh})`,
    };
  }
  if (walk.review_blocker_open_at_end !== projection.current_epoch_review_failure) {
    return {
      ok: false,
      reason:
        `authority parity: walk.review_blocker_open_at_end ` +
        `(${walk.review_blocker_open_at_end}) disagrees with ` +
        `projection.current_epoch_review_failure ` +
        `(${projection.current_epoch_review_failure})`,
    };
  }
  if (walk.work_epoch_at_end !== projection.work_epoch) {
    return {
      ok: false,
      reason:
        `authority parity: walk.work_epoch_at_end ` +
        `(${walk.work_epoch_at_end}) disagrees with ` +
        `projection.work_epoch (${projection.work_epoch})`,
    };
  }
  return { ok: true };
}
