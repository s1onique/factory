/**
 * Domain purity gate: domain code MUST NOT import Node-specific facilities.
 *
 * Doctrine D29: the domain layer must be independently deterministic.
 * This test is a mechanical gate, not a guarantee of correctness, but it
 * fails closed if anyone reintroduces fs/path/child_process/process/os/
 * net/http imports into the domain layer.
 *
 * Test code itself uses node:fs; the gate is restricted to production
 * source under src/domain and src/protocol.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DOMAIN_DIR = path.join(ROOT, "src", "domain");
const PROTOCOL_DIR = path.join(ROOT, "src", "protocol");
const ADAPTERS_DIR = path.join(ROOT, "src", "adapters");

const FORBIDDEN_MODULES = [
  "node:fs",
  "node:path",
  "node:child_process",
  "node:process",
  "node:os",
  "node:net",
  "node:http",
  "fs",
  "path",
  "child_process",
  "process",
  "os",
  "net",
  "http",
];

async function listTsFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        out.push(...(await listTsFiles(path.join(dir, e.name))));
      } else if (e.name.endsWith(".ts")) {
        out.push(path.join(dir, e.name));
      }
    }
    return out;
  } catch {
    return [];
  }
}

function checkImports(filePath: string, source: string): string[] {
  const hits: string[] = [];
  for (const line of source.split("\n")) {
    const m = /from\s+["']([^"']+)["']/.exec(line);
    if (!m) continue;
    const target = m[1] ?? "";
    if (target.startsWith(".")) continue;
    for (const forbidden of FORBIDDEN_MODULES) {
      if (target === forbidden || target.startsWith(forbidden + "/")) {
        hits.push(`${filePath}: ${target}`);
      }
    }
  }
  return hits;
}

test("domain layer is free of node-specific imports", async () => {
  const files = await listTsFiles(DOMAIN_DIR);
  assert.ok(files.length > 0, "expected at least one domain file");
  const hits: string[] = [];
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    hits.push(...checkImports(f, src));
  }
  assert.deepEqual(hits, [], `forbidden imports found: ${hits.join("\n")}`);
});

test("protocol layer is free of node-specific imports", async () => {
  const files = await listTsFiles(PROTOCOL_DIR);
  if (files.length === 0) return; // none yet; vacuously clean
  const hits: string[] = [];
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    hits.push(...checkImports(f, src));
  }
  assert.deepEqual(hits, [], `forbidden imports found: ${hits.join("\n")}`);
});

test("fake adapter layer is free of node-specific imports", async () => {
  const files = await listTsFiles(ADAPTERS_DIR);
  if (files.length === 0) return;
  const hits: string[] = [];
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    hits.push(...checkImports(f, src));
  }
  assert.deepEqual(hits, [], `forbidden imports found: ${hits.join("\n")}`);
});
