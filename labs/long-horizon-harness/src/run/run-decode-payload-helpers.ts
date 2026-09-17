/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Shared payload decoder helpers + terminal-event decoders. Split
 * out from run-decode-payload.ts so the main entry file stays
 * under the SOURCE_SIZE_DISCIPLINE 400-LOC ceiling.
 *
 * Doctrine: same as run-decode-payload.ts. The decoder NEVER
 * throws; every failure is a typed RunDecodeFailure.
 *
 * This module is pure: no I/O.
 */

import {
  IDENTIFIER_GRAMMAR,
} from "../subject/index.js";

import {
  isTerminalSemantic,
  makeAttemptId,
  type ActionTarget,
  type AgentSelfReport,
  type ResourceObservation,
  type RunEvent,
  type TerminalSemantic,
  AGENT_SELF_REPORT_KEYS,
  RESOURCE_OBSERVATION_KEYS,
  ACTION_TARGET_KEYS,
  RUN_CANCEL_REQUESTED_KEYS,
  RUN_TIMEOUT_KEYS,
  RUN_FINISHED_KEYS,
  RUN_ABORTED_KEYS,
} from "./run-types.js";

import {
  fail,
  isPlainObject,
  pass,
  rejectUnknownKeys,
  type RunDecodeResult,
} from "./run-decode.js";

// ---------------------------------------------------------------------------
// Terminal event decoders
// ---------------------------------------------------------------------------

export function decodeRunCancelRequested(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    RUN_CANCEL_REQUESTED_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const semantic = decodeTerminalSemantic(value["semantic"], reasons);
  let reasonVal: string | undefined;
  if (value["reason"] !== undefined) {
    if (typeof value["reason"] !== "string") {
      reasons.push("RUN_CANCEL_REQUESTED.reason must be a string when present");
    } else {
      reasonVal = value["reason"] as string;
    }
  }
  if (!semantic || reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "RUN_CANCEL_REQUESTED",
    semantic,
    ...(reasonVal !== undefined ? { reason: reasonVal } : {}),
  });
}

export function decodeRunTimeout(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    RUN_TIMEOUT_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const semantic = decodeTerminalSemantic(value["semantic"], reasons);
  const obs = decodeResourceObservation(value["observation"], reasons);
  if (!semantic || !obs || reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "RUN_TIMEOUT",
    semantic,
    observation: obs,
  });
}

export function decodeRunFinished(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    RUN_FINISHED_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const semantic = decodeTerminalSemantic(value["semantic"], reasons);
  let agent: AgentSelfReport | undefined;
  if (value["agent_report"] !== undefined) {
    const ar = decodeAgentSelfReport(value["agent_report"], reasons);
    if (ar === null) {
      return fail({
        kind: "schema_validation",
        reason: reasons.join("; "),
      });
    }
    agent = ar;
  }
  if (!semantic || reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "RUN_FINISHED",
    semantic,
    ...(agent !== undefined ? { agent_report: agent } : {}),
  });
}

export function decodeRunAborted(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    RUN_ABORTED_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const semantic = decodeTerminalSemantic(value["semantic"], reasons);
  const reasonVal = value["reason"];
  if (typeof reasonVal !== "string" || reasonVal.length === 0) {
    reasons.push("RUN_ABORTED.reason must be a non-empty string");
  }
  if (!semantic || reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "RUN_ABORTED",
    semantic,
    reason: reasonVal as string,
  });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function decodeActionTarget(
  raw: unknown,
  reasons: string[],
): ActionTarget | null {
  if (!isPlainObject(raw)) {
    reasons.push("target must be an object");
    return null;
  }
  rejectUnknownKeys(
    raw,
    ACTION_TARGET_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const kind = raw["kind"];
  if (kind !== "attempt") {
    reasons.push("target.kind must be 'attempt'");
    return null;
  }
  const aid = raw["attempt_id"];
  if (typeof aid !== "string" || !IDENTIFIER_GRAMMAR.test(aid)) {
    reasons.push("target.attempt_id must match IDENTIFIER_GRAMMAR");
    return null;
  }
  return { kind: "attempt", attempt_id: makeAttemptId(aid) };
}

export function decodeIdentifierString<T extends string>(
  raw: unknown,
  field: string,
  ctor: (s: string) => T,
  reasons: string[],
): T | null {
  if (typeof raw !== "string") {
    reasons.push(`${field} must be a string`);
    return null;
  }
  if (!IDENTIFIER_GRAMMAR.test(raw)) {
    reasons.push(`${field} must match IDENTIFIER_GRAMMAR`);
    return null;
  }
  return ctor(raw);
}

export function decodeTerminalSemantic(
  raw: unknown,
  reasons: string[],
): TerminalSemantic | null {
  if (typeof raw !== "string" || !isTerminalSemantic(raw)) {
    reasons.push("semantic must be a TerminalSemantic value");
    return null;
  }
  return raw;
}

export function decodeResourceObservation(
  raw: unknown,
  reasons: string[],
): ResourceObservation | null {
  if (!isPlainObject(raw)) {
    reasons.push("observation must be an object");
    return null;
  }
  rejectUnknownKeys(
    raw,
    RESOURCE_OBSERVATION_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const kind = raw["kind"];
  const validKinds = [
    "wall_clock_ms",
    "tokens",
    "tool_calls",
    "process_count",
  ];
  if (typeof kind !== "string" || !validKinds.includes(kind)) {
    reasons.push(
      `observation.kind must be one of ${validKinds.join("|")}`,
    );
    return null;
  }
  const observed = raw["observed"];
  if (
    typeof observed !== "number" ||
    !Number.isFinite(observed) ||
    observed < 0
  ) {
    reasons.push("observation.observed must be a non-negative finite number");
    return null;
  }
  return {
    kind: kind as ResourceObservation["kind"],
    observed,
  };
}

export function decodeAgentSelfReport(
  raw: unknown,
  reasons: string[],
): AgentSelfReport | null {
  if (!isPlainObject(raw)) {
    reasons.push("agent_report must be an object");
    return null;
  }
  rejectUnknownKeys(
    raw,
    AGENT_SELF_REPORT_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const message = raw["message"];
  if (typeof message !== "string" || message.length === 0) {
    reasons.push("agent_report.message must be a non-empty string");
    return null;
  }
  let claimed: string | undefined;
  if (raw["claimed"] !== undefined) {
    if (typeof raw["claimed"] !== "string") {
      reasons.push("agent_report.claimed must be a string when present");
      return null;
    }
    claimed = raw["claimed"] as string;
  }
  return {
    message,
    ...(claimed !== undefined ? { claimed } : {}),
  };
}
