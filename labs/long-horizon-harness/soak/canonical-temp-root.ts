/**
 * LH-06 canonical-temp-root wrapper for the LC11 / LH-04
 * handoff.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01-CORRECTION11 L06-C45)
 *
 * A direct LC11 baseline probe returned
 * `EVIDENCE_PATH_ESCAPE` when the temporary workspace
 * root was expressed as `/var/folders/.../workspace`
 * while the candidate artifact's `realpath()` was
 * `/private/var/folders/.../workspace/file`. The verifier
 * compares the candidate's realpath against the trusted
 * root's realpath; when one is canonical and the other
 * is not, the relative computation returns `..` and a
 * real escape is fabricated.
 *
 * `realpathSync.native()` is the synchronous native
 * `realpath(3)` operation that resolves `.` / `..` and
 * symbolic links into a resolved pathname. On macOS the
 * canonical form of `/var/folders/...` is
 * `/private/var/folders/...`; on Linux the two are
 * identical. The wrapper below canonicalizes BOTH the
 * trusted workspace root AND the candidate before any
 * containment comparison.
 *
 * L06-CORRECTION11 L06-C45: the fix is an LH-06-local
 * execution environment seam — a bounded wrapper that
 * supplies a canonical root to the LC11 bridge. We do
 * NOT edit the frozen LH-05 runner.
 */

import {
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

/**
 * Canonicalized temporary workspace root for the LH-05
 * LH-04 handoff. The root has been passed through
 * `realpathSync.native` so the verifier's containment
 * comparison operates on a canonical pair.
 */
export interface CanonicalTempRoot {
  readonly canonicalRoot: string;
  /** Pre-canonicalization root (used for cleanup). */
  readonly rawRoot: string;
}

/**
 * Compute a canonical temporary workspace and run the
 * supplied callback inside it. The environment variable
 * block (TMPDIR / TMP / TEMP) is redirected to the
 * canonical root for the duration of the callback; both
 * the redirect and the workspace directory are torn down
 * in a `finally` AFTER the awaited promise resolves.
 *
 * L06-CORRECTION12 L06-C48: this function is ASYNC. The
 * callback's returned promise is awaited BEFORE the
 * environment restore and the rmSync run. A previous
 * synchronous version of this wrapper returned the
 * callback's promise to the caller unchanged while
 * tearing down the workspace in a synchronous `finally`,
 * which destroyed the workspace before the async work
 * inside the callback could finish using it (CORRECTION11
 * bug; the SRE reviewer caught it during
 * QUALIFICATION01 review).
 *
 * L06-CORRECTION11 L06-C45: this wrapper creates a
 * canonical parent directory (one whose `realpath`
 * equals its literal path), sets TMPDIR to that canonical
 * parent for the duration of `invoke`, and restores the
 * original TMPDIR (and removes the parent) in a `finally`.
 * The downstream `mkdtempSync` therefore returns paths
 * that are already in canonical form — there is no
 * `/var/folders/...` vs `/private/var/folders/...`
 * mismatch to trip the verifier.
 */
export async function withCanonicalTempRoot<T>(args: {
  readonly prefix?: string;
  readonly envTempRoot?: string;
  readonly invoke: (root: string) => Promise<T> | T;
}): Promise<T> {
  // Step 1: read existing temp-root state.
  const baseRaw =
    args.envTempRoot ??
    process.env["TMPDIR"] ??
    process.env["TMP"] ??
    process.env["TEMP"] ??
    tmpdir();
  // Step 2: canonicalize the existing temp root.
  const baseCanonical = realpathSync.native(baseRaw);
  const prefix = args.prefix ?? "lh06-canonical-temp-";
  // Step 3: create a child under the canonical parent
  // (this is the "set TMPDIR" portion — done by
  // `mkdtempSync`, which honors the parent argument).
  const rawRoot = mkdtempSync(`${baseCanonical}/${prefix}`);
  const canonicalRoot = realpathSync.native(rawRoot);
  // Step 4: also set process.env["TMPDIR"] for the
  // duration, so a downstream caller that reads
  // `process.env["TMPDIR"]` instead of calling
  // `os.tmpdir()` sees the canonical form too. We save
  // and restore the previous values mechanically.
  const savedTmpdir = process.env["TMPDIR"];
  const savedTmp = process.env["TMP"];
  const savedTemp = process.env["TEMP"];
  process.env["TMPDIR"] = canonicalRoot;
  process.env["TMP"] = canonicalRoot;
  process.env["TEMP"] = canonicalRoot;
  try {
    // L06-CORRECTION12 L06-C48: await the callback before
    // tearing down the redirect / workspace. A sync
    // return here previously destroyed the workspace
    // before any async work could touch it.
    return await args.invoke(canonicalRoot);
  } finally {
    // Step 6: restore original environment in finally
    // (success, thrown error, or returned rejection).
    if (savedTmpdir === undefined) delete process.env["TMPDIR"];
    else process.env["TMPDIR"] = savedTmpdir;
    if (savedTmp === undefined) delete process.env["TMP"];
    else process.env["TMP"] = savedTmp;
    if (savedTemp === undefined) delete process.env["TEMP"];
    else process.env["TEMP"] = savedTemp;
    try {
      rmSync(rawRoot, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Cleanup-only variant. Useful for tests that create a
 * canonical root directly without invoking the wrapper.
 */
export function cleanupCanonicalTempRoot(handle: CanonicalTempRoot): void {
  try {
    rmSync(handle.rawRoot, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Canonicalize a single absolute path WITHOUT any
 * filesystem side effects.
 */
export function canonicalizePath(path: string): string {
  return realpathSync.native(path);
}

/**
 * Build a canonical handle from an already-existing path.
 */
export function makeCanonicalTempRoot(rawRoot: string): CanonicalTempRoot {
  const canonicalRoot = realpathSync.native(rawRoot);
  return { canonicalRoot, rawRoot };
}

/**
 * Convert a candidate path to its canonical form for
 * safe containment comparison. Returns null when the path
 * does not exist.
 */
export function canonicalizeCandidate(candidatePath: string): string | null {
  try {
    return realpathSync.native(candidatePath);
  } catch {
    return null;
  }
}

/**
 * Containment predicate. Both inputs MUST be canonical.
 * Returns true when `candidate` is inside (or equal to)
 * `root`. Lexical startsWith() is FORBIDDEN here.
 */
export function isContained(
  rootCanonical: string,
  candidateCanonical: string,
): boolean {
  if (rootCanonical === candidateCanonical) return true;
  const rootWithSep = rootCanonical.endsWith("/")
    ? rootCanonical
    : rootCanonical + "/";
  return (
    candidateCanonical === rootCanonical ||
    candidateCanonical.startsWith(rootWithSep)
  );
}

/**
 * Re-export `realpathSync` for assertion convenience.
 */
export { realpathSync };

/**
 * Resolve a path under a canonical root, then canonicalize.
 */
export function resolveUnderCanonical(
  canonicalRoot: string,
  relativePath: string,
): string {
  return realpathSync.native(resolve(canonicalRoot, relativePath));
}

