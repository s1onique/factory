/**
 * Adversarial fixture process for supervised-process tests.
 *
 * CORRECTION07 (FOUNDATION02):
 *
 * The previous version of this fixture called .unref() on
 * the liveness timers used by `sleep`, `spawn-child`,
 * `spawn-grandchild`, and `echo-pid`. Per Node.js semantics,
 * an unref'ed timer does NOT keep the event loop alive. On
 * an unrestricted host, the fixture process could therefore
 * exit before the requested sleep duration had elapsed,
 * causing the supervisor's deadline/cancel logic to race
 * with the fixture's spontaneous natural exit. That was the
 * root cause of LIVE06 (≈76 ms) and LIVE08 (≈260 ms)
 * failures during the first real host qualification.
 *
 * This file now classifies each timer explicitly:
 *
 *   LIFETIME_REF   — ref'ed; keeps the event loop alive.
 *                   Used for advertised-liveness timers.
 *   LIFETIME_UNREF — unref'ed; the handle exists only to
 *                   trigger cleanup, not to keep the loop
 *                   alive. Used for tiny post-write flushes.
 *
 * Modes also gain explicit readiness handshakes so the live
 * matrix does not race fixture startup:
 *
 *   sleep --ms N              emits nothing; just stays alive
 *   ignore-term               emits nothing; SIGTERM ignored
 *   term-handler              emits "term-handler-ready\n"
 *                             then installs SIGTERM handler
 *                             then emits "term-handler-armed\n"
 *                             (the first marker proves Node is
 *                             up; the second proves the handler
 *                             is installed and stable)
 *   spawn-child --sleep MS    emits "child-ready\n" once the
 *                             child is spawned
 *   spawn-grandchild --sleep MS
 *                             emits a single JSON line of the
 *                             shape
 *                                 {"kind":"tree-ready",
 *                                  "parent_pid":P,
 *                                  "child_pid":C,
 *                                  "grandchild_pid":G}
 *                             ONLY after both descendants are
 *                             confirmed alive.
 */

import { spawn, type ChildProcess } from "node:child_process";
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

/**
 * Wait for a child process to be running (PID assigned).
 * Resolves immediately after `child.pid` is populated and
 * the first spawn event has fired.
 */
function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (typeof child.pid === "number" && child.pid > 0) {
      setImmediate(resolve);
      return;
    }
    child.once("spawn", () => setImmediate(resolve));
    // Safety bound so we never hang if 'spawn' never fires.
    setTimeout(resolve, 500).unref();
  });
}

/**
 * Confirm a specific PID is alive via kill(pid, 0).
 * Positive signal-zero; ESRCH -> false; EPERM -> true
 * (process exists but is owned by another user).
 */
async function confirmAlive(pid: number): Promise<boolean> {
  if (pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? (e as { code: unknown }).code
        : undefined;
    if (code === "ESRCH") return false;
    return code === "EPERM";
  }
}

/**
 * Read a child's stdout line-by-line until a "descendant-ready"
 * record appears, or until the child exits. Returns the
 * discovered descendant PID, or null on timeout / error.
 *
 * Used by spawn-grandchild mode to learn the grandchild's PID
 * without any /proc or /bin/ps dependency.
 */
function readDescendantPid(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (!child.stdout) {
      resolve(null);
      return;
    }
    let buf = "";
    const timer = setTimeout(() => {
      child.stdout?.off("data", onData);
      resolve(null);
    }, 5000);
    const onData = (chunk: Buffer | string): void => {
      const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      buf += s;
      // Process every complete line.
      let idx = buf.indexOf("\n");
      while (idx >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.length > 0) {
          try {
            const rec = JSON.parse(line) as {
              kind?: string;
              descendant_pid?: number;
            };
            if (
              rec.kind === "descendant-ready" &&
              typeof rec.descendant_pid === "number" &&
              rec.descendant_pid > 1
            ) {
              clearTimeout(timer);
              child.stdout?.off("data", onData);
              resolve(rec.descendant_pid);
              return;
            }
          } catch {
            // Not JSON — keep reading.
          }
        }
        idx = buf.indexOf("\n");
      }
    };
    child.stdout.on("data", onData);
    child.once("exit", () => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      resolve(null);
    });
  });
}

async function main(): Promise<void> {
  const { mode, opts } = parseArgs(process.argv.slice(2));
  switch (mode) {
    case "exit":
      process.exit(numOpt(opts, "code", 0));
      return;
    case "sleep": {
      // CORRECTION07: ref'ed lifetime timer. The fixture MUST
      // remain alive for the requested duration. Do NOT call
      // .unref() on this timer — Node semantics say an unref'ed
      // timer does not keep the event loop alive.
      const ms = numOpt(opts, "ms", 100);
      setTimeout(() => process.exit(0), ms);
      return;
    }
    case "ignore-term": {
      process.on("SIGTERM", () => {});
      process.on("SIGINT", () => {});
      setInterval(() => {}, 1000);
      return;
    }
    case "term-handler": {
      // CORRECTION07: emit a readiness handshake BEFORE
      // installing the SIGTERM handler, then a second
      // marker AFTER the handler is installed. LIVE04
      // synchronises on the second marker before calling
      // sup.cancel() so SIGTERM cannot race handler
      // installation.
      process.stdout.write("term-handler-ready\n");
      const onTerm = (): void => {
        process.stdout.write("term-handled\n");
        process.exit(0);
      };
      process.on("SIGTERM", onTerm);
      // Flush the second readiness marker so the test can
      // synchronise on handler installation.
      process.stdout.write("term-handler-armed\n");
      setInterval(() => {}, 1000);
      return;
    }
    case "spawn-child": {
      // CORRECTION07: parent lifetime MUST outlive the child
      // so the supervisor's deadline/TEST logic can fire
      // against a live tree. Use the full requested ms
      // (not ms/5 which used to be the silent early-exit
      // path). All timers here are ref'ed.
      const ms = numOpt(opts, "sleep", 5000);
      const child = spawn(
        process.execPath,
        [import.meta.url.replace("file://", ""), "sleep", "--ms", String(ms)],
        { detached: false, stdio: "ignore" },
      );
      const childPid = child.pid ?? -1;
      await waitForSpawn(child);
      // Confirm the child really exists in the process table
      // before emitting the readiness marker.
      const alive = await confirmAlive(childPid);
      if (alive) {
        process.stdout.write("child-ready\n");
        // Emit a structured descendant record so a grandparent
        // (spawn-grandchild mode) can capture this PID
        // without needing /proc or /bin/ps, both of which
        // are unavailable in many sandboxed environments.
        process.stdout.write(JSON.stringify({
          kind: "descendant-ready",
          descendant_pid: childPid,
        }) + "\n");
      }
      // Parent lifetime = max(ms, 500ms). Ref'ed so SIGTERM /
      // SIGKILL / cancel from the supervisor is what causes
      // exit, not a natural Node shutdown.
      const parentLifetimeMs = Math.max(ms, 500);
      setTimeout(() => process.exit(0), parentLifetimeMs);
      return;
    }
    case "spawn-grandchild": {
      // CORRECTION07: build a 3-process tree:
      //   parent -> child (spawn-child mode) -> grandchild (sleep)
      // and emit a single bounded JSON line of evidence
      // ONLY after both descendants have been confirmed
      // alive. The parent itself lives for max(sleep, 1000ms)
      // with a ref'ed timer. No .unref() on load-bearing
      // timers.
      //
      // We capture the grandchild PID via the child's own
      // stdout (a "descendant-ready" JSON line). This avoids
      // any need for /proc or /bin/ps, neither of which is
      // available in restricted sandboxes.
      const ms = numOpt(opts, "sleep", 5000);
      const child = spawn(
        process.execPath,
        [import.meta.url.replace("file://", ""), "spawn-child", "--sleep", String(ms)],
        { detached: false, stdio: ["ignore", "pipe", "ignore"] },
      );
      const childPid = child.pid ?? -1;
      await waitForSpawn(child);
      const childAlive = await confirmAlive(childPid);
      // Read the child's stdout line-by-line until we see
      // "descendant-ready", then stop.
      let grandchildPid: number | null = null;
      if (childAlive && child.stdout) {
        grandchildPid = await readDescendantPid(child);
      }
      const grandchildAlive =
        typeof grandchildPid === "number" && (await confirmAlive(grandchildPid));

      if (
        childAlive &&
        grandchildAlive &&
        typeof grandchildPid === "number"
      ) {
        const record = {
          kind: "tree-ready",
          parent_pid: process.pid,
          child_pid: childPid,
          grandchild_pid: grandchildPid,
        };
        process.stdout.write(JSON.stringify(record) + "\n");
      }
      // Parent lifetime: at least max(ms, 1000ms). Ref'ed.
      const parentLifetimeMs = Math.max(ms, 1000);
      setTimeout(() => process.exit(0), parentLifetimeMs);
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
      // CORRECTION07: keep-alive via a ref'ed setInterval,
      // not an unref'ed setTimeout. The fixture stays alive
      // until the supervisor cancels it.
      setInterval(() => {}, 1000);
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
