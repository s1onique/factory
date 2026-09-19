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
 * Pi native kinds that are `META_OBSERVATION`
 * or `KNOWN_BUT_UNMAPPED` (e.g. `compaction_start`,
 * `queue_update`) intentionally do NOT produce a Phase E
 * RunEvent — this is exactly the property LC06 requires:
 * context-pressure observations MUST NOT create
 * ACTION / gate / run-terminal evidence.
 *
 * L05-C10 / L05-C11 (CORRECTION02): the loader returns a
 * closed-world `PiFixtureLoadResult` and validates LC07
 * segment binding (session header id == declared
 * shared_session_id; continuation segments MUST NOT emit
 * `agent_start` / `candidate_started`). Failures are
 * REJECTED, never silently dropped.
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
import type {
  LifecycleSegmentBinding,
  PiFixtureLoadResult,
} from "./types.js";

/**
 * Read a Pi scenario fixture, decode every line, and
 * return a closed-world `PiFixtureLoadResult`.
 *
 * L05-C11: this loader is the SOLE authority for what
 * Pi actually observed. Failure reasons are machine-visible
 * (no free-text strings).
 */
export function loadPiFixture(args: {
  readonly repoRoot: string;
  readonly repoRelativePath: string;
  readonly attemptId: AttemptId;
  readonly segment?: LifecycleSegmentBinding;
}): PiFixtureLoadResult {
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
  let sessionHeaderSeen = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // L05-C10: native `session` header binding.
    if (!sessionHeaderSeen) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        // fall through — let the decoder produce a
        // MALFORMED classification below.
      }
      if (parsed !== undefined && typeof parsed === "object" && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        if (obj.type === "session") {
          sessionHeaderSeen = true;
          const id = typeof obj.id === "string" ? obj.id : null;
          if (args.segment !== undefined) {
            // Both cold-start and continuation paths validate
            // the declared shared_session_id against the
            // native header (when one is present).
            if (id !== args.segment.shared_session_id) {
              return {
                ok: false,
                reason: "SESSION_ID_MISMATCH",
              };
            }
          }
          // session header is observation-only; do not
          // emit a HarnessEvent for it.
          continue;
        }
      }
    }
    const decoded = decodePiEvent(args.attemptId, line);
    if (decoded.classification === "MALFORMED") {
      return {
        ok: false,
        reason: "MALFORMED_NATIVE_EVENT",
      };
    }
    if (decoded.classification === "UNKNOWN") {
      return {
        ok: false,
        reason: "UNKNOWN_NATIVE_EVENT_KIND",
      };
    }
    // L05-C11: a continuation segment MUST NOT emit
    // `agent_start`. The Pi decoder maps `agent_start`
    // into a HarnessEvent of type `candidate_started`.
    // Continuation lifecycle observations are
    // authoritative evidence; we MUST NOT delete them.
    if (
      args.segment !== undefined &&
      args.segment.previous_segment_id !== null &&
      decoded.classification === "NORMALIZED" &&
      decoded.event.type === "candidate_started"
    ) {
      return {
        ok: false,
        reason: "UNEXPECTED_CONTINUATION_START",
      };
    }
    if (decoded.classification === "META_OBSERVATION" || decoded.classification === "KNOWN_BUT_UNMAPPED") {
      continue;
    }
    if (decoded.event !== undefined && decoded.event !== null) {
      events.push(decoded.event);
    }
  }
  // L05-C10: the cold-start segment MUST carry a native
  // session header. If it does not, the loader rejects
  // with MISSING_SESSION_HEADER. Continuation segments
  // may legitimately omit the header.
  if (args.segment !== undefined) {
    if (args.segment.previous_segment_id === null && !sessionHeaderSeen) {
      return { ok: false, reason: "MISSING_SESSION_HEADER" };
    }
  }
  return { ok: true, events };
}

/**
 * L05-C01 — Causal harness mapping for Pi.
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
 * AttemptId factory for Pi replay scenarios. The
 * attempt-id is content-derived from the scenario id
 * so two consecutive runs are byte-stable.
 */
export function piAttemptId(scenarioId: string): AttemptId {
  return makeAttemptId(`att:${scenarioId.toLowerCase()}-001`);
}