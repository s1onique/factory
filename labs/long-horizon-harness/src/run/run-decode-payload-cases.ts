/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Per-case RunEvent payload decoders for the non-terminal event
 * variants. Split out from run-decode-payload.ts to keep the main
 * entry file under the SOURCE_SIZE_DISCIPLINE 400-LOC ceiling.
 *
 * Doctrine: each decoder owns ONE event variant. The dispatcher
 * (decodeSpecificPayload in run-decode-payload.ts) routes to the
 * right decoder. The decoders share helpers from
 * run-decode-payload-helpers.ts.
 *
 * This module is pure: no I/O.
 */

import {
  makeAttemptId,
  makeGateId,
  makeRepairCycleId,
  makeReviewCycleId,
  type ActionStatus,
  type Failure,
  type RunEvent,
  ACTION_STARTED_KEYS,
  ACTION_FINISHED_KEYS,
  GATE_STARTED_KEYS,
  GATE_FINISHED_KEYS,
  REPAIR_STARTED_KEYS,
  REPAIR_FINISHED_KEYS,
  REVIEW_STARTED_KEYS,
  REVIEW_FINISHED_KEYS,
} from "./run-types.js";

import { decodeFailure } from "../evidence/codec-decode-failure.js";
import type { InvalidEvidence } from "../domain/failure.js";

import {
  fail,
  isPlainObject,
  pass,
  rejectUnknownKeys,
  type RunDecodeFailure,
  type RunDecodeResult,
} from "./run-decode.js";

import {
  decodeActionTarget,
  decodeIdentifierString,
} from "./run-decode-payload-helpers.js";

function evidenceToRunFailure(e: InvalidEvidence): RunDecodeFailure {
  return { kind: "schema_validation", reason: e.reason };
}

export function decodeActionStarted(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    ACTION_STARTED_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const target = decodeActionTarget(value["target"], reasons);
  if (target === null) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  let atMs: number | undefined;
  if (value["at_ms"] !== undefined) {
    if (
      typeof value["at_ms"] !== "number" ||
      !Number.isFinite(value["at_ms"]) ||
      (value["at_ms"] as number) < 0
    ) {
      reasons.push("ACTION_STARTED.at_ms must be a non-negative finite number when present");
    } else {
      atMs = value["at_ms"] as number;
    }
  }
  if (reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "ACTION_STARTED",
    target,
    ...(atMs !== undefined ? { at_ms: atMs } : {}),
  } as RunEvent);
}

export function decodeActionFinished(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    ACTION_FINISHED_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const target = decodeActionTarget(value["target"], reasons);
  if (target === null) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  const status = value["status"];
  if (status !== "OK" && status !== "ERROR") {
    reasons.push("ACTION_FINISHED.status must be OK or ERROR");
  }
  let failure: Failure | undefined;
  if (value["failure"] !== undefined) {
    if (!isPlainObject(value["failure"])) {
      reasons.push("ACTION_FINISHED.failure must be an object when present");
    } else {
      // E-C13: route the parent record + field name so
      // decodeFailure can look up the value via `parent[field]`
      // (matches the API used everywhere else in the codec).
      const fr = decodeFailure(value, "failure");
      if (!fr.ok) {
        return fail(evidenceToRunFailure(fr.error));
      }
      failure = fr.value as Failure;
    }
  }
  if (reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "ACTION_FINISHED",
    target,
    status: status as ActionStatus,
    ...(failure !== undefined ? { failure } : {}),
  } as RunEvent);
}

export function decodeGateStarted(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    GATE_STARTED_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const gateId = decodeIdentifierString<ReturnType<typeof makeGateId>>(
    value["gate_id"],
    "gate_id",
    makeGateId,
    reasons,
  );
  const attemptId = decodeIdentifierString<ReturnType<typeof makeAttemptId>>(
    value["attempt_id"],
    "attempt_id",
    makeAttemptId,
    reasons,
  );
  if (!gateId || !attemptId || reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "GATE_STARTED",
    gate_id: gateId,
    attempt_id: attemptId,
  });
}

export function decodeGateFinished(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    GATE_FINISHED_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const gateId = decodeIdentifierString<ReturnType<typeof makeGateId>>(
    value["gate_id"],
    "gate_id",
    makeGateId,
    reasons,
  );
  const attemptId = decodeIdentifierString<ReturnType<typeof makeAttemptId>>(
    value["attempt_id"],
    "attempt_id",
    makeAttemptId,
    reasons,
  );
  const passVal = value["pass"];
  if (typeof passVal !== "boolean") {
    reasons.push("GATE_FINISHED.pass must be a boolean");
  }
  let reasonVal: string | undefined;
  if (value["reason"] !== undefined) {
    if (typeof value["reason"] !== "string") {
      reasons.push("GATE_FINISHED.reason must be a string when present");
    } else {
      reasonVal = value["reason"] as string;
    }
  }
  if (!gateId || !attemptId || reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "GATE_FINISHED",
    gate_id: gateId,
    attempt_id: attemptId,
    pass: passVal as boolean,
    ...(reasonVal !== undefined ? { reason: reasonVal } : {}),
  });
}

export function decodeRepairStarted(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    REPAIR_STARTED_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const repairId = decodeIdentifierString<ReturnType<typeof makeRepairCycleId>>(
    value["repair_id"],
    "repair_id",
    makeRepairCycleId,
    reasons,
  );
  const reasonVal = value["reason"];
  if (typeof reasonVal !== "string" || reasonVal.length === 0) {
    reasons.push("REPAIR_STARTED.reason must be a non-empty string");
  }
  if (!repairId || reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "REPAIR_STARTED",
    repair_id: repairId,
    reason: reasonVal as string,
  });
}

export function decodeRepairFinished(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    REPAIR_FINISHED_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const repairId = decodeIdentifierString<ReturnType<typeof makeRepairCycleId>>(
    value["repair_id"],
    "repair_id",
    makeRepairCycleId,
    reasons,
  );
  if (!repairId || reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "REPAIR_FINISHED",
    repair_id: repairId,
  });
}

export function decodeReviewStarted(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    REVIEW_STARTED_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const reviewId = decodeIdentifierString<ReturnType<typeof makeReviewCycleId>>(
    value["review_id"],
    "review_id",
    makeReviewCycleId,
    reasons,
  );
  if (!reviewId || reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "REVIEW_STARTED",
    review_id: reviewId,
  });
}

export function decodeReviewFinished(
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  rejectUnknownKeys(
    value,
    REVIEW_FINISHED_KEYS as ReadonlyArray<string>,
    reasons,
  );
  const reviewId = decodeIdentifierString<ReturnType<typeof makeReviewCycleId>>(
    value["review_id"],
    "review_id",
    makeReviewCycleId,
    reasons,
  );
  const passVal = value["pass"];
  if (typeof passVal !== "boolean") {
    reasons.push("REVIEW_FINISHED.pass must be a boolean");
  }
  let reasonVal: string | undefined;
  if (value["reason"] !== undefined) {
    if (typeof value["reason"] !== "string") {
      reasons.push("REVIEW_FINISHED.reason must be a string when present");
    } else {
      reasonVal = value["reason"] as string;
    }
  }
  if (!reviewId || reasons.length > 0) {
    return fail({ kind: "schema_validation", reason: reasons.join("; ") });
  }
  return pass({
    type: "REVIEW_FINISHED",
    review_id: reviewId,
    pass: passVal as boolean,
    ...(reasonVal !== undefined ? { reason: reasonVal } : {}),
  });
}
