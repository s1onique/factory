/**
 * Authoritative lifecycle events.
 *
 * These events drive the supervisor state machine. They are produced by the
 * supervisor itself (not directly by the candidate harness) so that the
 * completion of a run is never decided by the candidate alone.
 *
 * Doctrine reminders:
 *   - D02: model/agent completion is not authoritative completion.
 *   - The agent's completion claim flows through `agent_reported_completion`
 *     which only transitions the run into `gating`, never to `completed`.
 */

import type { AttemptId, EventId, MissionId, RunId } from "./ids.js";
import type { Failure } from "./failure.js";
import type { BudgetObservation } from "./budget.js";

export type RunEventType =
  | "run_created"
  | "preparation_started"
  | "preparation_succeeded"
  | "preparation_failed"
  | "attempt_started"
  | "agent_reported_completion"
  | "agent_failed"
  | "gating_started"
  | "gate_passed"
  | "gate_failed"
  | "repair_started"
  | "review_started"
  | "review_passed"
  | "review_failed"
  | "budget_exhausted"
  | "blocked"
  | "crashed"
  | "cancelled";

export const RUN_EVENT_TYPES: readonly RunEventType[] = [
  "run_created",
  "preparation_started",
  "preparation_succeeded",
  "preparation_failed",
  "attempt_started",
  "agent_reported_completion",
  "agent_failed",
  "gating_started",
  "gate_passed",
  "gate_failed",
  "repair_started",
  "review_started",
  "review_passed",
  "review_failed",
  "budget_exhausted",
  "blocked",
  "crashed",
  "cancelled",
] as const;

export function isRunEventType(value: unknown): value is RunEventType {
  return (
    typeof value === "string" &&
    (RUN_EVENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Common metadata fields every committed event carries.
 *
 *  - eventId:    stable identifier of this event.
 *  - runId:      run identity. Must equal the run this event belongs to.
 *  - missionId:  mission identity. Must equal the run's mission.
 *  - seq:        monotonically increasing per-run sequence (allocated by
 *                the ledger; never supplied by event producers).
 *  - observedAt: timestamp observed by the supervisor at the moment the
 *                event was emitted. Replay correctness MUST NOT depend
 *                on this value.
 *
 * This shape is only constructed by the ledger when committing a payload.
 * Event producers do NOT produce this shape directly; they produce
 * {@link RunEventPayload} and let the ledger attach the metadata.
 */
export type EventMetadata = {
  readonly eventId: EventId;
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly seq: number;
  readonly observedAt: number;
};

/**
 * Authoritative event payload.
 *
 * This is the candidate-neutral description of what happened. It carries
 * no ledger-owned metadata (sequence, run/mission ids, observedAt). The
 * ledger stamps metadata onto a payload to produce a
 * {@link CommittedRunEvent}.
 *
 * Every lifecycle event in FOUNDATION01 corresponds to exactly one
 * payload variant below.
 */
export type RunEventPayload =
  | { readonly type: "run_created" }
  | { readonly type: "preparation_started" }
  | { readonly type: "preparation_succeeded" }
  | { readonly type: "preparation_failed"; readonly failure: Failure }
  | { readonly type: "attempt_started"; readonly attemptId: AttemptId }
  | { readonly type: "agent_reported_completion"; readonly attemptId: AttemptId; readonly summary: string }
  | { readonly type: "agent_failed"; readonly attemptId: AttemptId; readonly failure: Failure }
  | { readonly type: "gating_started"; readonly attemptId: AttemptId; readonly gate: string }
  | { readonly type: "gate_passed"; readonly attemptId: AttemptId; readonly gate: string }
  | { readonly type: "gate_failed"; readonly attemptId: AttemptId; readonly gate: string; readonly failure: Failure }
  | { readonly type: "repair_started"; readonly reason: Failure }
  | { readonly type: "review_started" }
  | { readonly type: "review_passed" }
  | { readonly type: "review_failed"; readonly failure: Failure }
  | { readonly type: "budget_exhausted"; readonly observation: BudgetObservation }
  | { readonly type: "blocked"; readonly reason: Failure }
  | { readonly type: "crashed"; readonly reason: Failure }
  | { readonly type: "cancelled" };

/**
 * A committed event: payload stamped with ledger-owned metadata.
 *
 * This is the only shape the rest of the lab consumes; the encoder and
 * decoder both produce it. The ledger produces it; event producers do
 * not.
 */
export type CommittedRunEvent = EventMetadata & RunEventPayload;

/**
 * Ergonomic alias preserved from FOUNDATION01. The lab calls these
 * "RunEvent"s everywhere; the type itself is now `CommittedRunEvent`.
 */
export type RunEvent = CommittedRunEvent;

export type RunEventOf<T extends RunEventType> = Extract<RunEvent, { type: T }>;

/** Returns the event kind (safe because every RunEvent has a string `type`). */
export function eventType(e: RunEvent): RunEventType {
  return e.type;
}

/**
 * Structural equality on a RunEvent.
 *
 * Used by tests to confirm that an event survives a decode/encode cycle
 * intact (in particular the discriminator and all payload fields).
 *
 * Failure payloads are compared via stable JSON serialisation because the
 * decoder guarantees canonical, no-undefined structures.
 */
export function eventEquals(a: RunEvent, b: RunEvent): boolean {
  if (a.type !== b.type) {
    return false;
  }
  if (
    a.eventId !== b.eventId ||
    a.runId !== b.runId ||
    a.missionId !== b.missionId ||
    a.seq !== b.seq ||
    a.observedAt !== b.observedAt
  ) {
    return false;
  }
  switch (a.type) {
    case "run_created":
    case "preparation_started":
    case "preparation_succeeded":
    case "review_started":
    case "review_passed":
    case "cancelled":
      return true;
    case "preparation_failed":
      return (
        b.type === "preparation_failed" &&
        JSON.stringify(a.failure) === JSON.stringify(b.failure)
      );
    case "attempt_started":
      return b.type === "attempt_started" && a.attemptId === b.attemptId;
    case "agent_reported_completion":
      return (
        b.type === "agent_reported_completion" &&
        a.attemptId === b.attemptId &&
        a.summary === b.summary
      );
    case "agent_failed":
      return (
        b.type === "agent_failed" &&
        a.attemptId === b.attemptId &&
        JSON.stringify(a.failure) === JSON.stringify(b.failure)
      );
    case "gating_started":
      return (
        b.type === "gating_started" &&
        a.attemptId === b.attemptId &&
        a.gate === b.gate
      );
    case "gate_passed":
      return (
        b.type === "gate_passed" &&
        a.attemptId === b.attemptId &&
        a.gate === b.gate
      );
    case "gate_failed":
      return (
        b.type === "gate_failed" &&
        a.attemptId === b.attemptId &&
        a.gate === b.gate &&
        JSON.stringify(a.failure) === JSON.stringify(b.failure)
      );
    case "repair_started":
      return (
        b.type === "repair_started" &&
        JSON.stringify(a.reason) === JSON.stringify(b.reason)
      );
    case "review_failed":
      return (
        b.type === "review_failed" &&
        JSON.stringify(a.failure) === JSON.stringify(b.failure)
      );
    case "budget_exhausted":
      return (
        b.type === "budget_exhausted" &&
        a.observation.kind === b.observation.kind &&
        a.observation.limit === b.observation.limit &&
        a.observation.observed === b.observation.observed
      );
    case "blocked":
      return (
        b.type === "blocked" &&
        JSON.stringify(a.reason) === JSON.stringify(b.reason)
      );
    case "crashed":
      return (
        b.type === "crashed" &&
        JSON.stringify(a.reason) === JSON.stringify(b.reason)
      );
  }
}
