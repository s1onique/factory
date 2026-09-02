/**
 * FOUNDATION04 — PHASE A — WITNESS-LIFECYCLE-AUTHORITY
 *  CORRECTION01 — Adversarial oracles.
 *
 * These oracles pin the lifecycle-authority law:
 *
 *   Once a spawn adapter returns a typed process
 *   handle, lifecycle qualification MUST consume that
 *   handle's authoritative lifecycle surface. It MUST
 *   NOT cast the handle back into its hidden
 *   implementation type or reconstruct lifecycle
 *   truth from a bare PID when stronger identity-
 *   bound evidence exists.
 *
 *   specific-child terminated proof:
 *     owned handle exit boundary observed
 *       + (kernel says absent OR kernel denies us)
 *         => released (child_terminated_proven)
 *
 *   bare historic PID + ESRCH
 *     => released (pid_absent)
 *
 *   bare historic PID + positive
 *     + Node did NOT see our child's exit
 *       => residue (alive)
 *
 *   bare historic PID + positive
 *     + Node saw our child's exit (PID reuse risk)
 *       => residue (child_terminated)
 *
 *   bare historic PID + EPERM
 *     + Node did NOT see our child's exit
 *       => residue (permission_denied)
 *
 * These oracles are adversarial: they catch
 * regressions that would re-introduce the
 * `entry.ref as unknown as ChildProcess` false cast
 * in the witness-start qualification, or that would
 * drop the identity-bound release path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  proveChildAbsent,
  registerLiveFixture,
  unregisterLiveFixture,
  snapshotLiveFixtures,
  type IdentityBoundChildPort,
  type ProveChildAbsentResult,
} from "../ledger-writer/_live_registry.js";
import type { WitnessSpawnHandle } from "../../src/witness-start/witness-start-handle.js";
// ----------------------------------------------------------------------
// WLIFE01 — `WitnessSpawnHandle` is NEVER cast to
// `ChildProcess` in witness-start qualification.
//
// Static grep pin. The cast
// `entry.ref as unknown as ChildProcess` MUST NOT
// appear anywhere under
// `test/witness-start/witness-start-live.test.ts`.
// ----------------------------------------------------------------------
test("WLIFE01: witness-start-live must NOT cast witness entry ref to ChildProcess", async () => {
  const { promises: fs } = await import("node:fs");
  const url = new URL(
    "./witness-start-live.test.ts",
    import.meta.url,
  );
  const text = await fs.readFile(url, "utf8");
  // Strip line comments and block comments so the
  // cast-grep does not flag comments that NAME the
  // anti-pattern (they're educational, not
  // prescriptive).
  const codeOnly = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+\/\/.*$/gm, "");
  assert.equal(
    /as\s+unknown\s+as\s+(import\([^)]\)\.)?ChildProcess/.test(codeOnly),
    false,
    "WLIFE01: false-cast anti-pattern; witness-start-live must use the narrow typed surface.",
  );
  assert.ok(
    text.includes("IdentityBoundChildPort") ||
      text.includes("WitnessSpawnHandle") ||
      text.includes("whenBootstrapOutputClosed"),
    "WLIFE01: witness-start-live must reference the typed lifecycle surface (IdentityBoundChildPort, WitnessSpawnHandle, or whenBootstrapOutputClosed).",
  );
});

// ----------------------------------------------------------------------
// WLIFE02 — (Node-exit, kernel-EPERM) => child_terminated_proven (released)
// ----------------------------------------------------------------------
test("WLIFE02: (Node-exit-seen, kernel-EPERM) => child_terminated_proven (released)", async () => {
  const marker = "WLIFE02-" + Math.random().toString(36).slice(2);
  const fakeChild: IdentityBoundChildPort = {
    pid: 999_007,
    kill: (): boolean => false,
    exitInfo: (): { exited: boolean } => ({ exited: true }),
  };
  registerLiveFixture({
    kind: "helper_child",
    ref: fakeChild,
    pid: fakeChild.pid,
    note: marker,
  });
  try {
    const r: ProveChildAbsentResult = await proveChildAbsent(fakeChild);
    assert.ok(
      r.kind === "child_terminated_proven" || r.kind === "pid_absent",
      `WLIFE02: expected child_terminated_proven or pid_absent; got ${JSON.stringify(r)}`,
    );
    assert.notEqual(
      r.kind,
      "permission_denied",
      "WLIFE02: (Node-exit, EPERM) MUST NOT be classified as permission_denied",
    );
    assert.notEqual(
      r.kind,
      "alive",
      "WLIFE02: (Node-exit, EPERM) MUST NOT be classified as alive",
    );
  } finally {
    for (const e of snapshotLiveFixtures()) {
      if (e.note === marker) unregisterLiveFixture(e);
    }
  }
});

// ----------------------------------------------------------------------
// WLIFE03 — Signal-sent alone is NOT proof of cleanup.
// Bare positive-PID kernel probe with no Node-side
// exit evidence retains the entry as residue (alive).
// ----------------------------------------------------------------------
test("WLIFE03: signal-sent without exitInfo-evidence is residue (alive), not released", async () => {
  const marker = "WLIFE03-" + Math.random().toString(36).slice(2);
  const fakeChild: IdentityBoundChildPort = {
    pid: process.pid,
    kill: (): boolean => true,
    exitCode: null,
    signalCode: null,
  };
  registerLiveFixture({
    kind: "helper_child",
    ref: fakeChild,
    pid: fakeChild.pid,
    note: marker,
  });
  try {
    const r = await proveChildAbsent(fakeChild);
    assert.equal(
      r.kind,
      "alive",
      `WLIFE03: expected 'alive'; got ${JSON.stringify(r)}`,
    );
  } finally {
    for (const e of snapshotLiveFixtures()) {
      if (e.note === marker) unregisterLiveFixture(e);
    }
  }
});

// ----------------------------------------------------------------------
// WLIFE04 — terminateAndProveWitness must await
// whenBootstrapOutputClosed with a bounded deadline.
// ----------------------------------------------------------------------
test("WLIFE04: terminateAndProveWitness must await whenBootstrapOutputClosed with a bounded deadline", async () => {
  const { promises: fs } = await import("node:fs");
  const url = new URL(
    "./witness-start-live.test.ts",
    import.meta.url,
  );
  const text = await fs.readFile(url, "utf8");
  assert.ok(
    /whenBootstrapOutputClosed/.test(text),
    "WLIFE04: must call whenBootstrapOutputClosed()",
  );
  assert.ok(
    /Promise\.race/.test(text),
    "WLIFE04: must wrap whenBootstrapOutputClosed in a bounded deadline (Promise.race against setTimeout)",
  );
});

// ----------------------------------------------------------------------
// WLIFE05 — Identity-bound exit boundary dominates
// bare-PID observation.
// ----------------------------------------------------------------------
test("WLIFE05: identity-bound exit boundary dominates bare-PID observation", async () => {
  const marker = "WLIFE05-" + Math.random().toString(36).slice(2);
  const fakeHandle: IdentityBoundChildPort = {
    pid: process.pid,
    kill: (): boolean => true,
    exitInfo: (): { exited: boolean } => ({ exited: true }),
  };
  registerLiveFixture({
    kind: "helper_child",
    ref: fakeHandle,
    pid: fakeHandle.pid,
    note: marker,
  });
  try {
    const r = await proveChildAbsent(fakeHandle);
    assert.ok(
      r.kind === "child_terminated" ||
        r.kind === "child_terminated_proven" ||
        r.kind === "pid_absent",
      `WLIFE05: expected child_terminated | child_terminated_proven | pid_absent; got ${JSON.stringify(r)}`,
    );
    assert.notEqual(
      r.kind,
      "alive",
      "WLIFE05: handle exitInfo().exited === true is decisive",
    );
    assert.notEqual(
      r.kind,
      "permission_denied",
      "WLIFE05: positive-PID-with-exit-info is NOT permission_denied",
    );
  } finally {
    for (const e of snapshotLiveFixtures()) {
      if (e.note === marker) unregisterLiveFixture(e);
    }
  }
});

// ----------------------------------------------------------------------
// WLIFE06 — Synthetic PID-reuse: positive-PID-with-
// handle-exited is classified via handle exit, NOT
// collapsed into `alive`.
// ----------------------------------------------------------------------
test("WLIFE06: synthetic PID reuse — handle exit boundary releases entry even if PID is now positive", async () => {
  const marker = "WLIFE06-" + Math.random().toString(36).slice(2);
  const fakeHandle: IdentityBoundChildPort = {
    pid: process.pid,
    kill: (): boolean => false,
    exitInfo: (): { exited: boolean } => ({ exited: true }),
  };
  registerLiveFixture({
    kind: "helper_child",
    ref: fakeHandle,
    pid: fakeHandle.pid,
    note: marker,
  });
  try {
    const r = await proveChildAbsent(fakeHandle);
    assert.ok(
      r.kind === "child_terminated" ||
        r.kind === "child_terminated_proven" ||
        r.kind === "pid_absent",
      `WLIFE06: expected child_terminated | child_terminated_proven | pid_absent; got ${JSON.stringify(r)}`,
    );
    assert.notEqual(
      r.kind,
      "alive",
      "WLIFE06: a positive historical PID with handle exitInfo().exited === true MUST NOT be classified as alive",
    );
  } finally {
    for (const e of snapshotLiveFixtures()) {
      if (e.note === marker) unregisterLiveFixture(e);
    }
  }
});

// ----------------------------------------------------------------------
// WLIFE07 — IdentityBoundChildPort accepts both
// WitnessSpawnHandle-shape and ChildProcess-shape.
// ----------------------------------------------------------------------
test("WLIFE07: IdentityBoundChildPort is structural — accepts both shapes", async () => {
  const witnessHandleShape: IdentityBoundChildPort = {
    pid: 12345,
    kill: (_signal?: NodeJS.Signals): boolean => false,
    exitInfo: (): { exited: boolean } => ({ exited: false }),
    whenBootstrapOutputClosed: () => Promise.resolve({}),
  };
  assert.ok(
    typeof witnessHandleShape.exitInfo === "function",
    "WLIFE07: IdentityBoundChildPort accepts WitnessSpawnHandle-shape",
  );
  const childProcessShape: IdentityBoundChildPort = {
    pid: 67890,
    kill: (_signal?: NodeJS.Signals): boolean => true,
    exitCode: null,
    signalCode: null,
  };
  assert.equal(
    childProcessShape.exitInfo,
    undefined,
    "WLIFE07: IdentityBoundChildPort accepts ChildProcess-shape",
  );
});

// ----------------------------------------------------------------------
// WLIFE08 — registerWitnessSpawn accepts a real
// WitnessSpawnHandle-shaped port.
// ----------------------------------------------------------------------
test("WLIFE08: registerWitnessSpawn accepts a real WitnessSpawnHandle-shaped port", async () => {
  const { registerWitnessSpawn } = await import(
    "../ledger-writer/_live_registry.js"
  );
  const fakeHandle = {
    pid: 42424 as number | null,
    kill: (_signal?: NodeJS.Signals): boolean => false,
    exitInfo: (): { exited: boolean } => ({ exited: false }),
    whenBootstrapOutputClosed: () => Promise.resolve({}),
  } as unknown as WitnessSpawnHandle;
  const entry = registerWitnessSpawn({
    child: fakeHandle,
    witnessInstanceId: "wl08-test",
    runDir: "/tmp/wl08",
  });
  assert.equal(entry.kind, "helper_child");
  assert.equal(
    entry.note,
    "witness instance=wl08-test runDir=/tmp/wl08",
  );
  unregisterLiveFixture(entry);
});
