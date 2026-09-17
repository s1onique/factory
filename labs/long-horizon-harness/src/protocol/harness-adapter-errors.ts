/**
 * Closed-world adapter error taxonomy (LH-03 §4.2).
 *
 * Adapter errors are OBSERVATIONS, never terminal authority.
 * They feed into Phase E as data, but the adapter itself
 * MUST NOT translate a non-success error into a run-level
 * terminal outcome. That authority remains with Phase E.
 *
 * Doctrine (D08): no candidate-specific error names
 * (e.g. `PI_RPC_HANDSHAKE_FAILED`, `CLINE_TIMEOUT`). All
 * errors map into one of these codes.
 */

export type AdapterErrorCode =
  | "HARNESS_NOT_FOUND"
  | "UNSUPPORTED_VERSION"
  | "CAPABILITY_MISSING"
  | "START_FAILED"
  | "PROTOCOL_ERROR"
  | "MALFORMED_NATIVE_EVENT"
  | "UNKNOWN_NATIVE_EVENT"
  | "PROCESS_CRASH"
  | "ADAPTER_TIMEOUT"
  | "CANCEL_FAILED"
  | "ARTIFACT_COLLECTION_FAILED"
  | "NORMALIZATION_FAILED"
  | "SECRET_REDACTION_FAILED"
  | "IDENTITY_MISMATCH";

export const ADAPTER_ERROR_CODES: readonly AdapterErrorCode[] = [
  "HARNESS_NOT_FOUND",
  "UNSUPPORTED_VERSION",
  "CAPABILITY_MISSING",
  "START_FAILED",
  "PROTOCOL_ERROR",
  "MALFORMED_NATIVE_EVENT",
  "UNKNOWN_NATIVE_EVENT",
  "PROCESS_CRASH",
  "ADAPTER_TIMEOUT",
  "CANCEL_FAILED",
  "ARTIFACT_COLLECTION_FAILED",
  "NORMALIZATION_FAILED",
  "SECRET_REDACTION_FAILED",
  "IDENTITY_MISMATCH",
] as const;

export function isAdapterErrorCode(value: unknown): value is AdapterErrorCode {
  return (
    typeof value === "string" &&
    (ADAPTER_ERROR_CODES as readonly string[]).includes(value)
  );
}

/**
 * An adapter-level error observation. Carries a code, a
 * message, and optional structured context. Adapters report
 * these; Phase E decides what to do with them.
 */
export type HarnessAdapterError = {
  readonly code: AdapterErrorCode;
  readonly message: string;
  readonly context?: Readonly<Record<string, string>>;
};

export function adapterError(
  code: AdapterErrorCode,
  message: string,
  context?: Readonly<Record<string, string>>,
): HarnessAdapterError {
  return context === undefined
    ? { code, message }
    : { code, message, context };
}
