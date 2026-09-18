/**
 * LH-04 deterministic fault laboratory — runner.
 *
 * For each FaultExperiment the runner:
 *
 *   1. Creates a fresh tmp workspace and copies
 *      `CANONICAL_BASELINE_FILES` from the lab repoRoot
 *      into the workspace.
 *
 *   2. Verifies the unmutated baseline passes the
 *      closed-world verifier. If not, the experiment is
 *      `BASELINE_REGRESSION` and is not qualified.
 *
 *   3. Invokes the experiment's `mutate` closure,
 *      which tampers with exactly the intended
 *      authority dimension (or, for `COMPOUND_*`
 *      taxonomies, the documented compound shape).
 *
 *   4. Re-builds the baseline from the mutated
 *      workspace, runs the verifier, and classifies
 *      the FIRST error kind it emits.
 *
 *   5. Returns a typed `FaultExperimentResult` whose
 *      `disposition` reflects whether the fault was
 *      detected at the expected authority / error
 *      kind.
 *
 * `runFaultMatrix` runs every experiment in a catalog
 * and returns the deterministic set of results. Two
 * consecutive calls from clean tmp workspaces MUST
 * produce semantically identical results
 * (`TWO_RUN_SEMANTIC_REPEATABILITY`, NOT byte-identity:
 * the result artifact embeds `emitted_at` ISO timestamps).
 */
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  verifyLiveQualificationEvidence,
  type EvidenceVerificationError,
} from "../../src/adapter-common/evidence-verifier.js";
import type { HarnessCapabilities } from "../../src/protocol/index.js";
import {
  buildCanonicalBaseline,
  CANONICAL_BASELINE_FILES,
} from "./baseline.js";
import { copyFixtureTree } from "./mutations.js";
import {
  type Authority,
  type ExpectedErrorKind,
  type FaultExperiment,
  type FaultExperimentResult,
  type FaultDisposition,
} from "./types.js";

export function prepareWorkspace(args: {
  readonly repoRoot: string;
  readonly label: string;
}): string {
  const base = process.env["FACTORY_LH04_WORKSPACE_BASE"] ?? tmpdir();
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true });
  }
  const ws = mkdtempSync(`${base.replace(/\/$/, "")}/lh04-${args.label}-`);
  copyFixtureTree({
    repoRoot: args.repoRoot,
    workspaceRoot: ws,
    files: CANONICAL_BASELINE_FILES,
  });
  return ws;
}

export function cleanupWorkspace(workspaceRoot: string): void {
  try {
    rmSync(workspaceRoot, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

export function classify(args: {
  readonly verifierOk: boolean;
  readonly verifierErrors: readonly EvidenceVerificationError[];
  readonly expectedAuthority: Authority;
  readonly expectedErrorKind: ExpectedErrorKind;
}): {
  readonly disposition: FaultDisposition;
  readonly observedErrorKind: ExpectedErrorKind | "VERIFIER_OK" | "VERIFIER_PARSED_NULL";
  readonly classifiedAuthority: Authority | "verifier_ok";
  readonly classifiedAuthorityMethod:
    | "structured_error_kind"
    | "message_prefix_inference";
  readonly firstMessage: string | null;
} {
  if (args.verifierOk) {
    return {
      disposition: "ESCAPED",
      observedErrorKind: "VERIFIER_OK",
      classifiedAuthority: "verifier_ok",
      classifiedAuthorityMethod: "structured_error_kind",
      firstMessage: null,
    };
  }
  if (args.verifierErrors.length === 0) {
    return {
      disposition: "WRONG_AUTHORITY",
      observedErrorKind: "VERIFIER_PARSED_NULL",
      classifiedAuthority: "byte_hash",
      classifiedAuthorityMethod: "structured_error_kind",
      firstMessage: "verifier returned ok=false with no error list",
    };
  }
  const first: EvidenceVerificationError = args.verifierErrors[0]!;
  const observedKind = first.kind as ExpectedErrorKind;
  const classified = classifyAuthority(first);
  const authorityMatches = classified.authority === args.expectedAuthority;
  const kindMatches = observedKind === args.expectedErrorKind;
  const disposition: FaultDisposition =
    authorityMatches && kindMatches
      ? "PASS"
      : "WRONG_AUTHORITY";
  return {
    disposition,
    observedErrorKind: observedKind,
    classifiedAuthority: classified.authority,
    classifiedAuthorityMethod: classified.method,
    firstMessage: first.message,
  };
}

/**
 * Authority classification provenance table (L04-C07).
 *
 * The frozen LH-03 verifier emits only a structured
 * `EvidenceVerificationErrorKind`. The lab maps that
 * kind (plus, in some cases, verbatim message text) to
 * its own `Authority` label. This table records, for
 * EVERY possible classification branch, what the lab
 * relied on to reach the label.
 *
 * Method semantics (must NOT be understated):
 *
 *   "structured_error_kind"
 *     The kind alone, without any message inspection,
 *     uniquely identifies the authority.
 *
 *   "message_prefix_inference"
 *     The kind alone does NOT identify the authority;
 *     the lab reads the error message to disambiguate.
 *     This includes the "default" / "fallback" branches
 *     below: the lab reached them by failing to match
 *     any of the message discriminators above, which is
 *     also a form of message inspection.
 *
 * The previous design listed some branches as
 * "structured" while the corresponding classifier used
 * negative matching against the message text. That was
 * an understatement. Every branch here is honest.
 */
type AuthorityMethod = "structured_error_kind" | "message_prefix_inference";

interface ClassifierRule {
  readonly authority: Authority;
  readonly method: AuthorityMethod;
}

const CLASSIFIER_TABLE: Readonly<Record<string, readonly ClassifierRule[]>> = {
  // kind              : [ordered rules — first match wins; default is the
  //                      trailing rule]
  EVIDENCE_PATH_ESCAPE: [
    // The verifier emits this kind ONLY when a path escape is
    // detected. No further disambiguation needed.
    { authority: "path", method: "structured_error_kind" },
  ],
  EVIDENCE_ARTIFACT_MISSING: [
    { authority: "path", method: "structured_error_kind" },
  ],
  EVIDENCE_OBSERVATION_MISMATCH: [
    { authority: "oracle_semantic", method: "structured_error_kind" },
  ],
  EVIDENCE_ORACLE_FAILED: [
    { authority: "oracle_semantic", method: "structured_error_kind" },
  ],
  EVIDENCE_HASH_MISMATCH: [
    // Positive: message starts with "Invocation artifact" →
    // invocation-side byte drift.
    // Default (negative match): every other byte drift is
    // observation-side. This default is STILL message
    // inference — it depends on the message NOT containing
    // the invocation prefix.
    { authority: "invocation_byte_hash", method: "message_prefix_inference" },
    { authority: "byte_hash", method: "message_prefix_inference" },
  ],
  EVIDENCE_PARSE_FAILED: [
    // Positive: message contains "Invocation" → invocation
    // parse failure (grammar / shape mismatch on the
    // invocation artifact).
    // Default (negative match): every other parse failure is
    // on the observation side → oracle_semantic. Still
    // message inference.
    { authority: "invocation_derivation", method: "message_prefix_inference" },
    { authority: "oracle_semantic", method: "message_prefix_inference" },
  ],
  EVIDENCE_EXECUTION_MISMATCH: [
    // Three positive matches and one default. The default
    // ("execution_relationship") is reached only because
    // none of the three positive discriminators matched —
    // i.e. it is also message inference (negative match).
    { authority: "manifest_capability_binding", method: "message_prefix_inference" },
    { authority: "manifest_origin_discriminator", method: "message_prefix_inference" },
    { authority: "execution_id_relationship", method: "message_prefix_inference" },
    { authority: "execution_relationship", method: "message_prefix_inference" },
  ],
};

const KIND_DISCRIMINATORS: Readonly<Record<string, ReadonlyArray<(msg: string) => boolean>>> = {
  EVIDENCE_PATH_ESCAPE: [() => true],
  EVIDENCE_ARTIFACT_MISSING: [() => true],
  EVIDENCE_OBSERVATION_MISMATCH: [() => true],
  EVIDENCE_ORACLE_FAILED: [() => true],
  EVIDENCE_HASH_MISMATCH: [
    (msg) => msg.startsWith("Invocation artifact"),
    () => true,
  ],
  EVIDENCE_PARSE_FAILED: [
    (msg) => msg.includes("Invocation"),
    () => true,
  ],
  EVIDENCE_EXECUTION_MISMATCH: [
    (msg) => msg.includes("manifest declares capability"),
    (msg) => msg.includes("capture_origin"),
    (msg) => msg.includes("execution_id"),
    () => true,
  ],
};

/**
 * Classify the authority under which the verifier's
 * FIRST error was emitted. See `CLASSIFIER_TABLE`
 * for the full per-branch provenance map.
 */
export function classifyAuthority(err: EvidenceVerificationError): {
  readonly authority: Authority;
  readonly method: AuthorityMethod;
} {
  const rules = CLASSIFIER_TABLE[err.kind];
  const discriminators = KIND_DISCRIMINATORS[err.kind];
  if (rules !== undefined && discriminators !== undefined) {
    for (let i = 0; i < discriminators.length; i++) {
      if (discriminators[i]!(err.message)) {
        return rules[i]!;
      }
    }
  }
  // Unreachable for any `EvidenceVerificationErrorKind`
  // emitted by the frozen LH-03 verifier; the table covers
  // all seven kinds.
  return { authority: "byte_hash", method: "structured_error_kind" };
}

/**
 * Run a single fault experiment.
 */
export async function runFaultExperiment(args: {
  readonly repoRoot: string;
  readonly experiment: FaultExperiment;
  readonly baselineBuilder?: (workspaceRoot: string) => HarnessCapabilities;
}): Promise<FaultExperimentResult> {
  const ws = prepareWorkspace({
    repoRoot: args.repoRoot,
    label: args.experiment.id.toLowerCase(),
  });
  try {
    const builder: (workspaceRoot: string) => HarnessCapabilities =
      args.baselineBuilder !== undefined
        ? args.baselineBuilder
        : (ws: string) => buildCanonicalBaseline({ workspaceRoot: ws });
    const baseline = builder(ws);
    const baselineResult = verifyLiveQualificationEvidence(baseline, ws);
    if (baselineResult.ok !== true) {
      const baselineErrs = baselineResult.errors;
      return {
        id: args.experiment.id,
        description: args.experiment.description,
        expected_authority: args.experiment.expected_authority,
        expected_error_kind: args.experiment.expected_error_kind,
        mutated_dimension: args.experiment.mutated_dimension,
        preserved_dimensions: args.experiment.preserved_dimensions,
        mutation_taxonomy: args.experiment.mutation_taxonomy,
        observed_error_kind: "VERIFIER_PARSED_NULL",
        classified_authority: "verifier_ok",
        classified_authority_method: "structured_error_kind",
        observed_first_rejection_message:
          baselineErrs
            .map((e) => `${e.kind}: ${e.message}`)
            .join(" | "),
        disposition: "BASELINE_REGRESSION",
        baseline_passed: false,
        notes: `baseline failed: ${baselineErrs.length} error(s); first=${baselineErrs[0]?.kind ?? "?"}`,
      };
    }
    await args.experiment.mutate(ws);
    let mutated = builder(ws);
    if (args.experiment.postBuild !== undefined) {
      mutated = args.experiment.postBuild(ws, mutated, baseline);
    }
    const verifierResult = verifyLiveQualificationEvidence(mutated, ws);
    const verdict = classify({
      verifierOk: verifierResult.ok,
      verifierErrors: verifierResult.ok ? [] : verifierResult.errors,
      expectedAuthority: args.experiment.expected_authority,
      expectedErrorKind: args.experiment.expected_error_kind,
    });
    return {
      id: args.experiment.id,
      description: args.experiment.description,
      expected_authority: args.experiment.expected_authority,
      expected_error_kind: args.experiment.expected_error_kind,
      mutated_dimension: args.experiment.mutated_dimension,
      preserved_dimensions: args.experiment.preserved_dimensions,
      mutation_taxonomy: args.experiment.mutation_taxonomy,
      observed_error_kind: verdict.observedErrorKind,
      classified_authority: verdict.classifiedAuthority,
      classified_authority_method: verdict.classifiedAuthorityMethod,
      observed_first_rejection_message: verdict.firstMessage,
      disposition: verdict.disposition,
      baseline_passed: true,
      notes: "",
    };
  } finally {
    cleanupWorkspace(ws);
  }
}

/**
 * Run a full fault matrix and return the deterministic
 * result list.
 */
export async function runFaultMatrix(args: {
  readonly repoRoot: string;
  readonly experiments: readonly FaultExperiment[];
  readonly baselineBuilder?: (workspaceRoot: string) => HarnessCapabilities;
}): Promise<readonly FaultExperimentResult[]> {
  const out: FaultExperimentResult[] = [];
  for (const exp of args.experiments) {
    const result = await runFaultExperiment({
      repoRoot: args.repoRoot,
      experiment: exp,
      ...(args.baselineBuilder !== undefined
        ? { baselineBuilder: args.baselineBuilder }
        : {}),
    });
    out.push(result);
  }
  return out;
}

/**
 * Normalize a result for semantic-repeatability
 * comparison (`TWO_RUN_SEMANTIC_REPEATABILITY`). Strips
 * fields that legitimately vary between runs (free-text
 * messages, free-text notes) and keeps only the
 * semantically meaningful fields.
 *
 * Note: this is NOT byte-identity. The result artifact
 * itself embeds an `emitted_at` ISO timestamp; byte-
 * identical output is not claimed.
 */
export function semanticResultShape(
  result: FaultExperimentResult,
): Omit<FaultExperimentResult, "observed_first_rejection_message" | "notes"> {
  return {
    id: result.id,
    description: result.description,
    expected_authority: result.expected_authority,
    expected_error_kind: result.expected_error_kind,
    mutated_dimension: result.mutated_dimension,
    preserved_dimensions: result.preserved_dimensions,
    mutation_taxonomy: result.mutation_taxonomy,
    observed_error_kind: result.observed_error_kind,
    classified_authority: result.classified_authority,
    classified_authority_method: result.classified_authority_method,
    disposition: result.disposition,
    baseline_passed: result.baseline_passed,
  };
}

/**
 * Resolve a repo root consistently with the lh03 tests.
 * Defaults to the lab root.
 */
export function defaultRepoRoot(): string {
  return resolve(import.meta.dirname, "..", "..");
}
