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
 * L05-C01 — Causal harness mapping for the reference control.
 *
 * The reference control is the Pi-vocabulary-independent ground
 * truth for harness-observable lifecycle facts. Mapping rules:
 *
 *   candidate_started                          -> RUN_STARTED + HARNESS_STARTED
 *   tool_started                               -> ACTION_STARTED
 *   tool_finished(ok=true)                     -> ACTION_FINISHED(OK)
 *   tool_finished(ok=false)                    -> ACTION_FINISHED(ERROR)
 *   candidate_message                          -> (observation only)
 *   candidate_reported_completion              -> (observation only)
 *   candidate_error                            -> (observation only)
 *
 * Returns TWO arrays so the runner can interleave them with
 * the per-scenario external-events oracle:
 *
 *   pre_gate   = [RUN_STARTED, HARNESS_STARTED, ACTION_STARTED]
 *   post_gate  = [ACTION_FINISHED]
 *
 * The reference control does NOT emit GATE_*, REPAIR_*,
 * REVIEW_*, RUN_CANCEL_REQUESTED, or terminal events —
 * those belong to the per-scenario external-events oracle.
 *
 * If `omitRunStarted` is true, RUN_STARTED + HARNESS_STARTED
 * are not emitted; the resulting projection has lifecycle_state
 * = INCOMPLETE.
 */
export function harnessEventsToRunEvents(
  events: ReadonlyArray<HarnessEvent>,
  attemptId: AttemptId,
  omitRunStarted: boolean = false,
): { readonly pre_gate: ReadonlyArray<RunEvent>; readonly post_gate: ReadonlyArray<RunEvent> } {
  const target = { kind: "attempt" as const, attempt_id: attemptId };
  const pre_gate: RunEvent[] = [];
  const post_gate: RunEvent[] = [];
  let emittedRunStarted = false;
  for (const ev of events) {
    switch (ev.type) {
      case "candidate_started":
        if (!omitRunStarted && !emittedRunStarted) {
          pre_gate.push({ type: "RUN_STARTED" });
          pre_gate.push({ type: "HARNESS_STARTED" });
          emittedRunStarted = true;
        }
        break;
      case "tool_started":
        pre_gate.push({ type: "ACTION_STARTED", target });
        break;
      case "tool_finished":
        post_gate.push({
          type: "ACTION_FINISHED",
          target,
          status: ev.ok ? "OK" : "ERROR",
          ...(ev.ok ? {} : { failure: { kind: "tool_failure", tool: ev.tool, message: ev.error ?? "tool returned non-ok" } }),
        });
        break;
      // candidate_message / candidate_reported_completion /
      // candidate_error are observations only — they must
      // never create Phase E lifecycle evidence.
      default:
        break;
    }
  }
  if (!emittedRunStarted && !omitRunStarted) {
    pre_gate.unshift({ type: "RUN_STARTED" }, { type: "HARNESS_STARTED" });
  }
  return { pre_gate, post_gate };
}

/**
 * Wrap a HarnessEvent stream + scenario external-events oracle
 * into a single ordered RunEvent stream.
 *
 * Lifecycle ordering produced:
 *   1. mapper.pre_gate (RUN_STARTED + HARNESS_STARTED + ACTION_STARTED)
 *   2. external-events oracle events EXCEPT terminal events
 *   3. mapper.post_gate (ACTION_FINISHED)
 *   4. HARNESS_STOPPED
 *   5. terminal events (RUN_FINISHED / RUN_ABORTED / RUN_TIMEOUT)
 *
 * The harness mapper is the SOLE authority for ACTION_* events;
 * the external-events oracle owns GATE_*, REPAIR_*, REVIEW_*,
 * RUN_CANCEL_REQUESTED, and terminal events. See L05-C01.
 */
export function closeAttemptAndHarness(
  mapperPreGate: ReadonlyArray<RunEvent>,
  mapperPostGate: ReadonlyArray<RunEvent>,
  oracleEvents: ReadonlyArray<RunEvent>,
  _attemptId: AttemptId,
  _attemptStatus: "OK" | "ERROR" = "OK",
): ReadonlyArray<RunEvent> {
  // The harness mapper must NOT emit terminal events, GATE_*,
  // REPAIR_*, REVIEW_*, RUN_CANCEL_REQUESTED. We trust the
  // external-events oracle as the sole authority for these.
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
  const stripHarnessStopped = (arr: ReadonlyArray<RunEvent>): ReadonlyArray<RunEvent> => {
    const stopIdx = arr.findIndex((e) => e.type === "HARNESS_STOPPED");
    if (stopIdx === -1) return arr;
    return arr.slice(0, stopIdx).concat(arr.slice(stopIdx + 1));
  };
  const pre = stripHarnessStopped(mapperPreGate);
  const post = stripHarnessStopped(mapperPostGate);
  const runStartedEmitted =
    pre.some((e) => e.type === "RUN_STARTED") ||
    post.some((e) => e.type === "RUN_STARTED");
  const tail: RunEvent[] = [];
  if (runStartedEmitted) tail.push({ type: "HARNESS_STOPPED" });
  return pre.concat(nonTerminal, post, tail, ...terminal);
}

/**
 * AttemptId factory for reference-control scenarios. The
 * attempt-id is derived from the scenario id so two
 * consecutive runs are byte-stable.
 */
export function fakeAttemptId(scenarioId: string): AttemptId {
  return makeAttemptId(`att:${scenarioId.toLowerCase()}-001`);
}
