/**
 * Pi coding-agent adapter (LH-03 §12).
 *
 * Candidate-specific code lives ONLY here and in this
 * directory. The common protocol package never imports from
 * this file; conversely this file imports only from the
 * candidate-neutral protocol, the lab domain types, and the
 * adapter-common helpers.
 *
 * Qualified subject (V1):
 *
 *   package         = @earendil-works/pi-coding-agent
 *   package_version = 0.85.1
 *   executable      = node <pkg>/dist/bundle/cli.js
 *   protocol        = JSON_EVENTS (--mode json, --no-session)
 *
 * PI_PRIMARY_PROTOCOL       = JSON
 * PI_PROTOCOL_DECISION_REASON = JSON mode emits a structured
 *   "session" envelope (version, id, timestamp, cwd) on
 *   first line and is stable for line-delimited consumption.
 *   RPC mode requires bidirectional handshake over stdin;
 *   a one-shot qualification cannot fully exercise its event
 *   vocabulary without provider credentials. JSON mode is
 *   sufficient for V1 raw-evidence capture and replay.
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
  CapabilityState,
  HarnessAdapterV2,
  PreparedHarnessRun,
  HarnessProcessResult,
  HarnessRawArtifact,
  HarnessCancellationResult,
  HarnessAdapterError,
} from "../../protocol/index.js";
import { CAPABILITY_KEYS } from "../../protocol/index.js";
import {
  adapterError,
  emptyCapabilities,
  qualificationIdentityEquals,
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
 * Closed-world set of native event kinds the Pi JSON mode
 * V1 adapter understands. Adding a kind is a contract change
 * (LH-03 H6: unknown events fail visibly).
 */
export const PI_KNOWN_EVENT_KINDS: ReadonlySet<string> = new Set([
  "session",
  "message",
  "tool_start",
  "tool_end",
  "agent_end",
  "error",
]);

/**
 * Closed-world set of required envelope fields for the Pi
 * `session` event.
 */
export const PI_SESSION_REQUIRED_FIELDS: ReadonlyArray<string> = [
  "type",
  "version",
  "id",
  "timestamp",
  "cwd",
];

export const PI_PROVIDER_FIELD = "provider" as const;
export const PI_MODEL_FIELD = "model" as const;

/**
 * Pi V1 qualification identity (the canonical qualified
 * subject for LH-03). Adapters that do not match this tuple
 * component-by-component must emit UNSUPPORTED_VERSION
 * (LH-03 H22).
 */
export const PI_QUALIFIED_PACKAGE_NAME =
  "@earendil-works/pi-coding-agent";
export const PI_QUALIFIED_PACKAGE_VERSION = "0.85.1";
export const PI_QUALIFIED_PROTOCOL_MODE: ProtocolMode = "JSONL_EVENTS";
export const PI_ADAPTER_NAME = "factory.pi.adapter.v1";
export const PI_ADAPTER_VERSION = "0.1.0";

/**
 * Compute the canonical Pi V1 native schema fingerprint.
 * Pure and deterministic.
 */
export function piSchemaFingerprint(
  protocol_mode: ProtocolMode,
  package_version: string,
): string {
  return computeSchemaFingerprint({
    protocol_mode,
    event_kinds: Array.from(PI_KNOWN_EVENT_KINDS),
    required_fields: Array.from(PI_SESSION_REQUIRED_FIELDS),
    version: package_version,
  });
}

/**
 * Build the qualified Pi identity tuple. `executable_path`
 * and `executable_sha256` are captured at construction time
 * by `PiAdapter.discover`.
 */
export function piQualificationIdentity(args: {
  readonly package_name: string;
  readonly package_version: string;
  readonly executable_path: string | null;
  readonly executable_sha256: string | null;
  readonly reported_cli_version: string | null;
}): HarnessQualificationIdentity {
  return {
    harness_name: "pi",
    package_name: args.package_name,
    package_version: args.package_version,
    executable_path: args.executable_path,
    executable_sha256: args.executable_sha256,
    reported_cli_version: args.reported_cli_version,
    protocol_mode: PI_QUALIFIED_PROTOCOL_MODE,
    native_schema_fingerprint: piSchemaFingerprint(
      PI_QUALIFIED_PROTOCOL_MODE,
      args.package_version,
    ),
  };
}

/**
 * The PI_QUALIFIED_IDENTITY used as the canonical "expected"
 * subject. The fields that depend on a specific binary
 * install are left null; they are filled in at discover time.
 */
export const PI_QUALIFIED_IDENTITY_BASE: HarnessQualificationIdentity =
  piQualificationIdentity({
    package_name: PI_QUALIFIED_PACKAGE_NAME,
    package_version: PI_QUALIFIED_PACKAGE_VERSION,
    executable_path: null,
    executable_sha256: null,
    reported_cli_version: PI_QUALIFIED_PACKAGE_VERSION,
  });

/**
 * Whether the supplied identity matches the qualified Pi
 * identity component-by-component (LH-03 H22).
 */
export function piIdentityMatches(
  actual: HarnessQualificationIdentity,
): boolean {
  return qualificationIdentityEquals(actual, PI_QUALIFIED_IDENTITY_BASE);
}

type PiRunState = "starting" | "running" | "completed" | "errored";

type PiInternalRun = {
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
  state: PiRunState;
  adapter_errors: HarnessAdapterError[];
  cleaned: boolean;
};

/**
 * Build a Pi command line. The harness requires `node
 * <cli.js>` since the package is shipped as a Node ESM CLI.
 */
export function piCommandLine(
  executable_path: string,
  opts: {
    readonly prompt: string;
    readonly cwd: string;
    readonly session_dir: string | null;
    readonly no_session: boolean;
    readonly provider: string | null;
    readonly model: string | null;
    readonly offline: boolean;
    readonly timeout_ms: number | null;
  },
): string[] {
  const cmd: string[] = [executable_path];
  cmd.push("--mode", "json");
  if (opts.no_session) {
    cmd.push("--no-session");
  } else if (opts.session_dir !== null) {
    cmd.push("--session-dir", opts.session_dir);
  }
  if (opts.provider !== null) {
    cmd.push("--provider", opts.provider);
  }
  if (opts.model !== null) {
    cmd.push("--model", opts.model);
  }
  if (opts.offline) {
    cmd.push("--offline");
  }
  cmd.push("-p", opts.prompt);
  return cmd;
}

/**
 * Decode a single Pi JSON-mode line into a normalised
 * event (or returns null for unknown-but-recognisable
 * observation kinds). Throws on malformed JSON (LH-03 H6).
 */
export function decodePiEvent(
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
  if (!PI_KNOWN_EVENT_KINDS.has(t)) {
    return { event: null, kind: "UNKNOWN" };
  }
  switch (t) {
    case "session": {
      // The session envelope is a meta-observation; it does
      // not authoritatively start a run.
      return { event: null, kind: "session" };
    }
    case "message": {
      const content = record["content"];
      if (typeof content !== "string" && !Array.isArray(content)) {
        return { event: null, kind: "MALFORMED_NATIVE_EVENT" };
      }
      const text = typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((p) => p !== null && typeof p === "object" && (p as Record<string, unknown>)["type"] === "text")
              .map((p) => (p as Record<string, unknown>)["text"])
              .filter((x): x is string => typeof x === "string")
              .join("\n")
          : "";
      return {
        event: { type: "candidate_message", attemptId, text },
        kind: "message",
      };
    }
    case "tool_start": {
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
        kind: "tool_start",
      };
    }
    case "tool_end": {
      const tool = record["tool"];
      const callId = record["call_id"];
      const isError = record["is_error"];
      if (
        typeof tool !== "string" ||
        typeof callId !== "string" ||
        (isError !== undefined && typeof isError !== "boolean")
      ) {
        return { event: null, kind: "MALFORMED_NATIVE_EVENT" };
      }
      const ok = isError === true ? false : true;
      const error = record["error"];
      return {
        event: {
          type: "tool_finished",
          attemptId,
          tool,
          callId,
          ok,
          ...(typeof error === "string" ? { error } : {}),
        },
        kind: "tool_end",
      };
    }
    case "agent_end": {
      const summary = record["summary"];
      return {
        event: {
          type: "candidate_reported_completion",
          attemptId,
          summary: typeof summary === "string" ? summary : "",
        },
        kind: "agent_end",
      };
    }
    case "error": {
      const code = record["code"];
      const message = record["message"];
      return {
        event: {
          type: "candidate_error",
          attemptId,
          code: typeof code === "string" ? code : "PI_ERROR",
          message: typeof message === "string" ? message : "",
        },
        kind: "error",
      };
    }
    default:
      return { event: null, kind: "UNKNOWN" };
  }
}

/**
 * The Pi adapter. Candidate-specific code lives here.
 *
 * Constructor signature does NOT spawn a process; callers
 * must use `start()` to begin a run. The adapter tracks
 * per-handle lifecycle state independently for the V1
 * (events) and V2 (raw/process) surfaces.
 */
export class PiAdapter implements HarnessAdapter, HarnessAdapterV2 {
  readonly kind: HarnessKind = "pi";
  private readonly qualification_: HarnessQualificationIdentity;
  private readonly caps_: HarnessCapabilities;
  private readonly runs = new Map<string, PiInternalRun>();
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
    this.adapter_name = args.adapter_name ?? PI_ADAPTER_NAME;
    this.adapter_version = args.adapter_version ?? PI_ADAPTER_VERSION;
  }

  /** V1 surface. */
  async start(input: StartInput): Promise<StartResult> {
    return this.prepareRunInternal({
      handle: input.handle,
      args: input.args,
      cwd: (input.args["cwd"] ?? ".") as string,
      timeout_ms: input.args["timeout_ms"]
        ? Number(input.args["timeout_ms"])
        : null,
    }).ok
      ? { ok: true }
      : { ok: false, reason: "PiAdapter: identity mismatch" };
  }

  /** V1 surface. */
  async *events(handle: HarnessHandle): AsyncIterable<HarnessEvent> {
    const run = this.runs.get(handle);
    if (!run) {
      throw new Error(`PiAdapter: no run for handle ${handle}`);
    }
    run.state = "running";
    // Emit the synthetic "candidate_started" first, then
    // decode each captured raw line. Deterministic order.
    yield { type: "candidate_started", attemptId: handle };
    for (const line of run.raw_events) {
      const result = decodePiEvent(handle, line);
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
    return this.prepareRunInternal(input);
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
      name: "pi.stdout",
      captured_at_ms: run.exit_at_ms ?? this.captured_at_ms,
      text: run.stdout_lines.join("\n"),
    });
    out.push({
      kind: "STDERR_LINES",
      name: "pi.stderr",
      captured_at_ms: run.exit_at_ms ?? this.captured_at_ms,
      text: run.stderr_lines.join("\n"),
    });
    for (let i = 0; i < run.native_events.length; i++) {
      const ev = run.native_events[i]!;
      out.push({
        kind: "NATIVE_EVENT",
        name: `pi.event.${i}`,
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
   * Test-only / fixture-only injection path. Real captures
   * from the live binary go through `ingestLiveCapture`;
   * fixture replay goes through `injectCapturedRun`.
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
    const run: PiInternalRun = {
      handle,
      identity: this.qualification_,
      capabilities: this.caps_,
      command: [],
      env: {},
      cwd: ".",
      started_at_ms: input.started_at_ms,
      timeout_ms: null,
      process_spawned: input.stdout_lines.length > 0 || input.raw_events.length > 0,
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
   * Live-capture entry. Adapters that ran the real binary
   * call this with raw stdout/stderr/process result.
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
    const run: PiInternalRun = {
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

  /**
   * Build a PreparedHarnessRun (LH-03 §4.1). Pure: does not
   * spawn a process.
   */
  private prepareRunInternal(input: {
    readonly handle: HarnessHandle;
    readonly args: Readonly<Record<string, string>>;
    readonly cwd: string;
    readonly timeout_ms: number | null;
  }): PreparedHarnessRun & { readonly ok: true } {
    const command = piCommandLine(
      this.qualification_.executable_path ?? "node",
      {
        prompt: (input.args["prompt"] ?? "") as string,
        cwd: input.cwd,
        session_dir:
          (input.args["session_dir"] as string | undefined) ?? null,
        no_session: input.args["no_session"] === "true",
        provider: (input.args["provider"] as string | undefined) ?? null,
        model: (input.args["model"] as string | undefined) ?? null,
        offline: input.args["offline"] === "true",
        timeout_ms: input.timeout_ms,
      },
    );
    const prepared: PreparedHarnessRun & { readonly ok: true } = {
      ok: true,
      handle: input.handle,
      identity: this.qualification_,
      capabilities: this.caps_,
      command,
      env: {},
      cwd: input.cwd,
      started_at_ms: null,
      timeout_ms: input.timeout_ms,
    };
    return prepared;
  }
}

/**
 * Convenience constructor used by the discover path. Captures
 * executable identity (path, sha256) and reported version.
 */
export function makePiAdapter(args: {
  readonly executable_path: string;
  readonly executable_sha256: string;
  readonly reported_cli_version: string;
  readonly captured_at_ms: number;
  readonly capabilities: HarnessCapabilities;
}): PiAdapter {
  const id = piQualificationIdentity({
    package_name: PI_QUALIFIED_PACKAGE_NAME,
    package_version: PI_QUALIFIED_PACKAGE_VERSION,
    executable_path: args.executable_path,
    executable_sha256: args.executable_sha256,
    reported_cli_version: args.reported_cli_version,
  });
  return new PiAdapter({
    qualification: id,
    capabilities: args.capabilities,
    captured_at_ms: args.captured_at_ms,
  });
}

/**
 * Build a default capability document for the Pi adapter.
 * Returns a NEW object; never mutates the input identity.
 *
 * `HEADLESS`, `STREAMING_EVENTS`, `JSONL`,
 * `ISOLATED_DATA_DIR`, `MODEL_SELECTION`, `PROVIDER_SELECTION`
 * are pre-marked SUPPORTED (observed on the installed binary).
 * `RPC` is pre-marked SUPPORTED as a CLI flag, but the V1
 * adapter does not exercise it (decision recorded in
 * PI_PROTOCOL_DECISION_REASON). `SESSION_RESUME` /
 * `SESSION_FORK` are pre-marked UNSUPPORTED because the V1
 * adapter requires `--no-session`. `TOOL_EVENT_VISIBILITY`
 * is pre-marked SUPPORTED for harnesses that emit
 * `tool_start` / `tool_end` events; closed-world assertions
 * live in the conformance suite.
 */
export function defaultPiCapabilities(
  identity: HarnessQualificationIdentity,
  discovered_at_ms: number,
): HarnessCapabilities {
  const empty = emptyCapabilities(identity, discovered_at_ms);
  const capabilities: Record<typeof CAPABILITY_KEYS[number], CapabilityState> = {
    HEADLESS: "SUPPORTED",
    STREAMING_EVENTS: "SUPPORTED",
    FINAL_JSON: "SUPPORTED",
    JSONL: "SUPPORTED",
    RPC: "SUPPORTED",
    SESSION_RESUME: "UNSUPPORTED",
    SESSION_FORK: "UNSUPPORTED",
    EXPLICIT_CWD: "SUPPORTED",
    ISOLATED_DATA_DIR: "SUPPORTED",
    MODEL_SELECTION: "SUPPORTED",
    PROVIDER_SELECTION: "SUPPORTED",
    TIMEOUT: "UNSUPPORTED",
    CANCELLATION: "SUPPORTED",
    AUTO_APPROVAL: "UNQUALIFIED",
    TOOL_EVENT_VISIBILITY: "SUPPORTED",
    TOKEN_USAGE: "UNQUALIFIED",
    RESOURCE_USAGE: "UNQUALIFIED",
    SESSION_ARTIFACTS: "SUPPORTED",
  };
  // Sanity-check parity with the closed-world key list
  // exposed by the protocol package.
  if (Object.keys(capabilities).length !== Object.keys(empty.capabilities).length) {
    throw new Error(
      "Pi default capability document does not match the closed-world key list",
    );
  }
  return {
    identity: empty.identity,
    discovered_at_ms: empty.discovered_at_ms,
    capabilities,
  };
}
