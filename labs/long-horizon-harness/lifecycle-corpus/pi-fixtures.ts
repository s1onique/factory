/**
 * LH-05 adversarial lifecycle corpus — Pi replay fixture driver.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 *
 * Pi is currently the only genuinely replay-qualified
 * real harness substrate. This module:
 *
 *   1. Reads scenario-specific raw native JSONL fixtures
 *      from `lifecycle-corpus/fixtures/<scenario-id>/`.
 *   2. Feeds each line through the FROZEN Pi decoder
 *      (`decodePiEvent`).
 *   3. Maps the resulting `HarnessEvent` stream into a
 *      Phase E `RunEvent` stream (causal harness mapping —
 *      tool execution actually drives ACTION_*).
 *
 * L05-C01 (CORRECTION01): the mapper is no longer a no-op
 * for tool lifecycle. The harness is the authority for what
 * it actually observed; the per-scenario external-events
 * oracle owns only events the harness cannot authoritatively
 * emit (gates, repair, cancel, terminal decisions).
 *
 * Pi native kinds that are `PRESERVED_META_OBSERVATION`
 * or `KNOWN_BUT_UNMAPPED` (e.g. `compaction_start`,
 * `queue_update`) intentionally do NOT produce a Phase E
 * RunEvent — this is exactly the property LC06 requires:
 * context-pressure observations MUST NOT create
 * ACTION / gate / run-terminal evidence.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { decodePiEvent } from "../src/adapters/pi/pi-adapter.js";
import type { HarnessEvent } from "../src/protocol/harness-adapter.js";
import type {
  RunEvent,
  AttemptId,
} from "../src/run/run-types.js";
import { makeAttemptId } from "../src/run/run-types.js";

/**
 * Read a Pi scenario fixture, decode every line, and
 * return the candidate-neutral `HarnessEvent` stream.
 *
 * If any line is malformed (`MALFORMED` classification)
 * the loader throws — this is the explicit failure
 * surface for LC05 / LC11.
 *
 * L05-C05: when `segment` is provided, the loader applies
 * segment-binding rules:
 *   - segment_id == "A" (the first segment): no change.
 *   - segment_id == "B" (continuation): drop `candidate_started`
 *     so the mapper does not re-emit RUN_STARTED.
 *   - if the shared_session_id is required and absent,
 *     the loader throws (segment binding failure).
 */
export function loadPiFixture(args: {
  readonly repoRoot: string;
  readonly repoRelativePath: string;
  readonly attemptId: AttemptId;
  readonly segment?: { readonly id: "A" | "B"; readonly previous_segment?: boolean; readonly shared_session_id?: string };
}): ReadonlyArray<HarnessEvent> {
  // Accept either repo-root-relative or lab-relative paths.
  const direct = resolve(args.repoRoot, args.repoRelativePath);
  const labRel = resolve(
    args.repoRoot,
    "labs/long-horizon-harness",
    args.repoRelativePath,
  );
  const abs = existsSync(direct) ? direct : labRel;
  const raw = readFileSync(abs, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const events: HarnessEvent[] = [];
  let droppedContinuationStart = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const decoded = decodePiEvent(args.attemptId, line);
    if (decoded.classification === "MALFORMED") {
      throw new Error(
        `loadPiFixture: malformed line ${i + 1} in ${args.repoRelativePath}: ${decoded.hostile_reason}`,
      );
    }
    if (decoded.classification === "UNKNOWN") {
      throw new Error(
        `loadPiFixture: unknown native kind '${decoded.kind}' at line ${i + 1} in ${args.repoRelativePath}`,
      );
    }
    if (decoded.classification === "NORMALIZED" && decoded.event !== null) {
      // L05-C05: continuation segments MUST NOT emit their
      // own `candidate_started` — that would re-open a new
      // logical run. The previous-segment binding is what
      // makes the concatenation safe.
      if (
        args.segment?.id === "B" &&
        decoded.event.type === "candidate_started" &&
        !droppedContinuationStart
      ) {
        droppedContinuationStart = true;
        continue;
      }
      events.push(decoded.event);
    }
    // META_OBSERVATION and KNOWN_BUT_UNMAPPED intentionally
    // drop on the floor here; LC06 requires this.
  }
  return events;
}

/**
 * L05-C01 — Causal harness mapping for Pi.
 *
 * The Pi fixture is the SOLE authority for harness-observable
 * lifecycle facts. Specifically:
 *
 *   tool_started                              -> ACTION_STARTED
 *   tool_finished(ok=true)                    -> ACTION_FINISHED(OK)
 *   tool_finished(ok=false)                   -> ACTION_FINISHED(ERROR)
 *   candidate_started                         -> RUN_STARTED + HARNESS_STARTED
 *   candidate_message / completion / error    -> (observation only)
 *
 * The mapper returns TWO arrays so the runner can interleave
 * the harness-mapped events with the per-scenario external
 * events oracle (which provides GATE_*, REPAIR_*, REVIEW_*,
 * RUN_CANCEL_REQUESTED, terminal events).
 *
 * Concretely: in canonical lifecycle order, gates MUST be
 * observed between ACTION_STARTED and ACTION_FINISHED. We
 * therefore emit:
 *
 *   pre_gate   = [RUN_STARTED, HARNESS_STARTED, ...ACTION_STARTEDs]
 *   post_gate  = [...ACTION_FINISHEDs]
 *
 * The runner concatenates `pre_gate` + external_non_terminal
 * + `post_gate` + HARNESS_STOPPED + external_terminal. The
 * gate (if any) is therefore observed AFTER all action starts
 * and BEFORE the first action finishes — the canonical position
 * for a single pass-gate that authorizes the whole sequence.
 *
 * If `omitRunStarted` is true, RUN_STARTED + HARNESS_STARTED
 * are skipped (LC02/LC10/LC11 -> INCOMPLETE).
 */
export function piHarnessEventsToRunEvents(
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
  // Fallback: if no candidate_started and !omitRunStarted,
  // emit the run envelope at the head of pre_gate.
  if (!emittedRunStarted && !omitRunStarted) {
    pre_gate.unshift({ type: "RUN_STARTED" }, { type: "HARNESS_STARTED" });
  }
  return { pre_gate, post_gate };
}

/**
 * AttemptId factory for Pi replay scenarios. The
 * attempt-id is content-derived from the scenario id
 * so two consecutive runs are byte-stable.
 */
export function piAttemptId(scenarioId: string): AttemptId {
  return makeAttemptId(`att:${scenarioId.toLowerCase()}-001`);
}
