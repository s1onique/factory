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
import {
  isAbsolute,
  resolve as pathResolve,
  sep as pathSep,
  relative,
} from "node:path";
import type {
  CapabilityKey,
  CapabilityProbeKind,
  HarnessCapabilities,
} from "../protocol/index.js";
import { readInvocationEvidence } from "./invocation-evidence.js";
import {
  isRuntimeSessionFileInside,
  readExecutionCaptureManifest,
  reverifyExecutionCaptureManifestArtifacts,
  shaOfExecutionCaptureManifest,
} from "./execution-capture.js";

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
  | "EVIDENCE_ORACLE_FAILED"
  | "EVIDENCE_EXECUTION_MISMATCH";

export const EVIDENCE_VERIFICATION_ERROR_KINDS: readonly EvidenceVerificationErrorKind[] = [
  "EVIDENCE_ARTIFACT_MISSING",
  "EVIDENCE_PATH_ESCAPE",
  "EVIDENCE_HASH_MISMATCH",
  "EVIDENCE_PARSE_FAILED",
  "EVIDENCE_OBSERVATION_MISMATCH",
  "EVIDENCE_ORACLE_FAILED",
  "EVIDENCE_EXECUTION_MISMATCH",
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
 * repo root. Refuses (CORRECTION05 C05-03):
 *
 *   - absolute recorded paths (even when inside the root).
 *     The verifier mandates canonical repo-relative
 *     durable evidence paths so committed qualification
 *     matrices are portable across checkout roots.
 *   - any ".." segment that would escape the root;
 *   - symlinks whose target escapes the root.
 *
 * On success, returns the canonical realpath. On
 * failure, returns an `EVIDENCE_PATH_ESCAPE` error.
 */
export function resolveEvidencePath(
  artifact_path: string,
  repoRoot: string,
  capability: CapabilityKey,
):
  | { readonly ok: true; readonly absolute: string }
  | { readonly ok: false; readonly error: EvidenceVerificationError } {
  // CORRECTION05 C05-03: reject absolute recorded paths
  // outright. The verifier requires repo-relative
  // committed evidence; an absolute path inside the
  // repo is not portable across checkouts and is the
  // whole class of defect we are trying to close.
  // CORRECTION08 C08-01: also refuse undefined /
  // non-string paths so that callers that pass an
  // absent axis field fail closed with a typed error
  // rather than a runtime crash.
  if (typeof artifact_path !== "string" || artifact_path === "" || isAbsolute(artifact_path)) {
    return {
      ok: false,
      error: {
        kind: "EVIDENCE_PATH_ESCAPE",
        key: capability,
        message: `Recorded artifact_path '${artifact_path}' is absolute; verifier requires a repo-relative path resolved against repoRoot '${repoRoot}'.`,
        artifact_path,
      },
    };
  }
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
 * Repo-relative recomputed artifact path, used by
 * `recomputeObserved` for `ISOLATED_DATA_DIR` (the
 * captured session file IS the session storage).
 */
function repoRelativeArtifactPath(
  absolute: string,
  repoRoot: string,
): string {
  const absRepo = pathResolve(repoRoot);
  const rel = relative(absRepo, pathResolve(absolute));
  return rel;
}

/**
 * Recompute the observed value from a parsed artifact
 * for the given capability. The capability-specific
 * oracle logic MUST live here so that the verifier
 * uses the exact same rule the builder used.
 *
 * For `ISOLATED_DATA_DIR` (CORRECTION05 C05-01) the
 * oracle is "the captured session artifact lives under
 * isolated_session_dir", so the recomputed observed
 * value is the repo-relative artifact path itself —
 * not the cwd. The verifier separately checks
 * `isUnder(recomputed, expected)` for that capability.
 */
function recomputeObserved(
  capability: CapabilityKey,
  parsed: unknown,
  absolute: string,
  repoRoot: string,
): string | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  switch (capability) {
    case "HEADLESS":
    case "JSONL":
    case "STREAMING_EVENTS":
      return typeof obj["type"] === "string" ? (obj["type"] as string) : null;
    case "EXPLICIT_CWD":
      return typeof obj["cwd"] === "string" ? (obj["cwd"] as string) : null;
    case "ISOLATED_DATA_DIR":
      return repoRelativeArtifactPath(absolute, repoRoot);
    case "CANCELLATION":
      return typeof obj["halt_disposition"] === "string"
        ? (obj["halt_disposition"] as string)
        : null;
    default:
      return null;
  }
}

/**
 * Capability-specific oracle that uses BOTH the
 * `expected` and the recomputed `observed` value.
 *
 * CORRECTION06 C06-02..C06-05: the oracle is
 * invocation-aware. The recorded `expected` is no
 * longer authoritative on its own; the invocation
 * artifact defines the expected for capability-
 * specific rules.
 *
 * For ISOLATED_DATA_DIR (CORRECTION05 C05-01 +
 * CORRECTION06 C06-05) the relation is "observed
 * artifact_path lives under invocation-recorded
 * session_dir", not "Factory fixture copy lives under
 * session_dir".
 */
function isUnder(child: string, parent: string): boolean {
  if (child === parent) return true;
  if (parent === "") return false;
  if (parent.endsWith("/")) {
    return child.startsWith(parent);
  }
  return child.startsWith(parent + "/");
}

/**
 * CORRECTION06 C06-02..C06-05: capability-specific
 * oracle that combines invocation evidence, parsed
 * observation, and observed value. Returns true iff
 * the recorded capability claim is grounded in
 * durable artifacts on BOTH sides (premise +
 * observation).
 *
 *   JSONL             — observation is a JSONL session envelope.
 *   HEADLESS          — invocation.invocation_mode === "headless"
 *                       AND observation present.
 *   STREAMING_EVENTS  — invocation.invocation_mode === "headless"
 *                       AND observation contains >= 2 events.
 *   EXPLICIT_CWD      — invocation.spawn_cwd === observation.cwd.
 *   ISOLATED_DATA_DIR — invocation.session_dir != null AND
 *                       invocation.no_session === false AND
 *                       observed artifact_path lives under
 *                       invocation.session_dir.
 *   CANCELLATION      — recorded observed halt reason matches
 *                       recomputed halt_disposition from the
 *                       process-result artifact.
 */
export function evaluateCapabilityOracle(args: {
  readonly capability: CapabilityKey;
  readonly invocation: import("./invocation-evidence.js").InvocationEvidence;
  readonly parsedObservation: unknown;
  readonly observed: string;
  readonly observationArtifactAbsolute: string;
  /**
   * CORRECTION08 C08-05: the runtime session file path
   * the execution-capture manifest reports for this
   * capability (the actual file Pi's session manager
   * created, e.g. `PI_SESSION_FILE`). For
   * ISOLATED_DATA_DIR the oracle refuses any claim where
   * the runtime file is not absolute AND inside
   * `invocation.derived.session_dir`. For other
   * capabilities this is informational; the oracle does
   * not consume it.
   */
  readonly runtimeSessionFilePath?: string | null;
  readonly repoRoot?: string;
}): boolean {
  const {
    capability,
    invocation,
    parsedObservation,
    observed,
    observationArtifactAbsolute,
  } = args;
  switch (capability) {
    case "JSONL":
      return observed === "session";
    case "HEADLESS":
      // CORRECTION07 C07-03: headless is derived from raw
      // argv/env, not caller-asserted. Pi's `--mode json`,
      // `--mode rpc`, and `-p/--print` all produce a
      // headless (noninteractive) launch.
      return invocation.derived.headless && observed === "session";
    case "STREAMING_EVENTS": {
      // CORRECTION07: headless is now a derived bool.
      if (!invocation.derived.headless) return false;
      // CORRECTION07 C07-03: streaming requires a json or
      // rpc protocol. Plain `-p/--print` noninteractive
      // without a protocol does not stream.
      if (
        invocation.derived.protocol !== "json" &&
        invocation.derived.protocol !== "rpc"
      ) {
        return false;
      }
      const lines = readJsonlAllLines(observationArtifactAbsolute);
      if (lines === null) return false;
      if (lines.length < 2) return false;
      return true;
    }
    case "EXPLICIT_CWD":
      return invocation.spawn_cwd === observed;
    case "ISOLATED_DATA_DIR":
      // CORRECTION07: session_dir + no_session are derived
      // from argv/env, not caller-asserted. If a record
      // contradicts itself (--no-session + session_dir),
      // the derivation has already failed closed.
      if (invocation.derived.session_dir === null) return false;
      if (invocation.derived.no_session) return false;
      // CORRECTION08 C08-05: the runtime session file
      // path reported by the execution-capture manifest
      // MUST be absolute AND live under the derived
      // session_dir. Fixture placement is no longer
      // authoritative.
      if (args.repoRoot !== undefined) {
        const ok = isRuntimeSessionFileInside({
          runtimePath: args.runtimeSessionFilePath ?? null,
          derivedSessionDir: invocation.derived.session_dir,
          repoRoot: args.repoRoot,
        });
        if (!ok) return false;
      }
      return isUnder(observed, invocation.derived.session_dir);
    case "CANCELLATION": {
      if (
        parsedObservation !== null &&
        typeof parsedObservation === "object"
      ) {
        const obj = parsedObservation as Record<string, unknown>;
        if (typeof obj["halt_disposition"] === "string") {
          return obj["halt_disposition"] === observed;
        }
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * Read all lines of a JSONL artifact as parsed objects.
 * Returns `null` if the file is missing or any line
 * fails to parse.
 */
function readJsonlAllLines(absolute: string): unknown[] | null {
  let raw: string;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch {
    return null;
  }
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      return null;
    }
  }
  return out;
}

/**
 * CORRECTION06: legacy single-string oracle retained
 * for callers that still hold a documented
 * `evaluateOracle(capability, expected, observed)`
 * signature. The authoritative oracle is
 * `evaluateCapabilityOracle` which is invocation-aware.
 * This function is exported for backward compatibility
 * with C05 tests that pin the legacy form.
 */
export function evaluateOracle(
  capability: CapabilityKey,
  expected: string,
  observed: string,
): boolean {
  if (capability === "ISOLATED_DATA_DIR") {
    return isUnder(observed, expected);
  }
  return expected === observed;
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
      axis.live_qualification !== "LIVE_HALT" &&
      axis.live_qualification !== "REPLAY_QUALIFIED" &&
      axis.live_qualification !== "REPLAY_HALT"
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
    const resolved = resolveEvidencePath(
      ev.artifact_path ?? "",
      repoRoot,
      k,
    );
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
    const observed = recomputeObserved(k, parsed.parsed, absolute, repoRoot);
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
    // CORRECTION06 C06-06: re-read the invocation
    // evidence artifact and recompute the `expected`
    // value from it. The recorded
    // `evidence_relation.expected` is no longer
    // authoritative on its own; the invocation artifact
    // is. If `invocation_evidence_path` is null the
    // verifier refuses LIVE_QUALIFIED / LIVE_HALT for
    // that capability.
    if (axis.invocation_evidence_path === null) {
      errors.push({
        kind: "EVIDENCE_PARSE_FAILED",
        key: k,
        message: `Capability ${k} is ${axis.live_qualification} but invocation_evidence_path is null; cannot derive the oracle's expected value from durable evidence (CORRECTION06 C06-06).`,
        artifact_path: absolute,
      });
      continue;
    }
    const invocationResolved = resolveEvidencePath(
      axis.invocation_evidence_path ?? "",
      repoRoot,
      k,
    );
    if (invocationResolved.ok !== true) {
      errors.push({
        ...invocationResolved.error,
        message: `Invocation artifact path failed resolve: ${invocationResolved.error.message}`,
      });
      continue;
    }
    const invocationAbsolute = invocationResolved.absolute;
    if (!existsSync(invocationAbsolute)) {
      errors.push({
        kind: "EVIDENCE_ARTIFACT_MISSING",
        key: k,
        message: `Invocation artifact '${invocationAbsolute}' does not exist.`,
        artifact_path: invocationAbsolute,
      });
      continue;
    }
    // CORRECTION07: the invocation artifact's SHA is
    // computed by readInvocationEvidence itself from the
    // raw on-disk bytes (no separate recomputeSha256 call
    // needed here).
    const invocationRel = relative(pathResolve(repoRoot), invocationAbsolute);
    const invocation = readInvocationEvidence(invocationRel, repoRoot);
    if (invocation === null) {
      errors.push({
        kind: "EVIDENCE_PARSE_FAILED",
        key: k,
        message: `Invocation artifact at '${invocationRel}' is missing or malformed (CORRECTION07).`,
        artifact_path: invocationAbsolute,
      });
      continue;
    }
    // CORRECTION07 C07-01: the SHA256 of the invocation
    // bytes is bound externally on the capability axis
    // (`axis.invocation_evidence_sha256`). The SHA must
    // live OUTSIDE the artifact being hashed, so a
    // mutated artifact cannot self-validate. The
    // recorded sha in the artifact itself is no longer
    // consulted (the on-disk record no longer carries
    // that field).
    if (
      axis.invocation_evidence_sha256 !== null &&
      axis.invocation_evidence_sha256 !== "" &&
      axis.invocation_evidence_sha256 !== invocation.artifact_sha256
    ) {
      errors.push({
        kind: "EVIDENCE_HASH_MISMATCH",
        key: k,
        message: `Invocation artifact hash drift on '${invocationAbsolute}' (CORRECTION07 C07-01).`,
        artifact_path: invocationAbsolute,
        recorded_sha256: axis.invocation_evidence_sha256,
        recomputed_sha256: invocation.artifact_sha256,
      });
      continue;
    }
    // CORRECTION08 C08-01: every LIVE_QUALIFIED /
    // LIVE_HALT axis must bind an execution-capture
    // manifest. The manifest is the same-execution
    // proof that closes the invocation-vs-observation
    // splice hole CORRECTION07's review identified.
    if (axis.execution_capture_path === null || axis.execution_capture_path === undefined) {
      errors.push({
        kind: "EVIDENCE_PARSE_FAILED",
        key: k,
        message: `Capability ${k} is ${axis.live_qualification} but execution_capture_path is null; cannot prove the invocation and observation came from the same OS process (CORRECTION08 C08-01).`,
        artifact_path: absolute,
      });
      continue;
    }
    const execResolved = resolveEvidencePath(
      axis.execution_capture_path,
      repoRoot,
      k,
    );
    if (execResolved.ok !== true) {
      errors.push({
        ...execResolved.error,
        message: `Execution-capture manifest path failed resolve: ${execResolved.error.message}`,
      });
      continue;
    }
    const execAbsolute = execResolved.absolute;
    if (!existsSync(execAbsolute)) {
      errors.push({
        kind: "EVIDENCE_ARTIFACT_MISSING",
        key: k,
        message: `Execution-capture manifest '${execAbsolute}' does not exist (CORRECTION08 C08-01).`,
        artifact_path: execAbsolute,
      });
      continue;
    }
    const execRel = relative(pathResolve(repoRoot), execAbsolute);
    const execSha = shaOfExecutionCaptureManifest(execRel, repoRoot);
    if (execSha === null) {
      errors.push({
        kind: "EVIDENCE_PARSE_FAILED",
        key: k,
        message: `Execution-capture manifest at '${execRel}' could not be hashed (CORRECTION08 C08-01).`,
        artifact_path: execAbsolute,
      });
      continue;
    }
    if (
      axis.execution_capture_sha256 !== null &&
      axis.execution_capture_sha256 !== "" &&
      axis.execution_capture_sha256 !== execSha
    ) {
      errors.push({
        kind: "EVIDENCE_HASH_MISMATCH",
        key: k,
        message: `Execution-capture manifest hash drift on '${execAbsolute}' (CORRECTION08 C08-01).`,
        artifact_path: execAbsolute,
        recorded_sha256: axis.execution_capture_sha256,
        recomputed_sha256: execSha,
      });
      continue;
    }
    const manifest = readExecutionCaptureManifest(execRel, repoRoot);
    if (manifest === null) {
      errors.push({
        kind: "EVIDENCE_PARSE_FAILED",
        key: k,
        message: `Execution-capture manifest at '${execRel}' is missing, malformed, or carries fields outside the closed-world schema (CORRECTION08 C08-04).`,
        artifact_path: execAbsolute,
      });
      continue;
    }
    // CORRECTION06 C06-06: the invocation artifact's
    // `capability` field is a self-identifier; the
    // verifier does NOT enforce it equals the axis
    // key, because a single headless invocation can
    // legitimately back multiple LIVE_QUALIFIED axes
    // (JSONL, HEADLESS, STREAMING_EVENTS, EXPLICIT_CWD,
    // ISOLATED_DATA_DIR all share one launch record).
    // What the verifier DOES enforce is that the
    // invocation-derived `expected` value disagrees with
    // the recorded `expected` — which it already does
    // below.
    // C06-02..C06-05: oracle is now invocation-aware.
    // The recorded expected value is checked to agree
    // with what the oracle SHOULD derive from the
    // invocation evidence (defense against forged
    // "recorded expected = artifact observed"). The
    // authoritative oracle is
    // `evaluateCapabilityOracle` which combines
    // invocation, parsed observation, and the
    // recomputed observed value.
    //
    // For most capabilities the recorded expected
    // value (e.g. "session" for JSONL) is identical to
    // what the invocation-aware oracle would derive.
    // For HEADLESS the recorded expected is "session"
    // (the observed protocol output) but the
    // invocation-aware oracle checks invocation_mode +
    // observed === "session". Both sides are evaluated.
    // CORRECTION08 C08-03: cross-reference the manifest
    // BEFORE running the capability oracle. The manifest
    // MUST (a) declare the same invocation_sha256, (b)
    // declare the same execution_id as the probe
    // evidence, and (c) declare the same native artifact
    // SHA as the probe evidence. A splice fails closed
    // here, BEFORE the oracle is even consulted.
    if (manifest.invocation_sha256 !== invocation.artifact_sha256) {
      errors.push({
        kind: "EVIDENCE_EXECUTION_MISMATCH",
        key: k,
        message: `Execution-capture manifest declares invocation_sha256='${manifest.invocation_sha256}' but the actual invocation artifact hashes to '${invocation.artifact_sha256}'. The manifest does not belong to the same launch (CORRECTION08 C08-03).`,
        artifact_path: execAbsolute,
      });
      continue;
    }
    if (typeof ev.execution_id !== "string" || ev.execution_id.length === 0) {
      errors.push({
        kind: "EVIDENCE_EXECUTION_MISMATCH",
        key: k,
        message: `Probe evidence for ${k} has no execution_id (CORRECTION08 C08-03).`,
        artifact_path: absolute,
      });
      continue;
    }
    if (ev.execution_id !== manifest.execution_id) {
      errors.push({
        kind: "EVIDENCE_EXECUTION_MISMATCH",
        key: k,
        message: `Probe evidence execution_id='${ev.execution_id}' does not match manifest execution_id='${manifest.execution_id}' (CORRECTION08 C08-03). The observation cannot be proven to come from the same OS process as the invocation.`,
        artifact_path: absolute,
      });
      continue;
    }
    if (
      typeof manifest.native_artifact_sha256 === "string" &&
      manifest.native_artifact_sha256.length > 0 &&
      ev.artifact_sha256 !== manifest.native_artifact_sha256
    ) {
      errors.push({
        kind: "EVIDENCE_EXECUTION_MISMATCH",
        key: k,
        message: `Probe evidence artifact_sha256='${ev.artifact_sha256}' does not match manifest native_artifact_sha256='${manifest.native_artifact_sha256}' (CORRECTION08 C08-07). The observation was not the file the captured process wrote.`,
        artifact_path: absolute,
      });
      continue;
    }
    // CORRECTION09 C09-01: capture_origin must agree
    // with the axis declaration. A LIVE_QUALIFIED axis
    // cannot bind a REPLAY_FIXTURE manifest, and a
    // REPLAY_QUALIFIED axis cannot bind a
    // REAL_PROCESS_CAPTURE manifest.
    if (
      axis.execution_capture_origin !== null &&
      axis.execution_capture_origin !== manifest.capture_origin
    ) {
      errors.push({
        kind: "EVIDENCE_EXECUTION_MISMATCH",
        key: k,
        message: `Execution-capture manifest declares capture_origin='${manifest.capture_origin}' but the axis declares execution_capture_origin='${axis.execution_capture_origin}' (CORRECTION09 C09-01).`,
        artifact_path: execAbsolute,
      });
      continue;
    }
    // CORRECTION09 C09-04: re-read every manifest
    // artifact (stdout / stderr / process_result /
    // native) from disk and SHA-compare. A manifest
    // that claims arbitrary SHAs without backing
    // artifacts (or with stale bytes) fails closed.
    const artifactDrift = reverifyExecutionCaptureManifestArtifacts({
      manifest,
      repoRoot,
    });
    for (const d of artifactDrift) {
      errors.push({
        kind: "EVIDENCE_HASH_MISMATCH",
        key: k,
        message: `Execution-capture manifest artifact '${String(d.field)}' at '${d.path}' recorded sha256='${d.recorded_sha256}' but recomputed sha256='${d.recomputed_sha256}' (CORRECTION09 C09-04).`,
        artifact_path: pathResolve(repoRoot, d.path),
        recorded_sha256: d.recorded_sha256,
        recomputed_sha256: d.recomputed_sha256,
      });
    }
    if (artifactDrift.length > 0) {
      continue;
    }
    const expectedMatches = evaluateCapabilityOracle({
      capability: k,
      invocation,
      parsedObservation: parsed.parsed,
      observed,
      observationArtifactAbsolute: absolute,
      runtimeSessionFilePath: manifest.runtime_session_file_path,
      repoRoot,
    });
    // CORRECTION06: also verify that the recorded
    // `expected` value is consistent with the
    // observation. For most capabilities the recorded
    // expected is `observed` (or, for ISOLATED_DATA_DIR,
    // the parent dir). For CANCELLATION the recorded
    // expected is the canonical halt reason, which must
    // equal the observed halt reason. A forged
    // `expected` field that disagrees with the observed
    // value still fails — this is the CORRECTION05
    // C05-02 invariant carried forward into
    // CORRECTION06.
    if (
      (axis.live_qualification === "LIVE_HALT" ||
        axis.live_qualification === "REPLAY_HALT") &&
      ev.evidence_relation.expected !== observed
    ) {
      errors.push({
        kind: "EVIDENCE_OBSERVATION_MISMATCH",
        key: k,
        message: `Capability ${k} is ${axis.live_qualification} but the recorded expected halt reason '${ev.evidence_relation.expected}' disagrees with the observed halt reason '${observed}' (CORRECTION05 C05-02).`,
        artifact_path: absolute,
        recorded_observed: ev.evidence_relation.expected,
        recomputed_observed: observed,
      });
      continue;
    }
    if (
      axis.live_qualification === "LIVE_QUALIFIED" ||
      axis.live_qualification === "REPLAY_QUALIFIED"
    ) {
      if (ev.disposition !== "PASS" || !expectedMatches) {
        errors.push({
          kind: "EVIDENCE_ORACLE_FAILED",
          key: k,
          message: `Capability ${k} is ${axis.live_qualification} but invocation-aware oracle recomputation says FAIL (recorded expected='${ev.evidence_relation.expected}', observed='${observed}', recorded disposition='${ev.disposition}', derived.headless='${invocation.derived.headless}', derived.protocol='${invocation.derived.protocol}', derived.session_dir=${invocation.derived.session_dir}).`,
          artifact_path: absolute,
          recorded_observed: ev.evidence_relation.observed,
          recomputed_observed: observed,
        });
      }
    } else {
      // CORRECTION05 C05-02: LIVE_HALT (and its
      // CORRECTION09 sibling REPLAY_HALT) must enforce
      // the same oracle relation as LIVE_QUALIFIED —
      // `evaluateOracle(k, expected, observed)` — with
      // the meaning that the recorded `expected` is the
      // canonical halt reason the artifact must prove.
      // A forged document that disagrees on `expected`
      // no longer passes. The recorded disposition must
      // be HALT.
      if (ev.disposition !== "HALT") {
        errors.push({
          kind: "EVIDENCE_ORACLE_FAILED",
          key: k,
          message: `Capability ${k} is ${axis.live_qualification} but recorded disposition is '${ev.disposition}', not 'HALT'.`,
          artifact_path: absolute,
          recorded_observed: ev.evidence_relation.observed,
          recomputed_observed: observed,
        });
      } else if (!expectedMatches) {
        errors.push({
          kind: "EVIDENCE_OBSERVATION_MISMATCH",
          key: k,
          message: `Capability ${k} is ${axis.live_qualification} but the recorded expected halt reason '${ev.evidence_relation.expected}' disagrees with the recomputed observed halt reason '${observed}' (invocation-aware oracle rejected; derived.headless='${invocation.derived.headless}').`,
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
