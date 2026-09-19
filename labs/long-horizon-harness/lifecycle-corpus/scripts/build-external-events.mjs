#!/usr/bin/env node
/**
 * LH-05 CORRECTION01 — Build canonical factory_external_events.json
 * for every LC01..LC12 scenario.
 *
 * The factory_external_events.json file is the SINGLE Factory
 * authority for events the harness cannot authoritatively emit:
 *   - GATE_STARTED / GATE_FINISHED
 *   - REPAIR_STARTED / REPAIR_FINISHED
 *   - REVIEW_STARTED / REVIEW_FINISHED
 *   - RUN_CANCEL_REQUESTED
 *   - terminal events (RUN_FINISHED / RUN_ABORTED / RUN_TIMEOUT)
 *
 * ACTION_* / RUN_STARTED / HARNESS_STARTED / HARNESS_STOPPED
 * are NOT in this file — they come from the harness mapper
 * (L05-C01). Each scenario's external-events oracle is the
 * minimum set of Factory-authoritative events needed to
 * close the Phase E projection.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..", "..");
const fixturesDir = resolve(root, "labs/long-horizon-harness/lifecycle-corpus/fixtures");

function w(rel, content) {
  const abs = resolve(fixturesDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

const GATE_STARTED = (id, att) => ({ type: "GATE_STARTED", gate_id: `gate:${id}`, attempt_id: att });
const GATE_FINISHED = (id, att, pass, reason) => ({
  type: "GATE_FINISHED",
  gate_id: `gate:${id}`,
  attempt_id: att,
  pass,
  ...(reason !== undefined ? { reason } : {}),
});
const REPAIR_STARTED = (id, reason) => ({ type: "REPAIR_STARTED", repair_id: id, reason });
const REPAIR_FINISHED = (id) => ({ type: "REPAIR_FINISHED", repair_id: id });
const RUN_CANCEL = (reason) => ({
  type: "RUN_CANCEL_REQUESTED",
  ...(reason !== undefined ? { reason } : {}),
});
const RUN_FINISHED = (semantic, claimed) => ({
  type: "RUN_FINISHED",
  semantic,
  ...(claimed !== undefined ? { agent_report: { message: claimed, claimed } } : {}),
});
const RUN_ABORTED = (semantic, reason) => ({ type: "RUN_ABORTED", semantic, reason });

// L05-C02: external-events oracle no longer contains ACTION_*.
// Those come from the harness mapper (L05-C01).

// LC01 — Canonical success: PASS gate -> RUN_FINISHED(SUCCESS).
w(
  "lc01-canonical-success/factory_external_events.json",
  JSON.stringify([
    GATE_STARTED("g1", "att:lc01-001"),
    GATE_FINISHED("g1", "att:lc01-001", true, "smoke_passed"),
    RUN_FINISHED("SUCCESS", "done"),
  ]) + "\n",
);

// LC02 — Premature done: omit_run_started=true -> INCOMPLETE.
w("lc02-premature-done/factory_external_events.json", JSON.stringify([]) + "\n");

// LC03 — Gate FAIL + candidate says done.
// Action status now comes from the harness mapper; the
// native Pi tool_finished is `ok=false`, so the mapper
// emits ACTION_FINISHED(ERROR). The catalog must accept
// that contradiction (see L05-C03).
w(
  "lc03-gate-fail-then-done/factory_external_events.json",
  JSON.stringify([
    GATE_STARTED("g1", "att:lc03-001"),
    GATE_FINISHED("g1", "att:lc03-001", false, "tests_failed"),
    RUN_FINISHED("SUCCESS", "done"),
  ]) + "\n",
);

// LC04 — Ineffective repair: PASS gate -> REPAIR -> SUCCESS.
// Note: the catalog expects last_action_status to mirror
// the harness-mapped tool_finished (ok=true here).
w(
  "lc04-ineffective-repair/factory_external_events.json",
  JSON.stringify([
    GATE_STARTED("g1", "att:lc04-001"),
    GATE_FINISHED("g1", "att:lc04-001", true, "initial"),
    REPAIR_STARTED("r1", "corrective_attempt"),
    REPAIR_FINISHED("r1"),
    RUN_FINISHED("SUCCESS", "fixed"),
  ]) + "\n",
);

// LC05 — Malformed native: empty (adapter rejects).
w("lc05-malformed-native/factory_external_events.json", JSON.stringify([]) + "\n");

// LC06 — Context pressure: PASS gate -> RUN_FINISHED(SUCCESS).
w(
  "lc06-context-pressure/factory_external_events.json",
  JSON.stringify([
    GATE_STARTED("g1", "att:lc06-001"),
    GATE_FINISHED("g1", "att:lc06-001", true, "smoke_passed"),
    RUN_FINISHED("SUCCESS", "done"),
  ]) + "\n",
);

// LC07 — Restart / recovery: PASS gate -> RUN_FINISHED(SUCCESS).
w(
  "lc07-restart-recovery/factory_external_events.json",
  JSON.stringify([
    GATE_STARTED("g1", "att:lc07-001"),
    GATE_FINISHED("g1", "att:lc07-001", true, "done"),
    RUN_FINISHED("SUCCESS", "done"),
  ]) + "\n",
);

// LC08 — Cancel request: PASS gate -> cancel -> aborted.
w(
  "lc08-cancel-request/factory_external_events.json",
  JSON.stringify([
    GATE_STARTED("g1", "att:lc08-001"),
    GATE_FINISHED("g1", "att:lc08-001", true, "half_done"),
    RUN_CANCEL("user_requested"),
    RUN_ABORTED("CANCELLED", "user cancelled"),
  ]) + "\n",
);

// LC09 — Dependency failure: harness maps tool_finished(ok=false)
// -> ACTION_FINISHED(ERROR); Factory external event is the abort.
w(
  "lc09-dependency-failure/factory_external_events.json",
  JSON.stringify([RUN_ABORTED("HARNESS_FAILURE", "dependency unavailable")]) + "\n",
);

// LC10 — Destructive attempt denied: the harness requested a
// destructive tool but was policy-denied. To preserve
// INCOMPLETE lifecycle_state, the harness mapper must
// emit NO ACTION events — the destructive intent is
// recorded in the candidate-message stream as an
// observation only. The Pi fixture therefore carries no
// tool_execution_* events (only the turn narrative),
// and the reference control script emits no tool events.
w("lc10-destructive-attempt-denied/factory_external_events.json", JSON.stringify([]) + "\n");

// LC11 — Evidence corruption handoff: omit_run_started=true; no
// external events; the LH-04 handoff verdict is the disposition.
w("lc11-evidence-corruption-handoff/factory_external_events.json", JSON.stringify([]) + "\n");

// LC12 — Terminal disagreement: FAIL gate -> RUN_FINISHED(VALID_FAILURE).
w(
  "lc12-terminal-disagreement/factory_external_events.json",
  JSON.stringify([
    GATE_STARTED("g1", "att:lc12-001"),
    GATE_FINISHED("g1", "att:lc12-001", false, "external_gate_failed"),
    RUN_FINISHED("VALID_FAILURE", "done (harness said)"),
  ]) + "\n",
);

console.log("LH-05 factory_external_events.json fixtures written under " + fixturesDir);
