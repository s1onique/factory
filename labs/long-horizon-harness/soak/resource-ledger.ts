/**
 * LH-06 deterministic long-duration soak laboratory —
 * explicit resource ownership ledger.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * The worker MUST NOT infer every resource leak from OS
 * telemetry. Instead, the lab itself tracks an explicit set
 * of owned counters. At every stable checkpoint, these MUST
 * be zero.
 *
 *   active_workspaces       = 0
 *   active_temp_artifacts   = 0
 *   active_owned_streams    = 0
 *   active_soak_runs        = 0
 *   pending_cleanup_items   = 0
 *
 * Where subprocesses are not expected:
 *
 *   active_child_processes  = 0
 *
 * Any nonzero balance at a stable checkpoint is a hard
 * `RESOURCE_LEAK` failure. This is a STRONGER contract than
 * statistical memory inference.
 *
 * Where the resources already exist as factories / classes
 * inside the lab (e.g. the LH-04 runner, the LH-05
 * normalize pipeline), the soak should instrument the
 * factory boundary rather than scanning the process
 * heuristically.
 */

import type { SoakFaultInjection } from "./types.js";

/**
 * The closed-world set of counters the soak tracks.
 */
export interface OwnedResourceSnapshot {
  readonly active_workspaces: number;
  readonly active_temp_artifacts: number;
  readonly active_owned_streams: number;
  readonly active_soak_runs: number;
  readonly pending_cleanup_items: number;
  readonly active_child_processes: number;
  readonly injection_retained_bytes: number;
  readonly injection_retained_streams: number;
  readonly injection_retained_workspaces: number;
}

/**
 * Mutable mirror of OwnedResourceSnapshot for the ledger's
 * internal state. Not exported.
 */
interface MutableSnapshot {
  active_workspaces: number;
  active_temp_artifacts: number;
  active_owned_streams: number;
  active_soak_runs: number;
  pending_cleanup_items: number;
  active_child_processes: number;
  injection_retained_bytes: number;
  injection_retained_streams: number;
  injection_retained_workspaces: number;
}

export interface OwnedResourceBalance {
  readonly is_zero: boolean;
  readonly nonzero: ReadonlyArray<{
    readonly counter: keyof OwnedResourceSnapshot;
    readonly value: number;
  }>;
}

/**
 * The resource ledger. One instance per soak worker. The
 * worker MUST acquire / release resources through this
 * ledger so the counters stay honest.
 */
export class ResourceLedger {
  private counters: MutableSnapshot = {
    active_workspaces: 0,
    active_temp_artifacts: 0,
    active_owned_streams: 0,
    active_soak_runs: 0,
    pending_cleanup_items: 0,
    active_child_processes: 0,
    injection_retained_bytes: 0,
    injection_retained_streams: 0,
    injection_retained_workspaces: 0,
  };
  private readonly workspaces: Map<string, string> = new Map();
  private readonly tempArtifacts: Map<string, string> = new Map();
  private readonly ownedStreams: Map<string, string> = new Map();
  private readonly inFlightRuns: Set<string> = new Set();
  private readonly pendingCleanup: Set<string> = new Set();

  acquireWorkspace(id: string, path: string): void {
    if (this.workspaces.has(id)) {
      throw new Error(
        `ResourceLedger.acquireWorkspace: duplicate id ${id}`,
      );
    }
    this.workspaces.set(id, path);
    this.counters.active_workspaces += 1;
  }

  releaseWorkspace(id: string): void {
    if (!this.workspaces.has(id)) {
      throw new Error(
        `ResourceLedger.releaseWorkspace: unknown id ${id}`,
      );
    }
    this.workspaces.delete(id);
    this.counters.active_workspaces -= 1;
  }

  acquireTempArtifact(id: string, path: string): void {
    if (this.tempArtifacts.has(id)) {
      throw new Error(
        `ResourceLedger.acquireTempArtifact: duplicate id ${id}`,
      );
    }
    this.tempArtifacts.set(id, path);
    this.counters.active_temp_artifacts += 1;
  }

  releaseTempArtifact(id: string): void {
    if (!this.tempArtifacts.has(id)) {
      throw new Error(
        `ResourceLedger.releaseTempArtifact: unknown id ${id}`,
      );
    }
    this.tempArtifacts.delete(id);
    this.counters.active_temp_artifacts -= 1;
  }

  acquireStream(id: string, label: string): void {
    if (this.ownedStreams.has(id)) {
      throw new Error(
        `ResourceLedger.acquireStream: duplicate id ${id}`,
      );
    }
    this.ownedStreams.set(id, label);
    this.counters.active_owned_streams += 1;
  }

  releaseStream(id: string): void {
    if (!this.ownedStreams.has(id)) {
      throw new Error(
        `ResourceLedger.releaseStream: unknown id ${id}`,
      );
    }
    this.ownedStreams.delete(id);
    this.counters.active_owned_streams -= 1;
  }

  beginRun(runId: string): void {
    if (this.inFlightRuns.has(runId)) {
      throw new Error(
        `ResourceLedger.beginRun: duplicate runId ${runId}`,
      );
    }
    this.inFlightRuns.add(runId);
    this.counters.active_soak_runs += 1;
  }

  endRun(runId: string): void {
    if (!this.inFlightRuns.has(runId)) {
      throw new Error(
        `ResourceLedger.endRun: unknown runId ${runId}`,
      );
    }
    this.inFlightRuns.delete(runId);
    this.counters.active_soak_runs -= 1;
  }

  markPendingCleanup(id: string): void {
    this.pendingCleanup.add(id);
    this.counters.pending_cleanup_items += 1;
  }

  clearPendingCleanup(id: string): void {
    if (!this.pendingCleanup.has(id)) {
      throw new Error(
        `ResourceLedger.clearPendingCleanup: unknown id ${id}`,
      );
    }
    this.pendingCleanup.delete(id);
    this.counters.pending_cleanup_items -= 1;
  }

  /**
   * Track an injection-retained resource (LEAK01..LEAK07).
   * These counters are SEPARATE from the main balance so
   * production qualification is unaffected by injection
   * being enabled.
   */
  trackInjectionRetainedBytes(n: number): void {
    this.counters.injection_retained_bytes += n;
  }

  trackInjectionRetainedStream(id: string): void {
    this.ownedStreams.set(`injection:${id}`, id);
    this.counters.injection_retained_streams += 1;
  }

  trackInjectionRetainedWorkspace(id: string, path: string): void {
    this.workspaces.set(`injection:${id}`, path);
    this.counters.injection_retained_workspaces += 1;
  }

  snapshot(): OwnedResourceSnapshot {
    return { ...this.counters };
  }

  /**
   * Compute the production-balance verdict. The injection
   * counters are excluded — they are diagnostic-only.
   */
  productionBalance(): OwnedResourceBalance {
    const nonzero: { counter: keyof OwnedResourceSnapshot; value: number }[] = [];
    const productionKeys: (keyof OwnedResourceSnapshot)[] = [
      "active_workspaces",
      "active_temp_artifacts",
      "active_owned_streams",
      "active_soak_runs",
      "pending_cleanup_items",
      "active_child_processes",
    ];
    for (const k of productionKeys) {
      const v = this.counters[k];
      if (v !== 0) {
        nonzero.push({ counter: k, value: v });
      }
    }
    return {
      is_zero: nonzero.length === 0,
      nonzero: Object.freeze(nonzero),
    };
  }

  /**
   * Reset every counter to zero. Used by tests; NOT used by
   * the worker (the worker does not "reset" — it acquires /
   * releases honestly).
   */
  reset(): void {
    this.counters = {
      active_workspaces: 0,
      active_temp_artifacts: 0,
      active_owned_streams: 0,
      active_soak_runs: 0,
      pending_cleanup_items: 0,
      active_child_processes: 0,
      injection_retained_bytes: 0,
      injection_retained_streams: 0,
      injection_retained_workspaces: 0,
    };
    this.workspaces.clear();
    this.tempArtifacts.clear();
    this.ownedStreams.clear();
    this.inFlightRuns.clear();
    this.pendingCleanup.clear();
  }
}

/**
 * Determine whether an injection is "production-grade"
 * (i.e. whether the soak refuses to run with non-NONE
 * injection).
 *
 * Required:
 *   QUALIFICATION_WITH_FAULT_INJECTION = IMPOSSIBLE
 */
export function injectionAllowedForProfile(
  injection: SoakFaultInjection,
  profile: "CI_SMOKE" | "QUALIFICATION" | "EXTENDED",
): boolean {
  if (injection.kind === "NONE") return true;
  // CI_SMOKE accepts injection (for synthetic-leak probes).
  // QUALIFICATION and EXTENDED refuse.
  return profile === "CI_SMOKE";
}
