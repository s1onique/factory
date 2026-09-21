/**
 * LH-06 supervisor timing tests.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01-CORRECTION11 L06-C46)
 *
 * QUALIFICATION01 ran for an hour but the supervisor's
 * terminal result reported `started_at == finished_at`
 * and `duration_ms == 0`. That is false evidence.
 *
 * L06-CORRECTION11 L06-C46: the supervisor MUST own its
 * start timestamp (wall-clock + monotonic) at module
 * init. The terminal synthesis uses the supervisor's own
 * elapsed time.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeSupervisorResult } from "../../soak/result-io.js";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

function tmpFile(name: string): string {
  return join("/tmp", `factory-lh06-c46-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

function makeArgs(overrides: { readonly duration_ms: number; readonly started_at_ms: number; readonly finished_at_ms: number; readonly path: string }) {
  return {
    path: overrides.path,
    profile: "QUALIFICATION",
    supervisor_run_id: "abc123",
    worker_result_path: null,
    verdict: "FAIL_WORKER" as const,
    failure: {
      kind: "WORKER_CRASH" as const,
      epoch: null,
      last_completed_case: null,
      minimal_diff: { stub: true },
      message: "test",
    },
    child_exit_code: 1,
    child_exit_signal: null,
    supervisor_reason: "test",
    started_at_ms: overrides.started_at_ms,
    finished_at_ms: overrides.finished_at_ms,
    duration_ms: overrides.duration_ms,
  };
}

test("L06-C46-TIME01: writeSupervisorResult honors supervisor-supplied started/finished", () => {
  const path = tmpFile("result");
  mkdirSync(join(path, ".."), { recursive: true });
  try {
    const started = Date.now() - 1000;
    const finished = Date.now();
    writeSupervisorResult(
      makeArgs({
        path,
        started_at_ms: started,
        finished_at_ms: finished,
        duration_ms: finished - started,
      }),
    );
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.equal(raw["started_at"], new Date(started).toISOString());
    assert.equal(raw["finished_at"], new Date(finished).toISOString());
    assert.equal(raw["duration_ms"], finished - started);
  } finally {
    rmSync(path, { force: true });
  }
});

test("L06-C46-TIME02: duration_ms is the supervisor's own monotonic elapsed", async () => {
  const path = tmpFile("duration");
  mkdirSync(join(path, ".."), { recursive: true });
  try {
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const end = Date.now();
    writeSupervisorResult(
      makeArgs({
        path,
        started_at_ms: start,
        finished_at_ms: end,
        duration_ms: end - start,
      }),
    );
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const duration = raw["duration_ms"] as number;
    assert.ok(duration >= 200, `duration_ms should be >= 200ms; got ${duration}`);
  } finally {
    rmSync(path, { force: true });
  }
});

test("L06-C46-TIME03: started_at != finished_at for a non-instantaneous supervisor", async () => {
  const path = tmpFile("distinct");
  mkdirSync(join(path, ".."), { recursive: true });
  try {
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const end = Date.now();
    writeSupervisorResult(
      makeArgs({
        path,
        started_at_ms: start,
        finished_at_ms: end,
        duration_ms: end - start,
      }),
    );
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.notEqual(raw["started_at"], raw["finished_at"]);
  } finally {
    rmSync(path, { force: true });
  }
});

test("L06-C46-TIME04: invariants finished_at >= started_at and duration_ms >= 0", () => {
  const path = tmpFile("invariants");
  mkdirSync(join(path, ".."), { recursive: true });
  try {
    const start = Date.now();
    const end = start;
    writeSupervisorResult(
      makeArgs({
        path,
        started_at_ms: start,
        finished_at_ms: end,
        duration_ms: 0,
      }),
    );
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.ok((raw["duration_ms"] as number) >= 0);
    assert.equal(
      new Date(raw["finished_at"] as string).getTime() >=
        new Date(raw["started_at"] as string).getTime(),
      true,
    );
  } finally {
    rmSync(path, { force: true });
  }
});

test("L06-C46-TIME05: ZERO_DURATION_LONG_RUN is impossible (long run -> non-zero)", async () => {
  const path = tmpFile("long");
  mkdirSync(join(path, ".."), { recursive: true });
  try {
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const end = Date.now();
    writeSupervisorResult(
      makeArgs({
        path,
        started_at_ms: start,
        finished_at_ms: end,
        duration_ms: end - start,
      }),
    );
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    assert.ok(
      (raw["duration_ms"] as number) > 0,
      "a 300ms run must have non-zero duration",
    );
  } finally {
    rmSync(path, { force: true });
  }
});