/**
 * LH-03 CORRECTION03 — axiom tests.
 *
 * Each test pins a single invariant from C03-01..C03-05.
 * These are property/oracle tests, not snapshot tests;
 * they enforce the axioms so future drift is caught.
 *
 *   C03-01: typed semantic probe evidence replaces the
 *           bare `probe_evidence_path` pointer. LIVE_QUALIFIED
 *           requires probe_evidence with disposition === "PASS"
 *           and evidence_relation.expected === observed.
 *
 *   C03-02: capability-specific oracles:
 *           EXPLICIT_CWD: requested_cwd === observed cwd
 *           ISOLATED_DATA_DIR: requested_cwd === observed cwd
 *           HEADLESS/JSONL/STREAMING_EVENTS: session.type ===
 *           "session"
 *
 *   C03-03: FINAL_JSON harness_capability is UNSUPPORTED;
 *           JSONL is the canonical Factory name for the
 *           upstream JSON Event Stream Mode.
 *
 *   C03-04: Proxy doctrine is precise — getters/[[Get]]
 *           forbidden; bounded structural traps
 *           (getPrototypeOf/ownKeys/getOwnPropertyDescriptor)
 *           MAY execute.
 *
 *   C03-05: negative oracles:
 *           C03-05a nonexistent evidence path cannot qualify
 *           C03-05b wrong artifact cannot qualify
 *           C03-05c artifact hash drift cannot qualify
 *           C03-05d right artifact / wrong cwd cannot qualify
 *           C03-05e Proxy getPrototypeOf trap MAY fire; getter
 *                   MUST NOT.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

import {
  emptyCapabilities,
  validateLiveQualification,
  type CapabilityKey,
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
  deriveInvocationSemantics,
} from "../../src/adapter-common/invocation-evidence.js";
import {
  verifyLiveQualificationEvidence,
} from "../../src/adapter-common/evidence-verifier.js";
import { redactJsonRecord, RedactionError } from "../../src/redaction/secret-redaction.js";

const FIXTURE_SESSION =
  "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/pi.session.jsonl";
const FIXTURE_PROCESS =
  "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

import {
  loadInvocationFixture,
  loadCaptureFixture,
} from "./_invocation_helper.js";

/**
 * CORRECTION07 helper: inject invocation evidence into
 * a defaultPiCapabilities argument bundle.
 *
 * The canonical fixture loaded here is the JSONL one
 * (--mode json): its derived `protocol = json` and
 * `headless = true` cover JSONL + EXPLICIT_CWD without
 * bumping STREAMING_EVENTS / HEADLESS to LIVE_QUALIFIED
 * (STREAMING_EVENTS additionally requires >=2 events
 * which the single-event session header does not
 * satisfy; HEADLESS would actually qualify here, so
 * individual tests must pass an argument bundle without
 * a `-p` headless trigger when they expect HEADLESS to
 * be LIVE_UNQUALIFIED).
 */
function withInvocation(
  base: Record<string, unknown>,
): Parameters<typeof defaultPiCapabilities>[2] {
  const inv = loadInvocationFixture({
    repoRoot: REPO_ROOT,
    capability: "JSONL",
  });
  const cap = loadCaptureFixture({
    repoRoot: REPO_ROOT,
    capability: "JSONL",
  });
  const cancelCap = loadCaptureFixture({
    repoRoot: REPO_ROOT,
    capability: "CANCELLATION",
  });
  const cancelInv = loadInvocationFixture({
    repoRoot: REPO_ROOT,
    capability: "CANCELLATION",
  });
  return {
    ...(base as Parameters<typeof defaultPiCapabilities>[2]),
    invocation_evidence: inv.evidence,
    invocation_evidence_path: inv.repo_relative_path,
    // CORRECTION08 C08-01: bind execution_capture_path
    // + SHA on every LIVE_QUALIFIED axis so the
    // verifier can prove invocation + observation came
    // from the same OS process run.
    execution_capture_path: cap.repo_relative_path,
    execution_capture_sha256: cap.manifest_sha256,
    execution_id: cap.manifest.execution_id,
    axis_execution_captures: {
      CANCELLATION: {
        path: cancelCap.repo_relative_path,
        sha256: cancelCap.manifest_sha256,
      },
    },
    axis_invocation_evidence: {
      CANCELLATION: {
        evidence: cancelInv.evidence,
        path: cancelInv.repo_relative_path,
        sha256: cancelInv.evidence.artifact_sha256,
      },
    },
    axis_execution_ids: {
      CANCELLATION: cancelCap.manifest.execution_id,
    },
  } as Parameters<typeof defaultPiCapabilities>[2];
}

/* ------------------------------------------------------------------ *
 * C03-01 — typed semantic probe evidence.                            *
 * ------------------------------------------------------------------ */

test("C03-01a: defaultPiCapabilities binds typed probe_evidence (not just a path) to LIVE_QUALIFIED axes", () => {
  // CORRECTION04 / CORRECTION07: HEADLESS becomes
  // LIVE_QUALIFIED iff the derived `headless` flag is
  // true (the canonical JSONL fixture uses `--mode
  // json`, which derives `headless=true`). STREAMING_EVENTS
  // additionally requires >=2 events which the
  // single-event session header does not satisfy.
  // ISOLATED_DATA_DIR additionally requires
  // `--session-dir` (the canonical JSONL fixture does
  // not have one).
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  }));
  for (const k of ["JSONL", "EXPLICIT_CWD", "HEADLESS"] as const) {
    const ev = caps.capability_axes[k].probe_evidence;
    assert.ok(ev !== null, `${k} must have probe_evidence`);
    assert.equal(ev.capability, k, "probe_evidence.capability must equal axis key");
    assert.equal(ev.disposition, "PASS", `${k} probe_evidence.disposition must be PASS`);
    assert.equal(
      ev.evidence_relation.expected,
      ev.evidence_relation.observed,
      `${k} expected === observed`,
    );
  }
  // STREAMING_EVENTS / ISOLATED_DATA_DIR are
  // SUPPORTED + LIVE_UNQUALIFIED in this campaign.
  for (const k of ["STREAMING_EVENTS", "ISOLATED_DATA_DIR"] as const) {
    const axis = caps.capability_axes[k];
    assert.equal(axis.live_qualification, "LIVE_UNQUALIFIED", `${k} must be LIVE_UNQUALIFIED`);
    assert.equal(axis.probe_evidence, null, `${k} must have probe_evidence=null`);
  }
});

test("C03-01b: validateLiveQualification rejects LIVE_QUALIFIED with disposition FAIL (failed oracle)", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const forged = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      HEADLESS: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "HEADLESS" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: FIXTURE_SESSION,
          artifact_sha256: artifactSha256(FIXTURE_SESSION),
          expected: "session",
          observed: "WRONG_VALUE",
        }),
        probe_evidence_path: FIXTURE_SESSION,
        invocation_evidence_path: null,
        invocation_evidence_sha256: null,
        execution_capture_path: null,
        execution_capture_sha256: null,
        execution_capture_origin: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      HEADLESS: "LIVE_QUALIFIED" as const,
    },
  };
  const v = validateLiveQualification(forged);
  assert.equal(v.ok, false);
  if (v.ok) return;
  const fail = v.violations.find((x) => x.kind === "live_qualified_with_failed_oracle");
  assert.ok(fail, "expected live_qualified_with_failed_oracle violation");
  if (fail.kind === "live_qualified_with_failed_oracle") {
    assert.equal(fail.disposition, "FAIL");
    assert.equal(fail.expected, "session");
    assert.equal(fail.observed, "WRONG_VALUE");
  }
});

test("C03-01c: validateLiveQualification rejects LIVE_QUALIFIED with probe_kind NOT_RUN", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const forged = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      HEADLESS: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: {
          capability: "HEADLESS" as CapabilityKey,
          probe_kind: "NOT_RUN" as const,
          artifact_path: "",
          artifact_sha256:
            "0000000000000000000000000000000000000000000000000000000000000000",
          evidence_relation: { expected: "", observed: "" },
          disposition: "FAIL" as const,
          execution_id: "",
        },
        probe_evidence_path: null,
        invocation_evidence_path: null,
        invocation_evidence_sha256: null,
        execution_capture_path: null,
        execution_capture_sha256: null,
        execution_capture_origin: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      HEADLESS: "LIVE_QUALIFIED" as const,
    },
  };
  const v = validateLiveQualification(forged);
  assert.equal(v.ok, false);
  if (v.ok) return;
  const notRun = v.violations.find((x) => x.kind === "live_qualified_with_not_run_probe");
  assert.ok(notRun, "expected live_qualified_with_not_run_probe violation");
});

test("C03-01d: validateLiveQualification rejects probe_evidence.capability mismatch with axis key", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const forged = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      HEADLESS: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "JSONL" as const, // mismatched with axis key HEADLESS
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: FIXTURE_SESSION,
          artifact_sha256: artifactSha256(FIXTURE_SESSION),
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: FIXTURE_SESSION,
        invocation_evidence_path: null,
        invocation_evidence_sha256: null,
        execution_capture_path: null,
        execution_capture_sha256: null,
        execution_capture_origin: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      HEADLESS: "LIVE_QUALIFIED" as const,
    },
  };
  const v = validateLiveQualification(forged);
  assert.equal(v.ok, false);
  if (v.ok) return;
  const mismatch = v.violations.find((x) => x.kind === "probe_evidence_capability_mismatch");
  assert.ok(mismatch, "expected probe_evidence_capability_mismatch violation");
});

test("C03-01e: validateLiveQualification rejects probe_evidence_path vs probe_evidence.artifact_path disagreement", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const forged = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      HEADLESS: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: buildProbeEvidence({
          capability: "HEADLESS" as const,
          probe_kind: "SESSION_ENVELOPE" as const,
          artifact_path: FIXTURE_SESSION,
          artifact_sha256: artifactSha256(FIXTURE_SESSION),
          expected: "session",
          observed: "session",
        }),
        probe_evidence_path: "/some/other/path.jsonl",
        invocation_evidence_path: null,
        invocation_evidence_sha256: null,
        execution_capture_path: null,
        execution_capture_sha256: null,
        execution_capture_origin: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      HEADLESS: "LIVE_QUALIFIED" as const,
    },
  };
  const v = validateLiveQualification(forged);
  assert.equal(v.ok, false);
  if (v.ok) return;
  const disagree = v.violations.find((x) => x.kind === "probe_evidence_path_disagreement");
  assert.ok(disagree, "expected probe_evidence_path_disagreement violation");
});

/* ------------------------------------------------------------------ *
 * C03-02 — capability-specific oracles.                              *
 * ------------------------------------------------------------------ */

test("C03-02a: EXPLICIT_CWD oracle PASSes iff requested_cwd === observed session cwd", () => {
  // First: matching cwd -> LIVE_QUALIFIED with PASS oracle.
  // CORRECTION06 C06-02: the expected cwd is the
  // invocation artifact's spawn_cwd, not the caller-
  // supplied requested_cwd. We use an invocation that
  // matches the fixture session cwd.
  const pass = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  }));
  // CORRECTION09 C09-01: the pi-adapter is a fixture-
  // driven replay harness, so its qualifications are
  // REPLAY_QUALIFIED (not LIVE_QUALIFIED). A future
  // spawn-authority code path can promote axes to
  // LIVE_QUALIFIED by emitting a REAL_PROCESS_CAPTURE
  // manifest from a live capture authority.
  assert.equal(pass.capability_axes.EXPLICIT_CWD.live_qualification, "REPLAY_QUALIFIED");
  assert.equal(
    pass.capability_axes.EXPLICIT_CWD.probe_evidence?.disposition,
    "PASS",
  );
  // Second: mismatched cwd is REJECTED at builder time —
  // the builder refuses to fabricate a LIVE_QUALIFIED with
  // a failed oracle, so defaultPiCapabilities throws.
  // CORRECTION06: the cwd mismatch is detected at the
  // invocation evidence level. We build an invocation
  // whose spawn_cwd disagrees with the session cwd.
  assert.throws(
    () => {
      const base = withInvocation({
        session_capture: FIXTURE_SESSION,
        cancellation_halt: FIXTURE_PROCESS,
        requested_cwd: "/private/tmp/pi-live",
      });
      const forgedBase = base as Record<string, unknown>;
      const inv = forgedBase.invocation_evidence as { spawn_cwd: string };
      return defaultPiCapabilities(
        QUALIFIED_PI_IDENTITY,
        0,
        {
          ...(forgedBase as Parameters<typeof defaultPiCapabilities>[2]),
          invocation_evidence: {
            ...inv,
            spawn_cwd: "/tmp/different-cwd",
          },
        } as unknown as Parameters<typeof defaultPiCapabilities>[2],
      );
    },
    /LIVE_QUALIFIED with failed oracle|REPLAY_QUALIFIED with failed oracle|invocation_evidence.*EXPLICIT_CWD/,
  );
});

test("C03-02b: ISOLATED_DATA_DIR does NOT qualify on cwd match alone (CORRECTION04 + CORRECTION05 C05-01)", () => {
  // CORRECTION04 C04-04 + CORRECTION05 C05-01: cwd match
  // alone is NOT sufficient evidence of
  // ISOLATED_DATA_DIR. The builder requires an explicit
  // `isolated_session_dir` argument AND the captured
  // session artifact_path must live under that
  // directory. Without it, the axis is demoted to
  // LIVE_UNQUALIFIED even when requested_cwd happens
  // to match the observed cwd.
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  }));
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "LIVE_UNQUALIFIED",
    "ISOLATED_DATA_DIR must be LIVE_UNQUALIFIED without isolated_session_dir",
  );
  assert.equal(
    caps.capability_axes.ISOLATED_DATA_DIR.probe_evidence,
    null,
    "ISOLATED_DATA_DIR must have probe_evidence=null without isolated_session_dir",
  );
  // CORRECTION05 C05-01 + CORRECTION07 C07-03: forging
  // an argv `--session-dir` that does NOT contain the
  // artifact path still produces LIVE_UNQUALIFIED. The
  // session_dir must mechanically contain the artifact.
  const baseForCwdOnly = withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  }) as Record<string, unknown>;
  const inv0 = baseForCwdOnly.invocation_evidence as {
    argv: readonly string[];
  };
  const cwdOnly = defaultPiCapabilities(
    QUALIFIED_PI_IDENTITY,
    0,
    {
      ...(baseForCwdOnly as Parameters<typeof defaultPiCapabilities>[2]),
      invocation_evidence: {
        ...(baseForCwdOnly.invocation_evidence as Record<string, unknown>),
        argv: [...inv0.argv, "--session-dir", "/private/tmp/pi-live"],
      },
    } as unknown as Parameters<typeof defaultPiCapabilities>[2],
  );
  assert.equal(
    cwdOnly.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "LIVE_UNQUALIFIED",
    "ISOLATED_DATA_DIR must be LIVE_UNQUALIFIED when derived.session_dir does not contain artifact path (CORRECTION07 C07-03)",
  );
  // The artifact_path lives under the parent of the
  // fixture directory; with that as `--session-dir` argv
  // entry the axis qualifies.
  const baseForIso = withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
  }) as Record<string, unknown>;
  const inv1 = baseForIso.invocation_evidence as {
    argv: readonly string[];
    capability: string;
    executable: string;
    spawn_cwd: string;
    env_subset: Readonly<Record<string, string>>;
    recorded_at: string;
  };
  // CORRECTION07: forge a proper derived view by
  // re-running `deriveInvocationSemantics` on the
  // forged argv.
  const forgedIso: Record<string, unknown> = {
    ...(baseForIso.invocation_evidence as Record<string, unknown>),
    argv: [...inv1.argv, "--session-dir", "test/fixtures/harnesses/pi/pi-v0_85_1"],
  };
  const forgedIsoDerived = deriveInvocationSemantics({
    capability: inv1.capability,
    executable: inv1.executable,
    argv: forgedIso.argv as string[],
    spawn_cwd: inv1.spawn_cwd,
    env_subset: inv1.env_subset,
    recorded_at: inv1.recorded_at,
  });
  forgedIso["derived"] = forgedIsoDerived;
  const isoCaps = defaultPiCapabilities(
    QUALIFIED_PI_IDENTITY,
    0,
    {
      ...(baseForIso as Parameters<typeof defaultPiCapabilities>[2]),
      invocation_evidence: forgedIso,
    } as unknown as Parameters<typeof defaultPiCapabilities>[2],
  );
  assert.equal(
    isoCaps.capability_axes.ISOLATED_DATA_DIR.live_qualification,
    "REPLAY_QUALIFIED",
  );
  assert.equal(
    isoCaps.capability_axes.ISOLATED_DATA_DIR.probe_evidence?.disposition,
    "PASS",
  );
});

test("C03-02c: HEADLESS requires invocation_mode=headless (CORRECTION04)", () => {
  // CORRECTION04 C04-05: a single session header is
  // not sufficient evidence of headless mode. The
  // builder now requires invocation_mode === "headless"
  // to qualify HEADLESS.
  const withoutInvocation = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
  });
  assert.equal(
    withoutInvocation.capability_axes.HEADLESS.live_qualification,
    "LIVE_UNQUALIFIED",
  );
  assert.equal(
    withoutInvocation.capability_axes.HEADLESS.probe_evidence,
    null,
  );
  // With invocation_mode === "headless", HEADLESS
  // qualifies from the session envelope.
  //
  // CORRECTION06 C06-03: the invocation_mode argument
  // is no longer authoritative; the invocation artifact
  // is. The fixture invocation's invocation_mode ===
  // "headless", so HEADLESS qualifies.
  const qualifiedHeadless = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    invocation_mode: "headless",
  }));
  const ev = qualifiedHeadless.capability_axes.HEADLESS.probe_evidence;
  assert.ok(ev !== null);
  assert.equal(ev.evidence_relation.expected, "session");
  assert.equal(ev.evidence_relation.observed, "session");
  assert.equal(ev.disposition, "PASS");
  assert.equal(ev.probe_kind, "SESSION_ENVELOPE");
});

/* ------------------------------------------------------------------ *
 * C03-03 — FINAL_JSON semantics: JSONL is the canonical Factory      *
 *          name; FINAL_JSON is UNSUPPORTED.                          *
 * ------------------------------------------------------------------ */

test("C03-03a: FINAL_JSON harness_capability is UNSUPPORTED (canonical name is JSONL)", () => {
  // CORRECTION06: JSONL requires invocation evidence to
  // be LIVE_QUALIFIED (the recorded expected must agree
  // with the invocation-derived expected).
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
  }));
  assert.equal(caps.capabilities.FINAL_JSON, "UNSUPPORTED");
  assert.equal(caps.capabilities.JSONL, "SUPPORTED");
  assert.equal(caps.capability_axes.FINAL_JSON.live_qualification, "LIVE_UNQUALIFIED");
  // CORRECTION09 C09-01: the pi-adapter's fixture-driven
  // qualification emits REPLAY_QUALIFIED (not
  // LIVE_QUALIFIED) for axes whose manifest declares
  // REPLAY_FIXTURE origin.
  assert.equal(caps.capability_axes.JSONL.live_qualification, "REPLAY_QUALIFIED");
});

/* ------------------------------------------------------------------ *
 * C03-04 — Proxy doctrine: bounded structural traps MAY execute;     *
 *          getters MUST NOT.                                         *
 * ------------------------------------------------------------------ */

test("C03-04a: Proxy getPrototypeOf trap MAY fire during rejection; getter MUST NOT", () => {
  let protoTrapFired = 0;
  let getterFired = 0;
  const handler: ProxyHandler<object> = {
    getPrototypeOf() {
      protoTrapFired += 1;
      // Return a non-plain prototype so the redactor rejects.
      return class {}.prototype;
    },
    get(_target, prop) {
      if (prop === "boom") {
        getterFired += 1;
        return "getter-side-effect";
      }
      return undefined;
    },
  };
  const proxy = new Proxy({}, handler);
  // The redaction path triggers getPrototypeOf via
  // isPlainInertRecord before any value access. The
  // proxy's getPrototypeOf trap fires (allowed by the
  // CORRECTION03 doctrine). The getter MUST NOT fire.
  assert.throws(
    () => redactJsonRecord(proxy),
    (err: unknown) => err instanceof RedactionError,
  );
  assert.ok(protoTrapFired >= 1, `getPrototypeOf trap must have fired; fired=${protoTrapFired}`);
  assert.equal(getterFired, 0, `getter MUST NOT have fired; fired=${getterFired}`);
});

/* ------------------------------------------------------------------ *
 * C03-05 — negative oracles.                                         *
 * ------------------------------------------------------------------ */

test("C03-05a: nonexistent evidence path cannot qualify (LIVE_QUALIFIED demoted to LIVE_UNQUALIFIED)", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: "/path/that/does/not/exist.jsonl",
    cancellation_halt: "/path/that/does/not/exist.json",
  });
  assert.equal(
    caps.capability_axes.HEADLESS.live_qualification,
    "LIVE_UNQUALIFIED",
    "HEADLESS must be LIVE_UNQUALIFIED when artifact is missing",
  );
  assert.equal(
    caps.capability_axes.CANCELLATION.live_qualification,
    "LIVE_UNQUALIFIED",
    "CANCELLATION must be LIVE_UNQUALIFIED when artifact is missing",
  );
});

test("C03-05b: wrong artifact cannot qualify (malformed JSON session)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lh03-c03-05b-"));
  const bad = join(tmp, "bad.jsonl");
  writeFileSync(bad, "{not parseable as JSON\n", "utf8");
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: bad,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  });
  assert.equal(
    caps.capability_axes.HEADLESS.live_qualification,
    "LIVE_UNQUALIFIED",
    "HEADLESS must be LIVE_UNQUALIFIED for malformed JSON",
  );
});

test("C03-05c: artifact hash drift fails closed (CORRECTION04 verifyLiveQualificationEvidence)", () => {
  // CORRECTION04 C04-02: artifact hash drift must be
  // rejected by the verifier, not merely "detected by
  // recomputation". The verifier recomputes the SHA256
  // of the on-disk bytes and refuses a recorded hash
  // that disagrees.
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const realSha = artifactSha256(FIXTURE_SESSION);
  // Build a forged document whose JSONL axis carries a
  // wrong recorded sha256. (We use JSONL because it's
  // the canonical LIVE_QUALIFIED capability under
  // CORRECTION04.)
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
  // The verifier is imported at module top.
  const result = verifyLiveQualificationEvidence(
    forged as unknown as Parameters<typeof verifyLiveQualificationEvidence>[0],
    process.cwd(),
  );
  assert.equal(result.ok, false, "verifier must reject forged sha256");
  const hashError = (result.errors ?? []).find((e) => e.kind === "EVIDENCE_HASH_MISMATCH");
  assert.ok(
    hashError !== undefined,
    "verifier must report EVIDENCE_HASH_MISMATCH",
  );
  assert.equal(hashError!.key, "JSONL");
  // Sanity: a real document with the real sha256 must PASS.
  const validCaps = defaultPiCapabilities(id, 0, withInvocation({
    session_capture: FIXTURE_SESSION,
    cancellation_halt: FIXTURE_PROCESS,
    requested_cwd: "/private/tmp/pi-live",
  }));
  assert.equal(
    validCaps.capability_axes.JSONL.probe_evidence?.artifact_sha256,
    realSha,
    "real sha256 must equal recorded sha256",
  );
  const okResult = verifyLiveQualificationEvidence(
    validCaps,
    process.cwd(),
  );
  assert.equal(okResult.ok, true, "verifier must accept real sha256");
});

test("C03-05d: right artifact / wrong cwd cannot qualify EXPLICIT_CWD (builder throws)", () => {
  // CORRECTION06: the cwd mismatch is detected at the
  // invocation evidence level. We build an invocation
  // whose spawn_cwd disagrees with the session cwd.
  assert.throws(
    () => {
      const base = withInvocation({
        session_capture: FIXTURE_SESSION,
        cancellation_halt: FIXTURE_PROCESS,
        requested_cwd: "/private/tmp/pi-live",
      });
      const forgedBase = base as Record<string, unknown>;
      const inv = forgedBase.invocation_evidence as { spawn_cwd: string };
      return defaultPiCapabilities(
        QUALIFIED_PI_IDENTITY,
        0,
        {
          ...(forgedBase as Parameters<typeof defaultPiCapabilities>[2]),
          invocation_evidence: {
            ...inv,
            spawn_cwd: "/nonexistent/isolation/path",
          },
        } as unknown as Parameters<typeof defaultPiCapabilities>[2],
      );
    },
    /LIVE_QUALIFIED with failed oracle|REPLAY_QUALIFIED with failed oracle|invocation_evidence.*EXPLICIT_CWD/,
  );
});

/* ------------------------------------------------------------------ *
 * C03 — fixture honesty (regenerated).                                *
 * ------------------------------------------------------------------ */

test("C03-fixture: qualification/pi/pi-capabilities.json validates under the new semantic predicate", () => {
  const text = readFileSync(
    resolve(process.cwd(), "qualification/pi/pi-capabilities.json"),
    "utf8",
  );
  const parsed = JSON.parse(text) as Parameters<typeof validateLiveQualification>[0];
  const v = validateLiveQualification(parsed);
  assert.deepEqual(
    v,
    { ok: true },
    `matrix failed validation: ${JSON.stringify(v, null, 2)}`,
  );
});

test("C03-fixture: test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json validates", () => {
  const text = readFileSync(
    resolve(process.cwd(), "test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json"),
    "utf8",
  );
  const parsed = JSON.parse(text) as Parameters<typeof validateLiveQualification>[0];
  const v = validateLiveQualification(parsed);
  assert.deepEqual(
    v,
    { ok: true },
    `matrix failed validation: ${JSON.stringify(v, null, 2)}`,
  );
});
