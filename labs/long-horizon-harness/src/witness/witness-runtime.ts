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
import {
  handleFrame,
  setLiveCtx,
  eventId,
  shutdown,
} from "./witness-runtime-handlers.js";

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
};

export async function runWitnessProcess(args: WitnessProcessArgs): Promise<void> {
  if (args.protocolVersion !== WITNESS_PROTOCOL_VERSION) {
    process.stderr.write(`witness: unsupported protocol_version ${args.protocolVersion}\n`);
    process.exit(2);
  }
  const witnessId = makeWitnessId(args.witnessId);
  const witnessInstanceId = makeWitnessInstanceId(args.witnessInstanceId);
  const runId = args.runId as import("../domain/ids.js").RunId;
  const missionId = args.missionId as import("../domain/ids.js").MissionId;

  const key = generateEd25519Keypair();
  // F04-D33: durable witness_start_requested BEFORE spawn.
  const startAck = await appendWitnessEvidence({
    runDir: args.runDir,
    runId,
    missionId,
    eventId: eventId("w-start"),
    observedAt: Date.now(),
    payload: {
      kind: "witness_start_requested",
      witness_id: witnessId,
      witness_instance_id: witnessInstanceId,
    },
  });
  if (!startAck.ok) {
    process.stderr.write(`witness: start durability failed\n`);
    process.exit(1);
  }

  const bootstrap: WitnessBootstrapConfig = {
    binding: {
      runId,
      missionId,
      attemptId: args.attemptId as import("../domain/ids.js").AttemptId,
      processId: args.processId as import("../process/process-types.js").ProcessId,
      witnessId,
      witnessInstanceId,
    },
    controllerPublicKeyFingerprint: "",
    socketPath: args.socketPath,
    protocolVersion: args.protocolVersion,
    bootstrapLeaseMs: args.bootstrapLeaseMs,
  };

  let ctx: WitnessRuntimeContext = {
    bootstrap,
    witnessPublicKey: key.publicKeyHex,
    witnessPublicKeyFingerprint: key.publicKeyFingerprint,
    witnessPid: process.pid,
    controllerPublicKeyFingerprint: "",
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
      handleFrame(json, key, { runDir: args.runDir, controlDir: args.controlDir }),
  });
  if (!bindR.ok) {
    process.stderr.write(`witness: bind failed: ${JSON.stringify(bindR.error)}\n`);
    process.exit(1);
  }
  const server = bindR.value;

  // F04-D32/D34: durable witness_ready
  const readyAck = await appendWitnessEvidence({
    runDir: args.runDir,
    runId,
    missionId,
    eventId: eventId("w-ready"),
    observedAt: Date.now(),
    payload: {
      kind: "witness_ready",
      witness_id: witnessId,
      witness_instance_id: witnessInstanceId,
      historical_witness_pid: process.pid,
      socket_path: args.socketPath,
      witness_public_key: key.publicKeyHex,
      witness_public_key_fingerprint: key.publicKeyFingerprint,
      controller_public_key_fingerprint: "",
      protocol_version: args.protocolVersion,
    },
  });
  if (!readyAck.ok) {
    process.stderr.write(`witness: ready durability failed\n`);
    process.exit(1);
  }
  ctx = {
    ...ctx,
    state: {
      kind: "ready_not_activated",
      binding: bootstrap.binding,
      historicalWitnessPid: process.pid,
      witnessPublicKey: key.publicKeyHex,
      witnessPublicKeyFingerprint: key.publicKeyFingerprint,
      controllerPublicKeyFingerprint: "",
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
}
