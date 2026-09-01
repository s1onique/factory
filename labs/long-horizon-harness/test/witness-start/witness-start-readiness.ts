/**
 * FOUNDATION04 — `awaitWitnessReady`.
 *
 * Deterministic readiness barrier for live tests.
 *
 * Doctrine (readiness-evidence law):
 *   Process creation is not readiness. A witness is
 *   ready only when its identity-bound readiness fact
 *   is durably committed in the LedgerWriter's
 *   authoritative history.
 *
 * Race outcomes (priority order):
 *   - ready
 *       (durable witness_ready verified against the
 *        FULL expected identity, not just instance id)
 *   - evidence_invalid
 *       (a line in events.jsonl failed authoritative
 *        decoding; we fail closed, never ignore)
 *   - child_exited_before_ready
 *       (child exit observed before readiness; the
 *        diagnostic surface from WitnessSpawnHandle
 *        is included)
 *   - ready_timeout
 *       (deadline elapsed; no exit; no readiness)
 *
 * Full identity match is required (runId, missionId,
 * witnessId, witnessInstanceId, socketPath). A wrong
 * witness record sharing the expected instance string
 * is rejected — this is the strongest acceptance
 * boundary the ACT specifies.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { decodePersistedWitnessEvidence } from "../../src/witness/witness-evidence-decode.js";
import type { WitnessSpawnHandle } from "../../src/witness-start/witness-start-types.js";

export type ExpectedBinding = {
  readonly runId: string;
  readonly missionId: string;
  readonly witnessId: string;
  readonly witnessInstanceId: string;
  readonly socketPath: string;
};

export type AwaitWitnessReadyArgs = {
  readonly runDir: string;
  readonly expected: ExpectedBinding;
  readonly child: WitnessSpawnHandle;
  readonly deadlineMs?: number;
  readonly pollIntervalMs?: number;
};

export type AwaitWitnessReadyResult =
  | { readonly kind: "ready"; readonly observedAt: number; readonly sequence: number }
  | {
      readonly kind: "evidence_invalid";
      readonly reason: string;
      readonly lineNumber: number;
    }
  | {
      readonly kind: "child_exited_before_ready";
      readonly exit: { readonly code: number | null; readonly signal: NodeJS.Signals | null };
      readonly stdoutSeen: number;
      readonly stderrSeen: number;
      readonly stdoutBytes: Uint8Array;
      readonly stderrBytes: Uint8Array;
      readonly stdoutTruncated: boolean;
      readonly stderrTruncated: boolean;
    }
  | { readonly kind: "ready_timeout" };

/**
 * Decode a single events.jsonl line through the
 * authoritative envelope + witness-evidence decoders.
 *
 * We do NOT silently swallow malformed lines. The
 * ACT explicitly requires that a malformed durable
 * ledger tail becomes `evidence_invalid` (fail closed).
 */
function decodeLine(
  raw: string,
): { readonly ok: true; readonly envelope: Record<string, unknown>; readonly payload: unknown }
 | { readonly ok: false; readonly reason: string } {
  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch (e: unknown) {
    return {
      ok: false,
      reason: "malformed JSON: " + (e instanceof Error ? e.message : String(e)),
    };
  }
  if (typeof envelope !== "object" || envelope === null) {
    return { ok: false, reason: "envelope is not an object" };
  }
  const env = envelope as Record<string, unknown>;
  if (env["schema_version"] !== 2) {
    return { ok: false, reason: "schema_version is not 2" };
  }
  if (typeof env["event_id"] !== "string" || env["event_id"].length === 0) {
    return { ok: false, reason: "event_id missing or empty" };
  }
  if (typeof env["run_id"] !== "string" || env["run_id"].length === 0) {
    return { ok: false, reason: "run_id missing or empty" };
  }
  if (typeof env["mission_id"] !== "string" || env["mission_id"].length === 0) {
    return { ok: false, reason: "mission_id missing or empty" };
  }
  if (typeof env["sequence"] !== "number" || !Number.isInteger(env["sequence"])) {
    return { ok: false, reason: "sequence missing or not integer" };
  }
  if (typeof env["observed_at"] !== "number") {
    return { ok: false, reason: "observed_at missing or not number" };
  }
  if (env["kind"] !== "witness_evidence") {
    return { ok: false, reason: "not_witness_evidence" };
  }
  const payloadR = decodePersistedWitnessEvidence(env["witness_evidence"]);
  if (payloadR.ok === false) {
    return { ok: false, reason: payloadR.error.reason };
  }
  return { ok: true, envelope: env, payload: payloadR.value };
}

export async function awaitWitnessReady(
  args: AwaitWitnessReadyArgs,
): Promise<AwaitWitnessReadyResult> {
  const deadline = Date.now() + (args.deadlineMs ?? 5000);
  const interval = args.pollIntervalMs ?? 50;
  const eventsPath = path.join(args.runDir, "events.jsonl");
  let lastLineNumber = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 1) Race the child-exit signal FIRST.
    const exit = args.child.exitInfo();
    if (exit.exited) {
      const out = args.child.bootstrapOutput();
      return {
        kind: "child_exited_before_ready",
        exit: { code: exit.code, signal: exit.signal },
        stdoutSeen: out.stdoutBytesSeen,
        stderrSeen: out.stderrBytesSeen,
        stdoutBytes: out.stdout,
        stderrBytes: out.stderr,
        stdoutTruncated: out.stdoutTruncated,
        stderrTruncated: out.stderrTruncated,
      };
    }

    // 2) Inspect the authoritative ledger for any
    //    newly-appended witness_evidence lines.
    let raw: string;
    try {
      raw = await fs.readFile(eventsPath, "utf8");
    } catch {
      raw = "";
    }
    if (raw.length > 0) {
      const lines = raw.split("\n");
      for (let i = lastLineNumber; i < lines.length; i += 1) {
        const line = lines[i];
        if (line === undefined || line.length === 0) continue;
        lastLineNumber = i + 1;
        const decoded = decodeLine(line);
        if (decoded.ok === false) {
          if (decoded.reason === "not_witness_evidence") continue;
          return {
            kind: "evidence_invalid",
            reason: decoded.reason,
            lineNumber: i,
          };
        }
        const env = decoded.envelope;
        const payload = decoded.payload as {
          kind?: string;
          witness_id?: string;
          witness_instance_id?: string;
          socket_path?: string;
        };
        if (payload.kind !== "witness_ready") continue;
        const e = args.expected;
        const matches =
          env["run_id"] === e.runId &&
          env["mission_id"] === e.missionId &&
          payload.witness_id === e.witnessId &&
          payload.witness_instance_id === e.witnessInstanceId &&
          payload.socket_path === e.socketPath;
        if (!matches) {
          return {
            kind: "evidence_invalid",
            reason: "witness_ready identity does not match expected binding " +
              "(runId/missionId/witnessId/witnessInstanceId/socketPath)",
            lineNumber: i,
          };
        }
        return {
          kind: "ready",
          observedAt: env["observed_at"] as number,
          sequence: env["sequence"] as number,
        };
      }
    }

    if (Date.now() >= deadline) {
      return { kind: "ready_timeout" };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
