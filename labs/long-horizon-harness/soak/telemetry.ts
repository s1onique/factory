/**
 * LH-06 deterministic long-duration soak laboratory —
 * bounded telemetry.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01)
 *
 * No unbounded per-epoch in-memory log arrays (ACT §22).
 *
 *   IN_MEMORY_TELEMETRY_CARDINALITY = BOUNDED
 *
 * The worker uses either:
 *
 *   - a bounded ring buffer of recent diagnostic samples
 *     (held in memory, capped at LH06_IN_MEMORY_TELEMETRY_CAP)
 *   - a streamed JSONL file on disk (optional)
 *
 * Full soak telemetry goes to disk. In-memory storage
 * stores only a bounded recent window.
 *
 * Sampling cadences (ACT §23):
 *   light sample        — every epoch
 *   post-GC resource    — every N epochs
 *   full diagnostic     — every M epochs
 *
 * All cadences are contract fields.
 */
import { LH06_IN_MEMORY_TELEMETRY_CAP } from "./contract.js";

/**
 * The four closed-world telemetry line kinds (ACT §31).
 */
export type TelemetryKind = "EPOCH" | "RESOURCE_SAMPLE" | "HEARTBEAT" | "FAILURE";

export interface TelemetryLine {
  readonly kind: TelemetryKind;
  readonly ts_ms: number;
  readonly payload: unknown;
}

/**
 * Bounded ring buffer for in-memory telemetry. Capacity is
 * fixed at construction. Pushing beyond capacity overwrites
 * the oldest entry (FIFO eviction).
 */
export class BoundedTelemetryBuffer {
  private readonly cap: number;
  private readonly items: TelemetryLine[] = [];
  private writeIndex = 0;
  private size_ = 0;

  constructor(capacity: number = LH06_IN_MEMORY_TELEMETRY_CAP) {
    if (capacity <= 0) {
      throw new Error("BoundedTelemetryBuffer: capacity must be positive");
    }
    this.cap = capacity;
    for (let i = 0; i < capacity; i++) {
      this.items.push({
        kind: "EPOCH",
        ts_ms: 0,
        payload: null,
      });
    }
  }

  push(line: TelemetryLine): void {
    if (this.size_ < this.cap) {
      this.items[(this.writeIndex + this.size_) % this.cap] = line;
      this.size_ += 1;
    } else {
      this.items[this.writeIndex] = line;
      this.writeIndex = (this.writeIndex + 1) % this.cap;
    }
  }

  size(): number {
    return this.size_;
  }

  capacity(): number {
    return this.cap;
  }

  /**
   * Snapshot the buffer in chronological order (FIFO).
   */
  snapshot(): readonly TelemetryLine[] {
    const out: TelemetryLine[] = [];
    for (let i = 0; i < this.size_; i++) {
      const idx = (this.writeIndex + i) % this.cap;
      const v = this.items[idx];
      if (v !== undefined) {
        out.push(v);
      }
    }
    return Object.freeze(out);
  }

  /**
   * Last K samples in chronological order.
   */
  lastK(k: number): readonly TelemetryLine[] {
    if (k <= 0) return Object.freeze([]);
    const snap = this.snapshot();
    if (snap.length <= k) return snap;
    return Object.freeze(snap.slice(snap.length - k));
  }

  clear(): void {
    this.writeIndex = 0;
    this.size_ = 0;
  }
}

/**
 * JSONL stream — append-only sink for full soak telemetry.
 * Optional; the worker can run without it.
 */
export class JsonlTelemetryStream {
  private stream: { write: (s: string) => boolean } | null = null;
  private written = 0;

  /**
   * Open the JSONL stream against a Node writable. We do not
   * import node:fs here to keep the module pure for testing.
   */
  attach(stream: { write: (s: string) => boolean }): void {
    this.stream = stream;
  }

  write(line: TelemetryLine): void {
    if (this.stream === null) return;
    const text = JSON.stringify(line) + "\n";
    this.stream.write(text);
    this.written += 1;
  }

  totalWritten(): number {
    return this.written;
  }
}

/**
 * Decide whether a given cadence is hit at the current epoch.
 * Pure function; the worker invokes it on every epoch.
 */
export function cadenceHit(args: {
  readonly epoch_index: number;
  readonly cadence_n: number;
}): boolean {
  if (args.cadence_n <= 0) return false;
  return args.epoch_index > 0 && args.epoch_index % args.cadence_n === 0;
}
