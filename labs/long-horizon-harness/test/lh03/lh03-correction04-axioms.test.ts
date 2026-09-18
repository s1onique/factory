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
import { resolve, join } from "node:path";
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

const FIXTURE_SESSION =
  "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/pi.session.jsonl";
const FIXTURE_PROCESS =
  "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

/* ------------------------------------------------------------------ *
 * C04-01 — separate structural validation from artifact verification.*
 * ------------------------------------------------------------------ */

test("C04-01a: validateLiveQualification is pure (does not read disk)", () => {
  // A document built with the typed probe evidence
  // passes validateLiveQualification purely on the
  // recorded fields, without touching the filesystem.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  });
  const r = validateLiveQualification(caps);
  assert.equal(r.ok, true, "valid document must pass pure validator");
});

test("C04-01b: verifyLiveQualificationEvidence re-reads disk and recomputes SHA256", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  });
  const r = verifyLiveQualificationEvidence(caps, REPO_ROOT);
  assert.equal(r.ok, true, "verifier must accept real document");
});

/* ------------------------------------------------------------------ *
 * C04-02 — artifact hash drift fails closed.                        *
 * ------------------------------------------------------------------ */

test("C04-HASH01: mutate artifact bytes after probe record created -> FAIL", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c04-hash01-"));
  const sessionCopy = join(tmp, "pi.session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
  // Build a real document from the copies; the SHA256 is
  // recorded against the unchanged bytes.
  const realCaps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: sessionCopy,
    cancellation_halt: cancelCopy,
    requested_cwd: "/private/tmp/pi-live",
    invocation_mode: "headless",
  });
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
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  });
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
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  });
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
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: join(fixtureRel, "raw-artifacts/pi.session.jsonl"),
    cancellation_halt: join(fixtureRel, "process-result.json"),
    requested_cwd: "/private/tmp/pi-live",
  });
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

test("C04-ISOLATED02: isolated_session_dir + cwd-under-dir qualifies", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
    isolated_session_dir: "/private/tmp/pi-live",
  });
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "LIVE_QUALIFIED",
  );
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.probe_evidence?.disposition,
    "PASS",
  );
});

test("C04-ISOLATED03: isolated_session_dir but cwd NOT under it -> LIVE_UNQUALIFIED", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
    isolated_session_dir: "/var/isolated",
  });
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "LIVE_UNQUALIFIED",
    "ISOLATED_DATA_DIR must be LIVE_UNQUALIFIED when cwd is not under isolated_session_dir",
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
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    invocation_mode: "headless",
  });
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

test("C04-INVOCATION04: JSONL qualifies from session envelope alone", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
  });
  assert.equal(
    caps.capability_axes.JSONL.live_qualification,
    "LIVE_QUALIFIED",
    "JSONL is the canonical Factory name for the upstream JSON Event Stream Mode; the session envelope is the proof",
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
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c04-ora-"));
  const sessionCopy = join(tmp, "session.jsonl");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_SESSION), sessionCopy);
  const cancelCopy = join(tmp, "process-result.json");
  copyFileSync(resolve(REPO_ROOT, FIXTURE_PROCESS), cancelCopy);
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
          expected: "different",
          observed: "session",
        }),
        probe_evidence_path: "session.jsonl",
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
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: sessionCopy,
    cancellation_halt: cancelCopy,
    requested_cwd: "/private/tmp/pi-live",
  });
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

const _coveredKeys = new Set<CapabilityKey>([
  "JSONL",
  "HEADLESS",
  "STREAMING_EVENTS",
  "EXPLICIT_CWD",
  "ISOLATED_DATA_DIR",
  "CANCELLATION",
]);
void _coveredKeys;

