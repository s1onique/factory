/**
 * LH-05 runner — normalize module (split for source-size discipline).
 *
 * L05-C08: parent runner.ts is the SINGLE logical authority.
 * L05-C10/C11 (CORRECTION02): segment metadata from the
 * catalog is threaded into the loader; the loader's typed
 * rejection surfaces are mapped to AdapterOutcome without
 * free-text parsing.
 */
import type {
  LifecycleScenario,
  AdapterErrorKind,
  RawFixture,
  LifecycleSegmentBinding,
} from "../types.js";
import type { RunEvent, AttemptId } from "../../src/run/run-types.js";
import type { HarnessEvent } from "../../src/protocol/harness-adapter.js";
import { loadFakeScript } from "./_fixtures.js";
import { loadPiFixture } from "../pi-fixtures.js";
import { segmentsForLoader } from "../segment-binding.js";
export { normalizePi, normalizeFake };
export type { AdapterOutcome };

type AdapterOutcome =
  | { readonly kind: "ACCEPTED" }
  | { readonly kind: "REJECTED"; readonly error_kind: AdapterErrorKind };

function normalizePi(args: {
  readonly repoRoot: string;
  readonly scenario: LifecycleScenario;
  readonly harnessEventAttemptId: AttemptId;
}): AdapterOutcome & {
  readonly harnessEvents: ReadonlyArray<HarnessEvent>;
} {
  // L05-C10: segment-aware fixture loading. When the
  // scenario declares an ordered `segments[]`, the runner
  // uses the canonical segment list (already validated by
  // `validateLifecycleSegmentChain`). Otherwise, it falls
  // back to the legacy single-fixture path (no segment
  // binding — non-LC07 scenarios).
  const segmentList: ReadonlyArray<LifecycleSegmentBinding> =
    args.scenario.segments !== undefined ? segmentsForLoader(args.scenario) : [];
  const fixturesByPath = new Map<string, LifecycleSegmentBinding>();
  for (const seg of segmentList) {
    fixturesByPath.set(seg.fixture_path, seg);
  }
  // Pick the pi_native_session_jsonl fixtures.
  const piFixtures = args.scenario.raw_fixture_set.filter(
    (f): f is RawFixture & { readonly kind: "pi_native_session_jsonl" } =>
      f.kind === "pi_native_session_jsonl",
  );
  if (piFixtures.length === 0) {
    return {
      kind: "REJECTED",
      error_kind: "EVIDENCE_CORRUPTION_DETECTED",
      harnessEvents: [],
    };
  }
  let all: HarnessEvent[] = [];
  for (const fx of piFixtures) {
    const seg = fixturesByPath.get(fx.repo_relative_path);
    const result = loadPiFixture({
      repoRoot: args.repoRoot,
      repoRelativePath: fx.repo_relative_path,
      attemptId: args.harnessEventAttemptId,
      ...(seg !== undefined ? { segment: seg } : {}),
    });
    if (!result.ok) {
      // L05-C11: typed loader failure -> typed adapter rejection.
      const reason = result.reason;
      let error_kind: AdapterErrorKind;
      if (reason === "MALFORMED_NATIVE_EVENT") {
        error_kind = "MALFORMED_NATIVE_EVENT";
      } else if (reason === "UNKNOWN_NATIVE_EVENT_KIND") {
        error_kind = "UNKNOWN_NATIVE_EVENT_KIND";
      } else {
        // SEGMENT_BINDING_INVALID / MISSING_SESSION_HEADER /
        // SESSION_ID_MISMATCH / UNEXPECTED_CONTINUATION_START
        // are all treated as evidence-corruption rejections
        // for the closed-world AdapterErrorKind surface.
        error_kind = "EVIDENCE_CORRUPTION_DETECTED";
      }
      return {
        kind: "REJECTED",
        error_kind,
        harnessEvents: [],
      };
    }
    all = all.concat(result.events);
  }
  return { kind: "ACCEPTED", harnessEvents: all };
}

function normalizeFake(args: {
  readonly repoRoot: string;
  readonly scenario: LifecycleScenario;
  readonly harnessEventAttemptId: AttemptId;
}): AdapterOutcome & {
  readonly harnessEvents: ReadonlyArray<import("../../src/protocol/harness-adapter.js").HarnessEvent>;
  readonly directRunEvents: ReadonlyArray<RunEvent>;
} {
  if (!args.scenario.eligible_harnesses.fake_reference_control.eligible) {
    return {
      kind: "REJECTED",
      error_kind: "EVIDENCE_CORRUPTION_DETECTED",
      harnessEvents: [],
      directRunEvents: [],
    };
  }
  const fx = args.scenario.raw_fixture_set.find(
    (f): f is RawFixture & { readonly kind: "scripted_fake_event_script" } =>
      f.kind === "scripted_fake_event_script",
  );
  if (fx === undefined) {
    return {
      kind: "REJECTED",
      error_kind: "EVIDENCE_CORRUPTION_DETECTED",
      harnessEvents: [],
      directRunEvents: [],
    };
  }
  const raw = loadFakeScript(args.repoRoot, fx.repo_relative_path);
  // The scripted-fake-adapter consumes typed HarnessEvents;
  // for the reference control we treat the script JSON as
  // a serialized HarnessEvent stream.
  const events: import("../../src/protocol/harness-adapter.js").HarnessEvent[] = [];
  for (const e of raw.harness) {
    switch (e.type) {
      case "candidate_started":
        events.push({ type: "candidate_started", attemptId: e.attemptId ?? args.harnessEventAttemptId });
        break;
      case "candidate_message":
        events.push({ type: "candidate_message", attemptId: e.attemptId ?? args.harnessEventAttemptId, text: e.summary ?? "" });
        break;
      case "tool_started":
        events.push({ type: "tool_started", attemptId: e.attemptId ?? args.harnessEventAttemptId, tool: e.tool ?? "unknown", callId: e.callId ?? "c1" });
        break;
      case "tool_finished":
        events.push({ type: "tool_finished", attemptId: e.attemptId ?? args.harnessEventAttemptId, tool: e.tool ?? "unknown", callId: e.callId ?? "c1", ok: e.ok ?? false, ...(e.error !== undefined ? { error: e.error } : {}) });
        break;
      case "candidate_reported_completion":
        events.push({ type: "candidate_reported_completion", attemptId: e.attemptId ?? args.harnessEventAttemptId, summary: e.summary ?? "done" });
        break;
      case "candidate_error":
        events.push({ type: "candidate_error", attemptId: e.attemptId ?? args.harnessEventAttemptId, code: e.code ?? "ERROR", message: e.message ?? "" });
        break;
      default:
        return {
          kind: "REJECTED",
          error_kind: "UNKNOWN_NATIVE_EVENT_KIND",
          harnessEvents: [],
          directRunEvents: [],
        };
    }
  }
  return { kind: "ACCEPTED", harnessEvents: events, directRunEvents: raw.run_events };
}
