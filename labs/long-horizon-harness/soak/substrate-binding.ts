/**
 * LH-06 deterministic long-duration soak laboratory —
 * substrate binding helpers.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Split from worker-state.ts for source-size discipline.
 * This module owns:
 *
 *   - `defaultRepoRoot()` — resolution order for the
 *     repo root the worker should use.
 *   - `envIdentity()` — closed-world environment record
 *     (os / arch / node / cpu / total memory / contract
 *     / profile / run-id).
 *   - `substrateBindingFromFiles()` — accumulates ALL six
 *     substrate commit fields (Phase E, LH-02, LH-03,
 *     LH-04, LH-05, repo) by reading the canonical
 *     qualification artifacts + resolving the live repo
 *     HEAD.
 *   - `readRepoCommit()` — resolves the live repo HEAD
 *     to a commit SHA, walking up the tree to find `.git`
 *     and falling back through `packed-refs`.
 *   - `maybeGc()` — opportunistic GC trigger.
 *   - `readJson()` — JSON file reader.
 *
 * The recursive frozen-tree digest is delegated to
 * `./frozen-tree-digest.js`.
 */
import { totalmem } from "node:os";
import { readFileSync } from "node:fs";
import type { LH06SoakProfile } from "./types.js";
import type {
  LH06EnvironmentIdentity,
  LH06SubstrateBinding,
} from "./result.js";
import {
  resolveSoakSubstrateBinding,
  readRepoCommit,
  isSubstrateComplete,
} from "./substrate-authority.js";

export { computeFrozenTreeDigest } from "./frozen-tree-digest.js";

/**
 * L06-CORRECTION11 L06-C43: re-export the authoritative
 * substrate resolver and `isSubstrateComplete` so callers
 * have a single import surface. The previous duplicates in
 * this module have been removed.
 */
export { resolveSoakSubstrateBinding, isSubstrateComplete, readRepoCommit };

/**
 * Default repository root for the soak worker.
 *
 * Resolution order:
 *   1. `LH06_LAB_ROOT` env var (canonical path the
 *      supervisor / run-soak script sets).
 *   2. The current working directory.
 *
 * Note: `readRepoCommit` (below) walks up the tree to
 * find `.git` so it works even when the lab root is a
 * sub-directory of the actual git checkout.
 */
export function defaultRepoRoot(): string {
  return process.env["LH06_LAB_ROOT"] ?? process.cwd();
}

export function envIdentity(
  runId: string,
  profile: LH06SoakProfile,
  contractVersion: string,
): LH06EnvironmentIdentity {
  const procAny = process as unknown as {
    availableParallelism?: () => number;
  };
  return Object.freeze({
    os: `${process.platform}/${process.arch}`,
    arch: process.arch,
    node_version: process.version,
    cpu_count:
      typeof procAny.availableParallelism === "function"
        ? procAny.availableParallelism()
        : 1,
    // Total system memory (NOT process RSS — RSS lives in
    // resource telemetry where it belongs, since it can
    // grow independently of V8 heap due to allocator
    // fragmentation).
    total_memory_bytes: totalmem(),
    contract_version: contractVersion,
    profile,
    soak_run_id: runId,
  });
}

/**
 * Resolve the current repository HEAD to a commit SHA.
 *
 * L06-CORRECTION11 L06-C43: delegated to the authoritative
 * resolver in `substrate-authority.ts`. The closed-world
 * resolver is the SINGLE source of truth for every
 * substrate identity (including repo_commit). The previous
 * inline implementation here duplicated git plumbing and
 * could drift from the authority module.
 */
export function readRepoCommitLocal(repoRoot: string): string | null {
  return readRepoCommit(repoRoot);
}

/**
 * Read a JSON file. Pure; throws on parse errors.
 */
export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

/**
 * Accumulate the full substrate binding. The result has six
 * fields, each populated when the corresponding source is
 * available:
 *
 *   phase_e_head       — qualification/capability-matrix.json
 *   lh02_head          — qualification/capability-matrix.json
 *   lh03_frozen_commit — qualification/lh03-frozen.json
 *   lh04_frozen_commit — qualification/lh04-frozen.json
 *   lh05_corpus_commit — qualification/lh05-...-corpus.json
 *   repo_commit        — resolved from the live .git HEAD
 *
 * Returns null when the corresponding source is not
 * present; the binding records ALL six independently.
 *
 * L06-CORRECTION03 L06-C21: `isSubstrateComplete(b)` is the
 * closed-world check the supervisor / qualification uses
 * to refuse any PASS whose substrate is partial.
 */
export function substrateBindingFromFiles(
  repoRoot: string,
  override?: LH06SubstrateBinding,
): LH06SubstrateBinding {
  // L06-CORRECTION03 L06-C21: a CI_SMOKE-only test seam
  // that injects a complete substrate without consulting
  // the live qualification artifacts. Production
  // profiles (QUALIFICATION / EXTENDED) MUST use the
  // live files; the override is rejected by the worker
  // for those profiles.
  if (override !== undefined) return override;
  // L06-CORRECTION11 L06-C43: delegate to the closed-world
  // authority resolver. The previous implementation tried
  // to read phase_e_head and lh02_head from the capability-
  // matrix artifact, which is a source-authority error
  // (those fields are not present in that record).
  const resolved = resolveSoakSubstrateBinding({ repoRoot });
  if (!resolved.ok) {
    // Typed failure. Return a binding with null entries
    // for the offending fields and the rest as resolved.
    // The verifier + completeness check will surface the
    // missing identity. We deliberately do NOT throw here
    // so that crash-side artefact synthesis can still
    // produce a terminal result.
    return {
      phase_e_head: null,
      lh02_head: null,
      lh03_frozen_commit: null,
      lh04_frozen_commit: null,
      lh05_corpus_commit: null,
      repo_commit: null,
    };
  }
  return resolved.binding;
}

/**
 * L06-CORRECTION11 L06-C43: `isSubstrateComplete` is
 * re-exported from `substrate-authority.ts` (see top of
 * file). The closed-world check requires all six
 * substrate identities to be present. The supervisor
 * re-validates this before promoting the worker artifact
 * (L06-C20).
 */

/**
 * Trigger V8's `gc()` if available. The worker is spawned
 * with `--expose-gc` so this is a no-op when the runtime
 * doesn't expose GC.
 */
export function maybeGc(): void {
  const g = (globalThis as unknown as { gc?: () => void }).gc;
  if (typeof g === "function") {
    try {
      g();
    } catch {
      // ignore
    }
  }
}
