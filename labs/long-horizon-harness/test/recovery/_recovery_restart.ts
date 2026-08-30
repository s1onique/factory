/**
 * FOUNDATION03 — restart process helper (real JsonlLedger).
 *
 * Invoked as a Node executable:
 *   node --import tsx test/recovery/_recovery_restart.ts --run-dir <dir>
 *
 * Opens the real JsonlLedger (with torn-tail recovery), decodes
 * committed envelopes via the production codec, projects the
 * recovery state, and (for in_flight_at_crash) calls the real
 * reconcile() with a read-only signal-zero probe.
 *
 * The helper receives ONLY --run-dir. It performs ZERO
 * destructive signals — its only kernel capability is
 * signal-zero probe via process.kill(-pgid, 0).
 */

import { JsonlLedger } from "../../src/evidence/jsonl-ledger.js";
import { projectExecution } from "../../src/recovery/process-recovery-projector.js";
import { reconcile } from "../../src/recovery/process-reconciler.js";
import type { RecoveryProbe } from "../../src/recovery/recovery-ports.js";
import type { GroupProbeSnapshot } from "../../src/recovery/recovery-types.js";
import type { EvidenceStream } from "../../src/recovery/recovery-types.js";
import type { EventEnvelope } from "../../src/evidence/codec-types.js";

function emit(rec: unknown): void {
  process.stdout.write(JSON.stringify(rec) + "\n");
}

function makeRealReadOnlyProbe(probes: { count: number }): RecoveryProbe {
  return {
    probeHistoricalGroup: (pgid: number): GroupProbeSnapshot => {
      probes.count++;
      // signal-zero probe via kill(pgid, 0).
      try {
        process.kill(-pgid, 0);
        return { probe_kind: "alive" };
      } catch (e: unknown) {
        const code = (e as { code?: string }).code;
        if (code === "ESRCH") return { probe_kind: "absent" };
        if (code === "EPERM" || code === "EACCES") {
          return { probe_kind: "permission_denied", ...(code !== undefined ? { code } : {}) };
        }
        return { probe_kind: "probe_error", message: String(e), ...(code !== undefined ? { code } : {}) };
      }
    },
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--run-dir");
  if (idx === -1 || argv[idx + 1] === undefined) {
    process.stderr.write("--run-dir is required\n");
    process.exit(2);
    return;
  }
  const runDir = argv[idx + 1] as string;
  let decision: string = "no_decision";
  let stateKind: string = "unknown";
  let signals = 0;
  let kernelProbes = 0;
  let processId = "unknown";
  try {
    const ledger = new JsonlLedger(runDir);
    const openR = await ledger.open({ createIfMissing: false });
    if (!openR.ok) {
      emit({ kind: "restart_result", state: "error", decision: "no_decision", signals: 0, kernelProbes: 0, error: "ledger_open_failed:" + JSON.stringify(openR.error) });
      process.exit(1);
      return;
    }
    const allR = await ledger.readAll();
    if (!allR.ok) {
      // Malformed committed record → fail closed (CORRECTION04 §37).
      emit({ kind: "restart_result", state: "error", decision: "no_decision", signals: 0, kernelProbes: 0, error: "ledger_read_failed:" + JSON.stringify(allR.error) });
      process.exit(1);
      return;
    }
    // Build EvidenceStream from real envelopes (CORRECTION04 §6).
    const streamArray: Array<{ payload: import("../../src/evidence/codec-types.js").PersistedProcessEvidencePayload; observedAt: number; seq: number }> = [];
    for (const env of allR.value as ReadonlyArray<EventEnvelope>) {
      if (env.schema_version === 2 && env.kind === "process_evidence") {
        streamArray.push({ payload: env.process_evidence, observedAt: env.observed_at, seq: env.sequence });
      }
    }
    const stream: EvidenceStream = streamArray;
    const proj = projectExecution(stream);
    if (!proj.ok) {
      emit({ kind: "restart_result", state: "error", decision: "no_decision", signals: 0, kernelProbes: 0, error: "projection_failed:" + JSON.stringify(proj.error) });
      process.exit(1);
      return;
    }
    const state = proj.value;
    stateKind = state.kind;
    if (state.kind === "settled") {
      decision = "settled_exact_result";
      processId = state.processId;
    } else if (state.kind === "spawn_outcome_unknown") {
      decision = "spawn_outcome_unknown";
      processId = state.processId;
    } else if (state.kind === "in_flight_at_crash") {
      processId = state.processId;
      // Real reconcile with read-only probe (CORRECTION04 §7/§8).
      const counters = { count: 0 };
      const probe = makeRealReadOnlyProbe(counters);
      const d = reconcile(state, probe);
      kernelProbes = counters.count;
      signals = 0;
      if (d.kind === "historical_group_observed_alive") {
        decision = "historical_group_observed_alive";
      } else if (d.kind === "historical_group_absent") {
        decision = "historical_group_absent";
      } else if (d.kind === "historical_group_probe_denied") {
        decision = "historical_group_probe_denied";
      } else if (d.kind === "historical_group_probe_error") {
        decision = "historical_group_probe_error";
      } else {
        decision = "no_action";
      }
    } else if (state.kind === "spawn_failure_observed") {
      decision = "spawn_failure_observed_durable_pending";
      processId = state.processId;
    } else if (state.kind === "result_unknown_after_cleanup") {
      decision = "result_unknown_after_cleanup";
      processId = state.processId;
    } else if (state.kind === "not_started") {
      decision = "no_action";
    }
    emit({ kind: "restart_result", state: stateKind, processId, decision, signals, kernelProbes, error: null });
    process.exit(0);
  } catch (e: unknown) {
    emit({ kind: "restart_result", state: "exception", decision: "no_decision", signals, kernelProbes, error: e instanceof Error ? e.message : String(e) });
    process.exit(1);
  }
}

void main();
