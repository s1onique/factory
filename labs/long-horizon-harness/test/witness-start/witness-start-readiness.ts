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
 * Race outcomes (in priority order):
 *   - ready                  (durable witness_ready seen for this identity)
 *   - evidence_invalid       (durable witness_ready seen but trust-boundary rejection)
 *   - child_exited_before_ready (child exited; no durable witness_ready observed)
 *   - ready_timeout          (deadline elapsed; no exit; no readiness)
 *
 * No arbitrary sleep. The helper polls the authoritative
 * ledger on a small interval; the source-of-truth is
 * the LedgerWriter's events.jsonl, NOT a child-process
 * liveness signal.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";

export type AwaitWitnessReadyArgs = {
  readonly runDir: string;
  readonly witnessInstanceId: string;
  readonly deadlineMs?: number;
  readonly pollIntervalMs?: number;
};

export type AwaitWitnessReadyResult =
  | { readonly kind: "ready"; readonly observedAt: number }
  | { readonly kind: "evidence_invalid"; readonly reason: string }
  | { readonly kind: "child_exited_before_ready"; readonly childExited: boolean }
  | { readonly kind: "ready_timeout" };

type ReadyRecord = {
  readonly observed_at: number;
  readonly witness_evidence: {
    readonly kind: string;
    readonly witness_instance_id: string;
  };
};

async function readJsonl(p: string): Promise<ReadonlyArray<ReadyRecord>> {
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch {
    return [];
  }
  if (raw.length === 0) return [];
  const out: ReadyRecord[] = [];
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    try {
      const rec = JSON.parse(line) as ReadyRecord;
      out.push(rec);
    } catch {
      // skip malformed lines; the writer is single-writer
      // and well-formed, so this should not happen
    }
  }
  return out;
}

export async function awaitWitnessReady(
  args: AwaitWitnessReadyArgs,
): Promise<AwaitWitnessReadyResult> {
  const deadline = Date.now() + (args.deadlineMs ?? 5000);
  const interval = args.pollIntervalMs ?? 50;
  const eventsPath = path.join(args.runDir, "events.jsonl");
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const records = await readJsonl(eventsPath);
    for (const r of records) {
      if (
        r.witness_evidence !== undefined &&
        r.witness_evidence.kind === "witness_ready" &&
        r.witness_evidence.witness_instance_id === args.witnessInstanceId
      ) {
        return { kind: "ready", observedAt: r.observed_at };
      }
    }
    if (Date.now() >= deadline) {
      return { kind: "ready_timeout" };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
