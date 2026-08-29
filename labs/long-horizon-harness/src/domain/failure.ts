/**
 * Typed failure taxonomy.
 *
 * Failure is a domain value, not a string. Variants preserve materially
 * different semantics through persistence and replay so that downstream
 * diagnostics, dashboards, and tests can distinguish them structurally.
 */

import type { BudgetKind } from "./budget.js";

export type Failure =
  | CandidateFailure
  | ToolFailure
  | GateFailure
  | PolicyDenied
  | Timeout
  | BudgetExhausted
  | InvalidEvidence
  | InvalidTransition
  | InternalFailure;

export type CandidateFailure = {
  readonly kind: "candidate_failure";
  /** Stable candidate-specific code; opaque to the lab. */
  readonly code: string;
  readonly message: string;
};

export type ToolFailure = {
  readonly kind: "tool_failure";
  readonly tool: string;
  readonly message: string;
};

export type GateFailure = {
  readonly kind: "gate_failure";
  readonly gate: string;
  readonly message: string;
};

export type PolicyDenied = {
  readonly kind: "policy_denied";
  readonly policy: string;
  readonly message: string;
};

export type Timeout = {
  readonly kind: "timeout";
  readonly subject: string;
  readonly message: string;
};

export type BudgetExhausted = {
  readonly kind: "budget_exhausted";
  readonly budget: BudgetKind;
  readonly limit: number;
  readonly observed: number;
  readonly message: string;
};

export type InvalidEvidence = {
  readonly kind: "invalid_evidence";
  readonly reason: string;
};

export type InvalidTransition = {
  readonly kind: "invalid_transition";
  readonly from: string;
  readonly event: string;
  readonly message: string;
};

export type InternalFailure = {
  readonly kind: "internal_failure";
  readonly message: string;
};

export type FailureKind = Failure["kind"];

export const FAILURE_KINDS: readonly FailureKind[] = [
  "candidate_failure",
  "tool_failure",
  "gate_failure",
  "policy_denied",
  "timeout",
  "budget_exhausted",
  "invalid_evidence",
  "invalid_transition",
  "internal_failure",
] as const;

export function isFailureKind(value: unknown): value is FailureKind {
  return (
    typeof value === "string" &&
    (FAILURE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Stable structural identity used by tests to verify that a failure variant
 * survives a decode/encode round-trip. We compare discriminants and payload
 * fields individually so that unrelated message phrasing does not break
 * equality.
 */
export function failureEquals(a: Failure, b: Failure): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  switch (a.kind) {
    case "candidate_failure":
      return (
        b.kind === "candidate_failure" &&
        a.code === b.code &&
        a.message === b.message
      );
    case "tool_failure":
      return b.kind === "tool_failure" && a.tool === b.tool && a.message === b.message;
    case "gate_failure":
      return b.kind === "gate_failure" && a.gate === b.gate && a.message === b.message;
    case "policy_denied":
      return (
        b.kind === "policy_denied" &&
        a.policy === b.policy &&
        a.message === b.message
      );
    case "timeout":
      return b.kind === "timeout" && a.subject === b.subject && a.message === b.message;
    case "budget_exhausted":
      return (
        b.kind === "budget_exhausted" &&
        a.budget === b.budget &&
        a.limit === b.limit &&
        a.observed === b.observed &&
        a.message === b.message
      );
    case "invalid_evidence":
      return b.kind === "invalid_evidence" && a.reason === b.reason;
    case "invalid_transition":
      return (
        b.kind === "invalid_transition" &&
        a.from === b.from &&
        a.event === b.event &&
        a.message === b.message
      );
    case "internal_failure":
      return b.kind === "internal_failure" && a.message === b.message;
  }
}
