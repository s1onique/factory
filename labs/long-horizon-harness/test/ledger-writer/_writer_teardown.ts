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
