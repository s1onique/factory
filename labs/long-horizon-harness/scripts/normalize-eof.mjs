#!/usr/bin/env node
/**
 * Ensure every lab text file ends with exactly one LF.
 *
 * Run from the lab root. Walks README.md, package.json, .gitignore,
 * tsconfig.json, src/**, test/**, scripts/**, and appends a single
 * LF to any file that does not end with one. Idempotent.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LAB = path.resolve(HERE, "..");

const roots = ["src", "test", "scripts"];
const singles = ["README.md", "package.json", ".gitignore", "tsconfig.json"];

async function walk(rel) {
  const abs = path.join(LAB, rel);
  const out = [];
  try {
    const stat = await fs.stat(abs);
    if (stat.isFile()) return [abs];
    for (const e of await fs.readdir(abs, { recursive: true, withFileTypes: true })) {
      if (!e.isFile()) continue;
      out.push(path.join(e.parentPath, e.name));
    }
  } catch {
    // skip missing roots
  }
  return out;
}

async function normalizeOne(abs) {
  const bytes = await fs.readFile(abs);
  if (bytes.length === 0) return false;
  // Strip any trailing LF(s), then append exactly one.
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0x0a) end--;
  const trimmed = bytes.subarray(0, end);
  const target = Buffer.concat([trimmed, Buffer.from([0x0a])]);
  if (
    target.length === bytes.length &&
    target[bytes.length - 1] === 0x0a &&
    bytes[bytes.length - 1] === 0x0a
  ) {
    return false;
  }
  await fs.writeFile(abs, target);
  return true;
}

async function main() {
  const files = new Set();
  for (const s of singles) {
    files.add(path.join(LAB, s));
  }
  for (const r of roots) {
    for (const f of await walk(r)) files.add(f);
  }
  let changed = 0;
  for (const f of files) {
    if (await normalizeOne(f)) changed++;
  }
  console.log(`normalized EOF on ${changed} of ${files.size} files`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
