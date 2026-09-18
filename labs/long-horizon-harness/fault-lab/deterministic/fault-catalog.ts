/**
 * LH-04 deterministic fault laboratory — fault catalog.
 *
 * Declarative F01..F17 experiments. Each mutation is a
 * closure that receives a fresh workspace root and
 * tampers with exactly one authority dimension. See
 * types.ts for the experiment / result / authority
 * model.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { HarnessCapabilities } from "../../src/protocol/index.js";
import {
  absFromRel,
  appendBytes,
  createExternalSymlink,
  readJson,
  writeJson,
} from "./mutations.js";
import {
  type FaultExperiment,
} from "./types.js";

const FIXTURE_SESSION =
  "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/pi.session.jsonl";
const FIXTURE_PROCESS =
  "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json";
const FIXTURE_STDOUT =
  "test/fixtures/harnesses/pi/pi-v0_85_1/stdout.jsonl";
const FIXTURE_STDERR =
  "test/fixtures/harnesses/pi/pi-v0_85_1/stderr.txt";
const JSONL_MANIFEST =
  "test/fixtures/harnesses/pi/pi-v0_85_1/captures/JSONL.capture.json";
const JSONL_INVOCATION =
  "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json";

/* ====================================================================== *
 * F01 — observation byte corruption                                       *
 * Mutate pi.session.jsonl bytes without updating bindings.                 *
 * Expected: EVIDENCE_HASH_MISMATCH (byte_hash authority).                  *
 * Preserves: invocation SHA, execution_id, manifest bytes, paths.          *
 * ====================================================================== */
const F01: FaultExperiment = {
  id: "F01",
  description: "Observation byte drift without rebinding the recorded SHA.",
  target: "native observation artifact (pi.session.jsonl)",
  fault: "append one ASCII byte at EOF (probe_evidence.artifact_sha256 stays frozen at the pre-mutation canonical SHA)",
  expected_authority: "byte_hash",
  expected_error_kind: "EVIDENCE_HASH_MISMATCH",
  mutated_dimension: "native_artifact_bytes",
  mutation_taxonomy: "GUARD_REACHABILITY_CONSTRUCTION",
  preserved_dimensions: [
    "manifest_bytes",
    "invocation_bytes",
    "invocation_sha256_binding",
    "execution_id_binding",
    "manifest_capability_binding",
    "manifest_paths",
    "probe_evidence_path",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (ws) => {
    const abs = absFromRel(ws, FIXTURE_SESSION);
    appendBytes(abs, "\n");
  },
  postBuild: (_workspaceRoot, canonical, preMutationCanonical) => {
    // For F01's design intent — "byte drift without
    // rebinding the recorded SHA" — we must restore
    // probe_evidence.artifact_sha256 to the ORIGINAL
    // canonical sha (from preMutationCanonical). The
    // post-mutation canonical has the DRIFT sha
    // because buildCanonicalBaseline re-reads the
    // session artifact after mutate appended "\n".
    const forged = { ...canonical } as Record<string, unknown>;
    const axes = forged["capability_axes"] as Record<string, unknown>;
    const preAxes = (preMutationCanonical as unknown as Record<string, Record<string, Record<string, unknown>>>).capability_axes;
    // Walk every REPLAY_QUALIFIED / LIVE_QUALIFIED axis
    // and copy the ORIGINAL probe_evidence.artifact_sha256
    // + execution_capture_sha256 + invocation_evidence_sha256
    // from preMutationCanonical.
    for (const k of Object.keys(axes)) {
      const axis = axes[k] as Record<string, unknown>;
      const preAxis = preAxes[k];
      if (preAxis === undefined) continue;
      const probe = axis["probe_evidence"] as Record<string, unknown> | null;
      const preProbe = preAxis["probe_evidence"] as Record<string, unknown> | null;
      if (probe !== null && preProbe !== null) {
        probe["artifact_sha256"] = preProbe["artifact_sha256"];
      }
    }
    return forged as HarnessCapabilities;
  },
};

/* ====================================================================== *
 * F02 — invocation byte corruption                                       *
 * Mutate raw invocation bytes (argv) without updating the recorded SHA.   *
 * Expected: EVIDENCE_HASH_MISMATCH (invocation_byte_hash authority).       *
 * ====================================================================== */
const F02: FaultExperiment = {
  id: "F02",
  description: "Invocation byte drift (argv change) without rebinding the recorded SHA.",
  target: "JSONL invocation artifact",
  fault: "mutate argv[0] from 'node' to 'NOdE' (invocation_evidence_sha256 stays frozen at the pre-mutation canonical SHA via postBuild)",
  expected_authority: "invocation_byte_hash",
  expected_error_kind: "EVIDENCE_HASH_MISMATCH",
  mutated_dimension: "invocation_artifact_bytes",
  mutation_taxonomy: "GUARD_REACHABILITY_CONSTRUCTION",
  preserved_dimensions: [
    "manifest_bytes",
    "manifest_paths",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
    "probe_evidence_path",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (ws) => {
    const abs = absFromRel(ws, JSONL_INVOCATION);
    const parsed = readJson(abs) as Record<string, unknown>;
    const argv = parsed["argv"] as string[];
    argv[0] = argv[0]?.replace(/^node$/, "NOdE") ?? "NOdE";
    writeJson(abs, parsed);
  },
  postBuild: (_workspaceRoot, canonical, preMutationCanonical) => {
    // For F02 to fire at invocation_byte_hash
    // authority (the C07-01 check at line 700 of
    // evidence-verifier.ts:
    //   axis.invocation_evidence_sha256 !==
    //     invocation.artifact_sha256),
    // we must restore
    // axis.JSONL.invocation_evidence_sha256 to the
    // ORIGINAL canonical sha. The post-mutation
    // buildCanonicalBaseline has already updated
    // axis.JSONL.invocation_evidence_sha256 to the
    // DRIFT sha (recomputed from the now-mutated
    // JSONL.invocation.json), so without this
    // postBuild the C07-01 check would agree with
    // itself, and the verifier would proceed to
    // C08-03 (manifest.invocation_sha256 != actual
    // invocation.artifact_sha256) which fires at
    // execution_relationship authority — wrong.
    const forged = { ...canonical } as Record<string, unknown>;
    const axes = forged["capability_axes"] as Record<string, unknown>;
    const preAxes = (preMutationCanonical as unknown as Record<string, Record<string, Record<string, unknown>>>).capability_axes;
    for (const k of Object.keys(axes)) {
      const axis = axes[k] as Record<string, unknown>;
      const preAxis = preAxes[k];
      if (preAxis === undefined) continue;
      if (preAxis["invocation_evidence_sha256"] !== undefined) {
        axis["invocation_evidence_sha256"] = preAxis["invocation_evidence_sha256"];
      }
    }
    return forged as HarnessCapabilities;
  },
};

/* ====================================================================== *
 * F03 — derived-semantic contradiction (--mode headless)                 *
 * Expected: EVIDENCE_PARSE_FAILED (invocation_derivation authority).       *
 * The argv grammar refuses `--mode headless` (Pi has no such mode); the   *
 * verifier surfaces this through the invocation read step.                 *
 * ====================================================================== */
/* ====================================================================== *
 * F03 — derived-semantic contradiction (--mode headless)                   *
 *                                                                             *
 * Mutates JSONL.invocation.json's argv from `--mode json` to                *
 * `--mode headless`. The on-disk artifact becomes a raw launch               *
 * whose `deriveInvocationSemantics()` throws on the contradiction.           *
 * The verifier re-reads the corrupted artifact via                            *
 * `readInvocationEvidence()` and reports EVIDENCE_PARSE_FAILED                *
 * at invocation_derivation authority.                                         *
 *                                                                             *
 * Implementation note: F03 cannot use `buildCanonicalBaseline`               *
 * for its post-mutation builder, because the runner calls                   *
 * `builder(ws)` AFTER mutate, and buildCanonicalBaseline reads               *
 * JSONL.invocation.json (which we just corrupted) and throws                 *
 * on `readInvocationEvidence() === null`. F03 therefore uses a               *
 * postBuild hook: it writes the corrupted invocation to an                  *
 * out-of-band file and rebinds the JSONL axis to point at it, so             *
 * the canonical builder (which still reads the canonical                     *
 * JSONL.invocation.json) succeeds, and the verifier reads the                *
 * out-of-band file and reports EVIDENCE_PARSE_FAILED.                         *
 * ====================================================================== */
const F03: FaultExperiment = {
  id: "F03",
  description: "Raw-launch contradiction: argv contains '--mode headless'.",
  target: "JSONL invocation artifact",
  fault: "replace '--mode json' with '--mode headless' (out-of-band)",
  expected_authority: "invocation_derivation",
  expected_error_kind: "EVIDENCE_PARSE_FAILED",
  mutated_dimension: "invocation_derivation_grammar",
  mutation_taxonomy: "GUARD_REACHABILITY_CONSTRUCTION",
  preserved_dimensions: [
    "manifest_bytes",
    "manifest_paths",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
    "probe_evidence_path",
    "invocation_sha256_binding",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (workspaceRoot) => {
    // Write the corrupt invocation to an
    // out-of-band path. The canonical
    // JSONL.invocation.json is left untouched so the
    // runner's post-mutation buildCanonicalBaseline
    // still succeeds. The postBuild hook will
    // rebind axis.JSONL.invocation_evidence_path to
    // this out-of-band file.
    const canonicalAbs = absFromRel(workspaceRoot, JSONL_INVOCATION);
    const parsed = JSON.parse(readFileSync(canonicalAbs, "utf8")) as Record<string, unknown>;
    const argv = parsed["argv"] as string[];
    const i = argv.indexOf("json");
    if (i >= 0) argv[i] = "headless";
    const outOfBandAbs = join(workspaceRoot, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.corrupt.invocation.json");
    writeFileSync(outOfBandAbs, JSON.stringify(parsed, null, 2));
  },
  postBuild: (workspaceRoot, canonical, _preMutationCanonical) => {
    const outOfBandRel = "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.corrupt.invocation.json";
    const outOfBandAbs = join(workspaceRoot, outOfBandRel);
    const corruptSha = createHash("sha256")
      .update(readFileSync(outOfBandAbs))
      .digest("hex");
    const forged = { ...canonical } as Record<string, unknown>;
    const axes = forged["capability_axes"] as Record<string, unknown>;
    const jsonl = axes["JSONL"] as Record<string, unknown>;
    jsonl["invocation_evidence_path"] = outOfBandRel;
    jsonl["invocation_evidence_sha256"] = corruptSha;
    return forged as HarnessCapabilities;
  },
};

/* ====================================================================== *
 * F04 — invocation/observation splice                                    *
 * Bind HEADLESS invocation (--mode rpc) onto JSONL observation.            *
 * Expected: EVIDENCE_EXECUTION_MISMATCH.                                  *
 * ====================================================================== */
const F04: FaultExperiment = {
  id: "F04",
  description: "Invocation/observation splice: bind HEADLESS invocation to JSONL observation.",
  target: "JSONL axis binding",
  fault: "swap invocation_evidence_path from JSONL to HEADLESS",
  expected_authority: "execution_relationship",
  expected_error_kind: "EVIDENCE_EXECUTION_MISMATCH",
  mutated_dimension: "invocation_evidence_path_binding",
  mutation_taxonomy: "COMPOUND_AXIS_SPLICE",
  preserved_dimensions: [
    "manifest_bytes",
    "manifest_paths",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (ws) => {
    const headlessAbs = absFromRel(
      ws,
      "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/HEADLESS.invocation.json",
    );
    const jsonlAbs = absFromRel(ws, JSONL_INVOCATION);
    writeFileSync(jsonlAbs, readFileSync(headlessAbs));
  },
};

/* ====================================================================== *
 * F05 — execution_id splice (postBuild)                                    *
 * ====================================================================== */
const F05: FaultExperiment = {
  id: "F05",
  description: "Execution ID splice: probe evidence execution_id != manifest.execution_id.",
  target: "JSONL axis binding (probe_evidence.execution_id)",
  fault: "rewrite probe_evidence.execution_id to a constant sentinel (postBuild)",
  expected_authority: "execution_id_relationship",
  expected_error_kind: "EVIDENCE_EXECUTION_MISMATCH",
  mutated_dimension: "probe_evidence_execution_id",
  mutation_taxonomy: "SINGLE_DIMENSION",
  preserved_dimensions: [
    "manifest_bytes",
    "manifest_invocation_sha256",
    "native_artifact_bytes",
    "manifest_capability_binding",
    "manifest_paths",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (_ws) => {
    // No-op; postBuild performs the splice.
  },
  postBuild: (_workspaceRoot, canonical, _preMutationCanonical) => {
    const forged = { ...canonical } as Record<string, unknown>;
    const axes = forged["capability_axes"] as Record<string, unknown>;
    const jsonl = axes["JSONL"] as Record<string, unknown>;
    const probe = jsonl["probe_evidence"] as Record<string, unknown>;
    probe["execution_id"] = "0000000000000000000000000000000000000000000000000000000000000000";
    return forged as HarnessCapabilities;
  },
};

/* ====================================================================== *
 * F06 — cross-capability manifest reuse (postBuild)                         *
 * ====================================================================== */
const F06: FaultExperiment = {
  id: "F06",
  description: "Cross-capability manifest reuse: HEADLESS manifest bound to JSONL axis.",
  target: "JSONL axis binding (execution_capture_path)",
  fault: "rewrite JSONL axis to bind HEADLESS capture manifest (postBuild)",
  expected_authority: "manifest_capability_binding",
  expected_error_kind: "EVIDENCE_EXECUTION_MISMATCH",
  mutated_dimension: "manifest_capability_self_id",
  mutation_taxonomy: "COMPOUND_FORGERY",
  preserved_dimensions: [
    "manifest_bytes",
    "manifest_invocation_sha256",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_paths",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (_ws) => {
    // No-op; postBuild performs the swap.
  },
  postBuild: (workspaceRoot, canonical, _preMutationCanonical) => {
    // F06 rebinds JSONL axis to the HEADLESS capture
    // manifest, and patches HEADLESS's
    // `invocation_sha256` to agree with the JSONL
    // invocation artifact on disk (otherwise C08-03
    // fires first as `execution_relationship`).
    // After patching, the C10 check on
    // `manifest.capability='HEADLESS' !=
    // axis.key='JSONL'` fires last as
    // `manifest_capability_binding`.
    const headlessRel =
      "test/fixtures/harnesses/pi/pi-v0_85_1/captures/HEADLESS.capture.json";
    const headlessAbs = join(workspaceRoot, headlessRel);
    const jsonlInvocationAbs = join(workspaceRoot, JSONL_INVOCATION);
    const jsonlInvocationBytes = readFileSync(jsonlInvocationAbs);
    const jsonlInvocationSha = createHash("sha256")
      .update(jsonlInvocationBytes)
      .digest("hex");
    // Patch the HEADLESS manifest on disk so its
    // recorded invocation_sha256 matches the JSONL
    // invocation artifact. This makes the C08-03
    // check pass; the C10 capability-mismatch check
    // then fires for the same axis. We rewrite using
    // a string substitution (preserving the original
    // key order and whitespace) instead of
    // JSON.stringify so the recorded
    // execution_capture_sha256 still matches the
    // patched on-disk bytes.
    const headlessBytes = readFileSync(headlessAbs, "utf8");
    // Extract HEADLESS manifest's own execution_id
    // BEFORE patching — we need it for the JSONL
    // probe_evidence.execution_id rewrite below.
    const headlessOriginal = JSON.parse(headlessBytes) as Record<string, unknown>;
    const headlessExecutionId = String(headlessOriginal["execution_id"] ?? "");
    const patched = headlessBytes.replace(
      /"invocation_sha256":\s*"[a-f0-9]{64}"/,
      `"invocation_sha256": "${jsonlInvocationSha}"`,
    );
    writeFileSync(headlessAbs, patched);
    // Recompute the SHA after the patch (the bytes
    // changed).
    const patchedHeadlessSha = createHash("sha256")
      .update(readFileSync(headlessAbs))
      .digest("hex");
    void headlessBytes;
    const forged = { ...canonical } as Record<string, unknown>;
    const axes = forged["capability_axes"] as Record<string, unknown>;
    const jsonl = axes["JSONL"] as Record<string, unknown>;
    const headless = axes["HEADLESS"] as Record<string, unknown>;
    // The HEADLESS axis is itself LIVE_QUALIFIED in
    // the baseline and points at HEADLESS.capture.json
    // — the file we just patched. We MUST also update
    // the HEADLESS axis's recorded sha so the
    // verifier's HEADLESS-axis loop agrees with the
    // new on-disk bytes; otherwise the HEADLESS axis
    // would fire its own EVIDENCE_HASH_MISMATCH
    // before the JSONL-axis CORRECTION10 check runs.
    //
    // Additionally, the C08-03 check fires on both
    // axes because the patched manifest declares
    // JSONL's invocation_sha256 + JSONL's
    // execution_id, but each axis still references
    // its own invocation artifact. Repoint both
    // axes at JSONL.invocation.json, and rewrite the
    // JSONL probe_evidence.execution_id to match
    // the HEADLESS manifest's execution_id (the
    // patched manifest keeps the HEADLESS
    // execution_id). After these rewrites the C08-03
    // chain agrees on both axes, and the C10
    // capability-mismatch check on the JSONL axis
    // (manifest.capability=HEADLESS vs
    // axis.key=JSONL) is what fires.
    jsonl["execution_capture_path"] = headlessRel;
    jsonl["execution_capture_sha256"] = patchedHeadlessSha;
    const jsonlProbe = jsonl["probe_evidence"] as Record<string, unknown>;
    jsonlProbe["execution_id"] = headlessExecutionId;
    jsonl["invocation_evidence_path"] = JSONL_INVOCATION;
    jsonl["invocation_evidence_sha256"] = jsonlInvocationSha;
    headless["execution_capture_sha256"] = patchedHeadlessSha;
    headless["invocation_evidence_path"] = JSONL_INVOCATION;
    headless["invocation_evidence_sha256"] = jsonlInvocationSha;
    return forged as HarnessCapabilities;
  },
};

/* ====================================================================== *
 * F07 — replay-to-live promotion (postBuild)                                *
 * ====================================================================== */
const F07: FaultExperiment = {
  id: "F07",
  description: "Replay-to-live promotion: REPLAY_FIXTURE manifest bound to LIVE_QUALIFIED axis.",
  target: "JSONL axis binding (execution_capture_origin)",
  fault: "rewrite axis to LIVE_QUALIFIED without rebinding manifest (postBuild)",
  expected_authority: "manifest_origin_discriminator",
  expected_error_kind: "EVIDENCE_EXECUTION_MISMATCH",
  mutated_dimension: "axis_execution_capture_origin",
  mutation_taxonomy: "COMPOUND_FORGERY",
  preserved_dimensions: [
    "manifest_bytes",
    "manifest_invocation_sha256",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
    "manifest_paths",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (_ws) => {
    // No-op; postBuild performs the swap.
  },
  postBuild: (_workspaceRoot, canonical, _preMutationCanonical) => {
    const forged = { ...canonical } as Record<string, unknown>;
    const axes = forged["capability_axes"] as Record<string, unknown>;
    const jsonl = axes["JSONL"] as Record<string, unknown>;
    // Promote the axis to declare its execution_capture_origin
    // as LIVE_QUALIFIED, but the underlying manifest is
    // still REPLAY_FIXTURE. The C09-01 capture_origin
    // check fires (manifest_origin_discriminator).
    jsonl["execution_capture_origin"] = "LIVE_QUALIFIED";
    return forged as HarnessCapabilities;
  },
};

/* ====================================================================== *
 * F08 — manifest stdout_path = ../escape                                   *
 * ====================================================================== */
const F08: FaultExperiment = {
  id: "F08",
  description: "Manifest internal stdout_path = '../escape' is rejected.",
  target: "JSONL manifest stdout_path",
  fault: "rewrite stdout_path to ../../../../../../etc/passwd",
  expected_authority: "path",
  expected_error_kind: "EVIDENCE_PATH_ESCAPE",
  mutated_dimension: "manifest_stdout_path",
  mutation_taxonomy: "SINGLE_DIMENSION",
  preserved_dimensions: [
    "manifest_invocation_sha256",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
    "probe_evidence_path",
    "invocation_evidence_path",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (ws) => {
    const abs = absFromRel(ws, JSONL_MANIFEST);
    const parsed = readJson(abs) as Record<string, unknown>;
    parsed["stdout_path"] = "../../../../../../etc/passwd";
    writeJson(abs, parsed);
  },
};

/* ====================================================================== *
 * F09 — manifest stdout_path = absolute path                               *
 * ====================================================================== */
/* ====================================================================== *
 * F09 — manifest stdout_path = ..-escape (path authority)                 *
 *                                                                             *
 * The capture manifest's `stdout_path` is rewritten to a                    *
 * repo-relative path that escapes the repo root via `..`.                  *
 * The verifier MUST reject this through the CORRECTION10                    *
 * path-authority chain (not the closed-world type check).                  *
 *                                                                             *
 * Implementation note: an absolute path would be caught                    *
 * earlier by `readExecutionCaptureManifest`'s type check                   *
 * (returns null on absolute), which would surface as                       *
 * EVIDENCE_PARSE_FAILED at oracle_semantic — wrong authority.              *
 * A `..`-escape path is accepted by the type checker (it is                *
 * repo-relative), then rejected by the path authority                      *
 * inside `reverifyExecutionCaptureManifestArtifacts`.                      *
 * ====================================================================== */
const F09: FaultExperiment = {
  id: "F09",
  description: "Manifest internal stdout_path = '..'-escape is rejected at path authority.",
  target: "JSONL manifest stdout_path",
  fault: "rewrite stdout_path to '../../escaped.jsonl'",
  expected_authority: "path",
  expected_error_kind: "EVIDENCE_PATH_ESCAPE",
  mutated_dimension: "manifest_stdout_path",
  mutation_taxonomy: "SINGLE_DIMENSION",
  preserved_dimensions: [
    "manifest_invocation_sha256",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
    "probe_evidence_path",
    "invocation_evidence_path",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (ws) => {
    const abs = absFromRel(ws, JSONL_MANIFEST);
    const parsed = readJson(abs) as Record<string, unknown>;
    parsed["stdout_path"] = "../../escaped.jsonl";
    writeJson(abs, parsed);
  },
};

/* ====================================================================== *
 * F10 — in-repo symlink escape                                            *
 * ====================================================================== */
const F10: FaultExperiment = {
  id: "F10",
  description: "In-repo symlink whose target lies outside the workspace is rejected.",
  target: "JSONL manifest stdout_path",
  fault: "create external symlink; rewrite stdout_path to it",
  expected_authority: "path",
  expected_error_kind: "EVIDENCE_PATH_ESCAPE",
  mutated_dimension: "manifest_stdout_path",
  mutation_taxonomy: "SINGLE_DIMENSION",
  preserved_dimensions: [
    "manifest_invocation_sha256",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
    "probe_evidence_path",
    "invocation_evidence_path",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (ws) => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const outsideDir = mkdtempSync(join(tmpdir(), "lh04-f10-outside-"));
    const outsideFile = join(outsideDir, "secret.txt");
    writeFileSync(outsideFile, "secret\n");
    const linkAbs = absFromRel(
      ws,
      "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/leak.stdout",
    );
    createExternalSymlink({ linkAbs, externalTargetAbs: outsideFile });
    const manifestAbs = absFromRel(ws, JSONL_MANIFEST);
    const parsed = readJson(manifestAbs) as Record<string, unknown>;
    parsed["stdout_path"] =
      "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/leak.stdout";
    writeJson(manifestAbs, parsed);
  },
};

/* ====================================================================== *
 * F11 — hash-valid unauthorized path (postBuild)                            *
 *
 * The probe_evidence.artifact_path is rewritten to an ABSOLUTE            *
 * unauthorized path whose bytes hash to the canonical                     *
 * artifact_sha256. The bytes are correct; the path is                     *
 * unauthorized. The verifier MUST reject on path authority, NOT           *
 * accept on byte identity (LH-03 CORRECTION05 C05-03).                     *
 * ====================================================================== */
const F11: FaultExperiment = {
  id: "F11",
  description: "Hash-valid bytes at an unauthorized (absolute) path are rejected.",
  target: "JSONL probe_evidence.artifact_path",
  fault: "rewrite probe_evidence.artifact_path to an absolute path whose bytes hash to the canonical artifact_sha256 (postBuild)",
  expected_authority: "path",
  expected_error_kind: "EVIDENCE_PATH_ESCAPE",
  mutated_dimension: "probe_evidence_artifact_path",
  mutation_taxonomy: "GUARD_REACHABILITY_CONSTRUCTION",
  preserved_dimensions: [
    "manifest_invocation_sha256",
    "execution_id_binding",
    "manifest_capability_binding",
    "manifest_bytes",
    "manifest_paths",
    "invocation_evidence_path",
    "probe_evidence_sha256",
    "native_artifact_sha256",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (workspaceRoot) => {
    // Lay down hash-valid bytes at an absolute
    // unauthorized location so the verifier cannot
    // reject on byte-identity grounds.
    const canonicalAbs = join(workspaceRoot, FIXTURE_SESSION);
    const canonicalSha = createHash("sha256")
      .update(readFileSync(canonicalAbs))
      .digest("hex");
    writeFileSync("/tmp/lh04-f11-unauthorized.jsonl", readFileSync(canonicalAbs));
    void canonicalSha;
  },
  postBuild: (_workspaceRoot, canonical, _preMutationCanonical) => {
    const forged = { ...canonical } as Record<string, unknown>;
    const axes = forged["capability_axes"] as Record<string, unknown>;
    const jsonl = axes["JSONL"] as Record<string, unknown>;
    const probe = jsonl["probe_evidence"] as Record<string, unknown>;
    // Path authority MUST reject this on
    // resolveEvidencePath before it ever reaches the
    // SHA comparator.
    probe["artifact_path"] = "/tmp/lh04-f11-unauthorized.jsonl";
    // artifact_sha256 stays as-is (the bytes at
    // /tmp/lh04-f11-unauthorized.jsonl hash to this
    // value).
    return forged as HarnessCapabilities;
  },
};

/* ====================================================================== *
 * F12 — stdout byte drift                                                  *
 * ====================================================================== */
const F12: FaultExperiment = {
  id: "F12",
  description: "stdout.jsonl byte drift without rebinding stdout_sha256.",
  target: "stdout artifact",
  fault: "append one byte",
  expected_authority: "byte_hash",
  expected_error_kind: "EVIDENCE_HASH_MISMATCH",
  mutated_dimension: "stdout_artifact_bytes",
  mutation_taxonomy: "SINGLE_DIMENSION",
  preserved_dimensions: [
    "manifest_invocation_sha256",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
    "manifest_paths",
    "probe_evidence_path",
    "invocation_evidence_path",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (ws) => {
    const abs = absFromRel(ws, FIXTURE_STDOUT);
    appendBytes(abs, " ");
  },
};

/* ====================================================================== *
 * F13 — stderr byte drift                                                  *
 * ====================================================================== */
const F13: FaultExperiment = {
  id: "F13",
  description: "stderr.txt byte drift without rebinding stderr_sha256.",
  target: "stderr artifact",
  fault: "append one byte",
  expected_authority: "byte_hash",
  expected_error_kind: "EVIDENCE_HASH_MISMATCH",
  mutated_dimension: "stderr_artifact_bytes",
  mutation_taxonomy: "SINGLE_DIMENSION",
  preserved_dimensions: [
    "manifest_invocation_sha256",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
    "manifest_paths",
    "probe_evidence_path",
    "invocation_evidence_path",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (ws) => {
    const abs = absFromRel(ws, FIXTURE_STDERR);
    appendBytes(abs, " ");
  },
};

/* ====================================================================== *
 * F14 — process-result byte drift                                          *
 * ====================================================================== */
const F14: FaultExperiment = {
  id: "F14",
  description: "process-result.json byte drift without rebinding sha.",
  target: "process-result artifact",
  fault: "change exit_code from 1 to 2",
  expected_authority: "byte_hash",
  expected_error_kind: "EVIDENCE_HASH_MISMATCH",
  mutated_dimension: "process_result_artifact_bytes",
  mutation_taxonomy: "SINGLE_DIMENSION",
  preserved_dimensions: [
    "manifest_invocation_sha256",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
    "manifest_paths",
    "probe_evidence_path",
    "invocation_evidence_path",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (ws) => {
    const abs = absFromRel(ws, FIXTURE_PROCESS);
    const parsed = readJson(abs) as Record<string, unknown>;
    parsed["process_exit_code"] = 2;
    writeJson(abs, parsed);
  },
};

/* ====================================================================== *
 * F15 — native artifact byte drift                                         *
 * ====================================================================== */
/* ====================================================================== *
 * F15 — native artifact byte drift (postBuild)                            *
 *                                                                             *
 * The native artifact (pi.session.jsonl) has a byte appended.              *
 * For F15 to fire on the byte_hash authority (the first                    *
 * recomputed-vs-recorded sha check), we must restore                       *
 * `probe_evidence.artifact_sha256` to the ORIGINAL canonical               *
 * sha. Otherwise the post-mutation buildCanonicalBaseline                  *
 * recomputes it as the DRIFT sha, and CORRECTION08 C08-07                  *
 * (probe_evidence.artifact_sha256 != manifest.native_artifact_sha256)       *
 * fires first at execution_relationship authority — wrong.                 *
 * ====================================================================== */
const F15: FaultExperiment = {
  id: "F15",
  description: "native artifact byte drift without rebinding sha.",
  target: "native artifact",
  fault: "append one byte (probe_evidence.artifact_sha256 stays frozen at pre-mutation canonical SHA via postBuild)",
  expected_authority: "byte_hash",
  expected_error_kind: "EVIDENCE_HASH_MISMATCH",
  mutated_dimension: "native_artifact_bytes",
  mutation_taxonomy: "GUARD_REACHABILITY_CONSTRUCTION",
  preserved_dimensions: [
    "manifest_invocation_sha256",
    "execution_id_binding",
    "manifest_capability_binding",
    "manifest_paths",
    "probe_evidence_path",
    "invocation_evidence_path",
    "stdout_bytes",
    "stderr_bytes",
    "process_result_bytes",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (ws) => {
    const abs = absFromRel(ws, FIXTURE_SESSION);
    appendBytes(abs, " ");
  },
  postBuild: (_workspaceRoot, canonical, preMutationCanonical) => {
    // Restore probe_evidence.artifact_sha256 to the
    // ORIGINAL pre-mutation sha on every REPLAY_QUALIFIED
    // axis that uses the SESSION_ENVELOPE probe kind.
    // This forces the verifier's first
    // recomputed-vs-recorded check (byte_hash) to fire
    // before any downstream execution_relationship
    // check.
    const forged = { ...canonical } as Record<string, unknown>;
    const axes = forged["capability_axes"] as Record<string, unknown>;
    const preAxes = (preMutationCanonical as unknown as Record<string, Record<string, Record<string, unknown>>>).capability_axes;
    for (const k of Object.keys(axes)) {
      const axis = axes[k] as Record<string, unknown>;
      const preAxis = preAxes[k];
      if (preAxis === undefined) continue;
      const probe = axis["probe_evidence"] as Record<string, unknown> | null;
      const preProbe = preAxis["probe_evidence"] as Record<string, unknown> | null;
      if (probe !== null && preProbe !== null) {
        probe["artifact_sha256"] = preProbe["artifact_sha256"];
      }
    }
    return forged as HarnessCapabilities;
  },
};

/* ====================================================================== *
 * F16 — manifest byte drift (postBuild)                                    *
 *                                                                             *
 * The capture manifest's `recorded_at` is rewritten to a                   *
 * sentinel value; on-disk bytes drift. For F16 to fire on                  *
 * byte_hash authority, we must restore every axis's                        *
 * `execution_capture_sha256` to the ORIGINAL canonical sha                 *
 * (the sha of the un-mutated manifest). Otherwise the                     *
 * post-mutation buildCanonicalBaseline recomputes it as the                *
 * DRIFT sha, the on-disk recomputation agrees, and the                     *
 * verifier passes — escape.                                                *
 * ====================================================================== */
const F16: FaultExperiment = {
  id: "F16",
  description: "Manifest byte drift without rebinding external manifest SHA.",
  target: "JSONL manifest",
  fault: "rewrite recorded_at to a sentinel value (execution_capture_sha256 stays frozen at pre-mutation canonical SHA via postBuild)",
  expected_authority: "byte_hash",
  expected_error_kind: "EVIDENCE_HASH_MISMATCH",
  mutated_dimension: "manifest_artifact_bytes",
  mutation_taxonomy: "GUARD_REACHABILITY_CONSTRUCTION",
  preserved_dimensions: [
    "manifest_invocation_sha256",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
    "manifest_paths",
    "probe_evidence_path",
    "invocation_evidence_path",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (ws) => {
    const abs = absFromRel(ws, JSONL_MANIFEST);
    const parsed = readJson(abs) as Record<string, unknown>;
    parsed["recorded_at"] = "2030-01-01T00:00:00Z";
    writeJson(abs, parsed);
  },
  postBuild: (_workspaceRoot, canonical, preMutationCanonical) => {
    const forged = { ...canonical } as Record<string, unknown>;
    const axes = forged["capability_axes"] as Record<string, unknown>;
    const preAxes = (preMutationCanonical as unknown as Record<string, Record<string, Record<string, unknown>>>).capability_axes;
    for (const k of Object.keys(axes)) {
      const axis = axes[k] as Record<string, unknown>;
      const preAxis = preAxes[k];
      if (preAxis === undefined) continue;
      if (preAxis["execution_capture_sha256"] !== undefined) {
        axis["execution_capture_sha256"] = preAxis["execution_capture_sha256"];
      }
    }
    return forged as HarnessCapabilities;
  },
};

/* ====================================================================== *
 * F17 — oracle-level semantic failure (postBuild)                           *
 * ====================================================================== */
const F17: FaultExperiment = {
  id: "F17",
  description: "All bytes + SHAs + paths correct, but recorded observed mismatches recomputed observed.",
  target: "JSONL axis binding (evidence_relation.observed)",
  fault: "rewrite observed to a sentinel that disagrees with the parsed session envelope (postBuild)",
  expected_authority: "oracle_semantic",
  expected_error_kind: "EVIDENCE_OBSERVATION_MISMATCH",
  mutated_dimension: "evidence_relation_observed",
  mutation_taxonomy: "SINGLE_DIMENSION",
  preserved_dimensions: [
    "manifest_bytes",
    "manifest_paths",
    "native_artifact_bytes",
    "execution_id_binding",
    "manifest_capability_binding",
    "invocation_bytes",
    "invocation_sha256",
    "probe_evidence_path",
    "probe_evidence_sha256",
  ],
  fixture_source: "test/fixtures/harnesses/pi/pi-v0_85_1",
  mutate: async (_ws) => {
    // No-op workspace mutation; postBuild performs the rewrite.
  },
  postBuild: (_workspaceRoot, canonical, _preMutationCanonical) => {
    const forged = { ...canonical } as Record<string, unknown>;
    const axes = forged["capability_axes"] as Record<string, unknown>;
    const jsonl = axes["JSONL"] as Record<string, unknown>;
    const probe = jsonl["probe_evidence"] as Record<string, unknown>;
    const relation = probe["evidence_relation"] as Record<string, unknown>;
    relation["observed"] = "sentinel-not-session";
    probe["disposition"] = "PASS";
    return forged as HarnessCapabilities;
  },
};

/**
 * Closed-world fault catalog. Adding a fault is a
 * schema-visible change.
 */
export const FAULT_CATALOG: readonly FaultExperiment[] = Object.freeze([
  F01,
  F02,
  F03,
  F04,
  F05,
  F06,
  F07,
  F08,
  F09,
  F10,
  F11,
  F12,
  F13,
  F14,
  F15,
  F16,
  F17,
]);

export function findFault(id: string): FaultExperiment | undefined {
  return FAULT_CATALOG.find((f) => f.id === id);
}
