/**
 * LH-04 deterministic fault laboratory — reusable
 * mutation helpers.
 *
 * Every helper mutates exactly one authority dimension
 * and leaves every other dimension untouched. Mutation
 * helpers are intentionally explicit; no general-purpose
 * arbitrary object mutation DSL.
 */
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve, isAbsolute, sep as pathSep } from "node:path";
import { createHash } from "node:crypto";

export function copyFixtureTree(args: {
  readonly repoRoot: string;
  readonly workspaceRoot: string;
  readonly files: readonly string[];
}): readonly string[] {
  const out: string[] = [];
  for (const rel of args.files) {
    if (isAbsolute(rel)) {
      throw new Error(
        `copyFixtureTree: file path '${rel}' must be repo-relative`,
      );
    }
    const src = join(args.repoRoot, rel);
    const dst = join(args.workspaceRoot, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    out.push(rel);
  }
  return out;
}

export function shaOfFile(abs_path: string): string {
  return createHash("sha256").update(readFileSync(abs_path)).digest("hex");
}

export function readJson(abs_path: string): unknown {
  return JSON.parse(readFileSync(abs_path, "utf8"));
}

export function writeJson(abs_path: string, value: unknown): void {
  mkdirSync(dirname(abs_path), { recursive: true });
  writeFileSync(abs_path, JSON.stringify(value, null, 2), "utf8");
}

export function appendBytes(abs_path: string, bytes: Buffer | string): void {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
  writeFileSync(abs_path, Buffer.concat([readFileSync(abs_path), buf]));
}

export function replaceBytes(abs_path: string, bytes: Buffer | string): void {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, "utf8");
  writeFileSync(abs_path, buf);
}

export function moveFile(args: {
  readonly workspaceRoot: string;
  readonly fromRel: string;
  readonly toRel: string;
}): void {
  const src = join(args.workspaceRoot, args.fromRel);
  const dst = join(args.workspaceRoot, args.toRel);
  mkdirSync(dirname(dst), { recursive: true });
  renameSync(src, dst);
}

export function replaceBytesWithTargetSha(args: {
  readonly abs_path: string;
  readonly targetSha: string;
}): { readonly bytes_written: number; readonly actualSha: string } {
  // Length-prefixed payload: 4-byte BE length header
  // followed by N ASCII-space bytes. Deterministic and
  // safe to write under any encoding.
  const payloadLen = 64;
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payloadLen, 0);
  const body = Buffer.alloc(payloadLen, 0x20);
  const composed = Buffer.concat([header, body]);
  const actualSha = createHash("sha256").update(composed).digest("hex");
  writeFileSync(args.abs_path, composed);
  return { bytes_written: composed.length, actualSha };
}

export function createExternalSymlink(args: {
  readonly linkAbs: string;
  readonly externalTargetAbs: string;
}): void {
  mkdirSync(dirname(args.linkAbs), { recursive: true });
  symlinkSync(args.externalTargetAbs, args.linkAbs);
}

export function relFromWorkspace(workspaceRoot: string, abs_path: string): string {
  return relative(resolve(workspaceRoot), resolve(abs_path));
}

export function absFromRel(workspaceRoot: string, rel_path: string): string {
  if (isAbsolute(rel_path)) {
    throw new Error(
      `absFromRel: rel_path '${rel_path}' must be workspace-relative`,
    );
  }
  return join(resolve(workspaceRoot), rel_path);
}

export function dotDotEscape(args: {
  readonly workspaceRoot: string;
  readonly startRel: string;
  readonly depth: number;
}): string {
  let rel = args.startRel;
  for (let i = 0; i < args.depth; i++) {
    rel = `..${pathSep}${rel}`;
  }
  const resolved = resolve(args.workspaceRoot, rel);
  const fromRoot = relative(resolve(args.workspaceRoot), resolved);
  if (!fromRoot.startsWith(`..${pathSep}`) && fromRoot !== "..") {
    throw new Error(
      `dotDotEscape: depth ${args.depth} from ${args.startRel} did not escape workspace`,
    );
  }
  return rel;
}
