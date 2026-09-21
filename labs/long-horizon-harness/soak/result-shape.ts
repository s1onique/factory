/**
 * LH-06 worker-result shape checks.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Split from `worker-result-verifier.ts` for source-size
 * discipline (HYGIENE01: every LH-06 production source
 * file MUST be <= 400 LOC).
 *
 * L06-CORRECTION11 L06-C44: structural shape validation
 * checks ONLY the closed-world geometry (presence, type,
 * size). Substrate completeness is a SEMANTIC predicate
 * (does the binding carry all six identities?) that
 * belongs to the verifier, not the shape layer. The
 * previous design conflated structural presence with
 * semantic completeness and destroyed valid negative
 * evidence (e.g. `FAIL_SEMANTIC_DRIFT` with an incomplete
 * substrate) by failing the verifier with
 * `INCOMPLETE_SUBSTRATE` before the worker's actual failure
 * record was ever inspected.
 *
 * The shape layer checks: schema, contract_version,
 * profile, supervisor_run_id, required-field presence,
 * substrate has closed-world SHAPE, substrate_complete is
 * a boolean, frozen-tree status object exists, telemetry
 * file exists + SHA matches, duration / epochs sane.
 *
 * Semantic checks live in the verifier:
 *   - substrate_complete consistency;
 *   - PASS requires complete substrate (INCOMPLETE_SUBSTRATE);
 *   - non-PASS preserves the worker's specific failure.
 */
import { DurableTelemetryStore } from "./telemetry-store.js";
import {
  LH06_RESULT_SCHEMA,
  LH06_SOAK_CONTRACT_VERSION,
} from "./types.js";

export type ShapeReason =
  | "BAD_SCHEMA"
  | "BAD_CONTRACT_VERSION"
  | "BAD_PROFILE"
  | "SUPERVISOR_RUN_ID_MISMATCH"
  | "MISSING_REQUIRED_FIELD"
  | "SUBSTRATE_SHAPE_INVALID"
  | "SUBSTRATE_FLAG_NOT_BOOLEAN"
  | "INVALID_FROZEN_TREE_STATUS"
  | "TELEMETRY_MISSING"
  | "TELEMETRY_HASH_DRIFT"
  | "TELEMETRY_BYTES_DRIFT"
  | "TELEMETRY_LINE_COUNT_DRIFT"
  | "MALFORMED_DURATION"
  | "MALFORMED_EPOCH_COUNTER";

export interface ShapeCheckOk {
  readonly ok: true;
  readonly duration_ms: number;
  readonly epochs_completed: number;
}
export interface ShapeCheckFail {
  readonly ok: false;
  readonly reason: ShapeReason;
  readonly detail: string;
}

export function checkResultShape(args: {
  readonly raw: unknown;
  readonly expected_supervisor_run_id: string;
}): ShapeCheckOk | ShapeCheckFail {
  if (typeof args.raw !== "object" || args.raw === null) {
    return fail("BAD_SCHEMA", "worker result is not an object");
  }
  const r = args.raw as Record<string, unknown>;
  if (r["schema"] !== LH06_RESULT_SCHEMA) {
    return fail("BAD_SCHEMA", `expected schema ${LH06_RESULT_SCHEMA}, got ${String(r["schema"])}`);
  }
  if (r["contract_version"] !== LH06_SOAK_CONTRACT_VERSION) {
    return fail("BAD_CONTRACT_VERSION", `expected ${LH06_SOAK_CONTRACT_VERSION}, got ${String(r["contract_version"])}`);
  }
  const profile = r["profile"];
  if (profile !== "CI_SMOKE" && profile !== "QUALIFICATION" && profile !== "EXTENDED") {
    return fail("BAD_PROFILE", `unknown profile: ${String(profile)}`);
  }
  if (r["supervisor_run_id"] !== args.expected_supervisor_run_id) {
    return fail("SUPERVISOR_RUN_ID_MISMATCH", `expected ${args.expected_supervisor_run_id}, got ${String(r["supervisor_run_id"])}`);
  }
  const required: readonly string[] = [
    "schema","contract_version","profile","started_at","finished_at","duration_ms",
    "environment_identity","substrate","epochs_completed","cases_completed",
    "semantic","resources","latency","frozen_tree","repeatability","failure","verdict",
    "telemetry_path","telemetry_sha256","telemetry_bytes","telemetry_line_count",
    "supervisor_run_id","substrate_complete",
  ];
  for (const k of required) {
    if (!(k in r)) {
      return fail("MISSING_REQUIRED_FIELD", `field not present: ${k}`);
    }
  }
  if (r["substrate_complete"] !== true && r["substrate_complete"] !== false) {
    return fail("SUBSTRATE_FLAG_NOT_BOOLEAN", `substrate_complete must be boolean, got ${typeof r["substrate_complete"]}`);
  }
  // L06-CORRECTION11 L06-C44: structural substrate shape.
  // Semantic completeness (do all six identities carry
  // non-null values?) is the verifier's job.
  const substrate = r["substrate"];
  if (typeof substrate !== "object" || substrate === null) {
    return fail("SUBSTRATE_SHAPE_INVALID", "substrate field missing or malformed");
  }
  const subObj = substrate as Record<string, unknown>;
  const expectedSubKeys: readonly string[] = [
    "phase_e_head",
    "lh02_head",
    "lh03_frozen_commit",
    "lh04_frozen_commit",
    "lh05_corpus_commit",
    "repo_commit",
  ];
  for (const k of expectedSubKeys) {
    if (!(k in subObj)) {
      return fail("SUBSTRATE_SHAPE_INVALID", `substrate field missing key: ${k}`);
    }
    const v = subObj[k];
    if (v !== null && typeof v !== "string") {
      return fail("SUBSTRATE_SHAPE_INVALID", `substrate.${k} must be string|null, got ${typeof v}`);
    }
  }
  const ft = r["frozen_tree"];
  if (typeof ft !== "object" || ft === null) {
    return fail("INVALID_FROZEN_TREE_STATUS", "frozen_tree section missing");
  }
  const status = (ft as Record<string, unknown>)["status"];
  if (typeof status !== "object" || status === null) {
    return fail("INVALID_FROZEN_TREE_STATUS", "frozen_tree.status missing");
  }
  // L06-CORRECTION11: structural shape only — semantic
  // interpretation of frozen-tree changes is the
  // verifier's job (and surfaces as FROZEN_MUTATION).
  if (!("ok" in (status as Record<string, unknown>))) {
    return fail("INVALID_FROZEN_TREE_STATUS", "frozen_tree.status missing 'ok' field");
  }
  const telemetryPath = r["telemetry_path"];
  const telemetrySha = r["telemetry_sha256"];
  if (typeof telemetryPath !== "string" || telemetryPath.length === 0) {
    return fail("TELEMETRY_MISSING", "telemetry_path missing or empty");
  }
  if (typeof telemetrySha !== "string" || telemetrySha.length !== 64) {
    return fail("TELEMETRY_HASH_DRIFT", `telemetry_sha256 missing or malformed: ${String(telemetrySha)}`);
  }
  const v = DurableTelemetryStore.verify({
    path: telemetryPath,
    expected_sha256: telemetrySha,
  });
  if (!v.ok) {
    return fail("TELEMETRY_HASH_DRIFT", `telemetry re-verification failed: ${v.detail}`);
  }
  const recordedBytes = r["telemetry_bytes"];
  if (typeof recordedBytes !== "number" || !Number.isFinite(recordedBytes)) {
    return fail("MISSING_REQUIRED_FIELD", `telemetry_bytes missing or malformed: ${String(recordedBytes)}`);
  }
  if (recordedBytes !== v.bytes) {
    return fail("TELEMETRY_BYTES_DRIFT", `recorded telemetry_bytes=${recordedBytes} does not match on-disk file size ${v.bytes} for ${telemetryPath}`);
  }
  const recordedLineCount = r["telemetry_line_count"];
  if (typeof recordedLineCount !== "number" || !Number.isFinite(recordedLineCount)) {
    return fail("MISSING_REQUIRED_FIELD", `telemetry_line_count missing or malformed: ${String(recordedLineCount)}`);
  }
  if (recordedLineCount !== v.line_count) {
    return fail("TELEMETRY_LINE_COUNT_DRIFT", `recorded telemetry_line_count=${recordedLineCount} does not match on-disk line count ${v.line_count} for ${telemetryPath}`);
  }
  const dur = r["duration_ms"];
  if (typeof dur !== "number" || !Number.isFinite(dur) || dur < 0) {
    return fail("MALFORMED_DURATION", `duration_ms not a non-negative finite number: ${String(dur)}`);
  }
  const epochs = r["epochs_completed"];
  if (typeof epochs !== "number" || !Number.isFinite(epochs) || epochs < 0) {
    return fail("MALFORMED_EPOCH_COUNTER", `epochs_completed not a non-negative finite number: ${String(epochs)}`);
  }
  return { ok: true, duration_ms: dur, epochs_completed: epochs };
}

function fail(reason: ShapeReason, detail: string): ShapeCheckFail {
  return { ok: false, reason, detail };
}
