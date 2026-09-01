/**
 * FOUNDATION04 — PHASE A FINAL CLOSURE — CTRL01..10.
 *
 *   Controller-binding law (Phase C minimal primitive).
 *
 * Doctrine:
 *   Controller authority is loaded and validated ONCE
 *   at witness bootstrap, fingerprinted durably, and
 *   remains immutable for the lifetime of that witness
 *   instance. Command handling MUST NOT re-read mutable
 *   controller identity from disk.
 *
 * These tests are pure (no live process), zero-skip.
 * They exercise the SINGLE source of truth:
 * `loadControllerIdentity` from
 * `witness/witness-controller-binding.ts`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  controllerPublicKeyPath,
  loadControllerIdentity,
  type ControllerIdentityBinding,
} from "../../src/witness/witness-controller-binding.js";
import { generateEd25519Keypair } from "../../src/witness/witness-crypto.js";
import { createHash } from "node:crypto";

async function mkControlDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), ".ctrl-"));
}

async function writeValidControllerPub(
  controlDir: string,
  pubHex: string,
  mode: number = 0o600,
): Promise<string> {
  const p = controllerPublicKeyPath(controlDir);
  await fs.writeFile(
    p,
    JSON.stringify({ version: 1, public_key: pubHex }),
    { mode },
  );
  return p;
}

function sha256HexOfKey(pubHex: string): string {
  return createHash("sha256").update(Buffer.from(pubHex, "hex")).digest("hex");
}

test("CTRL01: valid controller.pub yields a typed ControllerIdentityBinding", async () => {
  const controlDir = await mkControlDir();
  const kp = generateEd25519Keypair();
  await writeValidControllerPub(controlDir, kp.publicKeyHex);
  const r = await loadControllerIdentity(controlDir);
  assert.equal(r.ok, true, "CTRL01: loadControllerIdentity must succeed");
  if (!r.ok) return;
  const v: ControllerIdentityBinding = r.value;
  assert.equal(v.publicKeyHex, kp.publicKeyHex,
    "CTRL01: publicKeyHex must equal what was written");
  assert.equal(v.publicKeyFingerprint, sha256HexOfKey(kp.publicKeyHex),
    "CTRL01: fingerprint must equal sha256(raw pubkey bytes)");
  assert.equal(v.sourcePath, controllerPublicKeyPath(controlDir),
    "CTRL01: sourcePath must be the canonical controller.pub path");
});

test("CTRL02: missing controller.pub returns typed 'missing' error", async () => {
  const controlDir = await mkControlDir();
  const r = await loadControllerIdentity(controlDir);
  assert.equal(r.ok, false, "CTRL02: loadControllerIdentity must fail");
  if (r.ok) return;
  assert.equal(r.error.kind, "missing",
    "CTRL02: error.kind must be 'missing' (typed boundary)");
  assert.equal(r.error.path, controllerPublicKeyPath(controlDir),
    "CTRL02: error.path must be the canonical controller.pub path");
});

test("CTRL03: controller.pub symlink fails closed (lstat rejects)", async () => {
  const controlDir = await mkControlDir();
  const kp = generateEd25519Keypair();
  const real = path.join(controlDir, "real.pub");
  await fs.writeFile(real,
    JSON.stringify({ version: 1, public_key: kp.publicKeyHex }),
    { mode: 0o600 },
  );
  await fs.symlink(real, controllerPublicKeyPath(controlDir));
  const r = await loadControllerIdentity(controlDir);
  assert.equal(r.ok, false, "CTRL03: symlink must be rejected");
  if (r.ok) return;
  assert.equal(r.error.kind, "symlink",
    "CTRL03: error.kind must be 'symlink'");
});

test("CTRL04: malformed JSON fails closed", async () => {
  const controlDir = await mkControlDir();
  const p = controllerPublicKeyPath(controlDir);
  await fs.writeFile(p, "{ not valid json", { mode: 0o600 });
  const r = await loadControllerIdentity(controlDir);
  assert.equal(r.ok, false, "CTRL04: malformed JSON must be rejected");
  if (r.ok) return;
  assert.equal(r.error.kind, "malformed_json",
    "CTRL04: error.kind must be 'malformed_json'");
});

test("CTRL05: malformed public_key (not 64-char hex) fails closed", async () => {
  const controlDir = await mkControlDir();
  const p = controllerPublicKeyPath(controlDir);
  await fs.writeFile(p,
    JSON.stringify({ version: 1, public_key: "not-hex" }),
    { mode: 0o600 },
  );
  const r = await loadControllerIdentity(controlDir);
  assert.equal(r.ok, false, "CTRL05: invalid key must be rejected");
  if (r.ok) return;
  assert.equal(r.error.kind, "invalid_public_key",
    "CTRL05: error.kind must be 'invalid_public_key'");
});

test("CTRL05b: missing public_key field fails closed", async () => {
  const controlDir = await mkControlDir();
  const p = controllerPublicKeyPath(controlDir);
  await fs.writeFile(p, JSON.stringify({ version: 1 }), { mode: 0o600 });
  const r = await loadControllerIdentity(controlDir);
  assert.equal(r.ok, false, "CTRL05b: missing public_key must be rejected");
  if (r.ok) return;
  assert.equal(r.error.kind, "missing_public_key",
    "CTRL05b: error.kind must be 'missing_public_key'");
});

test("CTRL05c: wrong version fails closed", async () => {
  const controlDir = await mkControlDir();
  const kp = generateEd25519Keypair();
  const p = controllerPublicKeyPath(controlDir);
  await fs.writeFile(p,
    JSON.stringify({ version: 2, public_key: kp.publicKeyHex }),
    { mode: 0o600 },
  );
  const r = await loadControllerIdentity(controlDir);
  assert.equal(r.ok, false, "CTRL05c: wrong version must be rejected");
  if (r.ok) return;
  assert.equal(r.error.kind, "wrong_version",
    "CTRL05c: error.kind must be 'wrong_version'");
});

test("CTRL06: persisted fingerprint is stable across reloads (same key)", async () => {
  const controlDir = await mkControlDir();
  const kp = generateEd25519Keypair();
  await writeValidControllerPub(controlDir, kp.publicKeyHex);
  const r1 = await loadControllerIdentity(controlDir);
  const r2 = await loadControllerIdentity(controlDir);
  assert.equal(r1.ok, true, "CTRL06: first load must succeed");
  assert.equal(r2.ok, true, "CTRL06: second load must succeed");
  if (!r1.ok || !r2.ok) return;
  assert.equal(r1.value.publicKeyFingerprint,
    r2.value.publicKeyFingerprint,
    "CTRL06: fingerprint must be stable across loads of the same key");
});

test("CTRL07: fingerprint is sha256(decoded public-key bytes), not sha256 of JSON text", async () => {
  const controlDir = await mkControlDir();
  const kp = generateEd25519Keypair();
  const p = controllerPublicKeyPath(controlDir);
  const json = JSON.stringify({ version: 1, public_key: kp.publicKeyHex });
  await fs.writeFile(p, json, { mode: 0o600 });
  const r = await loadControllerIdentity(controlDir);
  assert.equal(r.ok, true, "CTRL07: must load");
  if (!r.ok) return;
  const jsonSha = createHash("sha256").update(Buffer.from(json, "utf8")).digest("hex");
  assert.notEqual(r.value.publicKeyFingerprint, jsonSha,
    "CTRL07: fingerprint must be over key bytes, not the JSON text");
  assert.equal(r.value.publicKeyFingerprint, sha256HexOfKey(kp.publicKeyHex),
    "CTRL07: fingerprint must equal sha256(raw pubkey bytes)");
});

test("CTRL09: equivalent key bytes with different formatting yield the same fingerprint", async () => {
  const controlDir = await mkControlDir();
  const kp = generateEd25519Keypair();
  const p = controllerPublicKeyPath(controlDir);
  await fs.writeFile(
    p,
    JSON.stringify({ version: 1, public_key: `  ${kp.publicKeyHex}\n` }),
    { mode: 0o600 },
  );
  const r = await loadControllerIdentity(controlDir);
  assert.equal(r.ok, true,
    "CTRL09: trimmed but valid hex must be accepted");
  if (!r.ok) return;
  assert.equal(r.value.publicKeyFingerprint,
    sha256HexOfKey(kp.publicKeyHex),
    "CTRL09: fingerprint must be sha256(raw bytes) regardless of formatting");
});

test("CTRL10: a captured binding is durable across file replacement", async () => {
  // The witness runtime uses ONE captured
  // ControllerIdentityBinding for the lifetime of the
  // process. This test models the invariant at the
  // loader level: a binding is a snapshot; replacing the
  // file does not retroactively mutate the binding.
  const controlDir = await mkControlDir();
  const kp = generateEd25519Keypair();
  await writeValidControllerPub(controlDir, kp.publicKeyHex);
  const r1 = await loadControllerIdentity(controlDir);
  const kp2 = generateEd25519Keypair();
  await writeValidControllerPub(controlDir, kp2.publicKeyHex);
  const r2 = await loadControllerIdentity(controlDir);
  assert.equal(r1.ok, true, "CTRL10: first load must succeed");
  assert.equal(r2.ok, true, "CTRL10: second load must succeed");
  if (!r1.ok || !r2.ok) return;
  assert.notEqual(r1.value.publicKeyFingerprint,
    r2.value.publicKeyFingerprint,
    "CTRL10: a re-load after file replacement MUST return a different fingerprint");
  assert.equal(r1.value.publicKeyHex, kp.publicKeyHex,
    "CTRL10: original binding must still reference the original key bytes");
});

test("CTRL08: a controller.pub replacement after bootstrap is not honoured by the witness runtime", async () => {
  // Doctrine: the witness's authority is the binding it
  // captured at bootstrap. A subsequent replacement of
  // the file MUST NOT retroactively grant authority to
  // a new key.
  //
  // Implementation: we run the loader twice with two
  // distinct keys, and we check the witness runtime
  // source to assert it threads the FIRST binding.
  // A more elaborate test would spawn a real witness
  // process; the source-level check below is the
  // load-bearing invariant for the lab.
  const controlDir = await mkControlDir();
  const kp1 = generateEd25519Keypair();
  await writeValidControllerPub(controlDir, kp1.publicKeyHex);
  const r1 = await loadControllerIdentity(controlDir);
  // Replace the file with a DIFFERENT key.
  const kp2 = generateEd25519Keypair();
  await writeValidControllerPub(controlDir, kp2.publicKeyHex);
  // Re-read would yield kp2; but the witness's
  // captured binding is r1.value, which is kp1.
  const r2 = await loadControllerIdentity(controlDir);
  assert.equal(r1.ok, true, "CTRL08: initial load must succeed");
  assert.equal(r2.ok, true, "CTRL08: re-load after swap must succeed");
  if (!r1.ok || !r2.ok) return;
  assert.equal(r1.value.publicKeyHex, kp1.publicKeyHex,
    "CTRL08: initial binding must reference the original key");
  assert.equal(r2.value.publicKeyHex, kp2.publicKeyHex,
    "CTRL08: re-load after swap references the new key — " +
    "but a witness holding the first binding is unaffected");

  // Source-level guard: the witness runtime must NOT
  // call loadControllerIdentity from any other call site
  // (e.g. per-command reload). If a future change adds
  // such a call, this test fails.
  const { promises: fs2 } = await import("node:fs");
  const path2 = await import("node:path");
  const runtimePath = path2.default.join(
    path2.default.dirname(new URL(import.meta.url).pathname),
    "..", "..", "src", "witness", "witness-runtime.ts",
  );
  const src = await fs2.readFile(runtimePath, "utf8");
  const matches = src.match(/loadControllerIdentity\s*\(/g) ?? [];
  assert.equal(matches.length, 1,
    "CTRL08: loadControllerIdentity must be called exactly once " +
    "in witness-runtime.ts (any additional call would re-read mutable " +
    "controller identity from disk and violate the controller-binding law). " +
    "Found " + matches.length + " occurrences.");
});
