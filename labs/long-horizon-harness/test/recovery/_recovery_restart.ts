/**
 * FOUNDATION03 — restart process helper.
 *
 * Invoked as a Node executable by the strict crash lane:
 *   node --import tsx test/recovery/_recovery_restart.ts --run-dir <dir>
 *
 * Reads the JsonlLedger from <dir>, decodes process-evidence,
 * projects, and reconciles. Emits a single JSON decision record.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodePersistedProcessEvidence } from "../../src/evidence/codec-decode.js";
import { projectExecution } from "../../src/recovery/process-recovery-projector.js";

function emit(rec: unknown): void {
  process.stdout.write(JSON.stringify(rec) + "\\n");
}

function loadStream(runDir: string): Array<{ payload: import("../../src/evidence/codec-types.js").PersistedProcessEvidencePayload; observedAt: number; seq: number }> {
  const eventsPath = join(runDir, "events.jsonl");
  const text = readFileSync(eventsPath, "utf8");
  const out: Array<{ payload: import("../../src/evidence/codec-types.js").PersistedProcessEvidencePayload; observedAt: number; seq: number }> = [];
  let seq = 0;
  for (const line of text.split("\\n")) {
    if (line.length === 0) continue;
    const env = JSON.parse(line) as { kind?: string; payload?: unknown };
    if (env.kind !== "process_evidence" || env.payload === undefined) continue;
    seq++;
    const d = decodePersistedProcessEvidence(env.payload);
    if (!d.ok) continue;
    out.push({ payload: d.value, observedAt: 0, seq });
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runDir = args[args.indexOf("--run-dir") + 1];
  if (runDir === undefined) {
    throw new Error("--run-dir is required");
  }
  try {
    const stream = loadStream(runDir);
    const proj = projectExecution(stream);
    if (!proj.ok) {
      emit({ kind: "restart_result", state: "error", error: proj.error.kind, decision: "no_decision", signals: 0, kernelProbes: 0 });
      return;
    }
    const state = proj.value;
    let decision = "no_decision";
    if (state.kind === "in_flight_at_crash") {
      decision = "historical_group_observed_alive";
    } else if (state.kind === "spawn_outcome_unknown") {
      decision = "spawn_outcome_unknown";
    } else if (state.kind === "settled") {
      decision = "settled_exact_result";
    }
    const processId = state.kind === "settled" ? state.processId : (state as { processId?: string }).processId ?? "unknown";
    emit({ kind: "restart_result", state: state.kind, processId, decision, signals: 0, kernelProbes: 0, error: null });
  } catch (e: unknown) {
    emit({ kind: "restart_result", state: "exception", error: e instanceof Error ? e.message : String(e), decision: "no_decision", signals: 0, kernelProbes: 0 });
  }
}

void main().then(
  () => undefined,
  (e: unknown) => {
    process.stderr.write("restart helper error: " + (e instanceof Error ? e.message : String(e)) + "\\n");
    process.exit(2);
  },
);
