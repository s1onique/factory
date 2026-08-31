/**
 * FOUNDATION04 — test helpers for signing with a raw Ed25519 seed.
 */

import { createPrivateKey, sign as cryptoSign } from "node:crypto";

const PKCS8_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export function makePrivateKeySigner(privateKeyHex: string): {
  sign(bytes: Uint8Array): string;
} {
  if (privateKeyHex.length !== 64) {
    throw new Error("Ed25519 private key hex must be 64 chars");
  }
  const seed = Buffer.from(privateKeyHex, "hex");
  const pkcs8 = Buffer.concat([PKCS8_PREFIX, seed]);
  const k = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  return {
    sign(bytes) {
      const sig = cryptoSign(null, bytes, k);
      return sig.toString("base64url");
    },
  };
}
