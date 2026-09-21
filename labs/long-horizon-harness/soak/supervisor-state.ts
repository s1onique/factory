/**
 * LH-06 deterministic long-duration soak laboratory —
 * supervisor state.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Split from supervisor.ts for source-size discipline.
 */
import { BoundedTelemetryBuffer } from "./telemetry.js";
import { LH06_PROFILES, LH06_DEFAULT_HEARTBEAT_TIMEOUT_MS } from "./contract.js";
import type { LH06SoakProfile } from "./types.js";
import type { LH06FailureRecord } from "./result.js";

export interface SupervisorState {
  readonly profile: LH06SoakProfile;
  readonly workerPid: number;
  readonly started_at_ms: number;
  readonly heartbeat_timeout_ms: number;
  readonly qualification_deadline_ms: number;
  lastHeartbeatAtMs: number;
  lastEpoch: number;
  completedRuns: number;
  workerExitCode: number | null;
  workerHangFlagged: boolean;
  readonly recentHeartbeats: number[];
  readonly recentTelemetry: BoundedTelemetryBuffer;
}

export function createSupervisorState(args: {
  readonly profile: LH06SoakProfile;
  readonly workerPid: number;
  readonly started_at_ms: number;
  readonly heartbeat_timeout_ms?: number;
  readonly qualification_deadline_ms?: number;
}): SupervisorState {
  const profile = LH06_PROFILES[args.profile];
  const heartbeatTimeout =
    args.heartbeat_timeout_ms ?? profile.heartbeat_timeout_ms;
  const qualificationDeadline =
    args.qualification_deadline_ms ??
    profile.minimum_wall_clock_ms +
      // Add a 10-minute safety margin past the qualification
      // minimum wall-clock so we don't accidentally kill the
      // worker in the middle of writing the result.
      10 * 60 * 1000;
  return {
    profile: args.profile,
    workerPid: args.workerPid,
    started_at_ms: args.started_at_ms,
    heartbeat_timeout_ms: heartbeatTimeout,
    qualification_deadline_ms: qualificationDeadline,
    lastHeartbeatAtMs: args.started_at_ms,
    lastEpoch: -1,
    completedRuns: 0,
    workerExitCode: null,
    workerHangFlagged: false,
    recentHeartbeats: [],
    recentTelemetry: new BoundedTelemetryBuffer(),
  };
}

/**
 * Record a heartbeat. Returns true if the heartbeat is
 * fresh (epoch advanced).
 */
export function recordHeartbeat(
  state: SupervisorState,
  payload: { readonly epoch: number; readonly completed_runs: number },
  receivedAtMs: number,
): boolean {
  state.lastHeartbeatAtMs = receivedAtMs;
  state.recentHeartbeats.push(receivedAtMs);
  if (state.recentHeartbeats.length > 20) {
    state.recentHeartbeats.shift();
  }
  const advanced = payload.epoch > state.lastEpoch;
  state.lastEpoch = payload.epoch;
  state.completedRuns = payload.completed_runs;
  state.recentTelemetry.push({
    kind: "HEARTBEAT",
    ts_ms: receivedAtMs,
    payload,
  });
  return advanced;
}

/**
 * Decide whether the supervisor should declare a worker
 * hang.
 */
export function checkHang(args: {
  readonly state: SupervisorState;
  readonly now_ms: number;
}): { readonly hang: boolean; readonly reason: string } {
  if (args.state.workerHangFlagged) {
    return { hang: true, reason: "already flagged" };
  }
  const sinceLast = args.now_ms - args.state.lastHeartbeatAtMs;
  if (sinceLast > args.state.heartbeat_timeout_ms) {
    args.state.workerHangFlagged = true;
    return {
      hang: true,
      reason: `no heartbeat for ${sinceLast}ms (timeout ${args.state.heartbeat_timeout_ms}ms)`,
    };
  }
  return { hang: false, reason: "ok" };
}

/**
 * Whether the supervisor's qualification deadline has been
 * hit. Pure function.
 */
export function checkQualificationDeadline(args: {
  readonly state: SupervisorState;
  readonly now_ms: number;
}): { readonly deadline_hit: boolean; readonly reason: string } {
  const elapsed = args.now_ms - args.state.started_at_ms;
  if (elapsed > args.state.qualification_deadline_ms) {
    return {
      deadline_hit: true,
      reason: `elapsed ${elapsed}ms > deadline ${args.state.qualification_deadline_ms}ms`,
    };
  }
  return { deadline_hit: false, reason: "ok" };
}

export { LH06_DEFAULT_HEARTBEAT_TIMEOUT_MS };

/**
 * Build a failure record for a hang.
 */
export function hangFailure(args: {
  readonly state: SupervisorState;
  readonly now_ms: number;
}): LH06FailureRecord {
  return {
    kind: "WORKER_HANG",
    epoch: args.state.lastEpoch,
    last_completed_case: null,
    minimal_diff: {
      last_heartbeat_at_ms: args.state.lastHeartbeatAtMs,
      now_ms: args.now_ms,
      heartbeat_timeout_ms: args.state.heartbeat_timeout_ms,
    },
    message: `worker hang: no heartbeat within ${args.state.heartbeat_timeout_ms}ms`,
  };
}
