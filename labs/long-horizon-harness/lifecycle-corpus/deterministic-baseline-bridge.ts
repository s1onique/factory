/**
 * LH-05 deterministic baseline bridge.
 *
 * Re-exports the canonical baseline builder + file set
 * from the LH-04 frozen fault laboratory so the LC11
 * handoff does not duplicate the LH-04 implementation.
 */
export {
  buildCanonicalBaseline,
  CANONICAL_BASELINE_FILES,
} from "../fault-lab/deterministic/baseline.js";
