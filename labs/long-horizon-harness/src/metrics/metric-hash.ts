/**
 * FOUNDATION04 — LH-02 — Convergence Metric Contract.
 *
 * Pure derivation of `run_evidence_hash` (M17).
 *
 * Doctrine (M17):
 *   "Recommended: run_evidence_hash, computed over the
 *    canonical Phase E evidence stream. This gives a
 *    deterministic binding:
 *
 *      METRIC_REPORT
 *      ↔
 *      EXACT_RUN_EVIDENCE
 *
 *    If adding the evidence hash would require altering
 *    frozen Phase E semantics, compute it purely in LH-02
 *    over Phase E canonical serialization."
 *
 * Implementation choice: LH-02 reuses Phase E's existing
 * `deterministicJson` (the canonical-content encoder from
 * `run-serialize.ts`). LH-02 builds a canonical
 * representation of the ordered event stream in a way that
 * does NOT require Phase E to expose a new API. The hash is
 * a sha-256 hex of that canonical bytes string.
 *
 * This module is pure: no I/O beyond `node:crypto`.
 */

import { createHash } from "node:crypto";

import type { CommittedRunEvent } from "../run/run-types.js";
import { deterministicJson } from "../run/run-serialize.js";

/**
 * Hash the ordered Phase E evidence stream into a sha-256
 * hex digest. Same input -> same hash. The encoder is
 * recursive and key-order independent (per Phase E E-C10).
 *
 * Note: we hash the canonical JSON representation (a string),
 * then hash the UTF-8 bytes of that string. The result is
 * hex-encoded by `crypto.createHash(...).digest("hex")`.
 *
 * We do not depend on Phase E exporting a new "hash" entry
 * point; doing so would either modify frozen Phase E or
 * introduce a parallel canonicalization authority.
 */
export function deriveRunEvidenceHash(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): string {
  const canonical = canonicalEvidenceString(orderedEvents);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Serialize the ordered Phase E evidence stream to a stable
 * canonical string using Phase E's `deterministicJson`
 * encoder. Each event is rendered through its existing
 * closed-world payload schema (no parallel canonicalization).
 *
 * The result is structurally identical to repeated
 * encoding of `encodeRunEventEnvelope(event)` separated by
 * a fixed delimiter. LH-02 chooses the delimiter so that
 * the bytes are unambiguous even when an event's own
 * canonical JSON contains a newline / separator-like
 * pattern. We pick `\u0000` because it cannot legitimately
 * appear in the closed-world Phase E schema fields.
 */
function canonicalEvidenceString(
  orderedEvents: ReadonlyArray<CommittedRunEvent>,
): string {
  let out = "";
  let first = true;
  for (const e of orderedEvents) {
    if (!first) out += "\u0000";
    first = false;
    out += eventToCanonical(e);
  }
  return out;
}

/**
 * Render a single `CommittedRunEvent` as a canonical JSON
 * object using Phase E's `deterministicJson` encoder. We
 * deliberately include the committed envelope's own
 * `schema_version` field in the canonical record. Two
 * distinct committed events that differ only in their
 * committed-envelope `schema_version` stamp will produce
 * distinct `run_evidence_hash` values — that is the
 * intended contract: `schema_version` IS part of evidence
 * identity in V1. The metric report separately records
 * its own report-level schema version via
 * `provenance.metric_report_schema_version`, but the
 * EVIDENCE hash binds to the EVIDENCE including its stamp.
 *
 * Deliberate simplicity: we record the full event payload
 * by recursive canonicalization through `deterministicJson`.
 * For an arbitrary `event.event` shape this requires the
 * record to be JSON-serializable by the deterministic
 * encoder. Phase E guarantees that payloads pass through
 * `snapshotJsonValue` before becoming `CommittedRunEvent`,
 * so they are JSON-clean.
 */
function eventToCanonical(e: CommittedRunEvent): string {
  const obj: Record<string, unknown> = {
    schema_version: e.schema_version,
    event_id: e.event_id,
    run_id: e.run_id,
    subject_id: e.subject_id,
    sequence: e.sequence,
    observed_at: e.observed_at,
    event: e.event,
  };
  return deterministicJson(obj);
}
