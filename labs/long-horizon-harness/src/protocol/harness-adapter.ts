/**
 * Candidate-neutral harness adapter contract.
 *
 * Doctrine D08: no candidate-specific types (clineSessionId, qwenTask,
 * piRPCMessage, opencodeSession, ...) appear in the common protocol. Each
 * candidate is wrapped behind an adapter that exposes only the small
 * vocabulary the lab needs to integrate it.
 *
 * Vocabulary kept deliberately small for FOUNDATION01:
 *   - start(): bootstrap a candidate's run.
 *   - events(): observe normalised, candidate-side events.
 *   - interrupt(): ask the candidate to stop.
 *   - status(): poll the candidate.
 *
 * The lab does NOT depend on any of these methods being async, but the
 * contract uses Promise/AsyncIterable because real harnesses are inherently
 * asynchronous. The fake adapter implements these with deterministic data.
 */

import type { HarnessHandle } from "../domain/ids.js";

export type HarnessKind =
  | "fake"
  | "cline"
  | "qwen_code"
  | "pi"
  | "opencode"
  | "hermes"
  | "unknown";

export const KNOWN_HARNESS_KINDS: readonly HarnessKind[] = [
  "fake",
  "cline",
  "qwen_code",
  "pi",
  "opencode",
  "hermes",
  "unknown",
] as const;

export function isHarnessKind(value: unknown): value is HarnessKind {
  return (
    typeof value === "string" &&
    (KNOWN_HARNESS_KINDS as readonly string[]).includes(value)
  );
}

export type StartInput = {
  readonly handle: HarnessHandle;
  /** Free-form adapter-specific arguments. */
  readonly args: Readonly<Record<string, string>>;
};

export type StartResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type InterruptResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type HarnessStatus =
  | { readonly phase: "starting" }
  | { readonly phase: "running" }
  | { readonly phase: "completed" }
  | { readonly phase: "errored"; readonly reason: string };

/**
 * Normalised candidate observation.
 *
 * These are NOT authoritative lifecycle events. The supervisor translates
 * them into {@link import("../domain/run-event.js").RunEvent}s through its
 * own logic; the candidate's claim ("candidate_reported_completion") is
 * never allowed to authoritatively complete a run.
 */
export type HarnessEvent =
  | { readonly type: "candidate_started"; readonly attemptId: string }
  | { readonly type: "candidate_message"; readonly attemptId: string; readonly text: string }
  | { readonly type: "tool_started"; readonly attemptId: string; readonly tool: string; readonly callId: string }
  | { readonly type: "tool_finished"; readonly attemptId: string; readonly tool: string; readonly callId: string; readonly ok: boolean; readonly error?: string }
  | { readonly type: "candidate_reported_completion"; readonly attemptId: string; readonly summary: string }
  | { readonly type: "candidate_error"; readonly attemptId: string; readonly code: string; readonly message: string };

export interface HarnessAdapter {
  readonly kind: HarnessKind;

  start(input: StartInput): Promise<StartResult>;

  /**
   * Return an async iterable of normalised events. Implementations must
   * terminate the iterable when the run is interrupted or finished.
   */
  events(handle: HarnessHandle): AsyncIterable<HarnessEvent>;

  interrupt(handle: HarnessHandle): Promise<InterruptResult>;

  status(handle: HarnessHandle): Promise<HarnessStatus>;
}
