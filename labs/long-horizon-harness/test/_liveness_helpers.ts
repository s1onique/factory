/**
 * (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
 *  LIVENESS01-CORRECTION01)
 *
 * Shared helpers for test FILE process liveness.
 *
 * The bug class:
 *   On a sandboxed host, several test FILES spawn
 *   child processes (writers, witnesses, helper
 *   listeners) whose stdio is `"pipe"`. The host
 *   kernel refuses to deliver SIGKILL with EPERM,
 *   so the children remain alive after the test
 *   body completes. Their IPC channel is detached
 *   by `child.unref()` but the corresponding
 *   parent-side `Pipe` handles can survive as
 *   passive handles and pin the parent's event
 *   loop indefinitely.
 *
 *   On Node 26, the test runner keeps the test FILE
 *   alive while any of these passive handles remain.
 *   Without an explicit detach, `npm test` hangs
 *   forever after the test FILE finishes — even
 *   though every assertion has passed and every
 *   `after()` hook has run.
 *
 * The fix:
 *   Call `detachOwnedChildren(children)` at the END
 *   of the test FILE's `after()` hook, passing in
 *   the local registry's ChildProcess array. The
 *   helper walks each owned child and detaches its
 *   IPC channel + stdio FDs. This does NOT destroy
 *   the children and does NOT affect test semantics
 *   — it only stops the Node event loop from waiting
 *   on those specific children. The OS reclaims the
 *   FDs when the process exits.
 *
 *   The return value is a `ParentDetachOutcome[]`
 *   — one outcome per passed-in child. A non-closed
 *   teardown outcome paired with a
 *   `parent_detach = completed` outcome yields the
 *   exact `residue = alive` shape that STILL fails
 *   qualification (per LIV08). The two diagnostic
 *   dimensions are orthogonal: parent-liveness is
 *   NOT cleanup proof.
 *
 * Why ownership-scoped (CORRECTION01):
 *   Earlier versions of this helper walked
 *   `process._getActiveHandles()` and detached any
 *   handle of type Socket/Pipe/ChildProcess. That
 *   violated the ownership law: "the component that
 *   acquires a live resource owns its lifecycle
 *   boundary". Detaching handles by *type* means
 *   detaching handles owned by other fixtures, by
 *   the test runner internals, or by future
 *   unrelated code. The corrected helper takes the
 *   caller-owned child references and detaches only
 *   those.
 *
 * Law:
 *   This MUST be called only at the END of the
 *   test FILE's `after()` hook, AFTER every
 *   assertion has completed and AFTER every owned
 *   child has been torn down to the maximum extent
 *   possible on the host.
 *
 *   The child processes themselves are NOT
 *   terminated by this function. Children that the
 *   kernel refused to kill remain alive in `ps` as
 *   test-host residue; the residue oracle (the
 *   `sweepAndProve()` / `proveChildAbsent()` machinery)
 *   is the authoritative observer of which children
 *   are still alive. This function is solely the
 *   PARENT-LIVENESS seam — it lets the test FILE
 *   process exit naturally so the runner can move
 *   on. It is NEVER cleanup proof.
 *
 * Re-export:
 *   `_writer_teardown.ts` exports the helper
 *   directly. This module re-exports it under a
 *   test-level path (`_liveness_helpers`) so test
 *   FILES outside the ledger-writer tree can adopt
 *   it without taking a dependency on writer-helper
 *   internals.
 */
export {
  detachOwnedChildren,
} from "./ledger-writer/_writer_teardown.js";
export type {
  ChildProcess,
} from "node:child_process";
export type {
  ParentDetachOutcome,
  ParentDetachOperation,
} from "./ledger-writer/_writer_teardown.js";
