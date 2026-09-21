/**
 * LH-06 deterministic long-duration soak laboratory —
 * supervisor (top-level module).
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Pure supervisor helpers; child-process management lives in
 * `soak-supervisor.mjs` (a thin Node script that imports
 * `worker-runner` and supervises it externally).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type TelemetryLine } from "./telemetry.js";
import {
  type LH06Result,
  type LH06FailureRecord,
  type LH06EnvironmentIdentity,
  verdictForFailure,
} from "./result.js";
import { runSoakWorker, type LH06RunLoopArgs } from "./worker-runner.js";
import type {
  SupervisorState,
} from "./supervisor-state.js";
import { hangFailure } from "./supervisor-state.js";

export {
  type SupervisorState,
  createSupervisorState,
  recordHeartbeat,
  checkHang,
  checkQualificationDeadline,
  hangFailure,
  LH06_DEFAULT_HEARTBEAT_TIMEOUT_MS as LH06_HEARTBEAT_TIMEOUT_MS,
} from "./supervisor-state.js";

/**
 * Build a failure record for a hang.
 */
export function buildHangFailure(args: {
  readonly state: SupervisorState;
  readonly now_ms: number;
}): LH06FailureRecord {
  return hangFailure(args);
}

/**
 * Persistence helper for the supervisor's failure packet
 * (ACT §28). Synchronous write so the supervisor's exit
 * cannot lose the packet.
 */
export function persistFailurePacket(args: {
  readonly packet_path: string;
  readonly state: SupervisorState;
  readonly failure: LH06FailureRecord;
  readonly last_telemetry: readonly TelemetryLine[];
  readonly env: LH06EnvironmentIdentity;
  readonly result: LH06Result | null;
}): void {
  mkdirSync(dirname(args.packet_path), { recursive: true });
  const packet = {
    schema: "lh06.failure-packet/v1",
    captured_at_ms: Date.now(),
    failure: args.failure,
    worker_pid: args.state.workerPid,
    last_epoch: args.state.lastEpoch,
    completed_runs: args.state.completedRuns,
    last_20_heartbeats_ms: args.state.recentHeartbeats,
    last_20_telemetry_lines: args.last_telemetry.slice(-20),
    environment_identity: args.env,
    failure_result: args.result,
  };
  writeFileSync(args.packet_path, JSON.stringify(packet, null, 2) + "\n");
}

/**
 * Map a failure to a verdict.
 */
export { verdictForFailure };

/**
 * Re-export the worker entrypoint so the supervisor can
 * launch the worker inside its own process (in-process mode
 * for tests). In production deployment the worker is a
 * separate process; see `soak-supervisor.mjs`.
 */
export { runSoakWorker, type LH06RunLoopArgs };
