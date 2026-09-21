/**
 * LH-06 deterministic long-duration soak laboratory —
 * semantic digest ledger.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * For every deterministic unit the soak runs, the worker
 * computes a canonical semantic digest:
 *
 *   semantic_digest = sha256(deterministicJson(semanticResultShape))
 *
 * Excluded from the digest:
 *   timestamp
 *   temporary paths
 *   PID
 *   free-text diagnostics
 *
 * Required:
 *   SEMANTIC_DRIFT_COUNT = 0
 *
 * The ledger is the canonical implementation of the
 * cardinality / predecessor-independence / canary-stability
 * oracles (ACT §14, §16, §17, §40).
 */
import { createHash } from "node:crypto";

/**
 * Deterministic JSON. Sorts object keys recursively so the
 * hash does not depend on the order in which keys were
 * originally inserted.
 */
export function deterministicJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortKeysDeep(obj[k]);
  }
  return out;
}

/**
 * Compute a canonical SHA-256 digest of a semantic value.
 */
export function semanticDigest(value: unknown): string {
  return createHash("sha256").update(deterministicJson(value)).digest("hex");
}

/**
 * Per-case observation stored in the semantic ledger.
 *
 * Note: the ledger does NOT retain full observation
 * objects across the soak — the soak itself must not be
 * the source of monotonic heap retention. The ledger
 * stores only the aggregate state needed to derive
 * verdicts (drift count, unique digests per case,
 * predecessor matrix, canary snapshots). Tests can
 * stream observation detail to JSONL via the bounded
 * telemetry buffer if they want per-observation
 * visibility.
 */
export interface SemanticObservation {
  readonly case_id: string;
  readonly source: "LH05" | "LH04" | "CANARY";
  readonly epoch_index: number;
  readonly predecessor: string | null;
  readonly digest: string;
  readonly observed_at_ms: number;
}

export interface SemanticLedgerVerdict {
  readonly semantic_drift_count: number;
  readonly unique_digests_per_case: Readonly<Record<string, number>>;
  readonly predecessor_dependency_count: number;
  readonly canary_before_equals_canary_after: boolean | null;
}

/**
 * The semantic ledger. The worker feeds each observation;
 * the ledger records expected digests from the FIRST
 * observation per case (or from a frozen seed when one is
 * supplied) and reports drift on every subsequent one.
 *
 * Memory discipline: the ledger does NOT retain every
 * observation. It holds:
 *   - a bounded recent-observations ring (`recent`,
 *     capped at `LH06_SEMANTIC_RECENT_OBS_CAP`);
 *   - aggregate counters;
 *   - per-case digest sets;
 *   - the predecessor matrix.
 *
 * For the FULL retention of every observation across
 * 500+ epochs, callers should stream to JSONL via the
 * telemetry buffer. The heap-stability detector would
 * otherwise measure itself.
 */
export const LH06_SEMANTIC_RECENT_OBS_CAP = 200;

export class SemanticLedger {
  private recent: SemanticObservation[] = [];
  private driftCount = 0;
  private observationCount = 0;
  private readonly expectedDigests: Map<string, string> = new Map();
  private readonly firstDigests: Map<string, string> = new Map();
  private readonly digestsByCase: Map<string, Set<string>> = new Map();
  private readonly predecessorMatrix: Map<string, Map<string, string>> = new Map();
  private canaryBefore: string | null = null;
  private canaryAfter: string | null = null;

  /**
   * Seed the expected digests from an externally-supplied
   * record (typically the first steady-state observation
   * or the frozen qualification artifact). This MUST be
   * called BEFORE any observation is recorded.
   */
  seedExpected(args: { readonly expected: Readonly<Record<string, string>> }): void {
    if (this.observationCount > 0) {
      throw new Error(
        "SemanticLedger.seedExpected: must be called before any observation",
      );
    }
    for (const [caseId, digest] of Object.entries(args.expected)) {
      this.expectedDigests.set(caseId, digest);
      this.firstDigests.set(caseId, digest);
      const set = new Set<string>();
      set.add(digest);
      this.digestsByCase.set(caseId, set);
    }
  }

  recordObservation(args: Omit<SemanticObservation, "observed_at_ms">): void {
    const obs: SemanticObservation = Object.freeze({
      ...args,
      observed_at_ms: Date.now(),
    });
    // Bounded retention: only the last
    // LH06_SEMANTIC_RECENT_OBS_CAP observations are kept
    // in memory. The drift / cardinality / predecessor /
    // canary verdicts are computed from aggregate state,
    // so a bounded ring does not change the verdict.
    this.recent.push(obs);
    if (this.recent.length > LH06_SEMANTIC_RECENT_OBS_CAP) {
      this.recent.shift();
    }
    this.observationCount += 1;

    const caseId = obs.case_id;
    if (obs.source === "CANARY") {
      if (this.canaryBefore === null) {
        this.canaryBefore = obs.digest;
      } else {
        this.canaryAfter = obs.digest;
      }
    }

    let perCase = this.digestsByCase.get(caseId);
    if (perCase === undefined) {
      perCase = new Set();
      this.digestsByCase.set(caseId, perCase);
    }
    perCase.add(obs.digest);

    let matrix = this.predecessorMatrix.get(caseId);
    if (matrix === undefined) {
      matrix = new Map();
      this.predecessorMatrix.set(caseId, matrix);
    }
    matrix.set(obs.predecessor ?? "<none>", obs.digest);

    if (!this.expectedDigests.has(caseId)) {
      this.expectedDigests.set(caseId, obs.digest);
      this.firstDigests.set(caseId, obs.digest);
    } else if (obs.digest !== this.expectedDigests.get(caseId)) {
      // Drift detected: this observation's digest differs
      // from the expected (first / seeded) digest. We
      // count it here so subsequent calls to
      // semanticDriftCount() are O(1) rather than O(n).
      this.driftCount += 1;
    }
  }

  semanticDriftCount(): number {
    return this.driftCount;
  }

  uniqueDigestsPerCase(): Readonly<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.digestsByCase.entries()) {
      out[k] = v.size;
    }
    return Object.freeze(out);
  }

  predecessorDependencyCount(): number {
    let count = 0;
    for (const [, matrix] of this.predecessorMatrix.entries()) {
      // The matrix is (predecessor -> digest). If a case
      // is observed with multiple predecessors AND they
      // produce different digests, that proves
      // predecessor-dependent semantics.
      if (matrix.size < 2) continue;
      const digests = new Set(matrix.values());
      if (digests.size > 1) count += 1;
    }
    return count;
  }

  canaryStable(): boolean | null {
    if (this.canaryBefore === null || this.canaryAfter === null) {
      return null;
    }
    return this.canaryBefore === this.canaryAfter;
  }

  totalObservations(): number {
    return this.observationCount;
  }

  verdict(): SemanticLedgerVerdict {
    return {
      semantic_drift_count: this.semanticDriftCount(),
      unique_digests_per_case: this.uniqueDigestsPerCase(),
      predecessor_dependency_count: this.predecessorDependencyCount(),
      canary_before_equals_canary_after: this.canaryStable(),
    };
  }

  observedDigestsByCase(): Readonly<Record<string, readonly string[]>> {
    const out: Record<string, readonly string[]> = {};
    for (const [k, v] of this.digestsByCase.entries()) {
      out[k] = Object.freeze([...v]);
    }
    return Object.freeze(out);
  }
}

/**
 * Strip volatile fields (timestamps, paths, PIDs, free-text
 * notes) before digesting. Tests use this to compute the
 * expected semantic shape.
 */
const VOLATILE_KEYS = new Set([
  "observed_at",
  "observed_at_ms",
  "timestamp",
  "emitted_at",
  "started_at",
  "finished_at",
  "path",
  "workspace",
  "temp_path",
  "pid",
  "notes",
  "free_text",
]);

export function stripVolatile(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map(stripVolatile);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    if (VOLATILE_KEYS.has(k)) continue;
    out[k] = stripVolatile(obj[k]);
  }
  return out;
}
