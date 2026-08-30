/**
 * Shared test helpers for the process-supervision suite.
 *
 * CORRECTION05 + CORRECTION06 doctrine (strict, fail-closed):
 *   - Negative-PGID absence classification:
 *       success            -> alive
 *       ESRCH              -> absent
 *       EPERM              -> denied
 *       ENOSYS/EINVAL/
 *       ENOTSUP            -> unsupported
 *       other unknown code -> unknown
 *     Only `absent` releases registry ownership.
 *     `EPERM` is "permission denied / unproven absence",
 *     never "absent". `unsupported` / `denied` / `alive` /
 *     `unknown` all mean: "we cannot prove absence; keep
 *     the entry in the ledger so the after-suite sweep
 *     can see and fail on it."
 *   - The capability probe refuses to report `available`
 *     unless BOTH the signal-zero probe succeeded AND the
 *     probe group is itself proven absent (ESRCH) after
 *     SIGKILL. Unproven cleanup yields
 *     `unavailable(PROBE_CLEANUP_UNPROVEN)`.
 *   - SAFETY (CORRECTION06):
 *       A test using a synthetic PGID MUST NOT call the real
 *       OS signal interface for that identifier. A capability
 *       test is either fully synthetic or fully live. Fake
 *       observations never certify actions taken against a
 *       real process.
 *       Probe and kill belong to the same authority boundary
 *       and are wrapped in a single ProcessGroupControl port.
 *       RealProcessGroupControl uses process.kill(-pgid, 0/..)
 *       with strict pgid validation. FakeProcessGroupControl
 *       is fully synthetic and never touches the OS.
 */

import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { spawn } from "node:child_process";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const FIXTURE_JS = path.join(
  ROOT,
  "build",
  "test",
  "fixtures",
  "child-fixture.js",
);

export const NODE_RUNTIME = process.execPath;

export function makeEnv(): Readonly<Record<string, string>> {
  return {
    PATH: process.env.PATH ?? "",
    NODE: process.env.NODE ?? "",
    HOME: process.env.HOME ?? "",
  };
}

// --------------------------------------------------------------------------
// Live-fixture registry
// --------------------------------------------------------------------------

const liveFixturePgids = new Set<number>();

export function registerLiveFixturePgid(pgid: number): void {
  liveFixturePgids.add(pgid);
}

export function unregisterLiveFixturePgid(pgid: number): void {
  liveFixturePgids.delete(pgid);
}

export function liveFixtureRegistrySize(): number {
  return liveFixturePgids.size;
}

export function snapshotLiveFixturePgids(): number[] {
  return Array.from(liveFixturePgids);
}

// (The `emergencyKillAllRegisteredPgids` function used to
// call process.kill directly. It is removed in CORRECTION06
// because a deterministic test can register a synthetic
// pgid and accidentally hit the real kernel via this path.
// Callers MUST now use `emergencyKillAllRegisteredPgidsWithControl`
// with an injected ProcessGroupControl. The LIVE/strict lane
// passes REAL_GROUP_CONTROL.)

// --------------------------------------------------------------------------
// ProcessGroupControl port (CORRECTION06 — authority boundary)
// --------------------------------------------------------------------------

/**
 * Probe + kill authority boundary.
 *
 * Probe and kill are deliberately colocated: they share the
 * same authoritative knowledge about whether a process group
 * exists and whether signalling is permitted. Splitting them
 * across two independent seams would let a test inject a
 * fake probe while keeping a real kill (or vice versa),
 * which is exactly the mixed-reality bug CORRECTION06 forbids.
 *
 * Implementations:
 *   - RealProcessGroupControl: process.kill(-pgid, 0) +
 *     process.kill(-pgid, "SIGKILL"), with strict pgid
 *     validation (integer, > 0, not 1).
 *   - FakeProcessGroupControl: fully synthetic, configurable,
 *     never touches the OS.
 */
export type GroupSignalResult =
  | { kind: "sent"; signal: "SIGKILL" }
  | { kind: "denied"; code: "EPERM" }
  | { kind: "unsupported"; code: string }
  | { kind: "unknown"; code?: string | undefined }
  | { kind: "absent"; code: "ESRCH" };

export interface ProcessGroupControl {
  readonly kind: "real" | "fake";
  /**
   * Negative-PGID probe. Returns one of:
   *   alive / absent / denied / unsupported / unknown.
   */
  probe(pgid: number): NegPgidProbe;
  /**
   * Send SIGKILL to the negative PGID. Returns one of:
   *   sent / denied / unsupported / unknown / absent.
   */
  kill(pgid: number): GroupSignalResult;
  /**
   * Total number of OS-level kill calls actually issued
   * (RealProcessGroupControl) or recorded (FakeProcessGroupControl).
   * Used by SAFE01 to assert zero real kills during
   * deterministic tests.
   */
  readonly killCallCount: number;
}

/**
 * Validate a pgid argument for real OS signalling. Reject
 * anything that is not a positive integer greater than 1.
 *
 * RealProcessGroupControl MUST use this validator before
 * calling process.kill. A malformed pgid must NOT reach
 * the OS.
 */
export function validateRealPgid(pgid: number): string | null {
  if (!Number.isInteger(pgid)) {
    return `pgid must be an integer; got ${pgid}`;
  }
  if (!Number.isFinite(pgid)) {
    return `pgid must be finite; got ${pgid}`;
  }
  if (pgid <= 0) {
    return `pgid must be positive; got ${pgid}`;
  }
  if (pgid === 1) {
    return `pgid === 1 (init) is never a valid supervised pgid`;
  }
  return null;
}

// --------------------------------------------------------------------------
// Negative-PGID probe classification (CORRECTION05)
// --------------------------------------------------------------------------

/**
 * Negative-PGID probe result kinds.
 *
 * Only `absent` releases registry ownership. Anything else
 * (alive / denied / unsupported / unknown) means we cannot
 * prove the group is gone and must keep the registry entry.
 */
export type NegPgidProbeKind =
  | "absent"
  | "alive"
  | "denied"
  | "unsupported"
  | "unknown";

export type NegPgidProbe = {
  readonly kind: NegPgidProbeKind;
  readonly code?: string | undefined;
};

/**
 * Real POSIX probe via REAL_GROUP_CONTROL.probe(). Delegates to
 * the ProcessGroupControl port so the negative-PGID classification
 * (CORRECTION05) and the pgid validation (CORRECTION06) live in
 * one place.
 */
export function realProbeNegPgid(pgid: number): NegPgidProbe {
  return REAL_GROUP_CONTROL.probe(pgid);
}

// --------------------------------------------------------------------------
// Real + Fake controls (CORRECTION06)
// --------------------------------------------------------------------------

/**
 * RealProcessGroupControl — process.kill(-pgid, 0/...) with
 * strict pgid validation. The only control allowed to issue
 * real OS signals.
 *
 * RealProcessGroupControl is the control used by the LIVE
 * matrix, LIVE15, and the real capability probe. Deterministic
 * tests MUST use FakeProcessGroupControl instead so that no
 * synthetic pgid can reach the kernel.
 */
export class RealProcessGroupControl implements ProcessGroupControl {
  readonly kind = "real" as const;
  private _killCallCount = 0;
  get killCallCount(): number { return this._killCallCount; }

  probe(pgid: number): NegPgidProbe {
    const guard = validateRealPgid(pgid);
    if (guard !== null) {
      return { kind: "unsupported", code: "EINVAL" };
    }
    try {
      process.kill(-pgid, 0);
      return { kind: "alive" };
    } catch (e: unknown) {
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? (e as { code: unknown }).code
          : undefined;
      const codeStr = typeof code === "string" ? code : undefined;
      if (codeStr === "ESRCH") return { kind: "absent", code: codeStr };
      if (codeStr === "EPERM") return { kind: "denied", code: codeStr };
      if (
        codeStr === "ENOSYS" ||
        codeStr === "EINVAL" ||
        codeStr === "ENOTSUP"
      ) {
        return { kind: "unsupported", code: codeStr };
      }
      return { kind: "unknown", code: codeStr };
    }
  }

  kill(pgid: number): GroupSignalResult {
    const guard = validateRealPgid(pgid);
    if (guard !== null) {
      return { kind: "unsupported", code: "EINVAL" };
    }
    this._killCallCount++;
    try {
      process.kill(-pgid, "SIGKILL");
      return { kind: "sent", signal: "SIGKILL" };
    } catch (e: unknown) {
      const code =
        typeof e === "object" && e !== null && "code" in e
          ? (e as { code: unknown }).code
          : undefined;
      const codeStr = typeof code === "string" ? code : undefined;
      if (codeStr === "ESRCH") return { kind: "absent", code: "ESRCH" };
      if (codeStr === "EPERM") return { kind: "denied", code: "EPERM" };
      if (
        codeStr === "ENOSYS" ||
        codeStr === "EINVAL" ||
        codeStr === "ENOTSUP"
      ) {
        return { kind: "unsupported", code: codeStr };
      }
      return { kind: "unknown", code: codeStr };
    }
  }
}

/**
 * Sentinel real control instance for the live path.
 * Deterministic tests MUST NOT use this.
 */
export const REAL_GROUP_CONTROL: ProcessGroupControl =
  new RealProcessGroupControl();

export type FakeControlSequence = ReadonlyArray<{
  readonly probe?: NegPgidProbe | undefined;
  readonly kill?: GroupSignalResult | undefined;
}>;

/**
 * FakeProcessGroupControl — fully synthetic. Never touches
 * the OS. Records every probe + kill call for safety tests
 * (SAFE01..SAFE04).
 *
 * Sequence mode (default): callers pre-declare a list of
 * probe / kill answers; each call consumes the next entry
 * that has a matching field. If a slot is exhausted, the
 * control returns a SAFE default (probe -> absent; kill ->
 * denied) so ownership release is never accidentally
 * certified by exhaustion.
 *
 * Function mode: callers supply a probeFn and/or killFn
 * directly.
 */
export class FakeProcessGroupControl implements ProcessGroupControl {
  readonly kind = "fake" as const;
  private _killCallCount = 0;
  private readonly _probes: Array<NegPgidProbe | undefined>;
  private readonly _kills: Array<GroupSignalResult | undefined>;
  private readonly _probeFn: ((pgid: number) => NegPgidProbe) | undefined;
  private readonly _killFn: ((pgid: number) => GroupSignalResult) | undefined;
  public readonly probeCalls: Array<{ pgid: number }> = [];
  public readonly killCalls: Array<{ pgid: number; result: GroupSignalResult }> = [];

  constructor(
    opts: {
      sequence?: FakeControlSequence;
      probeFn?: (pgid: number) => NegPgidProbe;
      killFn?: (pgid: number) => GroupSignalResult;
    } = {},
  ) {
    // Only retain entries that actually have a probe / kill
    // slot. Otherwise shift() would surface `undefined` and
    // the control would fall back to its safe default — a
    // subtle bug that hides the test's intended sequence.
    this._probes = (opts.sequence ?? [])
      .map((e) => e.probe)
      .filter((p): p is NegPgidProbe => p !== undefined);
    this._kills = (opts.sequence ?? [])
      .map((e) => e.kill)
      .filter((k): k is GroupSignalResult => k !== undefined);
    this._probeFn = opts.probeFn;
    this._killFn = opts.killFn;
  }

  get killCallCount(): number { return this._killCallCount; }

  probe(pgid: number): NegPgidProbe {
    this.probeCalls.push({ pgid });
    if (this._probeFn) return this._probeFn(pgid);
    const next = this._probes.shift();
    if (next !== undefined) return next;
    return { kind: "absent", code: "ESRCH" };
  }

  kill(pgid: number): GroupSignalResult {
    this._killCallCount++;
    const result = this._resolveKill(pgid);
    this.killCalls.push({ pgid, result });
    return result;
  }

  private _resolveKill(pgid: number): GroupSignalResult {
    if (this._killFn) return this._killFn(pgid);
    const next = this._kills.shift();
    if (next !== undefined) return next;
    return { kind: "denied", code: "EPERM" };
  }
}

/**
 * Emergency kill every registered PGID using the supplied
 * control. The LIVE/strict lane passes REAL_GROUP_CONTROL;
 * deterministic tests pass a FakeProcessGroupControl so no
 * synthetic pgid ever reaches the kernel.
 */
export function emergencyKillAllRegisteredPgidsWithControl(
  control: ProcessGroupControl,
): number {
  let killed = 0;
  for (const pgid of liveFixturePgids) {
    const r = control.kill(pgid);
    if (r.kind === "sent") killed++;
  }
  return killed;
}

// --------------------------------------------------------------------------
// Capability probe (CORRECTION05: async + proven-cleanup)
// --------------------------------------------------------------------------

export type ProcessGroupCapability =
  | { kind: "available" }
  | {
      kind: "unavailable";
      code: string;
      reason: string;
    };

/**
 * Pure policy: classify the capability from the initial
 * signal-zero probe and the final cleanup probe.
 *
 * Doctrine (CORRECTION05 + CORRECTION06):
 *   - signal-zero alive AND cleanup absent  -> available
 *   - signal-zero alive AND cleanup != absent
 *                                             -> unavailable(PROBE_CLEANUP_UNPROVEN)
 *   - signal-zero denied                     -> unavailable(PROBE_DENIED)
 *   - signal-zero unsupported                -> unavailable(PROBE_UNSUPPORTED)
 *   - signal-zero unknown                    -> unavailable(PROBE_UNKNOWN)
 *   - signal-zero absent                     -> unavailable(PROBE_ABSENT)
 *
 * This function has NO side effects, NO I/O, NO timing,
 * NO process spawning, NO signal calls. It is the unit
 * testable pure policy. CAP07..CAP10 exercise this function
 * directly.
 */
export function classifyCapability(
  initial: NegPgidProbe,
  cleanup: NegPgidProbe,
): ProcessGroupCapability {
  if (initial.kind === "alive") {
    if (cleanup.kind === "absent") {
      return { kind: "available" };
    }
    return {
      kind: "unavailable",
      code: "PROBE_CLEANUP_UNPROVEN",
      reason:
        "signal-zero succeeded but cleanup absence could not be proven",
    };
  }
  if (initial.kind === "denied") {
    return {
      kind: "unavailable",
      code: "PROBE_DENIED",
      reason: "signal-zero returned EPERM",
    };
  }
  if (initial.kind === "unsupported") {
    return {
      kind: "unavailable",
      code: "PROBE_UNSUPPORTED",
      reason: "negative-PGID signal not available on this host",
    };
  }
  if (initial.kind === "unknown") {
    return {
      kind: "unavailable",
      code: initial.code ?? "PROBE_UNKNOWN",
      reason: "signal-zero returned an unclassified error",
    };
  }
  // initial.kind === "absent"
  return {
    kind: "unavailable",
    code: "PROBE_ABSENT",
    reason: "probe group already absent at first probe",
  };
}

/**
 * After SIGKILL, repeatedly probe the negative PGID for
 * ESRCH within a bound. Only ESRCH proves absence;
 * EPERM, ENOSYS, EINVAL, ENOTSUP, or any other unknown
 * code does NOT prove absence and must return false.
 *
 * CORRECTION05 (C01): EPERM is not absence.
 *
 * CORRECTION06: probeFn is replaced by an explicit control
 * so this function always pairs probe with kill from the
 * same authority boundary.
 */
async function probeAbsenceAfterKill(
  pgid: number,
  control: ProcessGroupControl,
  onProbe?: (probe: NegPgidProbe) => void,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < 1500) {
    const probe = control.probe(pgid);
    if (onProbe) onProbe(probe);
    if (probe.kind === "absent") return true;
    // denied / unsupported / unknown / alive all keep the
    // entry; we wait briefly and retry, but we never treat
    // them as absence.
    await new Promise<void>((res) => setTimeout(res, 50));
  }
  return false;
}

/**
 * Probe whether the host allows negative-PGID signalling.
 *
 * CORRECTION05 (C03): no early `return available` —
 * capability result is finalized only after cleanup proof.
 *
 * CORRECTION06: this function is the live capability
 * experiment. It ALWAYS uses REAL_GROUP_CONTROL and a
 * freshly spawned detached Node child. It does NOT accept
 * any fake-observation injection. The pure policy lives
 * in `classifyCapability`, which is tested separately.
 */
export async function probeProcessGroupCapability(): Promise<ProcessGroupCapability> {
  const control = REAL_GROUP_CONTROL;
  const probe = spawn(
    process.execPath,
    ["-e", "setTimeout(() => process.exit(0), 4000)"],
    { detached: true, stdio: ["ignore", "ignore", "ignore"] },
  );
  const pgid = probe.pid;
  if (pgid === null || pgid === undefined) {
    return { kind: "unavailable", code: "NO_PID", reason: "spawn returned no pid" };
  }
  // SAFETY (CORRECTION06): the probe PGID MUST be the
  // pid of the detached child we just spawned. Reject
  // anything that does not match validateRealPgid.
  if (validateRealPgid(pgid) !== null) {
    return {
      kind: "unavailable",
      code: "INVALID_PGID",
      reason: `spawn returned invalid pgid ${pgid}`,
    };
  }
  registerLiveFixturePgid(pgid);

  // Step 1: initial signal-zero via REAL control.
  const initial = control.probe(pgid);

  // Step 2: best-effort SIGKILL the probe group via REAL
  // control, bounded reap, then prove absence.
  let provenAbsent = false;
  let lastCleanupProbe: NegPgidProbe = { kind: "unknown", code: "PROBE_CLEANUP_UNOBSERVED" };
  try {
    control.kill(pgid);
    await new Promise<void>((resolve) => {
      let done = false;
      probe.on("exit", () => {
        if (!done) {
          done = true;
          resolve();
        }
      });
      setTimeout(() => {
        if (!done) resolve();
      }, 2000);
    });
    provenAbsent = await probeAbsenceAfterKill(pgid, control, (p) => {
      // Track the last non-absent probe observation so
      // classifyCapability sees the honest reason when
      // absence is unproven.
      lastCleanupProbe = p;
    });
  } catch (e: unknown) {
    return {
      kind: "unavailable",
      code: "PROBE_CLEANUP_EXCEPTION",
      reason: `cleanup raised: ${String(e)}`,
    };
  }

  // If absence was unproven, classifyCapability must see
  // a non-absent cleanup so it returns PROBE_CLEANUP_UNPROVEN
  // for the alive initial case. The lastCleanupProbe carries
  // the honest reason (denied / unsupported / unknown).
  // When provenAbsent is true we override to "absent".
  const cleanup: NegPgidProbe = provenAbsent
    ? { kind: "absent", code: "ESRCH" }
    : lastCleanupProbe;

  const result = classifyCapability(initial, cleanup);

  // Release the registry entry ONLY on proven absence.
  if (provenAbsent) {
    unregisterLiveFixturePgid(pgid);
  }
  return result;
}


// Single shared capability result for the whole suite.
// Both lanes MUST consume this exact promise.

export const PROCESS_GROUP_CAPABILITY_PROMISE: Promise<ProcessGroupCapability> =
  probeProcessGroupCapability();

// Synchronous helper for tests that need a quick boolean.
// Returns false until the probe resolves; both lanes must
// await PROCESS_GROUP_CAPABILITY_PROMISE before making
// skip-vs-fail decisions.
export async function getProcessGroupCapability(): Promise<ProcessGroupCapability> {
  return PROCESS_GROUP_CAPABILITY_PROMISE;
}

// Backwards-compatible derived boolean. Initially false; the
// live-qualification file awaits getProcessGroupCapability()
// before its first LIVE test runs.
export const HARNESS_CAN_SIGNAL = false;

// --------------------------------------------------------------------------
// runLive — single ownership helper for LIVE01..LIVE14 (CORRECTION05)
// --------------------------------------------------------------------------

import type { Result } from "../../src/domain/result.js";
import type { Supervisor, CreateSupervisorArgs } from "../../src/process/supervised-process.js";
import type { Clock, SignalPort, SpawnPort } from "../../src/process/process-ports.js";
import type {
  ProcessFailure,
  ProcessResult,
  ProcessSpec,
  RuntimeEvent,
} from "../../src/process/process-types.js";

/**
 * Live-run options. See `realProbeNegPgid` for the real
 * classification (CORRECTION05):
 *   - "absent"      (ESRCH)
 *   - "alive"       (signal-zero succeeded)
 *   - "denied"      (EPERM)
 *   - "unsupported" (ENOSYS/EINVAL/ENOTSUP)
 *   - "unknown"     (any other classification)
 */


export type LiveRunOptions = {
  readonly startSupervised: (a: CreateSupervisorArgs) => Promise<Result<Supervisor, ProcessFailure>>;
  readonly clock: Clock;
  readonly signals: SignalPort;
  readonly spawner: SpawnPort;
  /**
   * Optional injected ProcessGroupControl. Defaults to
   * REAL_GROUP_CONTROL for the LIVE matrix. Deterministic
   * tests MUST inject a FakeProcessGroupControl so that no
   * synthetic pgid can reach the kernel.
   *
   * The control provides BOTH probe and kill; tests cannot
   * mix real probe with fake kill or vice versa.
   */
  readonly groupControl?: ProcessGroupControl;
};

function resolveControl(opts: LiveRunOptions): ProcessGroupControl {
  return opts.groupControl ?? REAL_GROUP_CONTROL;
}

// ----------------------------------------------------------------------
// tapStdoutUntil — wraps a SpawnPort so that stdout chunks
// are observed BEFORE the supervisor attaches its own reader.
// The returned promise resolves when `marker` is seen, or
// rejects on spawn error / timeout / fixture exit.
//
// CORRECTION08: this is how LIVE04 and LIVE08 wait for an
// actual readiness handshake before issuing cancel() /
// before testing cleanup. No fixed sleeps.
//
// Why this works: ChildProcess.stdout is an EventEmitter.
// Every listener registered for 'data' receives every
// chunk. We attach ours synchronously inside the wrapped
// spawn, BEFORE the wrapping function returns. The
// supervisor's internal attachBoundedSink runs synchronously
// shortly after spawn() returns, so we are guaranteed to be
// attached before the supervisor's listener. There is no
// way for a chunk to slip past us unless the libuv pipe
// buffer overflows — and we use a generous timeout.
// ----------------------------------------------------------------------

export type TapStdoutResult = {
  /** Pass this as `spawner` into withLiveSupervisor / runLive. */
  readonly spawner: SpawnPort;
  /** Resolves when `marker` appears in captured stdout. */
  readonly arrived: Promise<void>;
};

export function tapStdoutUntil(
  base: SpawnPort,
  marker: string,
  timeoutMs: number,
): TapStdoutResult {
  let resolveArrived: () => void = () => undefined;
  let rejectArrived: (e: Error) => void = () => undefined;
  const arrived = new Promise<void>((resolve, reject) => {
    resolveArrived = resolve;
    rejectArrived = reject;
  });
  // Make the arrival promise's timeout unref'd so it does
  // not keep the test runner alive past its useful life.
  const t = setTimeout(() => {
    rejectArrived(new Error(
      `tapStdoutUntil: marker '${marker}' not seen within ${timeoutMs}ms`,
    ));
  }, timeoutMs);
  t.unref();
  // Also reject on early uncaught rejection (the Promise
  // itself doesn't auto-unref; we just rely on the test
  // caller awaiting it).
  const childToBuf = new WeakMap<object, string>();
  const spawner: SpawnPort = {
    spawn: (args) => {
      const sc = base.spawn(args);
      let buf = "";
      childToBuf.set(sc as unknown as object, buf);
      const onData = (chunk: unknown): void => {
        const s = typeof chunk === "string"
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString("utf8")
            : String(chunk);
        buf += s;
        if (buf.includes(marker)) {
          resolveArrived();
        }
      };
      // Attach a 'data' listener to stdout BEFORE returning
      // to the supervisor. The supervisor attaches its own
      // listener right after, so we get the same chunks.
      const stdout = (sc as unknown as { stdout: NodeJS.ReadableStream | null }).stdout;
      if (stdout !== null) {
        stdout.on("data", onData);
      }
      const stderr = (sc as unknown as { stderr: NodeJS.ReadableStream | null }).stderr;
      if (stderr !== null) {
        stderr.on("data", onData);
      }
      // If the child errors before spawning, reject.
      sc.on("error", (e: Error) => rejectArrived(e));
      return sc;
    },
  };
  return { spawner, arrived };
}

/**
 * Best-effort cleanup for one owned PGID via the supplied
 * control. ONLY the final probe.kind === "absent" releases
 * the registry. Anything else (alive / denied / unsupported /
 * unknown) keeps the entry.
 *
 * CORRECTION06: the kill is delegated to the SAME control
 * that supplies the probe — no mixed-reality APIs.
 */
async function cleanupOnePgid(
  pgid: number,
  control: ProcessGroupControl,
): Promise<void> {
  const probe = control.probe(pgid);
  if (probe.kind === "absent") {
    unregisterLiveFixturePgid(pgid);
    return;
  }
  // For alive / denied / unsupported / unknown we still
  // try a best-effort SIGKILL via the same control, then
  // re-probe. ONLY the final probe.kind === "absent"
  // releases the registry.
  control.kill(pgid);
  await new Promise<void>((res) => setTimeout(res, 200));
  const finalProbe = control.probe(pgid);
  if (finalProbe.kind === "absent") {
    unregisterLiveFixturePgid(pgid);
  }
  // If denied/unsupported/unknown/alive: keep registry.
}

/**
 * Run a single supervised LIVE case with mandatory ownership.
 *
 * The supervisor sink is wired so that process_spawned
 * synchronously registers the PGID into the global
 * liveFixturePgids registry. This happens BEFORE any body
 * code can execute hazardous logic, and BEFORE the
 * supervisor can yield the result back to the body.
 *
 * The finally block probes each registered PGID for
 * absence, attempts a best-effort negative-PGID SIGKILL
 * if not absent, awaits close with a bounded wait, and
 * then unregisters ONLY when a final probe proves the
 * group is absent. If absence cannot be proven, the
 * registry entry stays — after-suite will see it and fail.
 */
export async function runLive(
  spec: ProcessSpec,
  opts: LiveRunOptions,
): Promise<ProcessResult> {
  const ownedPgids = new Set<number>();
  const control = resolveControl(opts);

  const events: RuntimeEvent[] = [];
  // The synchronous registration sink: every process_spawned
  // is inserted into the registry IN THE SAME TICK.
  const sink = (e: RuntimeEvent): void => {
    events.push(e);
    if (e.kind === "process_spawned") {
      const pgid = e.processGroupId;
      registerLiveFixturePgid(pgid);
      ownedPgids.add(pgid);
    }
  };

  const r = await opts.startSupervised({
    spec,
    clock: opts.clock,
    signals: opts.signals,
    spawner: opts.spawner,
    sink,
  });
  if (r.ok === false) throw new Error(`startSupervised failed: ${JSON.stringify(r.error)}`);
  const sup = r.value;

  try {
    return await sup.await();
  } finally {
    // Force the supervisor to settle within a bound so we
    // can begin cleanup deterministically.
    await Promise.race([
      sup.await().catch(() => undefined),
      new Promise<void>((res) => setTimeout(res, 1000)),
    ]);
    // Best-effort emergency cleanup for every owned PGID.
    // ONLY control.probe.kind === "absent" releases the
    // registry. The control also provides the kill, so
    // no synthetic pgid can reach the kernel.
    for (const pgid of ownedPgids) {
      await cleanupOnePgid(pgid, control);
    }
  }
}

/**
 * withLiveSupervisor — ownership helper for LIVE cases
 * that need direct access to the supervisor object (e.g.
 * LIVE04, LIVE07, LIVE09). Wires the same synchronous
 * registration sink as runLive().
 */
export async function withLiveSupervisor<T>(
  spec: ProcessSpec,
  body: (sup: Supervisor) => Promise<T>,
  opts: LiveRunOptions,
): Promise<T> {
  const ownedPgids = new Set<number>();
  const control = resolveControl(opts);
  const sink = (e: RuntimeEvent): void => {
    if (e.kind === "process_spawned") {
      const pgid = e.processGroupId;
      registerLiveFixturePgid(pgid);
      ownedPgids.add(pgid);
    }
  };
  const r = await opts.startSupervised({
    spec,
    clock: opts.clock,
    signals: opts.signals,
    spawner: opts.spawner,
    sink,
  });
  if (r.ok === false) throw new Error(`startSupervised failed: ${JSON.stringify(r.error)}`);
  const sup = r.value;
  let bodyError: unknown;
  try {
    return await body(sup);
  } catch (e) {
    bodyError = e;
    throw e;
  } finally {
    await Promise.race([
      sup.await().catch(() => undefined),
      new Promise<void>((res) => setTimeout(res, 1000)),
    ]);
    // ONLY control.probe.kind === "absent" releases the
    // registry. The control also provides the kill, so
    // no synthetic pgid can reach the kernel.
    for (const pgid of ownedPgids) {
      await cleanupOnePgid(pgid, control);
    }
    void bodyError;
  }
}
