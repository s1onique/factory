/**
 * (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
 *  LIVENESS01)
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
 *   by `child.unref()` (the canonical Node seam)
 *   but the corresponding parent-side `Socket` /
 *   `Pipe` handles can survive as passive handles
 *   and pin the parent's event loop indefinitely.
 *
 *   On Node 26, the test runner keeps the test FILE
 *   alive while any of these passive handles remain.
 *   Without an explicit detach, `npm test` hangs
 *   forever after the test FILE finishes — even
 *   though every assertion has passed and every
 *   `after()` hook has run.
 *
 * The fix:
 *   Call `detachResidualHandles()` at the END of
 *   the test FILE's `after()` hook. It walks
 *   `process._getActiveHandles()`, finds any
 *   `Socket` and `Pipe` handles, and `unref()`s
 *   each one. This does NOT destroy the handles
 *   and does NOT affect test semantics — it only
 *   stops the Node event loop from waiting on
 *   them. The OS reclaims the FDs when the
 *   process exits.
 *
 * Law:
 *   This MUST be called only at the END of the
 *   test FILE's `after()` hook, AFTER every
 *   assertion has completed and AFTER every owned
 *   child has been torn down to the maximum
 *   extent possible on the host.
 *
 *   This function is idempotent and safe. It
 *   touches only `Socket` and `Pipe` handles.
 *   Node's two handle kinds for network / FD
 *   resources. It never touches `Timer`,
 *   `Microtask`, or any other framework internals.
 *
 *   The child process itself is NOT terminated by
 *   this function. Children that the kernel
 *   refused to kill remain alive in `ps` as
 *   test-host residue; the residue oracle (the
 *   `sweepAndProve()` / `proveChildAbsent()` machinery)
 *   is the authoritative observer of which children
 *   are still alive. This function is solely the
 *   liveness seam — it lets the test FILE process
 *   exit naturally so the runner can move on.
 *
 * Re-export:
 *   `_writer_teardown.ts` exports the same helper
 *   directly. This module re-exports it under a
 *   test-level path (`_liveness_helpers`) so test
 *   FILES outside the ledger-writer tree can adopt
 *   it without taking a dependency on writer-helper
 *   internals.
 */
export {
  detachResidualHandles,
} from "./ledger-writer/_writer_teardown.js";
