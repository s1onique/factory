/**
 * Adapter-common helpers for typed semantic probe
 * evidence (LH-03 CORRECTION03, C03-01, C03-02).
 *
 * These helpers live in `src/adapter-common/` (not in a
 * specific adapter) because they are deterministic,
 * candidate-neutral, and do not pull Pi-specific schema
 * assumptions. The Pi adapter delegates to them.
 *
 * Purity: this module imports `node:crypto` and `node:fs`.
 * The domain-purity gate restricts those imports to
 * `src/domain` and `src/protocol` only; adapter-common
 * may use Node facilities for evidence discovery.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import type { CapabilityKey } from "../protocol/index.js";
import type { CapabilityProbeEvidence } from "../protocol/index.js";

/**
 * Compute the SHA256 of an artifact on disk. Returns a
 * 64-char lowercase hex string.
 */
export function artifactSha256(artifact_path: string): string {
  const bytes = readFileSync(artifact_path);
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Generic JSONL first-line reader. Returns the parsed
 * first line as `unknown`, or `null` if the file is
 * missing, empty, or the first line fails to parse.
 */
export function readJsonlFirstLine(artifact_path: string): unknown {
  if (!existsSync(artifact_path)) return null;
  const text = readFileSync(artifact_path, "utf8");
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (firstLine.length === 0) return null;
  try {
    return JSON.parse(firstLine);
  } catch {
    return null;
  }
}

/**
 * Generic JSON reader. Returns the parsed contents as
 * `unknown`, or `null` if the file is missing or fails
 * to parse.
 */
export function readJsonObject(artifact_path: string): unknown {
  if (!existsSync(artifact_path)) return null;
  try {
    return JSON.parse(readFileSync(artifact_path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Build a typed `CapabilityProbeEvidence` for a given
 * capability under a given observed artifact and oracle.
 * The `expected` and `observed` strings are the literal
 * values the validator compares for semantic equality;
 * `disposition` is `PASS` iff `expected === observed`.
 */
export function buildProbeEvidence(args: {
  readonly capability: CapabilityKey;
  readonly probe_kind:
    | "SESSION_ENVELOPE"
    | "CANCELLATION_HALT"
    | "INSPECTION_ONLY"
    | "NOT_RUN";
  readonly artifact_path: string;
  readonly artifact_sha256: string;
  readonly expected: string;
  readonly observed: string;
}): CapabilityProbeEvidence {
  return {
    capability: args.capability,
    probe_kind: args.probe_kind,
    artifact_path: args.artifact_path,
    artifact_sha256: args.artifact_sha256,
    evidence_relation: {
      expected: args.expected,
      observed: args.observed,
    },
    disposition: args.expected === args.observed ? "PASS" : "FAIL",
  };
}

/**
 * Build a typed `NOT_RUN` probe evidence for a capability
 * that has not been probed.
 */
export function notRunProbeEvidence(
  capability: CapabilityKey,
): CapabilityProbeEvidence {
  return {
    capability,
    probe_kind: "NOT_RUN",
    artifact_path: "",
    artifact_sha256:
      "0000000000000000000000000000000000000000000000000000000000000000",
    evidence_relation: { expected: "", observed: "" },
    disposition: "FAIL",
  };
}

/**
 * Build a typed `HALT` probe evidence for a capability
 * whose probe was attempted and halted.
 */
export function haltProbeEvidence(args: {
  readonly capability: CapabilityKey;
  readonly artifact_path: string;
  readonly artifact_sha256: string;
  readonly expected: string;
  readonly observed: string;
}): CapabilityProbeEvidence {
  return {
    capability: args.capability,
    probe_kind: "CANCELLATION_HALT",
    artifact_path: args.artifact_path,
    artifact_sha256: args.artifact_sha256,
    evidence_relation: { expected: args.expected, observed: args.observed },
    disposition: "HALT",
  };
}
