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
  defaultPiCapabilities,
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
 * Per CORRECTION10, each axis binds its own canonical
 * capture manifest; `manifest.capability === axis.key`.
 */
export function buildCanonicalBaseline(args: {
  readonly workspaceRoot: string;
}): HarnessCapabilities {
  const ws = resolve(args.workspaceRoot);

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

  // The adapter's evidence parameter is a wide object;
  // we cast to that type via the function's parameter
  // type. We deliberately pass partial per-axis maps;
  // the adapter does not require every axis to be
  // populated.
  type EvidenceArg = Parameters<typeof defaultPiCapabilities>[2];
  const evidence = {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
    execution_capture_origin: "REPLAY_FIXTURE",
    axis_execution_captures: axisCapMap,
    axis_invocation_evidence: axisInvMap,
    axis_execution_ids: axisExecutionIds,
  } as unknown as EvidenceArg;

  const initial = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, evidence);
  const mutated: Record<string, unknown> = {
    ...initial,
    capability_axes: { ...initial.capability_axes },
    live_qualification_by_key: { ...initial.live_qualification_by_key },
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

