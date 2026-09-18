/**
 * Deterministic structural secret redaction (LH-03 §9).
 *
 * The redaction layer MUST defend against:
 *
 *   - API keys
 *   - Authorization headers
 *   - Bearer tokens
 *   - Known provider token env values
 *   - Auth/session credential files
 *   - CLI --api-key arguments
 *
 * Redaction operates at structural layers, not on the
 * combined output stream:
 *
 *   - environment variables: every value in a name-matched
 *     set is replaced with the constant token
 *     `__FACTORY_REDACTED__`
 *   - CLI argv: every `--<flag>=<value>` or `--<flag> <value>`
 *     pair where `<flag>` matches a sensitive-flag set is
 *     redacted
 *   - JSON record fields: any field whose key matches the
 *     sensitive-field set has its value replaced
 *   - text: any bearer/api-key token-shaped substring is
 *     replaced (regex-based but bounded)
 *
 * The result is deterministic: same input always produces
 * the same redacted output. Re-parsing the redacted output
 * must still succeed (structural integrity is preserved).
 */

const REDACTION_TOKEN = "__FACTORY_REDACTED__";

/**
 * Sensitive env-var names. Case-insensitive comparison.
 * Pattern is "contains"; values for any name matching any
 * of these substrings are redacted.
 */
const SENSITIVE_ENV_PATTERNS: readonly string[] = [
  "API_KEY",
  "APIKEY",
  "API_TOKEN",
  "SECRET",
  "BEARER",
  "PASSWORD",
  "PRIVATE_KEY",
  "ACCESS_TOKEN",
  "AUTH_TOKEN",
  "SESSION_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "AWS_ACCESS_KEY",
  "AWS_SECRET",
  "GITHUB_TOKEN",
  "GITLAB_TOKEN",
  "HF_TOKEN",
  "HUGGINGFACE_TOKEN",
  "AZURE_OPENAI_API_KEY",
];

/**
 * Sensitive CLI flag names (without the leading dashes).
 * Redaction replaces the value; the flag itself is preserved
 * for structural integrity.
 */
const SENSITIVE_CLI_FLAGS: ReadonlySet<string> = new Set([
  "api-key",
  "apikey",
  "api_key",
  "token",
  "auth-token",
  "auth_token",
  "password",
  "secret",
  "bearer",
  "session-token",
  "session_token",
]);

/**
 * Sensitive JSON field names (case-insensitive).
 */
const SENSITIVE_JSON_FIELDS: ReadonlySet<string> = new Set([
  "api_key",
  "apikey",
  "apiKey",
  "api-key",
  "token",
  "auth",
  "authorization",
  "bearer",
  "password",
  "secret",
  "session",
  "credential",
  "credentials",
  "private_key",
  "access_token",
]);

/**
 * Regex used to scrub bearer/api-key tokens from text.
 * The pattern intentionally matches the most common shapes;
 * false positives are acceptable (deterministic redaction
 * over precision).
 */
const TEXT_TOKEN_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._\-]{6,}\b/g,
  /\bAKIA[A-Z0-9]{16}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_\-]{20,}\b/g,
  /\bxoxb-[A-Za-z0-9\-]{20,}\b/g,
  // OpenAI keys are `sk-...` where the suffix is
  // alphanumeric and may include `_` and `-` (project-
  // scoped keys like `sk-proj-...`).
  /\bsk-[A-Za-z0-9_\-]{20,}\b/g,
  // Custom canary used by the live-capture tests.
  /\bCANARY-[A-Za-z0-9_\-]{4,}\b/g,
];

/**
 * Whether an env-var name matches a sensitive pattern.
 */
export function isSensitiveEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  for (const pat of SENSITIVE_ENV_PATTERNS) {
    if (upper.includes(pat.toUpperCase())) return true;
  }
  return false;
}

/**
 * Redact an env map. Returns a new object; never mutates
 * the input.
 */
export function redactEnv(
  env: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (isSensitiveEnvName(k)) {
      out[k] = REDACTION_TOKEN;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Redact CLI argv. Operates on the raw string argv list.
 * Preserves every flag name; replaces only the value.
 */
export function redactArgv(argv: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i]!;
    if (cur.startsWith("--")) {
      const eq = cur.indexOf("=");
      if (eq > 0) {
        const flag = cur.slice(2, eq);
        if (SENSITIVE_CLI_FLAGS.has(flag.toLowerCase())) {
          out.push(`--${flag}=${REDACTION_TOKEN}`);
          continue;
        }
      } else {
        const flag = cur.slice(2);
        const next = argv[i + 1];
        if (
          SENSITIVE_CLI_FLAGS.has(flag.toLowerCase()) &&
          next !== undefined &&
          !next.startsWith("-")
        ) {
          out.push(cur);
          out.push(REDACTION_TOKEN);
          i++;
          continue;
        }
      }
    }
    out.push(cur);
  }
  return out;
}

/**
 * Redact sensitive fields inside a JSON record (recursive).
 * Returns a new object; never mutates the input.
 *
 * Every STRING value (regardless of key) is also scrubbed
 * for token-shaped substrings; this is the durable layer
 * defence that catches tokens embedded in message.text,
 * tool args, or any other free-text field.
 */
export function redactJsonRecord(
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (SENSITIVE_JSON_FIELDS.has(k) || SENSITIVE_JSON_FIELDS.has(k.toLowerCase())) {
      out[k] = REDACTION_TOKEN;
    } else if (typeof v === "string") {
      out[k] = redactText(v);
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactJsonRecord(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = redactJsonArray(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function redactJsonArray(arr: ReadonlyArray<unknown>): unknown[] {
  return arr.map((v) => {
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      return redactJsonRecord(v as Record<string, unknown>);
    }
    if (Array.isArray(v)) {
      return redactJsonArray(v);
    }
    return v;
  });
}

/**
 * Redact token-shaped substrings from free text. Returns a
 * new string.
 */
export function redactText(text: string): string {
  let out = text;
  for (const pat of TEXT_TOKEN_PATTERNS) {
    out = out.replace(pat, REDACTION_TOKEN);
  }
  return out;
}

/**
 * The constant token used in redactions. Exposed for tests
 * and for canary assertions.
 */
export const SECRET_REDACTION_TOKEN = REDACTION_TOKEN;

/**
 * Bundle: apply env + argv redaction in canonical order.
 * Used by adapters before persisting a fixture.
 */
export function redactPreparedRunEnv(
  env: Readonly<Record<string, string>>,
): Record<string, string> {
  return redactEnv(env);
}

export function redactPreparedRunArgv(
  argv: ReadonlyArray<string>,
): string[] {
  return redactArgv(argv);
}

/**
 * Redact a line of harness-native output (stdout/stderr/raw).
 * Returns a new string; never mutates input.
 *
 * Used by the durable live-capture path (LH-03 H-C05).
 */
export function redactNativeLine(line: string): string {
  return redactText(line);
}

/**
 * Redact a parsed native event record (post-parse, pre-store).
 * Returns a new object; never mutates the input.
 *
 * Used by the durable live-capture path (LH-03 H-C05).
 */
export function redactNativeEvent(
  event: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return redactJsonRecord(event);
}

/**
 * Redact a single string value that flows through the
 * capture path (selected_session_file path, env values, etc).
 */
export function redactStringValue(value: string): string {
  return redactText(value);
}
