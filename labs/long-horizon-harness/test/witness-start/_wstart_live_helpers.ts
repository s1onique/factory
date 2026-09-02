/**
 * FOUNDATION04 — PHASE A — Live-test scaffolding for the
 * witness-start gate.
 *
 * Boots a frozen LedgerWriter in a fresh tmpDir; exposes
 * helpers to read the durable ledger and to construct a
 * valid WitnessStartSpec with the right entry paths.
 *
 * Used by witness-start-live.test.ts. Phase A is unable to
 * pass the strict live lane on hosts where the UDS socket
 * path exceeds 100 bytes (the runtime limit on macOS
 * sandbox: /var/folders/.../T/.../s exceeds 100). On those
 * hosts the live lane SKIPs honestly.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  startLedgerWriter,
  ledgerWriterSocketPath,
  type StartLedgerWriterOptions,
} from "../../src/ledger-writer/ledger-writer-process.js";
import {
  type WriterHandle,
} from "../ledger-writer/_writer_helper.js";
import { terminateHelperAndAwaitTyped } from "../ledger-writer/_live_cases.js";
import { whoAreYouLedgerWriter } from "../../src/ledger-writer/ledger-writer-client-identity.js";
import { registerWriterSpawn } from "../ledger-writer/_live_registry.js";
import type { WitnessStartSpec } from "../../src/witness-start/witness-start-types.js";
import type { MissionId, RunId } from "../../src/domain/ids.js";

/**
 * CORRECTION07 (context-binding law):
 *
 *   A live run is a single tuple
 *     {runDir, controlDir, runId, missionId, writer, ...}
 *   not a collection of independently supplied strings.
 *
 *   Previously, `startLiveWriter()` constructed its own
 *   ("test-run", "test-mission") internally, while
 *   `mkLiveSpec()` constructed a witness operation with
 *   ("run-live", "mis-live"). Both then hit the same
 *   writer, which computed the canonical content hash
 *   from ITS own binding — and rejected the request as
 *   `content_hash_mismatch`.
 *
 *   The fix is plumbing: thread a single `runId` and
 *   `missionId` from the setup into both the writer
 *   spawn and the witness spec. The LiveRunHandle is
 *   now the source of truth.
 */
export type LiveRunHandle = {
  readonly runDir: string;
  readonly controlDir: string;
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly writer: WriterHandle;
  readonly socketPath: string;
  readonly writerSocketPath: string;
};

/**
 * Default run/mission identity used by the live lane.
 *
 * Why these values:
 *  - They are grammar-valid (IDENTIFIER_GRAMMAR:
 *    [A-Za-z0-9_.:-]{1,128}).
 *  - They are short enough to keep printed test output
 *    readable.
 *  - They are different from the test-only "test-run" /
 *    "test-mission" the helpers used before CORRECTION07,
 *    so a regression that re-introduces that discrepancy
 *    will fail loud at the writer side.
 */
export const DEFAULT_LIVE_RUN_ID = "run-live" as RunId;
export const DEFAULT_LIVE_MISSION_ID = "mis-live" as MissionId;

export function tmpBase(): string {
  return os.tmpdir();
}

export async function mkTmp(prefix: string): Promise<string> {
  // Short prefix to keep UDS path under 100 bytes even on
  // hosts with deep tmpdirs.
  return fs.mkdtemp(path.join(tmpBase(), "." + prefix + "-"));
}

/**
 * CORRECTION07 (context-binding law):
 *   The writer and the witness spec MUST share a single
 *   {runId, missionId}. We accept those from the caller
 *   (setupLiveRun is the canonical source of truth)
 *   rather than constructing them independently.
 */
export type StartLiveWriterOptions = {
  readonly runDir: string;
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly readyTimeoutMs?: number;
};

export async function startLiveWriter(
  args: StartLiveWriterOptions,
): Promise<WriterHandle> {
  const opts: StartLedgerWriterOptions = {
    runDir: args.runDir,
    runId: args.runId,
    missionId: args.missionId,
    entryScript: path.join(
      process.cwd(),
      "src",
      "ledger-writer",
      "ledger-writer-entry.ts",
    ),
    tsxLoader: "tsx",
  };
  const r = await startLedgerWriter(opts, args.readyTimeoutMs ?? 5000);
  if (!r.ok) {
    throw new Error("startLedgerWriter failed: " + JSON.stringify(r.error));
  }
  // CORRECTION07 (prove the returned binding matches):
  //
  //   The writer advertises the SAME runId and missionId
  //   it was spawned with via its who-are-you handshake.
  //   Pin that here so a regression that flips a sign in
  //   startLedgerWriter can never silently mint a writer
  //   bound to a different run/mission than its caller.
  if (r.binding.runId !== args.runId) {
    throw new Error(
      "CORRECTION07 invariant violated: writer binding.runId=" +
        JSON.stringify(r.binding.runId) +
        " but caller supplied " +
        JSON.stringify(args.runId),
    );
  }
  if (r.binding.missionId !== args.missionId) {
    throw new Error(
      "CORRECTION07 invariant violated: writer binding.missionId=" +
        JSON.stringify(r.binding.missionId) +
        " but caller supplied " +
        JSON.stringify(args.missionId),
    );
  }
  const handle: WriterHandle = {
    runDir: args.runDir,
    socketPath: r.socketPath,
    child: r.child,
    instanceId: r.binding.instanceId,
    async stop(): Promise<
      import("../ledger-writer/_live_cases.js").TerminateOutcome
    > {
      // (FOUNDATION04 PHASE A — WRITER-HELPER-TEARDOWN-
      //  OUTCOME01) Delegate to the typed outcome
      // primitive. This eliminates the duplicate raw
      // polling-loop pattern that this witness-side
      // helper historically carried; now both the
      // canonical writer_helper and this witness-side
      // adapter share the SAME kill + close-boundary
      // observation. See _live_cases.ts and WSTOP01..08.
      const outcome = await terminateHelperAndAwaitTyped(r.child, 2000);
      try {
        await fs.rm(ledgerWriterSocketPath(args.runDir), { force: true });
      } catch { /* */ }
      try {
        await fs.rm(path.join(args.runDir, "ledger-writer-owner"), {
          recursive: true,
          force: true,
        });
      } catch { /* */ }
      return outcome;
    },
    ping: async () => {
      // CORRECTION07: delegate to the production client.
      // The live lane relies on the writer's own ping to
      // confirm the UDS is responsive after spawn.
      const { pingLedgerWriter } = await import(
        "../../src/ledger-writer/ledger-writer-client.js"
      );
      return pingLedgerWriter({
        socketPath: r.socketPath,
        timeoutMs: 5000,
      });
    },
    whoAreYou: async () => {
      // CORRECTION07: delegate to the production client.
      // The live setup pin in witness-start-live.test.ts
      // uses this to verify the writer's binding carries
      // the runId / missionId we supplied.
      return whoAreYouLedgerWriter({
        socketPath: r.socketPath,
        timeoutMs: 5000,
      });
    },
    append: async (appendArgs) => {
      // CORRECTION07: delegate to the production client.
      // The live lane does not currently exercise this
      // (gates use the witness-ledger adapter); keep
      // the delegate so the handle surface stays
      // production-honest.
      //
      // appendToLedgerWriter(opts, args) requires
      // clientContentHash to match the writer's canonical
      // hash of (runId, missionId, event). The caller
      // computes this upstream via canonicalContentHash
      // — we do not attempt to compute it here.
      const { appendToLedgerWriter } = await import(
        "../../src/ledger-writer/ledger-writer-client.js"
      );
      const { canonicalContentHash } = await import(
        "../../src/ledger-writer/ledger-writer-canonicalize.js"
      );
      const clientContentHash =
        appendArgs.clientContentHash ??
        canonicalContentHash({
          runId: args.runId,
          missionId: args.missionId,
          event: appendArgs.event,
        });
      return appendToLedgerWriter(
        { socketPath: r.socketPath, timeoutMs: 5000 },
        {
          commitId: appendArgs.commitId,
          clientContentHash,
          event: appendArgs.event,
        },
      );
    },
  };
  registerWriterSpawn({
    child: r.child,
    runDir: args.runDir,
    socketPath: r.socketPath,
  });
  return handle;
}

/**
 * Tear down a LiveRunHandle: stop the writer and remove
 * the run/control directories. Safe to call from a
 * `finally` block; tolerates missing pieces (each rm is
 * best-effort).
 */
export async function teardownLiveRun(run: LiveRunHandle): Promise<void> {
  try { await run.writer.stop(); } catch { /* */ }
  try { await fs.rm(run.runDir, { recursive: true, force: true }); } catch { /* */ }
  try { await fs.rm(run.controlDir, { recursive: true, force: true }); } catch { /* */ }
}

/**
 * Structural subset of `LiveRunHandle` that carries
 * exactly the fields `mkLiveSpec` needs to construct a
 * `WitnessStartSpec`. The reason this exists rather
 * than taking `LiveRunHandle` directly:
 *
 *   CORRECTION08 (reviewer feedback): path-arithmetic
 *   unit tests should not have to fabricate a fake
 *   `writer` field (the previous `null as unknown as
 *   WriterHandle` cast). A test that does not have a
 *   real writer does not need a `writer` slot at all.
 *
 *   Live tests pass the full `LiveRunHandle` (which
 *   happens to satisfy `WitnessStartLiveBinding`).
 *
 *   Both real and synthetic test contexts satisfy
 *   this narrower contract without forging a capability
 *   they do not hold.
 */
export type WitnessStartLiveBinding = Pick<
  LiveRunHandle,
  | "runDir"
  | "controlDir"
  | "runId"
  | "missionId"
  | "socketPath"
  | "writerSocketPath"
>;

/**
 * Build a valid WitnessStartSpec that points at the actual
 * witness helper script in this repo.
 *
 * CORRECTION07: this takes a `WitnessStartLiveBinding` so
 * the spec inherits its runId and missionId from the SAME
 * source that produced the writer. The previous version
 * re-supplied `"run-live"` / `"mis-live"` while the writer
 * was bound to `"test-run"` / `"test-mission"` — the
 * cross-binding was the cause of the LIVE01/LIVE03
 * `content_hash_mismatch` failures on the short-path host.
 *
 * Why accept `WitnessStartLiveBinding` rather than the
 * same shape again: passing the binding makes it
 * structurally impossible to construct a spec that
 * disagrees with the writer's binding, because both
 * sides reference the same fields of the same object.
 *
 * Unit tests that exercise path arithmetic without a
 * real writer construct a `WitnessStartLiveBinding`
 * directly via `mkPartialBinding()`.
 */
export function mkLiveSpec(
  run: WitnessStartLiveBinding,
  override?: { readonly ledgerWriterSocketPath?: string },
): WitnessStartSpec {
  return {
    runDir: run.runDir,
    controlDir: run.controlDir,
    suggestedWitnessId: "w-start-live" as never,
    socketPath: run.socketPath,
    runId: run.runId,
    missionId: run.missionId,
    attemptId: "att-live" as never,
    processId: "proc-live" as never,
    protocolVersion: 1,
    bootstrapLeaseMs: 1000,
    // CORRECTION07: the writer-socket path normally comes
    // from the same binding whose runId/missionId we
    // just adopted. LIVE02 needs to point at a guaranteed-
    // missing socket; that override is the ONLY reason for
    // the optional second argument. Tests that DO NOT need
    // to override MUST call mkLiveSpec(run) — there is no
    // structurally safer signature.
    ledgerWriterSocketPath:
      override?.ledgerWriterSocketPath ?? run.writerSocketPath,
    witnessesEntry: path.join(
      process.cwd(),
      "test",
      "witness",
      "_witness_helper.ts",
    ),
    tsxLoader: "tsx",
    nodePath: process.execPath,
  };
}

/**
 * Build a structural `WitnessStartLiveBinding` for unit
 * tests that exercise spec construction without a real
 * writer. The previous version forged a `WriterHandle`
 * stub via `null as unknown as WriterHandle`; this is
 * a strict Pick of the actual fields and therefore
 * cannot pretend to hold a writer capability it does
 * not have.
 */
export function mkPartialBinding(args: {
  readonly runDir: string;
  readonly controlDir?: string;
  readonly socketPath: string;
  readonly writerSocketPath: string;
  readonly runId?: RunId;
  readonly missionId?: MissionId;
}): WitnessStartLiveBinding {
  return {
    runDir: args.runDir,
    controlDir: args.controlDir ?? path.join(args.runDir, "control"),
    runId: args.runId ?? DEFAULT_LIVE_RUN_ID,
    missionId: args.missionId ?? DEFAULT_LIVE_MISSION_ID,
    socketPath: args.socketPath,
    writerSocketPath: args.writerSocketPath,
  };
}

/**
 * Read every line of the durable events.jsonl as parsed JSON.
 * Used by the live lane to assert intent + child presence.
 */
export async function readLedger(
  runDir: string,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const p = path.join(runDir, "events.jsonl");
  let text: string;
  try {
    text = await fs.readFile(p, "utf8");
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    out.push(JSON.parse(line) as Record<string, unknown>);
  }
  return out;
}

/**
 * Return true if a UDS path would exceed the 100-byte budget
 * on this host. Used by live tests to SKIP honestly on hosts
 * that cannot satisfy the production constraint.
 */
export function udsPathTooLong(p: string): boolean {
  return p.length > 100;
}

/**
 * Find a witness_start_requested entry in the ledger.
 */
export function findStartIntent(
  ledger: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> | null {
  for (const env of ledger) {
    if (
      env["kind"] === "witness_evidence" &&
      env["witness_evidence"] !== undefined &&
      (env["witness_evidence"] as Record<string, unknown>)["kind"]
        === "witness_start_requested"
    ) {
      return env;
    }
  }
  return null;
}

/**
 * Count witness_start_requested records in the ledger.
 * WSTART-LIVE01 (Phase A) requires this to be exactly 1.
 */
export function countStartIntents(
  ledger: ReadonlyArray<Record<string, unknown>>,
): number {
  let n = 0;
  for (const env of ledger) {
    if (
      env["kind"] === "witness_evidence" &&
      env["witness_evidence"] !== undefined &&
      (env["witness_evidence"] as Record<string, unknown>)["kind"]
        === "witness_start_requested"
    ) {
      n += 1;
    }
  }
  return n;
}

/**
 * Find a witness_ready entry whose witness_instance_id
 * matches the given instance. WSTART-LIVE01 (Phase A)
 * uses this to verify the witness that became ready is
 * the same identity that was durably authorized.
 */
export function findReadyForInstance(
  ledger: ReadonlyArray<Record<string, unknown>>,
  witnessInstanceId: string,
): Record<string, unknown> | null {
  for (const env of ledger) {
    if (
      env["kind"] === "witness_evidence" &&
      env["witness_evidence"] !== undefined &&
      (env["witness_evidence"] as Record<string, unknown>)["kind"]
        === "witness_ready" &&
      (env["witness_evidence"] as Record<string, unknown>)[
        "witness_instance_id"
      ] === witnessInstanceId
    ) {
      return env;
    }
  }
  return null;
}

/**
 * Check whether a child process is alive by signal 0.
 */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
