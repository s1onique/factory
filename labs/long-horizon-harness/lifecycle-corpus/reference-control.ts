/**
 * LH-05 adversarial lifecycle corpus — reference control adapter driver.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 *
 * The reference control uses the existing
 * `ScriptedFakeAdapter` to drive a candidate-neutral
 * lifecycle narrative. Its role is to prove the
 * lifecycle corpus semantics independently of any
 * Pi-specific wire vocabulary.
 *
 * It is recorded as `REFERENCE_CONTROL`, not as a
 * QUALIFIED_HARNESS, and its disposition is not
 * "voted" against Pi replay: a disagreement requires
 * investigation.
 *
 * The mapping from `HarnessEvent` -> `RunEvent` here
 * is intentionally a single, explicit function so the
 * candidate-neutral semantics can be audited.
 */
import type { HarnessAdapter, HarnessEvent } from "../src/protocol/harness-adapter.js";
import { ScriptedFakeAdapter, type FakeScript } from "../src/adapters/fake/scripted-fake-adapter.js";
import type {
  RunEvent,
  AttemptId,
} from "../src/run/run-types.js";
import { makeAttemptId } from "../src/run/run-types.js";

/**
 * Build a ScriptedFakeAdapter instance from a candidate-neutral
 * `FakeScript`.
 */
export function buildFakeAdapter(script: FakeScript): HarnessAdapter {
  return new ScriptedFakeAdapter({ script, terminateOnExhaustion: true });
}

/**
 * Convert a candidate-neutral HarnessEvent stream into a
 * typed Phase E RunEvent stream.
 *
 * The mapping is intentionally narrow and explicit; this is
 * the test-side authority that proves the corpus semantics
 * are Pi-vocabulary-independent.
 *
 * Mapping rules:
 *   - candidate_started       -> RUN_STARTED + HARNESS_STARTED
 *   - candidate_message       -> (no Phase E event; observation only)
 *   - tool_started            -> (no Phase E event; observation only)
 *   - tool_finished(ok=true)  -> (no Phase E event; oracle owns ACTION_FINISHED)
 *   - tool_finished(ok=false) -> (no Phase E event; oracle owns ACTION_FINISHED)
 *   - candidate_reported_completion -> (observation only)
 *   - candidate_error         -> (observation only)
 *
 * The mapper emits ONLY RUN_STARTED + HARNESS_STARTED; the
 * oracle owns ACTION_STARTED, ACTION_FINISHED, GATE_*,
 * REPAIR_*, REVIEW_*, and the terminal event. The runner
 * appends a canonical HARNESS_STOPPED at the end.
 *
 * If `omitRunStarted` is true, the mapper emits nothing;
 * the resulting projection has lifecycle_state = INCOMPLETE.
 */
export function harnessEventsToRunEvents(
  _events: ReadonlyArray<HarnessEvent>,
  _attemptId: AttemptId,
  omitRunStarted: boolean = false,
): ReadonlyArray<RunEvent> {
  const out: RunEvent[] = [];
  if (!omitRunStarted) {
    out.push({ type: "RUN_STARTED" });
    out.push({ type: "HARNESS_STARTED" });
  }
  // All other harness events are observations only; the
  // Phase E oracle owns the action / gate / terminal lifecycle.
  return out;
}

/**
 * Wrap a HarnessEvent stream + scenario oracle into a
 * single ordered RunEvent stream.
 *
 * Lifecycle ordering produced:
 *   1. harness-mapped events (typically RUN_STARTED + HARNESS_STARTED)
 *   2. oracle events EXCEPT any terminal events
 *   3. HARNESS_STOPPED
 *   4. terminal events (RUN_FINISHED / RUN_ABORTED / RUN_TIMEOUT)
 *
 * The oracle is now the SINGLE authority for
 * ACTION_STARTED / ACTION_FINISHED / GATE_* / REPAIR_* /
 * REVIEW_* / RUN_CANCEL_REQUESTED events. The mapper emits
 * only the run envelope.
 */
export function closeAttemptAndHarness(
  harnessMapped: ReadonlyArray<RunEvent>,
  oracleEvents: ReadonlyArray<RunEvent>,
  _attemptId: AttemptId,
  _attemptStatus: "OK" | "ERROR" = "OK",
): ReadonlyArray<RunEvent> {
  // Split oracle events into gate/non-terminal vs terminal.
  const terminalTypes = new Set(["RUN_FINISHED", "RUN_ABORTED", "RUN_TIMEOUT"]);
  const nonTerminal: RunEvent[] = [];
  const terminal: RunEvent[] = [];
  for (const ev of oracleEvents) {
    if (terminalTypes.has(ev.type)) {
      terminal.push(ev);
    } else {
      nonTerminal.push(ev);
    }
  }
  // Strip any HARNESS_STOPPED the mapper may have emitted;
  // we want a single canonical HARNESS_STOPPED at the end.
  const stopIdx = harnessMapped.findIndex((e) => e.type === "HARNESS_STOPPED");
  let base: ReadonlyArray<RunEvent>;
  if (stopIdx === -1) {
    base = harnessMapped;
  } else {
    base = harnessMapped.slice(0, stopIdx).concat(harnessMapped.slice(stopIdx + 1));
  }
  const runStartedEmitted = base.some((e) => e.type === "RUN_STARTED");
  const tail: RunEvent[] = [];
  if (runStartedEmitted) tail.push({ type: "HARNESS_STOPPED" });
  return base.concat(nonTerminal, tail, ...terminal);
}

/**
 * AttemptId factory for reference-control scenarios. The
 * attempt-id is derived from the scenario id so two
 * consecutive runs are byte-stable.
 */
export function fakeAttemptId(scenarioId: string): AttemptId {
  return makeAttemptId(`att:${scenarioId.toLowerCase()}-001`);
}
