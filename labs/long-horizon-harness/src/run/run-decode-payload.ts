/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Closed-world structural decoder for the RunEvent payload union.
 *
 * Doctrine (E13, E5):
 *
 *   The decoder lifts an untrusted inner `event` object into a
 *   typed RunEvent by:
 *
 *     1. Verifying the payload is a plain object.
 *     2. Reading the `type` discriminator and verifying it is one
 *        of the closed-world event types.
 *     3. For each variant, applying a closed-world key check (no
 *        unknown fields) and per-field validators.
 *     4. Composing the typed RunEvent.
 *
 *   The decoder NEVER throws. Every failure is a typed
 *   RunDecodeFailure.
 *
 * Trust-boundary (E-C04):
 *
 *   The PUBLIC entry point `decodeRunEventPayload` snapshots the
 *   input through the hardened Phase D boundary BEFORE any
 *   structural read; the snapshotter may fire `Reflect.ownKeys`
 *   and `getOwnPropertyDescriptor` traps as part of the
 *   defensive structural boundary, but the raw caller graph is
 *   never observed via [[Get]], accessor execution, or any
 *   downstream consumer (canonicalization, EventIdSource,
 *   idempotency-content lookup). Proxy / accessor / exotic
 *   inputs are rejected at that snapshot boundary. The internal
 *   helper `decodeOwnedRunEventPayload` is reachable only from
 *   inside the already-snapshotted envelope decoder, where its
 *   arguments are guaranteed to be inert owned data.
 *
 * This module is pure: no I/O.
 */

import { isRunEventType, type RunEvent } from "./run-types.js";

import {
  fail,
  isPlainObject,
  pass,
  rejectUnknownKeys,
  snapshotJsonValue,
  type RunDecodeResult,
} from "./run-decode.js";

import {
  decodeActionStarted,
  decodeActionFinished,
  decodeGateStarted,
  decodeGateFinished,
  decodeRepairStarted,
  decodeRepairFinished,
  decodeReviewStarted,
  decodeReviewFinished,
} from "./run-decode-payload-cases.js";

import {
  decodeRunAborted,
  decodeRunCancelRequested,
  decodeRunFinished,
  decodeRunTimeout,
} from "./run-decode-payload-helpers.js";

/**
 * Public hostile-input decoder for the RunEvent payload.
 *
 * Routes the input through the hardened Phase D snapshotter
 * first, then delegates to the owned-value structural decoder.
 * No structural read in the dispatch path may ever invoke a
 * caller-controlled `[[Get]]` or accessor execution. The
 * snapshotter may invoke `Reflect.ownKeys` /
 * `getOwnPropertyDescriptor` traps as part of the defensive
 * structural boundary; those are bounded and fail-closed.
 */
export function decodeRunEventPayload(
  value: unknown,
): RunDecodeResult<RunEvent> {
  try {
    // (1) Snapshot arbitrary input BEFORE any structural read.
    const snap = snapshotJsonValue(value);
    if (!snap.ok) {
      return fail({ kind: "schema_validation", reason: snap.reason });
    }
    const owned = snap.value;
    if (!isPlainObject(owned)) {
      return fail({
        kind: "not_an_object",
        reason: "event payload must be an object",
      });
    }
    return decodeOwnedRunEventPayload(owned);
  } catch {
    return fail({
      kind: "boundary_exception",
      reason: "boundary_exception during payload decode: opaque thrown value",
    });
  }
}

/**
 * Internal structural decoder for an ALREADY-SNAPSHOTTED
 * payload object. NOT a hostile-input boundary. Called from
 * decodeRunEventPayload (after snapshotting) and from
 * decodeRunEventEnvelope (which has already snapshotted the
 * whole envelope input).
 */
export function decodeOwnedRunEventPayload(
  value: Record<string, unknown>,
): RunDecodeResult<RunEvent> {
  const reasons: string[] = [];
  try {
    const t = value["type"];
    if (typeof t !== "string" || !isRunEventType(t)) {
      reasons.push(`unknown event_type '${String(t)}'`);
      return fail({
        kind: "schema_validation",
        reason: reasons.join("; "),
      });
    }
    switch (t) {
      case "RUN_STARTED":
      case "HARNESS_STARTED":
      case "HARNESS_STOPPED":
        rejectUnknownKeys(
          value,
          ["type"] as ReadonlyArray<string>,
          reasons,
        );
        if (reasons.length > 0) {
          return fail({ kind: "schema_validation", reason: reasons.join("; ") });
        }
        return pass({ type: t });
      // remaining cases delegated to case-specific helpers below
    }
    return decodeSpecificPayload(t, value, reasons);
  } catch {
    return fail({
      kind: "boundary_exception",
      reason: "boundary_exception during payload decode: opaque thrown value",
    });
  }
}

function decodeSpecificPayload(
  t: string,
  value: Record<string, unknown>,
  reasons: string[],
): RunDecodeResult<RunEvent> {
  switch (t) {
    case "ACTION_STARTED":
      return decodeActionStarted(value, reasons);
    case "ACTION_FINISHED":
      return decodeActionFinished(value, reasons);
    case "GATE_STARTED":
      return decodeGateStarted(value, reasons);
    case "GATE_FINISHED":
      return decodeGateFinished(value, reasons);
    case "REPAIR_STARTED":
      return decodeRepairStarted(value, reasons);
    case "REPAIR_FINISHED":
      return decodeRepairFinished(value, reasons);
    case "REVIEW_STARTED":
      return decodeReviewStarted(value, reasons);
    case "REVIEW_FINISHED":
      return decodeReviewFinished(value, reasons);
    case "RUN_CANCEL_REQUESTED":
      return decodeRunCancelRequested(value, reasons);
    case "RUN_TIMEOUT":
      return decodeRunTimeout(value, reasons);
    case "RUN_FINISHED":
      return decodeRunFinished(value, reasons);
    case "RUN_ABORTED":
      return decodeRunAborted(value, reasons);
    default:
      return fail({
        kind: "schema_validation",
        reason: `unknown event_type '${t}'`,
      });
  }
}
