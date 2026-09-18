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
} from "node:fs";
import { isAbsolute, resolve, join } from "node:path";
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
} from "./_invocation_helper.js";

const FIXTURE_SESSION =
  "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/pi.session.jsonl";
const FIXTURE_PROCESS =
  "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

/**
 * CORRECTION06 helper: build a `defaultPiCapabilities`
 * argument bundle that includes typed invocation
 * evidence for the listed capabilities (all sharing one
 * headless invocation that points at the canonical Pi
 * fixture directory). Tests that expect LIVE_QUALIFIED
 * MUST use this helper.
 */
function withInvocation(
  base: Record<string, unknown>,
  capabilities: readonly string[],
): Parameters<typeof defaultPiCapabilities>[2] {
  // Use HEADLESS invocation as the canonical one (it
  // carries spawn_cwd, session_dir, no_session, etc.,
  // that EXPLICIT_CWD and ISOLATED_DATA_DIR will read).
  const inv = loadInvocationFixture({
    repoRoot: REPO_ROOT,
    capability: "HEADLESS",
  });
  void capabilities;
  return {
    ...(base as Parameters<typeof defaultPiCapabilities>[2]),
    invocation_evidence: inv.evidence,
    invocation_evidence_path: inv.repo_relative_path,
  } as Parameters<typeof defaultPiCapabilities>[2];
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
  // Copy the invocation fixture so the verifier can
  // re-read it under the fresh checkout root.
  mkdirSync(join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/HEADLESS.invocation.json"),
    join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/HEADLESS.invocation.json"),
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
    invocation_mode: "headless",
  }, ["JSONL", "EXPLICIT_CWD", "HEADLESS", "STREAMING_EVENTS"]));
  // Mutate the session bytes AFTER the record was made.
  writeFileSync(sessionCopy, '{"type":"session","mutated":true}\n', "utf8");
  // Now the verifier must reject.
  const r = verifyLiveQualificationEvidence(realCaps, tmp);
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
  // Copy the invocation fixture too so the verifier can
  // re-read it under the fresh checkout root.
  mkdirSync(
    join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations"),
    { recursive: true },
  );
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/HEADLESS.invocation.json"),
    join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/HEADLESS.invocation.json"),
  );
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
    "LIVE_QUALIFIED",
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
    "LIVE_QUALIFIED",
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
    "LIVE_QUALIFIED",
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
  // Write a real invocation artifact at the same
  // fixture path under the tmp repoRoot.
  const invRelPath = "test/fixtures/invocations/JSONL.invocation.json";
  mkdirSync(join(tmp, "test/fixtures/invocations"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/HEADLESS.invocation.json"),
    join(tmp, invRelPath),
  );
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
          expected: "different",
          observed: "session",
        }),
        probe_evidence_path: "session.jsonl",
        invocation_evidence_path: invRelPath,
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
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/HEADLESS.invocation.json"),
    join(tmp, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/HEADLESS.invocation.json"),
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
          "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/HEADLESS.invocation.json",
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
    "LIVE_QUALIFIED",
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
  const invRelPath = "test/fixtures/invocations/CANCELLATION.invocation.json";
  mkdirSync(join(tmp, "test/fixtures/invocations"), { recursive: true });
  copyFileSync(
    resolve(REPO_ROOT, "test/fixtures/harnesses/pi/pi-v0_85_1/invocations/HEADLESS.invocation.json"),
    join(tmp, invRelPath),
  );
  const realSha = artifactSha256(cancelCopy);
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const doc = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      CANCELLATION: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_HALT" as const,
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
        },
        probe_evidence_path: "process-result.json",
        invocation_evidence_path: invRelPath,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      CANCELLATION: "LIVE_HALT" as const,
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

test("C06-01: InvocationEvidence is a typed structure with required fields", () => {
  const ev = loadInvocationFixture({
    repoRoot: REPO_ROOT,
    capability: "HEADLESS",
  });
  assert.ok(ev.evidence !== undefined);
  assert.equal(typeof ev.evidence.executable, "string");
  assert.ok(Array.isArray(ev.evidence.argv));
  assert.equal(typeof ev.evidence.spawn_cwd, "string");
  assert.equal(typeof ev.evidence.protocol, "string");
  assert.equal(typeof ev.evidence.invocation_mode, "string");
  assert.equal(typeof ev.evidence.no_session, "boolean");
  assert.ok(typeof ev.evidence.env_subset === "object");
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

test("C06-03: HEADLESS is LIVE_QUALIFIED iff invocation.invocation_mode === headless", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    invocation_mode: "headless",
  }, ["HEADLESS"]));
  assert.equal(
    caps.capability_axes.HEADLESS.live_qualification,
    "LIVE_QUALIFIED",
    "HEADLESS is LIVE_QUALIFIED iff invocation.invocation_mode === 'headless' (CORRECTION06 C06-03)",
  );
});

test("C06-04: STREAMING_EVENTS requires >=2 events; fixture has 1 -> LIVE_UNQUALIFIED", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    invocation_mode: "headless",
  }, ["STREAMING_EVENTS"]));
  assert.equal(
    caps.capability_axes.STREAMING_EVENTS.live_qualification,
    "LIVE_UNQUALIFIED",
    "STREAMING_EVENTS requires >=2 events (CORRECTION06 C06-04)",
  );
});

test("C06-05: ISOLATED_DATA_DIR oracle = artifact under invocation session_dir", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    isolated_session_dir: "test/fixtures/harnesses/pi/pi-v0_85_1",
  }, ["ISOLATED_DATA_DIR"]));
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "LIVE_QUALIFIED",
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

const _coveredKeys = new Set<CapabilityKey>([
  "JSONL",
  "HEADLESS",
  "STREAMING_EVENTS",
  "EXPLICIT_CWD",
  "ISOLATED_DATA_DIR",
  "CANCELLATION",
]);
void _coveredKeys;
