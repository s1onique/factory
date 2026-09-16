/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * The trust-boundary decoder for SubjectManifest. This is the
 * RUNTIME AUTHORITY for manifest validity; JSON Schema is
 * treated as an interchange artifact only.
 *
 * Doctrine:
 *
 *   `decodeSubjectManifest` NEVER throws. It returns a
 *   discriminated union: either a fully-validated
 *   {@link DecodedSubject} (which carries the parsed manifest
 *   and its canonical SubjectId), or a typed
 *   {@link SubjectDecodeFailure} that names the failure mode
 *   and a machine-readable reason.
 *
 *   The failure shape is small and closed-world. Callers can
 *   safely pattern-match on `failure.kind` to decide what
 *   to do (reject the input, log it, etc.) without try/catch.
 *
 *   Trust boundary: `decodeSubjectManifest` accepts
 *   `unknown`. It is the ONE place in the Phase D surface
 *   where the boundary between "arbitrary bytes" and
 *   "validated manifest" is crossed.
 */

import { computeSubjectId } from "./subject-id.js";
import {
  SUBJECT_SCHEMA_VERSION,
  makeExperimentId,
  makeSubjectIdHint,
  validateSubjectManifest,
  type ExperimentId,
  type SubjectCapabilities,
  type SubjectBudget,
  type SubjectHarness,
  type SubjectId,
  type SubjectIdHint,
  type SubjectManifest,
  type SubjectModel,
  type SubjectPrompt,
  type SubjectRepetition,
  type SubjectRepository,
  type SubjectSchemaVersion,
  type SubjectTask,
} from "./subject-types.js";

/**
 * The full validated subject: parsed manifest plus the
 * canonical SubjectId derived from it.
 */
export type DecodedSubject = {
  readonly manifest: SubjectManifest;
  readonly subjectId: SubjectId;
};

/**
 * Closed-world failure shape. Callers can match on `kind`.
 *
 *   "not_an_object"     : input was not a JSON object
 *   "schema_validation" : validateSubjectManifest returned
 *                         ok:false (structural violation,
 *                         unknown key, etc.)
 *   "id_construction"   : a branded-identifier constructor
 *                         rejected an otherwise-structurally
 *                         valid string. Included defensively;
 *                         should be unreachable given the
 *                         validator.
 */
export type SubjectDecodeFailure =
  | {
    readonly kind: "not_an_object";
    readonly reason: string;
  }
  | {
    readonly kind: "schema_validation";
    readonly reason: string;
  }
  | {
    readonly kind: "id_construction";
    readonly field: string;
    readonly reason: string;
  };

export type SubjectDecodeResult =
  | { readonly ok: true; readonly value: DecodedSubject }
  | { readonly ok: false; readonly failure: SubjectDecodeFailure };

/**
 * Construct a typed branded id, surfacing failures as
 * SubjectDecodeFailure rather than throwing.
 */
function brandOrFail<T extends string>(
  field: string,
  value: string,
  construct: (v: string) => T,
  reasons: SubjectDecodeFailure[],
): T {
  try {
    return construct(value);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    reasons.push({
      kind: "id_construction",
      field,
      reason: msg,
    });
    return "" as T;
  }
}

/**
 * Decode and validate a SubjectManifest. NEVER throws.
 *
 * On success returns the parsed manifest and its canonical
 * SubjectId. On failure returns a typed failure with a
 * machine-readable reason.
 */
export function decodeSubjectManifest(value: unknown): SubjectDecodeResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      failure: {
        kind: "not_an_object",
        reason: "input must be a JSON object",
      },
    };
  }

  const v = validateSubjectManifest(value);
  if (!v.ok) {
    return {
      ok: false,
      failure: { kind: "schema_validation", reason: v.reason },
    };
  }

  // Re-shape the validated plain object into the branded
  // SubjectManifest. The validator has already verified every
  // field's type and grammar; we narrow + brand here.
  const reasons: SubjectDecodeFailure[] = [];

  const experimentId = brandOrFail<ExperimentId>(
    "experiment_id",
    String((value as Record<string, unknown>).experiment_id),
    makeExperimentId,
    reasons,
  );
  const subjectIdHint = brandOrFail<SubjectIdHint>(
    "subject_id_hint",
    String((value as Record<string, unknown>).subject_id_hint),
    makeSubjectIdHint,
    reasons,
  );

  if (reasons.length > 0) {
    const first = reasons[0];
    if (first !== undefined) {
      return { ok: false, failure: first };
    }
  }

  const root = value as Record<string, unknown>;
  const harnessIn = root.harness as Record<string, unknown>;
  const modelIn = root.model as Record<string, unknown>;
  const promptIn = root.prompt as Record<string, unknown>;
  const taskIn = root.task as Record<string, unknown>;
  const repoIn = root.repository as Record<string, unknown>;
  const budgetIn = root.budget as Record<string, unknown>;
  const capsIn = root.capabilities as Record<string, unknown>;
  const repIn = root.repetition as Record<string, unknown>;

  const harness: SubjectHarness = {
    id: String(harnessIn.id),
    version: String(harnessIn.version),
    source_revision: String(harnessIn.source_revision),
  };

  const model: SubjectModel = {
    provider: String(modelIn.provider),
    model_id: String(modelIn.model_id),
    configuration: Object.freeze({
      ...(modelIn.configuration as Record<string, unknown>),
    }),
  };

  const prompt: SubjectPrompt = {
    prompt_id: String(promptIn.prompt_id),
    content_hash: String(promptIn.content_hash),
  };

  const task: SubjectTask = {
    task_id: String(taskIn.task_id),
    fixture_revision: String(taskIn.fixture_revision),
  };

  const repository: SubjectRepository = {
    commit: String(repoIn.commit),
    dirty_policy: repoIn.dirty_policy as "reject" | "allow-record",
  };

  const budget: SubjectBudget = {
    wall_clock_ms: Number(budgetIn.wall_clock_ms),
    turns: Number(budgetIn.turns),
    tool_calls: Number(budgetIn.tool_calls),
    ...(typeof budgetIn.token_limit === "number"
      ? { token_limit: Number(budgetIn.token_limit) }
      : {}),
  };

  const capabilities: SubjectCapabilities = {
    tools: Object.freeze([
      ...(capsIn.tools as ReadonlyArray<unknown>).map(String),
    ]) as ReadonlyArray<string>,
    network: capsIn.network as boolean,
    filesystem: capsIn.filesystem as boolean,
    execution_policy: capsIn.execution_policy as
      "sandbox" | "host" | "container",
  };

  const repetition: SubjectRepetition = {
    repetition_index: Number(repIn.repetition_index),
    ...(typeof repIn.seed === "string" ? { seed: repIn.seed } : {}),
  };

  const manifest: SubjectManifest = {
    schema_version: SUBJECT_SCHEMA_VERSION as SubjectSchemaVersion,
    experiment_id: experimentId,
    subject_id_hint: subjectIdHint,
    harness,
    model,
    prompt,
    task,
    repository,
    budget,
    capabilities,
    repetition,
  };

  const subjectId = computeSubjectId(manifest);

  return {
    ok: true,
    value: {
      manifest,
      subjectId,
    },
  };
}
