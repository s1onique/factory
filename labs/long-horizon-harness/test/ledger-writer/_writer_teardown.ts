/**
 * (FOUNDATION04 PHASE A — WRITER-HELPER-TEARDOWN-
 *  OUTCOME01-CORRECTION01)
 *
 * Neutral ownership of the writer teardown primitive.
 * Per CORRECTION01 dependency-direction review: this
 * module exists BELOW both `_writer_helper.ts` and
 * `_wstart_live_helpers.ts` in the fixture layering.
 * `_live_cases.ts` (the case-catalogue layer) MUST
 * NOT depend on this module directly — the live
 * cases go through `_writer_helper.ts:WriterHandle`,
 * which itself delegates here. This breaks the
 * previous orchestration→primitive inversion.
 *
 * Module surface (deliberately narrow):
 *
 *   - TerminateOutcome           : the ADT
 *   - terminateHelperAndAwaitTyped : the primitive
 *
 * No side-effecting imports. No live-case catalogue
 * coupling. The dependency guard in
 * `_wstop_writer_teardown_adversarial.test.ts`
 * (WSTOP09) statically forbids `_writer_helper.ts`
 * and `_wstart_live_helpers.ts` from importing
 * `_live_cases.ts`; both are permitted (and
 * required) to import THIS module.
 */
import type { ChildProcess } from "node:child_process";

/**
 * Typed outcome for writer-helper teardown. Four
 * mutually-exclusive variants, each with a precise
 * lifecycle proof semantics:
 *
 *   closed
 *     Node's `'close'` event was actually observed
 *     (process ended AND stdio streams closed).
 *     This is the ONLY variant that licenses
 *     releasing the writer_child registry entry.
 *
 *   signal_permission_denied
 *     The kernel refused to deliver SIGKILL with
 *     errno EPERM (synchronous throw from
 *     `process.kill()` or asynchronous `'error'`
 *     event with code "EPERM"). The child is
 *     still alive in the kernel; the writer_child
 *     entry MUST be retained. Per Node's documented
 *     ChildProcess contract, `'close'` will NOT fire
 *     unless and until the process actually ends —
 *     a refused signal cannot manufacture termination,
 *     so we do NOT wait for close on this path. The
 *     residue record carries this errno verbatim.
 *
 *   signal_failed
 *     `kill()` returned false OR threw an errno
 *     other than EPERM (e.g. ESRCH — the child has
 *     already exited so there's nothing to signal).
 *     The writer_child entry MUST be retained.
 *
 *   close_timeout
 *     The kill was accepted by the OS but `'close'`
 *     was not observed within the bounded deadline.
 *     Per Node semantics this means the child has
 *     NOT terminated (or has not yet had its stdio
 *     streams closed). The writer_child entry MUST
 *     be retained.
 *
 * CRITICAL — orthogonal to the residue state:
 *   The above four outcomes describe HOW the
 *   termination request went. The ORACLE then
 *   separately observes WHETHER the original child
 *   has terminated (via `proveChildAbsent`). On a
 *   sandboxed host `signal_permission_denied` and
 *   `close_timeout` will both coexist with the
 *   oracle's `alive` residue state — the teardown
 *   outcome and the residue observation are
 *   separate dimensions, NOT mutually-exclusive
 *   classifications. See WSTOP08.
 */
export type TerminateOutcome =
  | {
      readonly kind: "closed";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | {
      readonly kind: "signal_permission_denied";
      readonly errno: "EPERM";
    }
  | {
      readonly kind: "signal_failed";
      readonly errno?: string;
    }
  | {
      readonly kind: "close_timeout";
    };

/**
 * (FOUNDATION04 PHASE A — WRITER-HELPER-TEARDOWN-
 *  OUTCOME01-CORRECTION01)
 *
 * Typed teardown primitive for an owned writer
 * child. Resolves (never rejects) with a
 * `TerminateOutcome` so the caller can record
 * machine-readable diagnostics without resorting
 * to a swallow-all try/catch around `stop()`.
 *
 * Atomicity discipline (CORRECTION09):
 *   `'close'` and `'error'` listeners are attached
 *   BEFORE `kill()` so a synchronous emit during
 *   the kill cannot be lost.
 *
 * Why we never reject:
 *   Process-control outcomes (kernel refused to
 *   deliver the signal, kill returned false, the
 *   close-boundary timed out) are NOT exceptions
 *   from the perspective of a fixture that OWNS the
 *   child lifecycle — they are normal results that
 *   the fixture must record. Rejecting on these
 *   paths would force callers to wrap with
 *   a swallow-all try/catch around `stop()`,
 *   which is exactly the false-green path
 *   WSTOP06 closes.
 *
 * Why we DO re-throw on internal faults:
 *   Unknown / unexpected listener-internal throws
 *   that are NOT the documented Node EPERM/ESRCH
 *   errno shape are NOT process-control outcomes —
 *   they are harness programming faults. Those
 *   re-throw so the test fails loudly and visibly,
 *   not silently absorbed as a typed residue.
 */
export async function terminateHelperAndAwaitTyped(
  child: ChildProcess,
  timeoutMs = 2000,
): Promise<TerminateOutcome> {
  return new Promise<TerminateOutcome>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let killResult:
      | { readonly kind: "threw"; readonly err: NodeJS.ErrnoException }
      | { readonly kind: "returned_false" }
      | { readonly kind: "accepted" }
      | undefined;

    function settle(outcome: TerminateOutcome): void {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      child.off("close", onClose);
      child.off("error", onError);
      resolve(outcome);
    }

    const onClose = (
      code: number | null,
      signal: NodeJS.Signals | null,
    ): void => {
      if (settled) return;
      settle({ kind: "closed", code, signal });
    };

    const onError = (err: Error): void => {
      if (settled) return;
      // Re-throw internal programming faults
      // (CORRECTION01 — don't make signal_failed
      // an exception sink). Only NodeJS.ErrnoException
      // with a recognised errno code is treated as
      // a process-control outcome.
      const errno = (err as NodeJS.ErrnoException).code;
      if (typeof errno !== "string") {
        // Not an errno-classified error — likely a
        // harness-side listener fault. Re-throw.
        settled = true;
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
        child.off("close", onClose);
        child.off("error", onError);
        reject(err);
        return;
      }
      if (errno === "EPERM") {
        settle({
          kind: "signal_permission_denied",
          errno: "EPERM",
        });
        return;
      }
      settle({
        kind: "signal_failed",
        errno,
      });
    };

    // (1) Arm listeners BEFORE kill so a synchronous
    // close/error during kill cannot be lost.
    child.once("close", onClose);
    child.once("error", onError);

    // (2) Bounded deadline.
    timeoutHandle = setTimeout(() => {
      settle({ kind: "close_timeout" });
    }, timeoutMs);

    // (3) Issue the kill.
    try {
      const r = child.kill("SIGKILL");
      if (r === false) {
        killResult = { kind: "returned_false" };
        settle({ kind: "signal_failed" });
      } else {
        killResult = { kind: "accepted" };
        // listeners will eventually settle via
        // onClose / onError / deadline.
      }
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      killResult = { kind: "threw", err };
      if (err && err.code === "EPERM") {
        settle({
          kind: "signal_permission_denied",
          errno: "EPERM",
        });
      } else if (err && typeof err.code === "string") {
        settle({
          kind: "signal_failed",
          errno: err.code,
        });
      } else if (err && err.code === undefined) {
        settled = true;
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
        child.off("close", onClose);
        child.off("error", onError);
        reject(err);
        return;
      } else {
        settle({ kind: "signal_failed" });
      }
    }

    void killResult; // captured for diagnostics
  });
}

// (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
//  LIVENESS01)
//
// When `terminateHelperAndAwaitTyped` settles with a
// non-`closed` outcome, the kernel did not deliver
// `'close'` — the child remains alive in the kernel.
// On a sandboxed host (EPERM-on-kill), this is the
// expected outcome for the writer-helper teardown
// primitive.
//
// Per the lifecycle ownership law
// ("the component that acquires a live resource owns
// the obligation to observe and complete its lifecycle
// boundary"), the parent test FILE that spawned the
// writer is responsible for the child. But the test
// FILE's process lifecycle is separate from the
// child process's lifecycle — once the test FILE has
// finished running assertions, it MUST be able to
// exit cleanly.
//
// Three file descriptors may keep the parent's event
// loop alive:
//
//   1. The child's IPC channel (if Node's child
//      process was spawned with `stdio` mode that
//      establishes one).
//   2. The child's stdout pipe.
//   3. The child's stderr pipe.
//
// `child.unref()` detaches the IPC channel (1).
// To detach (2) and (3) we must `unref()` each of
// the child's stdio streams. Without this, even
// after `kill()` the parent's event loop stays alive
// because Node treats the open pipe FDs as
// "active handles" and the event loop only exits
// when no active handles remain.
//
// Calling this on a non-closed outcome detaches all
// three. The child process itself is NOT terminated —
// it remains alive in `ps` (visible as test-host
// residue) — but the parent test FILE no longer waits
// for it, so the runner can move on to the next test
// file. This is the canonical Node.js seam for
// "this child exists but the parent does not own its
// lifecycle on behalf of the child".
//
// `detachUnreachableChild` is called ONLY for
// non-closed outcomes. For `closed`, the child has
// already ended and the IPC channel is gone — no need
// to unref. This preserves the WSTOP contract that
// `closed` is the ONLY path that licenses releasing
// the writer_child registry entry.
export function detachUnreachableChild(child: ChildProcess): void {
  // (1) IPC channel.
  try {
    child.unref();
  } catch {
    // child may already be exited / disconnected;
    // unref() is idempotent and safe to ignore.
  }
  // (2,3) stdio pipes — drain AND destroy. On a
  // sandboxed host where the kernel refuses to kill
  // the writer child, the child remains alive in `ps`
  // but the test FILE has nothing more to read from /
  // write to it. We close the parent's view of the
  // stdio pipes so the parent's event loop is no
  // longer pinned. The child itself is unaffected
  // (it does not own these FDs — the parent does).
  //
  // We BOTH `destroy()` (close the FD in the parent)
  // and `unref()` (decrement the libuv refcount in
  // case the FD handle survives `destroy()`).
  tryDestroyAndUnref(child.stdout);
  tryDestroyAndUnref(child.stderr);
  tryDestroyAndUnref(child.stdin);
}

function tryDestroyAndUnref(
  s: NodeJS.ReadableStream | NodeJS.WritableStream | null | undefined,
): void {
  try {
    (s as { destroy?: () => void } | null)?.destroy?.();
  } catch {
    // ignore — stream may already be closed
  }
  try {
    (s as { unref?: () => void } | null)?.unref?.();
  } catch {
    // ignore
  }
}

/**
 * (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
 *  LIVENESS01)
 *
 * Test FILE post-suite teardown. Iterates the
 * active Node handles and `unref()`s any `Socket`
 * and `Pipe` handles that survived the test run.
 *
 * Why this is needed:
 *
 *   On a sandboxed host, several test FILES spawn
 *   writer children (via `startLedgerWriter`) whose
 *   stdio is `"pipe"`. After `terminateHelperAndAwaitTyped`
 *   resolves with a non-`closed` outcome and
 *   `detachUnreachableChild` is called, the per-child
 *   `child.stdout` / `child.stderr` stream handles
 *   are detached from the parent's event loop, but
 *   the corresponding parent-side handles (the
 *   `Pipe` objects backing those streams in the
 *   parent process) sometimes remain as passive
 *   `Pipe` handles. Likewise, UDS-client `Socket`
 *   handles created during `appendToLedgerWriter` /
 *   `pingLedgerWriter` / `whoAreYouLedgerWriter`
 *   remain after the socket's `destroy()` resolves.
 *   Node's test runner keeps the test FILE alive
 *   while these handles are present, even after all
 *   tests + the `after()` hook have completed.
 *
 *   Calling `unref()` on each residual Socket/Pipe
 *   handle detaches it from the parent's event loop
 *   without destroying the underlying resource.
 *   The handle remains in `process._getActiveHandles()`
 *   but does NOT keep the loop alive. This is the
 *   canonical Node.js seam for "I am finished with
 *   this resource; do not wait for me to clean it up".
 *
 * Law:
 *
 *   This MUST be called only when the test FILE is
 *   ready to exit. It does NOT destroy or close the
 *   handles — the OS reclaims them when the process
 *   exits. It only stops the Node event loop from
 *   waiting for them.
 *
 *   It touches only `Socket` and `Pipe` handles.
 *   Node's two handle kinds for network / FD
 *   resources. It never touches `Timer`,
 *   `Microtask`, or any other framework internals.
 *   The unref is idempotent and safe.
 *
 *   It MUST NOT be called for sockets/pipes that
 *   the test logic is still actively using. The
 *   correct call site is the END of the test FILE's
 *   `after()` hook — after all assertions have
 *   completed, after the residue oracle has run,
 *   and after all owned children have been torn
 *   down to the maximum extent possible on the
 *   host (which on a sandboxed kernel may be only
 *   `unref()`, never `kill()`).
 */
export function detachResidualHandles(): void {
  const handles = (process as unknown as {
    _getActiveHandles?: () => ReadonlyArray<unknown>;
  })._getActiveHandles?.();
  if (!handles) return;
  for (const h of handles) {
    const ctor = (h as { constructor?: { name?: string } })?.constructor?.name;
    // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-
    //  SUITE-LIVENESS01)
    //
    // The list of handle kinds we detach:
    //
    //   Socket     — UDS-client sockets created during
    //                ledger-writer RPC calls (ping / append /
    //                whoAreYou). After `socket.destroy()` the
    //                underlying FD may keep a passive handle
    //                on the test FILE's event loop.
    //
    //   Pipe       — stdio pipes of orphaned writer children
    //                whose IPC channel was already detached
    //                by `child.unref()` in
    //                `detachUnreachableChild()`.
    //
    //   ChildProcess — writer children that the kernel
    //                  refused to kill (EPERM). Their IPC
    //                  channel has already been detached by
    //                  `detachUnreachableChild()` — but the
    //                  ChildProcess handle itself can remain
    //                  as a passive handle. Unref'ing it
    //                  detaches the LAST residual that keeps
    //                  the test FILE alive.
    //
    // We deliberately do NOT detach Timer / Microtask /
    // Immediate handles — those are framework internals.
    if (ctor === "Socket" || ctor === "Pipe" || ctor === "ChildProcess") {
      try {
        (h as { unref?: () => void }).unref?.();
      } catch {
        // ignore — the handle may already be closed
      }
    }
  }
}
