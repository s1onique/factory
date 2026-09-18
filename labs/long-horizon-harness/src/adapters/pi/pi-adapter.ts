/**
 * Pi coding-agent adapter (LH-03 §12, LH-03 CORRECTION01).
 *
 * Candidate-specific code lives ONLY here and in this
 * directory. The common protocol package never imports from
 * this file; conversely this file imports only from the
 * candidate-neutral protocol, the lab domain types, and the
 * adapter-common helpers.
 *
 * Qualified subject (V1) — bound to the real installed
 * Pi 0.85.1 binary on this host:
 *
 *   package          = @earendil-works/pi-coding-agent
 *   package_version  = 0.85.1
 *   executable       = /tmp/npm-prefix/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
 *   executable_sha256 = e6d7fcf36a239cf3746e67ddf4222081ac01a601b85a3ee688bdfe9c161d754c
 *   protocol         = JSONL_EVENTS
 *
 * CORRECTION01:
 *   - Schema is built from the real installed Pi protocol
 *     types (dist/core/agent-session.d.ts +
 *      dist/modes/json-event.d.ts +
 *      dist/core/session-manager.d.ts).
 *   - PiCompatibilityConstraint is separated from
 *     HarnessQualificationIdentity; the qualified installation
 *     record additionally binds executable_path + sha256.
 *   - Decoder violations route through adapter_errors AND
 *     through the events() generator as candidate_error
 *     events; NEVER silently dropped.
 *   - ingestLiveCapture redacts stdout/stderr/raw/native
 *     BEFORE they become durable; collectArtifacts() can
 *     only emit sanitized material.
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
  CapabilityAxis,
  CapabilityKey,
  CapabilityProbeEvidence,
  LiveQualificationState,
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
  inspectOwnProperties,
  isPlainString,
  isNonNegativeInt,
} from "../../adapter-common/hostile-object.js";
import {
  redactPreparedRunEnv,
  redactPreparedRunArgv,
  redactNativeLine,
  redactNativeEvent,
  redactStringValue,
} from "../../redaction/secret-redaction.js";
import {
  artifactSha256,
  readJsonlFirstLine,
  readJsonObject,
  buildProbeEvidence,
  haltProbeEvidence,
  buildIsolatedDataDirEvidence,
} from "../../adapter-common/index.js";


/* ------------------------------------------------------------------ *
 * CORRECTION01 — Native event classification.                         *
 * ------------------------------------------------------------------ */

/**
 * Classification of a known native event kind.
 */
export type PiEventClassification =
  | "NORMALIZED_EVENT"
  | "PRESERVED_META_OBSERVATION"
  | "KNOWN_BUT_UNMAPPED";

/**
 * Real Pi 0.85.1 native event kinds (see H-C01).
 *
 * Sourced from:
 *   - `dist/core/agent-session.d.ts`        (AgentSessionEvent union)
 *   - `dist/modes/json-event.d.ts`          (JsonAgentSessionEvent shape)
 *   - `dist/core/session-manager.d.ts`      (SessionHeader)
 */
export const PI_NATIVE_EVENT_KINDS = [
  "session",
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "agent_settled",
  "queue_update",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
  "entry_appended",
  "session_info_changed",
  "thinking_level_changed",
  "summarization_retry_scheduled",
  "summarization_retry_attempt_start",
  "summarization_retry_finished",
  "bash_execution_update",
] as const;

export type PiNativeEventKind = typeof PI_NATIVE_EVENT_KINDS[number];

/**
 * Closed-world set of native kinds the V1 adapter knows
 * about. Unknown kinds remain fail-visible (decoder returns
 * UNKNOWN; adapter records UNKNOWN_NATIVE_EVENT).
 */
export const PI_KNOWN_EVENT_KINDS: ReadonlySet<string> = new Set<string>(
  PI_NATIVE_EVENT_KINDS,
);

/**
 * V1-mapped subset.
 */
export const PI_NORMALIZED_EVENT_KINDS: ReadonlySet<string> = new Set<string>([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_end",
  "tool_execution_start",
  "tool_execution_end",
]);

/**
 * Subset of PI_KNOWN_EVENT_KINDS that are preserved as
 * meta-observations (not normalised to a HarnessEvent,
 * but carried by the adapter for the live-capture path).
 */
export const PI_PRESERVED_META_KINDS: ReadonlySet<string> = new Set<string>([
  "session",
  "message_update",
]);

/**
 * Classification table for every known kind.
 */
export const PI_EVENT_CLASSIFICATION: Readonly<
  Record<PiNativeEventKind, PiEventClassification>
> = Object.freeze({
  session: "PRESERVED_META_OBSERVATION",
  agent_start: "NORMALIZED_EVENT",
  agent_end: "NORMALIZED_EVENT",
  turn_start: "NORMALIZED_EVENT",
  turn_end: "NORMALIZED_EVENT",
  message_start: "NORMALIZED_EVENT",
  message_update: "PRESERVED_META_OBSERVATION",
  message_end: "NORMALIZED_EVENT",
  tool_execution_start: "NORMALIZED_EVENT",
  tool_execution_update: "KNOWN_BUT_UNMAPPED",
  tool_execution_end: "NORMALIZED_EVENT",
  agent_settled: "KNOWN_BUT_UNMAPPED",
  queue_update: "KNOWN_BUT_UNMAPPED",
  compaction_start: "KNOWN_BUT_UNMAPPED",
  compaction_end: "KNOWN_BUT_UNMAPPED",
  auto_retry_start: "KNOWN_BUT_UNMAPPED",
  auto_retry_end: "KNOWN_BUT_UNMAPPED",
  entry_appended: "KNOWN_BUT_UNMAPPED",
  session_info_changed: "KNOWN_BUT_UNMAPPED",
  thinking_level_changed: "KNOWN_BUT_UNMAPPED",
  summarization_retry_scheduled: "KNOWN_BUT_UNMAPPED",
  summarization_retry_attempt_start: "KNOWN_BUT_UNMAPPED",
  summarization_retry_finished: "KNOWN_BUT_UNMAPPED",
  bash_execution_update: "KNOWN_BUT_UNMAPPED",
});

/**
 * Required envelope fields for the `session` header.
 */
export const PI_SESSION_REQUIRED_FIELDS: ReadonlyArray<string> = [
  "type",
  "version",
  "id",
  "timestamp",
  "cwd",
];


/**
 * Closed-world admitted key sets per native kind (H-C04).
 */
export const PI_ADMITTED_KEYS: Readonly<
  Record<PiNativeEventKind, ReadonlySet<string>>
> = Object.freeze({
  session: new Set(["type", "version", "id", "timestamp", "cwd", "parentSession"]),
  agent_start: new Set(["type"]),
  agent_end: new Set(["type", "messages", "willRetry"]),
  turn_start: new Set(["type"]),
  turn_end: new Set(["type", "message", "toolResults"]),
  message_start: new Set(["type", "message"]),
  message_update: new Set(["type", "usage", "assistantMessageEvent"]),
  message_end: new Set(["type", "message"]),
  tool_execution_start: new Set(["type", "toolCallId", "toolName", "args"]),
  tool_execution_update: new Set(["type", "toolCallId", "toolName", "args", "partialResult"]),
  tool_execution_end: new Set(["type", "toolCallId", "toolName", "result", "isError"]),
  agent_settled: new Set(["type"]),
  queue_update: new Set(["type", "steering", "followUp"]),
  compaction_start: new Set(["type", "reason"]),
  compaction_end: new Set(["type", "reason", "result", "aborted", "willRetry", "errorMessage"]),
  auto_retry_start: new Set(["type", "attempt", "maxAttempts", "delayMs", "errorMessage"]),
  auto_retry_end: new Set(["type", "success", "attempt", "finalError"]),
  entry_appended: new Set(["type", "entry"]),
  session_info_changed: new Set(["type", "name"]),
  thinking_level_changed: new Set(["type", "level"]),
  summarization_retry_scheduled: new Set(["type", "attempt", "maxAttempts", "delayMs", "errorMessage"]),
  summarization_retry_attempt_start: new Set(["type", "source", "reason"]),
  summarization_retry_finished: new Set(["type"]),
  bash_execution_update: new Set(["type", "id", "delta"]),
});

export const PI_PROVIDER_FIELD = "provider" as const;
export const PI_MODEL_FIELD = "model" as const;

/* ------------------------------------------------------------------ *
 * CORRECTION01 — PiCompatibilityConstraint + qualified identity.     *
 * ------------------------------------------------------------------ */

/**
 * Compatibility constraint pinned by the qualified Pi
 * adapter (LH-03 CORRECTION01 H-C02).
 *
 * Separated from `HarnessQualificationIdentity` because the
 * constraint pins the COMPATIBILITY WINDOW (what builds are
 * acceptable) while the identity records the OBSERVED INSTALL
 * (what build was actually used in this qualification campaign).
 */
export type PiCompatibilityConstraint = {
  readonly harness_name: HarnessKind;
  readonly package_name: string;
  readonly package_version: string;
  readonly reported_cli_version: string;
  readonly protocol_mode: ProtocolMode;
  readonly expected_native_schema_fingerprint: string;
};

/**
 * Pi V1 qualification identity bindings (LH-03 CORRECTION01 H-C02).
 */
export const PI_QUALIFIED_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
export const PI_QUALIFIED_PACKAGE_VERSION = "0.85.1";
export const PI_QUALIFIED_REPORTED_CLI_VERSION = "0.85.1";
export const PI_QUALIFIED_PROTOCOL_MODE: ProtocolMode = "JSONL_EVENTS";
export const PI_QUALIFIED_EXECUTABLE_PATH =
  "/tmp/npm-prefix/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js";
export const PI_QUALIFIED_EXECUTABLE_SHA256 =
  "e6d7fcf36a239cf3746e67ddf4222081ac01a601b85a3ee688bdfe9c161d754c";
export const PI_ADAPTER_NAME = "factory.pi.adapter.v1";
export const PI_ADAPTER_VERSION = "0.2.0";

/**
 * Compute the canonical Pi 0.85.1 native schema fingerprint
 * from the real native kind set + required envelope fields.
 */
export function piSchemaFingerprint(
  protocol_mode: ProtocolMode,
  package_version: string,
): string {
  return computeSchemaFingerprint({
    protocol_mode,
    event_kinds: PI_NATIVE_EVENT_KINDS as readonly string[],
    required_fields: PI_SESSION_REQUIRED_FIELDS,
    version: package_version,
  });
}

/**
 * Build the qualified Pi identity tuple (H-C02).
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
 * The concrete qualified Pi identity record (H-C02).
 *
 * Binds EVERY component of the 8-tuple to the captured
 * binary on this host. `piIdentityMatches` uses THIS record
 * as the equality oracle (not a null-paths base).
 */
export const QUALIFIED_PI_IDENTITY: HarnessQualificationIdentity = Object.freeze(
  piQualificationIdentity({
    package_name: PI_QUALIFIED_PACKAGE_NAME,
    package_version: PI_QUALIFIED_PACKAGE_VERSION,
    executable_path: PI_QUALIFIED_EXECUTABLE_PATH,
    executable_sha256: PI_QUALIFIED_EXECUTABLE_SHA256,
    reported_cli_version: PI_QUALIFIED_REPORTED_CLI_VERSION,
  }),
);

/**
 * The compatibility constraint (H-C02).
 */
export const PI_COMPATIBILITY_CONSTRAINT: PiCompatibilityConstraint = Object.freeze({
  harness_name: "pi",
  package_name: PI_QUALIFIED_PACKAGE_NAME,
  package_version: PI_QUALIFIED_PACKAGE_VERSION,
  reported_cli_version: PI_QUALIFIED_REPORTED_CLI_VERSION,
  protocol_mode: PI_QUALIFIED_PROTOCOL_MODE,
  expected_native_schema_fingerprint:
    QUALIFIED_PI_IDENTITY.native_schema_fingerprint ?? "",
});

/**
 * Whether the supplied identity matches the concrete
 * qualified Pi identity record (H-C02).
 */
export function piIdentityMatches(
  actual: HarnessQualificationIdentity,
): boolean {
  return qualificationIdentityEquals(actual, QUALIFIED_PI_IDENTITY);
}

function admittedKeysFor(kind: string): ReadonlySet<string> | null {
  if (PI_KNOWN_EVENT_KINDS.has(kind)) {
    return PI_ADMITTED_KEYS[kind as PiNativeEventKind];
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Decoder (per-kind hostile validation + V1 mapping).                *
 * ------------------------------------------------------------------ */

/**
 * Result of decoding a single Pi JSON-mode line.
 *
 *   classification = "NORMALIZED"           — event is a HarnessEvent
 *   classification = "META_OBSERVATION"     — known, preserved, not a HarnessEvent
 *   classification = "KNOWN_BUT_UNMAPPED"   — known, no V1 mapping, not a HarnessEvent
 *   classification = "UNKNOWN"              — kind not in PI_KNOWN_EVENT_KINDS
 *   classification = "MALFORMED"            — parse / hostile property / wrong shape
 */
export type PiDecodeResult =
  | {
      readonly event: HarnessEvent;
      readonly classification: "NORMALIZED";
      readonly kind: string;
    }
  | {
      readonly event: null;
      readonly classification: "META_OBSERVATION" | "KNOWN_BUT_UNMAPPED";
      readonly kind: string;
    }
  | {
      readonly event: null;
      readonly classification: "UNKNOWN";
      readonly kind: string;
      readonly hostile_reason: "unknown_kind";
    }
  | {
      readonly event: null;
      readonly classification: "MALFORMED";
      readonly kind: "MALFORMED_NATIVE_EVENT";
      readonly hostile_reason:
        | "parse_failed"
        | "not_record"
        | "missing_type"
        | "wrong_type"
        | "extra_own_key"
        | "symbol_own_key"
        | "accessor_own_key"
        | "non_enumerable_own_key"
        | "missing_required_field"
        | "wrong_field_type";
    };

/**
 * Decode a single Pi JSON-mode line (H-C04 closed-world).
 */
export function decodePiEvent(
  attemptId: string,
  line: string,
): PiDecodeResult {
  const parsed = parseNativeLine(line);
  if (!parsed.ok) {
    return {
      event: null,
      classification: "MALFORMED",
      kind: "MALFORMED_NATIVE_EVENT",
      hostile_reason: "parse_failed",
    };
  }
  if (!isRecord(parsed.value)) {
    return {
      event: null,
      classification: "MALFORMED",
      kind: "MALFORMED_NATIVE_EVENT",
      hostile_reason: "not_record",
    };
  }
  const record = parsed.value;
  const t = record["type"];
  if (typeof t !== "string") {
    return {
      event: null,
      classification: "MALFORMED",
      kind: "MALFORMED_NATIVE_EVENT",
      hostile_reason: typeof t === "undefined" ? "missing_type" : "wrong_type",
    };
  }

  if (!PI_KNOWN_EVENT_KINDS.has(t)) {
    return {
      event: null,
      classification: "UNKNOWN",
      kind: t,
      hostile_reason: "unknown_kind",
    };
  }

  const admitted = admittedKeysFor(t);
  if (admitted !== null) {
    const hostile = inspectOwnProperties(record, admitted);
    if (!hostile.ok) {
      return {
        event: null,
        classification: "MALFORMED",
        kind: "MALFORMED_NATIVE_EVENT",
        hostile_reason:
          hostile.violation.kind === "extra_string_key"
            ? "extra_own_key"
            : hostile.violation.kind === "symbol_own_key"
              ? "symbol_own_key"
              : hostile.violation.kind === "accessor_own_key"
                ? "accessor_own_key"
                : "non_enumerable_own_key",
      };
    }
  }

  const shape = validateKindShape(t, record);
  if (!shape.ok) {
    return {
      event: null,
      classification: "MALFORMED",
      kind: "MALFORMED_NATIVE_EVENT",
      hostile_reason: shape.hostile_reason,
    };
  }

  const kindClassification = PI_EVENT_CLASSIFICATION[t as PiNativeEventKind];
  switch (kindClassification) {
    case "NORMALIZED_EVENT":
      return normalizeEvent(attemptId, t, record);
    case "PRESERVED_META_OBSERVATION":
      return { event: null, classification: "META_OBSERVATION", kind: t };
    case "KNOWN_BUT_UNMAPPED":
      return { event: null, classification: "KNOWN_BUT_UNMAPPED", kind: t };
  }
}

/**
 * Closed-world per-kind shape validation.
 */
type ShapeOk = { readonly ok: true };
type ShapeFail = {
  readonly ok: false;
  readonly hostile_reason: "missing_required_field" | "wrong_field_type";
};
type ShapeResult = ShapeOk | ShapeFail;

function validateKindShape(
  kind: string,
  record: Readonly<Record<string, unknown>>,
): ShapeResult {
  switch (kind) {
    case "session": {
      for (const f of PI_SESSION_REQUIRED_FIELDS) {
        if (!(f in record)) {
          return { ok: false, hostile_reason: "missing_required_field" };
        }
      }
      if (typeof record["id"] !== "string") return failType();
      if (typeof record["timestamp"] !== "string") return failType();
      if (typeof record["cwd"] !== "string") return failType();
      if (
        record["version"] !== undefined &&
        typeof record["version"] !== "number"
      ) {
        return failType();
      }
      if (
        record["parentSession"] !== undefined &&
        typeof record["parentSession"] !== "string"
      ) {
        return failType();
      }
      return { ok: true };
    }
    case "agent_start":
    case "turn_start":
    case "agent_settled":
    case "summarization_retry_finished":
      return { ok: true };
    case "agent_end":
      if ("messages" in record && !Array.isArray(record["messages"])) return failType();
      if ("willRetry" in record && typeof record["willRetry"] !== "boolean") return failType();
      return { ok: true };
    case "turn_end":
      if ("message" in record && (typeof record["message"] !== "object" || record["message"] === null)) return failType();
      if ("toolResults" in record && !Array.isArray(record["toolResults"])) return failType();
      return { ok: true };
    case "message_start":
    case "message_end":
      if (!("message" in record)) {
        return { ok: false, hostile_reason: "missing_required_field" };
      }
      if (typeof record["message"] !== "object" || record["message"] === null) return failType();
      return { ok: true };
    case "message_update":
      if (!("assistantMessageEvent" in record)) {
        return { ok: false, hostile_reason: "missing_required_field" };
      }
      if (
        typeof record["assistantMessageEvent"] !== "object" ||
        record["assistantMessageEvent"] === null ||
        Array.isArray(record["assistantMessageEvent"])
      ) return failType();
      if ("usage" in record) {
        const u = record["usage"];
        if (typeof u !== "object" || u === null || Array.isArray(u)) return failType();
      }
      return { ok: true };
    case "tool_execution_start":
    case "tool_execution_update":
      return requireStringFields(record, ["toolCallId", "toolName"]);
    case "tool_execution_end":
      if (!requireStringFields(record, ["toolCallId", "toolName"]).ok) return failType();
      if ("isError" in record && typeof record["isError"] !== "boolean") return failType();
      return { ok: true };
    case "queue_update":
      if ("steering" in record && !Array.isArray(record["steering"])) return failType();
      if ("followUp" in record && !Array.isArray(record["followUp"])) return failType();
      return { ok: true };
    case "compaction_start":
      if (!isPlainString(record["reason"]) && record["reason"] !== undefined) return failType();
      return { ok: true };
    case "compaction_end":
      if (
        "result" in record && record["result"] !== undefined &&
        (typeof record["result"] !== "object" || record["result"] === null)
      ) return failType();
      if ("aborted" in record && typeof record["aborted"] !== "boolean") return failType();
      if ("willRetry" in record && typeof record["willRetry"] !== "boolean") return failType();
      if (
        "errorMessage" in record && record["errorMessage"] !== undefined &&
        typeof record["errorMessage"] !== "string"
      ) return failType();
      return { ok: true };
    case "auto_retry_start":
    case "summarization_retry_scheduled":
      if (!isNonNegativeInt(record["attempt"])) return failType();
      if (!isNonNegativeInt(record["maxAttempts"])) return failType();
      if (typeof record["delayMs"] !== "number") return failType();
      if (typeof record["errorMessage"] !== "string") return failType();
      return { ok: true };
    case "auto_retry_end":
      if (typeof record["success"] !== "boolean") return failType();
      if (!isNonNegativeInt(record["attempt"])) return failType();
      if (
        "finalError" in record && record["finalError"] !== undefined &&
        typeof record["finalError"] !== "string"
      ) return failType();
      return { ok: true };
    case "entry_appended":
      if (typeof record["entry"] !== "object" || record["entry"] === null) return failType();
      return { ok: true };
    case "session_info_changed":
      if (
        "name" in record && record["name"] !== undefined &&
        typeof record["name"] !== "string"
      ) return failType();
      return { ok: true };
    case "thinking_level_changed":
      if (typeof record["level"] !== "string") return failType();
      return { ok: true };
    case "summarization_retry_attempt_start":
      if (typeof record["source"] !== "string") return failType();
      if (
        "reason" in record && record["reason"] !== undefined &&
        typeof record["reason"] !== "string"
      ) return failType();
      return { ok: true };
    case "bash_execution_update":
      if ("id" in record && record["id"] !== undefined && typeof record["id"] !== "string") return failType();
      if (typeof record["delta"] !== "string") return failType();
      return { ok: true };
    default:
      return { ok: false, hostile_reason: "missing_required_field" };
  }
}

function requireStringFields(
  record: Readonly<Record<string, unknown>>,
  fields: ReadonlyArray<string>,
): ShapeResult {
  for (const f of fields) {
    if (!(f in record)) return { ok: false, hostile_reason: "missing_required_field" };
    if (typeof record[f] !== "string") return failType();
  }
  return { ok: true };
}

function failType(): ShapeFail {
  return { ok: false, hostile_reason: "wrong_field_type" };
}

/**
 * Normalise a known native event to a HarnessEvent.
 */
function normalizeEvent(
  attemptId: string,
  kind: string,
  record: Readonly<Record<string, unknown>>,
): PiDecodeResult {
  switch (kind) {
    case "agent_start":
      return {
        event: { type: "candidate_started", attemptId },
        classification: "NORMALIZED",
        kind,
      };
    case "agent_end":
      return {
        event: {
          type: "candidate_reported_completion",
          attemptId,
          summary: agentEndSummary(record),
        },
        classification: "NORMALIZED",
        kind,
      };
    case "turn_start":
    case "turn_end":
      return {
        event: { type: "candidate_message", attemptId, text: "" },
        classification: "NORMALIZED",
        kind,
      };
    case "message_start":
    case "message_end": {
      const message = record["message"];
      const text = extractMessageText(message);
      return {
        event: { type: "candidate_message", attemptId, text },
        classification: "NORMALIZED",
        kind,
      };
    }
    case "tool_execution_start": {
      const toolCallId = record["toolCallId"] as string;
      const toolName = record["toolName"] as string;
      return {
        event: { type: "tool_started", attemptId, tool: toolName, callId: toolCallId },
        classification: "NORMALIZED",
        kind,
      };
    }
    case "tool_execution_end": {
      const toolCallId = record["toolCallId"] as string;
      const toolName = record["toolName"] as string;
      const isError = record["isError"] === true;
      return {
        event: {
          type: "tool_finished",
          attemptId,
          tool: toolName,
          callId: toolCallId,
          ok: !isError,
        },
        classification: "NORMALIZED",
        kind,
      };
    }
    default:
      return {
        event: null,
        classification: "KNOWN_BUT_UNMAPPED",
        kind,
      };
  }
}

function extractMessageText(message: unknown): string {
  if (typeof message === "string") return message;
  if (message === null || typeof message !== "object") return "";
  const m = message as Record<string, unknown>;
  const content = m["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (p) =>
        p !== null &&
        typeof p === "object" &&
        (p as Record<string, unknown>)["type"] === "text",
    )
    .map((p) => (p as Record<string, unknown>)["text"])
    .filter((x): x is string => typeof x === "string")
    .join("\n");
}

function agentEndSummary(record: Readonly<Record<string, unknown>>): string {
  const messages = record["messages"];
  if (!Array.isArray(messages)) return "";
  const last = messages[messages.length - 1] as unknown;
  return extractMessageText(last);
}

type PiRunState = "starting" | "running" | "completed" | "errored";

export type PiNormalizationDisposition =
  | "NORMALIZATION_COMPLETE"
  | "NORMALIZATION_INCOMPLETE";

type PiInternalClassification = {
  readonly line: number;
  readonly classification: PiDecodeResult["classification"];
  readonly kind: string;
  readonly hostile_reason?: string;
};

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
  classifications: PiInternalClassification[];
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
    const prepared = this.prepareRunInternal({
      handle: input.handle,
      args: input.args,
      cwd: (input.args["cwd"] ?? ".") as string,
      timeout_ms: input.args["timeout_ms"]
        ? Number(input.args["timeout_ms"])
        : null,
    });
    return prepared.ok
      ? { ok: true }
      : { ok: false, reason: "PiAdapter: identity mismatch" };
  }

  /**
   * V1 surface. CORRECTION01 H-C03: UNKNOWN / MALFORMED
   * events are NOT silently dropped because `event === null`.
   * The generator emits a candidate_error so the run
   * projector records the failure.
   *
   * CORRECTION02 (C02-03): `events()` is now a PURE
   * projection over the durable classification log. It
   * NEVER mutates `run.adapter_errors`. Classification
   * happens exactly once at durable ingest (in
   * `injectCapturedRun`/`ingestLiveCapture`), so
   *
   *   ONE_RAW_PROTOCOL_VIOLATION
   *     =>
   *   ONE_DURABLE_ADAPTER_ERROR
   *
   * Repeatedly consuming `events()` yields the same event
   * stream and does NOT add new adapter_errors. The
   * generator is observationally pure (modulo `state`
   * transitions, which are idempotent).
   */
  async *events(handle: HarnessHandle): AsyncIterable<HarnessEvent> {
    const run = this.runs.get(handle);
    if (!run) {
      throw new Error(`PiAdapter: no run for handle ${handle}`);
    }
    run.state = "running";
    yield { type: "candidate_started", attemptId: handle };
    // Re-decode from `run.raw_events` to emit a HarnessEvent
    // for every NORMALIZED classification. Decoder output is
    // deterministic; this is a pure projection.
    for (const raw of run.raw_events) {
      const result = decodePiEvent(handle, raw);
      if (result.classification === "NORMALIZED" && result.event !== null) {
        yield result.event;
      }
    }
    // For every UNKNOWN/MALFORMED classification recorded
    // at durable ingest time, yield a candidate_error.
    // These do NOT mutate `adapter_errors`; they project the
    // existing classifications back through the event
    // channel.
    for (const c of run.classifications) {
      if (c.classification === "MALFORMED" || c.classification === "UNKNOWN") {
        const code = c.classification === "MALFORMED"
          ? "MALFORMED_NATIVE_EVENT"
          : "UNKNOWN_NATIVE_EVENT";
        yield {
          type: "candidate_error",
          attemptId: handle,
          code,
          message: `line ${c.line} ${code} (kind=${c.kind}, reason=${c.hostile_reason ?? "n/a"})`,
        };
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
    if (run.cancel_requested) return { phase: "errored", reason: "interrupted" };
    switch (run.state) {
      case "starting": return { phase: "starting" };
      case "running": return { phase: "running" };
      case "completed": return { phase: "completed" };
      case "errored": return { phase: "errored", reason: "process non-zero exit" };
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
        adapter_errors: [adapterError("START_FAILED", `no run for handle ${handle}`)],
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

  /**
   * V2 surface. Returns only sanitized material; raw
   * values were redacted at the live-capture seam (H-C05).
   *
   * CORRECTION01: surfaces redacted argv and env as
   * RAW_ARGV / RAW_ENV artifacts so the live-capture
   * secret-leak oracle can inspect them.
   */
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
    out.push({
      kind: "RAW_ARGV",
      name: "pi.argv",
      captured_at_ms: run.exit_at_ms ?? this.captured_at_ms,
      argv: [...run.command],
    });
    out.push({
      kind: "RAW_ENV",
      name: "pi.env",
      captured_at_ms: run.exit_at_ms ?? this.captured_at_ms,
      env: { ...run.env },
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
   * Per-run normalization completeness (H-C03).
   *
   * NORMALIZATION_COMPLETE   — every line classified
   *                            NORMALIZED / META_OBSERVATION
   *                            / KNOWN_BUT_UNMAPPED.
   * NORMALIZATION_INCOMPLETE — at least one UNKNOWN or
   *                            MALFORMED.
   */
  normalizationCompleteness(handle: HarnessHandle): PiNormalizationDisposition {
    const run = this.runs.get(handle);
    if (!run) return "NORMALIZATION_INCOMPLETE";
    for (const c of run.classifications) {
      if (
        c.classification === "UNKNOWN" ||
        c.classification === "MALFORMED"
      ) {
        return "NORMALIZATION_INCOMPLETE";
      }
    }
    return "NORMALIZATION_COMPLETE";
  }

  /**
   * Per-run decoder-classification log.
   */
  classificationLog(handle: HarnessHandle): ReadonlyArray<PiInternalClassification> {
    const run = this.runs.get(handle);
    if (!run) return [];
    return [...run.classifications];
  }

  /**
   * Test-only / fixture-only injection path. NO live
   * redaction happens here — callers (typically test
   * fixtures) own the inputs and are expected to pre-redact.
   * Real captures from the live binary go through
   * `ingestLiveCapture`, which DOES redact.
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
    const classifications: PiInternalClassification[] = [];
    for (let i = 0; i < input.raw_events.length; i++) {
      const r = decodePiEvent(handle, input.raw_events[i]!);
      const entry: PiInternalClassification = {
        line: i + 1,
        classification: r.classification,
        kind: r.kind,
        ...(r.classification === "MALFORMED" || r.classification === "UNKNOWN"
          ? { hostile_reason: r.hostile_reason }
          : {}),
      };
      classifications.push(entry);
    }
    const adapter_errors: HarnessAdapterError[] = [];
    for (const c of classifications) {
      if (c.classification === "MALFORMED") {
        adapter_errors.push(adapterError("MALFORMED_NATIVE_EVENT", JSON.stringify(c)));
      } else if (c.classification === "UNKNOWN") {
        adapter_errors.push(adapterError("UNKNOWN_NATIVE_EVENT", JSON.stringify(c)));
      }
    }
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
      adapter_errors,
      classifications,
      cleaned: false,
    };
    this.runs.set(handle, run);
    return handle;
  }

  /**
   * Live-capture entry (H-C05). ALL durable state is
   * redacted here BEFORE it lands in the run record:
   *
   *   - stdout_lines       -> redactNativeLine
   *   - stderr_lines       -> redactNativeLine
   *   - raw_events         -> redactNativeLine
   *   - native_events      -> redactNativeEvent
   *   - argv               -> redactPreparedRunArgv
   *   - env                -> redactPreparedRunEnv
   *   - cwd                -> redactStringValue
   *
   * Callers' objects are NEVER mutated.
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
    const redactedCommand = redactPreparedRunArgv(input.command);
    const redactedEnv = redactPreparedRunEnv(input.env);
    const redactedCwd = redactStringValue(input.cwd);
    const redactedStdout = input.stdout_lines.map((l) => redactNativeLine(l));
    const redactedStderr = input.stderr_lines.map((l) => redactNativeLine(l));
    const redactedRaw = input.raw_events.map((l) => redactNativeLine(l));
    const redactedNative = input.native_events.map((e) => redactNativeEvent(e));
    const classifications: PiInternalClassification[] = [];
    for (let i = 0; i < redactedRaw.length; i++) {
      const r = decodePiEvent(handle, redactedRaw[i]!);
      const entry: PiInternalClassification = {
        line: i + 1,
        classification: r.classification,
        kind: r.kind,
        ...(r.classification === "MALFORMED" || r.classification === "UNKNOWN"
          ? { hostile_reason: r.hostile_reason }
          : {}),
      };
      classifications.push(entry);
    }
    const adapter_errors: HarnessAdapterError[] = [];
    for (const c of classifications) {
      if (c.classification === "MALFORMED") {
        adapter_errors.push(adapterError("MALFORMED_NATIVE_EVENT", JSON.stringify(c)));
      } else if (c.classification === "UNKNOWN") {
        adapter_errors.push(adapterError("UNKNOWN_NATIVE_EVENT", JSON.stringify(c)));
      }
    }
    const run: PiInternalRun = {
      handle,
      identity: this.qualification_,
      capabilities: this.caps_,
      command: redactedCommand,
      env: redactedEnv,
      cwd: redactedCwd,
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
      stdout_lines: redactedStdout,
      stderr_lines: redactedStderr,
      native_events: redactedNative,
      raw_events: redactedRaw,
      state: input.process_exit_code === 0 ? "completed" : "errored",
      adapter_errors,
      classifications,
      cleaned: false,
    };
    this.runs.set(handle, run);
    return handle;
  }

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
        session_dir: (input.args["session_dir"] as string | undefined) ?? null,
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
 * Build the default capability document for Pi 0.85.1.
 *
 * CORRECTION01 (H-C06) split the two axes; CORRECTION02
 * (C02-01) makes every `LIVE_QUALIFIED` claim bind to a
 * concrete probe evidence path. The contract-level
 * invariant `LIVE_QUALIFIED ⇒ probe_evidence_path !== null`
 * is enforced by `validateLiveQualification()` and by the
 * assertion inside this function (an axis with state
 * `LIVE_QUALIFIED` or `LIVE_HALT` cannot be paired with
 * a null evidence path).
 *
 *   HARNESS_CAPABILITY:
 *     HEADLESS / STREAMING_EVENTS / FINAL_JSON / JSONL /
 *     EXPLICIT_CWD / ISOLATED_DATA_DIR / MODEL_SELECTION /
 *     PROVIDER_SELECTION / RPC / CANCELLATION /
 *     TOOL_EVENT_VISIBILITY / TOKEN_USAGE / SESSION_RESUME /
 *     SESSION_FORK / SESSION_ARTIFACTS — SUPPORTED
 *       (the binary exposes them; pi 0.85.1 ships them.)
 *     AUTO_APPROVAL                     — UNSUPPORTED
 *     TIMEOUT                           — UNSUPPORTED
 *     RESOURCE_USAGE                    — UNAVAILABLE
 *
 *   LIVE_QUALIFICATION_STATE (CORRECTION02):
 *     HEADLESS / STREAMING_EVENTS / EXPLICIT_CWD /
 *       ISOLATED_DATA_DIR / JSONL        — LIVE_QUALIFIED
 *       (observable from the captured `session` envelope +
 *        a basic prompt)
 *     CANCELLATION                      — LIVE_HALT
 *       (probe was attempted; halted at
 *        HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE)
 *     FINAL_JSON / RPC / TOKEN_USAGE /
 *       TOOL_EVENT_VISIBILITY /
 *       SESSION_RESUME / SESSION_FORK /
 *       MODEL_SELECTION /
 *       PROVIDER_SELECTION /
 *       SESSION_ARTIFACTS                — LIVE_UNQUALIFIED
 *       (no live probe evidence exists for this run; the
 *        harness exposes them but we have not run a probe
 *        that exercises them yet)
 *     AUTO_APPROVAL / TIMEOUT /
 *       RESOURCE_USAGE                   — NOT_APPLICABLE
 *
 * FINAL_JSON semantics (CORRECTION02 explicit): the harness
 *   capability `FINAL_JSON` is the JSON event-stream mode
 *   ("JSONL — one JSON object per line"), NOT a single
 *   terminal JSON result. The capability is bound to the
 *   stream shape; a single `session` envelope is sufficient
 *   evidence for `STREAMING_EVENTS`/`JSONL` but is not
 *   sufficient evidence to call this capability
 *   `LIVE_QUALIFIED`. To live-qualify `FINAL_JSON`, a probe
 *   must observe a real terminal payload event from the
 *   stream.
 *
 * RPC semantics: per upstream v0.85.1
 *   `packages/coding-agent/docs/rpc.md`, RPC is a real
 *   bidirectional stdin/stdout protocol. A LIVE_QUALIFIED
 *   claim requires a probe that opens the RPC session,
 *   sends a command, and validates a response. No such
 *   evidence exists in this qualification campaign, so
 *   RPC stays LIVE_UNQUALIFIED.
 *
 * TOKEN_USAGE semantics: per upstream
 *   `packages/coding-agent/docs/json.md`, token usage is
 *   provider-reported and may remain zero until completion.
 *   Our captured run halted at the session envelope, so
 *   no `message_update.usage` event was observed; the
 *   capability stays LIVE_UNQUALIFIED.
 *
 * CORRECTION03 (C03-01, C03-02, C03-03): typed semantic
 * probe evidence replaces the bare `probe_evidence_path`
 * pointer. Each LIVE_QUALIFIED claim is bound to a
 * `CapabilityProbeEvidence` whose `disposition === "PASS"`
 * and whose `evidence_relation.expected === observed`.
 * The capability-specific oracles are:
 *
 *   HEADLESS         — observed session `type === "session"`
 *                      AND `invocation_mode === "headless"`.
 *                      (CORRECTION04: a single session
 *                      header is not sufficient evidence
 *                      of headless mode.)
 *   STREAMING_EVENTS — observed session `type === "session"`
 *                      AND `invocation_mode === "headless"`.
 *                      (CORRECTION04: a single session
 *                      header is not sufficient evidence
 *                      of streaming.)
 *   JSONL            — observed session `type === "session"`.
 *                      (Canonical Factory name for the
 *                      upstream JSON Event Stream Mode.)
 *   EXPLICIT_CWD     — observed session `cwd === requested_cwd`
 *   ISOLATED_DATA_DIR — observed session `cwd` lives under
 *                       `isolated_session_dir` (the dedicated
 *                       `--session-dir` directory).
 *                       (CORRECTION04: cwd match alone is
 *                       NOT sufficient evidence of isolation.
 *                       Until `isolated_session_dir` is
 *                       provided, the axis is demoted to
 *                       LIVE_UNQUALIFIED.)
 *   CANCELLATION     — observed `halt_disposition ===
 *                       "HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE"`
 *
 * FINAL_JSON semantics (CORRECTION03): the canonical
 *   Factory name for the upstream JSON Event Stream Mode
 *   is JSONL. FINAL_JSON's `harness_capability` is now
 *   UNSUPPORTED — the closed-world key list keeps the
 *   FINAL_JSON slot for backwards compatibility only.
 *
 * CORRECTION04 (C04-01..C04-06): semantic sufficiency is
 *   checked at two levels. `validateLiveQualification`
 *   enforces the structural predicate (typed semantic
 *   evidence with disposition PASS and expected ===
 *   observed). `verifyLiveQualificationEvidence(caps,
 *   repoRoot)` re-reads the artifact, recomputes the
 *   SHA256, recomputes the observed value, and refuses
 *   path escape (`../` or symlink-outside-repo). A
 *   capability cannot be LIVE_QUALIFIED unless both
 *   checks pass.
 */
export function defaultPiCapabilities(
  identity: HarnessQualificationIdentity,
  discovered_at_ms: number,
  evidence: {
    /** Path to the captured envelope evidence (session). */
    readonly session_capture: string | null;
    /** Path to the cancellation-halt evidence artifact. */
    readonly cancellation_halt: string | null;
    /**
     * CWD the caller requested the harness to run in.
     * The `EXPLICIT_CWD` capability-specific oracle
     * compares this string against the cwd observed in
     * the captured session envelope.
     */
    readonly requested_cwd?: string;
    /**
     * CORRECTION04 C04-04: a dedicated session/state
     * directory passed via `--session-dir <dir>` (or
     * equivalent) proving session/state isolation. When
     * provided, the builder qualifies
     * `ISOLATED_DATA_DIR` by reading the artifact at
     * `isolated_session_dir` and asserting that the
     * captured session envelope's cwd lives under it.
     * Until such evidence exists, `ISOLATED_DATA_DIR`
     * stays `SUPPORTED + LIVE_UNQUALIFIED` — a cwd
     * match alone is NOT sufficient evidence of
     * isolation.
     */
    readonly isolated_session_dir?: string | null;
    /**
     * CORRECTION04 C04-05: invocation facts proving the
     * harness was run in non-interactive / headless
     * mode. Until the adapter captures and pins such
     * facts, `HEADLESS` and `STREAMING_EVENTS` are
     * demoted to LIVE_UNQUALIFIED; JSONL remains
     * LIVE_QUALIFIED (the canonical name for the
     * upstream JSON Event Stream Mode).
     */
    readonly invocation_mode?: "headless" | "interactive" | null;
    /**
     * CORRECTION06 C06-01..C06-06: durable invocation
     * evidence (executable, argv, spawn cwd, protocol,
     * invocation_mode, session_dir, no_session,
     * env_subset, artifact_sha256, recorded_at). The
     * verifier requires a typed invocation artifact on
     * disk for every LIVE_QUALIFIED / LIVE_HALT axis
     * and recomputes the oracle's `expected` value from
     * it. Caller-supplied `expected` is no longer
     * authoritative. `null` means no invocation evidence
     * is available and the axis is demoted to
     * LIVE_UNQUALIFIED.
     */
    readonly invocation_evidence?: import("../../adapter-common/invocation-evidence.js").InvocationEvidence | null;
    /**
     * CORRECTION06 C06-06: the repo-relative path to the
     * invocation evidence artifact on disk. Required
     * when `invocation_evidence` is supplied.
     */
    readonly invocation_evidence_path?: string | null;
    /**
     * CORRECTION08 C08-01: the repo-relative path to the
     * execution-capture manifest on disk. The manifest
     * binds the invocation artifact and the probe
     * evidence to the same OS process run via a stable
     * execution_id. Required for every LIVE_QUALIFIED
     * and LIVE_HALT axis; the validator refuses axes
     * whose `execution_capture_path` is null.
     */
    readonly execution_capture_path?: string | null;
    /**
     * CORRECTION08 C08-01: SHA256 of the execution-
     * capture manifest's on-disk bytes. The verifier
     * recomputes the SHA and compares against this
     * externally-bound value.
     */
    readonly execution_capture_sha256?: string | null;
    /**
     * CORRECTION08 C08-03: stable execution_id of the
     * captured process run. The caller MUST compute
     * this once (via `computeExecutionId`) and pass it
     * both here and into the manifest's
     * `execution_id` field, so the probe evidence and
     * the manifest agree. The pi-adapter does not
     * recompute it (the spawn authority is the source
     * of truth).
     */
    readonly execution_id?: string | null;
    /**
     * CORRECTION08 C08-01: per-axis map of execution-
     * capture manifest paths. When supplied, the
     * corresponding axis binds the mapped
     * (path, sha) instead of the bundle-level
     * `execution_capture_path` /
     * `execution_capture_sha256`. This lets a single
     * LIVE_HALT CANCELLATION axis use a different
     * manifest than the JSONL / HEADLESS /
     * STREAMING_EVENTS axes.
     */
    readonly axis_execution_captures?: Readonly<
      Record<
        CapabilityKey,
        {
          readonly path: string;
          readonly sha256: string;
        }
      >
    >;
    /**
     * CORRECTION08 C08-03: per-axis map of invocation
     * evidence. When supplied, the corresponding axis
     * binds the mapped (evidence, path, sha) instead of
     * the bundle-level `invocation_evidence` /
     * `invocation_evidence_path` / `invocation_evidence_sha256`.
     */
    readonly axis_invocation_evidence?: Readonly<
      Record<
        CapabilityKey,
        {
          readonly evidence: import("../../adapter-common/invocation-evidence.js").InvocationEvidence;
          readonly path: string;
          readonly sha256: string;
        }
      >
    >;
    /**
     * CORRECTION08 C08-03: per-axis map of execution_id.
     * When supplied, the corresponding axis's probe
     * evidence carries the mapped execution_id instead
     * of the bundle-level `execution_id`. CANCELLATION
     * uses this so its halt evidence matches its
     * dedicated halt capture manifest.
     */
    readonly axis_execution_ids?: Readonly<
      Record<CapabilityKey, string>
    >;
    /**
     * CORRECTION09 C09-01: provenance discriminator for
     * the bundle-level execution-capture manifest. The
     * adapter binds the same origin on every axis that
     * uses the bundle-level manifest. Per-axis overrides
     * are supported via `axis_execution_capture_origins`.
     * `null` (the default) leaves the origin field null
     * on the axes, which the validator refuses for
     * `LIVE_QUALIFIED` / `REPLAY_QUALIFIED` / `LIVE_HALT`.
     */
    readonly execution_capture_origin?:
      | "REAL_PROCESS_CAPTURE"
      | "REPLAY_FIXTURE"
      | null;
    /**
     * CORRECTION09 C09-01: per-axis override of
     * `execution_capture_origin`. The CANCELLATION axis
     * uses this when its manifest has a different origin
     * from the JSONL axis.
     */
    readonly axis_execution_capture_origins?: Readonly<
      Record<CapabilityKey, "REAL_PROCESS_CAPTURE" | "REPLAY_FIXTURE">
    >;
  } = { session_capture: null, cancellation_halt: null },
): HarnessCapabilities {
  const empty = emptyCapabilities(identity, discovered_at_ms);
  // CORRECTION03 C03-03: FINAL_JSON is the JSON Event
  // Stream Mode upstream name; the canonical Factory
  // name is JSONL. The closed-world Factory key list
  // keeps FINAL_JSON for backwards compatibility, but
  // its harness_capability is UNSUPPORTED.
  const capabilities: Record<typeof CAPABILITY_KEYS[number], CapabilityState> = {
    HEADLESS: "SUPPORTED",
    STREAMING_EVENTS: "SUPPORTED",
    FINAL_JSON: "UNSUPPORTED",
    JSONL: "SUPPORTED",
    RPC: "SUPPORTED",
    SESSION_RESUME: "SUPPORTED",
    SESSION_FORK: "SUPPORTED",
    EXPLICIT_CWD: "SUPPORTED",
    ISOLATED_DATA_DIR: "SUPPORTED",
    MODEL_SELECTION: "SUPPORTED",
    PROVIDER_SELECTION: "SUPPORTED",
    TIMEOUT: "UNSUPPORTED",
    CANCELLATION: "SUPPORTED",
    AUTO_APPROVAL: "UNSUPPORTED",
    TOOL_EVENT_VISIBILITY: "SUPPORTED",
    TOKEN_USAGE: "SUPPORTED",
    RESOURCE_USAGE: "UNAVAILABLE",
    SESSION_ARTIFACTS: "SUPPORTED",
  };
  // Read observed evidence. If a session_capture or
  // cancellation_halt is missing or malformed, the
  // dependent LIVE_QUALIFIED/LIVE_HALT axes are demoted
  // to LIVE_UNQUALIFIED below; the builder never
  // fabricates evidence that is not on disk.
  type ObservedSession = {
    readonly artifact_path: string;
    readonly artifact_sha256: string;
    readonly session_type: string;
    readonly cwd: string | null;
  };
  type ObservedCancellation = {
    readonly artifact_path: string;
    readonly artifact_sha256: string;
    readonly halt_disposition: string | null;
  };
  function readObservedSession(p: string): ObservedSession | null {
    const parsed = readJsonlFirstLine(p);
    if (!isRecord(parsed)) return null;
    if (parsed["type"] !== "session") return null;
    const t = typeof parsed["type"] === "string" ? (parsed["type"] as string) : "";
    const cwdRaw = parsed["cwd"];
    return {
      artifact_path: p,
      artifact_sha256: artifactSha256(p),
      session_type: t,
      cwd: typeof cwdRaw === "string" ? cwdRaw : null,
    };
  }
  function readObservedCancellation(p: string): ObservedCancellation | null {
    const parsed = readJsonObject(p);
    if (!isRecord(parsed)) return null;
    const haltRaw = parsed["halt_disposition"];
    return {
      artifact_path: p,
      artifact_sha256: artifactSha256(p),
      halt_disposition: typeof haltRaw === "string" ? haltRaw : null,
    };
  }
  const observedSession =
    evidence.session_capture !== null
      ? readObservedSession(evidence.session_capture)
      : null;
  const observedCancellation =
    evidence.cancellation_halt !== null
      ? readObservedCancellation(evidence.cancellation_halt)
      : null;
  // CORRECTION06 C06-02: requested_cwd is no longer
  // authoritative for EXPLICIT_CWD; the verifier derives
  // the expected cwd from the invocation artifact's
  // spawn_cwd field. requested_cwd is retained as an
  // input for backwards compatibility but is not used to
  // build the evidence record.
  const _requestedCwd = evidence.requested_cwd ?? null;
  void _requestedCwd;
  const _legacyIsolatedDir = evidence.isolated_session_dir ?? null;
  void _legacyIsolatedDir;
  // CORRECTION07: `invocation_mode` is no longer a
  // caller-supplied parameter. The headless / non-
  // interactive status is derived from argv/env by
  // `deriveInvocationSemantics`. The legacy
  // `evidence.invocation_mode` argument is kept for
  // backwards compatibility with test callers but is
  // intentionally unused.
  const _legacyInvocationMode = evidence.invocation_mode ?? null;
  void _legacyInvocationMode;
  // CORRECTION06 C06-06: durable invocation evidence is
  // required for every LIVE_QUALIFIED axis. When the
  // adapter is built from a fixture / unit test, the
  // caller passes an InvocationEvidence object that
  // captures the launch facts. When the live harness
  // orchestrator constructs the capability document,
  // the orchestrator writes the artifact to disk and
  // passes the parsed object here.
  const invocationEvidence = evidence.invocation_evidence ?? null;
  const invocationEvidencePath = evidence.invocation_evidence_path ?? null;
  // CORRECTION08 C08-01: extract the execution-capture
  // manifest path + external SHA from the bundle arg.
  // The manifest is bound on every LIVE_QUALIFIED /
  // LIVE_HALT axis; the validator refuses axes whose
  // execution_capture_path is null. Per-axis overrides
  // take precedence over the bundle-level fields so a
  // single LIVE_HALT CANCELLATION axis can carry its
  // own halt-specific manifest.
  const axisCaptureOverrides = evidence.axis_execution_captures ?? null;
  // CORRECTION08 C08-03: per-axis invocation overrides.
  // CANCELLATION needs its own invocation artifact
  // because its argv differs from JSONL's. The
  // overrides are keyed by capability; absent keys
  // fall back to the bundle-level
  // `invocation_evidence_path`.
  const axisInvocationOverrides = evidence.axis_invocation_evidence ?? null;
  const axisExecutionIds = evidence.axis_execution_ids ?? null;
  const executionId = evidence.execution_id ?? null;
  // CORRECTION07: derivation of expected values lives
  // inside the artifact itself
  // (`invocation.derived.*`). The pi-adapter no longer
  // reaches into `invocation.invocation_mode` etc. —
  // those fields no longer exist on the typed artifact.
  // Spawn cwd, by contrast, is a raw fact the artifact
  // carries authoritatively.
  const invocationExpectedCwd =
    invocationEvidence !== null ? invocationEvidence.spawn_cwd : null;
  const invocationSessionDir =
    invocationEvidence !== null ? invocationEvidence.derived.session_dir : null;
  const invocationNoSession =
    invocationEvidence !== null ? invocationEvidence.derived.no_session : false;
  const invocationHeadless =
    invocationEvidence !== null ? invocationEvidence.derived.headless : false;
  const invocationSha256 =
    invocationEvidence !== null ? invocationEvidence.artifact_sha256 : null;
  type AxisEntry = {
    readonly lq: LiveQualificationState;
    readonly probe: CapabilityProbeEvidence | null;
  };
  const emptyEntry: AxisEntry = { lq: "LIVE_UNQUALIFIED", probe: null };
  function sessionProbe(cap: CapabilityKey, expected: string): AxisEntry {
    if (observedSession === null) return emptyEntry;
    const observed =
      cap === "EXPLICIT_CWD" || cap === "ISOLATED_DATA_DIR"
        ? (observedSession.cwd ?? "")
        : observedSession.session_type;
    // CORRECTION08 C08-03: the probe evidence must
    // carry the execution_id of the captured process
    // run. For session-derived axes the canonical
    // execution_id is the manifest's execution_id
    // (passed in via `evidence.execution_capture_path`
    // + the manifest on disk). The pi-adapter does not
    // re-compute it; it accepts the caller-supplied
    // `evidence.execution_id` so the manifest and the
    // probe always agree. Per-axis overrides take
    // precedence.
    const execId =
      (axisExecutionIds !== null && axisExecutionIds[cap] !== undefined
        ? axisExecutionIds[cap]
        : executionId) ?? "";
    return {
      // CORRECTION09 C09-01: the pi-adapter is a
      // fixture-driven replay harness, not a spawn
      // authority. The capabilities it qualifies are
      // therefore REPLAY_QUALIFIED, not LIVE_QUALIFIED.
      // A future CORRECTION10 spawn-authority code path
      // can promote axes to LIVE_QUALIFIED by emitting
      // a REAL_PROCESS_CAPTURE manifest from a live
      // capture authority.
      lq: "REPLAY_QUALIFIED",
      probe: buildProbeEvidence({
        capability: cap,
        probe_kind: "SESSION_ENVELOPE",
        artifact_path: observedSession.artifact_path,
        artifact_sha256: observedSession.artifact_sha256,
        expected,
        observed,
        execution_id: execId,
      }),
    };
  }
  // CORRECTION04 C04-04 + CORRECTION05 C05-01:
  // ISOLATED_DATA_DIR requires isolation evidence: a
  // dedicated `--session-dir <dir>` (or equivalent)
  // under which the captured session artifact actually
  // lives. Cwd match alone is NOT sufficient — upstream
  // Pi's `--session-dir` is the directory where session
  // files are stored, and the captured artifact is a
  // session file. Until isolatedDir is provided AND the
  // captured session artifact_path lives under it, the
  // axis stays LIVE_UNQUALIFIED.
  function isUnder(child: string, parent: string): boolean {
    if (child === parent) return true;
    if (parent === "") return false;
    if (parent.endsWith("/")) {
      return child.startsWith(parent);
    }
    return child.startsWith(parent + "/");
  }
  function isolatedDataDirEntry(): AxisEntry {
    // CORRECTION07: session_dir is now derived from
    // raw argv/env, not caller-supplied
    // `isolated_session_dir`. The caller-supplied
    // `isolatedDir` argument is no longer authoritative.
    if (
      observedSession === null ||
      invocationSessionDir === null
    ) {
      return emptyEntry;
    }
    const artifactPath = observedSession.artifact_path;
    if (!isUnder(artifactPath, invocationSessionDir)) {
      return emptyEntry;
    }
    return {
      // CORRECTION09 C09-01: the pi-adapter is a
      // fixture-driven replay harness, so its
      // qualifications are REPLAY_QUALIFIED (not
      // LIVE_QUALIFIED). A future spawn-authority code
      // path can promote axes to LIVE_QUALIFIED by
      // emitting a REAL_PROCESS_CAPTURE manifest from a
      // live capture authority.
      lq: "REPLAY_QUALIFIED",
      probe: buildIsolatedDataDirEvidence({
        artifact_path: observedSession.artifact_path,
        artifact_sha256: observedSession.artifact_sha256,
        isolated_session_dir: invocationSessionDir,
        observed_artifact_path: artifactPath,
        execution_id: (axisExecutionIds !== null && axisExecutionIds["ISOLATED_DATA_DIR"] !== undefined ? axisExecutionIds["ISOLATED_DATA_DIR"] : executionId) ?? "",
      }),
    };
  }
  // CORRECTION04 C04-05: HEADLESS / STREAMING_EVENTS
  // require invocation facts proving non-interactive
  // mode and protocol output. The session envelope is
  // not sufficient evidence of headless mode (a single
  // session header proves only that the harness
  // emitted one). Until invocation_mode === "headless"
  // is captured AND the session envelope shows
  // type=session (the protocol output), both axes
  // stay LIVE_UNQUALIFIED. JSONL remains LIVE_QUALIFIED
  // because the canonical Factory name for the upstream
  // JSON Event Stream Mode IS JSONL — the protocol
  // output (session envelope) is the proof.
  //
  // CORRECTION06 C06-03 / C06-04: the
  // invocation_mode argument is no longer authoritative
  // on its own. The invocation evidence artifact on
  // disk is. If invocationEvidence is null the axis is
  // demoted to LIVE_UNQUALIFIED.
  //
  // C06-04: STREAMING_EVENTS additionally requires the
  // observation to contain >= 2 events. The canonical
  // single-event session header is not sufficient
  // evidence of streaming behavior.
  const headlessQualified =
    invocationHeadless &&
    observedSession !== null;
  const streamingQualified =
    invocationHeadless &&
    invocationEvidence !== null &&
    (invocationEvidence.derived.protocol === "json" ||
      invocationEvidence.derived.protocol === "rpc") &&
    observedSession !== null &&
    // Read the observation artifact and count lines.
    // If there are >= 2 events, streaming qualifies.
    (() => {
      try {
        const fs = require("node:fs");
        const text = fs.readFileSync(observedSession.artifact_path, "utf8");
        const lines = text.split("\n").filter((l: string) => l.trim().length > 0);
        return lines.length >= 2;
      } catch {
        return false;
      }
    })();
  // CORRECTION06 C06-02: EXPLICIT_CWD's expected value
  // is the invocation artifact's spawn_cwd. If no
  // invocation evidence is present, the axis is
  // LIVE_UNQUALIFIED.
  const explicitCwdQualified =
    invocationEvidence !== null &&
    observedSession !== null &&
    invocationExpectedCwd !== null &&
    invocationExpectedCwd !== "";
  // CORRECTION06 C06-05: ISOLATED_DATA_DIR's expected
  // value is the invocation artifact's session_dir, and
  // the artifact_path must be the actual Pi runtime
  // session file path under that dir (NOT the Factory
  // fixture copy location).
  const isolatedQualified =
    invocationEvidence !== null &&
    invocationSessionDir !== null &&
    !invocationNoSession &&
    observedSession !== null &&
    isUnder(observedSession.artifact_path, invocationSessionDir);
  const liveEntries: Record<typeof CAPABILITY_KEYS[number], AxisEntry> = {
    HEADLESS: headlessQualified ? sessionProbe("HEADLESS", "session") : emptyEntry,
    STREAMING_EVENTS: streamingQualified
      ? sessionProbe("STREAMING_EVENTS", "session")
      : emptyEntry,
    EXPLICIT_CWD:
      explicitCwdQualified && invocationExpectedCwd !== null
        ? sessionProbe("EXPLICIT_CWD", invocationExpectedCwd)
        : emptyEntry,
    ISOLATED_DATA_DIR: isolatedQualified ? isolatedDataDirEntry() : emptyEntry,
    JSONL: invocationEvidence !== null ? sessionProbe("JSONL", "session") : emptyEntry,
    FINAL_JSON: emptyEntry,
    RPC: emptyEntry,
    TOKEN_USAGE: emptyEntry,
    SESSION_RESUME: emptyEntry,
    SESSION_FORK: emptyEntry,
    MODEL_SELECTION: emptyEntry,
    PROVIDER_SELECTION: emptyEntry,
    TIMEOUT: { lq: "NOT_APPLICABLE", probe: null },
    CANCELLATION:
      observedCancellation !== null && invocationEvidence !== null
        ? {
            // CORRECTION09 C09-01: the pi-adapter is a
            // fixture-driven replay harness, so the halt
            // it qualifies is REPLAY_HALT, not LIVE_HALT.
            // A future spawn-authority code path can
            // promote axes to LIVE_HALT by emitting a
            // REAL_PROCESS_CAPTURE manifest from a live
            // capture authority.
            lq: "REPLAY_HALT",
            probe: haltProbeEvidence({
              capability: "CANCELLATION",
              artifact_path: observedCancellation.artifact_path,
              artifact_sha256: observedCancellation.artifact_sha256,
              expected: "HALT_LIVE_PROVIDER_CREDENTIALS_UNAVAILABLE",
              observed: observedCancellation.halt_disposition ?? "",
              // CORRECTION08 C08-03: bind the captured
              // execution_id onto the halt evidence.
              execution_id: (axisExecutionIds !== null && axisExecutionIds["CANCELLATION"] !== undefined ? axisExecutionIds["CANCELLATION"] : executionId) ?? "",
            }),
          }
        : { lq: "LIVE_UNQUALIFIED", probe: null },
    AUTO_APPROVAL: { lq: "NOT_APPLICABLE", probe: null },
    TOOL_EVENT_VISIBILITY: emptyEntry,
    SESSION_ARTIFACTS: emptyEntry,
    RESOURCE_USAGE: { lq: "NOT_APPLICABLE", probe: null },
  };
  const liveMap: Record<typeof CAPABILITY_KEYS[number], LiveQualificationState> =
    {} as Record<typeof CAPABILITY_KEYS[number], LiveQualificationState>;
  const axes: Record<typeof CAPABILITY_KEYS[number], CapabilityAxis> = {} as Record<
    typeof CAPABILITY_KEYS[number],
    CapabilityAxis
  >;
  for (const k of CAPABILITY_KEYS) {
    const entry = liveEntries[k];
    if (entry.lq === "LIVE_QUALIFIED" && entry.probe === null) {
      throw new Error(
        `Pi default capability document attempted LIVE_QUALIFIED with null probe_evidence for key ${k}`,
      );
    }
    if (entry.lq === "LIVE_QUALIFIED" && entry.probe?.disposition !== "PASS") {
      throw new Error(
        `Pi default capability document attempted LIVE_QUALIFIED with failed oracle for key ${k}: expected=${entry.probe?.evidence_relation.expected} observed=${entry.probe?.evidence_relation.observed} disposition=${entry.probe?.disposition}`,
      );
    }
    if (entry.lq === "LIVE_QUALIFIED" && entry.probe?.probe_kind === "NOT_RUN") {
      throw new Error(
        `Pi default capability document attempted LIVE_QUALIFIED with NOT_RUN probe for key ${k}`,
      );
    }
    // CORRECTION09 C09-01: REPLAY_QUALIFIED carries the
    // same evidence-binding invariants as LIVE_QUALIFIED
    // — it just declares a different capture_origin.
    if (entry.lq === "REPLAY_QUALIFIED" && entry.probe === null) {
      throw new Error(
        `Pi default capability document attempted REPLAY_QUALIFIED with null probe_evidence for key ${k}`,
      );
    }
    if (entry.lq === "REPLAY_QUALIFIED" && entry.probe?.disposition !== "PASS") {
      throw new Error(
        `Pi default capability document attempted REPLAY_QUALIFIED with failed oracle for key ${k}: expected=${entry.probe?.evidence_relation.expected} observed=${entry.probe?.evidence_relation.observed} disposition=${entry.probe?.disposition}`,
      );
    }
    if (entry.lq === "REPLAY_QUALIFIED" && entry.probe?.probe_kind === "NOT_RUN") {
      throw new Error(
        `Pi default capability document attempted REPLAY_QUALIFIED with NOT_RUN probe for key ${k}`,
      );
    }
    if (entry.lq === "LIVE_HALT" && entry.probe === null) {
      throw new Error(
        `Pi default capability document attempted LIVE_HALT with null probe_evidence for key ${k}`,
      );
    }
    // CORRECTION09 C09-01: REPLAY_HALT carries the
    // same evidence-binding invariants as LIVE_HALT.
    if (entry.lq === "REPLAY_HALT" && entry.probe === null) {
      throw new Error(
        `Pi default capability document attempted REPLAY_HALT with null probe_evidence for key ${k}`,
      );
    }
    if (entry.lq === "REPLAY_HALT" && entry.probe?.disposition !== "HALT") {
      throw new Error(
        `Pi default capability document attempted REPLAY_HALT with non-HALT probe for key ${k}: disposition=${entry.probe?.disposition}`,
      );
    }
    if (
      entry.lq === "LIVE_HALT" &&
      entry.probe !== null &&
      entry.probe.disposition !== "HALT"
    ) {
      throw new Error(
        `Pi default capability document attempted LIVE_HALT with non-HALT probe disposition for key ${k}: ${entry.probe.disposition}`,
      );
    }
    liveMap[k] = entry.lq;
    // CORRECTION06 C06-06: every LIVE_QUALIFIED /
    // LIVE_HALT axis carries the invocation evidence
    // path. The verifier re-reads this artifact and
    // recomputes the oracle's `expected` value from it.
    // The artifact path is the durable, repo-relative
    // path to the JSON file that records the launch
    // facts. The live orchestrator writes this file
    // before calling `defaultPiCapabilities`; the unit
    // tests write a fixture invocation artifact in the
    // test tmpdir and pass the parsed object via the
    // `invocation_evidence` argument.
    let invocationEvidencePathForAxis: string | null = null;
    let invocationEvidenceShaForAxis: string | null = null;
    // CORRECTION08 C08-03: per-axis invocation override.
    // CANCELLATION uses its own invocation artifact
    // (CANCELLATION.invocation.json) whose argv differs
    // from JSONL's. Without this override, every axis
    // would point at JSONL.invocation.json and the
    // CANCELLATION manifest's invocation_sha256 would
    // not match.
    const axisInvOverride =
      axisInvocationOverrides !== null
        ? axisInvocationOverrides[k]
        : undefined;
    if (
      (entry.lq === "LIVE_QUALIFIED" ||
        entry.lq === "LIVE_HALT" ||
        entry.lq === "REPLAY_QUALIFIED" ||
        entry.lq === "REPLAY_HALT") &&
      ((invocationEvidence !== null && invocationEvidencePath !== null) ||
        axisInvOverride !== undefined)
    ) {
      if (axisInvOverride !== undefined) {
        invocationEvidencePathForAxis = axisInvOverride.path;
        invocationEvidenceShaForAxis = axisInvOverride.sha256;
      } else {
        invocationEvidencePathForAxis = invocationEvidencePath;
        // CORRECTION07 C07-01: bind the invocation SHA on
        // the axis. The verifier recomputes the SHA from
        // the on-disk bytes and compares against this
        // value.
        invocationEvidenceShaForAxis = invocationSha256;
      }
    }
    axes[k] = {
      harness_capability: capabilities[k],
      live_qualification: entry.lq,
      probe_evidence: entry.probe,
      probe_evidence_path: entry.probe?.artifact_path ?? null,
      invocation_evidence_path: invocationEvidencePathForAxis,
      invocation_evidence_sha256: invocationEvidenceShaForAxis,
      // CORRECTION08 C08-01: bind the execution-capture
      // manifest + external SHA on the axis. The
      // manifest closes the invocation-vs-observation
      // splice hole CORRECTION07's review identified.
      // `null` means the axis is LIVE_UNQUALIFIED or
      // carries no manifest (LIVE_HALT without a
      // manifest, which the validator refuses).
      execution_capture_path:
        axisCaptureOverrides !== null && axisCaptureOverrides[k] !== undefined
          ? axisCaptureOverrides[k].path
          : evidence.execution_capture_path ?? null,
      execution_capture_sha256:
        axisCaptureOverrides !== null && axisCaptureOverrides[k] !== undefined
          ? axisCaptureOverrides[k].sha256
          : evidence.execution_capture_sha256 ?? null,
      // CORRECTION09 C09-01: provenance discriminator.
      // Per-axis overrides take precedence over the
      // bundle-level `execution_capture_origin`. The
      // pi-adapter defaults to REPLAY_FIXTURE because it
      // consumes pre-captured evidence; a future spawn-
      // authority code path can override to
      // REAL_PROCESS_CAPTURE.
      execution_capture_origin:
        evidence.axis_execution_capture_origins !== undefined &&
        evidence.axis_execution_capture_origins[k] !== undefined
          ? evidence.axis_execution_capture_origins[k]
          : evidence.execution_capture_origin !== undefined
            ? evidence.execution_capture_origin
            : "REPLAY_FIXTURE",
    };
  }
  if (Object.keys(capabilities).length !== Object.keys(empty.capabilities).length) {
    throw new Error(
      "Pi default capability document does not match the closed-world key list",
    );
  }
  if (Object.keys(liveMap).length !== Object.keys(empty.capabilities).length) {
    throw new Error(
      "Pi live_qualification_by_key does not match the closed-world key list",
    );
  }
  if (Object.keys(axes).length !== Object.keys(empty.capabilities).length) {
    throw new Error(
      "Pi capability_axes does not match the closed-world key list",
    );
  }
  return {
    identity: empty.identity,
    discovered_at_ms: empty.discovered_at_ms,
    capabilities,
    live_qualification_by_key: liveMap,
    capability_axes: axes,
  };
}
