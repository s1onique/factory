/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * RunEvent payload encoder. Splits the RunEvent union into a
 * deterministic JsonValue tree. Split out from run-serialize.ts
 * so the main file stays under the SOURCE_SIZE_DISCIPLINE 400-LOC
 * ceiling.
 *
 * Doctrine: same as run-serialize.ts. The encoder NEVER consults
 * the wall clock; it is pure.
 *
 * This module is pure: no I/O.
 */

import type { JsonObject, JsonValue } from "./run-json.js";
import type { RunEvent } from "./run-types.js";

function jsonObject(
  obj: { readonly [key: string]: JsonValue | undefined },
): JsonObject {
  const out: { [key: string]: JsonValue } = {};
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function targetJson(
  t: { kind: string; attempt_id: string },
): JsonObject {
  return { attempt_id: t.attempt_id, kind: t.kind };
}

export function encodeRunEvent(event: RunEvent): JsonValue {
  switch (event.type) {
    case "RUN_STARTED":
    case "HARNESS_STARTED":
    case "HARNESS_STOPPED":
      return { type: event.type };
    case "ACTION_STARTED":
      return jsonObject({
        attempt_id: undefined,
        at_ms: typeof event.at_ms === "number" ? event.at_ms : undefined,
        target: targetJson(event.target),
        type: event.type,
      });
    case "ACTION_FINISHED":
      return jsonObject({
        failure:
          event.failure === undefined
            ? undefined
            : (event.failure as unknown as JsonValue),
        status: event.status,
        target: targetJson(event.target),
        type: event.type,
      });
    case "GATE_STARTED":
      return jsonObject({
        attempt_id: event.attempt_id,
        gate_id: event.gate_id,
        type: event.type,
      });
    case "GATE_FINISHED":
      return jsonObject({
        attempt_id: event.attempt_id,
        gate_id: event.gate_id,
        pass: event.pass,
        reason: event.reason,
        type: event.type,
      });
    case "REPAIR_STARTED":
      return jsonObject({
        reason: event.reason,
        repair_id: event.repair_id,
        type: event.type,
      });
    case "REPAIR_FINISHED":
      return jsonObject({
        repair_id: event.repair_id,
        type: event.type,
      });
    case "REVIEW_STARTED":
      return jsonObject({
        review_id: event.review_id,
        type: event.type,
      });
    case "REVIEW_FINISHED":
      return jsonObject({
        pass: event.pass,
        reason: event.reason,
        review_id: event.review_id,
        type: event.type,
      });
    case "RUN_CANCEL_REQUESTED":
      // E-C08: RUN_CANCEL_REQUESTED is NON-TERMINAL and carries
      // only an optional reason. The encoder MUST NOT emit a
      // `semantic` field.
      return jsonObject({
        reason: event.reason,
        type: event.type,
      });
    case "RUN_TIMEOUT":
      return jsonObject({
        observation: event.observation as unknown as JsonValue,
        semantic: event.semantic,
        type: event.type,
      });
    case "RUN_FINISHED":
      return jsonObject({
        agent_report:
          event.agent_report === undefined
            ? undefined
            : (event.agent_report as unknown as JsonValue),
        semantic: event.semantic,
        type: event.type,
      });
    case "RUN_ABORTED":
      return jsonObject({
        reason: event.reason,
        semantic: event.semantic,
        type: event.type,
      });
  }
}
