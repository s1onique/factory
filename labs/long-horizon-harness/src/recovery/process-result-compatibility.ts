/**
 * FOUNDATION03 — process result / close / trigger compatibility.
 *
 * Split out from process-recovery-projector.ts per CORRECTION03 §47.
 */

import type { PersistedProcessResult } from "../evidence/codec-types.js";

export function areCloseAndResultCompatible(
  r: PersistedProcessResult,
  closeCode: number | null,
  closeSignal: string | null,
): boolean {
  if (r.outcome_kind === "exited") {
    return closeCode === r.exit_code && closeSignal === null;
  }
  if (r.outcome_kind === "signaled") {
    return closeSignal === r.signal && closeCode === null;
  }
  return true;
}

export function deadlineCompatible(
  r: PersistedProcessResult,
  deadlineSeen: boolean,
): boolean {
  if (r.outcome_kind === "deadline") return deadlineSeen;
  return true;
}

export function cancelCompatible(
  r: PersistedProcessResult,
  cancelSeen: boolean,
): boolean {
  if (r.outcome_kind === "cancelled") return cancelSeen;
  return true;
}
