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
 *      Phase E `RunEvent` stream (same mapping as the
 *      reference control, for the events the V1 mapping
 *      emits).
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
 */
export function loadPiFixture(args: {
  readonly repoRoot: string;
  readonly repoRelativePath: string;
  readonly attemptId: AttemptId;
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
      events.push(decoded.event);
    }
    // META_OBSERVATION and KNOWN_BUT_UNMAPPED intentionally
    // drop on the floor here; LC06 requires this.
  }
  return events;
}

/**
 * Convert the Pi-decoded HarnessEvent stream into a
 * Phase E RunEvent stream. Identical mapping rules to
 * the reference control (`reference-control.ts`):
 * the mapper emits ONLY RUN_STARTED + HARNESS_STARTED;
 * the oracle owns the action / gate / terminal lifecycle.
 */
export function piHarnessEventsToRunEvents(
  _events: ReadonlyArray<HarnessEvent>,
  _attemptId: AttemptId,
  omitRunStarted: boolean = false,
): ReadonlyArray<RunEvent> {
  const out: RunEvent[] = [];
  if (!omitRunStarted) {
    out.push({ type: "RUN_STARTED" });
    out.push({ type: "HARNESS_STARTED" });
  }
  // All other Pi-native events are observations only; the
  // Phase E oracle owns the action / gate / terminal lifecycle.
  return out;
}

/**
 * AttemptId factory for Pi replay scenarios. The
 * attempt-id is content-derived from the scenario id
 * so two consecutive runs are byte-stable.
 */
export function piAttemptId(scenarioId: string): AttemptId {
  return makeAttemptId(`att:${scenarioId.toLowerCase()}-001`);
}
