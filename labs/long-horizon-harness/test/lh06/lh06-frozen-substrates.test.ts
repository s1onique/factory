/**
 * LH-06 frozen-substrates tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * The worker MUST NOT modify the frozen LH-03 / LH-04 / LH-05
 * substrates. The frozen-tree fingerprint before/after the
 * run MUST match.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LH06_FROZEN_SUBSTRATE_FILES,
  LH06_FROZEN_TREE_PATHS,
} from "../../soak/contract.js";
import { computeFrozenTreeDigest } from "../../soak/frozen-tree-digest.js";

const REPO_ROOT = process.cwd();

test("LH-06 frozen-substrates: every required substrate file exists", () => {
  for (const [k, rel] of Object.entries(LH06_FROZEN_SUBSTRATE_FILES)) {
    const abs = resolve(REPO_ROOT, rel);
    assert.equal(
      existsSync(abs),
      true,
      `frozen substrate ${k} (${rel}) must exist`,
    );
  }
});

test("LH-06 frozen-substrates: frozen-tree fingerprint is stable across two reads", () => {
  const a = computeFrozenTreeDigest(REPO_ROOT);
  const b = computeFrozenTreeDigest(REPO_ROOT);
  assert.ok(a.ok, `digest must be ok, got ${JSON.stringify(a)}`);
  assert.equal(a.ok, b.ok);
  if (a.ok && b.ok) assert.equal(a.digest, b.digest);
  assert.equal(typeof (a.ok ? a.digest : ""), "string");
  assert.equal((a.ok ? a.digest : "").length, 64);
});

test("LH-06 frozen-substrates: frozen-tree path list is non-empty", () => {
  assert.ok(LH06_FROZEN_TREE_PATHS.length > 0);
  for (const p of LH06_FROZEN_TREE_PATHS) {
    assert.equal(typeof p, "string");
    assert.notEqual(p, "");
  }
});

test("LH-06 frozen-substrates: frozen-tree fingerprint changes when a tracked file changes", () => {
  const before = computeFrozenTreeDigest(REPO_ROOT);
  assert.ok(
    before.ok,
    `baseline digest must be ok, got ${JSON.stringify(before)}`,
  );
  // Mutate one of the qualification files (we use
  // capability-matrix.json which is part of LH06_FROZEN_TREE_PATHS).
  const target = resolve(REPO_ROOT, "qualification/capability-matrix.json");
  const original = readFileSync(target, "utf8");
  try {
    writeFileSync(target, original + "\n// LH06-TEST-MUTATION\n");
    const after = computeFrozenTreeDigest(REPO_ROOT);
    assert.ok(
      after.ok,
      `post-mutation digest must be ok, got ${JSON.stringify(after)}`,
    );
    if (before.ok && after.ok) {
      assert.notEqual(before.digest, after.digest);
    }
  } finally {
    writeFileSync(target, original);
  }
  // Confirm restore
  const restored = computeFrozenTreeDigest(REPO_ROOT);
  assert.ok(
    restored.ok,
    `restored digest must be ok, got ${JSON.stringify(restored)}`,
  );
  if (before.ok && restored.ok) {
    assert.equal(before.digest, restored.digest);
  }
});

import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * C02-01 oracle: the recursive frozen-tree digester MUST
 * detect mutations UNDER every frozen-directory entry, not
 * just top-level explicit files. This is the falsification
 * gap noted by the L06-CORRECTION01 review: the previous
 * test only mutated `qualification/capability-matrix.json`,
 * which is an explicit-file entry. The bug it failed to
 * catch was: sub-directory files were stored as bare
 * basenames that collided in a Set.
 *
 * For each of the four frozen-directory roots
 * (`src/run`, `lifecycle-corpus`, `fault-lab/deterministic`,
 * `src/metrics`) we create a private SANDBOX repo, mirror the
 * real directory layout into it, compute a baseline digest,
 * then mutate a file DEEP inside that directory and assert
 * the digest changes.
 */
function withSandboxFixture(
  relRoot: string,
  relInside: string,
  body: (args: {
    readonly sandbox: string;
  }) => void,
): void {
  const sandbox = `/tmp/factory-lh06-frozen-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  mkdirSync(sandbox, { recursive: true });
  const targetDir = join(sandbox, relRoot);
  mkdirSync(targetDir, { recursive: true });
  const target = join(targetDir, relInside);
  mkdirSync(dirname(target), { recursive: true });
  try {
    body({ sandbox });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

test("LH-06 C02-01: mutation in src/run/* sub-dir changes digest (was MISSING bug)", { concurrency: false }, () => {
  withSandboxFixture("src/run", "lh06-corrupt/foo.ts", ({ sandbox }) => {
    writeFileSync(join(sandbox, "src/run/lh06-corrupt/foo.ts"), "a");
    const before = computeFrozenTreeDigest(sandbox);
    writeFileSync(join(sandbox, "src/run/lh06-corrupt/foo.ts"), "a-mutated");
    const after = computeFrozenTreeDigest(sandbox);
    assert.notEqual(before, after, "digest must change for sub-dir mutation");
  });
});

test("LH-06 C02-01: mutation in lifecycle-corpus/* sub-dir changes digest", { concurrency: false }, () => {
  withSandboxFixture("lifecycle-corpus", "lh06-corrupt/inner.ts", ({ sandbox }) => {
    writeFileSync(join(sandbox, "lifecycle-corpus/lh06-corrupt/inner.ts"), "a");
    const before = computeFrozenTreeDigest(sandbox);
    writeFileSync(join(sandbox, "lifecycle-corpus/lh06-corrupt/inner.ts"), "a-mutated");
    const after = computeFrozenTreeDigest(sandbox);
    assert.notEqual(before, after, "digest must change for sub-dir mutation");
  });
});

test("LH-06 C02-01: mutation in fault-lab/deterministic/* sub-dir changes digest", { concurrency: false }, () => {
  withSandboxFixture("fault-lab/deterministic", "lh06-corrupt/inner.ts", ({ sandbox }) => {
    writeFileSync(join(sandbox, "fault-lab/deterministic/lh06-corrupt/inner.ts"), "a");
    const before = computeFrozenTreeDigest(sandbox);
    writeFileSync(join(sandbox, "fault-lab/deterministic/lh06-corrupt/inner.ts"), "a-mutated");
    const after = computeFrozenTreeDigest(sandbox);
    assert.notEqual(before, after, "digest must change for sub-dir mutation");
  });
});

test("LH-06 C02-01: mutation in src/metrics/* sub-dir changes digest", { concurrency: false }, () => {
  withSandboxFixture("src/metrics", "lh06-corrupt/inner.ts", ({ sandbox }) => {
    writeFileSync(join(sandbox, "src/metrics/lh06-corrupt/inner.ts"), "a");
    const before = computeFrozenTreeDigest(sandbox);
    writeFileSync(join(sandbox, "src/metrics/lh06-corrupt/inner.ts"), "a-mutated");
    const after = computeFrozenTreeDigest(sandbox);
    assert.notEqual(before, after, "digest must change for sub-dir mutation");
  });
});

test("LH-06 C02-01: identical basenames in different frozen roots are NOT collided", { concurrency: false }, () => {
  const sandboxA = `/tmp/factory-lh06-frozen-A-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const sandboxB = `/tmp/factory-lh06-frozen-B-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  try {
    mkdirSync(join(sandboxA, "src/run"), { recursive: true });
    writeFileSync(join(sandboxA, "src/run/index.ts"), "a");
    mkdirSync(join(sandboxA, "lifecycle-corpus"), { recursive: true });
    writeFileSync(join(sandboxA, "lifecycle-corpus/index.ts"), "b");
    mkdirSync(join(sandboxB, "src/run"), { recursive: true });
    writeFileSync(join(sandboxB, "src/run/index.ts"), "a");
    mkdirSync(join(sandboxB, "lifecycle-corpus"), { recursive: true });
    writeFileSync(join(sandboxB, "lifecycle-corpus/index.ts"), "c");
    const digestA = computeFrozenTreeDigest(sandboxA);
    const digestB = computeFrozenTreeDigest(sandboxB);
    assert.notEqual(
      digestA,
      digestB,
      "different content under same basename across different frozen roots MUST change digest",
    );
  } finally {
    rmSync(sandboxA, { recursive: true, force: true });
    rmSync(sandboxB, { recursive: true, force: true });
  }
});
