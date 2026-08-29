/**
 * Adversarial fixture process for supervised-process tests.
 *
 * Modes:
 *   exit --code N             exit with code N
 *   sleep --ms N              sleep N ms then exit 0
 *   ignore-term               ignore SIGTERM; only SIGKILL exits
 *   term-handler              handle SIGTERM, write "term-handled", exit 0
 *   spawn-child --sleep MS    fork a child that sleeps MS then exits 0
 *   spawn-grandchild --sleep MS
 *                             fork a child that itself forks a grandchild,
 *                             then both sleep MS and exit 0
 *   flood-stdout --bytes N --chunk M
 *                             write N total bytes to stdout in M-byte chunks
 *   flood-stderr --bytes N --chunk M
 *                             same for stderr
 *   mixed-output --bytes N    alternate 4-byte chunks to stdout and stderr
 *   invalid-utf8              write 4 known-invalid UTF-8 bytes then exit
 *   crash                     self-signal SIGKILL (deterministic)
 *   echo-pid --tag T          write JSON {pid, pgid, tag} to stdout and exit 0.
 */

import { spawn } from "node:child_process";
import process from "node:process";

type Mode =
  | "exit"
  | "sleep"
  | "ignore-term"
  | "term-handler"
  | "spawn-child"
  | "spawn-grandchild"
  | "flood-stdout"
  | "flood-stderr"
  | "mixed-output"
  | "invalid-utf8"
  | "crash"
  | "echo-pid";

function parseArgs(argv: string[]): { mode: Mode; opts: Map<string, string> } {
  const mode = argv[0] as Mode;
  const opts = new Map<string, string>();
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (typeof v === "string" && !v.startsWith("--")) {
        opts.set(k, v);
        i++;
      } else {
        opts.set(k, "true");
      }
    }
  }
  return { mode, opts };
}

function numOpt(opts: Map<string, string>, k: string, def: number): number {
  const v = opts.get(k);
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) ? n : def;
}

async function main(): Promise<void> {
  const { mode, opts } = parseArgs(process.argv.slice(2));
  switch (mode) {
    case "exit":
      process.exit(numOpt(opts, "code", 0));
      return;
    case "sleep": {
      const ms = numOpt(opts, "ms", 100);
      setTimeout(() => process.exit(0), ms).unref();
      return;
    }
    case "ignore-term": {
      process.on("SIGTERM", () => {});
      process.on("SIGINT", () => {});
      setInterval(() => {}, 1000);
      return;
    }
    case "term-handler": {
      process.on("SIGTERM", () => {
        process.stdout.write("term-handled\n");
        process.exit(0);
      });
      setInterval(() => {}, 1000);
      return;
    }
    case "spawn-child": {
      const ms = numOpt(opts, "sleep", 5000);
      const child = spawn(
        process.execPath,
        [import.meta.url.replace("file://", ""), "sleep", "--ms", String(ms)],
        { detached: false, stdio: "ignore" },
      );
      child.unref();
      setTimeout(() => process.exit(0), Math.max(50, Math.floor(ms / 5))).unref();
      return;
    }
    case "spawn-grandchild": {
      const ms = numOpt(opts, "sleep", 5000);
      const child = spawn(
        process.execPath,
        [import.meta.url.replace("file://", ""), "spawn-child", "--sleep", String(ms)],
        { detached: false, stdio: "ignore" },
      );
      child.unref();
      setTimeout(() => process.exit(0), Math.max(50, Math.floor(ms / 5))).unref();
      return;
    }
    case "flood-stdout":
      await flood(process.stdout, numOpt(opts, "bytes", 65536), numOpt(opts, "chunk", 4096));
      return;
    case "flood-stderr":
      await flood(process.stderr, numOpt(opts, "bytes", 65536), numOpt(opts, "chunk", 4096));
      return;
    case "mixed-output": {
      const total = numOpt(opts, "bytes", 65536);
      const half = Math.floor(total / 2);
      await flood(process.stdout, half, 4);
      await flood(process.stderr, total - half, 4);
      return;
    }
    case "invalid-utf8": {
      const buf = Buffer.from([0xc3, 0x28, 0xa0, 0xa1]);
      process.stdout.write(buf);
      process.exit(0);
      return;
    }
    case "crash": {
      process.kill(process.pid, "SIGKILL");
      return;
    }
    case "echo-pid": {
      const tag = opts.get("tag") ?? "";
      // POSIX: when the supervisor spawns this fixture detached,
      // its PGID equals its PID. We expose the PID and rely on the
      // supervisor's PGID (which it emits via process_spawned)
      // for the authoritative group identity. Reading PGID from
      // /proc is portable enough on Linux; on macOS we read ps.
      let pgid: number | null = null;
      try {
        const fs = await import("node:fs/promises");
        const stat = await fs.readFile(`/proc/${process.pid}/stat`, "utf8");
        // 5th field is (pgrp). It is the 5th whitespace-separated token.
        const tokens = stat.split(" ");
        const token = tokens[4];
        const n = token === undefined ? NaN : Number(token);
        if (Number.isFinite(n)) pgid = n;
      } catch {
        // /proc not available (macOS). Leave pgid null; the supervisor
        // still records the PGID it used to spawn us.
      }
      const line =
        JSON.stringify({ pid: process.pid, pgid, tag }) + "\n";
      process.stdout.write(line);
      setTimeout(() => process.exit(0), 50).unref();
      return;
    }
    default: {
      process.stderr.write(`unknown mode: ${String(mode)}\n`);
      process.exit(2);
      return;
    }
  }
}

async function flood(stream: NodeJS.WriteStream, total: number, chunk: number): Promise<void> {
  const buf = Buffer.alloc(chunk, 0x41);
  let written = 0;
  while (written < total) {
    const remaining = total - written;
    const slice = buf.subarray(0, Math.min(chunk, remaining));
    if (!stream.write(slice)) {
      await new Promise<void>((resolve) => stream.once("drain", () => resolve()));
    }
    written += slice.length;
  }
  await new Promise<void>((resolve) => stream.write("", () => resolve()));
}

void main();
