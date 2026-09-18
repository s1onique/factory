/**
 * LH-03 CORRECTION02 — axiom tests.
 *
 * Each test pins a single invariant from C02-01..C02-04.
 * These are property/oracle tests, not snapshot tests;
 * they enforce the axioms so future drift is caught.
 *
 *   C02-01: LIVE_QUALIFIED implies probe_evidence_path != null
 *           LIVE_HALT     implies probe_evidence_path != null
 *           validateLiveQualification() rejects overclaims
 *           defaultPiCapabilities() refuses to build an
 *           overclaim (throws)
 *
 *   C02-02: lh03-emit.json is non-empty (real emit evidence)
 *
 *   C02-03: events() is observationally pure; consuming it
 *           N times produces the same adapter_errors and the
 *           same event stream.
 *
 *   C02-04: redactJsonRecord rejects records with exotic
 *           prototypes and accessor own-keys BEFORE recursing
 *           into them (getter never fires).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  emptyCapabilities,
  validateLiveQualification,
} from "../../src/protocol/index.js";
import {
  PiAdapter,
  defaultPiCapabilities,
  QUALIFIED_PI_IDENTITY,
} from "../../src/adapters/pi/pi-adapter.js";
import { redactJsonRecord, RedactionError } from "../../src/redaction/secret-redaction.js";

/* ------------------------------------------------------------------ *
 * C02-01 — LIVE_QUALIFIED requires evidence.                          *
 * ------------------------------------------------------------------ */

test("C02-01a: validateLiveQualification rejects LIVE_QUALIFIED with null evidence", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const forged = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      HEADLESS: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_QUALIFIED" as const,
        probe_evidence: null,
        probe_evidence_path: null,
        invocation_evidence_path: null,
        invocation_evidence_sha256: null,
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
  const headless = v.violations.find((x) => x.kind === "live_qualified_without_evidence");
  assert.ok(headless, "expected live_qualified_without_evidence violation");
});

test("C02-01b: validateLiveQualification rejects LIVE_HALT with null evidence", () => {
  const id = QUALIFIED_PI_IDENTITY;
  const caps = emptyCapabilities(id, 1700000000000);
  const forged = {
    ...caps,
    capability_axes: {
      ...caps.capability_axes,
      CANCELLATION: {
        harness_capability: "SUPPORTED" as const,
        live_qualification: "LIVE_HALT" as const,
        probe_evidence: null,
        probe_evidence_path: null,
        invocation_evidence_path: null,
        invocation_evidence_sha256: null,
      },
    },
    live_qualification_by_key: {
      ...caps.live_qualification_by_key,
      CANCELLATION: "LIVE_HALT" as const,
    },
  };
  const v = validateLiveQualification(forged);
  assert.equal(v.ok, false);
  if (v.ok) return;
  const halt = v.violations.find((x) => x.kind === "live_halt_without_evidence");
  assert.ok(halt, "expected live_halt_without_evidence violation");
});

test("C02-01c: defaultPiCapabilities refuses to construct LIVE_QUALIFIED with null probe_evidence", () => {
  // Empty evidence -> HEADLESS cannot be LIVE_QUALIFIED
  // (the observed-session reader returns null and the
  // builder demotes to LIVE_UNQUALIFIED, never fabricates
  // a PASS).
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0);
  assert.equal(
    caps.capability_axes.HEADLESS.live_qualification,
    "LIVE_UNQUALIFIED",
    "HEADLESS must be LIVE_UNQUALIFIED with no evidence on disk",
  );
  assert.equal(
    caps.capability_axes.HEADLESS.probe_evidence,
    null,
    "HEADLESS probe_evidence must be null with no evidence on disk",
  );
});

test("C02-01d: defaultPiCapabilities refuses to construct LIVE_HALT with null probe_evidence", () => {
  // session_capture without cancellation_halt -> CANCELLATION
  // cannot be LIVE_HALT (the observed-cancellation reader
  // returns null and the builder demotes to
  // LIVE_UNQUALIFIED, never fabricates a HALT).
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: "any/path.jsonl",
    cancellation_halt: null,
  });
  assert.equal(
    caps.capability_axes.CANCELLATION.live_qualification,
    "LIVE_UNQUALIFIED",
    "CANCELLATION must be LIVE_UNQUALIFIED without cancellation-halt evidence on disk",
  );
  assert.equal(
    caps.capability_axes.CANCELLATION.probe_evidence,
    null,
    "CANCELLATION probe_evidence must be null without cancellation-halt evidence on disk",
  );
});

test("C02-01e: defaultPiCapabilities produces an honest document (RPC/TOKEN_USAGE/FINAL_JSON are LIVE_UNQUALIFIED)", () => {
  const caps = defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 0, {
    session_capture: "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/pi.session.jsonl",
    cancellation_halt: "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json",
  });
  for (const k of ["RPC", "TOKEN_USAGE", "FINAL_JSON"] as const) {
    assert.equal(
      caps.capability_axes[k].live_qualification,
      "LIVE_UNQUALIFIED",
      `expected ${k} to be LIVE_UNQUALIFIED (no probe evidence)`,
    );
    assert.equal(
      caps.capability_axes[k].probe_evidence_path,
      null,
      `expected ${k} probe_evidence_path to be null`,
    );
  }
  const v = validateLiveQualification(caps);
  assert.deepEqual(v, { ok: true });
});

/* ------------------------------------------------------------------ *
 * C02-02 — lh03-emit.json is a real consolidated emit.                *
 * ------------------------------------------------------------------ */

test("C02-02a: qualification/lh03-emit.json exists and is non-empty", () => {
  const path = resolve(process.cwd(), "qualification/lh03-emit.json");
  const text = readFileSync(path, "utf8");
  assert.ok(text.length > 0, "lh03-emit.json must not be empty");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assert.equal(parsed.lh03_emit_kind, "DETERMINISTIC_CONSOLIDATED_EMIT");
  assert.equal(parsed.lh03_correction, "CORRECTION07");
  assert.ok(parsed.input_evidence, "must reference real input evidence");
  assert.ok(parsed.evidence_paths, "must list real evidence paths");
  const ep = parsed.evidence_paths as Record<string, unknown>;
  assert.ok(ep.session_capture, "session_capture evidence path must be set");
  assert.ok(ep.cancellation_halt, "cancellation_halt evidence path must be set");
});

/* ------------------------------------------------------------------ *
 * C02-03 — events() is observationally pure.                          *
 * ------------------------------------------------------------------ */

test("C02-03a: a single UNKNOWN event produces exactly one adapter_error even after multiple events() consumes", async () => {
  const a = new PiAdapter({
    qualification: QUALIFIED_PI_IDENTITY,
    capabilities: defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 1700000000000, {
      session_capture: "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/pi.session.jsonl",
      cancellation_halt: "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json",
    }),
    captured_at_ms: 1700000000000,
  });
  const handle = a.injectCapturedRun({
    handle: "h-pure01",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [
      '{"type":"session","version":3,"id":"x","timestamp":"t","cwd":"/tmp"}',
      '{"type":"totally_unknown_kind","data":"x"}',
    ],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events: [],
  });
  const first: unknown[] = [];
  for await (const ev of a.events(handle)) first.push(ev);
  const r1 = await a.awaitExit(handle);
  const firstErrCount = r1.adapter_errors.length;
  const second: unknown[] = [];
  for await (const ev of a.events(handle)) second.push(ev);
  const r2 = await a.awaitExit(handle);
  const secondErrCount = r2.adapter_errors.length;
  assert.equal(
    firstErrCount,
    secondErrCount,
    "events() must not add adapter_errors when re-consumed",
  );
  assert.equal(
    secondErrCount,
    1,
    `expected exactly 1 adapter_error for the single UNKNOWN event, got ${secondErrCount}`,
  );
  assert.equal(first.length, second.length, "event stream length must be identical");
});

test("C02-03b: events() does not multiply adapter_errors across multiple consumes", async () => {
  const a = new PiAdapter({
    qualification: QUALIFIED_PI_IDENTITY,
    capabilities: defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 1700000000000, {
      session_capture: "test/fixtures/harnesses/pi/pi-v0_85_1/raw-artifacts/pi.session.jsonl",
      cancellation_halt: "test/fixtures/harnesses/pi/pi-v0_85_1/process-result.json",
    }),
    captured_at_ms: 1700000000000,
  });
  const handle = a.injectCapturedRun({
    handle: "h-pure02",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [
      '{"type":"bogus","v":1}',
      '{"type":"bogus","v":2}',
      '{"type":"session","version":3,"id":"x","timestamp":"t","cwd":"/tmp"}',
    ],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events: [],
  });
  for (let i = 0; i < 3; i++) {
    for await (const _ of a.events(handle)) void _;
  }
  const r = await a.awaitExit(handle);
  assert.equal(
    r.adapter_errors.length,
    2,
    `expected exactly 2 adapter_errors for 2 bogus lines, got ${r.adapter_errors.length}`,
  );
});

/* ------------------------------------------------------------------ *
 * C02-04 — Hostile-object rejection BEFORE recursion.                 *
 * ------------------------------------------------------------------ */

test("C02-04a: redactJsonRecord throws RedactionError on a getter own-key without invoking it", () => {
  const fired: string[] = [];
  const obj = Object.create(Object.prototype);
  Object.defineProperty(obj, "boom", {
    enumerable: true,
    get() {
      fired.push("boom-getter");
      return "side-effect-value";
    },
  });
  Object.defineProperty(obj, "quiet", {
    value: "harmless",
    enumerable: true,
    writable: true,
    configurable: true,
  });
  assert.throws(
    () => redactJsonRecord(obj),
    (err: unknown) => err instanceof RedactionError,
  );
  assert.equal(
    fired.length,
    0,
    `getter must NOT have fired during redaction; fired=${JSON.stringify(fired)}`,
  );
});

test("C02-04b: redactJsonRecord throws RedactionError on a record with an unexpected prototype", () => {
  class HiddenProto {
    public x = "x";
  }
  const obj = new HiddenProto() as unknown as Record<string, unknown>;
  assert.throws(
    () => redactJsonRecord(obj),
    (err: unknown) =>
      err instanceof RedactionError &&
      /non-plain-inert|prototype/i.test((err as Error).message),
  );
});

test("C02-04c: redactJsonRecord accepts a normal JSON record and still redacts deeply nested fields", () => {
  const rec = {
    api_key: "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop",
    nested: {
      token: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
      plain: "ok",
    },
  };
  const r = redactJsonRecord(rec) as {
    api_key: string;
    nested: { token: string; plain: string };
  };
  assert.equal(r.api_key, "__FACTORY_REDACTED__");
  assert.equal(r.nested.token, "__FACTORY_REDACTED__");
  assert.equal(r.nested.plain, "ok");
});

/* ------------------------------------------------------------------ *
 * C02-01 (matrix invariant) — qualification and fixture matrices are  *
 *                            honest.                                  *
 * ------------------------------------------------------------------ */

test("C02-01f: qualification/pi/pi-capabilities.json is an honest matrix", () => {
  const text = readFileSync(
    resolve(process.cwd(), "qualification/pi/pi-capabilities.json"),
    "utf8",
  );
  const parsed = JSON.parse(text) as Parameters<typeof validateLiveQualification>[0];
  const v = validateLiveQualification(parsed);
  assert.deepEqual(v, { ok: true }, `matrix failed validation: ${JSON.stringify(v, null, 2)}`);
});

test("C02-01g: test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json is an honest matrix", () => {
  const text = readFileSync(
    resolve(process.cwd(), "test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json"),
    "utf8",
  );
  const parsed = JSON.parse(text) as Parameters<typeof validateLiveQualification>[0];
  const v = validateLiveQualification(parsed);
  assert.deepEqual(v, { ok: true }, `matrix failed validation: ${JSON.stringify(v, null, 2)}`);
});
