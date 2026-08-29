/**
 * Deterministic scripted fake adapter.
 *
 * The fake exists to exercise the lifecycle without involving any real
 * harness, network, LLM, randomness, or wall-clock wait. It produces a
 * configurable sequence of normalised events and exposes them through the
 * {@link HarnessAdapter} contract.
 *
 * Doctrines honoured:
 *   - No network. No LLM. No randomness. No wall-clock sleeps. No shell.
 *   - Candidate observations flow through the same vocabulary real
 *     adapters must use; they are not {@link import("../domain/run-event.js").RunEvent}s.
 *   - Even when the script ends with a `candidate_reported_completion`,
 *     the adapter does NOT directly tell the supervisor the run is done;
 *     the supervisor's transition function is what decides what to do
 *     with that observation.
 */

import {
  type HarnessAdapter,
  type HarnessEvent,
  type HarnessStatus,
  type StartInput,
  type StartResult,
  type InterruptResult,
} from "../../protocol/harness-adapter.js";
import type { HarnessHandle } from "../../domain/ids.js";

type ScriptedEvent = HarnessEvent;

export type FakeScript = ReadonlyArray<ScriptedEvent>;

export type FakeAdapterOptions = {
  readonly script: FakeScript;
  /**
   * If true, calling `events()` after the script has been fully consumed
   * terminates the iterable. The default is true.
   */
  readonly terminateOnExhaustion?: boolean;
};

export class ScriptedFakeAdapter implements HarnessAdapter {
  readonly kind = "fake" as const;
  private readonly scripts = new Map<HarnessHandle, FakeScript>();
  private readonly exhausted = new Set<HarnessHandle>();
  private readonly interrupted = new Set<HarnessHandle>();

  constructor(private readonly opts: FakeAdapterOptions) {}

  async start(input: StartInput): Promise<StartResult> {
    this.scripts.set(input.handle, this.opts.script);
    this.exhausted.delete(input.handle);
    this.interrupted.delete(input.handle);
    return { ok: true };
  }

  async *events(handle: HarnessHandle): AsyncIterable<HarnessEvent> {
    const script = this.scripts.get(handle);
    if (!script) {
      throw new Error(`No script registered for handle '${handle}'.`);
    }
    for (const event of script) {
      if (this.interrupted.has(handle)) {
        return;
      }
      yield event;
    }
    this.exhausted.add(handle);
    if (this.opts.terminateOnExhaustion === false) {
      // Yielding nothing more is the same as terminating; reserved for
      // future tests that want to observe the empty end-of-stream state.
    }
  }

  async interrupt(handle: HarnessHandle): Promise<InterruptResult> {
    this.interrupted.add(handle);
    return { ok: true };
  }

  async status(handle: HarnessHandle): Promise<HarnessStatus> {
    if (this.interrupted.has(handle)) {
      return { phase: "errored", reason: "interrupted" };
    }
    if (this.exhausted.has(handle)) {
      return { phase: "completed" };
    }
    if (this.scripts.has(handle)) {
      return { phase: "running" };
    }
    return { phase: "starting" };
  }
}

/**
 * Build a script for the most common test scenario: the candidate starts,
 * produces a tool call, then reports completion. Tests will pair this with
 * the supervisor to verify that "completion" alone does not produce
 * authoritative completion.
 */
export function defaultHappyPathScript(attemptId: string): FakeScript {
  return [
    { type: "candidate_started", attemptId },
    {
      type: "candidate_message",
      attemptId,
      text: "Working on it.",
    },
    {
      type: "tool_started",
      attemptId,
      tool: "echo",
      callId: "c1",
    },
    {
      type: "tool_finished",
      attemptId,
      tool: "echo",
      callId: "c1",
      ok: true,
    },
    {
      type: "candidate_reported_completion",
      attemptId,
      summary: "done",
    },
  ];
}
