/**
 * Trust-boundary gate: search new lab production code for unsafe escape hatches.
 *
 * Allowed:
 *  - JSON.parse(...) — parser internals. The result must remain `unknown`
 *    and be passed through the decoder before becoming trusted.
 *
 * Disallowed in production source (src/**):
 *  - explicit `any`
 *  - `<any>` or `as any`
 *  - `@ts-ignore` / `@ts-nocheck`
 *  - non-null assertion `!.`
 *  - double-bang `!!`
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SRC = path.join(ROOT, "src");

const PATTERNS: ReadonlyArray<{ readonly name: string; readonly regex: RegExp }> = [
  { name: "explicit any", regex: /:\s*any\b/ },
  { name: "as any", regex: /\bas\s+any\b/ },
  { name: "<any>", regex: /<any>/ },
  { name: "@ts-ignore", regex: /@ts-ignore/ },
  { name: "@ts-nocheck", regex: /@ts-nocheck/ },
  { name: "non-null assertion", regex: /[^=!<>]!\.\B|\)!\.\B/ },
  { name: "double-bang", regex: /[^=!<>]!!\B|\)!!\B/ },
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

function stripStringsAndComments(src: string): string {
  // Strip single-line comments.
  let out = src.replace(/\/\/[^\n]*/g, "");
  // Strip block comments.
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip string literals (single, double, template). Naive but enough.
  out = out.replace(/"([^"\\\n]|\\.)*"/g, '""');
  out = out.replace(/'([^'\\\n]|\\.)*'/g, "''");
  out = out.replace(/`([^`\\]|\\.)*`/g, "``");
  return out;
}

test("trust-boundary: no unsafe escape hatches in src/", async () => {
  const files = await listTsFiles(SRC);
  assert.ok(files.length > 0);
  const hits: string[] = [];
  for (const f of files) {
    const raw = await fs.readFile(f, "utf8");
    const src = stripStringsAndComments(raw);
    for (const p of PATTERNS) {
      const m = p.regex.exec(src);
      if (m) {
        hits.push(`${path.relative(ROOT, f)}: ${p.name}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(
    hits,
    [],
    `unsafe escape hatches found:\n${hits.join("\n")}`,
  );
});

test("JSON.parse is allowed only in codec and ledger (the trust boundary)", async () => {
  const files = await listTsFiles(SRC);
  const allowedFiles = new Set([
    "src/evidence/codec-decode-envelope.ts",
    "src/evidence/ledger-internals.ts",
    "src/evidence/jsonl-ledger.ts",
    "src/witness/witness-codec-decode.ts",
    // FOUNDATION04 CORRECTION01: LedgerWriter is its own
    // trust boundary. The server parses incoming framed
    // requests; the client parses incoming framed responses;
    // the dedup module parses its own durable sidecar file;
    // the canonicalize module parses persisted lines back
    // for dedup-index recovery; the socket-probe module
    // parses who_are_you responses.
    // Adding them here matches the original
    // witness-codec-decode.ts precedent: each surface that
    // speaks to/from the wire or to/from durable storage
    // gets exactly one JSON.parse site.
    "src/ledger-writer/ledger-writer-server.ts",
    "src/ledger-writer/ledger-writer-client.ts",
    "src/ledger-writer/ledger-writer-dedup.ts",
    "src/ledger-writer/ledger-writer-canonicalize.ts",
    "src/ledger-writer/ledger-writer-socket-probe.ts",
  ]);
  const hits: string[] = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const src = await fs.readFile(f, "utf8");
    if (/JSON\.parse/.test(src) && !allowedFiles.has(rel)) {
      hits.push(rel);
    }
  }
  assert.deepEqual(hits, [], `JSON.parse outside trust boundary in: ${hits.join(", ")}`);
});
