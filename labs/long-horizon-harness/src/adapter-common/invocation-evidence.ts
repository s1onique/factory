/**
 * Adapter-common typed invocation evidence
 * (LH-03 CORRECTION06, C06-01..C06-06).
 *
 * CORRECTION05 closed four reviewer-driven defects in
 * the observation side of the oracle - repo-relative
 * durable paths, observed-vs-recorded equality, halt
 * oracle enforcement, and patch hygiene. The reviewer
 * (post-CORRECTION05) identified one deeper defect:
 *
 *   OBSERVATION is re-verified
 *   but
 *   PREMISE is still caller-asserted
 *
 * For example, `EXPLICIT_CWD` had a verifier check that
 * the recorded `observed cwd` matched the recorded
 * `expected cwd`, but the recorded `expected` itself was
 * supplied by the adapter caller. A forged document
 * could simply set its `expected` equal to whatever cwd
 * the session envelope already contains.
 *
 * Upstream Pi's CLI/headless mode inherits cwd from the
 * process launch directory (it does not take cwd as an
 * explicit argument). So the only durable proof that
 * Factory actually requested a particular cwd is a
 * captured launch artifact recording the executable,
 * argv, spawn cwd, and protocol that Factory used to
 * invoke Pi.
 *
 * CORRECTION06 promotes invocation evidence to a
 * first-class, durable, repo-relative artifact alongside
 * output evidence. The verifier now re-reads BOTH
 * artifacts, recomputes SHA256 of BOTH, and uses the
 * invocation artifact as the source of the oracle's
 * `expected` value (where applicable). The recorded
 * `evidence_relation.expected` becomes advisory; the
 * re-derived `expected` is authoritative.
 *
 *   LIVE_QUALIFIED =>
 *     STRUCTURALLY_VALID /\
 *     INVOCATION_ARTIFACT_REVERIFIED /\
 *     OBSERVATION_ARTIFACT_REVERIFIED /\
 *     ORACLE_RECOMPUTED_FROM_BOTH_SIDES
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve as pathResolve,
  sep as pathSep,
} from "node:path";

/**
 * Closed-world invocation protocol kinds.
 *
 * CORRECTION06 C06-01: the protocol the adapter actually
 * used to invoke the harness. The verifier independently
 * recovers this from the invocation artifact; a caller
 * that asserts a different `invocation_mode` argument
 * has no authority.
 */
export type InvocationProtocol =
  | "json"
  | "rpc"
  | "headless"
  | "interactive";

export const INVOCATION_PROTOCOLS: readonly InvocationProtocol[] = [
  "json",
  "rpc",
  "headless",
  "interactive",
] as const;

export type InvocationMode = "headless" | "interactive" | "rpc";

export const INVOCATION_MODES: readonly InvocationMode[] = [
  "headless",
  "interactive",
  "rpc",
] as const;

export function isInvocationProtocol(value: unknown): value is InvocationProtocol {
  return (
    typeof value === "string" &&
    (INVOCATION_PROTOCOLS as readonly string[]).includes(value)
  );
}

export function isInvocationMode(value: unknown): value is InvocationMode {
  return (
    typeof value === "string" &&
    (INVOCATION_MODES as readonly string[]).includes(value)
  );
}

/**
 * The durably-recorded invocation facts that the
 * verifier re-reads to derive the oracle's `expected`
 * side. This is the C06-01 first-class artifact.
 *
 * Every field MUST be re-derivable from the artifact on
 * disk; the verifier does NOT trust any caller-supplied
 * expected value.
 */
export type InvocationEvidence = {
  readonly capability: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly spawn_cwd: string;
  readonly protocol: InvocationProtocol;
  readonly invocation_mode: InvocationMode;
  readonly session_dir: string | null;
  readonly no_session: boolean;
  readonly env_subset: Readonly<Record<string, string>>;
  readonly artifact_sha256: string;
  readonly recorded_at: string;
};

/**
 * Serialize and write a typed `InvocationEvidence` to a
 * repo-relative path. The artifact is JSON for human
 * inspectability; the verifier recomputes SHA256 from
 * the on-disk bytes.
 *
 * The on-disk artifact does NOT embed the
 * `artifact_sha256` field. The sha is computed over the
 * on-disk bytes (which have no sha field) and returned
 * in-memory to the caller. The verifier reads the file,
 * recomputes the sha over the bytes it sees, and
 * compares to the caller's recorded sha — they always
 * agree because the on-disk file has no embedded sha.
 */
export function writeInvocationEvidence(args: {
  readonly repoRoot: string;
  readonly repo_relative_path: string;
  readonly evidence: Omit<InvocationEvidence, "artifact_sha256">;
}): InvocationEvidence {
  if (isAbsolute(args.repo_relative_path)) {
    throw new Error(
      `writeInvocationEvidence: repo_relative_path must be repo-relative; got '${args.repo_relative_path}'`,
    );
  }
  const absRepo = pathResolve(args.repoRoot);
  const target = join(absRepo, args.repo_relative_path);
  const rel = relative(absRepo, target);
  if (rel === ".." || rel.startsWith(".." + pathSep)) {
    throw new Error(
      `writeInvocationEvidence: repo_relative_path '${args.repo_relative_path}' escapes repoRoot '${absRepo}'`,
    );
  }
  const bytes = Buffer.from(JSON.stringify(args.evidence, null, 2), "utf8");
  const sha = createHash("sha256").update(bytes).digest("hex");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, "utf8");
  return { ...args.evidence, artifact_sha256: sha };
}

/**
 * Re-read a typed `InvocationEvidence` from disk. Returns
 * `null` if the file is missing or malformed; otherwise
 * the parsed evidence.
 */
export function readInvocationEvidence(
  repo_relative_path: string,
  repoRoot: string,
): InvocationEvidence | null {
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
  if (
    typeof obj["executable"] !== "string" ||
    !Array.isArray(obj["argv"]) ||
    typeof obj["spawn_cwd"] !== "string" ||
    !isInvocationProtocol(obj["protocol"]) ||
    typeof obj["env_subset"] !== "object" ||
    obj["env_subset"] === null ||
    typeof obj["recorded_at"] !== "string" ||
    typeof obj["capability"] !== "string"
  ) {
    return null;
  }
  // CORRECTION06: artifact_sha256 is optional in the
  // on-disk artifact. The verifier recomputes the sha
  // from the on-disk bytes and compares to whatever the
  // caller recorded. The on-disk file itself does NOT
  // embed the sha field (see writeInvocationEvidence).
  if (
    obj["artifact_sha256"] !== undefined &&
    typeof obj["artifact_sha256"] !== "string"
  ) {
    return null;
  }
  const sessionDirRaw = obj["session_dir"];
  if (sessionDirRaw !== null && typeof sessionDirRaw !== "string") {
    return null;
  }
  const mode = obj["invocation_mode"];
  if (!isInvocationMode(mode)) return null;
  const noSession = obj["no_session"];
  if (typeof noSession !== "boolean") return null;
  const argv: string[] = [];
  for (const a of obj["argv"] as unknown[]) {
    if (typeof a !== "string") return null;
    argv.push(a);
  }
  const envObj = obj["env_subset"] as Record<string, unknown>;
  const env_subset: Record<string, string> = {};
  for (const k of Object.keys(envObj)) {
    if (typeof envObj[k] !== "string") return null;
    env_subset[k] = envObj[k];
  }
  return {
    capability: obj["capability"] as string,
    executable: obj["executable"] as string,
    argv,
    spawn_cwd: obj["spawn_cwd"] as string,
    protocol: obj["protocol"] as InvocationProtocol,
    invocation_mode: mode,
    session_dir: sessionDirRaw as string | null,
    no_session: noSession,
    env_subset,
    artifact_sha256: (obj["artifact_sha256"] as string) ?? "",
    recorded_at: obj["recorded_at"] as string,
  };
}
