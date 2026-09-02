/**
 * Load-admission pacing adapter for SEQ05.
 *
 * The observation stream alone cannot establish rescue.
 * A caller may derive a rescued call only from:
 *   probe_refused > 0
 *   ∧ canonical_invoked > 0
 *   ∧ final canonical result.ok === true
 *
 * Because the adapter does not observe its own returned
 * result as a telemetry event, rescue is necessarily
 * derived by the caller from observations + returned
 * result. AP11 drives this explicitly: it shows that an
 * observation stream of [probe_attempted, probe_refused,
 * probe_attempted, canonical_invoked] is by itself
 * indistinguishable from a successful rescue — only
 * joining the stream with `finalResult.ok` distinguishes
 * rescued from canonical_failed_after_pacing. This is
 * a TOCTOU consequence: the probe socket is destroyed
 * before the canonical connection is opened, so the
 * probe does not reserve admission for the canonical
 * socket.
 *
 * Call-level derived algebra (the only definition):
 *   pacing_rescued_calls =
 *     probe_refused > 0
 *     ∧ canonical_invoked > 0
 *     ∧ final canonical result.ok === true
 *
 *   canonical_failed_after_pacing_calls =
 *     probe_refused > 0
 *     ∧ canonical_invoked > 0
 *     ∧ final canonical result.ok !== true
 *
 *   pacing_exhausted_calls =
 *     probe_budget_exhausted > 0
 *
 *   pacing_non_recoverable_calls =
 *     probe_nonrecoverable > 0
 *
 * Doctrine:
 *
 *   load-admission pacing law
 *     A stress oracle may pace access to a bounded
 *     transport resource before invoking the canonical
 *     operation, provided pacing does not change semantic
 *     operation identity or replace/retry the canonical
 *     transport operation.
 *
 * Concrete flow:
 *
 *   1. lstat the socket (catches socket_missing and
 *      socket_wrong_type immediately — no pacing).
 *   2. Probe net.connect() up to MAX_PACING_ATTEMPTS
 *      times with a constant CONNECT_PACING_INTERVAL_MS
 *      delay. Only ECONNREFUSED is a pacing-recoverable
 *      outcome; all other errors are surfaced verbatim.
 *      Including speculative codes (e.g. ECONNRESET, EPIPE,
 *      EAGAIN) would risk masking real lifecycle defects;
 *      the empirical SEQ05 evidence names only
 *      ECONNREFUSED.
 *   3. On probe success, destroy the probe socket and
 *      invoke the FROZEN canonical appendToLedgerWriter
 *      EXACTLY ONCE. The canonical client decides its
 *      own retries for writer_busy. The adapter never
 *      retransmits appends itself; retransmission of the
 *      canonical operation is the frozen client's job,
 *      not ours.
 *
 * What this adapter is NOT:
 *   - It is NOT a transport-retry wrapper. Retrying the
 *     canonical operation would require either modifying
 *     the frozen B0 transport (forbidden by the freeze
 *     guard) or duplicating its protocol (a costly,
 *     drift-prone re-implementation).
 *   - It is NOT a backoff jitter. Factory's deterministic
 *     laboratory harness does not require
 *     de-synchronization.
 *   - It does NOT encode diagnostic classification in
 *     Error.message prose. Every diagnostic event is
 *     exposed as a typed `AdmissionPacingObservation`
 *     via the optional `onObservation` seam. SEQ05
 *     consumes typed events only; the returned
 *     Error.message is for humans.
 *   - It does NOT emit a `pacing_rescued` event. Rescue
 *     is a call-level derived fact from observations +
 *     returned canonical result.ok (see top of this
 *     header).
 *
 * Lives under `test/ledger-writer/`. Does NOT modify any
 * frozen B0 module. The B0 freeze SHA 1048c5c remains the
 * authoritative reference for `src/ledger-writer/**`.
 */

import { connect, type Socket } from "node:net";
import { promises as fs } from "node:fs";

import {
  type LedgerWriterClientOptions,
  type LedgerWriterAppendResult,
  appendToLedgerWriter,
} from "../../src/ledger-writer/ledger-writer-client.js";
import type { WriterEvent } from "../../src/ledger-writer/ledger-writer-protocol.js";

export const MAX_PACING_ATTEMPTS = 32;
export const CONNECT_PACING_INTERVAL_MS = 5;

/**
 * Typed observation events emitted by the admission-pacing
 * adapter.
 *
 * Used by SEQ05 (and any other future harness that wants
 * typed diagnostic telemetry) to construct histograms
 * WITHOUT parsing Error.message prose. The error returned
 * from the adapter is for human consumption; the typed
 * observation stream is for machine consumption.
 *
 * The observation stream alone is NOT sufficient to
 * identify a rescued call. See the top-of-file header
 * for the only valid rescue definition, which also
 * requires the FINAL canonical result.ok. AP11
 * demonstrates the necessity of this external join.
 *
 * Discriminated union by `kind`:
 *   - "probe_attempted": one UDS connect probe issued.
 *     `attempt` is the zero-based attempt index.
 *   - "probe_refused": a probe hit a pacing-recoverable
 *     errno (currently only ECONNREFUSED); the event
 *     describes a kernel outcome (the connect(2) was
 *     refused), NOT a logical rescue. The adapter's
 *     subsequent behaviour depends on the remaining
 *     budget:
 *        * if attempts remain, the adapter sleeps and
 *          retries;
 *        * if this is the final attempt, the adapter does
 *          NOT sleep; it falls through to
 *          `probe_budget_exhausted` instead.
 *     Whether the surrounding adapter invocation
 *     eventually reaches `canonical_invoked` is a
 *     separate observation. `code` is the typed errno.
 *   - "probe_budget_exhausted": the pacing budget was
 *     drained; the adapter is returning
 *     `connect_failed` without invoking the canonical
 *     client.
 *   - "probe_nonrecoverable": a probe hit an errno that is
 *     NOT in PACING_RECOVERABLE_ERRNOS. `code` is the typed
 *     errno (may be undefined for non-errno errors like
 *     ETIMEOUT_PROBE).
 *   - "canonical_invoked": the canonical appendToLedgerWriter
 *     is being invoked. Exactly one such event per
 *     adapter invocation that reaches the canonical client.
 *
 * Differential between probe-level and call-level
 * (algebra is defined in the top-of-file header; the
 * ADT itself does not carry enough information to prove
 * rescue):
 *   probe-level: counts of `probe_refused`,
 *                `probe_nonrecoverable`,
 *                `probe_budget_exhausted`,
 *                `probe_attempted`,
 *                `canonical_invoked`.
 *   call-level:  derived per adapter invocation by the
 *                caller from observations + the final
 *                canonical result.ok. The adapter does
 *                NOT emit a `pacing_rescued` event.
 *   `probe_refused` is named for what actually happened
 *   to the probe (kernel refused the connect(2)). The
 *   earlier `probe_recovered` name overclaimed — the
 *   last probe before `probe_budget_exhausted` was
 *   refused but did NOT recover anything.
 *
 * The adapter never re-transmits a "canonical_invoked"
 * event: if the canonical client returns connect_failed
 * (AP03 oracle), that is surfaced verbatim via the
 * returned LedgerWriterAppendResult, NOT via observation.
 */
export type AdmissionPacingObservation =
  | { readonly kind: "probe_attempted"; readonly attempt: number }
  | {
      readonly kind: "probe_refused";
      readonly attempt: number;
      readonly code: "ECONNREFUSED";
    }
  | { readonly kind: "probe_budget_exhausted"; readonly attempts: number }
  | {
      readonly kind: "probe_nonrecoverable";
      readonly attempt: number;
      readonly code: string | undefined;
    }
  | { readonly kind: "canonical_invoked" };

/**
 * The pacing-recoverable set of Node.js system error codes
 * for the load-admission probe. Deliberately narrow:
 *
 *   ECONNREFUSED — kernel rejected the connect(2). This is
 * the ONLY code we have empirical SEQ05 evidence for. We
 * deliberately exclude:
 *   ECONNRESET — semantically distinct: peer forcibly
 *                closed an ESTABLISHED connection, not a
 *                refusal of a connect(2) attempt
 *   EPIPE      — write-side, not admission-side
 *   EAGAIN     — speculative; we have no empirical evidence
 *
 * A wider set would risk the adapter masking a real
 * lifecycle defect behind a pacing retry. The set is
 * narrowed to match the empirical evidence; only
 * ECONNREFUSED has been observed under SEQ05.
 */
export const PACING_RECOVERABLE_ERRNOS: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
]);

/**
 * Default sleep implementation. Tests inject a sleepFn that
 * records the delay sequence; production code uses this
 * default which delegates to setTimeout.
 */
export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((res) => setTimeout(res, ms));

/**
 * Probe a single UDS connect attempt. The probe socket is
 * destroyed before resolving so we do not hold a kernel
 * backlog slot across the actual frozen-client call.
 */
function probeConnect(
  socketPath: string,
): Promise<
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string | undefined; readonly message: string }
> {
  return new Promise((resolve) => {
    let settled = false;
    const sock: Socket = connect(socketPath);
    const finalize = (
      r:
        | { readonly ok: true }
        | { readonly ok: false; readonly code: string | undefined; readonly message: string },
    ): void => {
      if (settled) return;
      settled = true;
      try {
        sock.destroy();
      } catch {
        // best-effort cleanup
      }
      resolve(r);
    };
    const t = setTimeout(() => {
      finalize({ ok: false, code: "ETIMEOUT_PROBE", message: "probe timed out" });
    }, 1500);
    sock.once("connect", () => {
      clearTimeout(t);
      finalize({ ok: true });
    });
    sock.once("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(t);
      finalize({ ok: false, code: e.code, message: e.message });
    });
  });
}

/**
 * Type of the (optional) injectable append function. When
 * omitted, the frozen `appendToLedgerWriter` is used. The
 * injection seam exists so adversarial tests can pin the
 * adapter's pacing behavior WITHOUT requiring a live
 * writer child or a real UDS server.
 */
export type AppendFn = (
  opts: LedgerWriterClientOptions,
  args: {
    readonly commitId: string;
    readonly clientContentHash: string;
    readonly event: WriterEvent;
  },
) => Promise<LedgerWriterAppendResult>;

export type SleepFn = (ms: number) => Promise<void>;

const defaultAppendFn: AppendFn = appendToLedgerWriter;

/**
 * Load-admission pacing wrapper for the frozen B0 client.
 *
 * The single normative doctrine (result-bound rescue
 * algebra, TOCTOU caveat, telemetry contract, etc.) lives
 * in the top-of-file header of this module. Other comments
 * MUST NOT restate the algebra — refer back to the header.
 *
 * Implementation contract:
 *   - pacing classification uses Error.code only,
 *     never Error.message
 *   - pacing does NOT change the args object: the
 *     frozen client sees the same commitId,
 *     clientContentHash, event on its single canonical
 *     invocation
 *   - pacing delay is constant
 *     (CONNECT_PACING_INTERVAL_MS) and DETERMINISTIC
 *     (no Math.random, no jitter)
 *   - non-pacing-recoverable outcomes surfaced verbatim
 *     on the first probe
 *   - on probe success, the canonical operation is
 *     invoked EXACTLY ONCE — the adapter never
 *     retransmits
 *   - typed diagnostic telemetry is exposed via the
 *     optional `onObservation` callback as a stream of
 *     `AdmissionPacingObservation` events. The returned
 *     error's `message` is for humans only; test
 *     harnesses MUST use the observation stream, not
 *     prose parsing.
 *
 * The injectable parameters (`appendFn`, `probeFn`,
 * `sleepFn`, `onObservation`) are for adversarial tests
 * and the SEQ05 harness only. Production code MUST NOT
 * pass them.
 */
export async function appendToLedgerWriterWithAdmissionPacing(
  opts: LedgerWriterClientOptions,
  args: {
    readonly commitId: string;
    readonly clientContentHash: string;
    readonly event: WriterEvent;
  },
  injected?: {
    readonly appendFn?: AppendFn;
    readonly probeFn?: (path: string) => ReturnType<typeof probeConnect>;
    readonly sleepFn?: SleepFn;
    readonly onObservation?: (event: AdmissionPacingObservation) => void;
  },
): Promise<LedgerWriterAppendResult> {
  const appendFn = injected?.appendFn ?? defaultAppendFn;
  const probeFn = injected?.probeFn ?? probeConnect;
  const sleepFn = injected?.sleepFn ?? defaultSleep;
  const onObservation = injected?.onObservation;
  const emit = (e: AdmissionPacingObservation): void => {
    if (onObservation) onObservation(e);
  };
  try {
    const st = await fs.lstat(opts.socketPath);
    if (st.isSymbolicLink() || !st.isSocket()) {
      return {
        ok: false,
        error: {
          kind: "socket_wrong_type",
          socketPath: opts.socketPath,
        },
      };
    }
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        error: {
          kind: "socket_missing",
          socketPath: opts.socketPath,
        },
      };
    }
    return {
      ok: false,
      error: {
        kind: "connect_failed",
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }

  for (let attempt = 0; attempt < MAX_PACING_ATTEMPTS; attempt++) {
    emit({ kind: "probe_attempted", attempt });
    const probe = await probeFn(opts.socketPath);
    if (probe.ok) {
      // Probe connection succeeded. This observation
      // reserves nothing for the canonical connection
      // (TOCTOU: the probe socket is destroyed before the
      // canonical RPC opens a NEW socket). Destroy the
      // probe and hand off to the FROZEN canonical client
      // for exactly ONE invocation. No retransmission from
      // us. Emit canonical_invoked BEFORE invoking so the
      // event stream records the intent regardless of the
      // frozen client's eventual return value.
      emit({ kind: "canonical_invoked" });
      return await appendFn(opts, args);
    }
    if (probe.code === undefined || !PACING_RECOVERABLE_ERRNOS.has(probe.code)) {
      emit({
        kind: "probe_nonrecoverable",
        attempt,
        code: probe.code,
      });
      return {
        ok: false,
        error: {
          kind: "connect_failed",
          message:
            probe.code !== undefined
              ? `probe: ${probe.code}`
              : `probe: ${probe.message}`,
        },
      };
    }
    // Pacing-recoverable: probe hit ECONNREFUSED. Record
    // the typed kernel outcome. The event name describes
    // what the kernel did (refused the connect(2)),
    // NOT whether the surrounding adapter invocation is
    // eventually rescued. Call-level rescue is derived
    // by the caller from probe observations joined with
    // the final returned result; observations alone
    // cannot establish rescue. See the module header for
    // the canonical algebra.
    emit({
      kind: "probe_refused",
      attempt,
      code: "ECONNREFUSED",
    });
    if (attempt < MAX_PACING_ATTEMPTS - 1) {
      await sleepFn(CONNECT_PACING_INTERVAL_MS);
      continue;
    }
  }
  // Pacing budget drained without a single successful
  // probe. The probe_refused events above recorded each
  // refused connect attempt; emit the terminal exhaustion
  // observation so the histogram has a single typed sink
  // for "pacing gave up".
  emit({ kind: "probe_budget_exhausted", attempts: MAX_PACING_ATTEMPTS });
  return {
    ok: false,
    error: {
      kind: "connect_failed",
      message:
        `load-admission pacing exhausted after ` +
        `${MAX_PACING_ATTEMPTS} attempts`,
    },
  };
}

/**
 * The single normative doctrine (result-bound rescue
 * algebra, TOCTOU caveat, telemetry contract, composition
 * pseudocode, load-admission pacing law, and diagnostic
 * classification law) lives in the top-of-file header of
 * this module. Comments in the function body MUST NOT
 * restate it — refer back to the header.
 */
