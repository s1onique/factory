/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Trust-boundary decoder for the CommittedRunEvent envelope.
 *
 * Per E8, this decoder first snapshots the input through the
 * hardened Phase D JSON snapshotter (snapshotJsonValue). That step
 * guarantees:
 *
 *   - inert owned clone (callers cannot mutate captured storage)
 *   - rejection of Proxy / accessor / symbol / non-enumerable /
 *     exotic-prototype / cyclic / Date / Map / Set / BigInt inputs
 *   - no accessor execution during decode
 *
 * The decoder then verifies the closed-world envelope shape,
 * validates identifiers, validates the sequence number, and lifts
 * the inner event payload via run-decode-payload.ts.
 *
 * Doctrine (E13):
 *
 *   The decoder enforces the run identity binding: every
 *   committed event MUST name the same run_id and the same
 *   subject_id that the manifest declares. A mismatch is rejected
 *   as `identity_mismatch`.
 *
 * Doctrine (E17):
 *
 *   The persisted envelope MUST contain exactly the closed-world
 *   key set. Unknown keys fail closed.
 *
 * This module is pure: no I/O.
 */

import {
  IDENTIFIER_GRAMMAR,
  type SubjectId,
} from "../subject/index.js";

import {
  COMMITTED_RUN_EVENT_KEYS,
  FIRST_SEQUENCE,
  RUN_EVENT_SCHEMA_VERSION,
  makeRunEventId,
  type CommittedRunEvent,
  type RunEventId,
  type RunEventSchemaVersion,
  type RunId,
} from "./run-types.js";

import {
  fail,
  isPlainObject,
  pass,
  rejectUnknownKeys,
  snapshotJsonValue,
  type RunDecodeResult,
} from "./run-decode.js";

import { decodeOwnedRunEventPayload } from "./run-decode-payload.js";

/**
 * Decode a CommittedRunEvent from arbitrary input. The caller
 * supplies the canonical RunId / SubjectId declared by the
 * manifest; the decoder verifies that every persisted event names
 * the same identity and that its sequence begins at FIRST_SEQUENCE.
 *
 * The decoder NEVER throws. Every failure is a typed
 * RunDecodeFailure.
 */
export function decodeRunEventEnvelope(
  input: unknown,
  expectedRunId: RunId,
  expectedSubjectId: SubjectId,
): RunDecodeResult<CommittedRunEvent> {
  try {
    // (1) Snapshot the input through the hardened Phase D boundary.
    //     This rejects Proxy / accessor / cyclic / exotic inputs
    //     BEFORE any further structural validation runs.
    const snap = snapshotJsonValue(input);
    if (!snap.ok) {
      return fail({ kind: "schema_validation", reason: snap.reason });
    }
    const v = snap.value;

    // (2) Top-level object check.
    if (!isPlainObject(v)) {
      return fail({
        kind: "not_an_object",
        reason: "envelope must be a non-null object",
      });
    }

    // (3) Closed-world key check.
    const reasons: string[] = [];
    rejectUnknownKeys(
      v,
      COMMITTED_RUN_EVENT_KEYS as ReadonlyArray<string>,
      reasons,
    );

    // (4) schema_version must be the v1 literal.
    const sv = v["schema_version"];
    if (sv !== RUN_EVENT_SCHEMA_VERSION) {
      return fail({
        kind: "unsupported_schema_version",
        version: typeof sv === "string" ? sv : JSON.stringify(sv),
      });
    }

    // (5) sequence must be a positive integer in the run-local range.
    const seq = v["sequence"];
    if (
      typeof seq !== "number" ||
      !Number.isInteger(seq) ||
      seq < FIRST_SEQUENCE
    ) {
      reasons.push(
        `sequence must be an integer >= ${FIRST_SEQUENCE}; got ${JSON.stringify(seq)}`,
      );
    }

    // (6) observed_at must be a finite number.
    const observedAt = v["observed_at"];
    if (
      typeof observedAt !== "number" ||
      !Number.isFinite(observedAt) ||
      observedAt < 0
    ) {
      reasons.push(
        `observed_at must be a non-negative finite number; got ${JSON.stringify(observedAt)}`,
      );
    }

    // (7) Identity binding (E13): run_id + subject_id MUST match the
    //     manifest-declared values.
    const runIdRaw = v["run_id"];
    if (typeof runIdRaw !== "string") {
      reasons.push("run_id must be a string");
    } else if (!IDENTIFIER_GRAMMAR.test(runIdRaw)) {
      reasons.push("run_id must match IDENTIFIER_GRAMMAR");
    } else if ((runIdRaw as RunId) !== expectedRunId) {
      return fail({
        kind: "identity_mismatch",
        field: "run_id",
        reason:
          `envelope run_id '${runIdRaw}' does not match expected run_id '${expectedRunId}'`,
      });
    }

    const subjectIdRaw = v["subject_id"];
    if (typeof subjectIdRaw !== "string") {
      reasons.push("subject_id must be a string");
    } else if (!IDENTIFIER_GRAMMAR.test(subjectIdRaw)) {
      reasons.push("subject_id must match IDENTIFIER_GRAMMAR");
    } else if ((subjectIdRaw as SubjectId) !== expectedSubjectId) {
      return fail({
        kind: "identity_mismatch",
        field: "subject_id",
        reason:
          `envelope subject_id '${subjectIdRaw}' does not match expected subject_id '${expectedSubjectId}'`,
      });
    }

    // (8) event_id grammar check.
    const eid = v["event_id"];
    if (typeof eid !== "string") {
      reasons.push("event_id must be a string");
    } else if (!IDENTIFIER_GRAMMAR.test(eid)) {
      reasons.push("event_id must match IDENTIFIER_GRAMMAR");
    }

    if (reasons.length > 0) {
      return fail({
        kind: "schema_validation",
        reason: reasons.join("; "),
      });
    }

    // (9) Lift the inner event payload. The envelope has
    //     already snapshotted the whole input, so the inner
    //     `event` is an inert owned value; we route directly
    //     to the owned decoder (no second snapshot).
    const innerRaw = v["event"];
    if (!isPlainObject(innerRaw)) {
      return fail({
        kind: "not_an_object",
        reason: "envelope.event must be an object",
      });
    }
    const payload = decodeOwnedRunEventPayload(innerRaw);
    if (!payload.ok) {
      return payload;
    }

    const envelope: CommittedRunEvent = {
      schema_version: sv as RunEventSchemaVersion,
      event_id: makeRunEventId(eid as string) as RunEventId,
      run_id: (runIdRaw as RunId),
      subject_id: (subjectIdRaw as SubjectId),
      sequence: seq as number,
      event: payload.value,
      observed_at: observedAt as number,
    };
    return pass(envelope);
  } catch {
    return fail({
      kind: "boundary_exception",
      reason: "boundary_exception during envelope decode: opaque thrown value",
    });
  }
}
