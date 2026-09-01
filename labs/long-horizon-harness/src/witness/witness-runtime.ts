/**
 * FOUNDATION04 — witness process entry.
 *
 * This is the actual witness Node process. It runs as a separate
 * detached Node process spawned by the supervisor. The witness
 * holds the live ChildProcess handle for the candidate and the
 * canonical PGID authority for that child. It survives the
 * supervisor's death.
 *
 * The runtime is intentionally compact: it uses the pure
 * state-machine in witness-runtime-sm.ts, the UDS transport in
 * witness-server.ts, the canonical codec in witness-codec-*,
 * the crypto adapter in witness-crypto.ts, and the dedicated
 * witness-ledger.ts appender for evidence durability.
 */

import { generateEd25519Keypair } from "./witness-crypto.js";
import { listenOnUnixSocket } from "./witness-server.js";
import { WITNESS_PROTOCOL_VERSION } from "./witness-protocol.js";
import type { WitnessBootstrapConfig } from "./witness-runtime-types.js";
import type { WitnessRuntimeContext } from "./witness-runtime-sm-helpers.js";
import { makeWitnessId, makeWitnessInstanceId } from "./witness-types.js";
import { appendWitnessEvidence } from "./witness-ledger.js";
import { loadControllerIdentity } from "./witness-controller-binding.js";
import {
  handleFrame,
  setLiveCtx,
  eventId,
  shutdown,
} from "./witness-runtime-handlers.js";

/**
 * Flush-safe bootstrap-diagnostic helper.
 *
 * Node's `process.exit()` can terminate before asynchronous
 * stderr writes finish, causing diagnostic output to be
 * truncated or lost. At the bootstrap-failure boundary the
 * witness has no live UDS, no timers, and no pending I/O
 * (we return BEFORE installing the SIGTERM/SIGINT listeners
 * or the server). The safe pattern is:
 *
 *   1. Synchronously write the diagnostic to stderr.
 *   2. Set process.exitCode to the desired exit code.
 *   3. Throw a sentinel to short-circuit the rest of
 *      runWitnessProcess; the entry-point helper catches
 *      the sentinel and lets the event loop drain.
 *
 * The harness's bounded drain on the child stdio pipes
 * (in `witness-start-spawn.ts`) is what guarantees the
 * parent's pipe reader sees the full diagnostic.
 */
class BootstrapFailureSentinel extends Error {
  readonly exitCode: number;
  constructor(exitCode: number) {
    super("bootstrap-failure-sentinel");
    this.exitCode = exitCode;
  }
}

function bootstrapFail(message: string, code: number): never {
  process.stderr.write(message);
  if (!message.endsWith("\n")) process.stderr.write("\n");
  process.exitCode = code;
  throw new BootstrapFailureSentinel(code);
}

export type WitnessProcessArgs = {
  readonly runDir: string;
  readonly witnessId: string;
  readonly witnessInstanceId: string;
  readonly socketPath: string;
  readonly controlDir: string;
  readonly protocolVersion: number;
  readonly bootstrapLeaseMs: number;
  readonly runId: string;
  readonly missionId: string;
  readonly attemptId: string;
  readonly processId: string;
  /**
   * B0-CORR01: the LedgerWriter socket path. The witness
   * routes evidence appends through the writer; it does NOT
   * write events.jsonl directly (B0-C01-11). If this is
   * absent (legacy bootstrap), the witness fails closed.
   */
  readonly ledgerWriterSocketPath?: string;
};

export async function runWitnessProcess(args: WitnessProcessArgs): Promise<void> {
  try {
    if (args.protocolVersion !== WITNESS_PROTOCOL_VERSION) {
      bootstrapFail(
        `witness: unsupported protocol_version ${args.protocolVersion}`,
        2,
      );
    }
    const witnessId = makeWitnessId(args.witnessId);
    const witnessInstanceId = makeWitnessInstanceId(args.witnessInstanceId);
    const runId = args.runId as import("../domain/ids.js").RunId;
    const missionId = args.missionId as import("../domain/ids.js").MissionId;

    // B0-C01-11: refuse to start without a writer binding. The
    // witness MUST NOT write events.jsonl directly; the
    // LedgerWriter owns the run's events.jsonl. If the
    // supervisor forgot to provide a binding, fail closed
    // rather than silently fall back to direct writes.
    if (typeof args.ledgerWriterSocketPath !== "string" || args.ledgerWriterSocketPath.length === 0) {
      bootstrapFail(
        "witness: ledgerWriterSocketPath is required (B0-C01-11)",
        2,
      );
    }
  const binding = {
    runDir: args.runDir,
    socketPath: args.ledgerWriterSocketPath,
  };

  const key = generateEd25519Keypair();

  // PHASE C (controller-binding law):
  //   Load and validate the controller public-key file
  //   exactly once. The resulting fingerprint is durable
  //   for the lifetime of THIS witness instance. Command
  //   handling MUST NOT re-read the file. A later
  //   replacement of the file is irrelevant to the
  //   authority accepted by this witness.
  const ctrlR = await loadControllerIdentity(args.controlDir);
  if (!ctrlR.ok) {
    bootstrapFail(
      `witness: controller_binding_failed: ${JSON.stringify(ctrlR.error)}`,
      1,
    );
  }
  const controllerFingerprint = ctrlR.value.publicKeyFingerprint;
  // The verifier is captured into the binding and threaded
  // into WitnessRuntimeContext. Per-command authentication
  // MUST use this verifier, not a re-read of controller.pub.
  const controllerVerifier = ctrlR.value.verifier;

  // PHASE A (B0-QUALIFICATION06 -> Phase A correction):
  // The witness process no longer writes its own
  // witness_start_requested record. Intent ownership is
  // exclusively the supervisor's: the supervisor's
  // startWitness gate commits the start intent BEFORE
  // spawning the witness, and the witness is now
  // authoritative only for post-creation evidence
  // (witness_ready, witness_command_requested/result,
  // witness_lost, etc.).
  //
  // If a witness process starts without a prior
  // witness_start_requested in the ledger, the projector
  // will reject its witness_ready with `ready_before_start`.
  // This is the load-bearing doctrine of Phase A.

  const bootstrap: WitnessBootstrapConfig = {
    binding: {
      runId,
      missionId,
      attemptId: args.attemptId as import("../domain/ids.js").AttemptId,
      processId: args.processId as import("../process/process-types.js").ProcessId,
      witnessId,
      witnessInstanceId,
    },
    controllerPublicKeyFingerprint: controllerFingerprint,
    socketPath: args.socketPath,
    protocolVersion: args.protocolVersion,
    bootstrapLeaseMs: args.bootstrapLeaseMs,
  };

  let ctx: WitnessRuntimeContext = {
    bootstrap,
    witnessPublicKey: key.publicKeyHex,
    witnessPublicKeyFingerprint: key.publicKeyFingerprint,
    witnessPid: process.pid,
    controllerPublicKeyFingerprint: controllerFingerprint,
    controllerVerifier,
    state: {
      kind: "bootstrapping",
      binding: bootstrap.binding,
      historicalWitnessPid: process.pid,
    },
    commandJournal: [],
    activated: false,
    candidate: null,
    lastExecutionStatus: { kind: "not_started" },
  };
  setLiveCtx(ctx);

  const bindR = await listenOnUnixSocket({
    socketPath: args.socketPath,
    onFrame: (json) =>
      handleFrame(json, key, {
        runDir: args.runDir,
        ledgerWriterSocketPath: args.ledgerWriterSocketPath,
      }),
  });
  if (!bindR.ok) {
    bootstrapFail(
      `witness: bind failed: ${JSON.stringify(bindR.error)}`,
      1,
    );
  }
  const server = bindR.value;

  // F04-D32/D34: durable witness_ready
  const readyAck = await appendWitnessEvidence({
    binding,
    runId,
    missionId,
    eventId: eventId("w-ready"),
    observedAt: Date.now(),
    commitId: `w-ready-${witnessInstanceId}`,
    payload: {
      kind: "witness_ready",
      witness_id: witnessId,
      witness_instance_id: witnessInstanceId,
      historical_witness_pid: process.pid,
      socket_path: args.socketPath,
      witness_public_key: key.publicKeyHex,
      witness_public_key_fingerprint: key.publicKeyFingerprint,
      controller_public_key_fingerprint: controllerFingerprint,
      protocol_version: args.protocolVersion,
    },
  });
  if (!readyAck.ok) {
    bootstrapFail(`witness: ready durability failed`, 1);
  }
  ctx = {
    ...ctx,
    state: {
      kind: "ready_not_activated",
      binding: bootstrap.binding,
      historicalWitnessPid: process.pid,
      witnessPublicKey: key.publicKeyHex,
      witnessPublicKeyFingerprint: key.publicKeyFingerprint,
      controllerPublicKeyFingerprint: controllerFingerprint,
      socketPath: args.socketPath,
      protocolVersion: args.protocolVersion,
    },
  };
  setLiveCtx(ctx);

  // F04-D17 bootstrap lease
  const leaseTimer = setTimeout(() => {
    if (!ctx.activated) {
      void shutdown(server, args.socketPath, 0);
    }
  }, args.bootstrapLeaseMs);
  leaseTimer.unref();
  process.on("SIGTERM", () => void shutdown(server, args.socketPath, 0));
  process.on("SIGINT", () => void shutdown(server, args.socketPath, 0));

  await new Promise<void>((resolve) => server.on("close", () => resolve()));
  } catch (e: unknown) {
    // BootstrapFailureSentinel: expected short-circuit from
    // bootstrapFail(). The diagnostic has already been
    // written to stderr and process.exitCode is set. The
    // event loop drains, Node exits with the assigned code.
    // We swallow the sentinel so the promise resolves
    // cleanly (rather than rejecting).
    if (e instanceof BootstrapFailureSentinel) {
      return;
    }
    throw e;
  }
}
