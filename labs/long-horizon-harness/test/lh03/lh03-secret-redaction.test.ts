/**
 * LH-03 §9 — Secret redaction.
 *
 * Required canary tests:
 *   SECRET01 stdout
 *   SECRET02 stderr
 *   SECRET03 native JSON field
 *   SECRET04 command arguments
 *   SECRET05 environment metadata
 *
 * Required oracle:
 *   CANARY_PRESENT_IN_COMMITTED_FIXTURE = FALSE
 *   STRUCTURAL_REPLAY_AFTER_REDACTION  = PASS
 *
 * Negative-corpus tests:
 *   HNEG08 secret canary in stdout
 *   HNEG09 secret canary in stderr
 *   HNEG10 secret canary in JSON field
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  redactText,
  redactEnv,
  redactArgv,
  redactJsonRecord,
  SECRET_REDACTION_TOKEN,
  isSensitiveEnvName,
} from "../../src/redaction/secret-redaction.js";

const CANARIES = {
  bearer: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  openai: "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
  aws: "AKIAIOSFODNN7EXAMPLE",
  github: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
};

test("LH03-SECRET01: stdout bearer token is redacted (HNEG08)", () => {
  const stdout = `Working on it.\nAuthorization: ${CANARIES.bearer}\nDone.`;
  const out = redactText(stdout);
  assert.equal(out.includes(CANARIES.bearer), false);
  assert.equal(out.includes(SECRET_REDACTION_TOKEN), true);
});

test("LH03-SECRET01b: stdout OpenAI key is redacted", () => {
  const out = redactText(`model loaded with key ${CANARIES.openai}`);
  assert.equal(out.includes(CANARIES.openai), false);
  assert.equal(out.includes(SECRET_REDACTION_TOKEN), true);
});

test("LH03-SECRET02: stderr AWS access key is redacted (HNEG09)", () => {
  const stderr = `error: cannot authenticate with ${CANARIES.aws}`;
  const out = redactText(stderr);
  assert.equal(out.includes(CANARIES.aws), false);
  assert.equal(out.includes(SECRET_REDACTION_TOKEN), true);
});

test("LH03-SECRET03: native JSON field 'apiKey' is redacted (HNEG10)", () => {
  const rec = {
    type: "auth",
    apiKey: CANARIES.openai,
    nested: {
      api_key: CANARIES.bearer,
      safe: "leave me",
    },
  };
  const out = redactJsonRecord(rec);
  assert.equal(out["apiKey"], SECRET_REDACTION_TOKEN);
  assert.equal(
    (out["nested"] as Record<string, unknown>)["api_key"],
    SECRET_REDACTION_TOKEN,
  );
  assert.equal((out["nested"] as Record<string, unknown>)["safe"], "leave me");
});

test("LH03-SECRET04: CLI --api-key=<value> is redacted but flag preserved", () => {
  const argv = [
    "pi",
    "--api-key",
    CANARIES.openai,
    "--provider",
    "openai",
    "--mode", "json",
  ];
  const out = redactArgv(argv);
  assert.deepEqual(out, [
    "pi",
    "--api-key",
    SECRET_REDACTION_TOKEN,
    "--provider",
    "openai",
    "--mode", "json",
  ]);
});

test("LH03-SECRET04b: CLI --token=<value>=<val> form is redacted", () => {
  const argv = [
    "pi",
    `--token=${CANARIES.github}`,
  ];
  const out = redactArgv(argv);
  assert.deepEqual(out, [
    "pi",
    `--token=${SECRET_REDACTION_TOKEN}`,
  ]);
});

test("LH03-SECRET05: env metadata with sensitive names is redacted", () => {
  const env = {
    OPENAI_API_KEY: CANARIES.openai,
    ANTHROPIC_API_KEY: CANARIES.bearer,
    AWS_ACCESS_KEY_ID: CANARIES.aws,
    GITHUB_TOKEN: CANARIES.github,
    PATH: "/usr/bin",
    HOME: "/home/u",
  };
  const out = redactEnv(env);
  assert.equal(out["OPENAI_API_KEY"], SECRET_REDACTION_TOKEN);
  assert.equal(out["ANTHROPIC_API_KEY"], SECRET_REDACTION_TOKEN);
  assert.equal(out["AWS_ACCESS_KEY_ID"], SECRET_REDACTION_TOKEN);
  assert.equal(out["GITHUB_TOKEN"], SECRET_REDACTION_TOKEN);
  assert.equal(out["PATH"], "/usr/bin");
  assert.equal(out["HOME"], "/home/u");
});

test("LH03-SECRET06: structural replay — JSON can be re-parsed after redaction", () => {
  const original = JSON.stringify({
    type: "session",
    id: "01a0b17b-XXXX",
    timestamp: "2026-09-17T22:00:00Z",
    cwd: "/tmp",
  });
  // The session envelope has no sensitive fields; redaction
  // MUST still produce valid JSON.
  const rec = JSON.parse(original) as Record<string, unknown>;
  const out = redactJsonRecord(rec);
  const re = JSON.stringify(out);
  const reparsed = JSON.parse(re) as Record<string, unknown>;
  assert.equal(reparsed["type"], "session");
  assert.equal(reparsed["id"], "01a0b17b-XXXX");
});

test("LH03-SECRET07: isSensitiveEnvName covers provider env names", () => {
  assert.equal(isSensitiveEnvName("OPENAI_API_KEY"), true);
  assert.equal(isSensitiveEnvName("ANTHROPIC_API_KEY"), true);
  assert.equal(isSensitiveEnvName("AWS_SECRET_ACCESS_KEY"), true);
  assert.equal(isSensitiveEnvName("PATH"), false);
  assert.equal(isSensitiveEnvName("HOME"), false);
});

test("LH03-SECRET08: redacted fixture contains no canary tokens (HNEG08-10 oracle)", () => {
  // Simulate the structural redaction of a fixture:
  const stdout = `session\n${CANARIES.bearer}\n${CANARIES.openai}`;
  const stderr = `key=${CANARIES.aws}\n${CANARIES.github}`;
  const rec = {
    type: "auth",
    apiKey: CANARIES.openai,
    nested: { bearer: CANARIES.bearer },
  };
  const argv = ["pi", "--api-key", CANARIES.openai];
  const env = { OPENAI_API_KEY: CANARIES.openai };
  const redactedStdout = redactText(stdout);
  const redactedStderr = redactText(stderr);
  const redactedRecord = redactJsonRecord(rec);
  const redactedArgv = redactArgv(argv);
  const redactedEnv = redactEnv(env);
  const blob = [
    redactedStdout,
    redactedStderr,
    JSON.stringify(redactedRecord),
    JSON.stringify(redactedArgv),
    JSON.stringify(redactedEnv),
  ].join("\n");
  for (const v of Object.values(CANARIES)) {
    assert.equal(blob.includes(v), false, `canary leaked: ${v.slice(0, 8)}...`);
  }
});
