/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Single pure authority walk over the ordered Phase E
 * evidence stream.
 *
 * CORRECTION02 (M-C08, M-C09).
 *
 * Previously `metric-counters.ts` and `metric-distances.ts`
 * each walked the stream with their own interpretation of
 * "fresh positive authority" — and those interpretations
 * diverged on one corner case: whether REVIEW_FINISHED(false)
 * clears `freshAuthority`. Phase E's frozen authority
 * precedence model (E-C24) treats reviews as an ORTHOGONAL
 * channel: a review FAIL does NOT stale the closure gate; it
 * raises a separate per-epoch SUCCESS blocker that may be
 * cleared by a later REVIEW_FINISHED(pass=true) at the same
 * work epoch. The metric now has ONE authority walker that
 * matches Phase E's semantics, and `metric-counters.ts` /
 * `metric-distances.ts` both consume it.
 *
 * Authority channels (CORRECTION02):
 *
 *   Closure-authority channel (the "M" channel):
 *
 *     ACTION_STARTED             invalidates fresh authority
 *     REPAIR_STARTED             invalidates fresh authority
 *     ACTION_FINISHED(ERROR)     invalidates fresh authority
 *     GATE_FINISHED(pass=false)  invalidates fresh authority
 *     GATE_FINISHED(pass=true)   RE-ESTABLISHES fresh authority
 *
 *     (REVIEW_FINISHED is NOT on this channel.)
 *
 *   Review-blocker channel (the "R" channel):
 *
 *     REVIEW_FINISHED(pass=false) at epoch E raises a
 *     review-blocker at the same epoch.
 *     REVIEW_FINISHED(pass=true) at epoch E clears it.
 *     This is the activation count surfaced as
 *     `historical_review_blocker_activation_count`.
 *
 * The closure-authority channel and the review-blocker
 * channel evolve INDEPENDENTLY of each other. A REVIEW_FINISHED
 * event does NOT modify fresh-authority for the closure
 * channel; a GATE/ACTION/REPAIR event does NOT modify the
 * review-blocker state.
 *
 * This module is pure: no I/O.
 */

import type { CommittedRunEvent } from "../run/run-types.js";

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
   * Number of times REVIEW_FINISHED(pass=false) raised a
   * per-epoch review-blocker. A later
   * REVIEW_FINISHED(pass=true) at the same epoch CLEARS the
   * blocker but does NOT decrement the historical count.
   *
   * This is the historical review-friction counter, kept
   * orthogonal to the closure-authority channel.
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
   *
   * A gate's authorship is preserved even after a later
   * ACTION_STARTED / REPAIR_STARTED invalidates authority:
   * the walk continues and may RE-AUTHORIZE at a later
   * gate. The function returns the position of the LAST
   * gate that completed before the walk ended (whether
   * that gate's authority has since been invalidated or
   * not).
   *
   * The distance module uses this in combination with
   * `trustworthySuccess` (supplied by the projector) to
   * decide whether the `*_to_last_authoritative_pass`
   * fields are reported or `unavailable`.
   */
  readonly last_authoritative_gate_position: number | null;

  /**
   * Whether a REVIEW_FINISHED(pass=false) is in effect at
   * the current work epoch (i.e. the per-epoch blocker
   * has been raised and not cleared).
   */
  readonly review_blocker_open_at_end: boolean;
};

/**
 * Walk the ordered event stream once, deriving BOTH authority
 * channels in a single coherent pass. Pure: same input ->
 * same output.
 *
 * Implementation note: the closure-authority channel and
 * review-blocker channel are updated by disjoint event
 * types, so the walker can maintain them independently
 * without a two-pass design.
 */
export function walkAuthority(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): AuthorityWalk {
  let closureInvalidations = 0;
  let reviewActivations = 0;
  let freshClosureAuthority = false;
  let reviewBlockerOpen = false;
  let lastAuthoritativeGatePos: number | null = null;

  for (let i = 0; i < orderedEvents.length; i++) {
    const e = orderedEvents[i];
    if (e === undefined) continue;
    const t = e.event.type;

    // --- Closure-authority channel -------------------------
    //
    // Invalidation events (only when fresh): ACTION_STARTED,
    // REPAIR_STARTED, ACTION_FINISHED(ERROR),
    // GATE_FINISHED(pass=false). A successful GATE_PASS
    // RE-ESTABLISHES authority at the current work epoch.
    if (t === "ACTION_STARTED") {
      if (freshClosureAuthority) {
        closureInvalidations += 1;
        freshClosureAuthority = false;
      }
    } else if (t === "REPAIR_STARTED") {
      if (freshClosureAuthority) {
        closureInvalidations += 1;
        freshClosureAuthority = false;
      }
    } else if (
      t === "ACTION_FINISHED" &&
      e.event.status === "ERROR"
    ) {
      if (freshClosureAuthority) {
        closureInvalidations += 1;
        freshClosureAuthority = false;
      }
    } else if (t === "GATE_FINISHED") {
      if (e.event.pass === true) {
        freshClosureAuthority = true;
        // Record EVERY passing closure gate as a candidate;
        // the function returns the LAST one. Sourcing
        // `freshClosureAuthority` from a passing gate is
        // safe even if the same gate would later be
        // invalidated — invalidating events clear
        // `freshClosureAuthority` for FUTURE gates, but the
        // recorded position already captures the gate that
        // landed the authorization.
        lastAuthoritativeGatePos = i + 1;
      } else {
        // GATE_FINISHED(pass=false): this is itself a
        // closure-channel invalidation (the closing gate
        // produced negative evidence at the current
        // epoch). Count it just like ACTION_STARTED.
        if (freshClosureAuthority) {
          closureInvalidations += 1;
          freshClosureAuthority = false;
        }
      }
    } else if (t === "REVIEW_FINISHED") {
      // --- Review-blocker channel (orthogonal) -----------
      //
      // REVIEW_FINISHED NEVER touches `freshClosureAuthority`.
      // It only raises or clears the per-epoch blocker.
      if (e.event.pass === false) {
        reviewActivations += 1;
        reviewBlockerOpen = true;
      } else {
        // pass=true: clears the per-epoch blocker.
        reviewBlockerOpen = false;
      }
    }
    // All other event types intentionally have no effect on
    // either authority channel.
  }

  return {
    closure_authority_invalidation_count: closureInvalidations,
    review_blocker_activation_count: reviewActivations,
    fresh_closure_authority: freshClosureAuthority,
    last_authoritative_gate_position: lastAuthoritativeGatePos,
    review_blocker_open_at_end: reviewBlockerOpen,
  };
}
