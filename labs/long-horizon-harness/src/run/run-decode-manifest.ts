/**
 * FOUNDATION04 — PHASE E — Run / Evidence Contract.
 *
 * Decoder for the RunManifest. The decoder:
 *
 *   1. Validates the input is a plain object.
 *   2. Rejects unknown top-level keys (closed-world).
 *   3. Validates `schema_version` is the v1 literal.
 *   4. Validates `subject_id` matches the caller-supplied
 *      expected SubjectId (caller is responsible for the Phase D
 *      decode of the SubjectManifest).
 *   5. Validates `repetition.index` is a non-negative integer.
 *   6. Re-derives the RunId via computeRunId and verifies it
 *      matches the supplied run_id field.
 *
 * Doctrine (E2):
 *
 *   RunId is content-bound. The decoder does not let the caller
 *   supply an arbitrary run_id; it derives one from the manifest
 *   content and rejects mismatches.
 *
 * This module is pure: no I/O.
 */

import {
  IDENTIFIER_GRAMMAR,
  type SubjectId,
} from "../subject/index.js";

import {
  computeRunId,
  RUN_MANIFEST_KEYS,
  RUN_MANIFEST_SCHEMA_VERSION,
  RUN_REPETITION_KEYS,
  type RunManifest,
  type RunManifestSchemaVersion,
  type RunRepetition,
} from "./run-types.js";
import {
  fail,
  isPlainObject,
  pass,
  rejectUnknownKeys,
  snapshotJsonValue,
  type RunDecodeResult,
} from "./run-decode.js";

/**
 * Decode a RunManifest. The caller must supply the canonical
 * SubjectId that the manifest references; the decoder validates
 * the structural shape AND that the (subject_id, schema_version,
 * repetition) tuple yields the supplied run_id.
 *
 * Trust-boundary (E-C04):
 *
 *   The decoder is an INERT hostile-input boundary. Before any
 *   structural read the input is routed through the hardened
 *   Phase D snapshotter (snapshotJsonValue). This guarantees:
 *
 *     - Proxy / accessor / exotic-prototype / cyclic inputs are
 *       rejected before any [[Get]], accessor execution,
 *       canonicalization, EventId generation, or
 *       idempotency-content lookup can observe the raw caller
 *       graph. The snapshotter may invoke `Reflect.ownKeys` /
 *       `getOwnPropertyDescriptor` traps as part of the
 *       defensive structural boundary; those are bounded and
 *       fail-closed.
 *     - The structural reads that follow operate on owned,
 *       plain-object data with no side effects on the caller.
 *
 * The decoder NEVER throws. Every failure is a typed
 * RunDecodeFailure.
 *
 * The decoder does NOT itself decode the SubjectManifest; the
 * caller is expected to have done so already via the Phase D
 * decoder and to pass the canonical SubjectId. This module just
 * verifies the SubjectId string is well-formed and matches the
 * declared run.
 */
export function decodeRunManifest(
  input: unknown,
  expectedSubjectId: SubjectId,
): RunDecodeResult<RunManifest> {
  try {
    // (1) Snapshot the input through the hardened Phase D boundary.
    //     This rejects Proxy / accessor / cyclic / exotic inputs
    //     BEFORE any further structural validation runs. No
    //     structural read here can ever invoke a caller-controlled
    //     [[Get]] or accessor execution; `ownKeys` /
    //     `getOwnPropertyDescriptor` traps may fire as part of the
    //     defensive boundary but are bounded and fail-closed.
    const snap = snapshotJsonValue(input);
    if (!snap.ok) {
      return fail({ kind: "schema_validation", reason: snap.reason });
    }
    const owned = snap.value;
    if (!isPlainObject(owned)) {
      return fail({ kind: "not_an_object", reason: "manifest must be an object" });
    }
    return decodeOwnedRunManifest(owned, expectedSubjectId);
  } catch {
    return fail({
      kind: "boundary_exception",
      reason: "boundary_exception during manifest decode: opaque thrown value",
    });
  }
}

/**
 * Internal structural decoder for an ALREADY-SNAPSHOTTED manifest.
 *
 * This function is NOT a hostile-input boundary. It is only safe
 * to call after the input has been passed through the hardened
 * snapshotter. The public entry point `decodeRunManifest`
 * performs the snapshot and routes the inert owned value to
 * this helper.
 */
function decodeOwnedRunManifest(
  input: Record<string, unknown>,
  expectedSubjectId: SubjectId,
): RunDecodeResult<RunManifest> {
  try {
    // (Structural reads on inert owned data only.)
    const reasons: string[] = [];
    rejectUnknownKeys(input, RUN_MANIFEST_KEYS as ReadonlyArray<string>, reasons);

    const sv = input["schema_version"];
    if (sv !== RUN_MANIFEST_SCHEMA_VERSION) {
      reasons.push(
        `schema_version must be ${RUN_MANIFEST_SCHEMA_VERSION}; got ${JSON.stringify(sv)}`,
      );
    }
    if (typeof expectedSubjectId !== "string") {
      reasons.push("expectedSubjectId must be a string");
    } else if (!IDENTIFIER_GRAMMAR.test(expectedSubjectId)) {
      reasons.push("expectedSubjectId must match IDENTIFIER_GRAMMAR");
    }
    const subjectIdField = input["subject_id"];
    if (typeof subjectIdField !== "string") {
      reasons.push("subject_id must be a string");
    } else if (!IDENTIFIER_GRAMMAR.test(subjectIdField)) {
      reasons.push("subject_id must match IDENTIFIER_GRAMMAR");
    } else if (subjectIdField !== expectedSubjectId) {
      return fail({
        kind: "identity_mismatch",
        field: "subject_id",
        reason:
          `manifest subject_id '${subjectIdField}' does not match expected subject '${expectedSubjectId}'`,
      });
    }

    const repetitionRaw = input["repetition"];
    if (!isPlainObject(repetitionRaw)) {
      reasons.push("repetition must be an object");
    }
    const repReasons: string[] = [];
    let repetition: RunRepetition | null = null;
    if (isPlainObject(repetitionRaw)) {
      rejectUnknownKeys(
        repetitionRaw,
        RUN_REPETITION_KEYS as ReadonlyArray<string>,
        repReasons,
      );
      const idx = repetitionRaw["index"];
      if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) {
        repReasons.push("repetition.index must be a non-negative integer");
      }
      const seed = repetitionRaw["seed"];
      if (seed !== undefined && typeof seed !== "string") {
        repReasons.push("repetition.seed must be a string when present");
      }
      if (repReasons.length === 0) {
        repetition = {
          index: idx,
          ...(seed !== undefined ? { seed } : {}),
        } as RunRepetition;
      } else {
        reasons.push(...repReasons);
      }
    }

    const runProtocol = input["run_protocol_version"];
    if (typeof runProtocol !== "string" || runProtocol.length === 0) {
      reasons.push("run_protocol_version must be a non-empty string");
    }
    const runnerRev = input["runner_revision"];
    if (typeof runnerRev !== "string" || runnerRev.length === 0) {
      reasons.push("runner_revision must be a non-empty string");
    }
    const startedBy = input["started_by"];
    if (typeof startedBy !== "string" || startedBy.length === 0) {
      reasons.push("started_by must be a non-empty string");
    }
    const createdAt = input["created_at"];
    if (
      typeof createdAt !== "number" ||
      !Number.isFinite(createdAt) ||
      createdAt < 0
    ) {
      reasons.push("created_at must be a non-negative finite number");
    }

    if (reasons.length > 0) {
      return fail({
        kind: "schema_validation",
        reason: reasons.join("; "),
      });
    }

    // Compute the content-bound RunId from the manifest material.
    const derived = computeRunId({
      subjectId: expectedSubjectId,
      runSchemaVersion: sv as RunManifestSchemaVersion,
      repetition: repetition as RunRepetition,
    });
    const suppliedRunId = input["run_id"];
    if (typeof suppliedRunId !== "string") {
      return fail({
        kind: "schema_validation",
        reason: "run_id must be a string",
      });
    }
    if (!IDENTIFIER_GRAMMAR.test(suppliedRunId)) {
      return fail({
        kind: "schema_validation",
        reason: "run_id must match IDENTIFIER_GRAMMAR",
      });
    }
    if (suppliedRunId !== derived) {
      return fail({
        kind: "identity_mismatch",
        field: "run_id",
        reason:
          `supplied run_id '${suppliedRunId}' does not match content-derived run_id '${derived}'`,
      });
    }

    const manifest: RunManifest = {
      schema_version: sv as RunManifestSchemaVersion,
      run_id: derived,
      subject_id: expectedSubjectId,
      run_protocol_version: runProtocol as string,
      runner_revision: runnerRev as string,
      started_by: startedBy as string,
      created_at: createdAt as number,
      repetition: repetition as RunRepetition,
    };
    return pass(manifest);
  } catch {
    return fail({
      kind: "boundary_exception",
      reason: "boundary_exception during manifest decode: opaque thrown value",
    });
  }
}
