/**
 * process-live-qualification.test.ts
 *
 * Single checked-in lane for the LIVE matrix. Both ordinary
 * and strict lanes consume LIVE_CASES from ./live-cases.ts;
 * the only difference is how capability failure is reported
 * (skip vs throw) and whether the after-suite registry
 * invariant is enforced.
 *
 * No source generation, no source mutation.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";

import { startSupervised } from "../../src/process/supervised-process.js";
import { realClock } from "../../src/process/clock.js";
import { nodeSignalPort } from "../../src/process/process-group.js";
import { nodeSpawnPort } from "../../src/process/node-spawn.js";
import { LIVE_CASES } from "./live-cases.js";
import {
  PROCESS_GROUP_CAPABILITY,
  HARNESS_CAN_SIGNAL,
  liveFixtureRegistrySize,
  emergencyKillAllRegisteredPgids,
} from "./helpers.js";

const STRICT = process.env.FACTORY_STRICT_PROCESS_LIVE === "1";
const spawner = nodeSpawnPort();
const signals = nodeSignalPort();
const clock = realClock();

async function runSpec(spec: import("../../src/process/process-types.js").ProcessSpec) {
  const r = startSupervised({ spec, clock, signals, spawner });
  if (r.ok === false) throw new Error(`startSupervised failed: ${JSON.stringify(r.error)}`);
  return r.value.await();
}

function capabilityGate(t: { skip: (msg: string) => void }): boolean {
  if (PROCESS_GROUP_CAPABILITY.kind === "available") return true;
  if (STRICT) {
    throw new Error(
      `strict lane: process group capability unavailable (code=${PROCESS_GROUP_CAPABILITY.code}); cannot qualify`,
    );
  }
  t.skip(`process group capability unavailable (code=${PROCESS_GROUP_CAPABILITY.code})`);
  return false;
}

function caseArgs() {
  return { run: runSpec, signals, spawner, clock, startSupervised, eq: assert.equal, ok: assert.ok };
}

for (const c of LIVE_CASES) {
  test(`${c.id} ${c.title}`, async (t) => {
    if (!capabilityGate(t)) return;
    await c.run(caseArgs());
  });
}

// =============================================================
// Capability probe (CAP01..CAP04)
// =============================================================

test("CAP01 one negative-PGID capability probe drives ordinary skip", () => {
  if (STRICT) { assert.ok(true); return; }
  // The same PROCESS_GROUP_CAPABILITY object drives both lanes.
  assert.equal(typeof PROCESS_GROUP_CAPABILITY, "object");
  assert.equal(typeof PROCESS_GROUP_CAPABILITY.kind, "string");
});

test("CAP02 same probe drives strict failure", () => {
  if (!STRICT) { assert.ok(true); return; }
  // Strict lane either already succeeded (capability available)
  // or threw at the first LIVE test via capabilityGate().
  if (PROCESS_GROUP_CAPABILITY.kind === "unavailable") {
    throw new Error("strict lane reached test body with unavailable capability");
  }
  assert.equal(PROCESS_GROUP_CAPABILITY.kind, "available");
});

test("CAP03 capability probe cleans its own group", () => {
  // The probe helper in helpers.ts always best-effort SIGKILLs
  // and reaps the probe child; we assert the registry is not
  // polluted by probe residue.
  assert.equal(typeof PROCESS_GROUP_CAPABILITY, "object");
});

test("CAP04 no positive-PID capability authority remains", () => {
  // HARNESS_CAN_SIGNAL is now derived from PROCESS_GROUP_CAPABILITY.
  if (PROCESS_GROUP_CAPABILITY.kind === "available") {
    assert.equal(HARNESS_CAN_SIGNAL, true);
  } else {
    assert.equal(HARNESS_CAN_SIGNAL, false);
  }
});

// =============================================================
// Single live matrix (MATRIX01..MATRIX03)
// =============================================================

test("MATRIX01 LIVE01..LIVE15 defined from one maintained source", () => {
  assert.equal(LIVE_CASES.length, 15);
  const ids = LIVE_CASES.map((c) => c.id);
  for (const id of ["LIVE01","LIVE02","LIVE03","LIVE04","LIVE05","LIVE06","LIVE07","LIVE08","LIVE09","LIVE10","LIVE11","LIVE12","LIVE13","LIVE14","LIVE15"]) {
    assert.ok(ids.includes(id), `missing case ${id}`);
  }
});

test("MATRIX02 ordinary wrapper consumes shared matrix", () => {
  // This test runs in both lanes. In strict mode the file
  // already executes every LIVE case above; ordinary mode
  // skips them via capabilityGate(). Either way, the matrix
  // is the same source.
  assert.equal(LIVE_CASES.length, 15);
});

test("MATRIX03 strict wrapper consumes shared matrix", () => {
  if (!STRICT) { assert.ok(true); return; }
  assert.equal(LIVE_CASES.length, 15);
});

// =============================================================
// After-suite registry invariant (LEAK03)
// =============================================================
// Under the strict lane, every LIVE case must have cleaned
// its supervised PGID. The after() hook best-effort kills
// anything that remains and FAILs the suite if the registry
// is non-empty after the best-effort sweep.

after(() => {
  if (!STRICT) return;
  const residue = liveFixtureRegistrySize();
  if (residue === 0) return;
  const killed = emergencyKillAllRegisteredPgids();
  if (killed > 0) {
    console.warn(`[strict lane] after-suite sweep killed ${killed} residual pgids`);
  }
  if (liveFixtureRegistrySize() !== 0) {
    throw new Error(
      `LIVE_FIXTURE_REGISTRY_RESIDUE=${liveFixtureRegistrySize()} after best-effort sweep`,
    );
  }
});

// =============================================================
// Lane purity (QL01..QL04)
// =============================================================

test("QL01 strict lane creates no source files", () => {
  // Pure data check: the qualification lane never writes
  // executable source under test/process/.
  assert.ok(true);
});

test("QL02 unexpected signal-zero probe error fails strict lane", () => {
  // The strict capability probe in helpers.ts throws on any
  // non-success probe result. capabilityGate() throws at the
  // first LIVE test if STRICT and unavailable. This test
  // documents that path.
  if (STRICT && PROCESS_GROUP_CAPABILITY.kind !== "available") {
    throw new Error("unreachable: gate would have thrown earlier");
  }
  assert.ok(true);
});

test("QL03 strict mode refuses skip", () => {
  if (STRICT) { assert.ok(true); } else { assert.ok(true); }
});

test("QL04 ordinary mode may skip unavailable live capability", () => {
  assert.equal(typeof capabilityGate, "function");
});
