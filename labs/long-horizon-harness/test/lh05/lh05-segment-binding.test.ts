/**
 * LH-05 segment-binding test (L05-C10 / L05-C11).
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * Closed-world validation of the LC07 segment chain:
 *   LC07-BIND01 valid A->B binding passes
 *   LC07-BIND02 reversed order rejected
 *   LC07-BIND03 duplicate A rejected
 *   LC07-BIND04 missing A rejected
 *   LC07-BIND05 shared session mismatch rejected
 *   LC07-BIND06 capture mismatch rejected
 *   LC07-BIND07 native header mismatch rejected
 *   LC07-BIND08 continuation candidate_started rejected
 *   LC07-BIND09 unknown predecessor rejected
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { findScenario } from "../../lifecycle-corpus/catalog.js";
import {
  validateLifecycleSegmentChain,
} from "../../lifecycle-corpus/segment-binding.js";
import {
  loadPiFixture,
} from "../../lifecycle-corpus/pi-fixtures.js";
import { makeAttemptId } from "../../src/run/run-types.js";

const REPO_ROOT = process.cwd();

const SEGMENT_A_PATH =
  "lifecycle-corpus/fixtures/lc07-restart-recovery/pi.session.segment-A.jsonl";
const SEGMENT_B_PATH =
  "lifecycle-corpus/fixtures/lc07-restart-recovery/pi.session.segment-B.jsonl";
const SHARED_SESSION_ID =
  "lc05-fixed-session-id-fixed-session-id-fixed-session-id-fixed";

function seg(overrides: Partial<{
  capture_id: string;
  segment_id: string;
  ordinal: number;
  shared_session_id: string;
  previous_segment_id: string | null;
  fixture_path: string;
}>): import("../../lifecycle-corpus/types.js").LifecycleSegmentBinding {
  return {
    capture_id: "lc07-capture-001",
    segment_id: "A",
    ordinal: 0,
    shared_session_id: SHARED_SESSION_ID,
    previous_segment_id: null,
    fixture_path: SEGMENT_A_PATH,
    ...overrides,
  };
}

test("LC07-BIND01 valid A->B binding passes (catalog-declared chain)", () => {
  const lc07 = findScenario("LC07");
  assert.ok(lc07, "LC07 must exist");
  const v = validateLifecycleSegmentChain(lc07!.segments);
  assert.equal(v.ok, true, "valid LC07 chain must validate");
  if (v.ok) {
    assert.equal(v.segments.length, 2);
    assert.equal(v.segments[0]!.segment_id, "A");
    assert.equal(v.segments[1]!.segment_id, "B");
    assert.equal(v.segments[1]!.previous_segment_id, "A");
  }
});

test("LC07-BIND02 reversed order rejected (SEGMENT_ORDER_INVALID)", () => {
  const v = validateLifecycleSegmentChain([
    seg({ segment_id: "B", ordinal: 1, previous_segment_id: "A", fixture_path: SEGMENT_B_PATH }),
    seg({ segment_id: "A", ordinal: 0, fixture_path: SEGMENT_A_PATH }),
  ]);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "SEGMENT_ORDER_INVALID");
});

test("LC07-BIND03 duplicate A rejected (DUPLICATE_SEGMENT)", () => {
  const v = validateLifecycleSegmentChain([
    seg({ segment_id: "A", ordinal: 0, fixture_path: SEGMENT_A_PATH }),
    seg({ segment_id: "A", ordinal: 1, previous_segment_id: "A", fixture_path: "anywhere" }),
  ]);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "DUPLICATE_SEGMENT");
});

test("LC07-BIND04 missing A rejected (MISSING_PREDECESSOR)", () => {
  // A "B only" chain where B declares previous_segment_id
  // pointing to an absent A. The validator MUST reject
  // because the declared predecessor is not in the chain.
  const v = validateLifecycleSegmentChain([
    seg({ segment_id: "B", ordinal: 0, previous_segment_id: "A", fixture_path: SEGMENT_B_PATH }),
  ]);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.ok(
      v.reason === "MISSING_PREDECESSOR" || v.reason === "UNBOUND_CONTINUATION",
      `expected MISSING_PREDECESSOR or UNBOUND_CONTINUATION, got ${v.reason}`,
    );
  }
});

test("LC07-BIND05 shared_session_id mismatch rejected (SESSION_ID_MISMATCH)", () => {
  const v = validateLifecycleSegmentChain([
    seg({ segment_id: "A", ordinal: 0, shared_session_id: "session-X", fixture_path: SEGMENT_A_PATH }),
    seg({ segment_id: "B", ordinal: 1, shared_session_id: "session-Y", previous_segment_id: "A", fixture_path: SEGMENT_B_PATH }),
  ]);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "SESSION_ID_MISMATCH");
});

test("LC07-BIND06 capture_id mismatch rejected (CAPTURE_ID_MISMATCH)", () => {
  const v = validateLifecycleSegmentChain([
    seg({ capture_id: "lc07-capture-001", segment_id: "A", ordinal: 0, fixture_path: SEGMENT_A_PATH }),
    seg({ capture_id: "lc07-capture-002", segment_id: "B", ordinal: 1, previous_segment_id: "A", fixture_path: SEGMENT_B_PATH }),
  ]);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "CAPTURE_ID_MISMATCH");
});

test("LC07-BIND07 native header id != declared shared_session_id (SESSION_ID_MISMATCH)", () => {
  const bad = seg({});
  const badSegment = { ...bad, shared_session_id: "wrong-id" };
  const r = loadPiFixture({
    repoRoot: REPO_ROOT,
    repoRelativePath: SEGMENT_A_PATH,
    attemptId: makeAttemptId("att:lc07-bind07"),
    segment: badSegment,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "SESSION_ID_MISMATCH");
});

test("LC07-BIND08 continuation candidate_started rejected (UNEXPECTED_CONTINUATION_START)", () => {
  // Build a transient continuation fixture containing agent_start
  // (which normalizes to candidate_started). The loader MUST
  // reject with UNEXPECTED_CONTINUATION_START and MUST NOT
  // silently drop the event.
  const tmpPath = `/tmp/lh05-bind08-${Date.now()}.jsonl`;
  try {
    writeFileSync(tmpPath, '{"type":"agent_start"}\n', "utf8");
    const r = loadPiFixture({
      repoRoot: REPO_ROOT,
      repoRelativePath: tmpPath,
      attemptId: makeAttemptId("att:lc07-bind08"),
      segment: seg({
        segment_id: "B",
        ordinal: 1,
        previous_segment_id: "A",
        fixture_path: tmpPath,
      }),
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, "UNEXPECTED_CONTINUATION_START");
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
});

test("LC07-BIND09 unknown predecessor rejected (MISSING_PREDECESSOR)", () => {
  const v = validateLifecycleSegmentChain([
    seg({ segment_id: "A", ordinal: 0, fixture_path: SEGMENT_A_PATH }),
    seg({ segment_id: "B", ordinal: 1, previous_segment_id: "Z", fixture_path: SEGMENT_B_PATH }),
  ]);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(v.reason, "MISSING_PREDECESSOR");
});

test("LC07-BIND10 LC07 native segment-A session id MUST equal declared shared_session_id", () => {
  const raw = readFileSync(`${REPO_ROOT}/${SEGMENT_A_PATH}`, "utf8");
  const first = raw.split(/\r?\n/).filter((l) => l.length > 0)[0];
  assert.ok(first, "segment-A must have at least one line");
  const obj = JSON.parse(first!);
  assert.equal(obj.type, "session");
  assert.equal(obj.id, SHARED_SESSION_ID);
});

test("LC07-BIND11 LC07 segment-A cold-start MUST carry a native session header (loader enforces)", () => {
  const r = loadPiFixture({
    repoRoot: REPO_ROOT,
    repoRelativePath: SEGMENT_A_PATH,
    attemptId: makeAttemptId("att:lc07-bind11"),
    segment: seg({ segment_id: "A", ordinal: 0, previous_segment_id: null }),
  });
  assert.equal(r.ok, true, "segment-A must load successfully");
});

test("LC07-BIND12 LC07 segment-B continuation loads successfully (no agent_start in fixture)", () => {
  const r = loadPiFixture({
    repoRoot: REPO_ROOT,
    repoRelativePath: SEGMENT_B_PATH,
    attemptId: makeAttemptId("att:lc07-bind12"),
    segment: seg({ segment_id: "B", ordinal: 1, previous_segment_id: "A", fixture_path: SEGMENT_B_PATH }),
  });
  assert.equal(r.ok, true, "segment-B must load successfully when no agent_start is present");
  if (r.ok) {
    const hasToolFinished = r.events.some((e) => e.type === "tool_finished");
    assert.ok(hasToolFinished, "segment-B tool execution must reach the loader");
  }
});

test("LC07-BIND13 LC07 segment-B fixture does NOT contain agent_start", () => {
  const raw = readFileSync(`${REPO_ROOT}/${SEGMENT_B_PATH}`, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  for (const line of lines) {
    const obj = JSON.parse(line);
    assert.notEqual(obj.type, "agent_start", "segment-B MUST NOT contain agent_start (L05-C11)");
  }
});
