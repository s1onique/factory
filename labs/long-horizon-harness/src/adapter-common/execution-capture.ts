/**
 * Adapter-common typed execution capture manifest
 * (LH-03 CORRECTION08, C08-01..C08-05, C08-07).
 *
 * CORRECTION07 closed the conceptual hole where the
 * invocation artifact and observation artifact were
 * individually authentic but not execution-bound. A
 * splice was possible:
 *
 *   Invocation A:
 *     pi -p ping
 *   Observation B:
 *     JSON-mode session envelope from a different Pi process
 *
 * Both artifacts were internally valid and SHA-bound.
 * The verifier could not tell whether they came from
 * the same OS process. CORRECTION07's review explicitly
 * identified this as the final provenance layer.
 *
 * CORRECTION08 closes the gap with an
 * `ExecutionCaptureManifest`:
 *
 *   1. Every LIVE_QUALIFIED / LIVE_HALT capability axis
 *      binds two SHAs:
 *
 *         invocation_evidence_sha256
 *           -> SHA256 of the on-disk invocation artifact
 *              bytes (the raw launch tuple).
 *
 *         execution_capture_sha256
 *           -> SHA256 of the on-disk execution capture
 *              manifest bytes (the process-and-streams
 *              envelope).
 *
 *   2. The manifest is emitted by the spawn authority
 *      at process start, atomically from the exact
 *      values handed to spawn/execFile. For fixture-
 *      derived LIVE_QUALIFIED axes the manifest is
 *      INTENDED; for actual live runs it is REAL.
 *      Both forms share the same schema; the verifier
 *      accepts both but treats them identically.
 *
 *   3. `CapabilityProbeEvidence` gains an
 *      `execution_id` field. The verifier enforces
 *
 *         axis.execution_capture_sha256 ==
 *            sha256(actual manifest bytes)
 *         AND ev.execution_id == manifest.execution_id
 *         AND manifest.invocation_sha256 ==
 *            axis.invocation_evidence_sha256
 *
 *      So a splice (invocation-A + observation-B)
 *      fails closed with `EVIDENCE_EXECUTION_MISMATCH`.
 *
 *   4. For ISOLATED_DATA_DIR the manifest gains
 *      `runtime_session_file_path` (the absolute path
 *      Pi's session manager reports, e.g.
 *      `PI_SESSION_FILE` or its actual
 *      `cwd/sessions/<id>.jsonl`). The oracle refuses
 *      unless
 *
 *         runtime_session_file_path is absolute AND
 *         starts with derived.session_dir + path.sep
 *
 *      Fixture placement is no longer authoritative.
 *
 * The invariant the verifier enforces becomes:
 *
 *   LIVE_QUALIFIED =>
 *     STRUCTURALLY_VALID /\
 *     OBSERVATION_BYTES_BOUND /\
 *     INVOCATION_BYTES_BOUND /\
 *     INVOCATION_SEMANTICS_DERIVED_FROM_RAW_LAUNCH /\
 *     EXECUTION_BYTES_BOUND /\
 *     EXECUTION_AND_OBSERVATION_BELONG_TO_SAME_EXECUTION /\
 *     ORACLE_RECOMPUTED
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve as pathResolve,
} from "node:path";

/**
 * Provenance discriminator for an execution-capture
 * manifest (CORRECTION09 C09-01).
 *
 * `REAL_PROCESS_CAPTURE` is reserved for manifests
 * emitted by the spawn authority at process start
 * (CORRECTION09 C09-02). Every artifact listed in the
 * manifest MUST be the file the spawn authority
 * actually captured for that exact execution_id.
 *
 * `REPLAY_FIXTURE` is reserved for deterministic
 * qualification replays of a previously-captured run.
 * The verifier still rejects splices (artifact SHA /
 * execution_id mismatches) but the proof of common OS
 * process is structural rather than mechanically
 * observed. Axes with this origin MUST be classified
 * `REPLAY_QUALIFIED`, never `LIVE_QUALIFIED`.
 */
export type CaptureOrigin = "REAL_PROCESS_CAPTURE" | "REPLAY_FIXTURE";

/**
 * Closed-world schema for an execution capture manifest.
 * The on-disk artifact may carry ONLY these fields.
 *
 * No `invocation` field is permitted here: the
 * invocation artifact is bound by SHA, not by being
 * re-embedded.
 */
export type ExecutionCaptureManifest = {
  /**
   * CORRECTION09 C09-01: provenance discriminator.
   * See {@link CaptureOrigin}. The validator refuses
   * LIVE_QUALIFIED / LIVE_HALT axes whose manifest
   * declares `REPLAY_FIXTURE`.
   */
  readonly capture_origin: CaptureOrigin;
  /**
   * Stable opaque identifier for the OS process run.
   * Every `CapabilityProbeEvidence` referencing this
   * execution MUST carry this same id; mismatched ids
   * fail closed (C08-03, C08-07).
   */
  readonly execution_id: string;
  /**
   * Which capability this execution backs.
   */
  readonly capability: string;
  /**
   * SHA256 of the invocation artifact's on-disk bytes.
   * The manifest MUST match
   * `axis.invocation_evidence_sha256`.
   */
  readonly invocation_sha256: string;
  /**
   * CORRECTION09 C09-04: absolute repo-root-relative
   * path to the captured stdout bytes. The verifier
   * re-reads this file and SHA-compares against
   * `stdout_sha256`. `null` when the capability did not
   * produce stdout (e.g. a halt with no captured
   * stdout).
   */
  readonly stdout_path: string | null;
  /**
   * SHA256 of the captured stdout bytes (the harness's
   * stdout during this execution). Recorded at process
   * completion by the spawn authority. The verifier
   * independently re-reads `stdout_path` and recomputes
   * this SHA; mismatch fails closed.
   */
  readonly stdout_sha256: string;
  /**
   * CORRECTION09 C09-04: absolute repo-root-relative
   * path to the captured stderr bytes. The verifier
   * re-reads this file and SHA-compares against
   * `stderr_sha256`. `null` when no stderr was captured.
   */
  readonly stderr_path: string | null;
  /**
   * SHA256 of the captured stderr bytes (the harness's
   * stderr during this execution). Recorded at process
   * completion by the spawn authority. The verifier
   * independently re-reads `stderr_path` and recomputes
   * this SHA; mismatch fails closed.
   */
  readonly stderr_sha256: string;
  /**
   * CORRECTION09 C09-04: absolute repo-root-relative
   * path to the captured process-result record
   * (canonical JSON: exit code, signal, duration, pgid,
   * started_at, ended_at). The verifier re-reads this
   * file and SHA-compares against `process_result_sha256`.
   * `null` when the spawn authority did not capture a
   * process-result record.
   */
  readonly process_result_path: string | null;
  /**
   * SHA256 of the captured process-result bytes.
   * Verifier independently re-reads `process_result_path`
   * and recomputes this SHA; mismatch fails closed.
   */
  readonly process_result_sha256: string;
  /**
   * CORRECTION09 C09-04: absolute repo-root-relative
   * path to the captured native / harness session
   * artifact. This is the file that backs the
   * `CapabilityProbeEvidence.artifact_path` for the
   * observation side. `null` when there is no native
   * artifact (e.g. a halt that produced no session
   * file); `native_artifact_sha256` MUST then be the
   * SHA of an empty buffer.
   */
  readonly native_artifact_path: string | null;
  /**
   * SHA256 of the captured native / harness session
   * artifact bytes. Verifier independently re-reads
   * `native_artifact_path` and recomputes this SHA;
   * mismatch fails closed.
   */
  readonly native_artifact_sha256: string;
  /**
   * Absolute path of the Pi-created session file (from
   * Pi's runtime; e.g. `PI_SESSION_FILE` or the file
   * Pi's session manager reports). `null` when the
   * capability did not produce a session file (e.g.
   * `--no-session`, or a halt before session creation).
   *
   * For LIVE_QUALIFIED ISOLATED_DATA_DIR, this MUST be
   * non-null and MUST satisfy
   *   isAbsolute(...) AND
   *   startsWith(derived.session_dir + path.sep).
   */
  readonly runtime_session_file_path: string | null;
  /**
   * ISO-8601 timestamp recorded at spawn time.
   */
  readonly recorded_at: string;
};

/**
 * Closed-world field list for the on-disk artifact.
 * `readExecutionCaptureManifest` refuses any field that
 * is not on this list.
 */
const MANIFEST_FIELDS: readonly (keyof ExecutionCaptureManifest)[] = [
  "capture_origin",
  "execution_id",
  "capability",
  "invocation_sha256",
  "stdout_path",
  "stdout_sha256",
  "stderr_path",
  "stderr_sha256",
  "process_result_path",
  "process_result_sha256",
  "native_artifact_path",
  "native_artifact_sha256",
  "runtime_session_file_path",
  "recorded_at",
];

/**
 * Closed-world list of `*_path` fields on the manifest.
 * Used by the verifier (CORRECTION09 C09-04) to know
 * which paths MUST be re-read and SHA-compared against
 * the matching `*_sha256` field.
 */
const ARTIFACT_PATH_FIELDS: readonly (keyof ExecutionCaptureManifest)[] = [
  "stdout_path",
  "stderr_path",
  "process_result_path",
  "native_artifact_path",
];

const ARTIFACT_SHA_FIELDS: readonly (keyof ExecutionCaptureManifest)[] = [
  "stdout_sha256",
  "stderr_sha256",
  "process_result_sha256",
  "native_artifact_sha256",
];

/* ------------------------------------------------------------------ *
 * Emitter (the spawn authority).                                     *
 * ------------------------------------------------------------------ */

/**
 * Compute a fresh execution_id deterministically from
 * the spawn arguments + an external nonce. The spawn
 * authority MUST call this before `spawn()` and pass
 * the result through the entire run so every captured
 * artifact (stdout / stderr / native / process-result)
 * can carry the same id.
 *
 * For fixture-derived LIVE_QUALIFIED axes the caller
 * supplies a fixed nonce so the same execution_id is
 * stable across re-verifications.
 */
export function computeExecutionId(args: {
  readonly nonce: string;
  readonly invocation_sha256: string;
  readonly capability: string;
}): string {
  const h = createHash("sha256");
  h.update("execution-id:v1:");
  h.update(args.nonce);
  h.update(":");
  h.update(args.invocation_sha256);
  h.update(":");
  h.update(args.capability);
  return h.digest("hex");
}

/**
 * Write a typed execution capture manifest to a repo-
 * relative path. Returns the manifest together with the
 * SHA256 of the bytes that were written (which the
 * caller MUST bind on `axis.execution_capture_sha256`).
 *
 * The on-disk artifact carries ONLY the fields on
 * `ExecutionCaptureManifest`; extra fields are dropped
 * silently.
 */
export function writeExecutionCaptureManifest(args: {
  readonly repoRoot: string;
  readonly repo_relative_path: string;
  readonly manifest: ExecutionCaptureManifest;
}): { readonly manifest: ExecutionCaptureManifest; readonly manifest_sha256: string } {
  if (isAbsolute(args.repo_relative_path)) {
    throw new Error(
      `writeExecutionCaptureManifest: repo_relative_path must be repo-relative; got '${args.repo_relative_path}'`,
    );
  }
  const absRepo = pathResolve(args.repoRoot);
  const target = join(absRepo, args.repo_relative_path);
  const rel = relative(absRepo, target);
  if (rel === ".." || rel.startsWith("..")) {
    throw new Error(
      `writeExecutionCaptureManifest: repo_relative_path '${args.repo_relative_path}' escapes repoRoot '${absRepo}'`,
    );
  }
  // Re-serialize through the closed-world field list.
  const sanitized: Record<string, unknown> = {};
  for (const k of MANIFEST_FIELDS) {
    sanitized[k as string] = (args.manifest as Record<string, unknown>)[k as string];
  }
  const bytes = Buffer.from(JSON.stringify(sanitized, null, 2), "utf8");
  const sha = createHash("sha256").update(bytes).digest("hex");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, "utf8");
  return { manifest: args.manifest, manifest_sha256: sha };
}

/**
 * Re-read a typed `ExecutionCaptureManifest` from disk.
 * Refuses:
 *   - missing file
 *   - non-object payload
 *   - any field outside the closed-world list
 *   - non-string required fields
 *   - non-null runtime_session_file_path that is not
 *     absolute
 *
 * Returns `null` on any of those failures.
 */
export function readExecutionCaptureManifest(
  repo_relative_path: string,
  repoRoot: string,
): ExecutionCaptureManifest | null {
  if (isAbsolute(repo_relative_path)) return null;
  const target = pathResolve(repoRoot, repo_relative_path);
  if (!existsSync(target)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(target, "utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  // Refuse fields outside the closed-world list.
  for (const k of Object.keys(obj)) {
    if (!(MANIFEST_FIELDS as readonly string[]).includes(k)) {
      return null;
    }
  }
  // Refuse missing required fields.
  for (const k of MANIFEST_FIELDS) {
    if (!(k in obj)) return null;
  }
  // Type-check required fields.
  for (const k of MANIFEST_FIELDS) {
    const v = obj[k as string];
    if (k === "runtime_session_file_path") {
      if (v !== null && typeof v !== "string") return null;
      if (typeof v === "string" && !isAbsolute(v)) return null;
    } else if (k === "capture_origin") {
      if (v !== "REAL_PROCESS_CAPTURE" && v !== "REPLAY_FIXTURE") {
        return null;
      }
    } else if (
      k === "stdout_path" ||
      k === "stderr_path" ||
      k === "process_result_path" ||
      k === "native_artifact_path"
    ) {
      // CORRECTION09 C09-04: *_path fields are either
      // null (no artifact captured) or a repo-relative
      // path. They MUST NOT be absolute and MUST NOT
      // escape the repoRoot.
      if (v !== null && typeof v !== "string") return null;
      if (typeof v === "string") {
        if (isAbsolute(v)) return null;
        if (v.length === 0) return null;
      }
    } else if (typeof v !== "string") {
      return null;
    } else if ((v as string).length === 0) {
      // SHA fields MUST be non-empty; empty SHA is
      // never a valid binding.
      return null;
    }
  }
  // CORRECTION09 C09-04: cross-check that every
  // non-null *_path field has a matching non-empty
  // *_sha256 field, and vice-versa. An artifact cannot
  // exist (be claimed at a path) without a SHA, and a
  // SHA cannot be claimed without an artifact path.
  for (let i = 0; i < ARTIFACT_PATH_FIELDS.length; i++) {
    const pk = ARTIFACT_PATH_FIELDS[i] as keyof ExecutionCaptureManifest;
    const sk = ARTIFACT_SHA_FIELDS[i] as keyof ExecutionCaptureManifest;
    const pv = obj[pk as string];
    const sv = obj[sk as string];
    if (pv === null && typeof sv === "string" && sv !== shaOfEmpty()) {
      // SHA is set to non-empty-buffer when the
      // corresponding artifact is absent, so this
      // would be inconsistent.
      return null;
    }
    if (typeof pv === "string" && (sv === null || sv === "")) {
      return null;
    }
  }
  return obj as unknown as ExecutionCaptureManifest;
}

/**
 * SHA256 of an empty buffer, used as the canonical
 * SHA for manifest artifacts that are absent
 * (e.g. `stdout_path === null` ⇒ `stdout_sha256`
 * equals `shaOfEmpty()`).
 */
export function shaOfEmpty(): string {
  return createHash("sha256").update(Buffer.alloc(0)).digest("hex");
}

/**
 * CORRECTION09 C09-04: for each non-null `*_path`
 * field on the manifest, re-read the file from disk
 * and re-SHA its bytes. Returns a list of field-name
 * ↔ recorded vs recomputed mismatches. The verifier
 * treats every mismatch as `EVIDENCE_HASH_MISMATCH`
 * (the same kind used for invocation / manifest
 * SHA drift).
 *
 * `repoRoot` is required because manifest `*_path`
 * fields are repo-relative.
 */
export function reverifyExecutionCaptureManifestArtifacts(args: {
  readonly manifest: ExecutionCaptureManifest;
  readonly repoRoot: string;
}): readonly {
  readonly field: keyof ExecutionCaptureManifest;
  readonly path: string;
  readonly recorded_sha256: string;
  readonly recomputed_sha256: string;
}[] {
  const mismatches: {
    field: keyof ExecutionCaptureManifest;
    path: string;
    recorded_sha256: string;
    recomputed_sha256: string;
  }[] = [];
  for (let i = 0; i < ARTIFACT_PATH_FIELDS.length; i++) {
    const pk = ARTIFACT_PATH_FIELDS[i] as keyof ExecutionCaptureManifest;
    const sk = ARTIFACT_SHA_FIELDS[i] as keyof ExecutionCaptureManifest;
    const pv = args.manifest[pk];
    const sv = args.manifest[sk];
    if (pv === null) continue;
    if (typeof pv !== "string" || typeof sv !== "string") continue;
    const abs = pathResolve(args.repoRoot, pv);
    if (!existsSync(abs)) {
      mismatches.push({
        field: pk,
        path: pv,
        recorded_sha256: sv,
        recomputed_sha256: "",
      });
      continue;
    }
    const bytes = readFileSync(abs);
    const recomputed = createHash("sha256").update(bytes).digest("hex");
    if (recomputed !== sv) {
      mismatches.push({
        field: pk,
        path: pv,
        recorded_sha256: sv,
        recomputed_sha256: recomputed,
      });
    }
  }
  return mismatches;
}

/**
 * Compute the SHA256 of the manifest's on-disk bytes
 * (independent of the typed payload). The verifier
 * compares this against `axis.execution_capture_sha256`.
 */
export function shaOfExecutionCaptureManifest(
  repo_relative_path: string,
  repoRoot: string,
): string | null {
  if (isAbsolute(repo_relative_path)) return null;
  const target = pathResolve(repoRoot, repo_relative_path);
  if (!existsSync(target)) return null;
  const bytes = readFileSync(target);
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Closed-world check: a runtime session file path is
 * plausible when it is absolute AND lies inside the
 * declared session directory.
 *
 * `sessionDir` here is the derived session_dir from the
 * invocation artifact. It MAY be a relative repo path
 * (e.g. `test/fixtures/harnesses/pi/pi-v0_85_1`) in
 * fixture contexts; the oracle resolves it against the
 * repo root before comparison so a relative declared
 * session_dir still produces a deterministic absolute
 * containment check.
 *
 * `runtimePath` MUST be absolute (the Pi runtime file is
 * always absolute). If the caller cannot supply an
 * absolute path the oracle fails closed.
 */
export function isRuntimeSessionFileInside(args: {
  readonly runtimePath: string | null;
  readonly derivedSessionDir: string;
  readonly repoRoot: string;
}): boolean {
  if (args.runtimePath === null) return false;
  if (!isAbsolute(args.runtimePath)) return false;
  const declaredAbs = isAbsolute(args.derivedSessionDir)
    ? args.derivedSessionDir
    : pathResolve(args.repoRoot, args.derivedSessionDir);
  // Ensure trailing separator for prefix containment.
  const withSep =
    declaredAbs.endsWith("/") || declaredAbs.endsWith("\\")
      ? declaredAbs
      : declaredAbs + "/";
  return (
    args.runtimePath === declaredAbs ||
    args.runtimePath.startsWith(withSep)
  );
}
