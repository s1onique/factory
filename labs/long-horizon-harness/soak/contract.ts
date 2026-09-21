/**
 * LH-06 deterministic long-duration soak laboratory — the
 * canonical soak contract.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Single source of truth for the soak's closed-world
 * invariants. Changing a threshold requires a contract-
 * version bump; silent threshold tuning after observing a
 * failing run is forbidden.
 *
 * Frozen terminology:
 *
 *   SEMANTIC_REPEATABILITY != BYTE_IDENTICAL_ARTIFACT
 *   RESOURCE_STABILITY     != RSS_CONSTANT
 *   EXPECTED_RUNTIME_CACHE != MEMORY_LEAK
 *   ONE_GREEN_ITERATION    != SOAK_STABILITY
 *   PROCESS_SURVIVES       != STATE_ISOLATION
 *   HIGH_ITERATION_COUNT   != LONG_DURATION
 *
 * The contract encodes the V1 numeric thresholds from ACT
 * §12 (heap) and §24 (latency).
 */
import {
  LH06_SOAK_CONTRACT_VERSION,
  type LH06ProfileContract,
  type LH06SoakProfile,
} from "./types.js";

/**
 * Memory verdict — V1 thresholds from ACT §12.
 *
 *   last_window <= first_window + max(8 MiB, first_window * 0.20)
 *   heap_used_slope <= 16 KiB / epoch
 *
 * Both must pass. These are qualification thresholds, not
 * universal Node.js laws.
 */
export const LH06_HEAP_ABSOLUTE_TOLERANCE_BYTES = 8 * 1024 * 1024;
export const LH06_HEAP_RELATIVE_TOLERANCE_FRACTION = 0.20;
export const LH06_HEAP_SLOPE_MAX_BYTES_PER_EPOCH = 16 * 1024;

/**
 * Latency verdict — V1 thresholds from ACT §24.
 *
 *   last_window_median <=
 *     max(first_window_median * 1.50,
 *         first_window_median + 250 ms)
 */
export const LH06_LATENCY_RATIO_MAX = 1.50;
export const LH06_LATENCY_ABSOLUTE_TOLERANCE_MS = 250;

/**
 * Steady-state window sizing. After warm-up, the first / last
 * 20 samples define the comparison windows (ACT §12).
 */
export const LH06_HEAP_WINDOW_SIZE = 20;

/**
 * Heartbeat watchdog. The supervisor MUST terminate the
 * worker if no heartbeat arrives within this window.
 */
export const LH06_DEFAULT_HEARTBEAT_TIMEOUT_MS = 60_000;

/**
 * Default warm-up window. Warm-up contributes to all
 * semantic / cleanup / integrity checks but is excluded from
 * the steady-state leak trend calculations.
 */
export const LH06_DEFAULT_WARMUP_EPOCHS = 20;

/**
 * Telemetry sampling cadences (ACT §23).
 */
export const LH06_POST_GC_SAMPLE_EVERY_N_EPOCHS = 5;
export const LH06_FULL_DIAGNOSTIC_EVERY_N_EPOCHS = 25;

/**
 * Telemetry boundedness (ACT §22). The in-memory ring buffer
 * MUST NOT exceed this cardinality for the diagnostic window.
 */
export const LH06_IN_MEMORY_TELEMETRY_CAP = 200;

/**
 * Frozen-tree integrity — paths the soak MUST fingerprint
 * before and after (ACT §20). All paths are RELATIVE TO THE
 * LONG-HORIZON-HARNESS LAB ROOT.
 */
export const LH06_FROZEN_TREE_PATHS: readonly string[] = Object.freeze([
  "src/run",
  "test/run",
  "src/metrics",
  "test/metrics",
  "fault-lab/deterministic",
  "lifecycle-corpus",
  "test/lh03",
  "test/lh04",
  "test/lh05",
  "qualification/lh03-frozen.json",
  "qualification/lh04-frozen.json",
  "qualification/lh05-adversarial-lifecycle-corpus.json",
  "qualification/lh04-deterministic-faults.json",
  "qualification/capability-matrix.json",
]);

/**
 * Frozen-substrate commits the soak binds to. The worker
 * records these in the result and refuses to run if any of
 * them is missing.
 */
export const LH06_FROZEN_SUBSTRATE_FILES: Readonly<Record<string, string>> =
  Object.freeze({
    lh03_frozen: "qualification/lh03-frozen.json",
    lh04_frozen: "qualification/lh04-frozen.json",
    lh05_corpus: "qualification/lh05-adversarial-lifecycle-corpus.json",
  });

/**
 * Profile contracts. CI_SMOKE is a normal Factory gate but
 * does NOT qualify LH-06. QUALIFICATION is the closure
 * profile. EXTENDED is manual discovery.
 *
 * For QUALIFICATION, the worker continues until BOTH:
 *   duration >= 60 minutes
 *   epochs   >= 500
 *
 * For CI_SMOKE, the worker continues until BOTH:
 *   epochs >= 10
 *   duration >= 0 (i.e. trivial)
 *
 * EXTENDED is an unbounded / manual discovery profile.
 */
export const LH06_PROFILES: Readonly<Record<LH06SoakProfile, LH06ProfileContract>> =
  Object.freeze({
    CI_SMOKE: {
      profile: "CI_SMOKE",
      minimum_wall_clock_ms: 0,
      minimum_epochs: 10,
      heartbeat_timeout_ms: LH06_DEFAULT_HEARTBEAT_TIMEOUT_MS,
      warmup_epochs: 0,
      extended_diagnostic: false,
    },
    QUALIFICATION: {
      profile: "QUALIFICATION",
      // 60 minutes
      minimum_wall_clock_ms: 60 * 60 * 1000,
      minimum_epochs: 500,
      heartbeat_timeout_ms: LH06_DEFAULT_HEARTBEAT_TIMEOUT_MS,
      warmup_epochs: LH06_DEFAULT_WARMUP_EPOCHS,
      extended_diagnostic: true,
    },
    EXTENDED: {
      profile: "EXTENDED",
      // 6 hours
      minimum_wall_clock_ms: 6 * 60 * 60 * 1000,
      // EXTENDED keeps running; the worker only stops via
      // explicit termination or the qualification deadline.
      // minimum_epochs is intentionally low so the caller
      // can stop the soak manually.
      minimum_epochs: 50,
      heartbeat_timeout_ms: LH06_DEFAULT_HEARTBEAT_TIMEOUT_MS,
      warmup_epochs: LH06_DEFAULT_WARMUP_EPOCHS,
      extended_diagnostic: true,
    },
  });

export const LH06_CONTRACT = Object.freeze({
  contract_version: LH06_SOAK_CONTRACT_VERSION,
  profiles: LH06_PROFILES,
  frozen_tree_paths: LH06_FROZEN_TREE_PATHS,
  frozen_substrate_files: LH06_FROZEN_SUBSTRATE_FILES,
  heap_absolute_tolerance_bytes: LH06_HEAP_ABSOLUTE_TOLERANCE_BYTES,
  heap_relative_tolerance_fraction: LH06_HEAP_RELATIVE_TOLERANCE_FRACTION,
  heap_slope_max_bytes_per_epoch: LH06_HEAP_SLOPE_MAX_BYTES_PER_EPOCH,
  heap_window_size: LH06_HEAP_WINDOW_SIZE,
  latency_ratio_max: LH06_LATENCY_RATIO_MAX,
  latency_absolute_tolerance_ms: LH06_LATENCY_ABSOLUTE_TOLERANCE_MS,
  post_gc_sample_every_n_epochs: LH06_POST_GC_SAMPLE_EVERY_N_EPOCHS,
  full_diagnostic_every_n_epochs: LH06_FULL_DIAGNOSTIC_EVERY_N_EPOCHS,
  in_memory_telemetry_cap: LH06_IN_MEMORY_TELEMETRY_CAP,
});
