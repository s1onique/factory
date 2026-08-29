/**
 * Shared test helpers.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  makeMissionId,
  makeRunId,
  makeEventId,
  makeAttemptId,
  type EventId,
  type AttemptId,
} from "../src/domain/ids.js";
import {
  initialState,
  type RunState,
} from "../src/domain/run-state.js";
import { transition } from "../src/domain/transition.js";
import type { RunEvent, RunEventType } from "../src/domain/run-event.js";
import type { Result } from "../src/domain/result.js";
import type { InvalidTransition } from "../src/domain/failure.js";

/** Unique-ish identifiers per test invocation. */
export const RUN_ID = makeRunId("run-1");
export const MISSION_ID = makeMissionId("mission-1");
export const ATTEMPT_ID = makeAttemptId("attempt-1");

let counter = 0;
export function makeEvent(
  type: RunEventType,
  overrides: Record<string, unknown> = {},
  idGen: () => EventId = nextEventId,
): RunEvent {
  const base = {
    eventId: idGen(),
    runId: RUN_ID,
    missionId: MISSION_ID,
    seq: 0,
    observedAt: 0,
    type,
  } as const;
  switch (type) {
    case "run_created":
    case "preparation_started":
    case "preparation_succeeded":
    case "review_started":
    case "review_passed":
    case "cancelled":
      return { ...base, ...overrides, type } as RunEvent;
    case "preparation_failed":
      return {
        ...base,
        ...overrides,
        type,
        failure: (overrides["failure"] as unknown) ?? {
          kind: "internal_failure",
          message: "test failure",
        },
      } as RunEvent;
    case "attempt_started":
      return {
        ...base,
        ...overrides,
        type,
        attemptId: (overrides["attemptId"] as AttemptId | undefined) ?? ATTEMPT_ID,
      } as RunEvent;
    case "agent_reported_completion":
      return {
        ...base,
        ...overrides,
        type,
        attemptId: (overrides["attemptId"] as AttemptId | undefined) ?? ATTEMPT_ID,
        summary: (overrides["summary"] as string | undefined) ?? "done",
      } as RunEvent;
    case "agent_failed":
      return {
        ...base,
        ...overrides,
        type,
        attemptId: (overrides["attemptId"] as AttemptId | undefined) ?? ATTEMPT_ID,
        failure: (overrides["failure"] as unknown) ?? {
          kind: "internal_failure",
          message: "agent failure",
        },
      } as RunEvent;
    case "gating_started":
      return {
        ...base,
        ...overrides,
        type,
        attemptId: (overrides["attemptId"] as AttemptId | undefined) ?? ATTEMPT_ID,
        gate: (overrides["gate"] as string | undefined) ?? "build-ok",
      } as RunEvent;
    case "gate_passed":
      return {
        ...base,
        ...overrides,
        type,
        attemptId: (overrides["attemptId"] as AttemptId | undefined) ?? ATTEMPT_ID,
        gate: (overrides["gate"] as string | undefined) ?? "build-ok",
      } as RunEvent;
    case "gate_failed":
      return {
        ...base,
        ...overrides,
        type,
        attemptId: (overrides["attemptId"] as AttemptId | undefined) ?? ATTEMPT_ID,
        gate: (overrides["gate"] as string | undefined) ?? "build-ok",
        failure: (overrides["failure"] as unknown) ?? {
          kind: "gate_failure",
          gate: "build-ok",
          message: "denied",
        },
      } as RunEvent;
    case "repair_started":
      return {
        ...base,
        ...overrides,
        type,
        reason: (overrides["reason"] as unknown) ?? {
          kind: "gate_failure",
          gate: "build-ok",
          message: "needs repair",
        },
      } as RunEvent;
    case "review_failed":
      return {
        ...base,
        ...overrides,
        type,
        failure: (overrides["failure"] as unknown) ?? {
          kind: "policy_denied",
          policy: "review",
          message: "rejected",
        },
      } as RunEvent;
    case "budget_exhausted":
      return {
        ...base,
        ...overrides,
        type,
        observation: (overrides["observation"] as unknown) ?? {
          kind: "tool_calls",
          limit: 5,
          observed: 5,
        },
      } as RunEvent;
    case "blocked":
      return {
        ...base,
        ...overrides,
        type,
        reason: (overrides["reason"] as unknown) ?? {
          kind: "policy_denied",
          policy: "external",
          message: "blocked",
        },
      } as RunEvent;
    case "crashed":
      return {
        ...base,
        ...overrides,
        type,
        reason: (overrides["reason"] as unknown) ?? {
          kind: "internal_failure",
          message: "crashed",
        },
      } as RunEvent;
  }
}
export function nextEventId(): EventId {
  counter += 1;
  return makeEventId(`e-${counter}`);
}

export function newSeq(): number {
  // Tests build sequences by calling replay directly; the helper just resets.
  counter += 1;
  return counter;
}

export function resetCounters(): void {
  counter = 0;
}

/**
 * Apply a sequence of events to the initial state and return the resulting
 * state (or the first invalid transition error).
 */
export function applySequence(
  events: ReadonlyArray<RunEvent>,
): Result<RunState, InvalidTransition> {
  let state: RunState = initialState(RUN_ID, MISSION_ID, 0);
  let lastResult: Result<RunState, InvalidTransition> = { ok: true, value: state };
  for (const e of events) {
    lastResult = transition(state, e);
    if (lastResult.ok === false) {
      return lastResult;
    }
    state = lastResult.value;
  }
  return lastResult;
}

/** Build a memfs tempdir for the test process. */
export async function mkTmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return dir;
}

/** Recursive delete. */
export async function rmRf(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}
