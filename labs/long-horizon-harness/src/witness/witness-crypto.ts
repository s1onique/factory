/**
 * FOUNDATION04 — Ed25519 cryptographic port.
 *
 * Pure protocol/domain code should not directly import node:crypto.
 * This module exposes a narrow WitnessSigner / WitnessVerifier
 * boundary. Production uses Ed25519 via node:crypto. Tests use
 * deterministic fake implementations.
 *
 * F04-D93: a narrow crypto adapter. The fake signer is mandatory
 * for unit tests of the projector and protocol codec; the real
 * signer is used for any test that exercises actual cryptography.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
  type KeyObject,
} from "node:crypto";

export type WitnessSigner = {
  /** Sign canonical bytes. Returns base64url-encoded signature. */
  sign(bytes: Uint8Array): string;
};

export type WitnessVerifier = {
  /** Verify a base64url-encoded signature over canonical bytes. */
  verify(bytes: Uint8Array, signatureB64: string): boolean;
};

// --------------------------------------------------------------------------
// Real Ed25519 adapter (production + AUTH01..AUTH05 tests)
// --------------------------------------------------------------------------

const ED25519_SPKI_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

/**
 * Generate a fresh Ed25519 keypair.
 *
 * Returns hex-encoded raw private/public keys plus the KeyObject
 * handles needed for the sign/verify adapters below.
 */
export function generateEd25519Keypair(): {
  readonly privateKeyHex: string;
  readonly publicKeyHex: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly publicKeyFingerprint: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubRaw = publicKey.export({ format: "jwk" }) as { x?: string };
  const privRaw = privateKey.export({ format: "jwk" }) as { d?: string };
  if (typeof pubRaw.x !== "string" || typeof privRaw.d !== "string") {
    throw new Error("Ed25519 JWK export missing x/d");
  }
  const publicKeyHex = base64UrlToHex(pubRaw.x);
  const privateKeyHex = base64UrlToHex(privRaw.d);
  const fingerprint = sha256Hex(Buffer.from(hexToBytes(publicKeyHex)));
  return {
    privateKeyHex,
    publicKeyHex,
    privateKey,
    publicKey,
    publicKeyFingerprint: fingerprint,
  };
}

/** Build a real WitnessSigner from a stored private-key hex. */
export function ed25519SignerFromPrivateHex(privateKeyHex: string): WitnessSigner {
  const priv = createPrivateKey({
    key: wrapEd25519Pkcs8(privateKeyHex),
    format: "der",
    type: "pkcs8",
  });
  return {
    sign(bytes) {
      const sig = cryptoSign(null, bytes, priv);
      return sig.toString("base64url");
    },
  };
}

/** Build a real WitnessVerifier from a stored public-key hex. */
export function ed25519VerifierFromPublicHex(publicKeyHex: string): WitnessVerifier {
  const pub = createPublicKey({
    key: wrapEd25519Spki(publicKeyHex),
    format: "der",
    type: "spki",
  });
  return {
    verify(bytes, signatureB64) {
      try {
        const sig = Buffer.from(signatureB64, "base64url");
        return cryptoVerify(null, bytes, pub, sig);
      } catch {
        return false;
      }
    },
  };
}

/** Build a real WitnessSigner from a KeyObject (in-memory). */
export function ed25519SignerFromKey(priv: KeyObject): WitnessSigner {
  return {
    sign(bytes) {
      const sig = cryptoSign(null, bytes, priv);
      return sig.toString("base64url");
    },
  };
}

/** Build a real WitnessVerifier from a KeyObject (in-memory). */
export function ed25519VerifierFromKey(pub: KeyObject): WitnessVerifier {
  return {
    verify(bytes, signatureB64) {
      try {
        const sig = Buffer.from(signatureB64, "base64url");
        return cryptoVerify(null, bytes, pub, sig);
      } catch {
        return false;
      }
    },
  };
}

/**
 * Sign with a KeyObject directly. Type-erased because KeyObject's
 * `sign` method is not part of its public TypeScript surface in
 * some Node versions, but it exists at runtime for Ed25519 keys.
 */
export function signWithKeyObject(priv: KeyObject, bytes: Uint8Array): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (priv as unknown as { sign: (b: Uint8Array) => Buffer }).sign.bind(priv);
  return fn(bytes);
}

// --------------------------------------------------------------------------
// Deterministic fake adapter (for pure tests)
// --------------------------------------------------------------------------

/**
 * A deterministic fake signer/verifier pair.
 *
 * The signature is SHA-256 over the canonical bytes + a static key.
 * The verifier returns true iff the supplied signature equals the
 * expected deterministic value.
 *
 * This is NOT a secure signature scheme. It exists so pure tests
 * of the projector and command-idempotency policy can be written
 * without depending on Ed25519 + node:crypto at all.
 */
export function fakeSignerVerifierPair(): {
  readonly signer: WitnessSigner;
  readonly verifier: WitnessVerifier;
  readonly fingerprint: string;
} {
  const key = Buffer.from("deterministic-fake-witness-key-v1", "utf8");
  const fp = sha256Hex(key);
  return {
    fingerprint: fp,
    signer: {
      sign(bytes) {
        return fakeSign(bytes, key).toString("base64url");
      },
    },
    verifier: {
      verify(bytes, signatureB64) {
        let sig: Buffer;
        try {
          sig = Buffer.from(signatureB64, "base64url");
        } catch {
          return false;
        }
        const expected = fakeSign(bytes, key);
        return sig.length === expected.length && timingSafeEqual(sig, expected);
      },
    },
  };
}

function fakeSign(bytes: Uint8Array, key: Buffer): Buffer {
  return createHash("sha256").update(key).update(bytes).digest();
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

// --------------------------------------------------------------------------
// Helpers (kept module-local)
// --------------------------------------------------------------------------

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function base64UrlToHex(s: string): string {
  return Buffer.from(s, "base64url").toString("hex");
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hex string must have even length");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Ed25519 private keys in node:crypto require a PKCS#8 DER wrapper. */
function wrapEd25519Pkcs8(rawHex: string): Buffer {
  const raw = hexToBytes(rawHex);
  if (raw.length !== 32) {
    throw new Error("Ed25519 private seed must be 32 bytes");
  }
  const prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
    0x04, 0x22, 0x04, 0x20,
  ]);
  return Buffer.concat([prefix, raw]);
}

function wrapEd25519Spki(rawHex: string): Buffer {
  const raw = hexToBytes(rawHex);
  if (raw.length !== 32) {
    throw new Error("Ed25519 public key must be 32 bytes");
  }
  return Buffer.concat([ED25519_SPKI_PREFIX, raw]);
}
