/**
 * LH-05 factory external events oracle test.
 *
 * Asserts that every scenario has a factory_external_events.json
 * that is structurally valid (hand-pinned gate / terminal
 * Phase E events), and that LC07 (restart / recovery)
 * correctly declares its two-segment concatenation.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { LIFECYCLE_CORPUS_CATALOG, findScenario } from "../../lifecycle-corpus/catalog.js";

const REPO_ROOT = process.cwd();

const TERMINAL_TYPES = new Set([
  "RUN_FINISHED",
  "RUN_ABORTED",
  "RUN_TIMEOUT",
  "RUN_CANCEL_REQUESTED",
]);

test("LH-05 every scenario declares a factory_external_events.json", () => {
  for (const s of LIFECYCLE_CORPUS_CATALOG) {
    const oraclePath = `${REPO_ROOT}/lifecycle-corpus/fixtures/${idDir(s.id)}/factory_external_events.json`;
    assert.ok(existsSync(oraclePath), `${s.id}: factory_external_events.json must exist at ${oraclePath}`);
  }
});

test("LH-05 every factory_external_events.json is a JSON array of well-formed Phase E events", () => {
  for (const s of LIFECYCLE_CORPUS_CATALOG) {
    const oraclePath = `${REPO_ROOT}/lifecycle-corpus/fixtures/${idDir(s.id)}/factory_external_events.json`;
    if (!existsSync(oraclePath)) continue;
    const oracle = JSON.parse(readFileSync(oraclePath, "utf8"));
    assert.ok(Array.isArray(oracle), `${s.id}: oracle must be an array`);
    for (const ev of oracle) {
      assert.ok(typeof ev.type === "string", `${s.id}: every event must have a string .type`);
      // L05-C02: the external-events oracle MUST NOT contain
      // ACTION_* events — those come from the harness mapper.
      // The only legal event types here are the Factory-only
      // authorities: GATE_*, REPAIR_*, REVIEW_*, RUN_CANCEL_REQUESTED,
      // and terminal events.
      assert.ok(
        ev.type === "GATE_STARTED" ||
          ev.type === "GATE_FINISHED" ||
          ev.type === "REPAIR_STARTED" ||
          ev.type === "REPAIR_FINISHED" ||
          ev.type === "REVIEW_STARTED" ||
          ev.type === "REVIEW_FINISHED" ||
          ev.type === "RUN_CANCEL_REQUESTED" ||
          TERMINAL_TYPES.has(ev.type),
        `${s.id}: external-events oracle MUST NOT contain ${ev.type} (only GATE_*/REPAIR_*/REVIEW_*/RUN_CANCEL_REQUESTED/terminal)`,
      );
    }
  }
});

test("LH-05 LC07 (restart/recovery) exposes segment-A and segment-B Pi fixtures", () => {
  const segA = `${REPO_ROOT}/lifecycle-corpus/fixtures/lc07-restart-recovery/pi.session.segment-A.jsonl`;
  const segB = `${REPO_ROOT}/lifecycle-corpus/fixtures/lc07-restart-recovery/pi.session.segment-B.jsonl`;
  assert.ok(existsSync(segA), `LC07 segment-A must exist at ${segA}`);
  assert.ok(existsSync(segB), `LC07 segment-B must exist at ${segB}`);
  // Both segments must be valid JSONL (at least one valid line each).
  const a = readFileSync(segA, "utf8").split("\n").filter(Boolean);
  const b = readFileSync(segB, "utf8").split("\n").filter(Boolean);
  assert.ok(a.length > 0, "LC07 segment-A must have at least one line");
  assert.ok(b.length > 0, "LC07 segment-B must have at least one line");
  for (const line of a) {
    JSON.parse(line);
  }
  for (const line of b) {
    JSON.parse(line);
  }
});

test("LH-05 LC07 (restart/recovery) declares explicit segments[] metadata (L05-C10)", () => {
  const lc07 = findScenario("LC07");
  assert.ok(lc07, "LC07 must exist");
  assert.ok(lc07!.segments, "LC07 must declare segments");
  assert.equal(lc07!.segments!.length, 2, "LC07 must declare exactly 2 segments");
  const a = lc07!.segments![0]!;
  const b = lc07!.segments![1]!;
  assert.equal(a.segment_id, "A", "LC07 segment 0 is A");
  assert.equal(b.segment_id, "B", "LC07 segment 1 is B");
  assert.equal(a.ordinal, 0);
  assert.equal(b.ordinal, 1);
  assert.equal(a.previous_segment_id, null);
  assert.equal(b.previous_segment_id, "A");
  assert.equal(a.capture_id, b.capture_id, "LC07 capture_id shared across segments");
  assert.equal(a.shared_session_id, b.shared_session_id, "LC07 shared_session_id shared across segments");
});

test("LH-05 LC10 (destructive attempt denied) exposes sentinel.before.txt and sentinel.after.txt", () => {
  const before = `${REPO_ROOT}/lifecycle-corpus/fixtures/lc10-destructive-attempt-denied/sentinel.before.txt`;
  const after = `${REPO_ROOT}/lifecycle-corpus/fixtures/lc10-destructive-attempt-denied/sentinel.after.txt`;
  assert.ok(existsSync(before), `LC10 sentinel.before.txt must exist at ${before}`);
  assert.ok(existsSync(after), `LC10 sentinel.after.txt must exist at ${after}`);
  assert.deepEqual(
    readFileSync(before),
    readFileSync(after),
    "LC10 sentinel before/after MUST be byte-identical (no host mutation)",
  );
});

test("LH-05 LC11 (fault-lab handoff) declares an lh04_fault_id.txt marker", () => {
  const marker = `${REPO_ROOT}/lifecycle-corpus/fixtures/lc11-evidence-corruption-handoff/lh04_fault_id.txt`;
  assert.ok(existsSync(marker), `LC11 lh04_fault_id.txt must exist at ${marker}`);
  const txt = readFileSync(marker, "utf8").trim();
  assert.ok(txt.length > 0, "LC11 lh04_fault_id.txt must be non-empty");
});

function idDir(id: string): string {
  // LC01 -> lc01-canonical-success, etc.
  const num = id.slice(2).toLowerCase();
  const suffixes: Record<string, string> = {
    "01": "canonical-success",
    "02": "premature-done",
    "03": "gate-fail-then-done",
    "04": "ineffective-repair",
    "05": "malformed-native",
    "06": "context-pressure",
    "07": "restart-recovery",
    "08": "cancel-request",
    "09": "dependency-failure",
    "10": "destructive-attempt-denied",
    "11": "evidence-corruption-handoff",
    "12": "terminal-disagreement",
  };
  const suffix = suffixes[num];
  assert.ok(suffix, `unknown scenario id ${id}`);
  return `${id.toLowerCase()}-${suffix}`;
}
