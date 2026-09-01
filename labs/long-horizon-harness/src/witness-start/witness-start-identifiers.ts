/**
 * FOUNDATION04 — PHASE A — Identifier-derivation machinery.
 *
 * Extracted from witness-start-types.ts in CORRECTION06
 * to keep that file under the 400-LOC discipline. This
 * module is pure: identity tuple in, branded identifier
 * out. No I/O, no fs, no network.
 *
 * Two identifiers are derived from the same canonical
 * identity tuple, each with a distinct purpose:
 *
 *   CommitId = "w-start:" + sha256("factory:witness-start:commit:v1" || canonical)
 *   EventId  = "w-start-" + sha256("factory:witness-start:event:v1"  || canonical)
 *
 * Both hashes:
 *   - use FULL SHA-256 (no truncation)
 *   - are NUL-separated on the canonical input
 *   - have a distinct DOMAIN TAG so EventId and CommitId
 *     can never collide even for the same identity
 *
 * Doctrine: domain-separated hashes + NUL separators +
 * grammar-valid prefix characters (':' or '-') eliminate
 * every structural ambiguity the previous concatenation
 * form had.
 */
import { createHash } from "node:crypto";

import { makeEventId } from "../domain/ids.js";
import { makeCommitId, type CommitId } from "../ledger-writer/ledger-writer-types.js";
import type { EventId } from "../domain/ids.js";

/**
 * Domain tag for the witness-start CommitId hash input.
 *
 * WHY A DOMAIN TAG: two producers with the same canonical
 * bytes but different meanings must NEVER share a hash.
 * Without a tag, an EventId and a CommitId could collide.
 * The tag is the Factory rule:
 *   - "factory:witness-start:commit:v1"
 *   - "factory:witness-start:event:v1"
 * The colon-separated tag is human-readable and contains
 * only ASCII alphanumerics + ':' (grammar-safe).
 *
 * NOTE: keep these tags STABLE. Changing a tag value
 * invalidates every persisted CommitId/EventId; it is a
 * breaking change. Treat like a wire protocol bump.
 */
export const WSTART_COMMIT_V1_TAG = "factory:witness-start:commit:v1";
export const WSTART_EVENT_V1_TAG = "factory:witness-start:event:v1";

/**
 * Canonical byte representation of a WitnessStartIdentity
 * for hashing. Order MUST match exactly across both
 * identifiers and across versions. Field changes are
 * backward-incompatible: existing dedup keys would not
 * be matched by new hashing.
 *
 * NUL (0x00) separator between fields because NUL is
 * illegal in identifier fields by construction; field
 * boundaries cannot be ambiguous.
 */
export function canonicalWitnessStartIdentity(identity: {
  readonly runId: string;
  readonly missionId: string;
  readonly attemptId: string;
  readonly processId: string;
  readonly witnessId: string;
  readonly witnessInstanceId: string;
}): string {
  return [
    identity.runId,
    identity.missionId,
    identity.attemptId,
    identity.processId,
    identity.witnessId,
    identity.witnessInstanceId,
  ].join("\u0000");
}

/**
 * Canonical CommitId for a witness-start intent.
 *
 *   commitId = "w-start:" + sha256(domain-tag || canonical-identity)
 *
 * Determinism is the contract: same seven-tuple -> same
 * commitId -> writer dedups -> WS11 holds.
 *
 * Why a domain-separated hash:
 *  - the identity tuple contains slash-bearing tokens and
 *    characters outside COMMIT_ID_GRAMMAR (^[A-Za-z0-9_.:-]{1,128}$).
 *    Embedding them directly would be rejected at the wire
 *    boundary by the frozen B0 validator (P1#5).
 *  - the FULL identity tuple is hashed so a regression that
 *    drops a field changes the CommitId (CID05).
 *  - missionId IS included — the writer's envelope records
 *    missionId, but the CommitId is the dedup key, and
 *    omitting missionId would let two different missions
 *    share a slot. (CORRECTION05: previous implementation
 *    left missionId out.)
 *
 * The namespace prefix "w-start:" is reserved for
 * witness-start intents. No other code path mints commitIds
 * in this namespace.
 *
 * Branded as `CommitId` so the grammar check runs at
 * construction time, not at the wire boundary (P1#5).
 */
export function computeWitnessStartCommitId(identity: {
  readonly runId: string;
  readonly missionId: string;
  readonly attemptId: string;
  readonly processId: string;
  readonly witnessId: string;
  readonly witnessInstanceId: string;
}): CommitId {
  return makeCommitId(
    "w-start:" +
      createHash("sha256")
        .update(WSTART_COMMIT_V1_TAG + "\u0000", "utf8")
        .update(canonicalWitnessStartIdentity(identity), "utf8")
        .digest("hex"),
  );
}

/**
 * Derive a grammar-valid EventId for a witness_start_requested
 * intent.
 *
 *   eventId = "w-start-" + sha256(domain-tag || canonical-identity)
 *
 * Why a hash:
 *   - the canonical identity tuple contains slash-bearing
 *     tokens; embedding it directly would violate
 *     IDENTIFIER_GRAMMAR (no slashes allowed)
 *
 * Why a domain tag (CORRECTION05):
 *   - the EventId and the CommitId MUST NEVER collide even
 *     when derived from the same identity. Domain-separated
 *     input ensures distinct hashes.
 *
 * Why a NUL separator (CORRECTION05):
 *   - "a/b" + "c" and "a" + "b/c" use the same tokens but
 *     have different meanings. A NUL (0x00) separator
 *     eliminates field-collision ambiguity — NUL is illegal
 *     in identifier fields by construction.
 *
 * Why the full SHA-256 digest (64 hex chars):
 *   - deterministic from the identity
 *   - bounded (≤72 chars total: "w-start-" + 64 hex),
 *     comfortably under IDENTIFIER_GRAMMAR's 128-char cap
 *   - uses only ASCII alphanumerics + hyphen (grammar-clean)
 *   - 256 bits is meaningfully stronger than any prefix
 *     we could truncate to; identity uniqueness is not
 *     justified by truncating when we have the budget
 *
 * Note: EventId is informational. The writer's seq is the
 * authoritative ordering key. EventId uniqueness is for
 * observability only; same identity -> same EventId ->
 * writers and readers can dedup or cross-reference.
 */
export function makeEventIdFromIdentity(identity: {
  readonly runId: string;
  readonly missionId: string;
  readonly attemptId: string;
  readonly processId: string;
  readonly witnessId: string;
  readonly witnessInstanceId: string;
}): EventId {
  const hex = createHash("sha256")
    .update(WSTART_EVENT_V1_TAG + "\u0000", "utf8")
    .update(canonicalWitnessStartIdentity(identity), "utf8")
    .digest("hex");
  return makeEventId("w-start-" + hex);
}
