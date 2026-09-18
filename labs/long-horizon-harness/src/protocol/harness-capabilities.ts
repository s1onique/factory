/**
 * Candidate-neutral harness capability types (LH-03 §4.1, H3).
 *
 * Capabilities describe what an adapter can actually probe
 * against the binary it discovered, not what the harness's
 * documentation claims. Each capability is bound to a
 * closed-world key list so that adding a capability is a
 * schema-visible, contract-bound change.
 *
 * CapabilityState distinguishes SUPPORTED / UNSUPPORTED /
 * UNAVAILABLE / UNQUALIFIED. UNAVAILABLE means the harness
 * does not expose the capability at all (so LH-02 metrics
 * that depend on it become unavailable, not zero).
 * UNQUALIFIED means the adapter has not yet run the probe
 * for this capability against the installed binary.
 *
 * Doctrine (D08): no candidate-specific capability names
 * (e.g. `clineToolStreaming`) appear here.
 */

import type { HarnessQualificationIdentity } from "./harness-identity.js";

/**
 * Closed-world capability states (LH-03 §4.1). The contract
 * never uses `false` to mean "missing"; absence/unknown is
 * always `UNAVAILABLE` or `UNQUALIFIED`, distinct from
 * `UNSUPPORTED` (probe ran and got `false`).
 */
export type CapabilityState =
  | "SUPPORTED"
  | "UNSUPPORTED"
  | "UNAVAILABLE"
  | "UNQUALIFIED";

export const CAPABILITY_STATES: readonly CapabilityState[] = [
  "SUPPORTED",
  "UNSUPPORTED",
  "UNAVAILABLE",
  "UNQUALIFIED",
] as const;

export function isCapabilityState(value: unknown): value is CapabilityState {
  return (
    typeof value === "string" &&
    (CAPABILITY_STATES as readonly string[]).includes(value)
  );
}

/**
 * Closed-world list of candidate-neutral capability keys.
 * Adding a key is a contract change (LH-03 H3).
 */
export type CapabilityKey =
  | "HEADLESS"
  | "STREAMING_EVENTS"
  | "FINAL_JSON"
  | "JSONL"
  | "RPC"
  | "SESSION_RESUME"
  | "SESSION_FORK"
  | "EXPLICIT_CWD"
  | "ISOLATED_DATA_DIR"
  | "MODEL_SELECTION"
  | "PROVIDER_SELECTION"
  | "TIMEOUT"
  | "CANCELLATION"
  | "AUTO_APPROVAL"
  | "TOOL_EVENT_VISIBILITY"
  | "TOKEN_USAGE"
  | "RESOURCE_USAGE"
  | "SESSION_ARTIFACTS";

export const CAPABILITY_KEYS: readonly CapabilityKey[] = [
  "HEADLESS",
  "STREAMING_EVENTS",
  "FINAL_JSON",
  "JSONL",
  "RPC",
  "SESSION_RESUME",
  "SESSION_FORK",
  "EXPLICIT_CWD",
  "ISOLATED_DATA_DIR",
  "MODEL_SELECTION",
  "PROVIDER_SELECTION",
  "TIMEOUT",
  "CANCELLATION",
  "AUTO_APPROVAL",
  "TOOL_EVENT_VISIBILITY",
  "TOKEN_USAGE",
  "RESOURCE_USAGE",
  "SESSION_ARTIFACTS",
] as const;

export function isCapabilityKey(value: unknown): value is CapabilityKey {
  return (
    typeof value === "string" &&
    (CAPABILITY_KEYS as readonly string[]).includes(value)
  );
}

/**
 * Live qualification state (LH-03 CORRECTION01, H-C06).
 *
 * Distinct from `CapabilityState`. A capability can be
 * declared as `SUPPORTED` (the harness exposes it) but
 * still be `LIVE_UNQUALIFIED` (the V1 adapter has not yet
 * run a live probe for it). Conflating these axes is the
 * bug the original LH-03 closure made for `SESSION_RESUME`
 * and `SESSION_FORK`.
 */
export type LiveQualificationState =
  | "LIVE_QUALIFIED"
  | "LIVE_UNQUALIFIED"
  | "LIVE_HALT"
  | "NOT_APPLICABLE";

export const LIVE_QUALIFICATION_STATES: readonly LiveQualificationState[] = [
  "LIVE_QUALIFIED",
  "LIVE_UNQUALIFIED",
  "LIVE_HALT",
  "NOT_APPLICABLE",
] as const;

export function isLiveQualificationState(
  value: unknown,
): value is LiveQualificationState {
  return (
    typeof value === "string" &&
    (LIVE_QUALIFICATION_STATES as readonly string[]).includes(value)
  );
}

/**
 * Per-capability axis binding (LH-03 CORRECTION01, H-C06;
 * extended in CORRECTION03 C03-01 to bind semantic
 * probe evidence, not just a path string).
 *
 * Each entry pairs a `CapabilityState` (HARNESS_CAPABILITY
 * — does the harness itself expose the feature?) with a
 * `LiveQualificationState` (did the V1 adapter actually
 * probe it during this qualification campaign?) and a
 * typed `probe_evidence` block.
 *
 * The contract never mixes the two meanings in a single
 * field. A capability may be:
 *
 *   - SUPPORTED + LIVE_QUALIFIED        — adapter exercised it
 *   - SUPPORTED + LIVE_UNQUALIFIED      — known supported but
 *                                          not probed in this run
 *   - SUPPORTED + LIVE_HALT             — probe was attempted
 *                                          but halted (e.g.
 *                                          HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE)
 *   - UNSUPPORTED                       — harness does not expose
 *   - UNAVAILABLE                       — harness cannot expose
 *   - UNQUALIFIED + LIVE_UNQUALIFIED    — probe not run
 *
 * CORRECTION03 (C03-01) introduced typed semantic probe
 * evidence. The previous `probe_evidence_path: string | null`
 * was a referential integrity constraint only — it proved a
 * path was recorded, not that the artifact on disk actually
 * establishes the capability. The new `probe_evidence` block
 * carries:
 *
 *   - `artifact_path`       — where to find the evidence
 *   - `artifact_sha256`     — the artifact's actual hash, so
 *                              drift fails closed
 *   - `probe_kind`          — closed-world discriminator:
 *                              `SESSION_ENVELOPE`,
 *                              `CANCELLATION_HALT`,
 *                              `INSPECTION_ONLY`, `NOT_RUN`
 *   - `evidence_relation`   — the capability-specific oracle
 *                              statement: expected vs observed
 *                              string. Equality is the PASS
 *                              condition.
 *   - `disposition`         — PASS / FAIL / HALT for the
 *                              capability-specific oracle.
 *
 * The semantic predicate that the validator enforces is:
 *
 *   LIVE_QUALIFIED ⇒
 *     probe_evidence != null
 *     ∧ probe_evidence.disposition === "PASS"
 *     ∧ probe_evidence.evidence_relation.expected ===
 *       probe_evidence.evidence_relation.observed
 *
 *   LIVE_HALT ⇒
 *     probe_evidence != null
 *     ∧ probe_evidence.disposition === "HALT"
 */
export type CapabilityProbeKind =
  | "SESSION_ENVELOPE"
  | "CANCELLATION_HALT"
  | "INSPECTION_ONLY"
  | "NOT_RUN";

export const CAPABILITY_PROBE_KINDS: readonly CapabilityProbeKind[] = [
  "SESSION_ENVELOPE",
  "CANCELLATION_HALT",
  "INSPECTION_ONLY",
  "NOT_RUN",
] as const;

export type EvidenceDisposition = "PASS" | "FAIL" | "HALT";

export const EVIDENCE_DISPOSITIONS: readonly EvidenceDisposition[] = [
  "PASS",
  "FAIL",
  "HALT",
] as const;

/**
 * Typed semantic probe evidence (LH-03 CORRECTION03,
 * C03-01, C03-02). Replaces the previous bare
 * `probe_evidence_path: string | null` and grounds
 * `LIVE_QUALIFIED` in:
 *
 *   artifact exists
 *   + artifact_sha256 matches the recorded hash
 *   + capability-specific oracle PASSed (expected ===
 *     observed under the same probe_kind)
 *
 * For capabilities that do not require a capability-
 * specific oracle (e.g. presence-only probes), the
 * `evidence_relation.expected` equals the observed field
 * name (e.g. `"SESSION_HEADER.type"`).
 *
 * `probe_kind = "NOT_RUN"` is the sentinel used when
 * `LIVE_UNQUALIFIED`; the validator rejects
 * `LIVE_QUALIFIED` claims that carry `NOT_RUN`.
 */
export type CapabilityProbeEvidence = {
  readonly capability: CapabilityKey;
  readonly probe_kind: CapabilityProbeKind;
  readonly artifact_path: string;
  readonly artifact_sha256: string;
  readonly evidence_relation: {
    readonly expected: string;
    readonly observed: string;
  };
  readonly disposition: EvidenceDisposition;
};

export function isCapabilityProbeKind(value: unknown): value is CapabilityProbeKind {
  return (
    typeof value === "string" &&
    (CAPABILITY_PROBE_KINDS as readonly string[]).includes(value)
  );
}

export function isEvidenceDisposition(value: unknown): value is EvidenceDisposition {
  return (
    typeof value === "string" &&
    (EVIDENCE_DISPOSITIONS as readonly string[]).includes(value)
  );
}

export type CapabilityAxis = {
  readonly harness_capability: CapabilityState;
  readonly live_qualification: LiveQualificationState;
  readonly probe_evidence: CapabilityProbeEvidence | null;
  /**
   * CORRECTION02 retained this field for backwards
   * compatibility with serialized fixtures, but it is
   * now derived from `probe_evidence.artifact_path`
   * when present. Adapters SHOULD write to
   * `probe_evidence` directly; the validator enforces
   * consistency between the two.
   */
  readonly probe_evidence_path: string | null;
};

/**
 * The capability document. Adapters MUST report at least
 * every key in CAPABILITY_KEYS, with `UNQUALIFIED` for any
 * probe that has not been run.
 *
 * CORRECTION01 (H-C06): the document carries the
 * `live_qualification_by_key` axis as well as the
 * closed-world `capabilities` map. Both are bound to the
 * same identity tuple. The two axes MUST NOT be derived
 * from each other.
 */
export type HarnessCapabilities = {
  readonly identity: HarnessQualificationIdentity;
  readonly discovered_at_ms: number;
  readonly capabilities: Readonly<Record<CapabilityKey, CapabilityState>>;
  readonly live_qualification_by_key: Readonly<
    Record<CapabilityKey, LiveQualificationState>
  >;
  readonly capability_axes: Readonly<Record<CapabilityKey, CapabilityAxis>>;
};

export function emptyCapabilities(
  identity: HarnessQualificationIdentity,
  discovered_at_ms: number,
): HarnessCapabilities {
  const capabilities: Record<CapabilityKey, CapabilityState> = {
    HEADLESS: "UNQUALIFIED",
    STREAMING_EVENTS: "UNQUALIFIED",
    FINAL_JSON: "UNQUALIFIED",
    JSONL: "UNQUALIFIED",
    RPC: "UNQUALIFIED",
    SESSION_RESUME: "UNQUALIFIED",
    SESSION_FORK: "UNQUALIFIED",
    EXPLICIT_CWD: "UNQUALIFIED",
    ISOLATED_DATA_DIR: "UNQUALIFIED",
    MODEL_SELECTION: "UNQUALIFIED",
    PROVIDER_SELECTION: "UNQUALIFIED",
    TIMEOUT: "UNQUALIFIED",
    CANCELLATION: "UNQUALIFIED",
    AUTO_APPROVAL: "UNQUALIFIED",
    TOOL_EVENT_VISIBILITY: "UNQUALIFIED",
    TOKEN_USAGE: "UNQUALIFIED",
    RESOURCE_USAGE: "UNQUALIFIED",
    SESSION_ARTIFACTS: "UNQUALIFIED",
  };
  const live: Record<CapabilityKey, LiveQualificationState> = {
    HEADLESS: "LIVE_UNQUALIFIED",
    STREAMING_EVENTS: "LIVE_UNQUALIFIED",
    FINAL_JSON: "LIVE_UNQUALIFIED",
    JSONL: "LIVE_UNQUALIFIED",
    RPC: "LIVE_UNQUALIFIED",
    SESSION_RESUME: "LIVE_UNQUALIFIED",
    SESSION_FORK: "LIVE_UNQUALIFIED",
    EXPLICIT_CWD: "LIVE_UNQUALIFIED",
    ISOLATED_DATA_DIR: "LIVE_UNQUALIFIED",
    MODEL_SELECTION: "LIVE_UNQUALIFIED",
    PROVIDER_SELECTION: "LIVE_UNQUALIFIED",
    TIMEOUT: "LIVE_UNQUALIFIED",
    CANCELLATION: "LIVE_UNQUALIFIED",
    AUTO_APPROVAL: "LIVE_UNQUALIFIED",
    TOOL_EVENT_VISIBILITY: "LIVE_UNQUALIFIED",
    TOKEN_USAGE: "LIVE_UNQUALIFIED",
    RESOURCE_USAGE: "LIVE_UNQUALIFIED",
    SESSION_ARTIFACTS: "LIVE_UNQUALIFIED",
  };
  const axes: Record<CapabilityKey, CapabilityAxis> = {} as Record<
    CapabilityKey,
    CapabilityAxis
  >;
  for (const k of CAPABILITY_KEYS) {
    axes[k] = {
      harness_capability: capabilities[k],
      live_qualification: live[k],
      probe_evidence: null,
      probe_evidence_path: null,
    };
  }
  return {
    identity,
    discovered_at_ms,
    capabilities,
    live_qualification_by_key: live,
    capability_axes: axes,
  };
}

/**
 * Frozen-set check used by capability-document tests. Adapters
 * MUST NOT silently omit a key from the document; omission is
 * a contract violation.
 */
export function assertCapabilitiesComplete(
  caps: HarnessCapabilities,
): { readonly ok: true } | { readonly ok: false; readonly missing: readonly CapabilityKey[] } {
  const missing: CapabilityKey[] = [];
  for (const k of CAPABILITY_KEYS) {
    if (!(k in caps.capabilities)) {
      missing.push(k);
    }
  }
  if (missing.length === 0) return { ok: true };
  return { ok: false, missing };
}

/**
 * Live-qualification invariant violation (LH-03 CORRECTION02
 * C02-01, extended in CORRECTION03 C03-01/C03-02/C03-05).
 *
 * CORRECTION02 closed only the **referential integrity**
 * defect: a `LIVE_QUALIFIED` axis had to point at a
 * non-null evidence path. CORRECTION03 closes the deeper
 * defect: a `LIVE_QUALIFIED` axis must point at typed
 * semantic probe evidence (`probe_evidence`) whose
 * capability-specific oracle PASSes. A capability axis is
 * illegal when:
 *
 *   - LIVE_QUALIFIED with `probe_evidence === null`
 *     (the adapter claims a live probe ran, but no
 *     typed semantic probe evidence binds it to a
 *     fixture).
 *
 *   - LIVE_HALT with `probe_evidence === null` (a
 *     halt disposition must also be backed by typed
 *     probe evidence whose `disposition === "HALT"`).
 *
 *   - LIVE_QUALIFIED with `probe_evidence.disposition !==
 *     "PASS"` (the artifact was on disk, but the
 *     capability-specific oracle FAILED — e.g. the
 *     requested CWD was not the observed session-header
 *     CWD).
 *
 *   - LIVE_QUALIFIED with `probe_evidence.evidence_relation
 *     .expected !== probe_evidence.evidence_relation
 *     .observed` (semantic relation not satisfied).
 *
 *   - LIVE_QUALIFIED with `probe_evidence.probe_kind ===
 *     "NOT_RUN"` (cannot claim qualified when the
 *     adapter has not actually exercised a probe).
 *
 *   - `probe_evidence.capability` does not match the
 *     axis key (the evidence must be bound to the
 *     capability it purports to prove).
 *
 *   - `probe_evidence_path` and `probe_evidence.artifact_path`
 *     disagree when both are non-null (the two views of
 *     the same artifact must be consistent).
 *
 *   - live_qualification axis disagrees with
 *     live_qualification_by_key[k] (the canonical axis
 *     must match the index view).
 *
 *   - capability_axes omits a key (every key in
 *     CAPABILITY_KEYS must have an axis).
 *
 * The validator never throws; it returns the full list of
 * violations so callers can report each one. The contract
 * rejects `LIVE_QUALIFIED` claims that are not bound to
 * typed semantic probe evidence. This is the axiom that
 * closed the overclaim of CORRECTION01 (referential
 * integrity) and the deeper defect of CORRECTION02
 * (semantic sufficiency).
 */
export type LiveQualificationViolation =
  | {
      readonly kind: "live_qualified_without_evidence";
      readonly key: CapabilityKey;
    }
  | {
      readonly kind: "live_halt_without_evidence";
      readonly key: CapabilityKey;
    }
  | {
      readonly kind: "live_qualified_with_failed_oracle";
      readonly key: CapabilityKey;
      readonly probe_kind: CapabilityProbeKind;
      readonly disposition: EvidenceDisposition;
      readonly expected: string;
      readonly observed: string;
    }
  | {
      readonly kind: "live_qualified_with_not_run_probe";
      readonly key: CapabilityKey;
    }
  | {
      readonly kind: "probe_evidence_capability_mismatch";
      readonly key: CapabilityKey;
      readonly probe_capability: CapabilityKey;
    }
  | {
      readonly kind: "probe_evidence_path_disagreement";
      readonly key: CapabilityKey;
      readonly probe_evidence_path_field: string | null;
      readonly probe_evidence_artifact_path: string;
    }
  | {
      readonly kind: "axis_views_disagree";
      readonly key: CapabilityKey;
      readonly axes_axis: LiveQualificationState;
      readonly map_axis: LiveQualificationState;
    }
  | {
      readonly kind: "missing_axis";
      readonly key: CapabilityKey;
    };

export function validateLiveQualification(
  caps: HarnessCapabilities,
):
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly violations: readonly LiveQualificationViolation[];
    } {
  const violations: LiveQualificationViolation[] = [];
  for (const k of CAPABILITY_KEYS) {
    const axis = caps.capability_axes[k];
    if (axis === undefined) {
      violations.push({ kind: "missing_axis", key: k });
      continue;
    }
    if (axis.live_qualification !== caps.live_qualification_by_key[k]) {
      violations.push({
        kind: "axis_views_disagree",
        key: k,
        axes_axis: axis.live_qualification,
        map_axis: caps.live_qualification_by_key[k],
      });
    }
    // CORRECTION03 semantic evidence predicate:
    //   LIVE_QUALIFIED implies probe_evidence != null AND
    //   probe_evidence.disposition === "PASS" AND
    //   probe_evidence.evidence_relation.expected ===
    //     probe_evidence.evidence_relation.observed AND
    //   probe_evidence.probe_kind !== "NOT_RUN" AND
    //   probe_evidence.capability === k AND
    //   (probe_evidence_path == null OR
    //    probe_evidence_path === probe_evidence.artifact_path)
    if (axis.live_qualification === "LIVE_QUALIFIED") {
      if (axis.probe_evidence === null) {
        violations.push({
          kind: "live_qualified_without_evidence",
          key: k,
        });
        continue;
      }
      const ev = axis.probe_evidence;
      if (ev.capability !== k) {
        violations.push({
          kind: "probe_evidence_capability_mismatch",
          key: k,
          probe_capability: ev.capability,
        });
      }
      if (ev.probe_kind === "NOT_RUN") {
        violations.push({
          kind: "live_qualified_with_not_run_probe",
          key: k,
        });
      }
      if (ev.disposition !== "PASS") {
        violations.push({
          kind: "live_qualified_with_failed_oracle",
          key: k,
          probe_kind: ev.probe_kind,
          disposition: ev.disposition,
          expected: ev.evidence_relation.expected,
          observed: ev.evidence_relation.observed,
        });
      } else if (
        ev.evidence_relation.expected !== ev.evidence_relation.observed
      ) {
        violations.push({
          kind: "live_qualified_with_failed_oracle",
          key: k,
          probe_kind: ev.probe_kind,
          disposition: "FAIL",
          expected: ev.evidence_relation.expected,
          observed: ev.evidence_relation.observed,
        });
      }
      if (
        axis.probe_evidence_path !== null &&
        axis.probe_evidence_path !== ev.artifact_path
      ) {
        violations.push({
          kind: "probe_evidence_path_disagreement",
          key: k,
          probe_evidence_path_field: axis.probe_evidence_path,
          probe_evidence_artifact_path: ev.artifact_path,
        });
      }
    }
    if (axis.live_qualification === "LIVE_HALT") {
      if (axis.probe_evidence === null) {
        violations.push({
          kind: "live_halt_without_evidence",
          key: k,
        });
        continue;
      }
      if (axis.probe_evidence.disposition !== "HALT") {
        violations.push({
          kind: "live_qualified_with_failed_oracle",
          key: k,
          probe_kind: axis.probe_evidence.probe_kind,
          disposition: axis.probe_evidence.disposition,
          expected: axis.probe_evidence.evidence_relation.expected,
          observed: axis.probe_evidence.evidence_relation.observed,
        });
      }
      if (
        axis.probe_evidence_path !== null &&
        axis.probe_evidence_path !== axis.probe_evidence.artifact_path
      ) {
        violations.push({
          kind: "probe_evidence_path_disagreement",
          key: k,
          probe_evidence_path_field: axis.probe_evidence_path,
          probe_evidence_artifact_path: axis.probe_evidence.artifact_path,
        });
      }
    }
  }
  if (violations.length === 0) return { ok: true };
  return { ok: false, violations };
}
