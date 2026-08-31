/**
 * FOUNDATION04 — supervisor helper.
 *
 * Thin client that connects to a witness UDS, sends a signed HELLO,
 * verifies the signed response, and optionally sends a signed
 * command.
 */

import { connect } from "node:net";
import { promises as fs } from "node:fs";
import {
  encodeHello,
  encodeSignedCommand,
} from "../../src/witness/witness-codec-messages.js";
import { decodeWitnessMessage } from "../../src/witness/witness-codec-decode.js";
import {
  canonicalHandshakePayload,
  canonicalCommandResponse,
  canonicalControllerCommand,
} from "../../src/witness/witness-codec-payload.js";
import { encodeFrame, decodeFrame } from "../../src/witness/witness-codec-framing.js";
import { generateEd25519Keypair, ed25519VerifierFromPublicHex } from "../../src/witness/witness-crypto.js";
import { makePrivateKeySigner } from "./helpers-key.js";

type Args = {
  socketPath: string;
  controlPrivPath: string;
  witnessPublicKeyHex: string;
  runId: string;
  missionId: string;
  attemptId: string;
  processId: string;
  witnessId: string;
  witnessInstanceId: string;
  commandId: string;
  action: "QUERY" | "PING" | "CANCEL" | "TERMINATE";
  nonce: string;
};

function emit(rec: unknown): void {
  process.stdout.write(JSON.stringify(rec) + "\n");
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const m: Record<string, string> = {};
  for (let i = 0; i + 1 < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k !== undefined && v !== undefined) m[k.slice(2)] = v;
  }
  return {
    socketPath: m["socket-path"] ?? "",
    controlPrivPath: m["control-priv-path"] ?? "",
    witnessPublicKeyHex: m["witness-pub"] ?? "",
    runId: m["run-id"] ?? "r",
    missionId: m["mission-id"] ?? "m",
    attemptId: m["attempt-id"] ?? "a",
    processId: m["process-id"] ?? "p",
    witnessId: m["witness-id"] ?? "w",
    witnessInstanceId: m["witness-instance-id"] ?? "wi",
    commandId: m["command-id"] ?? "c-1",
    action: (m["action"] ?? "QUERY") as Args["action"],
    nonce: m["nonce"] ?? "nonce-1",
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  let privRaw: string;
  try {
    privRaw = await fs.readFile(args.controlPrivPath, "utf8");
  } catch {
    const k = generateEd25519Keypair();
    privRaw = JSON.stringify({ version: 1, private_key: k.privateKeyHex });
  }
  const priv = JSON.parse(privRaw) as { version: number; private_key: string };
  if (priv.version !== 1 || typeof priv.private_key !== "string") {
    emit({ kind: "error", message: "bad controller key file" });
    process.exit(2);
    return;
  }
  const signer = makePrivateKeySigner(priv.private_key);

  const socket = connect(args.socketPath);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("connect-timeout")), 3000);
    socket.once("connect", () => {
      clearTimeout(t);
      resolve();
    });
    socket.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });

  const helloJson = encodeHello({
    protocolVersion: 1,
    runId: args.runId as never,
    attemptId: args.attemptId as never,
    processId: args.processId as never,
    witnessId: args.witnessId as never,
    witnessInstanceId: args.witnessInstanceId as never,
    clientNonce: args.nonce,
  });
  const helloFrame = encodeFrame(helloJson);
  if (!helloFrame.ok) {
    emit({ kind: "error", message: "hello frame too large" });
    process.exit(1);
    return;
  }

  const readResponse = (): Promise<string> =>
    new Promise((resolve, reject) => {
      let buf: Buffer = Buffer.alloc(0);
      const t = setTimeout(() => reject(new Error("response-timeout")), 3000);
      socket.on("data", (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        const decoded = decodeFrame(buf, 0);
        if (decoded.ok) {
          clearTimeout(t);
          resolve(decoded.json);
        } else if (decoded.error.kind === "oversize_frame") {
          clearTimeout(t);
          reject(new Error("oversize"));
        }
      });
      socket.on("error", (e) => {
        clearTimeout(t);
        reject(e);
      });
    });

  socket.write(helloFrame.bytes);
  const helloRespRaw = await readResponse();
  const helloMsg = decodeWitnessMessage(helloRespRaw);
  if (helloMsg.kind !== "handshake") {
    emit({ kind: "error", message: "expected handshake", got: helloMsg.kind });
    process.exit(1);
    return;
  }
  const hs = helloMsg.response;
  const verifier = ed25519VerifierFromPublicHex(args.witnessPublicKeyHex);
  const hsCanonical = canonicalHandshakePayload(hs.witnessState);
  const hsSigOk = verifier.verify(hsCanonical, hs.signature);
  emit({
    kind: "handshake_ok",
    signature_ok: hsSigOk,
    state_kind: hs.witnessState.stateKind,
    candidate_pid: hs.witnessState.candidatePid,
    candidate_pgid: hs.witnessState.candidatePgid,
    witness_sequence: hs.witnessState.witnessSequence,
  });

  const payload = {
    commandId: args.commandId as never,
    runId: args.runId as never,
    missionId: args.missionId as never,
    attemptId: args.attemptId as never,
    processId: args.processId as never,
    witnessId: args.witnessId as never,
    witnessInstanceId: args.witnessInstanceId as never,
    action: args.action,
    nonce: args.nonce,
  };
  const cmdCanonical = canonicalControllerCommand(payload);
  const cmdSig = signer.sign(cmdCanonical);
  const cmdJson = encodeSignedCommand({
    protocolVersion: 1,
    payload,
    signature: cmdSig,
  });
  const cmdFrame = encodeFrame(cmdJson);
  if (!cmdFrame.ok) {
    emit({ kind: "error", message: "cmd frame too large" });
    process.exit(1);
    return;
  }
  socket.write(cmdFrame.bytes);
  const cmdRespRaw = await readResponse();
  const cmdMsg = decodeWitnessMessage(cmdRespRaw);
  if (cmdMsg.kind !== "command_response") {
    emit({ kind: "error", message: "expected command_response", got: cmdMsg.kind });
    process.exit(1);
    return;
  }
  const cmdRespCanonical = canonicalCommandResponse(cmdMsg.response.payload);
  const cmdSigOk = verifier.verify(cmdRespCanonical, cmdMsg.response.signature);
  emit({
    kind: "command_response_ok",
    signature_ok: cmdSigOk,
    witness_sequence: cmdMsg.response.payload.witnessSequence,
    result_kind: cmdMsg.response.payload.result.kind,
  });
  socket.end();
}

void main().catch((e: unknown) => {
  emit({ kind: "error", message: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
