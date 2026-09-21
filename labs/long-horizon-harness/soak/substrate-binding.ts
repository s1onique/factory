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
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { totalmem } from "node:os";
import { LH06_FROZEN_SUBSTRATE_FILES } from "./contract.js";
import type { LH06SoakProfile } from "./types.js";
import type {
  LH06EnvironmentIdentity,
  LH06SubstrateBinding,
} from "./result.js";

export { computeFrozenTreeDigest } from "./frozen-tree-digest.js";

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
 * Extract `subject.commit` from a qualification JSON shape.
 * Pure; returns null when not present.
 */
function extractSubjectCommit(raw: Record<string, unknown>): string | null {
  const sub = raw["subject"];
  if (sub === undefined || typeof sub !== "object" || sub === null) {
    return null;
  }
  const c = (sub as Record<string, unknown>)["commit"];
  return typeof c === "string" ? c : null;
}

/**
 * Read the SHA of a refs file (e.g. refs/heads/main),
 * relative to a `.git` directory. Returns null when the
 * loose file is missing or empty.
 */
function readRefFileFromGitDir(
  gitDir: string,
  ref: string,
): string | null {
  const loose = resolve(gitDir, ref);
  if (existsSync(loose)) {
    try {
      const v = readFileSync(loose, "utf8").trim();
      if (v.length > 0) return v;
    } catch {
      // fallthrough
    }
  }
  const packed = resolve(gitDir, "packed-refs");
  if (existsSync(packed)) {
    try {
      const lines = readFileSync(packed, "utf8").split(/\r?\n/);
      for (const line of lines) {
        if (line.startsWith("#") || line.length === 0) continue;
        const tab = line.indexOf(" ");
        if (tab < 0) continue;
        const sha = line.slice(0, tab).trim();
        const name = line.slice(tab + 1).trim();
        if (name === ref) return sha;
      }
    } catch {
      // fallthrough
    }
  }
  return null;
}

/**
 * Resolve the current repository HEAD to a commit SHA, not a
 * ref name.
 *
 * Limitation: this implementation assumes `.git` is a
 * directory (the canonical layout for a non-worktree
 * checkout). Factory forbids linked worktrees for the LH-06
 * qualification per `FACTORY_GIT_WORKTREE_POLICY`, so this
 * is acceptable for V1. A linked-worktree `.git` file would
 * currently resolve to null; documented so future migrators
 * don't silently change semantics.
 *
 * For a normal attached branch:
 *
 *   .git/HEAD            = "ref: refs/heads/main"
 *   .git/refs/heads/main = "<commit sha>"
 *
 * For a detached HEAD, `.git/HEAD` already contains the
 * SHA directly.
 *
 * Walks up the directory tree to find `.git` so the worker
 * resolves the commit even when `repoRoot` is a sub-
 * directory of the actual git checkout (e.g.
 * `labs/long-horizon-harness/`). Falls back to the loose
 * `packed-refs` file when the loose ref file is missing.
 */
export function readRepoCommit(repoRoot: string): string | null {
  let cur = repoRoot;
  let gitDir: string | null = null;
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(cur, ".git");
    if (existsSync(candidate)) {
      gitDir = candidate;
      break;
    }
    const parent = resolve(cur, "..");
    if (parent === cur) break;
    cur = parent;
  }
  if (gitDir === null) return null;
  const headPath = resolve(gitDir, "HEAD");
  if (!existsSync(headPath)) return null;
  try {
    const head = readFileSync(headPath, "utf8").trim();
    if (head.startsWith("ref:")) {
      const ref = head.slice(5).trim();
      return readRefFileFromGitDir(gitDir, ref);
    }
    // Detached HEAD — already a SHA.
    return head;
  } catch {
    return null;
  }
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
  let lh03_frozen_commit: string | null = null;
  let lh04_frozen_commit: string | null = null;
  let lh05_corpus_commit: string | null = null;
  for (const [k, rel] of Object.entries(LH06_FROZEN_SUBSTRATE_FILES)) {
    const abs = resolve(repoRoot, rel);
    if (!existsSync(abs)) continue;
    try {
      const raw = readJson(abs) as Record<string, unknown>;
      if (k === "lh03_frozen") {
        lh03_frozen_commit = extractSubjectCommit(raw);
      } else if (k === "lh04_frozen") {
        lh04_frozen_commit = extractSubjectCommit(raw);
      } else if (k === "lh05_corpus") {
        lh05_corpus_commit = extractSubjectCommit(raw);
      }
    } catch {
      // ignore
    }
  }
  let phase_e_head: string | null = null;
  let lh02_head: string | null = null;
  const matrixPath = resolve(
    repoRoot,
    "qualification/capability-matrix.json",
  );
  if (existsSync(matrixPath)) {
    try {
      const matrix = readJson(matrixPath) as Record<string, unknown>;
      const sub = matrix["subject"];
      if (sub !== undefined && typeof sub === "object" && sub !== null) {
        const c = (sub as Record<string, unknown>)["commit"];
        if (typeof c === "string") phase_e_head = c;
      }
      const lh02 = matrix["lh02_head"];
      if (typeof lh02 === "string") lh02_head = lh02;
    } catch {
      // ignore
    }
  }
  return {
    phase_e_head,
    lh02_head,
    lh03_frozen_commit,
    lh04_frozen_commit,
    lh05_corpus_commit,
    repo_commit: readRepoCommit(repoRoot),
  };
}

/**
 * L06-CORRECTION03 L06-C21: closed-world substrate
 * completeness check. PASS_DETERMINISTIC_SOAK requires
 * ALL six substrate identities to be present. The
 * supervisor re-validates this before promoting the
 * worker artifact (L06-C20).
 */
export function isSubstrateComplete(
  b: LH06SubstrateBinding,
): boolean {
  return (
    b.phase_e_head !== null &&
    b.lh02_head !== null &&
    b.lh03_frozen_commit !== null &&
    b.lh04_frozen_commit !== null &&
    b.lh05_corpus_commit !== null &&
    b.repo_commit !== null
  );
}

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
