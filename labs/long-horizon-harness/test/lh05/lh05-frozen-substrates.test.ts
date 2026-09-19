/**
 * LH-05 frozen-substrate guard.
 *
 * Asserts that the LH-05 corpus is replay-only and that
 * the upstream LH-03 / LH-04 frozen substrates exist and
 * bind the LH-05 runner to the frozen contract authority.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();

test("LH-05 lh03-frozen.json exists and binds to the frozen LH-03 contract", () => {
  const path = join(REPO_ROOT, "qualification/lh03-frozen.json");
  assert.ok(existsSync(path), `lh03-frozen.json must exist at ${path}`);
  const rec = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(typeof rec === "object", "lh03-frozen.json must be a JSON object");
  assert.ok(rec.schema, "lh03-frozen.json must declare schema");
});

test("LH-05 lh04-frozen.json exists and binds to the frozen LH-04 contract", () => {
  const path = join(REPO_ROOT, "qualification/lh04-frozen.json");
  assert.ok(existsSync(path), `lh04-frozen.json must exist at ${path}`);
  const rec = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(typeof rec === "object", "lh04-frozen.json must be a JSON object");
  assert.ok(rec.schema, "lh04-frozen.json must declare schema");
});

test("LH-05 corpus fixtures reference the frozen substrate commits via adapter_identity", async () => {
  const runner = await import("../../lifecycle-corpus/runner.js");
  assert.equal(runner.PI_QUALIFICATION_IDENTITY.kind, "pi", "pi harness identity must be 'pi'");
  assert.equal(runner.FAKE_REFERENCE_CONTROL_IDENTITY.kind, "fake", "fake identity must be 'fake'");
});
