/**
 * FOUNDATION04 — PHASE D — Experiment Subject Contract.
 *
 * The trust-boundary decoder for SubjectManifest. This is the
 * RUNTIME AUTHORITY for manifest validity; JSON Schema is
 * treated as an interchange artifact only.
 *
 * Doctrine (D-C01 — decoder totality):
 *
 *   `decodeSubjectManifest` NEVER throws. It returns a
 *   discriminated union: either a fully-validated
 *   {@link DecodedSubject} (which carries the parsed manifest
 *   and its canonical SubjectId), or a typed
 *   {@link SubjectDecodeFailure} that names the failure mode
 *   and a machine-readable reason.
 *
 *   The decoder is the ONE place in the Phase D surface
 *   where the boundary between "arbitrary bytes" and
 *   "validated manifest" is crossed. To keep its promise to
 *   never throw, it must:
 *
 *     1. Run the structural validator (subject-validate.ts)
 *        FIRST. If the input has the wrong shape, return a
 *        `schema_validation` failure immediately.
 *     2. Run the JsonValue validator (subject-json.ts) on
 *        model.configuration BEFORE handing it to
 *        computeSubjectId. This prevents exotic JavaScript
 *        values (undefined, NaN, BigInt, Symbol, Date, Map,
 *        Set, Promise, cycles, ...) from reaching
 *        canonicalize() and triggering a throw.
 *     3. Compose the typed SubjectManifest by reading only
 *        the field types it has just structurally and
 *        JsonValue-validated.
 *
 *   Failure kinds are closed-world. Callers can pattern-
 *   match on `failure.kind` to decide what to do without
 *   try/catch.
 */

import { computeSubjectId } from "./subject-id.js";
import { validateJsonValue } from "./subject-json.js";
import {
  SUBJECT_SCHEMA_VERSION,
  makeExperimentId,
  makeSubjectIdHint,
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
import { validateSubjectManifest } from "./subject-validate.js";

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
 *   "not_an_object"      : input was not a JSON object
 *   "schema_validation"  : validateSubjectManifest returned
 *                          ok:false (structural violation,
 *                          unknown key, bad type, bad enum,
 *                          bad SHA, etc.)
 *   "configuration_value": model.configuration passed the
 *                          "is it an object?" check but
 *                          failed the recursive JsonValue
 *                          check (undefined, NaN, BigInt,
 *                          cycle, Date, ...).
 *   "boundary_exception" : a Proxy trap or throwing getter
 *                          escaped the validator's own
 *                          defensive try/catch (D-M01). The
 *                          outer defensive boundary in this
 *                          decoder caught it.
 *   "id_construction"    : a branded-identifier constructor
 *                          rejected an otherwise-structurally
 *                          valid string. Included defensively;
 *                          should be unreachable given the
 *                          validator.
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
    readonly kind: "configuration_value";
    readonly reason: string;
  }
  | {
    readonly kind: "boundary_exception";
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
 * SubjectId. On failure returns a typed
 * SubjectDecodeFailure with a closed-world `kind`.
 *
 * Trust boundary: this is the ONE place where arbitrary
 * input becomes a SubjectManifest. Every error path is a
 * typed failure; there is no `throw` site reachable from
 * caller input.
 *
 * Proxy / hostile-input semantics (D-M01):
 *
 *   Although the inner validators (validateSubjectManifest,
 *   validateJsonValue) wrap their own bodies in try/catch
 *   for Proxy-trap defense, the decoder itself performs
 *   `String(...)`, `Number(...)`, and object-property reads
 *   directly on caller-controlled values to compose the
 *   typed SubjectManifest. A throwing Proxy `get` trap on
 *   any property read could escape. The outer try/catch
 *   here is the final defensive boundary that guarantees
 *   the public contract: `decodeSubjectManifest(unknown)`
 *   NEVER throws.
 *
 *   On escape, returns a typed `boundary_exception` failure.
 */
export function decodeSubjectManifest(input: unknown): SubjectDecodeResult {
  try {
    return decodeSubjectManifestInner(input);
  } catch (e: unknown) {
    return {
      ok: false,
      failure: {
        kind: "boundary_exception",
        reason:
          "boundary_exception during manifest decoding: " +
          (e instanceof Error ? e.message : String(e)),
      },
    };
  }
}

function decodeSubjectManifestInner(input: unknown): SubjectDecodeResult {
  // (1) Top-level type guard.
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input)
  ) {
    return {
      ok: false,
      failure: {
        kind: "not_an_object",
        reason:
          "manifest root must be a plain object (not array, null, " +
          "or primitive)",
      },
    };
  }

  // (2) Structural validation.
  const v = validateSubjectManifest(input);
  if (!v.ok) {
    // The validator returns `ok:false` for BOTH ordinary
    // structural violations AND boundary_exception escapes
    // (Proxy traps). Plumb the boundary kind up so the
    // decoder surfaces the right typed failure rather than
    // silently downgrading it to schema_validation.
    if (v.reason.startsWith("boundary_exception")) {
      return {
        ok: false,
        failure: {
          kind: "boundary_exception",
          reason: v.reason,
        },
      };
    }
    return {
      ok: false,
      failure: {
        kind: "schema_validation",
        reason: v.reason,
      },
    };
  }

  // (3) Recursive JsonValue validation of model.configuration.
  //    `validateSubjectManifest` returned ok:true, so we have
  //    mechanically verified that input is a plain object —
  //    narrow it once here for the rest of the function.
  const root0 = input as Record<string, unknown>;
  const model0 = root0.model as Record<string, unknown>;
  const configCheck = validateJsonValue(
    model0.configuration,
    "model.configuration",
  );
  if (!configCheck.ok) {
    // Same plumbing as (2): boundary_exception reasons
    // are surfaced as their own kind.
    if (configCheck.reason.includes("boundary_exception")) {
      return {
        ok: false,
        failure: {
          kind: "boundary_exception",
          reason: configCheck.reason,
        },
      };
    }
    return {
      ok: false,
      failure: {
        kind: "configuration_value",
        reason: configCheck.reason,
      },
    };
  }

  // (4) Compose the typed SubjectManifest.
  const root = input as Record<string, unknown>;
  const harnessIn = root.harness as Record<string, unknown>;
  const modelIn = root.model as Record<string, unknown>;
  const promptIn = root.prompt as Record<string, unknown>;
  const taskIn = root.task as Record<string, unknown>;
  const repoIn = root.repository as Record<string, unknown>;
  const budgetIn = root.budget as Record<string, unknown>;
  const capsIn = root.capabilities as Record<string, unknown>;
  const repIn = root.repetition as Record<string, unknown>;

  const reasons: SubjectDecodeFailure[] = [];
  const experimentId = brandOrFail<ExperimentId>(
    "experiment_id",
    String(root.experiment_id),
    makeExperimentId,
    reasons,
  );
  const subjectIdHint = brandOrFail<SubjectIdHint>(
    "subject_id_hint",
    String(root.subject_id_hint),
    makeSubjectIdHint,
    reasons,
  );
  if (reasons.length > 0) {
    const first = reasons[0];
    if (first !== undefined) {
      return { ok: false, failure: first };
    }
  }

  // Note on configuration freezing: the decoder does NOT
  // freeze here. freezeSubject (subject-frozen.ts) is the
  // single chokepoint for deep-freeze.
  const configuration = modelIn.configuration as Readonly<
    Record<string, unknown>
  >;

  const harness: SubjectHarness = {
    id: String(harnessIn.id),
    version: String(harnessIn.version),
    source_revision: String(harnessIn.source_revision),
  };

  const model: SubjectModel = {
    provider: String(modelIn.provider),
    model_id: String(modelIn.model_id),
    configuration,
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
    dirty_policy: repoIn.dirty_policy as SubjectRepository["dirty_policy"],
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
    tools: Object.freeze(
      (capsIn.tools as ReadonlyArray<unknown>).map((s) => String(s)),
    ) as ReadonlyArray<string>,
    network: capsIn.network as boolean,
    filesystem: capsIn.filesystem as boolean,
    execution_policy: capsIn.execution_policy as
      SubjectCapabilities["execution_policy"],
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

  // (5) Derive the canonical SubjectId. By this point the
  // manifest is structurally and JsonValue-valid, so
  // computeSubjectId cannot throw.
  const subjectId = computeSubjectId(manifest);

  return {
    ok: true,
    value: {
      manifest,
      subjectId,
    },
  };
}
