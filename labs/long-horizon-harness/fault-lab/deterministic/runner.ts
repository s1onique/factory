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
 *      authority dimension.
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
 * produce byte-identical results.
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
  readonly observedAuthority: Authority | "verifier_ok";
  readonly firstMessage: string | null;
} {
  if (args.verifierOk) {
    return {
      disposition: "ESCAPED",
      observedErrorKind: "VERIFIER_OK",
      observedAuthority: "verifier_ok",
      firstMessage: null,
    };
  }
  if (args.verifierErrors.length === 0) {
    return {
      disposition: "WRONG_AUTHORITY",
      observedErrorKind: "VERIFIER_PARSED_NULL",
      observedAuthority: "byte_hash",
      firstMessage: "verifier returned ok=false with no error list",
    };
  }
  const first: EvidenceVerificationError = args.verifierErrors[0]!;
  const observedKind = first.kind as ExpectedErrorKind;
  let observedAuthority: Authority;
  switch (observedKind) {
    case "EVIDENCE_HASH_MISMATCH":
      // Differentiate invocation vs observation byte
      // drift by message text. Both fire the same
      // closed-world error kind, but the catalog
      // distinguishes them as separate authority
      // dimensions (invocation_byte_hash vs
      // byte_hash) for finer attribution.
      observedAuthority = first.message.startsWith("Invocation artifact")
        ? "invocation_byte_hash"
        : "byte_hash";
      break;
    case "EVIDENCE_PATH_ESCAPE":
      observedAuthority = "path";
      break;
    case "EVIDENCE_PARSE_FAILED":
      observedAuthority = first.message.includes("Invocation")
        ? "invocation_derivation"
        : "oracle_semantic";
      break;
    case "EVIDENCE_OBSERVATION_MISMATCH":
      observedAuthority = "oracle_semantic";
      break;
    case "EVIDENCE_ORACLE_FAILED":
      observedAuthority = "oracle_semantic";
      break;
    case "EVIDENCE_EXECUTION_MISMATCH":
      if (first.message.includes("manifest declares capability")) {
        observedAuthority = "manifest_capability_binding";
      } else if (first.message.includes("capture_origin")) {
        observedAuthority = "manifest_origin_discriminator";
      } else if (first.message.includes("execution_id")) {
        observedAuthority = "execution_id_relationship";
      } else {
        observedAuthority = "execution_relationship";
      }
      break;
    case "EVIDENCE_ARTIFACT_MISSING":
      observedAuthority = "path";
      break;
    default:
      observedAuthority = "byte_hash";
  }
  const authorityMatches = observedAuthority === args.expectedAuthority;
  const kindMatches = observedKind === args.expectedErrorKind;
  const disposition: FaultDisposition =
    authorityMatches && kindMatches
      ? "PASS"
      : "WRONG_AUTHORITY";
  return {
    disposition,
    observedErrorKind: observedKind,
    observedAuthority,
    firstMessage: first.message,
  };
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
        observed_error_kind: "VERIFIER_PARSED_NULL",
        observed_authority: "verifier_ok",
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
      observed_error_kind: verdict.observedErrorKind,
      observed_authority: verdict.observedAuthority,
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
 * Normalize a result for determinism comparison. Strips
 * fields that legitimately vary between runs (workspace
 * paths, free-text messages) and keeps only the
 * deterministic semantic fields.
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
    observed_error_kind: result.observed_error_kind,
    observed_authority: result.observed_authority,
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

