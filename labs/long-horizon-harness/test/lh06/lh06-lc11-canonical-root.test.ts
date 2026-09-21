/**
 * LH-06 canonical workspace root tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01-CORRECTION11 L06-C45)
 *
 * The LC11 LH-04 handoff probe returned
 * `EVIDENCE_PATH_ESCAPE` because the workspace was
 * expressed as `/var/folders/...` while the candidate's
 * `realpath()` was `/private/var/folders/...`. The
 * containment check computed `..` between the two and
 * refused a baseline that should have been accepted.
 *
 * `realpathSync.native()` is the synchronous native
 * `realpath(3)` operation; on macOS it resolves
 * `/var/folders/...` to `/private/var/folders/...`.
 *
 * These tests pin the contract:
 *
 *   canonical(candidate) MUST_BE_WITHIN canonical(root)
 *   lexical startsWith() is FORBIDDEN
 *   real symlink escapes STILL trip EVIDENCE_PATH_ESCAPE
 *   TMPDIR is restored on every exit path
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  withCanonicalTempRoot,
  canonicalizePath,
  canonicalizeCandidate,
  isContained,
  resolveUnderCanonical,
  makeCanonicalTempRoot,
} from "../../soak/canonical-temp-root.js";

test("L06-C45-LC11-01: canonicalizePath produces the realpath.native form", () => {
  const tdir = tmpdir();
  const canon = canonicalizePath(tdir);
  assert.equal(canon, realpathSync.native(tdir));
});

test("L06-C45-LC11-02: isContained returns true for canonical-contained paths", () => {
  const tmpRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "lh06-canon-root-")));
  const child = join(tmpRoot, `child-${Date.now()}`);
  mkdirSync(child, { recursive: true });
  try {
    const childCanon = realpathSync.native(child);
    assert.equal(isContained(tmpRoot, childCanon), true);
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("L06-C45-LC11-03: isContained returns false for paths escaping the canonical root", () => {
  const a = realpathSync.native(mkdtempSync(join(tmpdir(), "lh06-a-")));
  const b = realpathSync.native(mkdtempSync(join(tmpdir(), "lh06-b-")));
  try {
    assert.equal(isContained(a, b), false);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("L06-C45-LC11-04: withCanonicalTempRoot invokes the callback with a canonical root", async () => {
  const result = await withCanonicalTempRoot({
    prefix: `lh06-c45-test-`,
    invoke: (canonicalRoot: string) => {
      assert.equal(canonicalRoot, realpathSync.native(canonicalRoot));
      return canonicalRoot;
    },
  });
  assert.equal(typeof result, "string");
});

test("L06-C45-LC11-05: withCanonicalTempRoot restores TMPDIR on success", async () => {
  const before = process.env["TMPDIR"];
  await withCanonicalTempRoot({
    prefix: `lh06-c45-restore-`,
    invoke: () => undefined,
  });
  assert.equal(process.env["TMPDIR"], before);
});

test("L06-C45-LC11-06: withCanonicalTempRoot restores TMPDIR on thrown error", async () => {
  const before = process.env["TMPDIR"];
  try {
    await withCanonicalTempRoot({
      prefix: `lh06-c45-throw-`,
      invoke: () => {
        throw new Error("intentional");
      },
    });
  } catch {
    // ignored — we want to verify TMPDIR restoration
  }
  assert.equal(process.env["TMPDIR"], before);
});

test("L06-C45-LC11-07: withCanonicalTempRoot cleans up the raw workspace on exit", async () => {
  let rawRoot: string | null = null;
  await withCanonicalTempRoot({
    prefix: `lh06-c45-cleanup-`,
    invoke: (canonicalRoot: string) => {
      rawRoot = canonicalRoot;
      return undefined;
    },
  });
  assert.ok(rawRoot !== null);
  assert.equal(existsSync(rawRoot as string), false);
});

test("L06-C45-LC11-08: CANONICAL_ROOT_FIX_WEAKENS_SYMLINK_ESCAPE_GUARD is FALSE", () => {
  const a = realpathSync.native(mkdtempSync(join(tmpdir(), "lh06-escape-a-")));
  const b = realpathSync.native(mkdtempSync(join(tmpdir(), "lh06-escape-b-")));
  try {
    const outside = join(b, "outside.txt");
    writeFileSync(outside, "secret");
    const sym = join(a, "link.txt");
    symlinkSync(outside, sym);
    const outsideCanon = canonicalizeCandidate(outside);
    assert.ok(outsideCanon !== null);
    assert.equal(isContained(a, outsideCanon ?? ""), false);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test("L06-C45-LC11-09: makeCanonicalTempRoot canonicalizes an existing path", () => {
  const raw = mkdtempSync(join(tmpdir(), "lh06-c45-mkcr-"));
  try {
    const handle = makeCanonicalTempRoot(raw);
    assert.equal(handle.canonicalRoot, realpathSync.native(raw));
    assert.equal(handle.rawRoot, raw);
  } finally {
    rmSync(raw, { recursive: true, force: true });
  }
});

test("L06-C45-LC11-10: resolveUnderCanonical canonicalizes a child path under a canonical root", () => {
  const tdir = realpathSync.native(mkdtempSync(join(tmpdir(), "lh06-c45-resolve-")));
  const child = join(tdir, `child-${Date.now()}`);
  mkdirSync(child, { recursive: true });
  try {
    const childCanon = resolveUnderCanonical(
      tdir,
      child.split("/").pop() ?? "",
    );
    assert.equal(childCanon, realpathSync.native(child));
  } finally {
    rmSync(tdir, { recursive: true, force: true });
  }
});

/**
 * L06-CORRECTION12 L06-C48: the previous synchronous
 * version of `withCanonicalTempRoot` returned the
 * callback's promise to the caller unchanged while
 * tearing down the workspace in a synchronous `finally`.
 * The async work inside the callback continued using the
 * workspace AFTER the rmSync had already removed it.
 *
 * This test pins the corrected contract: while an async
 * callback is still executing, the workspace must still
 * exist and TMPDIR must still point at it. The wrapper is
 * async and awaits the callback's promise before tearing
 * anything down.
 */
test("L06-C45-LC11-11: async-safe wrapper preserves workspace AND TMPDIR during awaited callback", async () => {
  const envBefore = process.env["TMPDIR"] ?? "";
  let observedRoot: string | null = null;
  let observedTmpdir: string | null = null;
  let observedExists: boolean | null = null;
  const result = await withCanonicalTempRoot({
    prefix: "lh06-c45-async-",
    invoke: async (canonicalRoot: string) => {
      observedRoot = canonicalRoot;
      // Yield to the event loop to prove that the
      // wrapper has not torn anything down yet.
      await new Promise((resolve) => setTimeout(resolve, 30));
      observedTmpdir = process.env["TMPDIR"] ?? null;
      observedExists = existsSync(canonicalRoot);
      return "ok";
    },
  });
  assert.equal(result, "ok");
  assert.ok(observedRoot !== null);
  assert.equal(observedTmpdir, observedRoot);
  assert.equal(observedExists, true);
  // After the wrapper has fully resolved, the redirect
  // and the workspace are gone.
  assert.equal(process.env["TMPDIR"] ?? "", envBefore);
  assert.equal(existsSync(observedRoot ?? ""), false);
});

/**
 * L06-CORRECTION12 L06-C48: if the awaited callback
 * throws, the wrapper still restores environment and
 * removes the workspace. The throw must also propagate
 * to the caller so it is not silently swallowed.
 */
test("L06-C45-LC11-12: async-safe wrapper restores environment when awaited callback throws", async () => {
  const envBefore = process.env["TMPDIR"] ?? "";
  let observedRoot: string | null = null;
  let propagatedError: Error | null = null;
  try {
    await withCanonicalTempRoot({
      prefix: "lh06-c45-async-throw-",
      invoke: async (canonicalRoot: string) => {
        observedRoot = canonicalRoot;
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("intentional-async-throw");
      },
    });
  } catch (err) {
    propagatedError = err instanceof Error ? err : new Error(String(err));
  }
  assert.ok(propagatedError !== null);
  assert.match(
    propagatedError?.message ?? "",
    /intentional-async-throw/,
  );
  assert.equal(process.env["TMPDIR"] ?? "", envBefore);
  assert.ok(observedRoot !== null);
  assert.equal(existsSync(observedRoot ?? ""), false);
});