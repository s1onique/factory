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
 * (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
 *  LIVENESS01-CORRECTION01-MICROFIX02)
 *
 * Typed outcome for parent-side detachment of a
 * ChildProcess. Distinct from `TerminateOutcome`:
 *
 *   - `TerminateOutcome` describes the KERNEL's
 *     response to a signal attempt (the child's
 *     lifecycle boundary).
 *
 *   - `ParentDetachOutcome` describes what the
 *     PARENT did to its OWN view of the child's
 *     handles (the parent's event-loop boundary).
 *
 * These two outcomes are orthogonal dimensions.
 * A `signal_permission_denied` teardown outcome
 * can coexist with a `completed` parent-detach
 * outcome — the parent has detached its view, the
 * kernel has not terminated the child.
 *
 * ─────────────────────────────────────────────────────
 * MICROFIX02 P1-2 — ORTHOGONAL EXIT VS DETACH
 *
 * The earlier MICROFIX01 type encoded lifecycle
 * (`already_exited`) and detach state
 * (`completed`) as MUTUALLY-EXCLUSIVE union
 * branches. That was structurally wrong on two
 * counts:
 *
 *   (a) FACT: Node explicitly distinguishes the
 *       `'exit'` event (process ended, stdio MAY
 *       still be open) from `'close'` (process
 *       ended AND stdio streams closed). When
 *       Node observed `exit` but stdio was still
 *       open, the previous code returned
 *       `already_exited` and DID NOT detach stdio.
 *       The parent's event loop was STILL PINNED
 *       by the child's open stdio FDs, even
 *       though the type said detachment was done.
 *
 *   (b) FACT: orthogonal facts should not be
 *       encoded as mutually-exclusive union
 *       branches. "Did Node observe exit?" and
 *       "Did the parent detach each reachable
 *       handle?" are independent observations and
 *       must both be carried.
 *
 * MICROFIX02 collapses the three MICROFIX01
 * variants into ONE shape with two orthogonal
 * fields:
 *
 *   childLifecycleAtDetach
 *     "running_or_unknown"  — `exitCode === null`
 *                            AND `signalCode === null`
 *                            at observation time.
 *     "already_exited"      — Node has observed the
 *                            `'exit'` event
 *                            (exitCode !== null OR
 *                            signalCode !== null).
 *                            Stdio streams MAY still
 *                            be open; the per-handle
 *                            evidence below carries
 *                            that fact independently.
 *
 *   detached
 *     PRECISE OBSERVED STATE per handle, regardless
 *     of lifecycle. We ALWAYS attempt destroy/unref
 *     on every reachable handle. A handle is recorded
 *     as `unrefed` ONLY if `unref()` returned without
 *     throwing; a handle is recorded as `destroyed`
 *     ONLY if `destroy()` was callable AND returned
 *     without throwing. If neither was possible
 *     (absent stream, e.g. `stdio: "ignore"`), the
 *     handle is recorded as `absent`. The parent's
 *     event loop is no longer pinned by handles that
 *     ended up in `unrefed` / `destroyed` /
 *     `destroyed_unrefed` / `unrefed_only` /
 *     `destroyed_only` state.
 *
 *   skipped
 *     true if the passed-in child reference was
 *     null / undefined / not actually a
 *     ChildProcess shape. When `skipped === true`
 *     the `detached` fields are all `absent`
 *     (nothing to detach). When `skipped === false`,
 *     the `detached` fields carry the per-handle
 *     observation made at detach time.
 *
 * Law:
 *   `ParentDetachOutcome` is a parent-liveness
 *   result. It NEVER licenses a `residue = gone`
 *   classification. The two diagnostics layers
 *   (this and `TerminateOutcome`) are reported
 *   together so the qualification oracle can
 *   correctly distinguish:
 *
 *     teardown = signal_permission_denied
 *     parent_detach = {detached: {stdout: destroyed_unrefed, ...}, ...}
 *     residue = alive
 *       => qualification = FAIL
 *
 *   from:
 *
 *     teardown = closed
 *     parent_detach = {childLifecycleAtDetach: "already_exited", detached: ...}
 *     residue = gone
 *       => qualification = PASS
 *
 *   The qualification classifier lives in
 *   `test/_liveness_qualify.ts` and is the
 *   SINGLE canonical join of
 *   (teardown, parent_detach, residue) →
 *   PASS/FAIL. LIV08 / LIV12 cross-check that
 *   helper.
 */
export type ParentDetachOperation =
  | "unrefed"
  | "destroyed_unrefed"
  | "destroyed_only"
  | "unrefed_only"
  | "absent"
  | "failed";

export type ParentDetachOutcome = {
  readonly childLifecycleAtDetach:
    | "running_or_unknown"
    | "already_exited";
  readonly skipped: boolean;
  readonly detached: {
    readonly ipc: "unrefed" | "unavailable" | "failed";
    readonly stdout: ParentDetachOperation;
    readonly stderr: ParentDetachOperation;
    readonly stdin: ParentDetachOperation;
  };
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
//  LIVENESS01-CORRECTION01)
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
// To detach (2) and (3) we must `destroy()` and
// `unref()` each of the child's stdio streams.
// Without this, even after `kill()` the parent's
// event loop stays alive because Node treats the
// open pipe FDs as "active handles" and the event
// loop only exits when no active handles remain.
//
// This is a TEST-FIXTURE CONTAINMENT primitive. It is
// NOT a documentation-level claim about how Node
// recommends spawning long-lived background
// processes.
//
// Narrow scope of the doctrine (CORRECTION01):
//
//   - Node publicly supports `ChildProcess.unref()`
//     and stream `destroy()` / `unref()` — those are
//     the documented Node APIs in use here.
//
//   - For LONG-LIVED INDEPENDENT PROCESSES, Node's
//     documented pattern is
//     `spawn({ detached: true, stdio: "ignore" })`
//     combined with `child.unref()` so the child
//     survives the parent cleanly.
//
//   - Our use here is NARROWER: it is test-fixture
//     containment AFTER teardown failure. The child
//     is a failed teardown, the parent has done its
//     best to terminate it, and the parent now needs
//     the permission to terminate itself while the
//     child remains alive in the kernel.
//
//   - This does NOT imply successful termination. A
//     `parent_detach = completed` outcome alongside
//     `teardown = signal_permission_denied` is the
//     exact shape that yields `residue = alive` and
//     STILL fails qualification. We never repurpose
//     this primitive as cleanup proof.
//
// Calling this on a non-closed outcome detaches all
// three FD views. The child process itself is NOT
// terminated — it remains alive in `ps` (visible as
// test-host residue) — but the parent test FILE no
// longer waits for it, so the runner can move on to
// the next test file.
//
// `detachUnreachableChild` is called ONLY for
// non-closed outcomes. For `closed`, the child has
// already ended and the IPC channel is gone — no need
// to unref. This preserves the WSTOP contract that
// `closed` is the ONLY path that licenses releasing
// the writer_child registry entry.
export function detachUnreachableChild(
  child: ChildProcess,
): ParentDetachOutcome {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01-MICROFIX02)
  //
  // MICROLIFECYCLE FIDELITY:
  //   `child.exitCode !== null || child.signalCode !== null`
  //   signals that Node has observed the `'exit'`
  //   event — i.e. the process has ENDED but stdio
  //   streams may still be open. Node documents
  //   `'close'` as the event fired AFTER stdio streams
  //   close. We MUST NOT claim `closed` from
  //   `exitCode` / `signalCode` alone.
  //
  // MICROFIX02 P1-2 — ORTHOGONAL EXIT VS DETACH:
  //   We record the lifecycle observation
  //   (`childLifecycleAtDetach`) and the per-handle
  //   detach evidence INDEPENDENTLY. Both are
  //   attempted regardless of whether Node has
  //   observed `exit`. If stdio is still open, the
  //   per-handle detach evidence will reflect that
  //   we tried to close the FDs anyway (and the
  //   parent loop is no longer pinned by what we
  //   successfully closed).
  const childLifecycleAtDetach: "running_or_unknown" | "already_exited" =
    (child.exitCode !== null || child.signalCode !== null)
      ? "already_exited"
      : "running_or_unknown";

  // (1) IPC channel — recorded as `unrefed` only if
  // `child.unref()` returned without throwing. The
  // previous CORRECTION01 code unconditionally added
  // `"ipc"` to the detached set even on throw — that
  // was evidence inflation (MICROFIX01 P1-2).
  let ipcState: "unrefed" | "unavailable" | "failed";
  const unrefFn = (child as { unref?: () => void }).unref;
  if (typeof unrefFn !== "function") {
    ipcState = "unavailable";
  } else {
    try {
      unrefFn.call(child);
      ipcState = "unrefed";
    } catch {
      ipcState = "failed";
    }
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
  //
  // MICROLIFECYCLE FIDELITY (MICROFIX01 P1-2 +
  // MICROFIX02 P1-2): each stdio stream is reported
  // with its PRECISE observed state. A stream that
  // is null/undefined (e.g. the child was spawned
  // with `stdio: "ignore"`) is `absent`. A stream
  // whose `destroy()` was callable and succeeded
  // but whose `unref()` is not callable (or threw)
  // is `destroyed_only`. Symmetric for `unrefed_only`.
  // Both succeeded → `destroyed_unrefed`. Both
  // unavailable → `absent` (we collapse because
  // the parent's loop is not pinned by it).
  //
  // CRITICAL: this detach attempt happens EVEN when
  // `childLifecycleAtDetach === "already_exited"`.
  // Node may have observed `exit` while stdio FDs
  // remain open. We attempt to close them anyway so
  // the parent's loop can stop waiting on them. The
  // per-handle state will honestly reflect what
  // happened (destroyed_unrefed, failed, etc.).
  const stdout = tryDestroyAndUnref(child.stdout);
  const stderr = tryDestroyAndUnref(child.stderr);
  const stdin = tryDestroyAndUnref(child.stdin);

  return {
    childLifecycleAtDetach,
    skipped: false,
    detached: {
      ipc: ipcState,
      stdout,
      stderr,
      stdin,
    },
  };
}

function tryDestroyAndUnref(
  s: NodeJS.ReadableStream | NodeJS.WritableStream | null | undefined,
): ParentDetachOperation {
  // (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
  //  LIVENESS01-CORRECTION01-MICROFIX01)
  //
  // Returns the PRECISE observed state of the
  // attempted parent-side detachment of one stream.
  // Six mutually-exclusive values:
  //
  //   absent
  //     The stream is null or undefined (e.g. a child
  //     spawned with `stdio: "ignore"`).
  //
  //   unrefed
  //     `unref()` was callable AND returned without
  //     throwing AND `destroy()` was not callable.
  //     We have decremented the libuv refcount; the
  //     parent's loop is no longer pinned by it.
  //
  //   destroyed_only
  //     `destroy()` was callable AND returned without
  //     throwing AND `unref()` was not callable.
  //     The FD is closed in the parent; the parent
  //     cannot wait on it.
  //
  //   destroyed_unrefed
  //     BOTH `destroy()` and `unref()` were callable
  //     AND both returned without throwing. Belt and
  //     suspenders; we report the strongest state.
  //
  //   unrefed_only
  //     `unref()` succeeded; `destroy()` is callable
  //     but threw. We have the refcount decrement
  //     but did not successfully close the FD.
  //
  //   failed
  //     BOTH operations failed (or only `destroy()`
  //     was available and it threw). The stream is
  //     likely still pinning the parent loop.
  if (s === null || s === undefined) return "absent";
  const destroyFn = (s as { destroy?: () => void }).destroy;
  const unrefFn = (s as { unref?: () => void }).unref;
  const hasDestroy = typeof destroyFn === "function";
  const hasUnref = typeof unrefFn === "function";
  let destroyOk = false;
  let unrefOk = false;
  let destroyThrew = false;
  let unrefThrew = false;
  if (hasDestroy) {
    try {
      destroyFn.call(s);
      destroyOk = true;
    } catch {
      destroyThrew = true;
    }
  }
  if (hasUnref) {
    try {
      unrefFn.call(s);
      unrefOk = true;
    } catch {
      unrefThrew = true;
    }
  }
  if (destroyOk && unrefOk) return "destroyed_unrefed";
  if (destroyOk && !hasUnref) return "destroyed_only";
  if (!hasDestroy && unrefOk) return "unrefed";
  if (destroyThrew && unrefOk) return "unrefed_only";
  // Neither succeeded — best case is "absent"
  // semantically (parent loop may or may not be
  // pinned, but we have no evidence of detachment).
  void unrefThrew;
  return "failed";
}

/**
 * (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
 *  LIVENESS01-CORRECTION01)
 *
 * Test FILE post-suite teardown, OWNERSHIP-SCOPED.
 * Walks ONLY the `ChildProcess` references passed in
 * by the caller (the test FILE's local registry) and
 * detaches each owned child's parent-side handles
 * from the parent's event loop.
 *
 * Why ownership-scoped:
 *
 *   `process._getActiveHandles()` is a Node-private
 *   API, undocumented for public use, and explicitly
 *   flagged by the Node maintainers as potentially
 *   removable in a future major release. It returns
 *   every active handle in the process regardless of
 *   who created it — including handles owned by
 *   other fixtures, by Node internals, or by future
 *   unrelated test code. Detaching handles by *type*
 *   (Socket / Pipe / ChildProcess) violates the
 *   ownership law:
 *
 *     "the component that acquires a live resource
 *      owns its lifecycle boundary"
 *
 *   A test FILE MUST only detach resources it
 *   created. We therefore enumerate the child
 *   references that the calling fixture already
 *   tracks in its own state, not the process-wide
 *   handle set.
 *
 * What this function touches, per child:
 *
 *   - `child` itself              — IPC channel
 *   - `child.stdout`              — parent-side read pipe
 *   - `child.stderr`              — parent-side read pipe
 *   - `child.stdin`               — parent-side write pipe
 *
 *   For each stream, we both `destroy()` the FD and
 *   `unref()` the libuv handle (idempotent and safe
 *   to ignore errors).
 *
 * What this function does NOT touch:
 *
 *   - UDS-client Socket handles created during
 *     `appendToLedgerWriter` / `pingLedgerWriter` /
 *     `whoAreYouLedgerWriter`. Those sockets are
 *     owned by the RPC transport layer and are
 *     `destroy()`ed on return; if they leave a
 *     residual passive handle, that is the
 *     transport layer's responsibility, not this
 *     file's. (In the current implementation the
 *     transport destroys them cleanly so no residual
 *     is observable.)
 *
 *   - Timer / Microtask / Immediate / Promise /
 *     framework-internal handles.
 *
 *   - Any ChildProcess NOT passed in by the caller.
 *     A test FILE MUST only detach its own children.
 *
 * What this function is NOT:
 *
 *   This is a PARENT-LIVENESS OPERATION. It does not
 *   prove cleanup. The child process itself is NOT
 *   terminated by this function — children that the
 *   kernel refused to kill (EPERM) remain alive in
 *   `ps` as test-host residue. The residue oracle
 *   (`sweepAndProve()` / `proveChildAbsent()`) is
 *   the SOLE authority on which children are still
 *   alive.
 *
 *   A `signal_permission_denied` outcome combined with
 *   a successful `detachOwnedChildren` call STILL
 *   yields `residue = alive` and STILL fails
 *   qualification. Detachment lets the *test FILE*
 *   terminate, NOT prove teardown.
 *
 * Law:
 *
 *   Call this at the END of the test FILE's `after()`
 *   hook, AFTER every assertion has completed, AFTER
 *   the residue oracle has run, and AFTER every owned
 *   child has been torn down to the maximum extent
 *   possible on the host. Pass the local registry's
 *   ChildProcess array as the sole argument.
 */
export function detachOwnedChildren(
  children: ReadonlyArray<ChildProcess>,
): ParentDetachOutcome[] {
  const outcomes: ParentDetachOutcome[] = [];
  for (const child of children) {
    if (child === null || child === undefined) {
      outcomes.push({
        childLifecycleAtDetach: "running_or_unknown",
        skipped: true,
        detached: {
          ipc: "unavailable",
          stdout: "absent",
          stderr: "absent",
          stdin: "absent",
        },
      });
      continue;
    }
    outcomes.push(detachUnreachableChild(child));
  }
  return outcomes;
}

/**
 * (FOUNDATION04 PHASE A — LONG-HORIZON-LAB-FULL-SUITE-
 *  LIVENESS01-CORRECTION01-MICROFIX01)
 *
 * The earlier CORRECTION01 retained a
 * `_diagnostic_sweepAllHandles()` function as an
 * "escape hatch" that walked `process._getActiveHandles()`
 * and unref'd Socket / Pipe / ChildProcess handles
 * globally. MICROFIX01 removes that escape hatch:
 *
 *   - No test FILE actually CALLS the helper.
 *     It existed as a passive witness that nothing
 *     in `_writer_teardown.ts` itself was doing
 *     type-based global sweeping.
 *
 *   - Its presence created a LIV10 ambiguity: the
 *     static guard had to allow `_writer_teardown.ts`
 *     as a whole, but the helper was never pinned to
 *     a specific function body, so a future
 *     accidental addition in this file (e.g. another
 *     `_getActiveHandles` reference outside the
 *     helper) would pass LIV10 silently.
 *
 *   - LIV10 now statically forbids EVERY reference to
 *     `_getActiveHandles` anywhere under `test/` or
 *     `src/`. There is no escape hatch, no diagnostic
 *     helper, no allowance.
 *
 *   - If a future need arises for a global handle
 *     sweep, it MUST be added to this file with a
 *     typed ADT of allowed-handle kinds AND its
 *     `_getActiveHandles` reference MUST be scoped
 *     to a named function body whose name the LIV10
 *     static guard explicitly whitelists. Until
 *     then: no global sweeping.
 */
