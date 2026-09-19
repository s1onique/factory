/**
 * LH-05 runner — handoff module (split for source-size discipline).
 *
 * L05-C08: parent runner.ts is the SINGLE logical authority.
 */
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync as _readFileSync, writeFileSync as _writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as _resolve, dirname } from "node:path";
import type { LifecycleScenario, Lh04HandoffResult } from "../types.js";
import { loadRawFixtureText } from "./_fixtures.js";
import {
  verifyLiveQualificationEvidence,
} from "../../src/adapter-common/evidence-verifier.js";
import {
  buildCanonicalBaseline,
  CANONICAL_BASELINE_FILES,
} from "../deterministic-baseline-bridge.js";
import { FAULT_CATALOG } from "../lh04-fault-bridge.js";
export { runLh04Handoff };

async function runLh04Handoff(args: {
  readonly repoRoot: string;
  readonly scenario: LifecycleScenario;
}): Promise<Lh04HandoffResult> {
  // L05-C04: returns a typed Lh04HandoffResult so the
  // comparison logic can distinguish the four failure modes
  // (ESCAPED, BASELINE_INVALID, FAULT_NOT_FOUND,
  // INTERNAL_ERROR) from the single success mode
  // (LH04_HANDOFF_REJECTED_AS_EXPECTED).
  const faultIdMarker = args.scenario.raw_fixture_set.find(
    (f) => f.kind === "corruption_handoff_fixture",
  );
  if (faultIdMarker === undefined) {
    return { kind: "LH04_FAULT_NOT_FOUND", fault_id: "<missing-marker>" };
  }
  const markerText = loadRawFixtureText(
    args.repoRoot,
    faultIdMarker.repo_relative_path,
  );
  const faultId = markerText.trim();
  const fault = FAULT_CATALOG.find((f) => f.id === faultId);
  if (fault === undefined) {
    return { kind: "LH04_FAULT_NOT_FOUND", fault_id: faultId };
  }
  // Auto-detect the LH-04 lab root from the LH-05 fixture's
  // repo_relative_path. If the fixture path is repo-rooted
  // (e.g. "labs/long-horizon-harness/test/..."), the repoRoot
  // is the monorepo root and we resolve relative to it. If the
  // path is lab-local (e.g. "lifecycle-corpus/fixtures/..."),
  // repoRoot is already the lab dir.
  const fixtureRelPath = faultIdMarker.repo_relative_path;
  const labRoot = fixtureRelPath.startsWith("labs/")
    ? args.repoRoot
    : args.repoRoot.endsWith("long-horizon-harness")
      ? args.repoRoot
      : _resolve(args.repoRoot, "labs/long-horizon-harness");
  const base = process.env["FACTORY_LH05_WORKSPACE_BASE"] ?? tmpdir();
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  const ws = mkdtempSync(`${base.replace(/\/$/, "")}/lh05-fault-handoff-`);
  try {
    for (const rel of CANONICAL_BASELINE_FILES) {
      const src = _resolve(labRoot, rel);
      const dst = _resolve(ws, rel);
      mkdirSync(dirname(dst), { recursive: true });
      _writeFileSync(dst, _readFileSync(src));
    }
    const baseline = buildCanonicalBaseline({ workspaceRoot: ws });
    const baselineVerifier = verifyLiveQualificationEvidence(baseline, ws);
    if (!baselineVerifier.ok) {
      return { kind: "LH04_BASELINE_INVALID" };
    }
    await fault.mutate(ws);
    let mutated = buildCanonicalBaseline({ workspaceRoot: ws });
    if (fault.postBuild !== undefined) {
      mutated = fault.postBuild(ws, mutated, baseline);
    }
    const verifierResult = verifyLiveQualificationEvidence(mutated, ws);
    if (verifierResult.ok) {
      return { kind: "LH04_HANDOFF_ESCAPED" };
    }
    return {
      kind: "LH04_HANDOFF_REJECTED_AS_EXPECTED",
      rejection_kind: (verifierResult.errors[0]?.kind ?? "EVIDENCE_PARSE_FAILED") as
        | "EVIDENCE_ARTIFACT_MISSING"
        | "EVIDENCE_PATH_ESCAPE"
        | "EVIDENCE_HASH_MISMATCH"
        | "EVIDENCE_PARSE_FAILED"
        | "EVIDENCE_OBSERVATION_MISMATCH"
        | "EVIDENCE_ORACLE_FAILED"
        | "EVIDENCE_EXECUTION_MISMATCH",
      rejection_keys: verifierResult.errors[0] ? Object.keys(verifierResult.errors[0]) : [],
    };
  } catch (err) {
    return {
      kind: "LH04_HANDOFF_INTERNAL_ERROR",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      rmSync(ws, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}
