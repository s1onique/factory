/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Adversarial corpus cases RUN16–RUN20, RUN23, RUN24 — the
 * envelope decoder + JSON trust boundary. The projector/store
 * cases (RUN01–RUN15, RUN21, RUN22, RUN25) live in
 * run-evidence-contract-projector.test.ts.
 *
 * Contract matrix references:
 *
 *   RUN16  caller-supplied accessor payload (E-M15)
 *   RUN17  Proxy object payload (E-M15)
 *   RUN18  __proto__ preserved as data, not prototype poisoning (E-M15)
 *   RUN19  cyclic payload (E-M15)
 *   RUN20  malformed arbitrary input → typed failure (E-M15)
 *   RUN23  same event_id + changed content → duplicate-with-changed-content
 *   RUN24  manifest subject_id mismatch → identity_mismatch
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  decodeRunEventEnvelope,
} from "../../src/run/run-decode-envelope.js";
import {
  decodeRunManifest,
} from "../../src/run/run-decode-manifest.js";
import {
  projectRun,
} from "../../src/run/run-projector.js";
import type { RunManifest } from "../../src/run/run-types.js";
import {
  RUN_EVENT_SCHEMA_VERSION,
  RUN_MANIFEST_SCHEMA_VERSION,
  computeRunId,
  makeRunEventId,
} from "../../src/run/run-types.js";

import {
  makeTestManifest,
  minimalSuccessRun,
} from "./run-evidence-contract-helpers.js";
import { makeSubjectId } from "../../src/subject/index.js";
import type { SubjectId } from "../../src/subject/subject-types.js";

function envelopeAsJson(
  m: RunManifest,
  e: ReadonlyArray<{ type: string; [k: string]: unknown }>,
): unknown {
  return {
    schema_version: RUN_EVENT_SCHEMA_VERSION,
    event_id: `evt:encoded:${m.run_id}`,
    run_id: m.run_id,
    subject_id: m.subject_id,
    sequence: 1,
    observed_at: 0,
    event: e[0],
  };
}

function decodeEnv(input: unknown, m: RunManifest): ReturnType<typeof decodeRunEventEnvelope> {
  return decodeRunEventEnvelope(input, m.run_id, m.subject_id);
}

function allEnvelopesAsJson(
  m: RunManifest,
  types: ReadonlyArray<string>,
): unknown[] {
  return types.map((type, i) => ({
    schema_version: RUN_EVENT_SCHEMA_VERSION,
    event_id: `evt:encoded:${m.run_id}:${i + 1}`,
    run_id: m.run_id,
    subject_id: m.subject_id,
    sequence: i + 1,
    observed_at: i * 1000,
    event: { type },
  }));
}

// RUN16 — accessor payload.
test("RUN16 accessor payload → rejected without invoking getter", () => {
  const { manifest } = minimalSuccessRun();
  let invoked = false;
  const target = {
    type: "RUN_STARTED",
    get evil(): unknown {
      invoked = true;
      return "side-effect";
    },
  };
  const r = decodeEnv(
    envelopeAsJson(manifest, [target as unknown as { type: string }]),
    manifest,
  );
  assert.equal(r.ok, false);
  assert.equal(invoked, false, "accessor MUST NOT have been invoked");
});

// RUN17 — Proxy payload with throwing getPrototypeOf trap.
test("RUN17 Proxy payload → rejected at snapshotter", () => {
  const { manifest } = minimalSuccessRun();
  const proxied = new Proxy(
    {
      schema_version: RUN_EVENT_SCHEMA_VERSION,
      event_id: `evt:proxy:${manifest.run_id}`,
      run_id: manifest.run_id,
      subject_id: manifest.subject_id,
      sequence: 1,
      observed_at: 0,
      event: { type: "RUN_STARTED" },
    },
    {
      // The snapshotter calls Reflect.getPrototypeOf.
      // Make this trap throw to ensure the boundary rejects
      // without propagating the throw.
      getPrototypeOf(): never {
        throw new Error("proxy getPrototypeOf denied");
      },
    },
  );
  const r = decodeEnv(proxied, manifest);
  assert.equal(r.ok, false);
});

// RUN18 — __proto__ preserved as data.
test("RUN18 __proto__ preserved as data, not prototype poisoning", () => {
  const { manifest } = minimalSuccessRun();
  const obj = {
    schema_version: RUN_EVENT_SCHEMA_VERSION,
    event_id: `evt:proto:${manifest.run_id}`,
    run_id: manifest.run_id,
    subject_id: manifest.subject_id,
    sequence: 1,
    observed_at: 0,
    event: {
      type: "RUN_STARTED",
      __proto__: { polluted: true } as unknown as object,
    },
  };
  const r = decodeEnv(obj, manifest);
  assert.equal(
    (Object.prototype as { polluted?: unknown }).polluted,
    undefined,
    "decoder must NOT pollute Object.prototype",
  );
  void r;
});

// RUN19 — cyclic payload.
test("RUN19 cyclic payload → rejected", () => {
  const { manifest } = minimalSuccessRun();
  type Cyclic = { [key: string]: unknown };
  const cycle: Cyclic = {
    schema_version: RUN_EVENT_SCHEMA_VERSION,
    event_id: `evt:cycle:${manifest.run_id}`,
    run_id: manifest.run_id,
    subject_id: manifest.subject_id,
    sequence: 1,
    observed_at: 0,
    event: { type: "RUN_STARTED" },
  };
  (cycle as { self?: unknown }).self = cycle;
  const r = decodeEnv(cycle, manifest);
  assert.equal(r.ok, false);
});

// RUN20 — malformed arbitrary input.
test("RUN20 malformed arbitrary input → typed failure", () => {
  const { manifest } = minimalSuccessRun();
  assert.equal(decodeEnv(undefined, manifest).ok, false);
  assert.equal(decodeEnv(null, manifest).ok, false);
  assert.equal(decodeEnv(42, manifest).ok, false);
  assert.equal(decodeEnv("not-an-object", manifest).ok, false);
  assert.equal(decodeEnv([], manifest).ok, false);
});

// RUN24 — manifest subject_id mismatch.
test("RUN24 manifest subject_id does not match declared run_id → identity_mismatch", () => {
  const wrong: SubjectId = makeSubjectId(
    "subject:00000000000000000000000000000000000000000000000000000000deadbeef",
  );
  const expected: SubjectId = makeSubjectId(
    "subject:0000000000000000000000000000000000000000000000000000000000000001",
  );
  const bogus = {
    schema_version: RUN_MANIFEST_SCHEMA_VERSION,
    run_id: computeRunId({
      subjectId: expected,
      runSchemaVersion: RUN_MANIFEST_SCHEMA_VERSION,
      repetition: { index: 0 },
    }),
    subject_id: wrong,
    run_protocol_version: "phase-e.test.v1",
    runner_revision: "test-runner",
    started_by: "test-runner",
    created_at: 0,
    repetition: { index: 0 },
  };
  const r = decodeRunManifest(bogus, expected);
  assert.equal(r.ok, false);
});

// RUN23 — same event_id + changed content at the projector level.
test("RUN23 same event_id + changed content → illegal_event at projector", () => {
  const { manifest, events } = minimalSuccessRun();
  // Synthetic stream: first event unchanged, second event has the
  // SAME event_id but a DIFFERENT event payload.
  const reuseId = events[0]!.event_id;
  const synthetic: ReadonlyArray<typeof events[number]> = [
    events[0]!,
    {
      ...events[0]!,
      sequence: 2,
      event: { type: "HARNESS_STARTED" },
      event_id: reuseId,
    },
  ];
  const pr = projectRun(manifest, synthetic);
  assert.equal(pr.ok, false);
});

// RUN25b — manifest decoder: well-formed manifest decodes.
test("RUN25b decodeRunManifest → ok for well-formed manifest", () => {
  const manifest = makeTestManifest();
  const r = decodeRunManifest(manifest, manifest.subject_id);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.run_id, manifest.run_id);
    assert.equal(r.value.subject_id, manifest.subject_id);
  }
});

// RUN25c — envelope decoder rejects schema_version mismatch.
test("RUN25c envelope decoder rejects wrong schema_version", () => {
  const { manifest } = minimalSuccessRun();
  const env = {
    schema_version: "phase-x.run.event.v1",
    event_id: makeRunEventId(`evt:badsv:${manifest.run_id}`),
    run_id: manifest.run_id,
    subject_id: manifest.subject_id,
    sequence: 1,
    observed_at: 0,
    event: { type: "RUN_STARTED" },
  };
  const r = decodeEnv(env, manifest);
  assert.equal(r.ok, false);
});

// RUN25d — envelope decoder rejects sequence < FIRST_SEQUENCE.
test("RUN25d envelope decoder rejects sequence < FIRST_SEQUENCE", () => {
  const { manifest } = minimalSuccessRun();
  const env = {
    schema_version: RUN_EVENT_SCHEMA_VERSION,
    event_id: makeRunEventId(`evt:badseq:${manifest.run_id}`),
    run_id: manifest.run_id,
    subject_id: manifest.subject_id,
    sequence: 0,
    observed_at: 0,
    event: { type: "RUN_STARTED" },
  };
  const r = decodeEnv(env, manifest);
  assert.equal(r.ok, false);
});

// RUN25e — envelope decoder rejects unknown top-level keys.
test("RUN25e envelope decoder rejects unknown top-level keys", () => {
  const { manifest } = minimalSuccessRun();
  const env = {
    schema_version: RUN_EVENT_SCHEMA_VERSION,
    event_id: makeRunEventId(`evt:unknown-key:${manifest.run_id}`),
    run_id: manifest.run_id,
    subject_id: manifest.subject_id,
    sequence: 1,
    observed_at: 0,
    event: { type: "RUN_STARTED" },
    extra_field: "should-not-be-accepted",
  };
  const r = decodeEnv(env, manifest);
  assert.equal(r.ok, false);
});

void allEnvelopesAsJson;
