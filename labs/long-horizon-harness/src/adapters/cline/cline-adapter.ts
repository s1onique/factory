/**
 * Cline / ClineMM adapter stub (LH-03 §13, §6).
 *
 * Candidate-specific code lives ONLY here and in this
 * directory. The common protocol package never imports from
 * this file; conversely this file imports only from the
 * candidate-neutral protocol, the lab domain types, and the
 * adapter-common helpers.
 *
 * LH-03 V1 status:
 *
 *   CLINE / CLINEMM IS NOT INSTALLED ON THIS HOST.
 *
 * Per LH-03 §6 / §30, this is recorded as the explicit halt
 * disposition
 *
 *   HALT_CLINE_NOT_INSTALLED
 *
 * The adapter DOES NOT silently substitute upstream Cline for
 * ClineMM without recording the change of subject. This file
 * therefore implements the same V1 + V2 surface as the Pi
 * adapter (so cross-adapter conformance can exercise it via
 * fixtures) but the live-probe lane and the live-capture
 * ingest path are intentionally absent.
 *
 * The unit tests for the V1 surface, the schema fingerprint,
 * the qualification identity, and the conformance suite all
 * run against this stub using captured / fixture evidence.
 *
 * The fixture directory `test/fixtures/harnesses/cline/` is
 * provisioned for use in follow-up qualification runs once
 * ClineMM is actually installed on a host.
 */

import type {
  HarnessAdapter,
  HarnessEvent,
  HarnessStatus,
  StartInput,
  StartResult,
  InterruptResult,
  HarnessKind,
  HarnessIdentity,
  HarnessQualificationIdentity,
  ProtocolMode,
  HarnessCapabilities,
  HarnessAdapterV2,
  PreparedHarnessRun,
  HarnessProcessResult,
  HarnessRawArtifact,
  HarnessCancellationResult,
  HarnessAdapterError,
  CapabilityState,
  CapabilityAxis,
  LiveQualificationState,
} from "../../protocol/index.js";
import {
  adapterError,
  emptyCapabilities,
  qualificationIdentityEquals,
  CAPABILITY_KEYS,
} from "../../protocol/index.js";
import type { HarnessHandle } from "../../domain/ids.js";
import { makeHarnessHandle } from "../../domain/ids.js";
import { computeSchemaFingerprint } from "../../adapter-common/schema-fingerprint.js";
import { parseNativeLine, isRecord } from "../../adapter-common/json-codec.js";
import {
  redactPreparedRunEnv,
  redactPreparedRunArgv,
} from "../../redaction/secret-redaction.js";

/**
 * Closed-world set of native event kinds the Cline NDJSON
 * V1 adapter understands. Cline / ClineMM upstream documents
 * `--json` as newline-delimited JSON. The exact closed-world
 * list below is provisional and MUST be pinned at the moment
 * a live Cline binary is available for capture.
 *
 * Until then, the list is intentionally narrow: only kinds
 * the conformance suite can defensibly assert.
 */
export const CLINE_KNOWN_EVENT_KINDS: ReadonlySet<string> = new Set([
  "session_start",
  "session_end",
  "message",
  "tool_started",
  "tool_completed",
  "done",
  "error",
]);

/**
 * Closed-world set of required envelope fields for the
 * Cline `session_start` event (provisional; confirmed by
 * live capture when ClineMM becomes available).
 */
export const CLINE_SESSION_REQUIRED_FIELDS: ReadonlyArray<string> = [
  "type",
  "session_id",
  "timestamp",
  "cwd",
];

export const CLINE_QUALIFIED_HARNESS_NAME: HarnessKind = "cline";
export const CLINE_QUALIFIED_PROTOCOL_MODE: ProtocolMode = "JSONL_EVENTS";
export const CLINE_ADAPTER_NAME = "factory.cline.adapter.v1";
export const CLINE_ADAPTER_VERSION = "0.1.0";

/**
 * Compute the canonical Cline V1 native schema fingerprint.
 * Pure and deterministic. The fingerprint is bound to the
 * closed-world event-kind list above, so adding a known
 * kind WITHOUT bumping the schema fingerprint is a
 * contract violation (LH-03 H6, §7).
 */
export function clineSchemaFingerprint(
  protocol_mode: ProtocolMode,
  version: string,
): string {
  return computeSchemaFingerprint({
    protocol_mode,
    event_kinds: Array.from(CLINE_KNOWN_EVENT_KINDS),
    required_fields: Array.from(CLINE_SESSION_REQUIRED_FIELDS),
    version,
  });
}

/**
 * Build the qualified Cline identity tuple. The exact
 * package_name / package_version / executable_path /
 * executable_sha256 are filled in by `ClineAdapter.discover`
 * once ClineMM is actually installed; until then all those
 * fields stay null and the adapter is recorded as
 * UNQUALIFIED.
 */
export function clineQualificationIdentity(args: {
  readonly package_name: string | null;
  readonly package_version: string | null;
  readonly executable_path: string | null;
  readonly executable_sha256: string | null;
  readonly reported_cli_version: string | null;
}): HarnessQualificationIdentity {
  return {
    harness_name: "cline",
    package_name: args.package_name,
    package_version: args.package_version,
    executable_path: args.executable_path,
    executable_sha256: args.executable_sha256,
    reported_cli_version: args.reported_cli_version,
    protocol_mode: CLINE_QUALIFIED_PROTOCOL_MODE,
    native_schema_fingerprint:
      args.package_version !== null
        ? clineSchemaFingerprint(
            CLINE_QUALIFIED_PROTOCOL_MODE,
            args.package_version,
          )
        : null,
  };
}

/**
 * Whether the supplied identity matches the provisional
 * Cline V1 closed-world identity. Until ClineMM is
 * installed, this returns false (and consumers must record
 * HALT_CLINE_NOT_INSTALLED instead of forcing PASS).
 */
export function clineIdentityMatches(
  actual: HarnessQualificationIdentity,
): boolean {
  // No `package_name` / `executable_path` known yet, so the
  // strict component-wise equality test always fails. The
  // test surface still allows the schema fingerprint to be
  // compared in isolation.
  return qualificationIdentityEquals(
    actual,
    clineQualificationIdentity({
      package_name: null,
      package_version: null,
      executable_path: null,
      executable_sha256: null,
      reported_cli_version: null,
    }),
  );
}

type ClineRunState = "starting" | "running" | "completed" | "errored";

type ClineInternalRun = {
  readonly handle: HarnessHandle;
  readonly identity: HarnessQualificationIdentity;
  readonly capabilities: HarnessCapabilities;
  readonly command: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly started_at_ms: number | null;
  readonly timeout_ms: number | null;
  process_spawned: boolean;
  process_exit_code: number | null;
  process_exit_signal: string | null;
  cancel_requested: boolean;
  timeout_initiated: boolean;
  external_kill_used: boolean;
  native_abort_observed: boolean;
  exit_at_ms: number | null;
  stdout_lines: string[];
  stderr_lines: string[];
  native_events: Readonly<Record<string, unknown>>[];
  raw_events: string[];
  state: ClineRunState;
  adapter_errors: HarnessAdapterError[];
  cleaned: boolean;
};

/**
 * Decode a single Cline NDJSON line into a normalised event
 * or unknown/malformed classification. Throws NOTHING:
 * returns a typed tag instead (LH-03 H6).
 */
export function decodeClineEvent(
  attemptId: string,
  line: string,
): { readonly event: HarnessEvent; readonly kind: string } | {
  readonly event: null;
  readonly kind: string;
} | {
  readonly event: null;
  readonly kind: "MALFORMED_NATIVE_EVENT";
} {
  const parsed = parseNativeLine(line);
  if (!parsed.ok) {
    return { event: null, kind: "MALFORMED_NATIVE_EVENT" };
  }
  if (!isRecord(parsed.value)) {
    return { event: null, kind: "MALFORMED_NATIVE_EVENT" };
  }
  const record = parsed.value;
  const t = record["type"];
  if (typeof t !== "string") {
    return { event: null, kind: "MALFORMED_NATIVE_EVENT" };
  }
  if (!CLINE_KNOWN_EVENT_KINDS.has(t)) {
    return { event: null, kind: "UNKNOWN" };
  }
  switch (t) {
    case "session_start": {
      // session_start is a meta-observation; never
      // authoritatively starts a run by itself.
      return { event: null, kind: "session_start" };
    }
    case "session_end": {
      return {
        event: {
          type: "candidate_reported_completion",
          attemptId,
          summary:
            typeof record["summary"] === "string"
              ? (record["summary"] as string)
              : "",
        },
        kind: "session_end",
      };
    }
    case "message": {
      const content = record["content"];
      if (typeof content !== "string") {
        return { event: null, kind: "MALFORMED_NATIVE_EVENT" };
      }
      return {
        event: { type: "candidate_message", attemptId, text: content },
        kind: "message",
      };
    }
    case "tool_started": {
      const tool = record["tool"];
      const callId = record["call_id"];
      if (typeof tool !== "string" || typeof callId !== "string") {
        return { event: null, kind: "MALFORMED_NATIVE_EVENT" };
      }
      return {
        event: {
          type: "tool_started",
          attemptId,
          tool,
          callId,
        },
        kind: "tool_started",
      };
    }
    case "tool_completed": {
      const tool = record["tool"];
      const callId = record["call_id"];
      const success = record["success"];
      if (
        typeof tool !== "string" ||
        typeof callId !== "string" ||
        (success !== undefined && typeof success !== "boolean")
      ) {
        return { event: null, kind: "MALFORMED_NATIVE_EVENT" };
      }
      const ok = success === false ? false : true;
      return {
        event: {
          type: "tool_finished",
          attemptId,
          tool,
          callId,
          ok,
        },
        kind: "tool_completed",
      };
    }
    case "done": {
      // "done" is non-authoritative (LH-03 H7). It is
      // mapped to a candidate_reported_completion so the
      // supervisor sees an observation, not a terminal.
      return {
        event: {
          type: "candidate_reported_completion",
          attemptId,
          summary: "done",
        },
        kind: "done",
      };
    }
    case "error": {
      const code = record["code"];
      const message = record["message"];
      return {
        event: {
          type: "candidate_error",
          attemptId,
          code: typeof code === "string" ? code : "CLINE_ERROR",
          message: typeof message === "string" ? message : "",
        },
        kind: "error",
      };
    }
    default:
      return { event: null, kind: "UNKNOWN" };
  }
}

export class ClineAdapter implements HarnessAdapter, HarnessAdapterV2 {
  readonly kind: HarnessKind = "cline";
  private readonly qualification_: HarnessQualificationIdentity;
  private readonly caps_: HarnessCapabilities;
  private readonly runs = new Map<string, ClineInternalRun>();
  private readonly captured_at_ms: number;
  private readonly adapter_name: string;
  private readonly adapter_version: string;

  constructor(args: {
    readonly qualification: HarnessQualificationIdentity;
    readonly capabilities: HarnessCapabilities;
    readonly captured_at_ms: number;
    readonly adapter_name?: string;
    readonly adapter_version?: string;
  }) {
    this.qualification_ = args.qualification;
    this.caps_ = args.capabilities;
    this.captured_at_ms = args.captured_at_ms;
    this.adapter_name = args.adapter_name ?? CLINE_ADAPTER_NAME;
    this.adapter_version = args.adapter_version ?? CLINE_ADAPTER_VERSION;
  }

  /** V1 surface. */
  async start(input: StartInput): Promise<StartResult> {
    const handle = input.handle;
    if (!this.runs.has(handle)) {
      // Stub: record an empty run that will be populated
      // via `injectCapturedRun` for fixture replay.
      this.runs.set(handle, {
        handle,
        identity: this.qualification_,
        capabilities: this.caps_,
        command: [],
        env: {},
        cwd: ".",
        started_at_ms: null,
        timeout_ms: null,
        process_spawned: false,
        process_exit_code: null,
        process_exit_signal: null,
        cancel_requested: false,
        timeout_initiated: false,
        external_kill_used: false,
        native_abort_observed: false,
        exit_at_ms: null,
        stdout_lines: [],
        stderr_lines: [],
        native_events: [],
        raw_events: [],
        state: "starting",
        adapter_errors: [],
        cleaned: false,
      });
    }
    return { ok: true };
  }

  /** V1 surface. */
  async *events(handle: HarnessHandle): AsyncIterable<HarnessEvent> {
    const run = this.runs.get(handle);
    if (!run) {
      throw new Error(`ClineAdapter: no run for handle ${handle}`);
    }
    run.state = "running";
    yield { type: "candidate_started", attemptId: handle };
    for (const line of run.raw_events) {
      const result = decodeClineEvent(handle, line);
      if (result.event !== null) {
        yield result.event;
      }
    }
    if (run.process_exit_code === 0) {
      run.state = "completed";
    } else {
      run.state = "errored";
    }
  }

  /** V1 surface. */
  async interrupt(handle: HarnessHandle): Promise<InterruptResult> {
    const run = this.runs.get(handle);
    if (!run) return { ok: false, reason: `no run for handle ${handle}` };
    run.cancel_requested = true;
    run.external_kill_used = true;
    return { ok: true };
  }

  /** V1 surface. */
  async status(handle: HarnessHandle): Promise<HarnessStatus> {
    const run = this.runs.get(handle);
    if (!run) return { phase: "starting" };
    if (run.cancel_requested) {
      return { phase: "errored", reason: "interrupted" };
    }
    switch (run.state) {
      case "starting":
        return { phase: "starting" };
      case "running":
        return { phase: "running" };
      case "completed":
        return { phase: "completed" };
      case "errored":
        return { phase: "errored", reason: "process non-zero exit" };
    }
  }

  /** V2 surface. */
  identity(): HarnessIdentity {
    return {
      adapter_name: this.adapter_name,
      adapter_version: this.adapter_version,
      adapter_revision: null,
      qualification: this.qualification_,
      captured_at_ms: this.captured_at_ms,
    };
  }

  /** V2 surface. */
  capabilities(): HarnessCapabilities {
    return this.caps_;
  }

  /** V2 surface. */
  prepareRun(input: {
    readonly handle: HarnessHandle;
    readonly args: Readonly<Record<string, string>>;
    readonly cwd: string;
    readonly timeout_ms: number | null;
  }): PreparedHarnessRun {
    const cmd: string[] = [];
    cmd.push(
      this.qualification_.executable_path ?? "cline",
      "--json",
      "--cwd", input.cwd,
      "--prompt", (input.args["prompt"] ?? "") as string,
    );
    if (input.args["data_dir"] !== undefined) {
      cmd.push("--data-dir", input.args["data_dir"] as string);
    }
    if (input.args["model"] !== undefined) {
      cmd.push("--model", input.args["model"] as string);
    }
    if (input.args["auto_approve"] === "true") {
      cmd.push("--auto-approve");
    }
    if (input.timeout_ms !== null) {
      cmd.push("--timeout", String(input.timeout_ms));
    }
    return {
      handle: input.handle,
      identity: this.qualification_,
      capabilities: this.caps_,
      command: cmd,
      env: {},
      cwd: input.cwd,
      started_at_ms: null,
      timeout_ms: input.timeout_ms,
    };
  }

  /** V2 surface. */
  async requestCancel(handle: HarnessHandle): Promise<HarnessCancellationResult> {
    const run = this.runs.get(handle);
    if (!run) {
      return {
        cancel_requested: false,
        cancel_acknowledged: false,
        adapter_error: adapterError("START_FAILED", `no run for handle ${handle}`),
      };
    }
    run.cancel_requested = true;
    run.external_kill_used = true;
    return {
      cancel_requested: true,
      cancel_acknowledged: true,
      adapter_error: null,
    };
  }

  /** V2 surface. */
  async awaitExit(handle: HarnessHandle): Promise<HarnessProcessResult> {
    const run = this.runs.get(handle);
    if (!run) {
      return {
        process_spawned: false,
        process_exit_code: null,
        process_exit_signal: null,
        cancel_requested: false,
        timeout_initiated: false,
        external_kill_used: false,
        native_abort_observed: false,
        exit_at_ms: null,
        adapter_errors: [
          adapterError("START_FAILED", `no run for handle ${handle}`),
        ],
      };
    }
    return {
      process_spawned: run.process_spawned,
      process_exit_code: run.process_exit_code,
      process_exit_signal: run.process_exit_signal,
      cancel_requested: run.cancel_requested,
      timeout_initiated: run.timeout_initiated,
      external_kill_used: run.external_kill_used,
      native_abort_observed: run.native_abort_observed,
      exit_at_ms: run.exit_at_ms,
      adapter_errors: [...run.adapter_errors],
    };
  }

  /** V2 surface. */
  async collectArtifacts(handle: HarnessHandle): Promise<ReadonlyArray<HarnessRawArtifact>> {
    const run = this.runs.get(handle);
    if (!run) return [];
    const out: HarnessRawArtifact[] = [];
    out.push({
      kind: "STDOUT_LINES",
      name: "cline.stdout",
      captured_at_ms: run.exit_at_ms ?? this.captured_at_ms,
      text: run.stdout_lines.join("\n"),
    });
    out.push({
      kind: "STDERR_LINES",
      name: "cline.stderr",
      captured_at_ms: run.exit_at_ms ?? this.captured_at_ms,
      text: run.stderr_lines.join("\n"),
    });
    for (let i = 0; i < run.native_events.length; i++) {
      const ev = run.native_events[i]!;
      out.push({
        kind: "NATIVE_EVENT",
        name: `cline.event.${i}`,
        captured_at_ms: run.exit_at_ms ?? this.captured_at_ms,
        record: ev,
      });
    }
    return out;
  }

  /** V2 surface. */
  async cleanup(handle: HarnessHandle): Promise<void> {
    const run = this.runs.get(handle);
    if (!run) return;
    if (run.cleaned) return;
    run.cleaned = true;
    this.runs.delete(handle);
  }

  /**
   * Test-only / fixture-only injection path. Live Cline
   * capture will eventually go through `ingestLiveCapture`;
   * until Cline is installed on this host the live path
   * intentionally does not exist.
   */
  injectCapturedRun(input: {
    readonly handle: string;
    readonly stdout_lines: ReadonlyArray<string>;
    readonly stderr_lines: ReadonlyArray<string>;
    readonly raw_events: ReadonlyArray<string>;
    readonly process_exit_code: number | null;
    readonly process_exit_signal: string | null;
    readonly started_at_ms: number | null;
    readonly exit_at_ms: number | null;
    readonly native_events: ReadonlyArray<Readonly<Record<string, unknown>>>;
  }): HarnessHandle {
    const handle = makeHarnessHandle(input.handle);
    const run: ClineInternalRun = {
      handle,
      identity: this.qualification_,
      capabilities: this.caps_,
      command: [],
      env: {},
      cwd: ".",
      started_at_ms: input.started_at_ms,
      timeout_ms: null,
      process_spawned:
        input.stdout_lines.length > 0 || input.raw_events.length > 0,
      process_exit_code: input.process_exit_code,
      process_exit_signal: input.process_exit_signal,
      cancel_requested: false,
      timeout_initiated: false,
      external_kill_used: false,
      native_abort_observed: false,
      exit_at_ms: input.exit_at_ms,
      stdout_lines: [...input.stdout_lines],
      stderr_lines: [...input.stderr_lines],
      native_events: [...input.native_events],
      raw_events: [...input.raw_events],
      state: input.process_exit_code === 0 ? "completed" : "errored",
      adapter_errors: [],
      cleaned: false,
    };
    this.runs.set(handle, run);
    return handle;
  }

  /**
   * Live-capture entry. NOT YET CALLED: Cline / ClineMM is
   * not installed on this host. Documented here so the
   * V1 + V2 surfaces are identical between the two
   * adapters.
   */
  ingestLiveCapture(input: {
    readonly handle: string;
    readonly command: ReadonlyArray<string>;
    readonly env: Readonly<Record<string, string>>;
    readonly cwd: string;
    readonly stdout_lines: ReadonlyArray<string>;
    readonly stderr_lines: ReadonlyArray<string>;
    readonly raw_events: ReadonlyArray<string>;
    readonly process_exit_code: number | null;
    readonly process_exit_signal: string | null;
    readonly started_at_ms: number | null;
    readonly exit_at_ms: number | null;
    readonly native_events: ReadonlyArray<Readonly<Record<string, unknown>>>;
  }): HarnessHandle {
    const handle = makeHarnessHandle(input.handle);
    const run: ClineInternalRun = {
      handle,
      identity: this.qualification_,
      capabilities: this.caps_,
      command: redactPreparedRunArgv(input.command),
      env: redactPreparedRunEnv(input.env),
      cwd: input.cwd,
      started_at_ms: input.started_at_ms,
      timeout_ms: null,
      process_spawned: true,
      process_exit_code: input.process_exit_code,
      process_exit_signal: input.process_exit_signal,
      cancel_requested: false,
      timeout_initiated: false,
      external_kill_used: false,
      native_abort_observed: false,
      exit_at_ms: input.exit_at_ms,
      stdout_lines: [...input.stdout_lines],
      stderr_lines: [...input.stderr_lines],
      native_events: [...input.native_events],
      raw_events: [...input.raw_events],
      state: input.process_exit_code === 0 ? "completed" : "errored",
      adapter_errors: [],
      cleaned: false,
    };
    this.runs.set(handle, run);
    return handle;
  }
}

/**
 * Convenience constructor used by the discover path. Until
 * ClineMM is installed, all identity fields are null and the
 * adapter is recorded as UNQUALIFIED.
 */
export function makeClineAdapter(args: {
  readonly executable_path: string | null;
  readonly executable_sha256: string | null;
  readonly reported_cli_version: string | null;
  readonly captured_at_ms: number;
  readonly capabilities: HarnessCapabilities;
}): ClineAdapter {
  const id = clineQualificationIdentity({
    package_name: null,
    package_version: null,
    executable_path: args.executable_path,
    executable_sha256: args.executable_sha256,
    reported_cli_version: args.reported_cli_version,
  });
  return new ClineAdapter({
    qualification: id,
    capabilities: args.capabilities,
    captured_at_ms: args.captured_at_ms,
  });
}

/**
 * Build a default capability document for the Cline adapter
 * when the binary is unavailable. Every key is set to
 * UNQUALIFIED except the ones explicitly documented as
 * absent (UNAVAILABLE) — this prevents a "discovered" Cline
 * capability document from silently carrying SUPPORTED
 * flags without a probe having actually run.
 *
 * CORRECTION01 (H-C06, H-C07): Cline's HARNESS_CAPABILITY
 * axis is also UNQUALIFIED for every key until a real
 * binary is on disk; the LIVE_QUALIFICATION_STATE axis is
 * LIVE_HALT (HALT_CLINE_NOT_INSTALLED) for every key.
 */
export function defaultClineCapabilities(
  identity: HarnessQualificationIdentity,
  discovered_at_ms: number,
): HarnessCapabilities {
  const empty = emptyCapabilities(identity, discovered_at_ms);
  // For Cline we default UNQUALIFIED for every
  // HARNESS_CAPABILITY and LIVE_HALT for every
  // LIVE_QUALIFICATION_STATE because the binary is not
  // installed; the discover / probe layer upgrades
  // individual keys once a real binary is on disk.
  const capabilities: Record<keyof typeof empty.capabilities, CapabilityState> = {
    ...empty.capabilities,
  };
  const liveMap: Record<keyof typeof empty.live_qualification_by_key, LiveQualificationState> = {
    ...empty.live_qualification_by_key,
  };
  for (const k of CAPABILITY_KEYS) {
    liveMap[k] = "LIVE_HALT";
  }
  const axes: Record<keyof typeof empty.capability_axes, CapabilityAxis> = {
    ...empty.capability_axes,
  };
  for (const k of CAPABILITY_KEYS) {
    axes[k] = {
      harness_capability: capabilities[k],
      live_qualification: "LIVE_HALT",
      probe_evidence: null,
      probe_evidence_path: null,
      invocation_evidence_path: null,
    };
  }
  return {
    identity: empty.identity,
    discovered_at_ms: empty.discovered_at_ms,
    capabilities,
    live_qualification_by_key: liveMap,
    capability_axes: axes,
  };
}
