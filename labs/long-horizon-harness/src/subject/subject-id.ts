/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * `computeSubjectId`: derive the canonical content-addressed
 * SubjectId from a validated SubjectManifest.
 *
 *   subjectId = "subject:" + sha256(
 *       SUBJECT_ID_V1_TAG || "\u0000" || canonical(manifest)
 *   )
 *
 * Properties (Phase D acceptance table):
 *
 *   - Deterministic: same canonical content -> same SubjectId.
 *   - Key-order independent: source-object key insertion
 *     order does not affect the result, because canonicalize
 *     sorts keys lexically.
 *   - One-field-change sensitive: changing ANY required
 *     dimension changes the canonical bytes -> changes the
 *     SubjectId.
 *   - Domain-tag separated: the v1 tag prevents collision
 *     with any other Factory content identifier that uses the
 *     same canonical bytes (none exist today, but the
 *     discipline is established now).
 *
 * This module is pure: no I/O. The caller is responsible for
 * passing a structurally valid manifest; `computeSubjectId`
 * does NOT re-validate (validation is the decoder's job, and
 * doing it twice would invite drift).
 */

import { createHash } from "node:crypto";

import {
  SUBJECT_ID_V1_TAG,
  canonicalize,
} from "./subject-canonicalize.js";
import { makeSubjectId, type SubjectId, type SubjectManifest } from "./subject-types.js";

/**
 * Compute the canonical SubjectId for a validated manifest.
 *
 * Pure function. Does not re-validate.
 */
export function computeSubjectId(manifest: SubjectManifest): SubjectId {
  const canonical = canonicalize(manifest);
  const hex = createHash("sha256")
    .update(SUBJECT_ID_V1_TAG + "\u0000", "utf8")
    .update(canonical, "utf8")
    .digest("hex");
  return makeSubjectId("subject:" + hex);
}
