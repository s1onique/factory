/**
 * FOUNDATION04 — witness runtime handlers.
 *
 * Per-frame message handlers extracted from witness-runtime.ts
 * so that the runtime entry file stays under the 400 LOC
 * source-size discipline.
 */

import { promises as fs } from "node:fs";
import { canonicalHandshakePayload, canonicalCommandResponse } from "./witness-codec-payload.js";
import {
  decodeClientMessage,
  decodeJsonText,
} from "./witness-codec-decode.js";
import {
  encodeHandshakeResponse,
  encodeCommandResponse,
  encodeProtocolError,
} from "./witness-codec-messages.js";
import { generateEd25519Keypair, ed25519VerifierFromPublicHex, sha256Hex, signWithKeyObject } from "./witness-crypto.js";
import { safeRemoveSocketFile } from "./witness-server.js";
import { WITNESS_PROTOCOL_VERSION } from "./witness-protocol.js";
import { applyRuntimeInput } from "./witness-runtime-sm.js";
import { getSequence } from "./witness-runtime-sm-helpers.js";
import type { WitnessRuntimeContext } from "./witness-runtime-sm-helpers.js";
import { sameBinding, type CommandJournalEntry } from "./witness-runtime-types.js";
import type { WitnessPersistedResult, WitnessCommandId } from "./witness-types.js";
import type {
  ControllerCommandPayload,
  WitnessHandshakeResponse,
  WitnessSignedCommand,
  WitnessSignedCommandResponse,
  WitnessStateSummary,
  WitnessHello,
} from "./witness-protocol.js";
import { appendWitnessEvidence } from "./witness-ledger.js";

export type WitnessKey = ReturnType<typeof generateEd25519Keypair>;

export type RuntimeHandleArgs = {
  readonly runDir: string;
  readonly controlDir: string;
  /**
   * B0-CORR01: the LedgerWriter socket path. Required for
   * durable evidence appends. If absent, handleSignedCommand
   * fails closed (B0-C01-11).
   */
  readonly ledgerWriterSocketPath: string | undefined;
};

export async function handleFrame(
  json: string,
  key: WitnessKey,
  args: RuntimeHandleArgs,
): Promise<string> {
  try {
    const msg = decodeClientMessage(json);
    if (msg.kind === "hello") return handleHello(msg.hello, key, args);
    if (msg.kind === "signed_command") return await handleSignedCommand(msg.cmd, key, args);
    return encodeProtocolError({ kind: "unknown_command", reason: "unknown client message" });
  } catch (e: unknown) {
    const inner = (e as { error?: { kind?: string; reason?: string } }).error;
    if (inner && inner.kind) return encodeProtocolError(inner as never);
    return encodeProtocolError({
      kind: "malformed_json",
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}

export function handleHello(hello: WitnessHello, key: WitnessKey, _args: RuntimeHandleArgs): string {
  const ctx = currentCtx();
  const bindingHello = {
    runId: hello.runId,
    missionId: ctx.bootstrap.binding.missionId,
    attemptId: hello.attemptId,
    processId: hello.processId,
    witnessId: hello.witnessId,
    witnessInstanceId: hello.witnessInstanceId,
  };
  if (!sameBinding(ctx.bootstrap.binding, bindingHello)) {
    return encodeProtocolError({
      kind: "identity_mismatch",
      reason: "hello binding does not match witness bootstrap",
    });
  }
  const summary: WitnessStateSummary = {
    runId: ctx.bootstrap.binding.runId,
    attemptId: ctx.bootstrap.binding.attemptId,
    processId: ctx.bootstrap.binding.processId,
    witnessId: ctx.bootstrap.binding.witnessId,
    witnessInstanceId: ctx.bootstrap.binding.witnessInstanceId,
    witnessPid: ctx.witnessPid,
    witnessPublicKeyFingerprint: key.publicKeyFingerprint,
    controllerPublicKeyFingerprint: ctx.controllerPublicKeyFingerprint,
    clientNonce: hello.clientNonce,
    stateKind: ctx.state.kind,
    candidatePid: ctx.candidate?.pid ?? null,
    candidatePgid: ctx.candidate?.pgid ?? null,
    witnessSequence: getSequence(ctx),
  };
  const canonical = canonicalHandshakePayload(summary);
  const sig = signWithKeyObject(key.privateKey, Buffer.from(canonical));
  const response: WitnessHandshakeResponse = {
    protocolVersion: WITNESS_PROTOCOL_VERSION,
    witnessState: summary,
    signature: sig.toString("base64url"),
  };
  return encodeHandshakeResponse(response);
}

export async function handleSignedCommand(
  cmd: WitnessSignedCommand,
  key: WitnessKey,
  args: RuntimeHandleArgs,
): Promise<string> {
  if (cmd.protocolVersion !== WITNESS_PROTOCOL_VERSION) {
    return encodeProtocolError({
      kind: "protocol_version_mismatch",
      expected: WITNESS_PROTOCOL_VERSION,
      received: cmd.protocolVersion,
    });
  }
  const p = cmd.payload;
  const ctx = currentCtx();
  if (
    p.runId !== ctx.bootstrap.binding.runId ||
    p.attemptId !== ctx.bootstrap.binding.attemptId ||
    p.processId !== ctx.bootstrap.binding.processId ||
    p.witnessId !== ctx.bootstrap.binding.witnessId ||
    p.witnessInstanceId !== ctx.bootstrap.binding.witnessInstanceId
  ) {
    return encodeProtocolError({
      kind: "identity_mismatch",
      reason: "command identity does not match witness binding",
    });
  }
  const controllerPub = await readControllerPublicKey(args.controlDir);
  if (controllerPub === null) {
    return encodeProtocolError({
      kind: "invalid_signature",
      reason: "no controller public key configured",
    });
  }
  const verifier = ed25519VerifierFromPublicHex(controllerPub);
  const canonical = canonicalCommandPayloadForSign(p);
  if (!verifier.verify(canonical, cmd.signature)) {
    return encodeProtocolError({
      kind: "invalid_signature",
      reason: "controller signature did not verify",
    });
  }
  const fingerprint = sha256Hex(canonicalCommandPayloadForSign(p));
  const existing = ctx.commandJournal.find((e) => e.commandId === p.commandId);
  if (existing && existing.kind === "completed") {
    if (existing.requestFingerprint !== fingerprint) {
      return encodeProtocolError({
        kind: "invalid_signature",
        reason: "command_id reused with different payload",
      });
    }
    return encodeCachedResponse(existing.responseBody, ctx, key, p.commandId);
  }
  const intentAck = await appendWitnessEvidence({
    binding: {
      runDir: args.runDir,
      socketPath: args.ledgerWriterSocketPath ?? "",
    },
    runId: ctx.bootstrap.binding.runId,
    missionId: ctx.bootstrap.binding.missionId,
    eventId: eventId("w-cmd"),
    observedAt: Date.now(),
    commitId: `w-cmd-${p.commandId}`,
    payload: {
      kind: "witness_command_requested",
      witness_id: ctx.bootstrap.binding.witnessId,
      witness_instance_id: ctx.bootstrap.binding.witnessInstanceId,
      command_id: p.commandId,
      action: p.action,
    },
  });
  if (!intentAck.ok) {
    return encodeProtocolError({
      kind: "invalid_signature",
      reason: "witness_command_requested durability failed",
    });
  }
  const entry: CommandJournalEntry = {
    kind: "pending",
    commandId: p.commandId,
    request: { ...p, protocolVersion: cmd.protocolVersion },
    requestFingerprint: fingerprint,
  };
  const transition = applyRuntimeInput(ctx, { kind: "command_received", entry });
  if (!transition.ok) {
    return encodeProtocolError({ kind: "invalid_signature", reason: transition.error });
  }
  setLiveCtx(transition.context);
  return handleReadOnly(p, transition.context, key);
}

export function handleReadOnly(
  p: ControllerCommandPayload,
  ctx: WitnessRuntimeContext,
  key: WitnessKey,
): string {
  const status = ctx.lastExecutionStatus;
  const witnessSequence = getSequence(ctx);
  const result =
    p.action === "PING"
      ? ({ kind: "pong" } as const)
      : ({
          kind: "ok" as const,
          executionStatus: {
            kind: status.kind,
            pid: status.kind === "running" ? status.pid : null,
            pgid: status.kind === "running" ? status.pgid : null,
          },
          result: status.kind === "settled" || status.kind === "cleanup_failed" ? status.result : null,
        } as const);
  return signCommandResponse(p.commandId, ctx, key, witnessSequence, result as never);
}

export function signCommandResponse(
  commandId: WitnessCommandId,
  ctx: WitnessRuntimeContext,
  key: WitnessKey,
  witnessSequence: number,
  result:
    | { readonly kind: "ok"; readonly executionStatus: { kind: string; pid: number | null; pgid: number | null }; readonly result: WitnessPersistedResult | null }
    | { readonly kind: "cancelled"; readonly result: WitnessPersistedResult }
    | { readonly kind: "terminated"; readonly result: WitnessPersistedResult }
    | { readonly kind: "already_settled"; readonly result: WitnessPersistedResult }
    | { readonly kind: "cleanup_failed"; readonly result: WitnessPersistedResult }
    | { readonly kind: "authority_unavailable"; readonly reason: string }
    | { readonly kind: "rejected"; readonly reason: string }
    | { readonly kind: "pong" },
): string {
  const payload = {
    commandId,
    witnessId: ctx.bootstrap.binding.witnessId,
    witnessInstanceId: ctx.bootstrap.binding.witnessInstanceId,
    witnessSequence,
    result,
  };
  const canonical = canonicalCommandResponse(payload);
  const sig = signWithKeyObject(key.privateKey, Buffer.from(canonical));
  const response: WitnessSignedCommandResponse = {
    protocolVersion: WITNESS_PROTOCOL_VERSION,
    payload,
    signature: sig.toString("base64url"),
  };
  return encodeCommandResponse(response);
}

export function encodeCachedResponse(
  body:
    | { readonly kind: "cancelled"; readonly result: WitnessPersistedResult }
    | { readonly kind: "terminated"; readonly result: WitnessPersistedResult }
    | { readonly kind: "already_settled"; readonly result: WitnessPersistedResult }
    | { readonly kind: "cleanup_failed"; readonly result: WitnessPersistedResult }
    | { readonly kind: "authority_unavailable"; readonly reason: string }
    | { readonly kind: "ok"; readonly result: WitnessPersistedResult | null },
  ctx: WitnessRuntimeContext,
  key: WitnessKey,
  commandId: WitnessCommandId,
): string {
  return signCommandResponse(commandId, ctx, key, getSequence(ctx), body as never);
}

export function canonicalCommandPayloadForSign(p: ControllerCommandPayload): Uint8Array {
  const lines = [
    "witness_command",
    p.commandId,
    p.runId,
    p.attemptId,
    p.processId,
    p.witnessId,
    p.witnessInstanceId,
    p.action,
    p.nonce,
  ];
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

export async function readControllerPublicKey(dir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(dir + "/controller.pub", "utf8");
    const parsed: unknown = decodeJsonText(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { public_key?: unknown }).public_key === "string"
    ) {
      return (parsed as { public_key: string }).public_key;
    }
    return null;
  } catch {
    return null;
  }
}

export function eventId(prefix: string): import("../domain/ids.js").EventId {
  return `${prefix}-${Date.now().toString(36)}-${process.pid.toString(36)}` as import("../domain/ids.js").EventId;
}

let liveCtx: WitnessRuntimeContext | null = null;

export function setLiveCtx(c: WitnessRuntimeContext): void {
  liveCtx = c;
}

export function currentCtx(): WitnessRuntimeContext {
  if (liveCtx === null) throw new Error("witness: context not initialized");
  return liveCtx;
}

export async function shutdown(
  server: import("node:net").Server,
  socketPath: string,
  code: number,
): Promise<void> {
  server.close();
  await safeRemoveSocketFile(socketPath);
  process.exit(code);
}

