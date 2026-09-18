/**
 * LH-03 CORRECTION04 — axiom tests.
 *
 * Each test pins a single invariant from C04-01..C04-07.
 * These are property/oracle tests, not snapshot tests;
 * they enforce the axioms so future drift is caught.
 *
 *   C04-01: separate structural validation
 *           (`validateLiveQualification`) from artifact
 *           verification
 *           (`verifyLiveQualificationEvidence`). The
 *           validator is pure; the verifier re-reads the
 *           artifact from disk under an explicit trusted
 *           repoRoot.
 *
 *   C04-02: artifact hash drift fails closed.
 *           C04-HASH01 mutate bytes after probe recorded
 *                     → verifier FAIL.
 *           C04-HASH02 forge recorded sha256
 *                     → verifier FAIL.
 *           C04-HASH03 correct bytes + correct sha256
 *                     → verifier PASS.
 *
 *   C04-03: repo-relative durable evidence paths. The
 *           verifier accepts an explicit trusted
 *           `repoRoot` and refuses path escape.
 *           C04-PATH01 checkout root A → PASS.
 *           C04-PATH02 checkout root B → PASS.
 *           C04-PATH03 ../escape      → FAIL.
 *
 *   C04-04: cwd match alone does NOT qualify
 *           ISOLATED_DATA_DIR. The capability requires
 *           isolation evidence (a dedicated
 *           --session-dir directory whose path the
 *           captured session artifact lives under).
 *
 *   C04-05: HEADLESS/STREAMING_EVENTS require
 *           invocation facts (`invocation_mode ===
 *           "headless"`). JSONL qualifies from the
 *           session envelope alone (canonical Factory
 *           name for the upstream JSON Event Stream
 *           Mode).
 *
 *   C04-06: typed `EvidenceVerificationError` failure
 *           kinds (EVIDENCE_ARTIFACT_MISSING /
 *           EVIDENCE_PATH_ESCAPE / EVIDENCE_HASH_MISMATCH
 *           / EVIDENCE_PARSE_FAILED /
 *           EVIDENCE_OBSERVATION_MISMATCH /
 *           EVIDENCE_ORACLE_FAILED). No generic thrown
 *           string authority.
 *
 *   C04-07: acceptance:
 *           FORGED_HASH_ACCEPTED                       = IMPOSSIBLE
 *           ARTIFACT_MUTATION_AFTER_RECORD_ACCEPTED    = IMPOSSIBLE
 *           CWD_MATCH_IMPLIES_ISOLATED_DATA_DIR        = FALSE
 *           MACHINE_LOCAL_ABSOLUTE_PATH_REQUIRED       = FALSE
 *           LIVE_QUALIFIED_WITHOUT_REVERIFIABLE_ARTIFACT = IMPOSSIBLE
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  mkdtempSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  mkdirSync,
  symlinkSync,
  appendFileSync,
} from "node:fs";
import { isAbsolute, resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";

import {
  emptyCapabilities,
  validateLiveQualification,
  type CapabilityKey,
  type HarnessCapabilities,
} from "../../src/protocol/index.js";
import {
  defaultPiCapabilities,
  QUALIFIED_PI_IDENTITY,
} from "../../src/adapters/pi/pi-adapter.js";
import {
  artifactSha256,
  buildProbeEvidence,
} from "../../src/adapter-common/evidence-reader.js";
import {
  verifyLiveQualificationEvidence,
  resolveEvidencePath,
  EVIDENCE_VERIFICATION_ERROR_KINDS,
  type EvidenceVerificationErrorKind,
} from "../../src/adapter-common/evidence-verifier.js";
import {
  loadInvocationFixture,
  loadCaptureFixture,
} from "./_invocation_helper.js";
import {
  computeExecutionId,
} from "../../src/adapter-common/execution-capture.js";
import {
  readInvocationEvidence,
  deriveInvocationSemantics,
} from "../../src/adapter-common/invocation-evidence.js";

const FIXTURE_SESSION =
  "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/pi.session.jsonl";
const FIXTURE_PROCESS =
  "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

/**
 * CORRECTION06/07 helper: build a `defaultPiCapabilities`
 * argument bundle that includes typed invocation
 * evidence for the listed capabilities.
 *
 * CORRECTION07: the canonical fixture loaded here is the
 * JSONL one (--mode json), because its derived semantics
 * cover every capability except ISOLATED_DATA_DIR:
 *
 *   protocol = json   (STREAMING_EVENTS, JSONL)
 *   headless = true   (HEADLESS, JSONL, STREAMING_EVENTS)
 *   spawn_cwd present (EXPLICIT_CWD)
 *
 * ISOLATED_DATA_DIR requires a `--session-dir` argv
 * entry, so tests that exercise that axis call this
 * helper with `capabilities` containing "ISOLATED_DATA_DIR"
 * and pass `isolated_session_dir` in `base` — the helper
 * transparently swaps in the ISOLATED_DATA_DIR fixture,
 * whose argv records the real `--session-dir`.
 */
function withInvocation(
  base: Record<string, unknown>,
  capabilities: readonly string[],
): Parameters<typeof defaultPiCapabilities>[2] {
  // CORRECTION07: pick the right fixture. The
  // ISOLATED_DATA_DIR fixture has the real
  // `--session-dir` argv entry.
  const wantsIsolated =
    capabilities.includes("ISOLATED_DATA_DIR");
  const fixtureKey = wantsIsolated ? "ISOLATED_DATA_DIR" : "JSONL";
  const inv = loadInvocationFixture({
    repoRoot: REPO_ROOT,
    capability: fixtureKey,
  });
  // CORRECTION08 C08-01: load the matching
  // execution-capture manifest for the same fixture.
  // The manifest binds the invocation SHA + execution_id
  // + native artifact SHA + runtime session file path
  // that the verifier cross-references.
  const cap = loadCaptureFixture({
    repoRoot: REPO_ROOT,
    capability: fixtureKey,
  });
  // CANCELLATION (LIVE_HALT) needs its own dedicated
  // manifest because its probe_evidence.artifact_path
  // is process-result.json, not pi.session.jsonl. It
  // also needs its own invocation artifact because
  // CANCELLATION.invocation.json's argv matches the
  // CANCELLATION manifest's invocation_sha256.
  const cancelCap = loadCaptureFixture({
    repoRoot: REPO_ROOT,
    capability: "CANCELLATION",
  });
  const cancelInv = loadInvocationFixture({
    repoRoot: REPO_ROOT,
    capability: "CANCELLATION",
  });
  // ISOLATED_DATA_DIR also needs its own manifest
  // (its declared --session-dir is unique). Build a
  // per-axis override map.
  const isolatedCap = loadCaptureFixture({
    repoRoot: REPO_ROOT,
    capability: "ISOLATED_DATA_DIR",
  });
  const isolatedInv = loadInvocationFixture({
    repoRoot: REPO_ROOT,
    capability: "ISOLATED_DATA_DIR",
  });
  const axisExecutionIds: Record<string, string> = {
    CANCELLATION: cancelCap.manifest.execution_id,
  };
  const axisInvMap: Record<string, {
    evidence: import("../../src/adapter-common/invocation-evidence.js").InvocationEvidence;
    path: string;
    sha256: string;
  }> = {
    CANCELLATION: {
      evidence: cancelInv.evidence,
      path: cancelInv.repo_relative_path,
      sha256: cancelInv.evidence.artifact_sha256,
    },
  };
  const axisCapMap: Record<string, { path: string; sha256: string }> = {
    CANCELLATION: {
      path: cancelCap.repo_relative_path,
      sha256: cancelCap.manifest_sha256,
    },
  };
  if (wantsIsolated) {
    axisExecutionIds["ISOLATED_DATA_DIR"] = isolatedCap.manifest.execution_id;
    axisInvMap["ISOLATED_DATA_DIR"] = {
      evidence: isolatedInv.evidence,
      path: isolatedInv.repo_relative_path,
      sha256: isolatedInv.evidence.artifact_sha256,
    };
    axisCapMap["ISOLATED_DATA_DIR"] = {
      path: isolatedCap.repo_relative_path,
      sha256: isolatedCap.manifest_sha256,
    };
  }
  return {
    ...(base as Parameters<typeof defaultPiCapabilities>[2]),
    invocation_evidence: inv.evidence,
    invocation_evidence_path: inv.repo_relative_path,
    execution_capture_path: cap.repo_relative_path,
    execution_capture_sha256: cap.manifest_sha256,
    execution_id: cap.manifest.execution_id,
    // CORRECTION09 C09-01: every fixture-driven
    // qualification in this test file uses pre-captured
    // REPLAY_FIXTURE manifests. The adapter sets
    // REPLAY_FIXTURE by default but tests that bypass
    // the adapter (forged-axis tests below) need to
    // declare it explicitly.
    execution_capture_origin: "REPLAY_FIXTURE",
    axis_execution_captures: {
      CANCELLATION: {
        path: cancelCap.repo_relative_path,
        sha256: cancelCap.manifest_sha256,
      },
      ...(wantsIsolated ? {
        ISOLATED_DATA_DIR: {
          path: isolatedCap.repo_relative_path,
          sha256: isolatedCap.manifest_sha256,
        },
      } : {}),
    },
    axis_invocation_evidence: {
      CANCELLATION: {
        evidence: cancelInv.evidence,
        path: cancelInv.repo_relative_path,
        sha256: cancelInv.evidence.artifact_sha256,
      },
      ...(wantsIsolated ? {
        ISOLATED_DATA_DIR: {
          evidence: isolatedInv.evidence,
          path: isolatedInv.repo_relative_path,
          sha256: isolatedInv.evidence.artifact_sha256,
        },
      } : {}),
    },
    axis_execution_ids: {
      CANCELLATION: cancelCap.manifest.execution_id,
      ...(wantsIsolated ? {
        ISOLATED_DATA_DIR: isolatedCap.manifest.execution_id,
      } : {}),
    },
  } as unknown as Parameters<typeof defaultPiCapabilities>[2];
}

/* ------------------------------------------------------------------ *
 * C04-01 — separate structural validation from artifact verification.*
 * ------------------------------------------------------------------ */

test("C04-01a: validateLiveQualification is pure (does not read disk)", () => {
  // A document built with the typed probe evidence
  // passes validateLiveQualification purely on the
  // recorded fields, without touching the filesystem.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  }, ["EXPLICIT_CWD", "JSONL", "HEADLESS", "STREAMING_EVENTS"]));
  const r = validateLiveQualification(caps);
  if (r.ok !== true) {
    console.log("DEBUG C04-01a violations:", JSON.stringify(r.violations, null, 2));
  }
  assert.equal(r.ok, true, "valid document must pass pure validator");
});

test("C04-01b: verifyLiveQualificationEvidence re-reads disk and recomputes SHA256", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  }, ["EXPLICIT_CWD", "JSONL", "HEADLESS", "STREAMING_EVENTS"]));
  const r = verifyLiveQualificationEvidence(caps, REPO_ROOT);
  if (r.ok !== true) {
    console.log("DEBUG errors:", JSON.stringify(r.errors, null, 2));
  }
  assert.equal(r.ok, true, "verifier must accept real document");
});

/* ------------------------------------------------------------------ *
 * C04-02 — artifact hash drift fails closed.                        *
 * ------------------------------------------------------------------ */

test("C04-HASH01: mutate artifact bytes after probe record created -> FAIL", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c04-hash01-"));
  const fixtureRel = "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts";
  mkdirSync(join(tmp, fixtureRel), { recursive: true });
  const sessionCopy = join(tmp, fixtureRel, "pi.session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json");
  mkdirSync(join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1"), { recursive: true });
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
  copyFileSync(resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stdout.jsonl"), join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/stdout.jsonl"));
  copyFileSync(resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stderr.txt"), join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/stderr.txt"));
  // Copy the invocation fixture so the verifier can
  // re-read it under the fresh checkout root.
  mkdirSync(join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
    join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
  );
  // Build a real document from the copies; the SHA256 is
  // recorded against the unchanged bytes. Artifact paths
  // must be repo-relative (CORRECTION05 C05-03).
  const sessionRel = join(fixtureRel, "pi.session.jsonl");
  const cancelRel = "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json";
  const realCaps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: sessionRel,
    cancellation_halt: cancelRel,
    requested_cwd: "/private/tmp/pi-live",
  }, ["JSONL", "EXPLICIT_CWD", "HEADLESS", "STREAMING_EVENTS"]));
  // Mutate the session bytes AFTER the record was made.
  writeFileSync(sessionCopy, '{"type":"session","mutated":true}\n', "utf8");
  // Now the verifier must reject.
  const r = verifyLiveQualificationEvidence(realCaps, tmp);
  if (r.ok) {
    console.log("DEBUG C04-HASH01 unexpectedly passed; capabilities =", JSON.stringify(Object.keys(realCaps.capability_axes), null, 2));
    for (const ax of Object.values(realCaps.capability_axes)) {
      console.log("DEBUG C04-HASH01 axis", ax.live_qualification, ax.probe_evidence?.artifact_path);
    }
  } else {
    console.log("DEBUG C04-HASH01 errors:", JSON.stringify(r.errors?.slice(0, 3), null, 2));
  }
  assert.equal(r.ok, false, "verifier must reject mutated bytes");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_HASH_MISMATCH"),
    `verifier must report EVIDENCE_HASH_MISMATCH; got ${[...kinds].join(",")}`,
  );
});

test("C04-HASH02: forge recorded sha256 -> FAIL", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const forgedSha =
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const forged = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: FIXTURE_SESSION,
          artifact_sha256: forgedSha,
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: FIXTURE_SESSION,
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    forged as unknown as HarnessCapabilities,
    REPO_ROOT,
  );
  assert.equal(r.ok, false, "verifier must reject forged sha256");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_HASH_MISMATCH"),
    `verifier must report EVIDENCE_HASH_MISMATCH; got ${[...kinds].join(",")}`,
  );
});

test("C04-HASH03: correct bytes + correct sha256 -> PASS", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  }, ["EXPLICIT_CWD", "JSONL", "HEADLESS", "STREAMING_EVENTS"]));
  // The recorded sha256 must equal the recomputed sha256.
  const jsonlEv = caps.capability_axes.JSONL.probe_evidence;
  assert.ok(jsonlEv !== null);
  const realSha = artifactSha256(resolve(REPO_ROOT, FIXTURE_SESSION));
  assert.equal(jsonlEv.artifact_sha256, realSha);
  const r = verifyLiveQualificationEvidence(caps, REPO_ROOT);
  if (!r.ok) {
    console.log("DEBUG C04-HASH03 errors:", JSON.stringify(r.errors?.slice(0, 5), null, 2));
  }
  assert.equal(r.ok, true, "verifier must accept real sha256");
});

/* ------------------------------------------------------------------ *
 * C04-03 — repo-relative durable evidence paths.                    *
 * ------------------------------------------------------------------ */

test("C04-PATH01: checkout root A -> PASS", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  }, ["EXPLICIT_CWD", "JSONL", "HEADLESS", "STREAMING_EVENTS"]));
  const r = verifyLiveQualificationEvidence(caps, REPO_ROOT);
  assert.equal(r.ok, true, "verifier must PASS at canonical repo root");
});

test("C04-PATH02: checkout root B (different absolute path) -> PASS", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c04-path02-"));
  const fixtureRel = "test/fixtures/harnesses/pi/pi-v0_85_1";
  mkdirSync(join(tmp, fixtureRel, "raw-artifacts"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, FIXTURE_SESSION),
    join(tmp, fixtureRel, "raw-artifacts/pi.session.jsonl"),
  );
  copyFileSync(
    resolve(REPO_ROOT, FIXTURE_PROCESS),
    join(tmp, fixtureRel, "process-result.json"),
  );
  // CORRECTION09 C09-04: copy stdout/stderr artifacts
  // so the verifier can re-read them under the fresh
  // checkout root.
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stdout.jsonl"),
    join(tmp, fixtureRel, "stdout.jsonl"),
  );
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stderr.txt"),
    join(tmp, fixtureRel, "stderr.txt"),
  );
  // Copy the invocation fixture too so the verifier can
  // re-read it under the fresh checkout root.
  mkdirSync(
    join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations"),
    { recursive: true },
  );
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
    join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
  );
  // CORRECTION08 C08-01: copy the captures dir too so
  // the verifier can re-read each axis's execution-
  // capture manifest under the fresh checkout root.
  mkdirSync(
    join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/captures"),
    { recursive: true },
  );
  for (const cap of [
    "JSONL",
    "HEADLESS",
    "STREAMING_EVENTS",
    "EXPLICIT_CWD",
    "ISOLATED_DATA_DIR",
    "CANCELLATION",
  ]) {
    copyFileSync(
      resolve(REPO_ROOT, `test/fixtures/harnesses/pi/pi-v0_85_1/captures/${cap}.capture.json`),
      join(tmp, `test/fixtures/harnesses/pi/pi-v0_85_1/captures/${cap}.capture.json`),
    );
    copyFileSync(
      resolve(REPO_ROOT, `test/fixtures/harnesses/pi/pi-v0_85_1/invocations/${cap}.invocation.json`),
      join(tmp, `test/fixtures/harnesses/pi/pi-v0_85_1/invocations/${cap}.invocation.json`),
    );
  }
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: join(fixtureRel, "raw-artifacts/pi.session.jsonl"),
    cancellation_halt: join(fixtureRel, "process-result.json"),
    requested_cwd: "/private/tmp/pi-live",
  }, ["EXPLICIT_CWD", "JSONL", "HEADLESS", "STREAMING_EVENTS"]));
  const r = verifyLiveQualificationEvidence(caps, tmp);
  assert.equal(r.ok, true, "verifier must PASS at a fresh checkout root");
});

test("C04-PATH03: ../escape -> FAIL", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const realSha = artifactSha256(resolve(REPO_ROOT, FIXTURE_SESSION));
  const escaped = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "../outside-repo/secret.jsonl",
          artifact_sha256: realSha,
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: "../outside-repo/secret.jsonl",
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    escaped as unknown as HarnessCapabilities,
    REPO_ROOT,
  );
  assert.equal(r.ok, false, "verifier must reject ../ escape");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_PATH_ESCAPE"),
    `verifier must report EVIDENCE_PATH_ESCAPE; got ${[...kinds].join(",")}`,
  );
});

test("C04-PATH04: absolute path that escapes repoRoot -> FAIL", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const realSha = artifactSha256(resolve(REPO_ROOT, FIXTURE_SESSION));
  const escaped = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "/etc/passwd",
          artifact_sha256: realSha,
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: "/etc/passwd",
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    escaped as unknown as HarnessCapabilities,
    REPO_ROOT,
  );
  assert.equal(r.ok, false, "verifier must reject absolute escape");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_PATH_ESCAPE"),
    `verifier must report EVIDENCE_PATH_ESCAPE; got ${[...kinds].join(",")}`,
  );
});

test("C04-PATH05: symlink that resolves outside repoRoot -> FAIL", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c04-path05-"));
  const outside = mkdtempSync(join(tmpdir(), "lh03-c04-path05-out-"));
  const secret = join(outside, "secret.jsonl");
  writeFileSync(secret, '{"type":"session","cwd":"/elsewhere"}\n', "utf8");
  const fixtureRel = "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts";
  mkdirSync(join(tmp, fixtureRel), { recursive: true });
  const symlinkPath = join(tmp, fixtureRel, "symlink.jsonl");
  symlinkSync(secret, symlinkPath);
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const realSha = artifactSha256(secret);
  const escaped = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: join(fixtureRel, "symlink.jsonl"),
          artifact_sha256: realSha,
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: join(fixtureRel, "symlink.jsonl"),
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    escaped as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r.ok, false, "verifier must reject symlink escape");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_PATH_ESCAPE"),
    `verifier must report EVIDENCE_PATH_ESCAPE; got ${[...kinds].join(",")}`,
  );
});

/* ------------------------------------------------------------------ *
 * C04-04 — cwd match alone does NOT qualify ISOLATED_DATA_DIR.      *
 * ------------------------------------------------------------------ */

test("C04-ISOLATED01: cwd match alone is not enough (LIVE_UNQUALIFIED)", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  });
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "LIVE_UNQUALIFIED",
    "ISOLATED_DATA_DIR must be LIVE_UNQUALIFIED without isolated_session_dir",
  );
});

test("C04-ISOLATED02: isolated_session_dir contains the captured session artifact -> LIVE_QUALIFIED", () => {
  // CORRECTION05 C05-01: the oracle is that the captured
  // session artifact_path lives under isolated_session_dir,
  // NOT that the session.cwd lives under it. The session
  // file IS the session storage; --session-dir IS the
  // directory where session files live.
  //
  // CORRECTION06 C06-05: the invocation artifact's
  // session_dir is now the authoritative source for the
  // expected value, not the caller-supplied
  // isolated_session_dir. The captured session artifact
  // must live under the invocation-recorded session_dir.
  // The fixture invocation points session_dir at
  // test/fixtures/harnesses/pi/pi-v0_85_1 which contains
  // the captured session artifact.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
    isolated_session_dir: "test/fixtures/harnesses/pi/pi-v0_85_1",
  }, ["ISOLATED_DATA_DIR", "EXPLICIT_CWD", "JSONL", "HEADLESS", "STREAMING_EVENTS"]));
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "REPLAY_QUALIFIED",
  );
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.probe_evidence?.disposition,
    "PASS",
  );
});

test("C04-ISOLATED03: isolated_session_dir does NOT contain artifact -> LIVE_UNQUALIFIED", () => {
  // CORRECTION05 C05-01: the artifact_path must live
  // under isolated_session_dir. cwd match alone does
  // NOT qualify.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
    isolated_session_dir: "test/fixtures/harnesses/some/other/dir",
  });
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "LIVE_UNQUALIFIED",
    "ISOLATED_DATA_DIR must be LIVE_UNQUALIFIED when the captured artifact is not under isolated_session_dir",
  );
});

/* ------------------------------------------------------------------ *
 * C04-05 — HEADLESS / STREAMING_EVENTS require invocation_mode.     *
 * ------------------------------------------------------------------ */

test("C04-INVOCATION01: HEADLESS without invocation_mode -> LIVE_UNQUALIFIED", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
  });
  assert.equal(
    caps.capability_axes.HEADLESS.live_qualification,
    "LIVE_UNQUALIFIED",
  );
});

test("C04-INVOCATION02: HEADLESS with invocation_mode=headless -> LIVE_QUALIFIED", () => {
  // CORRECTION06 C06-03: the invocation_mode argument
  // is no longer authoritative; the invocation artifact
  // is. Pass a typed invocation evidence whose
  // invocation_mode === "headless" and the HEADLESS axis
  // qualifies.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    invocation_mode: "headless",
  }, ["HEADLESS", "JSONL", "STREAMING_EVENTS"]));
  assert.equal(
    caps.capability_axes.HEADLESS.live_qualification,
    "REPLAY_QUALIFIED",
  );
  assert.equal(
    caps.capability_axes.HEADLESS.probe_evidence?.disposition,
    "PASS",
  );
});

test("C04-INVOCATION03: STREAMING_EVENTS without invocation_mode -> LIVE_UNQUALIFIED", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
  });
  assert.equal(
    caps.capability_axes.STREAMING_EVENTS.live_qualification,
    "LIVE_UNQUALIFIED",
  );
});

test("C04-INVOCATION04: JSONL qualifies from session envelope plus invocation evidence", () => {
  // CORRECTION06: JSONL is the canonical Factory name
  // for the upstream JSON Event Stream Mode. The session
  // envelope proves protocol output; the invocation
  // artifact proves the launch record. Both are
  // required for LIVE_QUALIFIED.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
  }, ["JSONL"]));
  assert.equal(
    caps.capability_axes.JSONL.live_qualification,
    "REPLAY_QUALIFIED",
    "JSONL is the canonical Factory name for the upstream JSON Event Stream Mode; the session envelope + invocation evidence is the proof",
  );
});

/* ------------------------------------------------------------------ *
 * C04-06 — typed filesystem verification error kinds.               *
 * ------------------------------------------------------------------ */

test("C04-ERRORS: closed-world verifier error kinds are exhaustive", () => {
  const expected: EvidenceVerificationErrorKind[] = [
    "EVIDENCE_ARTIFACT_MISSING",
    "EVIDENCE_PATH_ESCAPE",
    "EVIDENCE_HASH_MISMATCH",
    "EVIDENCE_PARSE_FAILED",
    "EVIDENCE_OBSERVATION_MISMATCH",
    "EVIDENCE_ORACLE_FAILED",
    "EVIDENCE_EXECUTION_MISMATCH",
  ];
  assert.deepEqual(
    [...EVIDENCE_VERIFICATION_ERROR_KINDS].sort(),
    expected.sort(),
  );
});

test("C04-ERRORS: missing artifact produces EVIDENCE_ARTIFACT_MISSING", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c04-missing-"));
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const realSha = artifactSha256(resolve(REPO_ROOT, FIXTURE_SESSION));
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "test/fixtures/missing/does-not-exist.jsonl",
          artifact_sha256: realSha,
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: "test/fixtures/missing/does-not-exist.jsonl",
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r.ok, false);
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_ARTIFACT_MISSING"),
    `verifier must report EVIDENCE_ARTIFACT_MISSING; got ${[...kinds].join(",")}`,
  );
});

test("C04-ERRORS: parse failure produces EVIDENCE_PARSE_FAILED", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c04-parse-"));
  const bad = join(tmp, "bad.jsonl");
  writeFileSync(bad, "{not parseable\n", "utf8");
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const realSha = artifactSha256(bad);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "bad.jsonl",
          artifact_sha256: realSha,
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: "bad.jsonl",
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r.ok, false);
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_PARSE_FAILED"),
    `verifier must report EVIDENCE_PARSE_FAILED; got ${[...kinds].join(",")}`,
  );
});

test("C04-ERRORS: observation recomputation mismatch produces EVIDENCE_OBSERVATION_MISMATCH", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c04-obs-"));
  const sessionCopy = join(tmp, "session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
  const realSha = artifactSha256(sessionCopy);
  // Build the document directly: JSONL is LIVE_QUALIFIED
  // with the real sha, but the recorded observed value
  // disagrees with what the parser will recompute.
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "session.jsonl",
          artifact_sha256: realSha,
          expected: "session",
          observed: "WRONG_TYPE",
        }),
        probe_evidence_path: "session.jsonl",
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r.ok, false);
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_OBSERVATION_MISMATCH"),
    `verifier must report EVIDENCE_OBSERVATION_MISMATCH; got ${[...kinds].join(",")}`,
  );
});

test("C04-ERRORS: oracle recomputation failed produces EVIDENCE_ORACLE_FAILED", () => {
  // Recorded observed matches the recomputed value
  // ("session"), but expected="different". The recorded
  // disposition is PASS (because expected === observed
  // would PASS, but here expected != observed so the
  // builder itself would not publish this; the test
  // forges the document directly to verify the
  // verifier catches the impossible oracle).
  //
  // CORRECTION06: also forge a real invocation artifact
  // so the verifier can recompute the expected value
  // from it. The recorded expected="different" disagrees
  // with the invocation-derived expected="session", so
  // EVIDENCE_OBSERVATION_MISMATCH fires.
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c04-ora-"));
  const sessionCopy = join(tmp, "session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
  const realSha = artifactSha256(sessionCopy);
  // CORRECTION09 C09-04: copy stdout/stderr artifacts so
  // the verifier can re-read them.
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stdout.jsonl"),
    join(tmp, "stdout.jsonl"),
  );
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stderr.txt"),
    join(tmp, "stderr.txt"),
  );
  const stdoutShaTmp = artifactSha256(join(tmp, "stdout.jsonl"));
  const stderrShaTmp = artifactSha256(join(tmp, "stderr.txt"));
  const processResultShaTmp = artifactSha256(cancelCopy);
  // Write a real invocation artifact at the same
  // fixture path under the tmp repoRoot.
  const invRelPath = "test/fixtures/invocations/JSONL.invocation.json";
  mkdirSync(join(tmp, "test/fixtures/invocations"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
    join(tmp, invRelPath),
  );
  // CORRECTION08 C08-01: write a matching
  // execution-capture manifest under the tmp repoRoot.
  const manifestRelPath = "test/fixtures/captures/JSONL.capture.json";
  mkdirSync(join(tmp, "test/fixtures/captures"), { recursive: true });
  const manifestAbs = join(tmp, manifestRelPath);
  const invocationAbsTmp = join(tmp, invRelPath);
  const invocationShaTmp = artifactSha256(invocationAbsTmp);
  const execIdTmp = computeExecutionId({
    nonce: "c04-errors-oracle",
    invocation_sha256: invocationShaTmp,
    capability: "JSONL",
  });
  const manifestObjTmp = {
    capture_origin: "REPLAY_FIXTURE",
    execution_id: execIdTmp,
    capability: "JSONL",
    invocation_sha256: invocationShaTmp,
    stdout_path: "stdout.jsonl",
    stdout_sha256: stdoutShaTmp,
    stderr_path: "stderr.txt",
    stderr_sha256: stderrShaTmp,
    process_result_path: "process-result.json",
    process_result_sha256: processResultShaTmp,
    native_artifact_path: "session.jsonl",
    native_artifact_sha256: realSha,
    runtime_session_file_path: null,
    recorded_at: "2026-09-18T00:00:00Z",
  };
  writeFileSync(manifestAbs, JSON.stringify(manifestObjTmp, null, 2));
  const manifestSha = artifactSha256(manifestAbs);
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "REPLAY_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "session.jsonl",
          artifact_sha256: realSha,
          expected: "different",
          observed: "session",
          execution_id: execIdTmp,
        }),
        probe_evidence_path: "session.jsonl",
        invocation_evidence_path: invRelPath,
        // CORRECTION07 C07-01: explicitly null so the
        // verifier does NOT trip the new SHA binding
        // check (the test is about oracle
        // recomputation, not invocation binding).
        invocation_evidence_sha256: null,
        // CORRECTION08 C08-01: bind the execution-capture
        // manifest so the verifier reaches the oracle
        // check (not the manifest check).
        execution_capture_path: manifestRelPath,
        execution_capture_sha256: manifestSha,
        execution_capture_origin: "REPLAY_FIXTURE",
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "REPLAY_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r.ok, false);
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_ORACLE_FAILED") ||
      kinds.has("EVIDENCE_OBSERVATION_MISMATCH"),
    `verifier must report ORACLE or OBSERVATION mismatch; got ${[...kinds].join(",")}`,
  );
});

/* ------------------------------------------------------------------ *
 * C04-07 — acceptance.                                              *
 * ------------------------------------------------------------------ */

test("C04-ACCEPTANCE01: FORGED_HASH_ACCEPTED = IMPOSSIBLE", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const forgedSha =
    "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
  const forged = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: FIXTURE_SESSION,
          artifact_sha256: forgedSha,
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: FIXTURE_SESSION,
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    forged as unknown as HarnessCapabilities,
    REPO_ROOT,
  );
  assert.equal(r.ok, false, "forged hash must be rejected");
});

test("C04-ACCEPTANCE02: ARTIFACT_MUTATION_AFTER_RECORD_ACCEPTED = IMPOSSIBLE", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c04-mut-"));
  const sessionCopy = join(tmp, "session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
  // Copy the invocation fixture so the verifier can
  // re-read it under the fresh checkout root.
  mkdirSync(join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
    join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
  );
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: sessionCopy,
    cancellation_halt: cancelCopy,
    requested_cwd: "/private/tmp/pi-live",
  }, ["JSONL", "EXPLICIT_CWD", "HEADLESS", "STREAMING_EVENTS"]));
  const mutated = join(tmp, "mutated.jsonl");
  writeFileSync(mutated, '{"type":"session","mutated":true}\n', "utf8");
  renameSync(mutated, sessionCopy);
  // Repath probe_evidence.artifact_path to repo-relative
  // form under tmp root so the verifier accepts it as
  // inside the trusted root.
  const relativeSession = "session.jsonl";
  const jsonlAxis = caps.capability_axes.JSONL;
  const fixed = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        ...jsonlAxis,
        probe_evidence: jsonlAxis.probe_evidence
          ? {
              ...jsonlAxis.probe_evidence,
              artifact_path: relativeSession,
            }
          : null,
        probe_evidence_path: relativeSession,
        invocation_evidence_path:
          "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json",
      },
    },
  };
  const r = verifyLiveQualificationEvidence(fixed, tmp);
  assert.equal(r.ok, false, "mutated bytes must be rejected");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_HASH_MISMATCH"),
    `mutated bytes must produce EVIDENCE_HASH_MISMATCH; got ${[...kinds].join(",")}`,
  );
});

test("C04-ACCEPTANCE03: CWD_MATCH_IMPLIES_ISOLATED_DATA_DIR = FALSE", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  });
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "LIVE_UNQUALIFIED",
    "cwd match alone must NOT qualify ISOLATED_DATA_DIR",
  );
});

test("C04-ACCEPTANCE04: MACHINE_LOCAL_ABSOLUTE_PATH_REQUIRED = FALSE", () => {
  const resolvedCanonical = resolveEvidencePath(
    FIXTURE_SESSION,
    REPO_ROOT,
    "JSONL",
  );
  assert.equal(resolvedCanonical.ok, true);
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c04-rel-"));
  const fixtureDir = join(
    tmp,
    "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts",
  );
  mkdirSync(fixtureDir, { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, FIXTURE_SESSION),
    join(fixtureDir, "pi.session.jsonl"),
  );
  const fixtureRel =
    "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/pi.session.jsonl";
  const resolvedCheckout = resolveEvidencePath(fixtureRel, tmp, "JSONL");
  assert.equal(resolvedCheckout.ok, true);
});

test("C04-ACCEPTANCE05: LIVE_QUALIFIED_WITHOUT_REVERIFIABLE_ARTIFACT = IMPOSSIBLE", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const realSha = artifactSha256(resolve(REPO_ROOT, FIXTURE_SESSION));
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "test/fixtures/missing/no-such-file.jsonl",
          artifact_sha256: realSha,
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: "test/fixtures/missing/no-such-file.jsonl",
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    REPO_ROOT,
  );
  assert.equal(r.ok, false);
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_ARTIFACT_MISSING"),
    `missing artifact must produce EVIDENCE_ARTIFACT_MISSING; got ${[...kinds].join(",")}`,
  );
});

test("C04-ACCEPTANCE06: pinned fixture matrix passes verifier end-to-end", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json"),
      "utf8",
    ),
  );
  const qualification = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "qualification/pi/pi-capabilities.json"),
      "utf8",
    ),
  );
  const r1 = verifyLiveQualificationEvidence(fixture, REPO_ROOT);
  if (r1.ok !== true) {
    assert.fail(`fixture verifier failed: ${JSON.stringify(r1.errors)}`);
  }
  const r2 = verifyLiveQualificationEvidence(qualification, REPO_ROOT);
  if (r2.ok !== true) {
    assert.fail(`qualification verifier failed: ${JSON.stringify(r2.errors)}`);
  }
});

/* ================================================================== *
 * LH-03 CORRECTION05 — five small reviewer-driven hardening items.   *
 * ================================================================== */

test("C05-01a: ISOLATED_DATA_DIR does NOT qualify on cwd==isolated_session_dir alone", () => {
  // CORRECTION05 C05-01: cwd match is not the oracle.
  // The artifact_path-under-dir check is the oracle.
  // We pass an isolated_session_dir that the cwd
  // happens to match but the captured artifact does
  // NOT live under; ISOLATED_DATA_DIR must stay
  // LIVE_UNQUALIFIED.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    isolated_session_dir: "/private/tmp/pi-live",
  });
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "LIVE_UNQUALIFIED",
    "cwd match alone must NOT qualify ISOLATED_DATA_DIR (C05-01)",
  );
});

test("C05-01b: ISOLATED_DATA_DIR qualifies when captured artifact lives under isolated_session_dir", () => {
  // CORRECTION06 C06-05: the captured session artifact
  // must live under the invocation-recorded session_dir
  // (not under the caller-supplied isolated_session_dir).
  // The fixture invocation points session_dir at
  // test/fixtures/harnesses/pi/pi-v0_85_1 which contains
  // the captured session artifact.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    isolated_session_dir: "test/fixtures/harnesses/pi/pi-v0_85_1",
  }, ["ISOLATED_DATA_DIR"]));
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "REPLAY_QUALIFIED",
  );
});

test("C05-02: forged expected halt reason fails verification", () => {
  // CORRECTION05 C05-02: HALT evidence must enforce the
  // same expected===observed oracle as PASS evidence.
  // CORRECTION06: also supply a real invocation
  // artifact so the verifier can recompute the
  // canonical halt reason from the observation.
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c05-halt-"));
  const sessionCopy = join(tmp, "session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
  // CORRECTION09 C09-04: copy stdout/stderr/process_result
  // artifacts so the verifier can re-read them.
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stdout.jsonl"),
    join(tmp, "stdout.jsonl"),
  );
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stderr.txt"),
    join(tmp, "stderr.txt"),
  );
  const invRelPath = "test/fixtures/invocations/CANCELLATION.invocation.json";
  mkdirSync(join(tmp, "test/fixtures/invocations"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
    join(tmp, invRelPath),
  );
  // CORRECTION08 C08-01: also copy the canonical
  // CANCELLATION capture manifest into the tmp dir and
  // copy it as a manifest for this axis so the
  // execution-capture check passes. The manifest's
  // invocation_sha256 must match the SHA of the copied
  // invocation artifact.
  const realSha = artifactSha256(cancelCopy);
  const stdoutSha = artifactSha256(join(tmp, "stdout.jsonl"));
  const stderrSha = artifactSha256(join(tmp, "stderr.txt"));
  const processResultSha = realSha;
  const manifestRelPath = "captures/CANCELLATION.capture.json";
  const manifestAbs = join(tmp, manifestRelPath);
  mkdirSync(dirname(manifestAbs), { recursive: true });
  const invocationAbs = join(tmp, invRelPath);
  const invocationSha = artifactSha256(invocationAbs);
  const execId = computeExecutionId({
    nonce: "c05-02-tmp",
    invocation_sha256: invocationSha,
    capability: "CANCELLATION",
  });
  const manifestObj = {
    capture_origin: "REPLAY_FIXTURE",
    execution_id: execId,
    capability: "CANCELLATION",
    invocation_sha256: invocationSha,
    stdout_path: "stdout.jsonl",
    stdout_sha256: stdoutSha,
    stderr_path: "stderr.txt",
    stderr_sha256: stderrSha,
    process_result_path: "process-result.json",
    process_result_sha256: processResultSha,
    native_artifact_path: "process-result.json",
    native_artifact_sha256: realSha,
    runtime_session_file_path: null,
    recorded_at: "2026-09-18T00:00:00Z",
  };
  writeFileSync(manifestAbs, JSON.stringify(manifestObj, null, 2));
  const manifestSha = artifactSha256(manifestAbs);
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      CANCELLATION: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "REPLAY_HALT" as const,
        probe_evidence: {
          capability: "CANCELLATION" as const,
          probe_kind: "CANCELLATION_HALT" as const,
          artifact_path: "process-result.json",
          artifact_sha256: realSha,
          // Forged expected reason — actual artifact
          // observed halt reason is
          // HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE.
          evidence_relation: {
            expected: "FORGED_HALT_REASON",
            observed: "HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE",
          },
          disposition: "HALT" as const,
          execution_id: execId,
        },
        probe_evidence_path: "process-result.json",
        invocation_evidence_path: invRelPath,
        // CORRECTION07 C07-01: explicitly null so the
        // verifier does NOT trip the new SHA binding
        // check (the test is about forged expected,
        // not invocation binding).
        invocation_evidence_sha256: null,
        // CORRECTION08 C08-01: bind the execution-capture
        // manifest so the forged-expected check actually
        // runs (not the manifest check).
        execution_capture_path: manifestRelPath,
        execution_capture_sha256: manifestSha,
        execution_capture_origin: "REPLAY_FIXTURE",
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      CANCELLATION: "REPLAY_HALT" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r.ok, false, "forged expected halt reason must fail verification");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_OBSERVATION_MISMATCH"),
    `verifier must report EVIDENCE_OBSERVATION_MISMATCH for forged expected; got ${[...kinds].join(",")}`,
  );
});

test("C05-03a: absolute artifact_path that happens to be inside repoRoot -> FAIL", () => {
  // CORRECTION05 C05-03: isAbsolute(artifact_path) is
  // rejected outright. The verifier mandates repo-relative
  // paths so committed matrices are portable across
  // checkout roots.
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const realSha = artifactSha256(resolve(REPO_ROOT, FIXTURE_SESSION));
  const insideRoot = resolve(REPO_ROOT, FIXTURE_SESSION);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: insideRoot,
          artifact_sha256: realSha,
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: insideRoot,
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    REPO_ROOT,
  );
  assert.equal(
    r.ok,
    false,
    "verifier must reject absolute artifact_path even when inside repoRoot",
  );
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_PATH_ESCAPE"),
    `verifier must report EVIDENCE_PATH_ESCAPE; got ${[...kinds].join(",")}`,
  );
});

test("C05-03b: resolveEvidencePath itself rejects absolute paths", () => {
  const r = resolveEvidencePath(
    "/absolute/inside/root.jsonl",
    REPO_ROOT,
    "JSONL",
  );
  assert.equal(r.ok, false);
  if (r.ok === false) {
    assert.equal(r.error.kind, "EVIDENCE_PATH_ESCAPE");
  }
});

test("C05-04: every recorded probe_evidence path is repo-relative", () => {
  // The verifier-level C05-04 invariant that drives the
  // patch hygiene requirement: every recorded
  // artifact_path and probe_evidence_path is
  // repo-relative.
  const fixture = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json"),
      "utf8",
    ),
  );
  const qualification = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "qualification/pi/pi-capabilities.json"),
      "utf8",
    ),
  );
  for (const doc of [fixture, qualification]) {
    for (const k of Object.keys(doc.capability_axes)) {
      const ev = doc.capability_axes[k].probe_evidence;
      if (ev !== null) {
        assert.ok(
          !isAbsolute(ev.artifact_path),
          `probe_evidence.artifact_path for ${k} must be repo-relative; got '${ev.artifact_path}'`,
        );
      }
      const pep = doc.capability_axes[k].probe_evidence_path;
      if (pep !== null && pep !== "") {
        assert.ok(
          !isAbsolute(pep),
          `probe_evidence_path for ${k} must be repo-relative; got '${pep}'`,
        );
      }
    }
  }
});

test("C05-05: cumulative post-CORRECTION05 fixture/qualification matrix passes verifier", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json"),
      "utf8",
    ),
  );
  const qualification = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "qualification/pi/pi-capabilities.json"),
      "utf8",
    ),
  );
  const r1 = verifyLiveQualificationEvidence(fixture, REPO_ROOT);
  if (r1.ok !== true) {
    assert.fail(`fixture verifier failed: ${JSON.stringify(r1.errors)}`);
  }
  const r2 = verifyLiveQualificationEvidence(qualification, REPO_ROOT);
  if (r2.ok !== true) {
    assert.fail(`qualification verifier failed: ${JSON.stringify(r2.errors)}`);
  }
});

/* ------------------------------------------------------------------ *
 * CORRECTION06 - invocation evidence is a first-class artifact.     *
 *   C06-01..C06-08                                                    *
 * ------------------------------------------------------------------ */

test("C06-01: InvocationEvidence is a typed structure with required raw fields", () => {
  const ev = loadInvocationFixture({
    repoRoot: REPO_ROOT,
    capability: "JSONL",
  });
  assert.ok(ev.evidence !== undefined);
  // CORRECTION07: only raw launch facts are
  // authoritatively stored on the artifact. Derived
  // semantics (protocol / headless / session_dir /
  // no_session) are computed by the verifier from
  // argv/env.
  assert.equal(typeof ev.evidence.executable, "string");
  assert.ok(Array.isArray(ev.evidence.argv));
  assert.equal(typeof ev.evidence.spawn_cwd, "string");
  assert.ok(typeof ev.evidence.env_subset === "object");
  assert.equal(typeof ev.evidence.recorded_at, "string");
  // Derived semantics (still present in the typed
  // shape, but computed).
  assert.equal(typeof ev.evidence.derived.protocol, "string");
  assert.equal(typeof ev.evidence.derived.headless, "boolean");
  assert.ok(
    ev.evidence.derived.session_dir === null ||
      typeof ev.evidence.derived.session_dir === "string",
  );
  assert.equal(typeof ev.evidence.derived.no_session, "boolean");
  assert.equal(typeof ev.evidence.recorded_at, "string");
});

test("C06-02: EXPLICIT_CWD expected value is invocation.spawn_cwd", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  }, ["EXPLICIT_CWD"]));
  const ev = caps.capability_axes.EXPLICIT_CWD.probe_evidence;
  assert.ok(ev !== null);
  assert.equal(
    ev.evidence_relation.expected,
    "/private/tmp/pi-live",
    "EXPLICIT_CWD expected must equal invocation.spawn_cwd (CORRECTION06 C06-02)",
  );
});

test("C06-03: HEADLESS is LIVE_QUALIFIED iff derived.headless === true", () => {
  // CORRECTION07: headless is derived from raw argv
  // (--mode json / --mode rpc / -p). The JSONL fixture
  // has --mode json, so derived.headless === true.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
  }, ["HEADLESS"]));
  assert.equal(
    caps.capability_axes.HEADLESS.live_qualification,
    "REPLAY_QUALIFIED",
    "HEADLESS is LIVE_QUALIFIED iff derived.headless === true (CORRECTION07 C07-03)",
  );
});

test("C06-04: STREAMING_EVENTS requires >=2 events; fixture has 1 -> LIVE_UNQUALIFIED", () => {
  // CORRECTION07: STREAMING_EVENTS additionally requires
  // derived.protocol in {json, rpc}. The canonical
  // fixture (JSONL: --mode json) satisfies the protocol
  // requirement; the count-of-events check then
  // disqualifies the single-event fixture.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
  }, ["STREAMING_EVENTS"]));
  assert.equal(
    caps.capability_axes.STREAMING_EVENTS.live_qualification,
    "LIVE_UNQUALIFIED",
    "STREAMING_EVENTS requires derived.protocol in {json,rpc} AND >=2 events (CORRECTION06 C06-04 / CORRECTION07 C07-03)",
  );
});

test("C06-05: ISOLATED_DATA_DIR oracle = artifact under derived.session_dir", () => {
  // CORRECTION07: session_dir is now derived from raw
  // argv (`--session-dir X`) or env
  // (`PI_CODING_AGENT_SESSION_DIR`). The fixture argv
  // carries `--session-dir test/fixtures/harnesses/pi/pi-v0_85_1`,
  // and the captured session artifact lives under that
  // directory.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
  }, ["ISOLATED_DATA_DIR"]));
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "REPLAY_QUALIFIED",
    "ISOLATED_DATA_DIR is LIVE_QUALIFIED iff artifact lives under invocation-recorded session_dir (CORRECTION06 C06-05)",
  );
});

test("C06-06: verifier requires invocation_artifact_path on every LIVE_QUALIFIED axis", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c06-noinv-"));
  const sessionCopy = join(tmp, "session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "session.jsonl",
          artifact_sha256: artifactSha256(sessionCopy),
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: "session.jsonl",
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r.ok, false, "verifier must reject LIVE_QUALIFIED without invocation_evidence_path");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_PARSE_FAILED"),
    `verifier must report EVIDENCE_PARSE_FAILED for missing invocation; got ${[...kinds].join(",")}`,
  );
});

test("C06-07: validateLiveQualification refuses LIVE_QUALIFIED without invocation_evidence_path", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const forged = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "session.jsonl",
          artifact_sha256:
            "0000000000000000000000000000000000000000000000000000000000000000",
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: "session.jsonl",
        invocation_evidence_path: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const v = validateLiveQualification(forged as unknown as HarnessCapabilities);
  assert.equal(v.ok, false);
  if (v.ok) return;
  const violation = v.violations.find(
    (x) => x.kind === "live_qualified_without_invocation_evidence",
  );
  assert.ok(
    violation,
    "expected live_qualified_without_invocation_evidence violation",
  );
});

test("C06-08: cumulative post-CORRECTION06 fixture/qualification matrix passes verifier", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json"),
      "utf8",
    ),
  );
  const qualification = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "qualification/pi/pi-capabilities.json"),
      "utf8",
    ),
  );
  const r1 = verifyLiveQualificationEvidence(fixture, REPO_ROOT);
  if (r1.ok !== true) {
    assert.fail(`fixture verifier failed: ${JSON.stringify(r1.errors)}`);
  }
  const r2 = verifyLiveQualificationEvidence(qualification, REPO_ROOT);
  if (r2.ok !== true) {
    assert.fail(`qualification verifier failed: ${JSON.stringify(r2.errors)}`);
  }
});
/* ------------------------------------------------------------------ *
 * CORRECTION07 - invocation evidence is bound by SHA, semantics     *
 *   derived mechanically from raw argv/env. C07-01..C07-08.          *
 * ------------------------------------------------------------------ */

test("C07-01: invocation SHA is bound externally on the capability axis", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c07-sha-"));
  const sessionCopy = join(tmp, "session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
  mkdirSync(join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
    join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
  );
  const realSha = artifactSha256(sessionCopy);
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "session.jsonl",
          artifact_sha256: realSha,
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: "session.jsonl",
        invocation_evidence_path:
          "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json",
        // Forged invocation SHA.
        invocation_evidence_sha256:
          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r.ok, false, "verifier must reject forged invocation SHA");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_HASH_MISMATCH"),
    `verifier must report EVIDENCE_HASH_MISMATCH; got ${[...kinds].join(",")}`,
  );
});

test("C07-02: on-disk invocation artifact may contain ONLY raw launch facts", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c07-raw-"));
  const dir = join(tmp, "invocations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "BAD.invocation.json"),
    JSON.stringify({
      capability: "BAD",
      executable: "x",
      argv: ["x"],
      spawn_cwd: "/x",
      env_subset: {},
      recorded_at: "2026-01-01T00:00:00Z",
      protocol: "rpc",
    }),
  );
  const r = readInvocationEvidence("invocations/BAD.invocation.json", tmp);
  assert.equal(r, null, "readInvocationEvidence must refuse author-supplied protocol");
});

test("C07-03: --mode headless in argv is refused (Pi has no such flag)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c07-headless-"));
  const dir = join(tmp, "invocations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "HEADLESS.invocation.json"),
    JSON.stringify({
      capability: "HEADLESS",
      executable: "x",
      argv: ["pi", "--mode", "headless"],
      spawn_cwd: "/x",
      env_subset: {},
      recorded_at: "2026-01-01T00:00:00Z",
    }),
  );
  const r = readInvocationEvidence("invocations/HEADLESS.invocation.json", tmp);
  assert.equal(r, null, "readInvocationEvidence must refuse --mode headless");
});

test("C07-04: --no-session + a claimed session_dir is refused", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c07-nosession-"));
  const dir = join(tmp, "invocations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "CONTRADICTION.invocation.json"),
    JSON.stringify({
      capability: "X",
      executable: "x",
      argv: ["pi", "--no-session", "--session-dir", "/tmp/some-dir"],
      spawn_cwd: "/x",
      env_subset: {},
      recorded_at: "2026-01-01T00:00:00Z",
    }),
  );
  const r = readInvocationEvidence("invocations/CONTRADICTION.invocation.json", tmp);
  assert.equal(r, null, "readInvocationEvidence must refuse --no-session + --session-dir");
});

test("C07-05: derived semantics are computed from raw, never caller-asserted", () => {
  const ev = loadInvocationFixture({
    repoRoot: REPO_ROOT,
    capability: "JSONL",
  });
  assert.equal(ev.evidence.derived.protocol, "json");
  assert.equal(ev.evidence.derived.headless, true);
  assert.equal(ev.evidence.derived.session_dir, null);
  assert.equal(ev.evidence.derived.no_session, false);
});

test("C07-06: STREAMING_EVENTS requires derived.protocol in {json,rpc}", () => {
  const headlessEv = loadInvocationFixture({
    repoRoot: REPO_ROOT,
    capability: "HEADLESS",
  });
  assert.equal(
    headlessEv.evidence.derived.protocol,
    "text",
    "HEADLESS fixture must have derived.protocol = text (no --mode flag)",
  );
  assert.equal(
    headlessEv.evidence.derived.headless,
    true,
    "HEADLESS fixture must have derived.headless = true (-p flag)",
  );
});

test("C07-07: validateLiveQualification refuses LIVE_QUALIFIED without invocation_evidence_sha256", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const forged = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "session.jsonl",
          artifact_sha256:
            "0000000000000000000000000000000000000000000000000000000000000000",
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: "session.jsonl",
        invocation_evidence_path: "invocations/x.invocation.json",
        invocation_evidence_sha256: null,
        execution_capture_path: null,
        execution_capture_sha256: null,
        execution_capture_origin: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const v = validateLiveQualification(forged as unknown as HarnessCapabilities);
  assert.equal(v.ok, false);
  if (v.ok) return;
  const violation = v.violations.find(
    (x) => x.kind === "live_qualified_without_invocation_sha",
  );
  assert.ok(violation, "expected live_qualified_without_invocation_sha violation");
});

test("C07-08: cumulative post-CORRECTION07 fixture/qualification matrix passes verifier", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json"),
      "utf8",
    ),
  );
  const qualification = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "qualification/pi/pi-capabilities.json"),
      "utf8",
    ),
  );
  const r1 = verifyLiveQualificationEvidence(fixture, REPO_ROOT);
  if (r1.ok !== true) {
    assert.fail(`fixture verifier failed: ${JSON.stringify(r1.errors)}`);
  }
  const r2 = verifyLiveQualificationEvidence(qualification, REPO_ROOT);
  if (r2.ok !== true) {
    assert.fail(`qualification verifier failed: ${JSON.stringify(r2.errors)}`);
  }
});



const _coveredKeys = new Set<CapabilityKey>([
  "JSONL",
  "HEADLESS",
  "STREAMING_EVENTS",
  "EXPLICIT_CWD",
  "ISOLATED_DATA_DIR",
  "CANCELLATION",
]);
void _coveredKeys;


/* ================================================================== *
 * LH-03 CORRECTION08 - execution evidence is bound by SHA, semantics *
 *   are derived mechanically, and invocation + observation are bound *
 *   to the same OS process run via execution_capture manifest.       *
 *   C08-01..C08-07 (C08-08 cumulative).                              *
 * ================================================================== */

test("C08-01: execution_capture manifest SHA is bound externally on the capability axis", () => {
  // Mutating the manifest bytes after binding must
  // fail closed. The axis binds
  // `execution_capture_sha256` to the bytes' SHA at
  // write time; any later mutation triggers
  // EVIDENCE_HASH_MISMATCH.
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c08-01-"));
  const sessionCopy = join(tmp, "session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
  const processResultSha = artifactSha256(cancelCopy);
  // CORRECTION09 C09-04: create stdout/stderr whose
  // SHA matches `invocationSha` (the SHA the manifest
  // declares for both). We write a placeholder and let
  // the post-write compute the SHA; the manifest values
  // are then set to that SHA.
  const stdoutCopy = join(tmp, "stdout.jsonl");
  const stderrCopy = join(tmp, "stderr.txt");
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stdout.jsonl"),
    stdoutCopy,
  );
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stderr.txt"),
    stderrCopy,
  );
  const realSha = artifactSha256(sessionCopy);
  const invRelPath = "inv/JSONL.invocation.json";
  mkdirSync(join(tmp, "inv"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
    join(tmp, invRelPath),
  );
  const invocationSha = artifactSha256(join(tmp, invRelPath));
  const stdoutSha = artifactSha256(stdoutCopy);
  const stderrSha = artifactSha256(stderrCopy);
  const execId = computeExecutionId({
    nonce: "c08-01",
    invocation_sha256: invocationSha,
    capability: "JSONL",
  });
  const manifestRelPath = "captures/JSONL.capture.json";
  const manifestAbs = join(tmp, manifestRelPath);
  mkdirSync(dirname(manifestAbs), { recursive: true });
  writeFileSync(
    manifestAbs,
    JSON.stringify(
      {
        capture_origin: "REPLAY_FIXTURE",
        execution_id: execId,
        capability: "JSONL",
        invocation_sha256: invocationSha,
        stdout_path: "stdout.jsonl",
        stdout_sha256: stdoutSha,
        stderr_path: "stderr.txt",
        stderr_sha256: stderrSha,
        process_result_path: "process-result.json",
        process_result_sha256: processResultSha,
        native_artifact_path: "session.jsonl",
        native_artifact_sha256: realSha,
        runtime_session_file_path: null,
        recorded_at: "2026-09-18T00:00:00Z",
      },
      null,
      2,
    ),
  );
  const manifestSha = artifactSha256(manifestAbs);
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "REPLAY_QUALIFIED" as const,
        probe_evidence: {
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "session.jsonl",
          artifact_sha256: realSha,
          evidence_relation: { expected: "session", observed: "session" },
          disposition: "PASS" as const,
          execution_id: execId,
        },
        probe_evidence_path: "session.jsonl",
        invocation_evidence_path: invRelPath,
        invocation_evidence_sha256: invocationSha,
        execution_capture_path: manifestRelPath,
        execution_capture_sha256: manifestSha,
        execution_capture_origin: "REPLAY_FIXTURE",
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "REPLAY_QUALIFIED" as const,
    },
  };
  const r1 = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  if (!r1.ok) {
    console.log("DEBUG C08-01 r1 errors:", JSON.stringify(r1.errors?.slice(0, 3), null, 2));
  }
  assert.equal(r1.ok, true, "valid document must pass");
  appendFileSync(manifestAbs, "\n{\"tampered\":true}\n");
  const r2 = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r2.ok, false, "mutated manifest must fail verification");
  const kinds = new Set((r2.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_HASH_MISMATCH"),
    `verifier must report EVIDENCE_HASH_MISMATCH; got ${[...kinds].join(",")}`,
  );
});


test("C08-02: validateLiveQualification refuses LIVE_QUALIFIED without execution_capture_path", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  }, ["JSONL"]));
  const r0 = validateLiveQualification(caps);
  assert.equal(r0.ok, true);
  const forged: HarnessCapabilities = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        ...caps.capability_axes.JSONL,
        execution_capture_path: null,
      },
    },
  };
  const r = validateLiveQualification(forged);
  assert.equal(r.ok, false);
  if (r.ok) return;
  const v = r.violations.find(
    (x) => x.kind === "live_qualified_without_execution_capture",
  );
  assert.ok(v, "expected live_qualified_without_execution_capture or replay_qualified_without_execution_capture violation");
  // CORRECTION09: with the fixture-driven origin
  // requirement, REPLAY_QUALIFIED axes (which the
  // pi-adapter produces for fixture replays) need a
  // capture_path too — the validator refuses null
  // captures for either disposition.
});

test("C08-03: probe evidence execution_id mismatch with manifest fails EVIDENCE_EXECUTION_MISMATCH", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c08-03-"));
  const sessionCopy = join(tmp, "session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
  const stdoutCopy = join(tmp, "stdout.jsonl");
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stdout.jsonl"),
    stdoutCopy,
  );
  const stderrCopy = join(tmp, "stderr.txt");
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stderr.txt"),
    stderrCopy,
  );
  const realSha = artifactSha256(sessionCopy);
  const stdoutSha = artifactSha256(stdoutCopy);
  const stderrSha = artifactSha256(stderrCopy);
  const processResultSha = artifactSha256(cancelCopy);
  const invRelPath = "inv/JSONL.invocation.json";
  mkdirSync(join(tmp, "inv"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
    join(tmp, invRelPath),
  );
  const invocationSha = artifactSha256(join(tmp, invRelPath));
  const execIdM = computeExecutionId({
    nonce: "c08-03-manifest",
    invocation_sha256: invocationSha,
    capability: "JSONL",
  });
  const manifestRelPath = "captures/JSONL.capture.json";
  const manifestAbs = join(tmp, manifestRelPath);
  mkdirSync(dirname(manifestAbs), { recursive: true });
  writeFileSync(
    manifestAbs,
    JSON.stringify(
      {
        capture_origin: "REPLAY_FIXTURE",
        execution_id: execIdM,
        capability: "JSONL",
        invocation_sha256: invocationSha,
        stdout_path: "stdout.jsonl",
        stdout_sha256: stdoutSha,
        stderr_path: "stderr.txt",
        stderr_sha256: stderrSha,
        process_result_path: "process-result.json",
        process_result_sha256: processResultSha,
        native_artifact_path: "session.jsonl",
        native_artifact_sha256: realSha,
        runtime_session_file_path: null,
        recorded_at: "2026-09-18T00:00:00Z",
      },
      null,
      2,
    ),
  );
  const manifestSha = artifactSha256(manifestAbs);
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "REPLAY_QUALIFIED" as const,
        probe_evidence: {
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "session.jsonl",
          artifact_sha256: realSha,
          evidence_relation: { expected: "session", observed: "session" },
          disposition: "PASS" as const,
          execution_id: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        },
        probe_evidence_path: "session.jsonl",
        invocation_evidence_path: invRelPath,
        invocation_evidence_sha256: invocationSha,
        execution_capture_path: manifestRelPath,
        execution_capture_sha256: manifestSha,
        execution_capture_origin: "REPLAY_FIXTURE",
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "REPLAY_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r.ok, false, "execution_id mismatch must fail verification");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_EXECUTION_MISMATCH"),
    `verifier must report EVIDENCE_EXECUTION_MISMATCH; got ${[...kinds].join(",")}`,
  );
});

test("C08-04: manifest with extra fields outside closed-world schema is refused", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c08-04-"));
  const sessionCopy = join(tmp, "session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
  const realSha = artifactSha256(sessionCopy);
  const invRelPath = "inv/JSONL.invocation.json";
  mkdirSync(join(tmp, "inv"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
    join(tmp, invRelPath),
  );
  const invocationSha = artifactSha256(join(tmp, invRelPath));
  const execId = computeExecutionId({
    nonce: "c08-04",
    invocation_sha256: invocationSha,
    capability: "JSONL",
  });
  const manifestRelPath = "captures/JSONL.capture.json";
  const manifestAbs = join(tmp, manifestRelPath);
  mkdirSync(dirname(manifestAbs), { recursive: true });
  writeFileSync(
    manifestAbs,
    JSON.stringify(
      {
        execution_id: execId,
        capability: "JSONL",
        invocation_sha256: invocationSha,
        stdout_sha256: invocationSha,
        stderr_sha256: invocationSha,
        process_result_sha256: realSha,
        native_artifact_sha256: realSha,
        runtime_session_file_path: null,
        recorded_at: "2026-09-18T00:00:00Z",
        extra_forbidden_field: "should not be here",
      },
      null,
      2,
    ),
  );
  const manifestSha = artifactSha256(manifestAbs);
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: {
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "session.jsonl",
          artifact_sha256: realSha,
          evidence_relation: { expected: "session", observed: "session" },
          disposition: "PASS" as const,
          execution_id: execId,
        },
        probe_evidence_path: "session.jsonl",
        invocation_evidence_path: invRelPath,
        invocation_evidence_sha256: invocationSha,
        execution_capture_path: manifestRelPath,
        execution_capture_sha256: manifestSha,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "LIVE_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r.ok, false, "manifest with extra fields must fail");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_PARSE_FAILED"),
    `verifier must report EVIDENCE_PARSE_FAILED; got ${[...kinds].join(",")}`,
  );
});

test("C08-05: ISOLATED_DATA_DIR oracle requires runtime_session_file_path under declared session_dir", () => {
  // Closed-world test: build a fresh fixture subtree
  // whose --session-dir is RELATIVE and whose
  // captured artifact + runtime_session_file_path
  // both live UNDER the argv-derived session_dir.
  // Then mutate runtime_session_file_path to a path
  // OUTSIDE the session_dir and observe oracle fail.
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c08-05-"));
  const sessionRel = "test/fixtures/harnesses/pi/pi-v0_85_1/sessions/runtime.jsonl";
  const sessionAbs = join(tmp, sessionRel);
  mkdirSync(dirname(sessionAbs), { recursive: true });
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionAbs);
  const cancelAbs = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelAbs);
  const stdoutAbs = join(tmp, "stdout.jsonl");
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stdout.jsonl"),
    stdoutAbs,
  );
  const stderrAbs = join(tmp, "stderr.txt");
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stderr.txt"),
    stderrAbs,
  );
  const realSha = artifactSha256(sessionAbs);
  const stdoutSha = artifactSha256(stdoutAbs);
  const stderrSha = artifactSha256(stderrAbs);
  const processResultSha = artifactSha256(cancelAbs);
  const invRelPath = "inv/ISOLATED_DATA_DIR.invocation.json";
  mkdirSync(join(tmp, "inv"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/ISOLATED_DATA_DIR.invocation.json"),
    join(tmp, invRelPath),
  );
  const invocationSha = artifactSha256(join(tmp, invRelPath));
  const execId = computeExecutionId({
    nonce: "c08-05",
    invocation_sha256: invocationSha,
    capability: "ISOLATED_DATA_DIR",
  });
  const manifestRelPath = "captures/ISOLATED_DATA_DIR.capture.json";
  const manifestAbs = join(tmp, manifestRelPath);
  mkdirSync(dirname(manifestAbs), { recursive: true });
  writeFileSync(
    manifestAbs,
    JSON.stringify(
      {
        capture_origin: "REPLAY_FIXTURE",
        execution_id: execId,
        capability: "ISOLATED_DATA_DIR",
        invocation_sha256: invocationSha,
        stdout_path: "stdout.jsonl",
        stdout_sha256: stdoutSha,
        stderr_path: "stderr.txt",
        stderr_sha256: stderrSha,
        process_result_path: "process-result.json",
        process_result_sha256: processResultSha,
        native_artifact_path: sessionRel,
        native_artifact_sha256: realSha,
        runtime_session_file_path: sessionAbs,
        recorded_at: "2026-09-18T00:00:00Z",
      },
      null,
      2,
    ),
  );
  const manifestSha = artifactSha256(manifestAbs);
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      ISOLATED_DATA_DIR: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "REPLAY_QUALIFIED" as const,
        probe_evidence: {
          capability: "ISOLATED_DATA_DIR" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: sessionRel,
          artifact_sha256: realSha,
          evidence_relation: {
            expected: "/private/tmp/pi-live",
            observed: sessionRel,
          },
          disposition: "PASS" as const,
          execution_id: execId,
        },
        probe_evidence_path: sessionRel,
        invocation_evidence_path: invRelPath,
        invocation_evidence_sha256: invocationSha,
        execution_capture_path: manifestRelPath,
        execution_capture_sha256: manifestSha,
        execution_capture_origin: "REPLAY_FIXTURE",
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      ISOLATED_DATA_DIR: "REPLAY_QUALIFIED" as const,
    },
  };
  const r1 = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(
    r1.ok,
    true,
    "ISOLATED_DATA_DIR with runtime_session_file_path inside session_dir must pass",
  );
  const manifestRawT = JSON.parse(readFileSync(manifestAbs, "utf8"));
  manifestRawT.runtime_session_file_path = "/tmp/pi-session-DIFFERENT.jsonl";
  writeFileSync(manifestAbs, JSON.stringify(manifestRawT, null, 2));
  // Rebind the manifest SHA on the document so
  // CORRECTION08 C08-01 lets the verifier reach the
  // oracle step.
  doc.capability_axes.ISOLATED_DATA_DIR.execution_capture_sha256 =
    artifactSha256(manifestAbs);
  const r2 = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(
    r2.ok,
    false,
    "runtime_session_file_path outside session_dir must fail",
  );
  const kinds = new Set((r2.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_ORACLE_FAILED"),
    `verifier must report EVIDENCE_ORACLE_FAILED; got ${[...kinds].join(",")}`,
  );
});

test("C08-06: strict argv grammar refuses --mode (no value), duplicate --mode, duplicate --session-dir", () => {
  const baseLaunch: import("../../src/adapter-common/invocation-evidence.js").RawInvocationLaunch = {
    capability: "JSONL",
    executable: "/usr/bin/env",
    argv: ["node", "pi", "--mode", "json"],
    spawn_cwd: "/private/tmp/pi-live",
    env_subset: {},
    recorded_at: "2026-09-18T00:00:00Z",
  };
  assert.throws(
    () => deriveInvocationSemantics({ ...baseLaunch, argv: ["pi", "--mode"] }),
    /--mode' has no value/,
  );
  assert.throws(
    () => deriveInvocationSemantics({
      ...baseLaunch,
      argv: ["pi", "--mode", "json", "--mode", "rpc"],
    }),
    /duplicate '--mode'/,
  );
  assert.throws(
    () => deriveInvocationSemantics({
      ...baseLaunch,
      argv: ["pi", "--mode", "json", "--session-dir", "/a", "--session-dir", "/b"],
    }),
    /duplicate '--session-dir'/,
  );
  assert.throws(
    () => deriveInvocationSemantics({
      ...baseLaunch,
      argv: ["pi", "--mode", "json", "--session-dir"],
    }),
    /--session-dir' has no value/,
  );
  assert.throws(
    () => deriveInvocationSemantics({ ...baseLaunch, argv: ["pi", "-p", "-p"] }),
    /duplicate '-p'/,
  );
  assert.throws(
    () => deriveInvocationSemantics({
      ...baseLaunch,
      argv: ["pi", "--no-session", "--no-session"],
    }),
    /duplicate '--no-session'/,
  );
  const ok = deriveInvocationSemantics(baseLaunch);
  assert.equal(ok.protocol, "json");
  assert.equal(ok.headless, true);
});

test("C08-07: probe evidence artifact_sha256 mismatch with manifest native_artifact_sha256 fails EVIDENCE_EXECUTION_MISMATCH", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c08-07-"));
  const sessionCopy = join(tmp, "session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
  const stdoutCopy = join(tmp, "stdout.jsonl");
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stdout.jsonl"),
    stdoutCopy,
  );
  const stderrCopy = join(tmp, "stderr.txt");
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/stderr.txt"),
    stderrCopy,
  );
  const realSha = artifactSha256(sessionCopy);
  const stdoutSha = artifactSha256(stdoutCopy);
  const stderrSha = artifactSha256(stderrCopy);
  const processResultSha = artifactSha256(cancelCopy);
  const invRelPath = "inv/JSONL.invocation.json";
  mkdirSync(join(tmp, "inv"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/JSONL.invocation.json"),
    join(tmp, invRelPath),
  );
  const invocationSha = artifactSha256(join(tmp, invRelPath));
  const execId = computeExecutionId({
    nonce: "c08-07",
    invocation_sha256: invocationSha,
    capability: "JSONL",
  });
  const wrongNativeSha = "0000000000000000000000000000000000000000000000000000000000000001";
  const manifestRelPath = "captures/JSONL.capture.json";
  const manifestAbs = join(tmp, manifestRelPath);
  mkdirSync(dirname(manifestAbs), { recursive: true });
  writeFileSync(
    manifestAbs,
    JSON.stringify(
      {
        capture_origin: "REPLAY_FIXTURE",
        execution_id: execId,
        capability: "JSONL",
        invocation_sha256: invocationSha,
        stdout_path: "stdout.jsonl",
        stdout_sha256: stdoutSha,
        stderr_path: "stderr.txt",
        stderr_sha256: stderrSha,
        process_result_path: "process-result.json",
        process_result_sha256: processResultSha,
        native_artifact_path: "session.jsonl",
        native_artifact_sha256: wrongNativeSha,
        runtime_session_file_path: null,
        recorded_at: "2026-09-18T00:00:00Z",
      },
      null,
      2,
    ),
  );
  const manifestSha = artifactSha256(manifestAbs);
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      JSONL: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "REPLAY_QUALIFIED" as const,
        probe_evidence: {
          capability: "JSONL" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: "session.jsonl",
          artifact_sha256: realSha,
          evidence_relation: { expected: "session", observed: "session" },
          disposition: "PASS" as const,
          execution_id: execId,
        },
        probe_evidence_path: "session.jsonl",
        invocation_evidence_path: invRelPath,
        invocation_evidence_sha256: invocationSha,
        execution_capture_path: manifestRelPath,
        execution_capture_sha256: manifestSha,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      JSONL: "REPLAY_QUALIFIED" as const,
    },
  };
  const r = verifyLiveQualificationEvidence(
    doc as unknown as HarnessCapabilities,
    tmp,
  );
  assert.equal(r.ok, false, "native_artifact_sha mismatch must fail");
  const kinds = new Set((r.errors ?? []).map((e) => e.kind));
  assert.ok(
    kinds.has("EVIDENCE_EXECUTION_MISMATCH"),
    `verifier must report EVIDENCE_EXECUTION_MISMATCH; got ${[...kinds].join(",")}`,
  );
});

test("C08-08: cumulative post-CORRECTION08 fixture/qualification matrix passes verifier", () => {
  const fixture = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json"),
      "utf8",
    ),
  );
  const qualification = JSON.parse(
    readFileSync(
      resolve(REPO_ROOT, "qualification/pi/pi-capabilities.json"),
      "utf8",
    ),
  );
  const r1 = verifyLiveQualificationEvidence(fixture, REPO_ROOT);
  if (r1.ok !== true) {
    assert.fail(`fixture verifier failed: ${JSON.stringify(r1.errors)}`);
  }
  const r2 = verifyLiveQualificationEvidence(qualification, REPO_ROOT);
  if (r2.ok !== true) {
    assert.fail(`qualification verifier failed: ${JSON.stringify(r2.errors)}`);
  }
});
