#!/usr/bin/env node --import tsx
/**
 * verify_lh06_frozen_data.ts — structured-semantic authority for the
 * LH-06 deterministic-soak frozen guard.
 *
 * The companion shell script `scripts/verify_lh06_frozen.sh`
 * orchestrates the verification (file existence, SHA recomputation,
 * SHA256SUMS verification, RED-history guard). It delegates the
 * JSON-structured semantic checks to this small TypeScript module
 * so that JSON semantics are NOT implemented in grep/sed (per ACT
 * §45 source-size discipline).
 *
 * Exit codes:
 *   0  — semantics OK
 *   2  — freeze record structure invalid
 *   3  — result / witness structure invalid
 *   4  — telemetry three-way agreement failed
 *   5  — witness binding failed
 *
 * Usage:
 *   tsx scripts/verify_lh06_frozen_data.ts <kind> <args...>
 *
 * Kinds:
 *   freeze-record    <freeze-record.json>
 *                    checks freeze record schema/state/negatives.
 *
 *   result-semantic  <result.json> <witness.json>
 *                    <expected-result-sha>
 *                    <expected-subject-commit>
 *                    <expected-contract-version>
 *                    <expected-profile>
 *                    <expected-verdict>
 *                    <expected-durability>
 *                    checks result schema/contract/verdict/failure/
 *                    durability/substrate/semantic/resource/frozen/
 *                    repeat/min-epochs-min-duration.
 *
 *   telemetry        <telemetry.jsonl> <result.json>
 *                    <expected-sha> <expected-bytes> <expected-lines>
 *                    recomputes telemetry SHA + bytes + line count
 *                    and compares against result.telemetry_*.
 *
 *   witness          <witness.json> <result.json>
 *                    <expected-run-id> <expected-supervisor-run-id>
 *                    <expected-profile> <expected-verdict>
 *                    <expected-durability>
 *                    checks witness binding.
 *
 *   witness-verdict  <result-or-worker-result.json>
 *                    prints the verdict field of an arbitrary
 *                    JSON artifact (used by the RED-history
 *                    guard to compare the QUALIFICATION01
 *                    verdict).
 */

import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as path from "node:path";

const EXPECTED_SUBJECT_COMMIT = "5d4c9d258446cba1b018ab689433bafe162feefb";
const EXPECTED_RUN_ID = "9abce4954edbdb34";
const EXPECTED_SUPERVISOR_RUN_ID = "f7f4b208772caa8b";
const EXPECTED_PROFILE = "QUALIFICATION";
const EXPECTED_VERDICT = "PASS_DETERMINISTIC_SOAK";
const EXPECTED_DURABILITY = "CRASH_DURABLE";
const EXPECTED_CONTRACT = "lh06.soak.contract.v1";

function fail(msg: string, code: number): never {
  console.error(msg);
  process.exit(code);
}

function freezeRecord(p: string): void {
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  if (j.schema !== "lh06.freeze-record/v1") fail("wrong freeze schema: " + j.schema, 2);
  if (j.state !== "GREEN_FROZEN") fail("freeze state is not GREEN_FROZEN: " + j.state, 2);
  if (j.subject_commit !== EXPECTED_SUBJECT_COMMIT) fail("subject_commit mismatch: " + j.subject_commit, 2);
  if (j.prior_red_qualification_preserved !== true) fail("prior_red_qualification_preserved must be true", 2);
  if (j.ready_for_lh07 !== true) fail("ready_for_lh07 must be true", 2);
  for (const k of [
    "qualification", "contract", "observed", "substrate",
    "semantic", "resources", "latency", "frozen_tree",
    "repeatability", "publication_durability", "rss_observation",
  ]) {
    if (j[k] === undefined) fail("freeze record missing key: " + k, 2);
  }
  const subs = j.substrate;
  for (const k of ["phase_e_head", "lh02_head", "lh03_frozen_commit",
                   "lh04_frozen_commit", "lh05_corpus_commit",
                   "repo_commit"]) {
    if (!subs[k]) fail("substrate " + k + " is null/missing", 2);
  }
  if (subs.substrate_complete !== true) fail("substrate_complete must be true", 2);
  if (subs.repo_commit !== j.subject_commit) fail("substrate.repo_commit != subject_commit", 2);
  if (j.observed.duration_ms < 3600000) fail("duration_ms < 3,600,000", 2);
  if (j.observed.epochs_completed < 500) fail("epochs_completed < 500", 2);
  if (j.contract.version !== EXPECTED_CONTRACT) fail("contract.version mismatch: " + j.contract.version, 2);
  if (j.contract.profile !== EXPECTED_PROFILE) fail("contract.profile mismatch: " + j.contract.profile, 2);
  if (j.publication_durability !== EXPECTED_DURABILITY) fail("publication_durability must be CRASH_DURABLE", 2);
  if (j.rss_observation.rss_is_lh06_v1_pass_fail_authority !== false) fail("rss MUST not be V1 pass/fail authority", 2);
  console.log("  [OK]  freeze record schema/state/binding/negatives");
}

function resultSemantic(
  resultPath: string,
  witnessPath: string,
  expectedResultSha: string,
  expectedSubjectCommit: string,
  expectedContract: string,
  expectedProfile: string,
  expectedVerdict: string,
  expectedDurability: string,
): void {
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const actualSha = crypto.createHash("sha256")
    .update(fs.readFileSync(resultPath))
    .digest("hex");
  if (actualSha !== expectedResultSha) fail("sha256(result.json) = " + actualSha, 3);

  if (result.schema !== "lh06.deterministic.soak.result.v1") fail("result.schema mismatch: " + result.schema, 3);
  if (result.contract_version !== expectedContract) fail("result.contract_version mismatch: " + result.contract_version, 3);
  if (result.profile !== expectedProfile) fail("result.profile mismatch: " + result.profile, 3);
  if (result.verdict !== expectedVerdict) fail("result.verdict mismatch: " + result.verdict, 3);
  if (result.failure !== null) fail("result.failure must be null: " + JSON.stringify(result.failure), 3);
  if (result.publication_durability !== expectedDurability) fail("result.publication_durability must be CRASH_DURABLE", 3);
  if (result.substrate_complete !== true) fail("substrate_complete must be true", 3);

  for (const k of ["phase_e_head", "lh02_head", "lh03_frozen_commit",
                   "lh04_frozen_commit", "lh05_corpus_commit", "repo_commit"]) {
    if (!result.substrate[k]) fail("substrate." + k + " is null", 3);
  }
  if (result.substrate.repo_commit !== expectedSubjectCommit) fail("substrate.repo_commit != subject_commit", 3);

  if (result.semantic.drift_count !== 0) fail("drift_count != 0", 3);
  if (result.semantic.fault_escape_count !== 0) fail("fault_escape_count != 0", 3);
  if (result.semantic.lifecycle_drift_count !== 0) fail("lifecycle_drift_count != 0", 3);
  if (result.semantic.predecessor_dependency_count !== 0) fail("predecessor_dependency_count != 0", 3);
  if (result.semantic.cases_with_multiple_semantic_results !== 0) fail("multiple_semantics != 0", 3);
  if (typeof result.semantic.lifecycle_drift_by_scenario !== "object" ||
      Array.isArray(result.semantic.lifecycle_drift_by_scenario) ||
      Object.keys(result.semantic.lifecycle_drift_by_scenario).length !== 0) {
    fail("lifecycle_drift_by_scenario not empty", 3);
  }

  if (result.resources.resource_balance_failures !== 0) fail("resource_balance_failures != 0", 3);
  if (result.resources.workspace_leaks !== 0) fail("workspace_leaks != 0", 3);
  if (result.resources.heap_verdict.pass !== true) fail("heap_verdict.pass != true", 3);
  if (result.latency.verdict.pass !== true) fail("latency.verdict.pass != true", 3);

  if (result.frozen_tree.changed !== false) fail("frozen_tree.changed != false", 3);
  if (result.frozen_tree.status.ok !== true) fail("frozen_tree.status.ok != true", 3);
  if (result.repeatability.semantic_repeatability !== true) fail("semantic_repeatability != true", 3);
  if (result.duration_ms < 3600000) fail("duration_ms < 3,600,000", 3);
  if (result.epochs_completed < 500) fail("epochs_completed < 500", 3);

  console.log("  [OK]  result schema/contract/verdict/failure/durability/substrate/semantic/resource/frozen/repeat/min");
}

function telemetry(
  telPath: string,
  resultPath: string,
  expectedSha: string,
  expectedBytes: number,
  expectedLines: number,
): void {
  const buf = fs.readFileSync(telPath);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const lines = buf.toString("utf8").split("\n").filter((l) => l.length > 0).length;
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  if (sha !== expectedSha || buf.length !== expectedBytes || lines !== expectedLines) {
    console.error("telemetry three-way agreement failed");
    console.error("  recomputed sha =", sha);
    console.error("  recomputed bytes =", buf.length);
    console.error("  recomputed lines =", lines);
    fail("telemetry three-way disagreement", 4);
  }
  if (result.telemetry_sha256 !== expectedSha ||
      result.telemetry_bytes !== expectedBytes ||
      result.telemetry_line_count !== expectedLines) {
    fail("result.telemetry_* fields disagree with recomputed", 4);
  }
  console.log("  [OK]  telemetry SHA + bytes + line count three-way agree");
}

function witness(
  witnessPath: string,
  resultPath: string,
  expectedRunId: string,
  expectedSupRunId: string,
  expectedProfile: string,
  expectedVerdict: string,
  expectedDurability: string,
): void {
  const resultSha = crypto.createHash("sha256")
    .update(fs.readFileSync(resultPath))
    .digest("hex");
  const w = JSON.parse(fs.readFileSync(witnessPath, "utf8"));
  if (w.schema !== "lh06.commit-witness/v1") fail("witness schema mismatch: " + w.schema, 5);
  if (w.result_sha256 !== resultSha) fail("witness.result_sha256 does not match recomputed sha", 5);
  if (w.run_id !== expectedRunId) fail("witness.run_id", 5);
  if (w.supervisor_run_id !== expectedSupRunId) fail("witness.supervisor_run_id", 5);
  if (w.profile !== expectedProfile) fail("witness.profile", 5);
  if (w.verdict !== expectedVerdict) fail("witness.verdict", 5);
  if (w.durability !== expectedDurability) fail("witness.durability", 5);
  if (!w.result_path || !w.result_path.endsWith("lh06-deterministic-soak.json")) {
    fail("witness.result_path unexpected: " + w.result_path, 5);
  }
  console.log("  [OK]  witness binding (schema, result_sha, run_id, supervisor_run_id, profile, verdict, durability)");
}

function witnessVerdict(p: string): void {
  // Returns the verdict field of an arbitrary JSON artifact
  // (used by the RED-history guard). Print only the verdict so
  // shell can capture with $(...).
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  process.stdout.write(j.verdict);
}

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error("usage: verify_lh06_frozen_data.ts <kind> <args...>");
  process.exit(1);
}
const kind = args[0];
switch (kind) {
  case "freeze-record":
    freezeRecord(path.resolve(args[1]));
    break;
  case "result-semantic":
    resultSemantic(
      path.resolve(args[1]),
      path.resolve(args[2]),
      args[3],
      args[4],
      args[5],
      args[6],
      args[7],
      args[8],
    );
    break;
  case "telemetry":
    telemetry(path.resolve(args[1]), path.resolve(args[2]),
              args[3], parseInt(args[4], 10), parseInt(args[5], 10));
    break;
  case "witness":
    witness(path.resolve(args[1]), path.resolve(args[2]),
            args[3], args[4], args[5], args[6], args[7]);
    break;
  case "witness-verdict":
    witnessVerdict(path.resolve(args[1]));
    break;
  default:
    console.error("unknown kind: " + kind);
    process.exit(1);
}



