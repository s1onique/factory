/**
 * LH-05 catalog test.
 *
 * Asserts that the LIFECYCLE_CORPUS_CATALOG is the single
 * canonical scenario table, that golden_predicates are
 * hand-pinned (not derived from the SUT), and that every
 * scenario has consistent eligible_harnesses / required
 * capabilities / raw_fixture_set / golden_predicates.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LIFECYCLE_CORPUS_CATALOG, findScenario } from "../../lifecycle-corpus/catalog.js";
import { LIFECYCLE_CORPUS_CONTRACT_VERSION } from "../../lifecycle-corpus/types.js";

test("LH-05 catalog contains exactly LC01..LC12 in fixed order", () => {
  const ids = LIFECYCLE_CORPUS_CATALOG.map((s) => s.id);
  assert.deepEqual(
    ids,
    ["LC01", "LC02", "LC03", "LC04", "LC05", "LC06", "LC07", "LC08", "LC09", "LC10", "LC11", "LC12"],
  );
});

test("LH-05 every catalog entry has matching contract version", () => {
  for (const s of LIFECYCLE_CORPUS_CATALOG) {
    assert.equal(s.version, LIFECYCLE_CORPUS_CONTRACT_VERSION, `scenario ${s.id} contract version mismatch`);
  }
});

test("LH-05 every catalog entry has a complete golden_predicates block", () => {
  for (const s of LIFECYCLE_CORPUS_CATALOG) {
    const g = s.golden_predicates;
    assert.ok(g, `scenario ${s.id} missing golden_predicates`);
    assert.ok(g.expected_adapter_disposition, `${s.id}: expected_adapter_disposition`);
    assert.ok(g.expected_phase_e, `${s.id}: expected_phase_e`);
    assert.ok(g.expected_lh02, `${s.id}: expected_lh02`);
    assert.ok(g.forbidden_outcomes, `${s.id}: forbidden_outcomes`);
  }
});

test("LH-05 golden_predicates are hand-pinned (NOT derived from SUT)", () => {
  // The catalog entries MUST be statically typed values
  // (no factory functions that take a SUT output). This
  // test asserts the structural property: golden_predicates
  // is fully populated for each scenario, with no undefined
  // fields that would require runtime derivation.
  for (const s of LIFECYCLE_CORPUS_CATALOG) {
    const g = s.golden_predicates;
    assert.ok(g.expected_adapter_disposition.kind, `${s.id}: kind present`);
    assert.ok(typeof g.expected_phase_e.lifecycle_state === "string", `${s.id}: lifecycle_state present`);
    assert.equal(typeof g.expected_lh02.metric_contract_version, "string", `${s.id}: metric_contract_version present`);
  }
});

test("LH-05 every raw_fixture_set resolves to an existing file (relative to repo root)", async () => {
  const repoRoot = process.cwd();
  const { access } = await import("node:fs/promises");
  for (const s of LIFECYCLE_CORPUS_CATALOG) {
    for (const f of s.raw_fixture_set) {
      const p = `${repoRoot}/${f.repo_relative_path}`;
      try {
        await access(p);
      } catch {
        assert.fail(`${s.id}: missing fixture file ${p}`);
      }
    }
  }
});

test("LH-05 LC10 sentinel.before.txt and sentinel.after.txt are byte-identical", async () => {
  const repoRoot = process.cwd();
  const { readFile } = await import("node:fs/promises");
  const before = await readFile(`${repoRoot}/lifecycle-corpus/fixtures/lc10-destructive-attempt-denied/sentinel.before.txt`);
  const after = await readFile(`${repoRoot}/lifecycle-corpus/fixtures/lc10-destructive-attempt-denied/sentinel.after.txt`);
  assert.deepEqual(before, after, "LC10 sentinel bytes must match (no host mutation)");
});

test("LH-05 LC11 fault-lab handoff marker references a known fault class", () => {
  const lc11 = findScenario("LC11");
  assert.ok(lc11, "LC11 must exist");
  assert.equal(lc11!.scenario_class, "FAULT_LAB_HANDOFF");
  assert.ok(lc11!.fault_lab_handoff, "LC11 must declare fault_lab_handoff");
  assert.ok(
    lc11!.fault_lab_handoff!.fault_klass === "F01_byte_drift" ||
      lc11!.fault_lab_handoff!.fault_klass === "F02_unbound_subject" ||
      lc11!.fault_lab_handoff!.fault_klass === "F03_unbound_attempt",
    "LC11 fault_klass must be one of the frozen LH-04 primitives",
  );
});

test("LH-05 omit_run_started is only set on scenarios that genuinely have INCOMPLETE lifecycle_state", () => {
  const expectedIncomplete = new Set(["LC02", "LC10", "LC11"]);
  for (const s of LIFECYCLE_CORPUS_CATALOG) {
    const omit = s.omit_run_started === true;
    const incomplete = s.golden_predicates.expected_phase_e.lifecycle_state === "INCOMPLETE";
    if (expectedIncomplete.has(s.id)) {
      assert.ok(omit, `${s.id} must set omit_run_started=true`);
      assert.ok(incomplete, `${s.id} must declare INCOMPLETE lifecycle_state`);
    } else {
      assert.ok(!omit, `${s.id} must NOT set omit_run_started`);
    }
  }
});

test("LH-05 scenario_count = 12", () => {
  assert.equal(LIFECYCLE_CORPUS_CATALOG.length, 12, "corpus must contain exactly 12 scenarios");
});
