/**
 * LH-06 lab-root test helper.
 *
 * The test suite needs a single, repository-relative path
 * to the long-horizon-harness lab root. We resolve it
 * once via `import.meta.url` so the tests work both when
 * the lab is the cwd (the production qualification path)
 * and when the harness is launched from a different cwd
 * (the supervisor path).
 */
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const LH06_LAB_ROOT = resolve(here, "..", "..");
export const LH06_REPO_ROOT = resolve(LH06_LAB_ROOT, "..", "..");

/**
 * L06-CORRECTION12 L06-C49: returns the lab root from the
 * runtime cwd when possible, otherwise walks up from this
 * helper's directory. Used by the bridge-oracle tests that
 * invoke the real `runScenarioForHarness` against LC11.
 */
function looksLikeLabRoot(dir: string): boolean {
  return (
    existsSync(resolve(dir, "lifecycle-corpus")) &&
    existsSync(resolve(dir, "fault-lab")) &&
    existsSync(resolve(dir, "soak"))
  );
}

export function labRoot(): string {
  const cwd = process.cwd();
  if (looksLikeLabRoot(cwd)) return cwd;
  let candidate = here;
  for (let i = 0; i < 8; i++) {
    if (looksLikeLabRoot(candidate)) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(
    "lh06 lab-root not found: tests must be launched from " +
      "the long-horizon-harness directory (or a worktree " +
      "that contains lifecycle-corpus/, fault-lab/, soak/).",
  );
}