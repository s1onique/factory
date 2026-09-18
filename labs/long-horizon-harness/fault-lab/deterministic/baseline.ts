/**
 * LH-04 deterministic fault laboratory — canonical
 * baseline construction.
 *
 * The baseline is a typed `HarnessCapabilities` document
 * built from a freshly-copied workspace of the LH-03
 * canonical Pi v0.85.1 fixture set. Every fault
 * experiment:
 *
 *   1. Receives a workspace containing the canonical
 *      fixtures copied into the workspace root.
 *   2. Applies ONE controlled mutation to that
 *      workspace.
 *   3. Re-builds the baseline `HarnessCapabilities` from
 *      the mutated workspace.
 *   4. Runs the closed-world verifier against the
 *      mutated baseline + workspace.
 *
 * The baseline MUST pass the verifier before any
 * mutation is applied. The runner refuses to declare a
 * fault PASS if the unmutated baseline failed (in which
 * case the disposition is `BASELINE_REGRESSION` and the
 * experiment is not qualified).
 *
 * Per-axis wiring follows the post-CORRECTION10 pattern
 * used in `test/lh03/lh03-correction04-axioms.test.ts`:
 * each axis binds its own canonical capture manifest
 * (so `manifest.capability === axis.key`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep as pathSep } from "node:path";
import { createHash } from "node:crypto";
import {
  emptyCapabilities,
  type HarnessCapabilities,
  type CapabilityKey,
  type CapabilityAxis,
} from "../../src/protocol/index.js";
import {
  QUALIFIED_PI_IDENTITY,
} from "../../src/adapters/pi/pi-adapter.js";
import {
  artifactSha256,
  buildProbeEvidence,
  haltProbeEvidence,
} from "../../src/adapter-common/evidence-reader.js";
import {
  shaOfExecutionCaptureManifest,
} from "../../src/adapter-common/execution-capture.js";
import {
  readInvocationEvidence,
} from "../../src/adapter-common/invocation-evidence.js";

const FIXTURE_SESSION =
  "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/pi.session.jsonl";
const FIXTURE_PROCESS =
  "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json";

const PER_AXIS_FIXTURES: readonly string[] = [
  "JSONL",
  "STREAMING_EVENTS",
  "HEADLESS",
  "EXPLICIT_CWD",
  "ISOLATED_DATA_DIR",
  "CANCELLATION",
];

/**
 * Files every baseline workspace MUST carry.
 */
export const CANONICAL_BASELINE_FILES: readonly string[] = [
  "test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/STREAMING_EVENTS.invocation.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/HEADLESS.invocation.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/EXPLICIT_CWD.invocation.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/ISOLATED_DATA_DIR.invocation.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/CANCELLATION.invocation.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/captures/JSONL.capture.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/captures/STREAMING_EVENTS.capture.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/captures/HEADLESS.capture.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/captures/EXPLICIT_CWD.capture.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/captures/ISOLATED_DATA_DIR.capture.json",
  "test/fixtures/harnesses/pi/pi-v0_85_1/captures/CANCELLATION.capture.json",
  FIXTURE_SESSION,
  FIXTURE_PROCESS,
  "test/fixtures/harnesses/pi/pi-v0_85_1/stdout.jsonl",
  "test/fixtures/harnesses/pi/pi-v0_85_1/stderr.txt",
];

/**
 * Build a canonical baseline `HarnessCapabilities`
 * document wired against a freshly-copied workspace.
 *
 * L04-C05 (review pass 1): the lab MUST prove it is
 * mutating the canonical state the LH-03 freeze
 * committed to, not a "nearby valid state" reconstructed
 * from scratch. We therefore start from
 * `loadFrozenCanonicalCapabilities(repoRoot)` — the
 * verbatim `capabilities.json` from the LH-03 freeze —
 * and only mutate the fields the lab legitimately has
 * to rewrite to make the closed-world verifier accept
 * the canonical fixtures as `REPLAY_QUALIFIED`.
 *
 * Concretely, for each wired axis we set
 * `live_qualification` and `probe_evidence` to reflect
 * what the verifier will recompute; everything else
 * (recorded SHAs, paths, capability bits) is left
 * exactly as the frozen doc committed it.
 *
 * Per CORRECTION10, each axis binds its own canonical
 * capture manifest; `manifest.capability === axis.key`.
 */
export function buildCanonicalBaseline(args: {
  readonly workspaceRoot: string;
}): HarnessCapabilities {
  const ws = resolve(args.workspaceRoot);
  const repoRoot = resolve(ws, "..", "..", "..", "..", "..");
  // The workspace is a fresh tmpdir that mirrors
  // the repo layout; resolve the frozen doc from
  // the workspace's mirrored `test/fixtures/...` path
  // so the SHA computation lines up.
  const frozenPath = join(
    ws,
    "test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json",
  );
  if (!existsSync(frozenPath)) {
    throw new Error(
      `buildCanonicalBaseline: frozen capabilities.json missing at ${frozenPath}`,
    );
  }
  const initial = JSON.parse(readFileSync(frozenPath, "utf8")) as Record<string, unknown>;
  const initialAxes = (initial["capability_axes"] ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  void repoRoot;

  const axisExecutionIds: Record<string, string> = {};
  const axisInvMap: Record<string, {
    readonly evidence: import("../../src/adapter-common/invocation-evidence.js").InvocationEvidence;
    readonly path: string;
    readonly sha256: string;
  }> = {};
  const axisCapMap: Record<string, { readonly path: string; readonly sha256: string }> = {};
  for (const k of PER_AXIS_FIXTURES) {
    const capRel = `test/fixtures/harnesses/pi/pi-v0_85_1/captures/${k}.capture.json`;
    const invRel = `test/fixtures/harnesses/pi/pi-v0_85_1/invocations/${k}.invocation.json`;
    const capAbs = join(ws, capRel);
    const invAbs = join(ws, invRel);
    if (!existsSync(capAbs) || !existsSync(invAbs)) {
      throw new Error(
        `buildCanonicalBaseline: missing fixture for axis ${k} under workspace ${ws}; capAbs=${capAbs} invAbs=${invAbs}`,
      );
    }
    const manifest = JSON.parse(readFileSync(capAbs, "utf8")) as Record<string, unknown>;
    axisExecutionIds[k] = String(manifest["execution_id"]);
    // Hash the raw on-disk invocation bytes — that is
    // what the verifier recomputes inside
    // `readInvocationEvidence`. Re-serialising via
    // JSON.stringify would change key ordering / line
    // endings and produce a different SHA.
    const invocationBytes = readFileSync(invAbs);
    const invocationSha = createHash("sha256").update(invocationBytes).digest("hex");
    const manifestSha = shaOfExecutionCaptureManifest(capRel, ws);
    if (manifestSha === null) {
      throw new Error(
        `buildCanonicalBaseline: cannot hash manifest ${capRel} under ${ws}`,
      );
    }
    const evidence = readInvocationEvidence(invRel, ws);
    if (evidence === null) {
      throw new Error(
        `buildCanonicalBaseline: cannot read invocation evidence at ${invRel} under ${ws}`,
      );
    }
    axisInvMap[k] = { evidence, path: invRel, sha256: invocationSha };
    axisCapMap[k] = { path: capRel, sha256: manifestSha };
  }

  const perAxisLiveQualifying: ReadonlyArray<string> = [
    "JSONL",
    "EXPLICIT_CWD",
    "CANCELLATION",
    "HEADLESS",
    // STREAMING_EVENTS cannot be REPLAY_QUALIFIED
    // against the canonical Pi v0.85.1 fixture: the
    // session artifact contains a single envelope
    // event, while the oracle requires >= 2.
    // ISOLATED_DATA_DIR cannot be REPLAY_QUALIFIED
    // against the canonical fixture: the captured
    // runtime_session_file_path lives outside the
    // declared session_dir. Both axes remain
    // LIVE_UNQUALIFIED in the baseline.
  ];

  // L04-C05 (review pass 1): start from the frozen
  // canonical capability document (already loaded as
  // `initial` above), NOT from a fresh
  // `defaultPiCapabilities` reconstruction. The frozen
  // doc is the source of truth; the lab only rewrites
  // `live_qualification_by_key` + per-axis
  // `probe_evidence` + the four path/SHA fields the
  // lab must repoint against the workspace-mirrored
  // fixtures. Every other field (recorded
  // `execution_capture_sha256` etc. for unwired axes,
  // `harness_capability` bits, etc.) is preserved
  // verbatim from the freeze.
  const mutated: Record<string, unknown> = {
    ...initial,
    capability_axes: { ...initialAxes },
    live_qualification_by_key: {
      ...((initial["live_qualification_by_key"] ?? {}) as Record<string, string>),
    },
  };
  const axes = mutated["capability_axes"] as Record<
    string,
    import("../../src/protocol/index.js").CapabilityAxis
  >;
  const live = mutated["live_qualification_by_key"] as Record<string, string>;
  for (const k of perAxisLiveQualifying) {
    const axisKey = k as CapabilityKey;
    const inv = axisInvMap[k];
    const cap = axisCapMap[k];
    if (inv === undefined || cap === undefined) continue;
    if (k === "CANCELLATION") {
      live[k] = "REPLAY_HALT";
      const prev = axes[k] ?? {};
      axes[k] = {
        harness_capability: "SUPPORTED",
        ...prev,
        live_qualification: "REPLAY_HALT",
        probe_evidence_path: FIXTURE_PROCESS,
        probe_evidence: haltProbeEvidence({
          capability: axisKey,
          artifact_path: FIXTURE_PROCESS,
          artifact_sha256: artifactSha256(join(ws, FIXTURE_PROCESS)),
          expected: "HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE",
          observed: "HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE",
          execution_id: axisExecutionIds[k] ?? "",
        }),
        invocation_evidence_path: inv.path,
        invocation_evidence_sha256: inv.sha256,
        execution_capture_path: cap.path,
        execution_capture_sha256: cap.sha256,
        execution_capture_origin: "REPLAY_FIXTURE",
      } as CapabilityAxis;
      continue;
    }
    const observedExpected = computeObservedForAxis({
      workspaceRoot: ws,
      axisKey: k,
    });
    live[k] = "REPLAY_QUALIFIED";
    const prev = axes[k] ?? {};
    axes[k] = {
      harness_capability: "SUPPORTED",
      ...prev,
      live_qualification: "REPLAY_QUALIFIED",
      probe_evidence_path: FIXTURE_SESSION,
      probe_evidence: buildProbeEvidence({
        capability: axisKey,
        probe_kind: "SESSION_ENVELOPE",
        artifact_path: FIXTURE_SESSION,
        artifact_sha256: artifactSha256(join(ws, FIXTURE_SESSION)),
        expected: observedExpected,
        observed: observedExpected,
        execution_id: axisExecutionIds[k] ?? "",
      }),
      invocation_evidence_path: inv.path,
      invocation_evidence_sha256: inv.sha256,
      execution_capture_path: cap.path,
      execution_capture_sha256: cap.sha256,
      execution_capture_origin: "REPLAY_FIXTURE",
    } as CapabilityAxis;
  }
  return mutated as unknown as HarnessCapabilities;
}

/**
 * Convenience: empty capabilities with one axis stubbed
 * to LIVE_UNQUALIFIED. Used by minimal-wiring fault
 * experiments.
 */
export function emptyCapsForWorkspace(_workspaceRoot: string): HarnessCapabilities {
  return emptyCapabilities(QUALIFIED_PI_IDENTITY, 1700000000000);
}

/**
 * Load the LH-03 frozen canonical capabilities document
 * from disk, returning the verbatim `HarnessCapabilities`
 * the LH-03 freeze record commits to.
 *
 * The lab uses this as the seed for `buildCanonicalBaseline`
 * assertions (see `lh04-baseline.test.ts` →
 * `RECONSTRUCTED_BASELINE_AUTHORITY_MATCHES_FROZEN_CAPABILITIES`)
 * and as the starting point for byte-exact mutation
 * experiments that need to preserve every recorded SHA.
 *
 * This is the single authority for "what the LH-03
 * freeze considered the canonical capability document";
 * every other representation is derived from this one.
 */
export function loadFrozenCanonicalCapabilities(args: {
  readonly repoRoot: string;
}): HarnessCapabilities {
  const abs = join(
    args.repoRoot,
    "test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json",
  );
  if (!existsSync(abs)) {
    throw new Error(
      `loadFrozenCanonicalCapabilities: missing ${abs}`,
    );
  }
  const raw = readFileSync(abs, "utf8");
  return JSON.parse(raw) as HarnessCapabilities;
}

/**
 * Compute a canonical SHA-256 of a `HarnessCapabilities`
 * document by re-serialising with stable key ordering.
 * Used by `RECONSTRUCTED_BASELINE_AUTHORITY_MATCHES_FROZEN_CAPABILITIES`
 * to prove the reconstructed baseline matches the
 * frozen capability document on the fields the lab
 * commits to NOT rewriting.
 *
 * The lab legitimately rewrites, for the per-axis
 * witnesses it wires:
 *   - `live_qualification_by_key[k]`
 *   - `capability_axes[k].live_qualification`
 *   - `capability_axes[k].probe_evidence`
 *   - `capability_axes[k].probe_evidence_path`
 *   - `capability_axes[k].invocation_evidence_path`
 *   - `capability_axes[k].invocation_evidence_sha256`
 *   - `capability_axes[k].execution_capture_path`
 *   - `capability_axes[k].execution_capture_sha256`
 *   - `capability_axes[k].execution_capture_origin`
 *     (always "REPLAY_FIXTURE" so no observable change)
 *
 * What the oracle compares is the authority-binding
 * substrate that the lab MUST NOT drift:
 *   - `harness_identity` (provider + version)
 *   - `schema_version`
 *   - `capability_axes[k].harness_capability` (bit)
 *   - `capability_axes[k].execution_capture_sha256`
 *     (the recorded manifest SHA — the lab MUST preserve
 *     it byte-exact for the frozen-substrate proof)
 */
export function canonicalBaselineIdentityShape(
  doc: HarnessCapabilities,
): Record<string, unknown> {
  const allowed: Record<string, unknown> = {
    harness_identity: doc.harness_identity,
    schema_version: doc.schema_version,
    capability_axes: {},
  };
  const axes = doc.capability_axes as Record<string, Record<string, unknown>>;
  const sortedKeys = Object.keys(axes).sort();
  for (const k of sortedKeys) {
    const a = axes[k] ?? {};
    (allowed.capability_axes as Record<string, unknown>)[k] = {
      harness_capability: a.harness_capability,
      execution_capture_sha256: a.execution_capture_sha256,
    };
  }
  return allowed;
}

export function canonicalBaselineIdentityHash(doc: HarnessCapabilities): string {
  const h = createHash("sha256");
  h.update(JSON.stringify(canonicalBaselineIdentityShape(doc)));
  return h.digest("hex");
}

export const PATH_SEP = pathSep;

/**
 * Compute the canonical `evidence_relation.observed`
 * value the verifier will recompute for a given axis.
 * Mirrors `recomputeObserved()` in evidence-verifier.ts.
 */
function computeObservedForAxis(args: {
  readonly workspaceRoot: string;
  readonly axisKey: string;
}): string {
  const ws = resolve(args.workspaceRoot);
  switch (args.axisKey) {
    case "EXPLICIT_CWD":
      return "/private/tmp/pi-live";
    case "HEADLESS":
    case "JSONL":
    case "STREAMING_EVENTS":
      return "session";
    case "ISOLATED_DATA_DIR":
      // The captured session artifact is the storage;
      // its repo-relative path is the observed value.
      return relative(ws, join(ws, FIXTURE_SESSION));
    default:
      return "session";
  }
}
