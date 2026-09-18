/**
 * CORRECTION06 / CORRECTION08 test helper: typed
 * invocation evidence + execution-capture manifest
 * builders + fixture loaders.
 *
 * Tests use this helper to:
 *
 *   1. Load a typed InvocationEvidence object from a
 *      canonical fixture path.
 *   2. Load a typed ExecutionCaptureManifest from a
 *      canonical fixture path.
 *   3. Receive the object and the path back, so they
 *      can be passed to `defaultPiCapabilities`.
 */
import {
  type InvocationEvidence,
} from "../../src/adapter-common/invocation-evidence.js";
import {
  readInvocationEvidence,
} from "../../src/adapter-common/invocation-evidence.js";
import {
  type ExecutionCaptureManifest,
} from "../../src/adapter-common/execution-capture.js";
import {
  shaOfExecutionCaptureManifest,
} from "../../src/adapter-common/execution-capture.js";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

export const INVOCATION_FIXTURE_DIR =
  "test/fixtures/harnesses/pi/pi-v0_85_1/invocations";

export const CAPTURE_FIXTURE_DIR =
  "test/fixtures/harnesses/pi/pi-v0_85_1/captures";

export type BuiltInvocation = {
  readonly evidence: InvocationEvidence;
  readonly repo_relative_path: string;
};

export type BuiltCapture = {
  readonly manifest: ExecutionCaptureManifest;
  readonly manifest_sha256: string;
  readonly repo_relative_path: string;
};

/**
 * Load a typed InvocationEvidence from the canonical
 * fixture directory.
 */
export function loadInvocationFixture(args: {
  readonly repoRoot: string;
  readonly capability: string;
}): BuiltInvocation {
  const repo_relative_path = `${INVOCATION_FIXTURE_DIR}/${args.capability}.invocation.json`;
  const absolute = resolve(args.repoRoot, repo_relative_path);
  const evidence = readInvocationEvidence(repo_relative_path, args.repoRoot);
  if (evidence === null) {
    throw new Error(
      `loadInvocationFixture: cannot read '${absolute}'`,
    );
  }
  return { evidence, repo_relative_path };
}

/**
 * Load a typed ExecutionCaptureManifest from the
 * canonical fixture directory (CORRECTION08 C08-01).
 * The manifest carries the execution_id + invocation
 * SHA + native artifact SHA + runtime session file
 * path that the verifier cross-references.
 */
export function loadCaptureFixture(args: {
  readonly repoRoot: string;
  readonly capability: string;
}): BuiltCapture {
  const repo_relative_path = `${CAPTURE_FIXTURE_DIR}/${args.capability}.capture.json`;
  const manifest_sha256 = shaOfExecutionCaptureManifest(
    repo_relative_path,
    args.repoRoot,
  );
  if (manifest_sha256 === null) {
    throw new Error(
      `loadCaptureFixture: cannot hash '${repo_relative_path}'`,
    );
  }
  // Re-read the manifest through readExecutionCaptureManifest
  // would also work, but we want the raw SHA. We
  // deliberately re-parse the file here in the test
  // helper (not in src/adapter-common/) so that the
  // trust-boundary rule continues to hold for the
  // production source. Tests are allowed to parse JSON.
  const raw = readFileSync(resolve(args.repoRoot, repo_relative_path), "utf8");
  const manifest = JSON.parse(raw) as ExecutionCaptureManifest;
  return { manifest, manifest_sha256, repo_relative_path };
}

/**
 * Load a headless invocation whose `capability` field
 * has been rewritten to the requested axis key. Used
 * by tests where every capability needs its own
 * invocation artifact (verifier enforces
 * `invocation.capability === axis_key`).
 */
export function loadHeadlessInvocationForAxis(args: {
  readonly repoRoot: string;
  readonly capability: string;
}): BuiltInvocation {
  const base = loadInvocationFixture({
    repoRoot: args.repoRoot,
    capability: "HEADLESS",
  });
  return {
    evidence: { ...base.evidence, capability: args.capability },
    repo_relative_path: base.repo_relative_path,
  };
}
