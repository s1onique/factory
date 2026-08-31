/**
 * FOUNDATION04 — controller keypair generator for tests.
 *
 * Writes a controller.key + controller.pub pair into the
 * specified control dir and prints both keys to stdout as JSON.
 */

import { promises as fs } from "node:fs";
import { generateEd25519Keypair } from "../../src/witness/witness-crypto.js";

function parseArgs(): { controlDir: string } {
  const argv = process.argv.slice(2);
  const m: Record<string, string> = {};
  for (let i = 0; i + 1 < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k !== undefined && v !== undefined) m[k.slice(2)] = v;
  }
  return { controlDir: m["control-dir"] ?? "/tmp" };
}

async function main(): Promise<void> {
  const args = parseArgs();
  try {
    await fs.mkdir(args.controlDir, { mode: 0o700 });
  } catch {
    // ignore
  }
  try {
    await fs.chmod(args.controlDir, 0o700);
  } catch {
    // ignore
  }
  const k = generateEd25519Keypair();
  await fs.writeFile(
    args.controlDir + "/controller.key",
    JSON.stringify({ version: 1, private_key: k.privateKeyHex }),
    { mode: 0o600 },
  );
  await fs.writeFile(
    args.controlDir + "/controller.pub",
    JSON.stringify({ version: 1, public_key: k.publicKeyHex }),
    { mode: 0o600 },
  );
  process.stdout.write(JSON.stringify({
    kind: "controller_keys",
    public_key: k.publicKeyHex,
    private_key: k.privateKeyHex,
    public_key_fingerprint: k.publicKeyFingerprint,
  }) + "\n");
}

void main();
