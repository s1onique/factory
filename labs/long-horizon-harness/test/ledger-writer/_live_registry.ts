/**
 * _live_registry.ts
 * (B0-QUALIFICATION02 / FOUNDATION04 PHASE A
 *  CORRECTION04)
 *
 * Singleton registry for test-owned LedgerWriter live
 * fixtures. Every spawned writer child, runDir, and
 * socket pathname MUST be registered here at creation
 * time, and ONLY unregistered after proven cleanup:
 *
 *   child    → kernel ESRCH observed via kill(pid, 0)
 *               (`ProveChildAbsentResult.kind ===
 *               "pid_absent"`). Positive-PID state
 *               alone NEVER releases ownership.
 *
 *   path     → lstat raises ENOENT.
 *
 *   lease    → same as path.
 *
 * This is the residue oracle. fs.rm(...).catch(...) is
 * NOT proof of cleanup — it is a request that may
 * silently fail. The strict lane counts anything
 * registered at suite start that was NOT proven
 * unlinked as residue.
 *
 * ─────────────────────────────────────────────────────
 * CORRECTION04 architectural doctrine:
 *
 *   "Audit/qualification code may PROVE cleanup
 *    performed by an authority owner; it must not
 *    silently BECOME a second cleanup authority."
 *
 * The residue sweep runs AFTER the capability-owning
 * test operation. It must NOT reacquire destructive
 * authority from a historic positive PID. Therefore
 * `proveChildAbsent()` is OBSERVATION-ONLY:
 *
 *   - it NEVER calls `child.kill(...)`;
 *   - it NEVER calls `process.kill(pid, ...)`;
 *   - it ONLY calls `kill(pid, 0)` to observe kernel
 *     state (ESRCH / EPERM / alive);
 *   - it inspects the OWNED HANDLE'S lifecycle
 *     surface — either Node's exitCode/signalCode
 *     (for a real ChildProcess) or the handle's
 *     authoritative `exitInfo()` (for a
 *     WitnessSpawnHandle) — to detect "child
 *     terminated" without depending on a historical
 *     PID.
 *
 * (FOUNDATION04 PHASE A — WITNESS-LIFECYCLE-AUTHORITY
 *  CORRECTION01) Identity-bound lifecycle evidence
 * dominates bare-PID observation. Once the owned
 * handle has authoritatively observed the original
 * child's exit boundary, the registry ownership is
 * released regardless of what a subsequent
 * `kill(pid, 0)` returns. This is the lifecycle-
 * authority law:
 *
 *   specific-child terminated proof:
 *     owned handle exit boundary observed
 *       + (kernel says absent OR kernel denies us)
 *         => released (child_terminated_proven)
 *
 *   bare historic PID + ESRCH
 *     => released (pid_absent)
 *
 *   bare historic PID + positive
 *     + Node did NOT see our child's exit
 *       => residue (alive)
 *
 *   bare historic PID + positive
 *     + Node saw our child's exit (PID reuse risk)
 *       => residue (child_terminated)
 *
 *   bare historic PID + EPERM
 *     + Node did NOT see our child's exit
 *       => residue (permission_denied)
 *
 * Cleanup belongs at the spawn/lifecycle site where
 * ownership is unquestionably current. The residue
 * oracle is for proving, not performing.
 *
 * No production code is included here. This module is
 * test-only.
 */

import { promises as fs } from "node:fs";

export type LiveFixtureKind = "writer_child" | "helper_child" | "run_dir" | "socket_path" | "lease_dir";

export type LiveFixtureEntry = {
  readonly kind: LiveFixtureKind;
  readonly ref: unknown;
  readonly path?: string | undefined;
  readonly pid?: number | undefined;
  readonly note: string;
};

const registry: LiveFixtureEntry[] = [];

export function registerLiveFixture(entry: LiveFixtureEntry): void {
  registry.push(entry);
}

export function unregisterLiveFixture(entry: LiveFixtureEntry): void {
  const idx = registry.indexOf(entry);
  if (idx >= 0) registry.splice(idx, 1);
}

/**
 * Unregister every entry whose `path` matches the
 * given path exactly. Returns the number of entries
 * removed. Used by the strict lane after a proven
 * cleanup so the registry reflects ground truth.
 *
 * (B0-QUALIFICATION04) Lifecycle separation: this is
 * only safe AFTER `proveUnlink` succeeded; residue
 * classification depends on registry truth matching
 * filesystem truth.
 */
export function unregisterLiveFixtureByPath(p: string): number {
  let removed = 0;
  for (let i = registry.length - 1; i >= 0; i--) {
    const e = registry[i];
    if (e !== undefined && e.path === p) {
      registry.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
}

/**
 * (B0-QUALIFICATION04) Register a runDir as a
 * NON-OWNED fixture. The strict lane tracks runDirs
 * for residue accounting but the per-case lifecycle
 * explicitly distinguishes writer-stop from
 * evidence-preservation from runDir-cleanup.
 *
 * `destroyRunDir()` is the ONLY operation permitted
 * to remove this entry; child termination MUST NOT
 * touch it.
 */
export function registerRunDirForTracking(args: {
  readonly runDir: string;
  readonly note: string;
}): LiveFixtureEntry {
  const entry: LiveFixtureEntry = {
    kind: "run_dir",
    ref: undefined,
    path: args.runDir,
    note: args.note,
  };
  registerLiveFixture(entry);
  return entry;
}

/**
 * (B0-QUALIFICATION04) Destroy a runDir and prove
 * its absence; on success, unregister the registry
 * entry. Returns true iff the path was proven absent
 * after the operation.
 *
 * Failure semantics:
 *   - Throws if the path STILL exists after `fs.rm`,
 *     OR if the registry has no matching entry.
 *   - Swallowed fs.rm errors are NOT acceptable:
 *     they leave ground truth < registry truth,
 *     which the strict lane counts as residue.
 */
export async function destroyRunDir(p: string): Promise<boolean> {
  await fs.rm(p, { recursive: true, force: true });
  // Prove absence: lstat must raise ENOENT.
  let absent = false;
  try {
    await fs.lstat(p);
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") absent = true;
  }
  if (!absent) {
    throw new Error(`destroyRunDir: path still present after rm: ${p}`);
  }
  const removed = unregisterLiveFixtureByPath(p);
  if (removed === 0) {
    throw new Error(`destroyRunDir: no registered run_dir entry for ${p}`);
  }
  return true;
}

export function liveFixtureRegistrySize(): number {
  return registry.length;
}

export function snapshotLiveFixtures(): ReadonlyArray<LiveFixtureEntry> {
  return registry.slice();
}

/**
 * Probe whether a path is absent. Returns true only if
 * lstat raises ENOENT.
 */
export async function probePathAbsent(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return false;
  } catch (e: unknown) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT") return true;
    return false;
  }
}

/**
 * Best-effort unlink of a path with no throw.
 * Returns true iff the path was absent at exit time
 * (proved by ENOENT on lstat after the operation).
 *
 * Use this for sockets / lease dirs where missing
 * is acceptable. For runDir evidence lifecycle, use
 * `destroyRunDir` instead — it THROWS on failure so
 * residue accounting cannot be silently bypassed.
 */
export async function proveUnlink(p: string): Promise<boolean> {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  return await probePathAbsent(p);
}

/**
 * Typed residue probe for a child handle. Returns a
 * discriminator so the strict lane can distinguish:
 *
 *   - "pid_absent"          — kernel ESRCH observed
 *                              via kill(pid, 0). The
 *                              authoritative proof that
 *                              the PID we once owned no
 *                              longer exists in this
 *                              namespace. Releases
 *                              registry ownership.
 *
 *   - "child_terminated_proven"
 *                            — (CORRECTION01) the
 *                              handle's authoritative
 *                              lifecycle channel
 *                              (`exitInfo().exited`
 *                              OR Node's
 *                              exitCode/signalCode)
 *                              has observed the
 *                              original child's exit,
 *                              AND the kernel probe
 *                              is NOT positive (either
 *                              ESRCH or EPERM). The
 *                              original child is gone;
 *                              the historical PID is
 *                              either absent or
 *                              inaccessible to us.
 *                              Identity-bound proof —
 *                              NOT PID-bound. Releases
 *                              registry ownership.
 *
 *   - "child_terminated"    — Node's ChildProcess has
 *                              reported its close/exit
 *                              boundary (the handle is
 *                              dead from Node's view),
 *                              BUT the kernel still has
 *                              a live process at that
 *                              positive PID. This is
 *                              NOT proof of absence;
 *                              the PID may have been
 *                              reassigned to an
 *                              unrelated process
 *                              between the original
 *                              child exiting and our
 *                              probe. Counts as residue.
 *                              (CORRECTION01): this is
 *                              the "PID possibly reused"
 *                              guard — distinct from
 *                              `child_terminated_proven`
 *                              because we cannot rule
 *                              out PID reuse when the
 *                              kernel confirms a live
 *                              process at the
 *                              historical integer.
 *
 *   - "alive"               — kernel says it exists AND
 *                              we have not (yet) seen
 *                              Node's exit boundary.
 *                              Counts as residue (we
 *                              cannot prove the child
 *                              is gone; we do NOT
 *                              attempt cleanup here).
 *
 *   - "permission_denied"   — kill(pid, 0) returned
 *                              EPERM AND the handle's
 *                              lifecycle channel has NOT
 *                              observed the original
 *                              child's exit. Existence
 *                              from our vantage is
 *                              unknown but permission to
 *                              signal is denied. Per
 *                              POSIX semantics this says
 *                              nothing about whose
 *                              process that PID is. We
 *                              do NOT infer re-parenting
 *                              or UID credentials — we
 *                              just record the honest
 *                              observation. Counts as
 *                              residue (NOT absent).
 *                              (CORRECTION01): if the
 *                              lifecycle channel HAD
 *                              seen the exit, this
 *                              outcome becomes
 *                              `child_terminated_proven`
 *                              instead — EPERM without
 *                              Node-side exit retains
 *                              the entry.
 *
 *   - "identity_unavailable"— the handle exposes no
 *                              usable PID; absence
 *                              CANNOT be proven.
 *                              Negative-evidence law:
 *                              missing/invalid PID is
 *                              NEVER "absent" — it is
 *                              "identity_unavailable".
 *
 * CORRECTION04 (observation-only oracle):
 *
 *   This function NEVER calls `child.kill(...)` or
 *   `process.kill(pid, ...)`. It only:
 *
 *     - inspects the child handle's exitCode /
 *       signalCode (pure read), and
 *     - calls `kill(pid, 0)` to ask the kernel a
 *       yes/no question about PID presence.
 *
 *   Cleanup of the original child is the
 *   responsibility of the spawn/lifecycle site where
 *   ownership is unquestionably current. The residue
 *   oracle's job is to PROVE what happened, not to
 *   perform any side effects. This eliminates the
 *   PID-reuse race that any positive-PID signalling
 *   would create.
 *   destructive authority from a historical PID probe;
 *   once Node sees the exit we treat the handle as
 *   terminated and STOP signalling (TERMed or
 *   otherwise) the positive PID.
 *
 *   The observation-only state machine is therefore:
 *
 *     1. Identity check. If `child.pid` is missing,
 *        non-finite, or non-positive → return
 *        `identity_unavailable`. The harness cannot
 *        prove anything without a usable PID; we must
 *        not guess.
 *
 *     2. Node-exit check. Inspect
 *        `child.exitCode`/`signalCode`. If either is
 *        non-null, Node has already observed the
 *        original child's exit. We must NOT signal
 *        the positive PID — it may have been reused.
 *        We still classify via kill(pid, 0) below.
 *
 *     3. Kernel probe via `kill(pid, 0)`. Three
 *        outcomes:
 *          - ESRCH        → "pid_absent"
 *          - EPERM        → "permission_denied"
 *          - no error     → "alive" (counts as residue)
 *
 *     4. Post-exit branch. If Node saw the exit AND
 *        the kernel probe says alive (PID was reused
 *        or never reaped), we return "child_terminated"
 *        — Node has proven the original child exited,
 *        but the positive PID is no longer ours. We
 *        must NOT signal it.
 *
 *     This oracle NEVER calls `child.kill(...)` or
 *     `process.kill(pid, ...)`. It is purely an
 *     observer.
 */
export type ProveChildAbsentResult =
  | { readonly kind: "pid_absent" }
  | { readonly kind: "child_terminated_proven" }
  | { readonly kind: "child_terminated" }
  | { readonly kind: "alive" }
  | { readonly kind: "permission_denied"; readonly errno: string }
  | { readonly kind: "identity_unavailable" };

export async function proveChildAbsent(
  child: IdentityBoundChildPort,
): Promise<ProveChildAbsentResult> {
  const pid = child.pid;

  // ----------------------------------------------------------------
  // (1) Identity check.
  //
  // No usable PID → no observation possible. We must
  // not guess. The caller can treat this as residue.
  // ----------------------------------------------------------------
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return { kind: "identity_unavailable" };
  }

  // ----------------------------------------------------------------
  // (2) Node-exit check.
  //
  // If Node has already observed the original child's
  // exit, the positive PID is no longer ours. We do
  // NOT signal it. We still observe its current
  // kernel state via kill(pid, 0).
  // ----------------------------------------------------------------
  const nodeSawExit = childHasExited(child);

  // ----------------------------------------------------------------
  // (3) Kernel probe (kill(pid, 0)). Observation-only.
  //
  // This call sends NO signal. It only asks the
  // kernel "does this PID currently exist and is
  // signal-permitted?".
  // ----------------------------------------------------------------
  const probe = kernelProbe(pid);

  if (probe.kind === "absent") {
    // ESRCH — the kernel says nothing is at this
    // integer. If Node also saw the exit we still
    // return pid_absent (the kernel observation is
    // stronger). If Node did NOT see the exit (rare
    // zombie race) we STILL return pid_absent
    // because the kernel has nothing at this PID.
    return { kind: "pid_absent" };
  }
  if (probe.kind === "permission_denied") {
    // (FOUNDATION04 PHASE A — WITNESS-LIFECYCLE-
    //  AUTHORITY CORRECTION01)
    //
    // EPERM from kill(pid, 0) means the kernel
    // refuses to disclose to us whether a process
    // exists at that PID. It DOES NOT mean the
    // original child is alive — it means the kernel
    // will not tell us.
    //
    // PRE-CORRECTION01 behaviour classified this as
    // `permission_denied` regardless of Node-side
    // evidence, which is too conservative: a host
    // that EPERMs the parent's kill on a freshly-
    // spawned child (macOS sandbox) would block
    // residue release forever, even though Node's
    // own lifecycle channel has authoritative proof
    // that the original child exited.
    //
    // POST-CORRECTION01: if Node (or the handle's
    // authoritative `exitInfo()`) has observed the
    // exit, we reclassify as `child_terminated_proven`.
    // This is identity-bound, not PID-bound: we trust
    // the OWNED HANDLE'S OWN exit boundary over a
    // bare historical PID. This protects against
    // PID-reuse races that a positive-PID kernel
    // probe cannot detect, and against kernel-side
    // permission denial that has nothing to say
    // about our original child's fate.
    //
    // If Node did NOT see the exit, the EPERM is the
    // best evidence we have; we conservatively report
    // `permission_denied` (residue — the original
    // child may still be running and we cannot
    // prove otherwise).
    if (nodeSawExit) {
      return { kind: "child_terminated_proven" };
    }
    return {
      kind: "permission_denied",
      errno: probe.errno,
    };
  }

  // ----------------------------------------------------------------
  // (4) Post-exit branch.
  //
  // The kernel says a process is alive at this PID.
  // If Node already saw OUR original child's exit,
  // the live PID cannot be ours — it is either
  // reused or a zombie we never reaped. We MUST NOT
  // signal it. Report `child_terminated`.
  //
  // If Node did NOT see the exit, then the kernel's
  // "alive" reading is, as far as we can tell, our
  // original child still running. Counts as residue.
  // ----------------------------------------------------------------
  if (nodeSawExit) {
    return { kind: "child_terminated" };
  }
  return { kind: "alive" };
}

/**
 * Has Node observed the original child's exit?
 * Structural probe via `exitCode` / `signalCode`.
 * Pure read — does NOT signal, does NOT poll the
 * kernel.
 *
 * Returns true iff Node has delivered (or already
 * cached) the exit boundary. Once true, the positive
 * PID is no longer an ownership token for us.
 */
function childHasExited(child: IdentityBoundChildPort): boolean {
  // (FOUNDATION04 PHASE A — WITNESS-LIFECYCLE-
  //  AUTHORITY CORRECTION01)
  //
  // PRIORITY 1: identity-bound exitInfo().
  //
  // If the handle exposes the CORRECTION10
  // authoritative exitInfo() surface (a
  // WitnessSpawnHandle does; a real ChildProcess
  // does NOT), read it. This is the handle's own
  // proof that the original child has terminated.
  // We must NEVER cast the handle back to a
  // ChildProcess shape to fish for exitCode —
  // that cast is unsound (the reviewer's whole
  // argument) and on a real WitnessSpawnHandle
  // those fields do not exist.
  if (typeof child.exitInfo === "function") {
    try {
      const info = child.exitInfo();
      if (info && typeof info === "object" && "exited" in info) {
        return info.exited === true;
      }
    } catch {
      // exitInfo must be a pure read; if it throws,
      // fall through to the structural probe.
    }
  }
  // PRIORITY 2: structural probe via exitCode /
  // signalCode. This is what a real node:child_process
  // ChildProcess exposes. We use structural typing
  // (no cast) — the read is permissive: missing
  // fields are treated as "not exited".
  const c = child as unknown as {
    exitCode?: number | null;
    signalCode?: NodeJS.Signals | null;
  };
  return (
    (c.exitCode !== null && c.exitCode !== undefined) ||
    (c.signalCode !== null && c.signalCode !== undefined)
  );
}

type KernelProbeResult =
  | { readonly kind: "absent" }
  | { readonly kind: "alive" }
  | { readonly kind: "permission_denied"; readonly errno: string };

/**
 * Kernel probe via `kill(pid, 0)`. No signal is sent.
 *
 *   - returns (no error) → process exists, we have
 *     permission to signal it (alive).
 *   - throws ESRCH        → process does not exist.
 *   - throws EPERM        → process exists but we lack
 *     permission to signal it. Existence is UNKNOWN
 *     from our vantage — we MUST NOT classify as
 *     "absent". This is the honest read; we do not
 *     require proof of session/UID mismatch to record
 *     the observation.
 *   - throws other        → treat as unknown, conservative
 *     "alive". Caller's state machine will retry.
 */
function kernelProbe(pid: number): KernelProbeResult {
  try {
    process.kill(pid, 0);
    return { kind: "alive" };
  } catch (e: unknown) {
    const code = errnoOf(e);
    if (code === "ESRCH") return { kind: "absent" };
    if (code === "EPERM") {
      return { kind: "permission_denied", errno: code };
    }
    return { kind: "alive" };
  }
}

function errnoOf(e: unknown): string | null {
  if (typeof e === "object" && e !== null && "code" in e) {
    const c = (e as { code: unknown }).code;
    return typeof c === "string" ? c : null;
  }
  return null;
}

/**
 * Sweep all registered fixtures. Returns the residue
 * list (entries that could NOT be proven cleaned).
 *
 * CORRECTION04: the per-child probe returns a typed
 * result. Only `kind === "pid_absent"` clears the
 * entry. All other kinds —
 *   - alive
 *   - child_terminated
 *   - permission_denied
 *   - identity_unavailable
 * count as residue and the corresponding entry is
 * retained in the failure list. The kind itself is
 * recorded on the entry (`.observation`) and shown in
 * the matrix stdout for later triage.
 *
 * CORRECTION04 invariant: after sweepAndProve returns,
 *   registry.length === failed.length
 *   (every unproven entry is BOTH retained in the
 *    registry AND in the residue list — never the
 *    other way around; never double-counted; never
 *    silently dropped).
 */
export async function sweepAndProve(): Promise<ReadonlyArray<LiveFixtureEntry>> {
  const failed: LiveFixtureEntry[] = [];
  for (let i = registry.length - 1; i >= 0; i--) {
    const e = registry[i];
    if (e === undefined) continue;
    let proved = false;
    let observation: string | null = null;
    if (e.kind === "writer_child" || e.kind === "helper_child") {
      const child = e.ref as IdentityBoundChildPort;
      const r = await proveChildAbsent(child);
      observation = r.kind;
      // CORRECTION04 + WITNESS-LIFECYCLE-AUTHORITY
      // CORRECTION01: registry ownership is released
      // when EITHER:
      //   - the kernel reports ESRCH for the
      //     historical pid (`pid_absent`), OR
      //   - the handle's authoritative lifecycle
      //     channel has observed the original
      //     child's exit (`child_terminated_proven`).
      // Both release forms are identity-bound
      // evidence that the registered child is gone.
      // `child_terminated` (positive-PID after
      // Node exit — possible PID reuse) and
      // `permission_denied` (EPERM without Node-side
      // exit) retain the entry as residue.
      proved = r.kind === "pid_absent" ||
        r.kind === "child_terminated_proven";
    } else if (e.path !== undefined) {
      proved = await proveUnlink(e.path);
      // Path-only entries report the structural kind
      // ("pid_absent" if the path is gone, "alive"
      // otherwise) so the residue breakdown is
      // homogeneous across child and non-child
      // fixtures.
      observation = proved ? "pid_absent" : "alive";
    }
    if (proved) {
      unregisterLiveFixture(e);
    } else {
      // Stash the observation on the entry so the
      // matrix emitter can show the typed breakdown.
      if (observation !== null) {
        (e as { observation?: string }).observation = observation;
      }
      failed.push(e);
    }
  }
  return failed;
}

/**
 * Pure residue classifier used by WS15c.
 *
 * Given a list of entries and a probe function,
 * partition the list into:
 *   - proven    (probe returned true)
 *   - residue   (probe returned false)
 *
 * The probe function is the test-harness's
 * authoritative "is this gone?" observer — the
 * default registry sweep uses real `kill`/`lstat`,
 * but a pure test can inject any observation
 * (e.g. a recorded script).
 *
 * Required law:
 *   proven  → unregister
 *   residue → retain + report
 *
 * No mutation of the input list is performed. The
 * caller is responsible for actually unregistering
 * the proven entries.
 */
export function classifyResidue<E extends { readonly path?: string }>(
  entries: ReadonlyArray<E>,
  proveFn: (e: E) => Promise<boolean>,
): Promise<{
  readonly proven: ReadonlyArray<E>;
  readonly residue: ReadonlyArray<E>;
}> {
  return Promise.all(
    entries.map(async (e) => ({ e, ok: await proveFn(e) })),
  ).then((results) => {
    const proven: E[] = [];
    const residue: E[] = [];
    for (const r of results) {
      if (r.ok) proven.push(r.e);
      else residue.push(r.e);
    }
    return { proven, residue };
  });
}

/**
 * Register a writer child + its socket + its lease
 * dir + its runDir atomically.
 *
 * (B0-QUALIFICATION04) The runDir IS registered
 * here for residue accounting, but it is NOT touched
 * by writer termination. The qualification wrapper
 * no longer calls `fs.rm(runDir)` inside
 * `WriterHandle.stop()`. The runDir is destroyed
 * ONLY by `destroyRunDir(runDir)`, which the case
 * body invokes explicitly after evidence reads.
 *
 * Evidence-preservation invariant enforced:
 *
 *   stopping the writer MUST NOT delete the ledger
 *   before the case finishes reading it.
 *
 * Returns the registered entries so the caller can
 * unregister them explicitly if needed.
 */
export function registerWriterSpawn(args: {
  readonly child: import("node:child_process").ChildProcess;
  readonly runDir: string;
  readonly socketPath: string;
}): readonly [
  LiveFixtureEntry,
  LiveFixtureEntry,
  LiveFixtureEntry,
  LiveFixtureEntry,
] {
  const leaseDir = `${args.runDir}/ledger-writer-owner`;
  const childEntry: LiveFixtureEntry = {
    kind: "writer_child",
    ref: args.child,
    pid: args.child.pid,
    path: args.socketPath,
    note: `writer child pid=${args.child.pid ?? "?"}`,
  };
  const sockEntry: LiveFixtureEntry = {
    kind: "socket_path",
    ref: undefined,
    path: args.socketPath,
    note: `socket ${args.socketPath}`,
  };
  const leaseEntry: LiveFixtureEntry = {
    kind: "lease_dir",
    ref: undefined,
    path: leaseDir,
    note: `lease dir ${leaseDir}`,
  };
  const runDirEntry: LiveFixtureEntry = {
    kind: "run_dir",
    ref: undefined,
    path: args.runDir,
    note: `run dir ${args.runDir}`,
  };
  registerLiveFixture(childEntry);
  registerLiveFixture(sockEntry);
  registerLiveFixture(leaseEntry);
  registerLiveFixture(runDirEntry);
  return [childEntry, sockEntry, leaseEntry, runDirEntry] as const;
}

export function registerHelperSpawn(args: {
  readonly child: import("node:child_process").ChildProcess;
  readonly note: string;
}): LiveFixtureEntry {
  const entry: LiveFixtureEntry = {
    kind: "helper_child",
    ref: args.child,
    pid: args.child.pid,
    note: args.note,
  };
  registerLiveFixture(entry);
  return entry;
}

/**
 * Narrow port for any "owned child" the live lane
 * needs to record for residue accounting.
 *
 *   pid:             observed child PID (set by Node's
 *                    spawn()).
 *   kill?:           optional signal send — present on
 *                    a real ChildProcess but NOT
 *                    required by the residue oracle.
 *
 * The residue oracle (CORRECTION04) does NOT use
 * `kill` at all. It is purely an observer. The
 * `kill` field is kept in the type only for source
 * compatibility with code paths that still hold a
 * real ChildProcess; the oracle never invokes it.
 *
 * The oracle additionally reads `exitCode` /
 * `signalCode` from the underlying handle (when
 * present) to detect Node's exit boundary. These are
 * treated as optional reads via structural typing so
 * the type itself stays narrow.
 */
export type OwnedChildPort = {
  // ChildProcess.pid is `number | undefined`; the
  // WitnessSpawnHandle narrows to `number | null`.
  // Accept either (and on missing pid treat as
  // "identity_unavailable" so the strict lane
  // fails closed) to keep the residue helpers
  // usable from both surfaces.
  readonly pid?: number | null | undefined;
  // Optional signal send. The residue oracle never
  // calls this. It exists for type compatibility
  // with a real ChildProcess handle.
  kill?(signal?: NodeJS.Signals): boolean;
};

/**
 * (FOUNDATION04 PHASE A — WITNESS-LIFECYCLE-AUTHORITY
 *  CORRECTION01)
 *
 * Narrow identity-bound child port. A handle that
 * exposes this surface has AUTHORITATIVE lifecycle
 * evidence: it is the SAME object the spawn adapter
 * returned, and it can prove "the original child I
 * spawned has terminated" via its own exit-boundary
 * surface — without depending on a historical
 * numeric PID.
 *
 * `exitInfo` returns the handle's authoritative
 * exit record. The presence of this method is the
 * lifecycle-authority signal: the residue oracle
 * MUST consult it before falling back to a bare
 * `process.kill(pid, 0)`.
 *
 * `whenBootstrapOutputClosed` is the
 * terminal-output-accounting barrier (CORRECTION10).
 * It resolves when the bounded stdout/stderr drains
 * have observed their terminal lifecycle boundary
 * (clean `'end'`). Resolving this barrier is
 * stronger evidence than exitCode/signalCode alone:
 * it proves BOTH that the child exited AND that
 * its stdio has been drained to the terminal
 * boundary, which is what makes subsequent
 * observation of "no process at the historical PID"
 * meaningful (we are not racing with a still-emitting
 * child).
 *
 * Both fields are OPTIONAL. A real `ChildProcess`
 * exposes `exitCode`/`signalCode` directly (the
 * previous oracle's structural probe). A
 * `WitnessSpawnHandle` exposes `exitInfo()` and
 * `whenBootstrapOutputClosed()` (the CORRECTION10
 * production handle). The oracle accepts either
 * shape and routes to the right reader.
 */
export type IdentityBoundChildPort = {
  // Identity.
  //
  // Accept the union of pid shapes that real
  // handles expose:
  //   ChildProcess.pid        : number | undefined
  //   WitnessSpawnHandle.pid  : number | null
  //
  // The oracle routes on a positive finite number;
  // null and undefined are both treated as
  // identity_unavailable. The registration
  // boundary normalizes `child.pid ?? undefined`
  // into the LiveFixtureEntry so the registry's
  // stored identifier is uniform (number |
  // undefined).
  readonly pid?: number | null | undefined;

  // Identity-bound termination evidence
  // (CORRECTION10 / CORRECTION01).
  //
  // When present, the handle is the AUTHORITATIVE
  // source for "the original child has terminated".
  // The oracle reads `exitInfo().exited` as priority
  // 1 — overriding bare PID observation. The
  // remaining fields (`code`, `signal`) are read
  // as diagnostic detail by the live lane's matrix
  // emitter; they are optional so adversarial
  // fixtures can stub only `exited`.
  readonly exitInfo?: () => { readonly exited: boolean };

  // Fallback Node lifecycle evidence.
  //
  // A real `node:child_process` ChildProcess does
  // NOT expose `exitInfo()` (its authoritative
  // exit boundary is the structural pair
  // `exitCode` / `signalCode`). Encoding both
  // shapes in one structural port lets the oracle
  // route by capability — priority 1 is the
  // handle's own `exitInfo`, priority 2 is the
  // Node-side pair — without ever casting the
  // handle to a concrete class.
  readonly exitCode?: number | null;
  readonly signalCode?: NodeJS.Signals | null;

  // Optional signal send. The residue oracle
  // never invokes this; it exists for source
  // compatibility with a real ChildProcess
  // handle and for the test-site cleanup
  // authority's bounded-deadline wait.
  // Signature matches `node:child_process`'s
  // `ChildProcess.kill` exactly (signals only,
  // not raw signal numbers) so a real
  // ChildProcess is assignable.
  readonly kill?: (signal?: NodeJS.Signals) => boolean;

  // Terminal-output-accounting barrier
  // (CORRECTION10). Not consumed by the
  // structural probe (the oracle reads `exitInfo`
  // directly); the live test awaits it via
  // structural typing. Declared as a pure
  // Promise-returning method so the type
  // signature is honest.
  readonly whenBootstrapOutputClosed?: () => Promise<unknown>;
};

/**
 * (FOUNDATION04 CORRECTION04) Register a
 * witness child produced by Phase A's `startWitness`
 * gate. The entry MUST be unregistered ONLY after
 * `proveChildAbsent` succeeded. Without this
 * registration, the strict lane could certify
 * WITNESS_START_LIVE_RESIDUE=0 without proving the
 * witness actually disappeared (Q15: signal-sent is not
 * proof-of-cleanup).
 *
 * `witnessInstanceId` is recorded as the note so the
 * residue sweep can identify which witness (if any)
 * failed to clean up.
 */
export function registerWitnessSpawn(args: {
  readonly child: IdentityBoundChildPort;
  readonly witnessInstanceId: string;
  readonly runDir: string;
}): LiveFixtureEntry {
  const entry: LiveFixtureEntry = {
    kind: "helper_child",
    ref: args.child,
    pid: args.child.pid ?? undefined,
    note:
      `witness instance=${args.witnessInstanceId} ` +
      `runDir=${args.runDir}`,
  };
  registerLiveFixture(entry);
  return entry;
}
