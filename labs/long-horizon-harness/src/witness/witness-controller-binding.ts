/**
 * FOUNDATION04 — Phase C minimal primitive.
 *
 * Controller-binding primitive.
 *
 * Doctrine (controller-binding law):
 *
 *   Controller authority is loaded and validated ONCE
 *   at witness bootstrap, fingerprinted durably, and
 *   remains immutable for the lifetime of that witness
 *   instance. Command handling MUST NOT re-read mutable
 *   controller identity from disk.
 *
 * This module owns:
 *   - the authoritative path (`<controlDir>/controller.pub`)
 *   - the filesystem safety checks (lstat; reject symlink,
 *     non-regular, missing, wrong/unsafe mode, malformed
 *     JSON, wrong version, missing public_key, invalid
 *     public-key encoding)
 *   - the canonical public-key fingerprint
 *   - the immutable `ControllerIdentityBinding` returned
 *     to the witness runtime
 *
 * The witness runtime invokes `loadControllerIdentity`
 * exactly once during bootstrap and threads the binding
 * through every subsequent decision (witness_ready payload,
 * `controllerPublicKeyFingerprint` in `WitnessRuntimeContext`,
 * command-handshake summaries, etc.).
 *
 * No second cryptographic implementation is introduced here.
 * The fingerprint is computed as `sha256(raw public-key
 * bytes)`, mirroring `witness-crypto.ts` (the witness key
 * fingerprint uses the same formula). Public-key encoding
 * validation reuses the same `hexToBytes` semantics; the
 * raw key material is what is fingerprinted, not the JSON
 * file content, so formatting variation in `controller.pub`
 * cannot mutate the fingerprint.
 */
import { promises as fs, type Stats } from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";

import {
  ed25519VerifierFromPublicHex,
  type WitnessVerifier,
} from "./witness-crypto.js";

export type ControllerIdentityError =
  | { readonly kind: "missing"; readonly path: string }
  | { readonly kind: "symlink"; readonly path: string }
  | { readonly kind: "not_regular"; readonly path: string }
  | { readonly kind: "read_failed"; readonly path: string; readonly message: string }
  | { readonly kind: "malformed_json"; readonly path: string; readonly message: string }
  | { readonly kind: "wrong_version"; readonly path: string; readonly observed: unknown }
  | { readonly kind: "missing_public_key"; readonly path: string }
  | { readonly kind: "invalid_public_key"; readonly path: string; readonly message: string }
  | { readonly kind: "unsafe_permissions"; readonly path: string; readonly mode: number };

export function controllerPublicKeyPath(controlDir: string): string {
  return path.join(controlDir, "controller.pub");
}

const CONTROLLER_PUB_GROUP_OTHER_MASK = 0o077;

function unsafeModeBits(s: Stats): number {
  return (s.mode & 0o777) & CONTROLLER_PUB_GROUP_OTHER_MASK;
}

function isLikelyHexKey(s: string): boolean {
  if (s.length !== 64) return false;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    const isDigit = c >= 0x30 && c <= 0x39;
    const isLower = c >= 0x61 && c <= 0x66;
    const isUpper = c >= 0x41 && c <= 0x46;
    if (!isDigit && !isLower && !isUpper) return false;
  }
  return true;
}

function fingerprintOfHex(publicKeyHex: string): string {
  const buf = Buffer.from(publicKeyHex, "hex");
  return createHash("sha256").update(buf).digest("hex");
}

export type ControllerIdentityBinding = {
  readonly publicKeyHex: string;
  readonly publicKeyFingerprint: string;
  readonly sourcePath: string;
  /**
   * Immutable verification authority. Captured ONCE
   * at bootstrap. After bootstrap, the witness MUST
   * verify signed commands against this verifier, not
   * by re-reading the controller.pub file from disk.
   */
  readonly verifier: WitnessVerifier;
};

export async function loadControllerIdentity(
  controlDir: string,
): Promise<
  | { readonly ok: true; readonly value: ControllerIdentityBinding }
  | { readonly ok: false; readonly error: ControllerIdentityError }
> {
  const p = controllerPublicKeyPath(controlDir);
  let stat: Stats;
  try {
    stat = await fs.lstat(p);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "ENOENT") {
      return { ok: false, error: { kind: "missing", path: p } };
    }
    return {
      ok: false,
      error: {
        kind: "read_failed",
        path: p,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  if (stat.isSymbolicLink()) {
    return { ok: false, error: { kind: "symlink", path: p } };
  }
  if (!stat.isFile()) {
    return { ok: false, error: { kind: "not_regular", path: p } };
  }
  if (unsafeModeBits(stat) !== 0) {
    return {
      ok: false,
      error: { kind: "unsafe_permissions", path: p, mode: stat.mode & 0o777 },
    };
  }
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        kind: "read_failed",
        path: p,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    return {
      ok: false,
      error: {
        kind: "malformed_json",
        path: p,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
  if (!isControllerPubRecord(parsed)) {
    return {
      ok: false,
      error: { kind: "malformed_json", path: p, message: "not an object" },
    };
  }
  if (parsed.version !== 1) {
    return {
      ok: false,
      error: { kind: "wrong_version", path: p, observed: parsed.version },
    };
  }
  if (typeof parsed.public_key !== "string" || parsed.public_key.length === 0) {
    return { ok: false, error: { kind: "missing_public_key", path: p } };
  }
  // Trim incidental whitespace (newlines from JSON
  // pretty-printing, etc.) before validating the
  // canonical 64-char hex form. The fingerprint is
  // computed over the trimmed raw bytes.
  const trimmed = parsed.public_key.trim();
  if (!isLikelyHexKey(trimmed)) {
    return {
      ok: false,
      error: {
        kind: "invalid_public_key",
        path: p,
        message: "public_key is not a 64-char hex string",
      },
    };
  }
  return {
    ok: true,
    value: {
      publicKeyHex: trimmed,
      publicKeyFingerprint: fingerprintOfHex(trimmed),
      sourcePath: p,
      verifier: ed25519VerifierFromPublicHex(trimmed),
    },
  };
}

function isControllerPubRecord(x: unknown): x is {
  version: unknown;
  public_key: unknown;
} {
  return typeof x === "object" && x !== null;
}
