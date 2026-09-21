/**
 * LH-06 worker-result shape checks.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * Split from `worker-result-verifier.ts` for source-size
 * discipline (HYGIENE01: every LH-06 production source
 * file MUST be <= 400 LOC). Contains the structural
 * shape checks that do not depend on verdict / witness
 * semantics: schema literal, contract_version, profile
 * closed-union, supervisor_run_id, required-field
 * presence, substrate completeness, frozen-tree status,
 * telemetry file presence + SHA-256, telemetry_bytes /
 * telemetry_line_count cross-check, duration / epoch
 * sanity.
 *
 * Each check returns `{ok:true}` (with the duration /
 * epochs values needed downstream) or
 * `{ok:false, reason, detail}` using the
 * `WorkerResultVerifyFail` reason union so the
 * verifier can re-use its `fail(...)` helper without
 * inventing parallel vocabulary.
 */
import { DurableTelemetryStore } from "./telemetry-store.js";
import { isSubstrateComplete } from "./substrate-binding.js";
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
  | "INCOMPLETE_SUBSTRATE"
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
  if (r["substrate_complete"] !== true) {
    return fail("INCOMPLETE_SUBSTRATE", "substrate_complete flag is not true");
  }
  const substrate = r["substrate"];
  if (typeof substrate !== "object" || substrate === null) {
    return fail("INCOMPLETE_SUBSTRATE", "substrate field missing or malformed");
  }
  if (!isSubstrateComplete(substrate as Parameters<typeof isSubstrateComplete>[0])) {
    return fail("INCOMPLETE_SUBSTRATE", "substrate binding has null entries");
  }
  const ft = r["frozen_tree"];
  if (typeof ft !== "object" || ft === null) {
    return fail("INVALID_FROZEN_TREE_STATUS", "frozen_tree section missing");
  }
  const status = (ft as Record<string, unknown>)["status"];
  if (typeof status !== "object" || status === null) {
    return fail("INVALID_FROZEN_TREE_STATUS", "frozen_tree.status missing");
  }
  if ((status as Record<string, unknown>)["ok"] !== true) {
    return fail("INVALID_FROZEN_TREE_STATUS", `frozen_tree.status.ok must be true; got ${String((status as Record<string, unknown>)["ok"])}`);
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
