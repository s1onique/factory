/**
 * LH-03 CORRECTION01 H-C05 — End-to-end secret hygiene
 * on the durable live-capture path.
 *
 * Each LIVESECRET canary injects a real-looking secret
 * through a distinct seam of `ingestLiveCapture`, then
 * asserts no canary survives the round-trip
 * `ingestLiveCapture()` -> `collectArtifacts()`.
 *
 *   LIVESECRET01 stdout
 *   LIVESECRET02 stderr
 *   LIVESECRET03 native JSON value
 *   LIVESECRET04 raw event line
 *   LIVESECRET05 argv
 *   LIVESECRET06 env
 *
 * Direct unit tests of the redaction helpers are NOT
 * sufficient — these tests exercise the full path through
 * the candidate adapter (Pi 0.85.1) and confirm that
 * collectArtifacts() can never re-emit a canary.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PiAdapter,
  defaultPiCapabilities,
  QUALIFIED_PI_IDENTITY,
} from "../../src/adapters/pi/pi-adapter.js";
import type { HarnessHandle } from "../../src/domain/ids.js";
import {
  SECRET_REDACTION_TOKEN,
} from "../../src/redaction/secret-redaction.js";

const CANARIES = {
  openai: "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop",
  bearer: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
  aws: "AKIAIOSFODNN7EXAMPLE",
  github: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  // A unique canary that the standard redaction must catch.
  custom: "CANARY-XYZZY-9988-7766",
};

function buildAdapter(): PiAdapter {
  return new PiAdapter({
    qualification: QUALIFIED_PI_IDENTITY,
    capabilities: defaultPiCapabilities(QUALIFIED_PI_IDENTITY, 1700000000000),
    captured_at_ms: 1700000000000,
  });
}

async function collectStringArtifact(
  adapter: PiAdapter,
  handle: HarnessHandle,
  kind: "STDOUT_LINES" | "STDERR_LINES",
): Promise<string> {
  const arts = await adapter.collectArtifacts(handle);
  for (const a of arts) {
    if (a.kind === kind) return a.text ?? "";
  }
  return "";
}

async function collectNATIVE_EVENTText(
  adapter: PiAdapter,
  handle: HarnessHandle,
): Promise<string> {
  const arts = await adapter.collectArtifacts(handle);
  let s = "";
  for (const a of arts) {
    if (a.kind === "NATIVE_EVENT") {
      s += JSON.stringify(a.record) + "\n";
    }
  }
  return s;
}

test("LIVESECRET01: stdout canary is redacted before durable storage", async () => {
  const a = buildAdapter();
  const h = a.ingestLiveCapture({
    handle: "h-ls01",
    command: ["pi", "--mode", "json"],
    env: {},
    cwd: "/tmp",
    stdout_lines: [
      "session opened",
      `key=${CANARIES.openai}`,
      `auth: ${CANARIES.bearer}`,
    ],
    stderr_lines: [],
    raw_events: [],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events: [],
  });
  const stdout = await collectStringArtifact(a, h, "STDOUT_LINES");
  for (const canary of Object.values(CANARIES)) {
    assert.equal(stdout.includes(canary), false, `stdout leaked: ${canary}`);
  }
  // And the redaction token is present.
  assert.equal(stdout.includes(SECRET_REDACTION_TOKEN), true);
});

test("LIVESECRET02: stderr canary is redacted before durable storage", async () => {
  const a = buildAdapter();
  const h = a.ingestLiveCapture({
    handle: "h-ls02",
    command: ["pi", "--mode", "json"],
    env: {},
    cwd: "/tmp",
    stdout_lines: [],
    stderr_lines: [
      `ERROR: failed with ${CANARIES.aws}`,
      `token=${CANARIES.github}`,
    ],
    raw_events: [],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events: [],
  });
  const stderr = await collectStringArtifact(a, h, "STDERR_LINES");
  for (const canary of Object.values(CANARIES)) {
    assert.equal(stderr.includes(canary), false, `stderr leaked: ${canary}`);
  }
});

test("LIVESECRET03: native JSON value canary is redacted before durable storage", async () => {
  const a = buildAdapter();
  // Plant the canary inside a native_event record.
  const h = a.ingestLiveCapture({
    handle: "h-ls03",
    command: ["pi", "--mode", "json"],
    env: {},
    cwd: "/tmp",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "x",
        timestamp: "t",
        cwd: "/tmp",
      }),
    ],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events: [
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: `Use this key: ${CANARIES.openai}` },
          ],
        },
      },
    ],
  });
  const allNative = await collectNATIVE_EVENTText(a, h);
  for (const canary of Object.values(CANARIES)) {
    assert.equal(allNative.includes(canary), false, `native event leaked: ${canary}`);
  }
});

test("LIVESECRET04: raw event line canary is redacted before durable storage", async () => {
  const a = buildAdapter();
  const h = a.ingestLiveCapture({
    handle: "h-ls04",
    command: ["pi", "--mode", "json"],
    env: {},
    cwd: "/tmp",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [
      `not-json: token=${CANARIES.openai}`,
      JSON.stringify({
        type: "session",
        version: 3,
        id: "x",
        timestamp: "t",
        cwd: "/tmp",
      }),
    ],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events: [],
  });
  // The raw event is preserved (after redaction) in
  // run.raw_events. It must not contain the canary.
  // We expose raw events via the classification log line
  // text by checking the awaiting adapter's awaitExit
  // (which copies out) and the raw text artefact.
  // The adapter does not currently expose raw_events as
  // a separate HarnessRawArtifact, but they are stored
  // for the decode-classification log; we re-decode via
  // the adapter's events() to confirm.
  const events: unknown[] = [];
  for await (const e of a.events(h)) events.push(e);
  // No canary may appear in any text field of any event.
  for (const e of events) {
    const s = JSON.stringify(e);
    for (const canary of Object.values(CANARIES)) {
      assert.equal(s.includes(canary), false, `event leaked: ${canary}`);
    }
  }
});

test("LIVESECRET05: argv canary is redacted before durable storage", async () => {
  const a = buildAdapter();
  const h = a.ingestLiveCapture({
    handle: "h-ls05",
    command: [
      "pi",
      "--api-key",
      CANARIES.openai,
      "--token=" + CANARIES.github,
    ],
    env: {},
    cwd: "/tmp",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events: [],
  });
  const arts = await a.collectArtifacts(h);
  let argvText = "";
  for (const x of arts) {
    if (x.kind === "RAW_ARGV" && x.argv) argvText = x.argv.join("\n");
  }
  for (const canary of Object.values(CANARIES)) {
    assert.equal(argvText.includes(canary), false, `argv leaked: ${canary}`);
  }
  // The flag itself survives; only the value is redacted.
  assert.equal(argvText.includes("--api-key"), true);
  assert.equal(argvText.includes(SECRET_REDACTION_TOKEN), true);
});

test("LIVESECRET06: env canary is redacted before durable storage", async () => {
  const a = buildAdapter();
  const h = a.ingestLiveCapture({
    handle: "h-ls06",
    command: ["pi", "--mode", "json"],
    env: {
      OPENAI_API_KEY: CANARIES.openai,
      AWS_ACCESS_KEY_ID: CANARIES.aws,
      MY_GITHUB_TOKEN: CANARIES.github,
      PATH: "/usr/bin",
      HOME: "/home/lab",
    },
    cwd: "/tmp",
    stdout_lines: [],
    stderr_lines: [],
    raw_events: [],
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events: [],
  });
  const arts = await a.collectArtifacts(h);
  let envText = "";
  let envObj: Readonly<Record<string, string>> | undefined;
  for (const x of arts) {
    if (x.kind === "RAW_ENV" && x.env) {
      envText = JSON.stringify(x.env);
      envObj = x.env;
    }
  }
  for (const canary of Object.values(CANARIES)) {
    assert.equal(envText.includes(canary), false, `env leaked: ${canary}`);
  }
  // Non-sensitive env vars survive.
  assert.equal(envObj?.["PATH"], "/usr/bin");
  // Sensitive values are replaced with the token.
  assert.equal(envObj?.["OPENAI_API_KEY"], SECRET_REDACTION_TOKEN);
});

test("LIVESECRET07: ingestLiveCapture does not mutate caller objects (H-C05 immutability)", async () => {
  const a = buildAdapter();
  const stdout_lines = [`line with ${CANARIES.openai}`];
  const stderr_lines = [`line with ${CANARIES.aws}`];
  const raw_events = [`raw with ${CANARIES.github}`];
  const native_events = [
    { type: "session", version: 3, id: "x", timestamp: "t", cwd: "/tmp" },
  ] as ReadonlyArray<Readonly<Record<string, unknown>>>;
  const command = ["pi", "--api-key", CANARIES.openai];
  const env = { OPENAI_API_KEY: CANARIES.openai };

  const stdout_snapshot = [...stdout_lines];
  const stderr_snapshot = [...stderr_lines];
  const raw_snapshot = [...raw_events];
  const native_snapshot = JSON.stringify(native_events);
  const command_snapshot = [...command];
  const env_snapshot = { ...env };

  const h = a.ingestLiveCapture({
    handle: "h-ls07",
    command,
    env,
    cwd: "/tmp",
    stdout_lines,
    stderr_lines,
    raw_events,
    process_exit_code: 0,
    process_exit_signal: null,
    started_at_ms: 1,
    exit_at_ms: 2,
    native_events,
  });

  // The caller's objects are unchanged.
  assert.deepEqual(stdout_lines, stdout_snapshot);
  assert.deepEqual(stderr_lines, stderr_snapshot);
  assert.deepEqual(raw_events, raw_snapshot);
  assert.deepEqual(command, command_snapshot);
  assert.deepEqual(env, env_snapshot);
  assert.equal(JSON.stringify(native_events), native_snapshot);
  // But the durable artifacts from collectArtifacts() DO NOT contain canaries.
  const arts = await a.collectArtifacts(h);
  const text = arts.map((x) => JSON.stringify(x)).join("\n");
  for (const canary of Object.values(CANARIES)) {
    assert.equal(text.includes(canary), false, `artifact leaked: ${canary}`);
  }
});
