/**
 * LH-06 deterministic long-duration soak laboratory —
 * durable telemetry store.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * L06-CORRECTION03 L06-C17: every soak MUST produce a
 * durable telemetry JSONL file. The worker:
 *
 *   1. Opens a `<runId>.telemetry.jsonl` in
 *      `LH06_TELEMETRY_DIR` (default: the lab root).
 *   2. Streams every line through `append()` (line-buffered
 *      JSONL, fsync on `flush()` for crash safety).
 *   3. Closes the file at run end and computes the SHA-256
 *      of the closed file's bytes.
 *   4. The result binds BOTH the absolute path AND the
 *      SHA-256 of the closed file. The supervisor
 *      re-verifies the hash before promoting the worker
 *      result (L06-C20).
 *
 * Closed-world invariant:
 *
 *   PASS_WITH_MISSING_TELEMETRY      = IMPOSSIBLE
 *   PASS_WITH_TELEMETRY_HASH_DRIFT   = IMPOSSIBLE
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { TelemetryLine } from "./telemetry.js";

export const LH06_TELEMETRY_SCHEMA = "lh06.telemetry.v1" as const;

export interface DurableTelemetryClose {
  readonly ok: true;
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly line_count: number;
}

export interface DurableTelemetryFailure {
  readonly ok: false;
  readonly kind: "OPEN_FAILED" | "WRITE_FAILED" | "READ_BACK_FAILED";
  readonly detail: string;
}

export type DurableTelemetryCloseResult =
  | DurableTelemetryClose
  | DurableTelemetryFailure;

export class DurableTelemetryStore {
  private fd: number | null = null;
  private readonly path: string;
  private bytes = 0;
  private lineCount = 0;
  private closed = false;

  constructor(path: string) {
    this.path = resolve(path);
  }

  /**
   * Open the telemetry file in append+create mode.
   * We use raw fd so subsequent writes can be flushed
   * with fsync() and we can keep the descriptor open
   * across many append() calls.
   */
  open(): void {
    if (this.fd !== null) return;
    mkdirSync(dirname(this.path), { recursive: true });
    // Node's openSync mode flag handling for numeric
    // O_CREAT flags is platform-sensitive; the string
    // mode "a" (append, create if missing, do not
    // truncate) is portable and matches our needs.
    this.fd = openSync(this.path, "a", 0o644);
  }

  /**
   * Append one telemetry line. Synchronous write so a
   * crashing worker either persists the line or fails
   * closed (caller catches and reports
   * INVALID_TELEMETRY).
   */
  append(line: TelemetryLine): void {
    if (this.fd === null) {
      throw new Error("DurableTelemetryStore.append: store not open");
    }
    if (this.closed) {
      throw new Error("DurableTelemetryStore.append: store already closed");
    }
    const text = JSON.stringify(line) + "\n";
    try {
      writeFileSync(this.fd, text);
    } catch (e) {
      throw new Error(
        `DurableTelemetryStore.append: write failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    this.bytes += Buffer.byteLength(text);
    this.lineCount += 1;
  }
  /**
   * Force a sync to disk. The worker calls this on every
   * epoch boundary so a watchdog kill cannot lose more
   * than one epoch of telemetry.
   */
  flush(): void {
    if (this.fd === null) return;
    try {
      fsyncSync(this.fd);
    } catch {
      // best-effort; the close path is authoritative
    }
  }

  /**
   * Close the file, read the bytes back, compute SHA-256,
   * and return a typed result. After `close()`, the
   * store cannot be reused — append() throws.
   *
   * L06-CORRECTION03 L06-C17: this is the only path that
   * establishes the `telemetry_sha256` binding used by
   * the supervisor's re-verification (L06-C20).
   */
  close(): DurableTelemetryCloseResult {
    if (this.fd === null) {
      return {
        ok: false,
        kind: "OPEN_FAILED",
        detail: "DurableTelemetryStore.close: store was never opened",
      };
    }
    if (!this.closed) {
      try {
        fsyncSync(this.fd);
      } catch {
        // ignore — read-back below catches real errors
      }
      try {
        closeSync(this.fd);
      } catch {
        // ignore
      }
      this.closed = true;
      this.fd = null;
    }
    if (!existsSync(this.path)) {
      return {
        ok: false,
        kind: "READ_BACK_FAILED",
        detail: `telemetry file vanished after close: ${this.path}`,
      };
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(this.path);
    } catch (e) {
      return {
        ok: false,
        kind: "READ_BACK_FAILED",
        detail:
          e instanceof Error
            ? e.message
            : `readFileSync failed for ${this.path}`,
      };
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return {
      ok: true,
      path: this.path,
      bytes: bytes.length,
      sha256,
      line_count: this.lineCount,
    };
  }

  /**
   * Read the bytes + hash of the closed telemetry file.
   * Used by the supervisor's worker-result verifier
   * (L06-C20) to re-verify the binding before promoting
   * the worker artifact to the canonical path.
   *
   * L06-CORRECTION05 L06-C29: also computes the actual
   * `bytes` length and `line_count` (by splitting the
   * closed file on `\n` and discarding any trailing
   * empty line). The verifier compares these against
   * the values the worker recorded in the result
   * artifact (`telemetry_bytes` / `telemetry_line_count`)
   * so a worker that lies about its own telemetry is
   * rejected.
   */
  static verify(args: {
    readonly path: string;
    readonly expected_sha256: string;
  }): DurableTelemetryCloseResult {
    if (!existsSync(args.path)) {
      return {
        ok: false,
        kind: "READ_BACK_FAILED",
        detail: `telemetry file missing at verify time: ${args.path}`,
      };
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(args.path);
    } catch (e) {
      return {
        ok: false,
        kind: "READ_BACK_FAILED",
        detail:
          e instanceof Error
            ? e.message
            : `readFileSync failed for ${args.path}`,
      };
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== args.expected_sha256) {
      return {
        ok: false,
        kind: "READ_BACK_FAILED",
        detail:
          `telemetry SHA-256 drift: expected ${args.expected_sha256}, ` +
          `got ${sha256}`,
      };
    }
    // L06-C29: derive `line_count` from the on-disk bytes
    // so the verifier can compare it against the worker-
    // claimed `telemetry_line_count`. Splitting on `\n`
    // and discarding a trailing empty line matches the
    // JSONL convention `DurableTelemetryStore.append`
    // writes (every line ends with `\n`).
    const text = bytes.toString("utf8");
    const parts = text.split("\n");
    const trailingEmpty =
      parts.length > 0 && parts[parts.length - 1] === "";
    const lineCount = trailingEmpty ? parts.length - 1 : parts.length;
    return {
      ok: true,
      path: args.path,
      bytes: bytes.length,
      sha256,
      line_count: lineCount,
    };
  }
}
