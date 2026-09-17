/**
 * LH-03 §3 / H1 — V1 contract preservation.
 *
 * The existing D08 V1 surface (`HarnessAdapter` with
 * `kind`, `start`, `events`, `interrupt`, `status`) MUST
 * remain stable. The scripted fake adapter MUST continue
 * to type-check and pass tests. EXTEND_EXISTING_PORT=YES,
 * REWRITE_EXISTING_PORT=NO.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ScriptedFakeAdapter,
  defaultHappyPathScript,
} from "../../src/adapters/fake/scripted-fake-adapter.js";
import { PiAdapter, defaultPiCapabilities, piQualificationIdentity } from "../../src/adapters/pi/pi-adapter.js";
import { ClineAdapter, clineQualificationIdentity, defaultClineCapabilities } from "../../src/adapters/cline/cline-adapter.js";
import { makeHarnessHandle } from "../../src/domain/ids.js";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

test("V1-PRES-01: scripted fake adapter preserves V1 surface (D08)", async () => {
  const a = new ScriptedFakeAdapter({ script: defaultHappyPathScript("attempt-x") });
  assert.equal(a.kind, "fake");
  const h = makeHarnessHandle("v1-fake");
  const sr = await a.start({ handle: h, args: {} });
  assert.equal(sr.ok, true);
  const events = await collect(a.events(h));
  assert.equal(events.length, 5);
  const status = await a.status(h);
  assert.equal(status.phase, "completed");
});

test("V1-PRES-02: Pi adapter exposes V1 methods", async () => {
  const id = piQualificationIdentity({
    package_name: "@earendil-works/pi-coding-agent",
    package_version: "0.85.1",
    executable_path: "/tmp/pi.js",
    executable_sha256: "a".repeat(64),
    reported_cli_version: "0.85.1",
  });
  const a = new PiAdapter({
    qualification: id,
    capabilities: defaultPiCapabilities(id, 0),
    captured_at_ms: 0,
  });
  assert.equal(a.kind, "pi");
  const h = makeHarnessHandle("v1-pi");
  await a.start({ handle: h, args: {} });
  const r = await a.interrupt(h);
  // Pi V1: start() in V1 mode does not pre-register a run;
  // interrupt returns false (caller should inject or use
  // V2 prepareRun). The V1 surface contract is preserved.
  assert.equal(typeof r.ok, "boolean");
  const status = await a.status(h);
  assert.ok(["starting", "running", "completed", "errored"].includes(status.phase));
});

test("V1-PRES-03: Cline adapter exposes V1 methods", async () => {
  const id = clineQualificationIdentity({
    package_name: null,
    package_version: null,
    executable_path: null,
    executable_sha256: null,
    reported_cli_version: null,
  });
  const a = new ClineAdapter({
    qualification: id,
    capabilities: defaultClineCapabilities(id, 0),
    captured_at_ms: 0,
  });
  assert.equal(a.kind, "cline");
  const h = makeHarnessHandle("v1-cline");
  await a.start({ handle: h, args: {} });
  // Cline V1 stubs the run on start; interrupt succeeds.
  const r = await a.interrupt(h);
  assert.equal(r.ok, true);
});
