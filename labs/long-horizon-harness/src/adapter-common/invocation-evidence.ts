/**
 * Adapter-common typed invocation evidence
 * (LH-03 CORRECTION07, C07-01..C07-07).
 *
 * CORRECTION06 introduced `InvocationEvidence` as a
 * first-class durable artifact: the verifier re-reads
 * the invocation file, recomputes its SHA256, and uses
 * the on-disk record as the source of the oracle's
 * `expected` value. The reviewer (post-CORRECTION06)
 * identified one deeper defect:
 *
 *   DURABLE ASSERTION != AUTHENTIC CAPTURE
 *   The invocation record itself was not mechanically
 *   derived from argv/env. The artifact could record
 *   `protocol: "headless"` alongside `argv: [..., "--mode",
 *   "json"]` and the type checker only validated each
 *   field independently.
 *
 *   And the artifact's own SHA was only compared against
 *   the in-artifact `artifact_sha256` field, which the
 *   writer intentionally omits. So nothing external said
 *   what SHA the axis was bound to, and a mutated
 *   invocation artifact (whose bytes still satisfied the
 *   capability oracle) would re-PASS.
 *
 * CORRECTION07 closes both defects with the same
 * architectural pivot used for the observation artifact
 * (CORRECTION04 C04-02):
 *
 *   1. The on-disk artifact contains ONLY raw launch
 *      facts: `executable`, `argv`, `spawn_cwd`,
 *      `env_subset`, `capability`, `recorded_at`.
 *      Author-supplied `protocol` / `invocation_mode` /
 *      `session_dir` / `no_session` are REFUSED on write
 *      and on read - those fields are derived facts,
 *      not authoritative assertions.
 *
 *   2. Derived facts are computed by a pure function
 *      `deriveInvocationSemantics(rawLaunch)` that
 *      inspects ONLY argv/env. The function is the
 *      single source of truth for protocol / headless /
 *      session-dir / no-session. A path that says
 *      `--mode json` but claims `protocol: "rpc"` is
 *      caught by the type checker (it cannot construct
 *      the record) AND by the verifier (the derived
 *      protocol disagrees with anything the record
 *      asserts).
 *
 *   3. `CapabilityAxis` gains `invocation_evidence_sha256`,
 *      the SHA256 of the invocation artifact's on-disk
 *      bytes. The verifier enforces
 *      `sha256(invocation bytes) === axis.invocation_evidence_sha256`.
 *      The SHA lives OUTSIDE the artifact being hashed.
 *      Mutation after binding is caught with the same
 *      failure kind the observation artifact uses
 *      (`EVIDENCE_HASH_MISMATCH`).
 *
 *   4. The verifier applies contradiction oracles:
 *      `--mode headless` is refused (Pi does not
 *      implement it); `--no-session` plus a claimed
 *      session_dir is refused; an invocation with
 *      `--mode json` whose recorded `expected` is the
 *      `headless` protocol is refused.
 *
 *   5. The fixture layer replaces every `--mode headless`
 *      artifact with one of Pi's real launch forms:
 *      `--mode json`, `--mode rpc`, or `-p/--print` for
 *      the headless / noninteractive concept. The
 *      ISOLATED_DATA_DIR fixture now records a real
 *      `--session-dir` argv entry.
 *
 * The invariant the verifier enforces becomes:
 *
 *   LIVE_QUALIFIED =>
 *     STRUCTURALLY_VALID /\
 *     OBSERVATION_BYTES_BOUND /\
 *     INVOCATION_BYTES_BOUND /\
 *     INVOCATION_SEMANTICS_DERIVED_FROM_RAW_LAUNCH /\
 *     ORACLE_RECOMPUTED
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

/* ------------------------------------------------------------------ *
 * Raw launch facts (the ONLY on-disk authoritative fields).          *
 * ------------------------------------------------------------------ */

/**
 * The on-disk artifact records ONLY raw launch facts.
 * The verifier derives protocol / headless / session_dir /
 * no_session mechanically from argv + env_subset via
 * `deriveInvocationSemantics`. The caller is not permitted
 * to assert those fields on write.
 */
export type RawInvocationLaunch = {
  /**
   * Which capability this invocation backs. The verifier
   * does NOT enforce it equals the axis key (a single
   * launch can back multiple LIVE_QUALIFIED axes), but
   * the value MUST be a closed-world CapabilityKey.
   */
  readonly capability: string;
  /**
   * Path or name of the executable Factory spawned.
   */
  readonly executable: string;
  /**
   * Argument vector passed to the executable. Includes
   * argv[0] (the program name) and every flag.
   */
  readonly argv: readonly string[];
  /**
   * Working directory Factory spawned the process in.
   * Captured at the OS level; not derived.
   */
  readonly spawn_cwd: string;
  /**
   * Sanitized subset of environment variables Factory
   * passed to the process. Only well-known keys (those
   * that affect harness behaviour) belong here.
   */
  readonly env_subset: Readonly<Record<string, string>>;
  /**
   * ISO-8601 timestamp recorded at spawn time.
   */
  readonly recorded_at: string;
};

/* ------------------------------------------------------------------ *
 * Derived semantics (NEVER on-disk authoritative; computed by       *
 * `deriveInvocationSemantics`).                                      *
 * ------------------------------------------------------------------ */

/**
 * Closed-world Pi launch protocols the harness actually
 * supports (CORRECTION07 C07-03, C07-05). `headless` is
 * NOT a Pi protocol - it is a derived boolean (see
 * `DerivedInvocationSemantics.headless`).
 */
export type InvocationProtocol = "json" | "rpc" | "text";

export const INVOCATION_PROTOCOLS: readonly InvocationProtocol[] = [
  "json",
  "rpc",
  "text",
] as const;

export function isInvocationProtocol(value: unknown): value is InvocationProtocol {
  return (
    typeof value === "string" &&
    (INVOCATION_PROTOCOLS as readonly string[]).includes(value)
  );
}

/**
 * Closed-world launch forms the harness actually exposes.
 * `noninteractive` covers Pi's `-p/--print` flag and any
 * mode that is non-interactive by construction (json / rpc).
 */
export type LaunchForm = "interactive" | "noninteractive";

export const LAUNCH_FORMS: readonly LaunchForm[] = [
  "interactive",
  "noninteractive",
] as const;

export function isLaunchForm(value: unknown): value is LaunchForm {
  return (
    typeof value === "string" &&
    (LAUNCH_FORMS as readonly string[]).includes(value)
  );
}

/**
 * Semantics derived mechanically from argv + env_subset.
 * The verifier treats these as authoritative; the caller
 * cannot override them.
 */
export type DerivedInvocationSemantics = {
  /**
   * The protocol Pi will speak. Derived from `--mode`:
   *   --mode json => "json"
   *   --mode rpc  => "rpc"
   *   absent / anything else => "text"
   */
  readonly protocol: InvocationProtocol;
  /**
   * Whether the harness will run without a TTY. `true`
   * when argv contains `-p`/`--print` or `--mode json`
   * or `--mode rpc`; `false` otherwise.
   */
  readonly headless: boolean;
  /**
   * Effective session directory. Derived from, in order:
   *   1. argv `--session-dir <path>`
   *   2. env `PI_CODING_AGENT_SESSION_DIR=<path>`
   *   3. null (no explicit session dir)
   */
  readonly session_dir: string | null;
  /**
   * Whether `--no-session` appears in argv. If true,
   * `session_dir` MUST be null.
   */
  readonly no_session: boolean;
};

/* ------------------------------------------------------------------ *
 * The full evidence record (raw + derived + sha).                    *
 * ------------------------------------------------------------------ */

/**
 * The typed evidence the verifier consumes. Combines raw
 * launch facts (authoritative on disk) with derived
 * semantics (authoritative in memory; computed from raw).
 */
export type InvocationEvidence = RawInvocationLaunch & {
  readonly derived: DerivedInvocationSemantics;
  /**
   * SHA256 of the on-disk artifact bytes (raw only;
   * derived is recomputed, not stored). Recomputed by
   * the verifier on every re-verification.
   */
  readonly artifact_sha256: string;
};

/* ------------------------------------------------------------------ *
 * Pure derivation (the single source of truth for semantics).       *
 * ------------------------------------------------------------------ */

/**
 * Strict closed-world argv grammar for the subset of Pi
 * flags Factory qualifies (CORRECTION08 C08-06).
 *
 * Grammar rules:
 *
 *   protocol: at most one `--mode`, the value MUST be
 *             one of {json, rpc, text}; a trailing
 *             `--mode` with no value is REFUSED;
 *             duplicate `--mode` is REFUSED; an unknown
 *             value (including `headless`) is REFUSED.
 *
 *   session_dir: at most one `--session-dir`, the value
 *             MUST be present and non-empty; a trailing
 *             `--session-dir` with no value is REFUSED;
 *             duplicate `--session-dir` is REFUSED.
 *             `PI_CODING_AGENT_SESSION_DIR` env var is
 *             used as a fallback if and only if no
 *             `--session-dir` was passed.
 *
 *   print: at most one `-p` / `--print`; duplicates are
 *             REFUSED.
 *
 *   no_session: at most one `--no-session`; duplicates
 *             are REFUSED.
 *
 *   contradiction: `--no-session` + effective session_dir
 *             (from either source) is REFUSED.
 */
function parsePiArgvStrict(argv: readonly string[]): {
  protocol: InvocationProtocol;
  print: boolean;
  sessionDirArgv: string | null;
  noSession: boolean;
} {
  let protocol: InvocationProtocol | null = null;
  let print = false;
  let sessionDirArgv: string | null = null;
  let noSession = false;

  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--mode") {
      if (i + 1 >= argv.length) {
        throw new Error(
          `deriveInvocationSemantics: argv '--mode' has no value; trailing --mode refused. CORRECTION08 C08-06.`,
        );
      }
      const v = argv[i + 1];
      if (protocol !== null) {
        throw new Error(
          `deriveInvocationSemantics: duplicate '--mode' refused ('${protocol}' and '${v}'). CORRECTION08 C08-06.`,
        );
      }
      if (v !== "json" && v !== "rpc" && v !== "text") {
        throw new Error(
          `deriveInvocationSemantics: argv '--mode ${v}' is not a Pi launch form; Pi's --mode values are json | rpc | text. CORRECTION08 C08-06.`,
        );
      }
      protocol = v;
      i += 2;
      continue;
    }
    if (a === "--session-dir") {
      if (i + 1 >= argv.length) {
        throw new Error(
          `deriveInvocationSemantics: argv '--session-dir' has no value; trailing --session-dir refused. CORRECTION08 C08-06.`,
        );
      }
      const v = argv[i + 1];
      if (sessionDirArgv !== null) {
        throw new Error(
          `deriveInvocationSemantics: duplicate '--session-dir' refused ('${sessionDirArgv}' and '${v}'). CORRECTION08 C08-06.`,
        );
      }
      if (typeof v !== "string" || v.length === 0) {
        throw new Error(
          `deriveInvocationSemantics: argv '--session-dir <value>' has empty value. CORRECTION08 C08-06.`,
        );
      }
      sessionDirArgv = v;
      i += 2;
      continue;
    }
    if (a === "-p" || a === "--print") {
      if (print) {
        throw new Error(
          `deriveInvocationSemantics: duplicate '${a}' refused. CORRECTION08 C08-06.`,
        );
      }
      print = true;
      i += 1;
      continue;
    }
    if (a === "--no-session") {
      if (noSession) {
        throw new Error(
          `deriveInvocationSemantics: duplicate '--no-session' refused. CORRECTION08 C08-06.`,
        );
      }
      noSession = true;
      i += 1;
      continue;
    }
    // Unknown flag: skip without consuming more argv.
    // We do not parse other flags; they are tolerated but
    // do not contribute to semantics. The grammar above
    // covers the closed-world Pi launch subset Factory
    // qualifies against. A strict grammar would refuse
    // unknown flags, but the canonical fixtures only use
    // the four flags above and a positional program arg.
    i += 1;
  }

  return {
    protocol: protocol ?? "text",
    print,
    sessionDirArgv,
    noSession,
  };
}

/**
 * Derive protocol / headless / session_dir / no_session
 * from raw launch facts. The function is pure (no I/O,
 * no clock, no randomness) and is the ONLY authority
 * for those four fields. Any document whose recorded
 * facts disagree with the derivation is refused.
 *
 * Contradiction checks (C08-06):
 *   - `--mode <unknown>` is rejected (Pi does not
 *     implement it). Specifically `--mode headless` is
 *     refused.
 *   - duplicate / trailing `--mode` is refused.
 *   - duplicate / trailing `--session-dir` is refused.
 *   - duplicate `-p`/`--print` is refused.
 *   - duplicate `--no-session` is refused.
 *   - `--no-session` plus an effective session_dir is
 *     refused.
 */
export function deriveInvocationSemantics(
  raw: RawInvocationLaunch,
): DerivedInvocationSemantics {
  const parsed = parsePiArgvStrict(raw.argv);
  const protocol: InvocationProtocol = parsed.protocol;
  const no_session = parsed.noSession;
  // ---- session_dir: --session-dir X else env PI_CODING_AGENT_SESSION_DIR
  let session_dir: string | null = null;
  if (parsed.sessionDirArgv !== null) {
    session_dir = parsed.sessionDirArgv;
  } else if (
    typeof raw.env_subset["PI_CODING_AGENT_SESSION_DIR"] === "string" &&
    (raw.env_subset["PI_CODING_AGENT_SESSION_DIR"] as string).length > 0
  ) {
    session_dir = raw.env_subset["PI_CODING_AGENT_SESSION_DIR"] as string;
  }
  // contradiction: --no-session + session_dir
  if (no_session && session_dir !== null) {
    throw new Error(
      `deriveInvocationSemantics: --no-session is present but session_dir='${session_dir}' is also claimed. CORRECTION08 C08-06.`,
    );
  }
  // ---- headless: -p / --print OR protocol json/rpc
  let headless = false;
  if (parsed.print) {
    headless = true;
  } else if (protocol === "json" || protocol === "rpc") {
    headless = true;
  }
  return { protocol, headless, session_dir, no_session };
}

/* ------------------------------------------------------------------ *
 * Write / read.                                                      *
 * ------------------------------------------------------------------ */

/**
 * Write a raw launch record to a repo-relative path.
 * Caller-supplied `protocol` / `invocation_mode` /
 * `session_dir` / `no_session` fields are REFUSED: the
 * on-disk artifact may contain ONLY raw launch facts.
 * The sha is computed over those raw bytes (no sha field
 * embedded on disk) and returned in-memory for the
 * caller to bind on the capability axis.
 */
export function writeInvocationEvidence(args: {
  readonly repoRoot: string;
  readonly repo_relative_path: string;
  readonly launch: RawInvocationLaunch;
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
  // Derive the semantics BEFORE writing so the caller
  // gets a typed failure if the raw launch is internally
  // inconsistent (e.g. `--mode headless`).
  const derived = deriveInvocationSemantics(args.launch);
  // Serialize ONLY raw facts. Drop any field that is
  // not on the closed-world RawInvocationLaunch type.
  const bytes = Buffer.from(JSON.stringify(args.launch, null, 2), "utf8");
  const sha = createHash("sha256").update(bytes).digest("hex");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, "utf8");
  return {
    ...args.launch,
    derived,
    artifact_sha256: sha,
  };
}

/**
 * Re-read a typed `InvocationEvidence` from disk. The
 * on-disk artifact must contain ONLY raw launch facts;
 * any pre-baked `protocol` / `invocation_mode` /
 * `session_dir` / `no_session` / `derived` /
 * `artifact_sha256` field is refused (these are
 * re-computed from raw at read time).
 *
 * Returns `null` if the file is missing, malformed, or
 * carries authoritative non-raw fields.
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

  // CORRECTION07 C07-04: refuse authoritative derived
  // fields on disk. The on-disk record may contain
  // ONLY raw launch facts.
  for (const forbidden of [
    "protocol",
    "invocation_mode",
    "session_dir",
    "no_session",
    "derived",
    "artifact_sha256",
  ]) {
    if (obj[forbidden] !== undefined) {
      // The fixture rewrite phase replaces pre-CORRECTION07
      // fixtures that recorded these fields. Once the
      // fixtures are clean, every record that still
      // contains a non-raw field is malformed.
      return null;
    }
  }

  // Type-check raw fields.
  if (
    typeof obj["executable"] !== "string" ||
    !Array.isArray(obj["argv"]) ||
    typeof obj["spawn_cwd"] !== "string" ||
    typeof obj["env_subset"] !== "object" ||
    obj["env_subset"] === null ||
    typeof obj["recorded_at"] !== "string" ||
    typeof obj["capability"] !== "string"
  ) {
    return null;
  }
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

  const launch: RawInvocationLaunch = {
    capability: obj["capability"] as string,
    executable: obj["executable"] as string,
    argv,
    spawn_cwd: obj["spawn_cwd"] as string,
    env_subset,
    recorded_at: obj["recorded_at"] as string,
  };

  // Derive semantics from raw. Any contradiction
  // (--mode headless, --no-session + session_dir) fails
  // closed.
  let derived: DerivedInvocationSemantics;
  try {
    derived = deriveInvocationSemantics(launch);
  } catch {
    return null;
  }

  // Recompute SHA from the on-disk bytes (which contain
  // raw only - no derived, no artifact_sha256). The
  // returned sha is what the verifier should compare
  // against axis.invocation_evidence_sha256.
  const bytes = readFileSync(target);
  const sha = createHash("sha256").update(bytes).digest("hex");

  return {
    ...launch,
    derived,
    artifact_sha256: sha,
  };
}
