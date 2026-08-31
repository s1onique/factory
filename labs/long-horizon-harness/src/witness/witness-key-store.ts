/**
 * FOUNDATION04 — durable controller-key file primitive.
 *
 * Implements the F04-D11 / D12 contract:
 *   - create temporary file (mode 0600)
 *   - write complete key
 *   - fsync file
 *   - close
 *   - atomic rename
 *   - fsync parent directory
 *
 * The store refuses to write a file whose target path is an
 * attacker-controlled symlink. Unexpected wider permissions FAIL
 * CLOSED (F04-D12).
 */

import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as path from "node:path";
import { open as fsOpen } from "node:fs/promises";
import { decodeJsonText } from "./witness-codec-decode.js";
import type { WitnessSigner } from "./witness-crypto.js";
import { ed25519SignerFromPrivateHex } from "./witness-crypto.js";

export type KeyStoreError =
  | { readonly kind: "directory_unreadable"; readonly path: string; readonly message: string }
  | { readonly kind: "directory_wrong_mode"; readonly path: string; readonly observed: number }
  | { readonly kind: "key_wrong_mode"; readonly path: string; readonly observed: number }
  | { readonly kind: "key_missing" }
  | { readonly kind: "key_symlink"; readonly path: string }
  | { readonly kind: "key_unreadable"; readonly path: string; readonly message: string }
  | { readonly kind: "key_malformed"; readonly reason: string }
  | { readonly kind: "fsync_failed"; readonly message: string };

export type KeyStoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KeyStoreError };

const CONTROLLER_KEY_FILENAME = "controller.key";
const EXPECTED_KEY_MODE = 0o600;
const EXPECTED_DIR_MODE = 0o700;

/**
 * The shape of a persisted controller key file.
 *
 * v1 format: JSON with `{"version":1,"private_key":"<hex>"}`.
 */
export type ControllerKeyFile = {
  readonly version: 1;
  readonly private_key: string;
};

/**
 * Ensure the control directory exists with mode 0700.
 */
export async function ensureControlDir(dir: string): Promise<KeyStoreResult<void>> {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        error: { kind: "directory_unreadable", path: dir, message: "not a directory" },
      };
    }
    const mode = stat.mode & 0o777;
    if (mode !== EXPECTED_DIR_MODE) {
      return {
        ok: false,
        error: { kind: "directory_wrong_mode", path: dir, observed: mode },
      };
    }
    return { ok: true, value: undefined };
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== "ENOENT") {
      return {
        ok: false,
        error: { kind: "directory_unreadable", path: dir, message: String(e) },
      };
    }
  }
  await fs.mkdir(dir, { mode: EXPECTED_DIR_MODE, recursive: false });
  try {
    const fh = await openForSync(dir);
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch (e: unknown) {
    return {
      ok: false,
      error: { kind: "fsync_failed", message: e instanceof Error ? e.message : String(e) },
    };
  }
  return { ok: true, value: undefined };
}

async function openForSync(dir: string): Promise<FileHandle> {
  return await fsOpen(dir, "r");
}

/**
 * Read the controller key file. Validates mode 0600, refuses
 * symlinks, refuses malformed payloads.
 */
export async function readControllerKey(dir: string): Promise<KeyStoreResult<WitnessSigner>> {
  const full = path.join(dir, CONTROLLER_KEY_FILENAME);
  try {
    const stat = await fs.stat(full);
    if (stat.isSymbolicLink()) {
      return { ok: false, error: { kind: "key_symlink", path: full } };
    }
    const mode = stat.mode & 0o777;
    if (mode !== EXPECTED_KEY_MODE) {
      return { ok: false, error: { kind: "key_wrong_mode", path: full, observed: mode } };
    }
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "ENOENT") {
      return { ok: false, error: { kind: "key_missing" } };
    }
    return {
      ok: false,
      error: { kind: "key_unreadable", path: full, message: e instanceof Error ? e.message : String(e) },
    };
  }
  let raw: string;
  try {
    raw = await fs.readFile(full, "utf8");
  } catch (e: unknown) {
    return {
      ok: false,
      error: { kind: "key_unreadable", path: full, message: e instanceof Error ? e.message : String(e) },
    };
  }
  const parsed: unknown = decodeJsonText(raw);
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: { kind: "key_malformed", reason: "root must be object" } };
  }
  const o = parsed as Record<string, unknown>;
  if (o["version"] !== 1) {
    return { ok: false, error: { kind: "key_malformed", reason: "version must be 1" } };
  }
  if (typeof o["private_key"] !== "string") {
    return { ok: false, error: { kind: "key_malformed", reason: "private_key must be string" } };
  }
  return {
    ok: true,
    value: ed25519SignerFromPrivateHex(o["private_key"]),
  };
}

/**
 * Persist a controller key with full durability semantics.
 *
 * Atomic-rename pattern with 0600 mode + parent fsync.
 */
export async function writeControllerKey(
  dir: string,
  privateKeyHex: string,
): Promise<KeyStoreResult<WitnessSigner>> {
  const ensured = await ensureControlDir(dir);
  if (!ensured.ok) return ensured;

  const full = path.join(dir, CONTROLLER_KEY_FILENAME);
  const tmp = `${full}.tmp.${process.pid}.${Date.now()}`;

  let fh: FileHandle | null = null;
  try {
    fh = await fs.open(tmp, "wx", EXPECTED_KEY_MODE);
    const body = JSON.stringify({ version: 1, private_key: privateKeyHex } satisfies ControllerKeyFile);
    await fh.writeFile(body, "utf8");
    await fh.sync();
    await fh.close();
    fh = null;
    await fs.rename(tmp, full);
  } catch (e: unknown) {
    if (fh !== null) {
      await fh.close().catch(() => undefined);
    }
    await fs.rm(tmp, { force: true });
    return {
      ok: false,
      error: { kind: "fsync_failed", message: e instanceof Error ? e.message : String(e) },
    };
  }
  try {
    const dfh = await openForSync(dir);
    try {
      await dfh.sync();
    } finally {
      await dfh.close();
    }
  } catch (e: unknown) {
    return {
      ok: false,
      error: { kind: "fsync_failed", message: e instanceof Error ? e.message : String(e) },
    };
  }
  return {
    ok: true,
    value: ed25519SignerFromPrivateHex(privateKeyHex),
  };
}
