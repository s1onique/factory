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
    | "structured_error_kind_plus_axis_context"
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
 * Classify the authority under which the verifier's
 * FIRST error was emitted.
 *
 * The frozen LH-03 verifier emits a structured
 * `EvidenceVerificationErrorKind`; this function maps
 * that structured field to the lab's authority label.
 * For two error kinds
 * (`EVIDENCE_HASH_MISMATCH`, `EVIDENCE_PARSE_FAILED`)
 * the structured field alone does not uniquely identify
 * the authority axis (e.g. an invocation byte-drift and
 * an observation byte-drift both fire
 * `EVIDENCE_HASH_MISMATCH`), so the lab uses the
 * verbatim error `message` as a disambiguator.
 *
 * The classification method is recorded alongside the
 * label so reviewers can see when the lab is relying
 * on message-text inference vs structured output.
 */
export function classifyAuthority(err: EvidenceVerificationError): {
  readonly authority: Authority;
  readonly method:
    | "structured_error_kind"
    | "structured_error_kind_plus_axis_context"
    | "message_prefix_inference";
} {
  switch (err.kind) {
    case "EVIDENCE_PATH_ESCAPE":
      return { authority: "path", method: "structured_error_kind" };
    case "EVIDENCE_OBSERVATION_MISMATCH":
      return { authority: "oracle_semantic", method: "structured_error_kind" };
    case "EVIDENCE_ORACLE_FAILED":
      return { authority: "oracle_semantic", method: "structured_error_kind" };
    case "EVIDENCE_ARTIFACT_MISSING":
      return { authority: "path", method: "structured_error_kind" };
    case "EVIDENCE_HASH_MISMATCH":
      // invocation vs observation byte drift share one
      // error kind; disambiguate by message prefix.
      return err.message.startsWith("Invocation artifact")
        ? {
            authority: "invocation_byte_hash",
            method: "message_prefix_inference",
          }
        : { authority: "byte_hash", method: "structured_error_kind" };
    case "EVIDENCE_PARSE_FAILED":
      // invocation parse failure vs observation parse
      // failure share one error kind; disambiguate by
      // message text.
      return err.message.includes("Invocation")
        ? {
            authority: "invocation_derivation",
            method: "message_prefix_inference",
          }
        : { authority: "oracle_semantic", method: "structured_error_kind" };
    case "EVIDENCE_EXECUTION_MISMATCH":
      // The execution_mismatch error kind covers four
      // axes (relationship, capability binding, origin
      // discriminator, execution_id relationship); the
      // verifier message names which axis failed.
      if (err.message.includes("manifest declares capability")) {
        return {
          authority: "manifest_capability_binding",
          method: "message_prefix_inference",
        };
      }
      if (err.message.includes("capture_origin")) {
        return {
          authority: "manifest_origin_discriminator",
          method: "message_prefix_inference",
        };
      }
      if (err.message.includes("execution_id")) {
        return {
          authority: "execution_id_relationship",
          method: "message_prefix_inference",
        };
      }
      return {
        authority: "execution_relationship",
        method: "structured_error_kind",
      };
    default:
      return {
        authority: "byte_hash",
        method: "structured_error_kind",
      };
  }
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
