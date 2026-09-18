/**
 * Adapter-common typed evidence verifier
 * (LH-03 CORRECTION04, C04-01..C04-06).
 *
 * CORRECTION03 split structural validation
 * (`validateLiveQualification`) from raw evidence
 * inspection (kept in `evidence-reader.ts`). The
 * validator is pure and synchronous: it inspects only
 * the in-memory capability document and proves the
 * typed semantic predicate
 *
 *   LIVE_QUALIFIED ⇒ probe_evidence != null ∧
 *     disposition === "PASS" ∧ expected === observed ∧
 *     probe_kind !== "NOT_RUN".
 *
 * CORRECTION04 closes the deeper defect: a PASS
 * recorded in the document must be RE-verifiable from
 * the artifact on disk in a fresh process. The
 * verifier:
 *
 *   1. Resolves the recorded `artifact_path` against
 *      a trusted `repoRoot`, refusing path escape.
 *   2. Confirms the file exists.
 *   3. Re-reads the bytes and recomputes the SHA256.
 *      The recomputed SHA256 must equal the recorded
 *      `artifact_sha256`.
 *   4. Re-runs the probe_kind parser on the bytes.
 *   5. Recomputes the observed value from the parsed
 *      artifact.
 *   6. Recomputes the capability-specific oracle and
 *      confirms it agrees with the recorded
 *      `disposition` and `evidence_relation`.
 *
 * The invariant the verifier enforces is:
 *
 *   LIVE_QUALIFIED ⇒
 *     STRUCTURALLY_VALID ∧
 *     ARTIFACT_HASH_VERIFIED ∧
 *     ORACLE_RECOMPUTED
 *
 * Every failure is typed — there is no generic thrown
 * string authority.
 *
 * CORRECTION04 also closes:
 *
 *   C04-02 (artifact hash drift fails closed — the
 *          verifier refuses to accept a recorded hash
 *          that disagrees with the on-disk bytes).
 *   C04-03 (repo-relative durable evidence paths —
 *          paths are normalized against an explicit
 *          trusted root; ../ and absolute paths
 *          outside the root are refused; symlinks
 *          resolving outside the root are refused).
 *   C04-06 (closed-world typed
 *          `EvidenceVerificationError` kinds).
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { resolve as pathResolve, sep as pathSep, relative } from "node:path";
import type {
  CapabilityKey,
  CapabilityProbeKind,
  HarnessCapabilities,
} from "../protocol/index.js";

/**
 * Closed-world failure kinds for evidence verification
 * (LH-03 CORRECTION04 C04-06). Every verifier failure
 * is one of these; there is no generic string-throwing
 * authority.
 */
export type EvidenceVerificationErrorKind =
  | "EVIDENCE_ARTIFACT_MISSING"
  | "EVIDENCE_PATH_ESCAPE"
  | "EVIDENCE_HASH_MISMATCH"
  | "EVIDENCE_PARSE_FAILED"
  | "EVIDENCE_OBSERVATION_MISMATCH"
  | "EVIDENCE_ORACLE_FAILED";

export const EVIDENCE_VERIFICATION_ERROR_KINDS: readonly EvidenceVerificationErrorKind[] = [
  "EVIDENCE_ARTIFACT_MISSING",
  "EVIDENCE_PATH_ESCAPE",
  "EVIDENCE_HASH_MISMATCH",
  "EVIDENCE_PARSE_FAILED",
  "EVIDENCE_OBSERVATION_MISMATCH",
  "EVIDENCE_ORACLE_FAILED",
] as const;

export type EvidenceVerificationError = {
  readonly kind: EvidenceVerificationErrorKind;
  readonly key: CapabilityKey;
  readonly message: string;
  readonly artifact_path?: string;
  readonly recorded_sha256?: string;
  readonly recomputed_sha256?: string;
  readonly recorded_observed?: string;
  readonly recomputed_observed?: string;
};

export type EvidenceVerificationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly errors: readonly EvidenceVerificationError[];
    };

/**
 * Normalize a recorded artifact path against a trusted
 * repo root. Refuses:
 *
 *   - any ".." segment that would escape the root;
 *   - symlinks whose target escapes the root;
 *   - absolute paths recorded outside the root that
 *     pretend to be repo-relative.
 *
 * On success, returns the canonical realpath. On
 * failure, returns an `EVIDENCE_PATH_ESCAPE` error.
 *
 * NOTE: the recorded path MUST be repo-relative; the
 * verifier resolves it against `repoRoot` and refuses
 * absolute paths that escape.
 */
export function resolveEvidencePath(
  artifact_path: string,
  repoRoot: string,
  capability: CapabilityKey,
):
  | { readonly ok: true; readonly absolute: string }
  | { readonly ok: false; readonly error: EvidenceVerificationError } {
  const absRepo = pathResolve(repoRoot);
  const absCandidate = pathResolve(absRepo, artifact_path);
  const rel = relative(absRepo, absCandidate);
  if (
    rel === ".." ||
    rel.startsWith(`..${pathSep}`) ||
    (pathSep === "\\" && rel.startsWith("..\\"))
  ) {
    return {
      ok: false,
      error: {
        kind: "EVIDENCE_PATH_ESCAPE",
        key: capability,
        message: `Recorded artifact_path '${artifact_path}' escapes repoRoot '${repoRoot}' (relative='${rel}').`,
        artifact_path,
      },
    };
  }
  // Symlink realpath check.
  let realpath: string;
  try {
    realpath = realpathSync(absCandidate);
  } catch {
    realpath = absCandidate;
  }
  const relReal = relative(absRepo, realpath);
  if (relReal === ".." || relReal.startsWith(`..${pathSep}`)) {
    return {
      ok: false,
      error: {
        kind: "EVIDENCE_PATH_ESCAPE",
        key: capability,
        message: `Recorded artifact_path '${artifact_path}' resolves via symlink to '${realpath}' which escapes repoRoot '${repoRoot}'.`,
        artifact_path,
      },
    };
  }
  return { ok: true, absolute: realpath };
}

/**
 * Recompute the SHA256 of the on-disk bytes for an
 * already-resolved absolute artifact path.
 */
function recomputeSha256(absolute: string): string {
  const bytes = readFileSync(absolute);
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Attempt to parse the recorded artifact under the
 * given `probe_kind`. Returns the parsed object or
 * an `EVIDENCE_PARSE_FAILED` error.
 */
function parseArtifact(
  absolute: string,
  probe_kind: CapabilityProbeKind,
  capability: CapabilityKey,
):
  | { readonly ok: true; readonly parsed: unknown }
  | { readonly ok: false; readonly error: EvidenceVerificationError } {
  let raw: string;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch {
    return {
      ok: false,
      error: {
        kind: "EVIDENCE_ARTIFACT_MISSING",
        key: capability,
        message: `Artifact '${absolute}' could not be read.`,
        artifact_path: absolute,
      },
    };
  }
  try {
    if (probe_kind === "SESSION_ENVELOPE") {
      const firstLine = raw.split("\n", 1)[0] ?? "";
      return { ok: true, parsed: JSON.parse(firstLine) };
    }
    if (probe_kind === "CANCELLATION_HALT" || probe_kind === "INSPECTION_ONLY") {
      return { ok: true, parsed: JSON.parse(raw) };
    }
    return {
      ok: false,
      error: {
        kind: "EVIDENCE_PARSE_FAILED",
        key: capability,
        message: `Recorded probe_kind '${probe_kind}' is not re-verifiable.`,
        artifact_path: absolute,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: "EVIDENCE_PARSE_FAILED",
        key: capability,
        message: `Failed to parse artifact '${absolute}' as '${probe_kind}': ${(err as Error).message}`,
        artifact_path: absolute,
      },
    };
  }
}

/**
 * Recompute the observed value from a parsed artifact
 * for the given capability. The capability-specific
 * oracle logic MUST live here so that the verifier
 * uses the exact same rule the builder used.
 */
function recomputeObserved(
  capability: CapabilityKey,
  parsed: unknown,
): string | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  switch (capability) {
    case "HEADLESS":
    case "JSONL":
    case "STREAMING_EVENTS":
      return typeof obj["type"] === "string" ? (obj["type"] as string) : null;
    case "EXPLICIT_CWD":
    case "ISOLATED_DATA_DIR":
      return typeof obj["cwd"] === "string" ? (obj["cwd"] as string) : null;
    case "CANCELLATION":
      return typeof obj["halt_disposition"] === "string"
        ? (obj["halt_disposition"] as string)
        : null;
    default:
      return null;
  }
}

/**
 * Verifier entry point (LH-03 CORRECTION04 C04-01).
 *
 * Re-verifies every LIVE_QUALIFIED and LIVE_HALT axis
 * against the on-disk artifact rooted at `repoRoot`.
 * Returns `{ ok: true }` if all re-verified evidence
 * agrees with what the capability document records.
 * Otherwise returns the typed list of failures.
 *
 * The verifier is pure with respect to the document;
 * it reads from disk but never mutates state. It does
 * NOT itself validate the document's structural
 * predicate — call `validateLiveQualification()` for
 * that. The invariant the verifier enforces is the
 * CORRECTION04 axiom:
 *
 *   LIVE_QUALIFIED ⇒
 *     STRUCTURALLY_VALID ∧
 *     ARTIFACT_HASH_VERIFIED ∧
 *     ORACLE_RECOMPUTED
 */
export function verifyLiveQualificationEvidence(
  caps: HarnessCapabilities,
  repoRoot: string,
): EvidenceVerificationResult {
  const errors: EvidenceVerificationError[] = [];
  for (const k of Object.keys(caps.capability_axes) as CapabilityKey[]) {
    const axis = caps.capability_axes[k];
    if (axis === undefined) continue;
    if (
      axis.live_qualification !== "LIVE_QUALIFIED" &&
      axis.live_qualification !== "LIVE_HALT"
    ) {
      continue;
    }
    const ev = axis.probe_evidence;
    if (ev === null) {
      errors.push({
        kind: "EVIDENCE_OBSERVATION_MISMATCH",
        key: k,
        message: `Axis ${k} is ${axis.live_qualification} but probe_evidence is null; cannot reverify.`,
      });
      continue;
    }
    const resolved = resolveEvidencePath(ev.artifact_path, repoRoot, k);
    if (resolved.ok !== true) {
      errors.push(resolved.error);
      continue;
    }
    const absolute = resolved.absolute;
    if (!existsSync(absolute)) {
      errors.push({
        kind: "EVIDENCE_ARTIFACT_MISSING",
        key: k,
        message: `Artifact '${absolute}' does not exist.`,
        artifact_path: absolute,
      });
      continue;
    }
    try {
      lstatSync(absolute);
    } catch (err) {
      errors.push({
        kind: "EVIDENCE_ARTIFACT_MISSING",
        key: k,
        message: `Failed to stat artifact '${absolute}': ${(err as Error).message}`,
        artifact_path: absolute,
      });
      continue;
    }
    // Hash re-verification (C04-02).
    let recomputed: string;
    try {
      recomputed = recomputeSha256(absolute);
    } catch (err) {
      errors.push({
        kind: "EVIDENCE_ARTIFACT_MISSING",
        key: k,
        message: `Failed to read artifact '${absolute}': ${(err as Error).message}`,
        artifact_path: absolute,
      });
      continue;
    }
    if (recomputed !== ev.artifact_sha256) {
      errors.push({
        kind: "EVIDENCE_HASH_MISMATCH",
        key: k,
        message: `Artifact hash drift on '${absolute}'.`,
        artifact_path: absolute,
        recorded_sha256: ev.artifact_sha256,
        recomputed_sha256: recomputed,
      });
      continue;
    }
    // Parse + oracle recomputation.
    const parsed = parseArtifact(absolute, ev.probe_kind, k);
    if (parsed.ok !== true) {
      errors.push(parsed.error);
      continue;
    }
    const observed = recomputeObserved(k, parsed.parsed);
    if (observed === null) {
      errors.push({
        kind: "EVIDENCE_PARSE_FAILED",
        key: k,
        message: `Could not recompute observed value for ${k} from parsed artifact.`,
        artifact_path: absolute,
      });
      continue;
    }
    if (observed !== ev.evidence_relation.observed) {
      errors.push({
        kind: "EVIDENCE_OBSERVATION_MISMATCH",
        key: k,
        message: `Recomputed observed value disagrees with recorded observed value for ${k}.`,
        artifact_path: absolute,
        recorded_observed: ev.evidence_relation.observed,
        recomputed_observed: observed,
      });
      continue;
    }
    // Oracle re-check (PASS iff expected === observed AND
    // recorded disposition matches).
    const expected = ev.evidence_relation.expected;
    const expectedDisposition: "PASS" | "FAIL" = expected === observed ? "PASS" : "FAIL";
    if (axis.live_qualification === "LIVE_QUALIFIED") {
      if (ev.disposition !== "PASS" || expectedDisposition !== "PASS") {
        errors.push({
          kind: "EVIDENCE_ORACLE_FAILED",
          key: k,
          message: `Capability ${k} is LIVE_QUALIFIED but oracle recomputation says FAIL (expected='${expected}', observed='${observed}', recorded disposition='${ev.disposition}').`,
          artifact_path: absolute,
          recorded_observed: ev.evidence_relation.observed,
          recomputed_observed: observed,
        });
      }
    } else {
      // LIVE_HALT: the recorded disposition must be
      // HALT; we do not require expected === observed
      // because HALT records the actual halt reason.
      if (ev.disposition !== "HALT") {
        errors.push({
          kind: "EVIDENCE_ORACLE_FAILED",
          key: k,
          message: `Capability ${k} is LIVE_HALT but recorded disposition is '${ev.disposition}', not 'HALT'.`,
          artifact_path: absolute,
          recorded_observed: ev.evidence_relation.observed,
          recomputed_observed: observed,
        });
      }
    }
  }
  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
}
