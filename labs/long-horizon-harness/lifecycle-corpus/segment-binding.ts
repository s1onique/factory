/**
 * LH-05 segment-binding authority (L05-C10 / L05-C11).
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * Closed-world validator and projector for LC07 (and any
 * other RECOVERY_LIFECYCLE scenario that declares segments).
 *
 * Required invariants:
 *   - `SEGMENT_ORDER_IS_DECLARED_NOT_GUESSED = TRUE`
 *   - `LC07_BINDING_RECORD_REACHES_LOADER = TRUE`
 *   - `NATIVE_SESSION_ID_DRIFT_ACCEPTED = IMPOSSIBLE`
 *
 * The validator returns the FIRST applicable failure as a
 * typed `SegmentBindingFailure`; downstream consumers MUST
 * NOT treat it as free-text.
 *
 * Segment IDs are opaque strings (e.g. "A", "B") — the
 * validator does NOT assume a fixed alphabet.
 */
import type {
  LifecycleScenario,
  LifecycleSegmentBinding,
  SegmentBindingFailure,
} from "./types.js";

export type SegmentChainValidation =
  | { readonly ok: true; readonly segments: ReadonlyArray<LifecycleSegmentBinding> }
  | { readonly ok: false; readonly reason: SegmentBindingFailure };

/**
 * Pure validator. Rejects:
 *   - duplicate segment_id
 *   - duplicate ordinal
 *   - non-monotonic ordinal
 *   - missing predecessor (segment with previous_segment_id
 *     that does not appear earlier in the chain)
 *   - unknown predecessor (previous_segment_id refers to a
 *     segment that is not declared)
 *   - capture_id mismatch (any segment whose capture_id
 *     disagrees with the first segment's capture_id)
 *   - shared_session_id mismatch (any segment whose
 *     shared_session_id disagrees with the first segment's)
 *   - first segment with previous_segment_id != null
 *   - continuation with previous_segment_id == null
 *   - reordered segment list (input not already sorted by
 *     ordinal)
 *   - duplicate fixture_path
 */
export function validateLifecycleSegmentChain(
  segments: ReadonlyArray<LifecycleSegmentBinding> | undefined,
): SegmentChainValidation {
  if (segments === undefined || segments.length === 0) {
    // No segments declared: this is fine for non-LC07
    // scenarios. The validator returns a no-op success.
    return { ok: true, segments: [] };
  }
  // 1. duplicate segment_id
  const seenIds = new Set<string>();
  for (const s of segments) {
    if (seenIds.has(s.segment_id)) {
      return { ok: false, reason: "DUPLICATE_SEGMENT" };
    }
    seenIds.add(s.segment_id);
  }
  // 2. duplicate ordinal
  const seenOrdinals = new Set<number>();
  for (const s of segments) {
    if (seenOrdinals.has(s.ordinal)) {
      return { ok: false, reason: "SEGMENT_ORDER_INVALID" };
    }
    seenOrdinals.add(s.ordinal);
  }
  // 3. duplicate fixture_path
  const seenPaths = new Set<string>();
  for (const s of segments) {
    if (seenPaths.has(s.fixture_path)) {
      return { ok: false, reason: "DUPLICATE_FIXTURE" };
    }
    seenPaths.add(s.fixture_path);
  }
  // 4. reordered / non-monotonic ordinal — sort and compare
  const sorted = [...segments].sort((a, b) => a.ordinal - b.ordinal);
  for (let i = 0; i < segments.length; i++) {
    if (segments[i]!.ordinal !== sorted[i]!.ordinal) {
      return { ok: false, reason: "SEGMENT_ORDER_INVALID" };
    }
  }
  // 5. capture_id mismatch / shared_session_id mismatch:
  //    the chain shares a single logical lifecycle, so all
  //    segments MUST agree with the first segment on
  //    capture_id and shared_session_id.
  const head = segments[0]!;
  for (const s of segments) {
    if (s.capture_id !== head.capture_id) {
      return { ok: false, reason: "CAPTURE_ID_MISMATCH" };
    }
    if (s.shared_session_id !== head.shared_session_id) {
      return { ok: false, reason: "SESSION_ID_MISMATCH" };
    }
  }
  // 6. first segment with previous_segment_id != null
  if (head.previous_segment_id !== null) {
    return { ok: false, reason: "UNBOUND_CONTINUATION" };
  }
  // 7. continuation chain validity (sorted by ordinal).
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i]!;
    if (i === 0) {
      // already checked above
      continue;
    }
    const expectedPrev = sorted[i - 1]!.segment_id;
    if (seg.previous_segment_id === null) {
      return { ok: false, reason: "MISSING_PREDECESSOR" };
    }
    if (seg.previous_segment_id !== expectedPrev) {
      // Either truly unknown (not in chain) OR not the
      // immediate predecessor. Treat both as missing/
      // unknown predecessor — the closed-world reason.
      if (!seenIds.has(seg.previous_segment_id)) {
        return { ok: false, reason: "MISSING_PREDECESSOR" };
      }
      return { ok: false, reason: "MISSING_PREDECESSOR" };
    }
  }
  return { ok: true, segments: sorted };
}

/**
 * Project the validated segments into the loader-shaped
 * argument used by `loadPiFixture`. The caller is the
 * canonical owner of segment metadata — the loader never
 * reconstructs it.
 */
export function segmentsForLoader(
  scenario: LifecycleScenario,
): ReadonlyArray<LifecycleSegmentBinding> {
  const v = validateLifecycleSegmentChain(scenario.segments);
  if (!v.ok) {
    throw new Error(
      `segmentsForLoader: scenario ${scenario.id} declared invalid segment chain: ${v.reason}`,
    );
  }
  return v.segments;
}
