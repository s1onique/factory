/**
 * LH-06 deterministic long-duration soak laboratory —
 * frozen-tree digest.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Split from substrate-binding.ts for source-size discipline
 * (was 403 LOC). This module owns:
 *
 *   - `computeFrozenTreeDigest()` — recursive SHA-256 over
 *     every file under `LH06_FROZEN_TREE_PATHS`, with
 *     repository-relative path identities so identical
 *     basenames in different frozen roots cannot collide.
 *   - The supporting `listFilesRecursive()` /
 *     `toRelativePosix()` helpers.
 *
 * L06-CORRECTION03 L06-C16: the digest result is a closed
 * sum type. Missing / unreadable / duplicate-identity
 * conditions return `{ ok: false, kind, ... }` and can
 * NEVER be folded into an apparently valid digest. The
 * previous `string | null` contract allowed a path that
 * existed at run-start and disappeared at run-end to
 * digest identically, masking a FROZEN_MUTATION as a
 * silent PASS.
 *
 * The digester input format is:
 *
 *   for each path (sorted lexically):
 *     "\n#" + path + "\n" + sha256(bytes)
 *
 * Order is fully deterministic; no mtime / inode metadata
 * is consumed, so the digest is reproducible across runs.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { LH06_FROZEN_TREE_PATHS } from "./contract.js";

/**
 * L06-CORRECTION03 L06-C16: closed-world frozen-tree digest
 * result. `ok=true` carries a deterministic SHA-256 digest
 * over the FULL frozen tree. `ok=false` carries a typed
 * reason plus a structured detail record. The caller
 * (worker / supervisor) MUST refuse PASS on any
 * `{ok:false}` result.
 */
export type FrozenTreeDigestResult =
  | { readonly ok: true; readonly digest: string }
  | {
      readonly ok: false;
      readonly kind:
        | "MISSING_EVIDENCE"
        | "UNREADABLE_EVIDENCE"
        | "DUPLICATE_FROZEN_PATH_IDENTITY"
        | "INVALID_FROZEN_TREE_DECLARATION";
      readonly path: string;
      readonly detail: string;
    };

/**
 * Recursively enumerate a directory and return sorted
 * REPO-RELATIVE file paths (forward slashes). `repoRoot` is
 * the immutable anchor for the relative-path computation —
 * every entry is reported relative to the repository, not
 * relative to the directory currently being walked.
 *
 * Bug fix from L06-CORRECTION02: previously the function
 * was called with `(absDir, absDir)`, producing paths like
 * `foo.ts` instead of `src/run/foo.ts`. Identical basenames
 * from different frozen roots then collided in a Set,
 * silently truncating the fingerprint.
 *
 * L06-CORRECTION03 L06-C16: returns `null` on a directory
 * read error so the caller can surface UNREADABLE_EVIDENCE
 * rather than silently dropping the subtree.
 */
function listFilesRecursive(
  absDir: string,
  repoRoot: string,
): readonly string[] | null {
  let entries: readonly import("node:fs").Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const out: string[] = [];
  for (const e of entries) {
    const child = resolve(absDir, e.name);
    if (e.isDirectory()) {
      const sub = listFilesRecursive(child, repoRoot);
      if (sub === null) return null;
      for (const f of sub) out.push(f);
    } else if (e.isFile()) {
      out.push(toRelativePosix(child, repoRoot));
    }
  }
  out.sort();
  return Object.freeze(out);
}

/**
 * Compute the absolute path of `abs` relative to `absRoot`,
 * using forward-slash separators.
 */
function toRelativePosix(abs: string, absRoot: string): string {
  let rel = abs;
  if (rel.startsWith(absRoot + "/")) {
    rel = rel.slice(absRoot.length + 1);
  } else if (rel.startsWith(absRoot)) {
    rel = rel.slice(absRoot.length);
  }
  return rel.split("\\").join("/");
}

/**
 * Recursive frozen-tree digest.
 *
 * The V1 frozen-tree paths are a mix of directories and
 * explicit files. For directories we enumerate every file
 * recursively; for files we hash the file bytes. The hash
 * input is:
 *
 *   for each path (sorted lexically):
 *     "\n#" + path + "\n" + sha256(bytes)
 *
 * All stored identities are REPOSITORY-relative
 * (e.g. `src/run/foo.ts`, `lifecycle-corpus/index.ts`), so
 * different frozen roots cannot collide even when they
 * share basenames.
 *
 * L06-CORRECTION03 L06-C16: missing / unreadable / duplicate
 * frozen-tree evidence is a TYPED FAILURE returned to the
 * caller; it is NOT folded into a valid-looking digest.
 * The previous behaviour (insert `:MISSING` sentinels,
 * continue, return an ordinary SHA-256) was a fail-open
 * pattern: if a file existed before the run but was deleted
 * during the run, the before/after digests compared equal
 * and FROZEN_MUTATION went unreported.
 *
 * L06-CORRECTION03 L06-C16 (duplicate identity): an
 * accidental overlapping frozen-root declaration (two
 * `LH06_FROZEN_TREE_PATHS` entries whose recursive walks
 * share a file) MUST surface as
 * `DUPLICATE_FROZEN_PATH_IDENTITY`. The previous `Set`
 * implementation silently deduplicated, hiding the bug.
 *
 * The supervisor MUST refuse to promote any worker result
 * whose frozen-tree digest is `{ok: false}`.
 */
export function computeFrozenTreeDigest(
  repoRoot: string,
): FrozenTreeDigestResult {
  // Map: repo-relative path -> [list of declared roots that
  // produced it]. Two distinct roots producing the same
  // identity is the duplicate-frozen-path error.
  const identityOwners = new Map<string, string[]>();
  const collected: string[] = [];

  for (const rel of LH06_FROZEN_TREE_PATHS) {
    const abs = resolve(repoRoot, rel);
    if (!existsSync(abs)) {
      return {
        ok: false,
        kind: "MISSING_EVIDENCE",
        path: rel,
        detail: `frozen tree root does not exist: ${abs}`,
      };
    }
    let st;
    try {
      st = statSync(abs);
    } catch (e) {
      return {
        ok: false,
        kind: "UNREADABLE_EVIDENCE",
        path: rel,
        detail:
          e instanceof Error ? e.message : `stat failed for ${abs}`,
      };
    }
    if (st.isDirectory()) {
      const sub = listFilesRecursive(abs, repoRoot);
      if (sub === null) {
        return {
          ok: false,
          kind: "UNREADABLE_EVIDENCE",
          path: rel,
          detail: `recursive read failed under ${abs}`,
        };
      }
      for (const f of sub) {
        const owners = identityOwners.get(f) ?? [];
        owners.push(rel);
        identityOwners.set(f, owners);
        collected.push(f);
      }
    } else if (st.isFile()) {
      const rp = toRelativePosix(abs, repoRoot);
      const owners = identityOwners.get(rp) ?? [];
      owners.push(rel);
      identityOwners.set(rp, owners);
      collected.push(rp);
    } else {
      return {
        ok: false,
        kind: "INVALID_FROZEN_TREE_DECLARATION",
        path: rel,
        detail: `frozen tree path is neither file nor directory: ${abs}`,
      };
    }
  }
  // Detect duplicate identities (multiple frozen-tree
  // declarations producing the same repo-relative path).
  for (const [identity, owners] of identityOwners.entries()) {
    if (owners.length > 1) {
      return {
        ok: false,
        kind: "DUPLICATE_FROZEN_PATH_IDENTITY",
        path: identity,
        detail:
          `identity produced by ${owners.length} frozen roots: ` +
          owners.join(", "),
      };
    }
  }
  const sorted = [...collected].sort();
  const h = createHash("sha256");
  for (const p of sorted) {
    h.update(`\n#${p}\n`);
    const abs = resolve(repoRoot, p);
    let bytes: Buffer;
    try {
      bytes = readFileSync(abs);
    } catch (e) {
      return {
        ok: false,
        kind: "UNREADABLE_EVIDENCE",
        path: p,
        detail:
          e instanceof Error ? e.message : `readFileSync failed for ${abs}`,
      };
    }
    h.update(createHash("sha256").update(bytes).digest("hex"));
  }
  return { ok: true, digest: h.digest("hex") };
}
