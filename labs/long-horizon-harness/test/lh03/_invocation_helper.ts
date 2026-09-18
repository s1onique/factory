/**
 * CORRECTION06 test helper: typed invocation evidence
 * builders + a fixture loader.
 *
 * Tests use this helper to:
 *
 *   1. Load a typed InvocationEvidence object from a
 *      canonical fixture path.
 *   2. Receive the object and the path back, so they
 *      can be passed to `defaultPiCapabilities`.
 */
import {
  type InvocationEvidence,
} from "../../src/adapter-common/invocation-evidence.js";
import {
  readInvocationEvidence,
} from "../../src/adapter-common/invocation-evidence.js";
import { resolve } from "node:path";

export const INVOCATION_FIXTURE_DIR =
  "test/fixtures/harnesses/pi/pi-v0_85_1/invocations";

export type BuiltInvocation = {
  readonly evidence: InvocationEvidence;
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
