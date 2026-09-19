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
 * shared_session_id). Failures are REJECTED, never silently
 * dropped.
 *
 * L05-C15 / L05-C16 / L05-C18 (CORRECTION03): the loader
 * enforces the Pi JSON-mode contract that the FIRST
 * non-empty record of every process invocation is the
 * `session` header. Continuation segments (modeling a
 * process restart on the same logical session) MAY carry
 * `agent_start`; the harness mapper deduplicates
 * RUN_STARTED via its `emittedRunStarted` flag. The
 * invariant `PROCESS_RESTART != NEW_FACTORY_RUN` is
 * preserved structurally.
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
 *
 * L05-C15 / L05-C16 / L05-C18 (CORRECTION03): each segment
 * models a Pi process invocation, not a stream chunk. The
 * Pi JSON-mode contract states that the FIRST non-empty
 * record of every invocation is the `session` header (see
 * Pi docs/json.md). The loader enforces this:
 *
 *   - segment without a `session` header at record 1 →
 *     MISSING_SESSION_HEADER (cold-start) or
 *     MISSING_CONTINUATION_SESSION_HEADER (continuation).
 *   - segment with a `session` header at a non-first
 *     record → NATIVE_HEADER_NOT_AT_FIRST_RECORD.
 *   - segment with a `session` header whose id disagrees
 *     with the declared `shared_session_id` →
 *     SESSION_ID_MISMATCH.
 *
 * Continuation segments MAY emit `agent_start` (it models
 * a process restart inside the same logical session). The
 * harness mapper deduplicates RUN_STARTED via its
 * `emittedRunStarted` flag, so the second `candidate_started`
 * is recorded as a process/agent restart observation rather
 * than projected as a duplicate Factory run start. This is
 * exactly the LC07 invariant:
 * `PROCESS_RESTART != NEW_FACTORY_RUN`.
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
  let headerAtIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // L05-C10 / L05-C18 (CORRECTION03): the native `session`
    // header MUST be the FIRST non-empty record. Probe the
    // first record structurally; if it isn't a session
    // header, the segment is malformed.
    if (headerAtIdx === null && i === 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return { ok: false, reason: "MALFORMED_NATIVE_EVENT" };
      }
      if (parsed === null || typeof parsed !== "object") {
        return { ok: false, reason: "MALFORMED_NATIVE_EVENT" };
      }
      const obj = parsed as Record<string, unknown>;
      if (obj.type !== "session") {
        return {
          ok: false,
          reason: "NATIVE_HEADER_NOT_AT_FIRST_RECORD",
        };
      }
      headerAtIdx = 0;
      const id = typeof obj.id === "string" ? obj.id : null;
      if (args.segment !== undefined) {
        if (id !== args.segment.shared_session_id) {
          return { ok: false, reason: "SESSION_ID_MISMATCH" };
        }
      }
      // session header is observation-only; do not emit a
      // HarnessEvent for it.
      continue;
    }
    // Subsequent lines: if a header was never seen, the
    // segment is missing its native session header
    // entirely. Probe the line structurally to detect a
    // late-arriving header.
    if (headerAtIdx === null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return { ok: false, reason: "MALFORMED_NATIVE_EVENT" };
      }
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        (parsed as Record<string, unknown>).type === "session"
      ) {
        return {
          ok: false,
          reason: "NATIVE_HEADER_NOT_AT_FIRST_RECORD",
        };
      }
    }
    const decoded = decodePiEvent(args.attemptId, line);
    if (decoded.classification === "MALFORMED") {
      return { ok: false, reason: "MALFORMED_NATIVE_EVENT" };
    }
    if (decoded.classification === "UNKNOWN") {
      return { ok: false, reason: "UNKNOWN_NATIVE_EVENT_KIND" };
    }
    // L05-C16 (CORRECTION03): a continuation segment MAY
    // emit `agent_start`. The Pi decoder maps it to
    // `candidate_started`; the harness mapper's
    // `emittedRunStarted` flag deduplicates RUN_STARTED.
    // The event is NOT silently deleted — it is recorded
    // as a `HarnessEvent` so the runner can observe the
    // process restart; the projection simply doesn't emit
    // a second RUN_STARTED.
    if (
      decoded.classification === "META_OBSERVATION" ||
      decoded.classification === "KNOWN_BUT_UNMAPPED"
    ) {
      continue;
    }
    if (decoded.event !== undefined && decoded.event !== null) {
      events.push(decoded.event);
    }
  }
  // L05-C18 (CORRECTION03): every process-bound segment
  // MUST carry its own native session header at the first
  // non-empty record. The cold-start empty-file case is
  // reported as MISSING_SESSION_HEADER. The continuation
  // empty-file case is reported as NATIVE_HEADER_NOT_AT_FIRST_RECORD
  // (the first-record rule is the same). Continuation
  // segments are never expected to be empty in practice —
  // a real Pi process restart always emits at least the
  // session header — so an empty continuation is treated
  // as a malformed first record.
  if (args.segment !== undefined && headerAtIdx === null) {
    if (args.segment.previous_segment_id === null) {
      return { ok: false, reason: "MISSING_SESSION_HEADER" };
    }
    return {
      ok: false,
      reason: "NATIVE_HEADER_NOT_AT_FIRST_RECORD",
    };
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
