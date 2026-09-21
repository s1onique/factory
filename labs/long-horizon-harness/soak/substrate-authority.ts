/**
 * LH-06 substrate authority resolver.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01-CORRECTION11 L06-C43)
 *
 * QUALIFICATION01 produced `phase_e_head = null` and
 * `lh02_head = null` because the previous binding code
 * tried to derive these identities from the capability-
 * matrix artifact — a record that does NOT carry Phase E
 * or LH-02 freezes. That is a source-authority error.
 *
 * Each frozen substrate identity MUST come from the record
 * that owns that freeze. This module is the single
 * authority for resolving every substrate commit:
 *
 *   phase_e_head         <- qualification/phase-e-frozen.json
 *   lh02_head            <- qualification/lh02-frozen.json
 *   lh03_frozen_commit   <- qualification/lh03-frozen.json
 *   lh04_frozen_commit   <- qualification/lh04-frozen.json
 *   lh05_corpus_commit   <- qualification/lh05-adversarial-lifecycle-corpus.json
 *   repo_commit          <- git rev-parse HEAD
 *
 * No guessing. No fallback to current HEAD. No scraping
 * of unrelated artifacts. If a required record or field is
 * absent, the resolver returns a typed failure rather
 * than substituting a placeholder.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { LH06SubstrateBinding } from "./result.js";

/**
 * The set of substrate identities this module resolves.
 */
export type SubstrateField =
  | "phase_e_head"
  | "lh02_head"
  | "lh03_frozen_commit"
  | "lh04_frozen_commit"
  | "lh05_corpus_commit"
  | "repo_commit";

/**
 * Provenance of a single resolved identity.
 */
export interface LH06SubstrateBindingProvenance {
  readonly field: SubstrateField;
  readonly source_path: string;
  readonly source_field: string;
  readonly resolved_commit: string;
}

/**
 * Provenance + binding surface.
 */
export interface LH06SubstrateBindingWithProvenance {
  readonly binding: LH06SubstrateBinding;
  readonly provenance: ReadonlyArray<LH06SubstrateBindingProvenance>;
}

export type SubstrateAuthorityFailureKind =
  | "AUTHORITY_RECORD_MISSING"
  | "AUTHORITY_FIELD_MISSING"
  | "AUTHORITY_PARSE_FAILED"
  | "INVALID_COMMIT_ID";

export interface SubstrateAuthorityFailure {
  readonly ok: false;
  readonly kind: SubstrateAuthorityFailureKind;
  readonly field: SubstrateField;
  readonly source_path: string;
  readonly detail: string;
}

export interface SubstrateAuthoritySuccess {
  readonly ok: true;
  readonly binding: LH06SubstrateBinding;
  readonly provenance: ReadonlyArray<LH06SubstrateBindingProvenance>;
}

export type SubstrateAuthorityResult =
  | SubstrateAuthoritySuccess
  | SubstrateAuthorityFailure;

/**
 * Closed-world authority table.
 */
interface AuthoritySpec {
  readonly source_path: string;
  readonly source_field: string;
  /**
   * Acceptable schemas for the authority record. When a
   * record declares `record_kind: "RETROSPECTIVE_FREEZE_RECORD"`
   * the schema carries the same subject identity as the
   * original freeze record; either the original `v1`
   * contract or the retrospective `v2` contract is
   * acceptable. The schema declaration on disk is the
   * authority — the resolver does not pick a winner.
   */
  readonly acceptable_schemas?: ReadonlyArray<string>;
}

const AUTHORITY_TABLE: Readonly<Record<SubstrateField, AuthoritySpec>> =
  Object.freeze({
    phase_e_head: {
      source_path: "qualification/phase-e-frozen.json",
      source_field: "subject.commit",
      // L06-CORRECTION12 L06-C51: accept the v1 original
      // freeze record OR the v2 retrospective freeze record
      // that memorials the same accepted freeze commit.
      // The retrospective form adds `record_kind`,
      // `derived_from`, and `record_created_at` so a
      // reader can distinguish provenance semantics.
      acceptable_schemas: [
        "phase-e-frozen-record/v1",
        "phase-e-frozen-record/v2",
      ],
    },
    lh02_head: {
      source_path: "qualification/lh02-frozen.json",
      source_field: "subject.commit",
      acceptable_schemas: [
        "lh02-frozen-record/v1",
        "lh02-frozen-record/v2",
      ],
    },
    lh03_frozen_commit: {
      source_path: "qualification/lh03-frozen.json",
      source_field: "subject.commit",
      acceptable_schemas: ["lh03-frozen-record/v1"],
    },
    lh04_frozen_commit: {
      source_path: "qualification/lh04-frozen.json",
      source_field: "subject.commit",
      acceptable_schemas: ["lh04-frozen-record/v1"],
    },
    lh05_corpus_commit: {
      source_path: "qualification/lh05-adversarial-lifecycle-corpus.json",
      source_field: "subject.commit",
      acceptable_schemas: ["lh05-adversarial-lifecycle-corpus/v1"],
    },
    repo_commit: {
      source_path: "<git rev-parse HEAD>",
      source_field: "<live HEAD>",
    },
  });

const COMMIT_ID_RE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

function readDottedPath(obj: unknown, dottedPath: string): unknown {
  const segments = dottedPath.split(".");
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Resolve every substrate identity from the canonical
 * authority records. The resolver is the SINGLE source of
 * truth for substrate binding in production paths.
 */
export function resolveSoakSubstrateBinding(args: {
  readonly repoRoot: string;
  readonly repoCommitOverride?: string;
}): SubstrateAuthorityResult {
  const repoRoot = args.repoRoot;
  const binding: Record<string, string | null> = {
    phase_e_head: null,
    lh02_head: null,
    lh03_frozen_commit: null,
    lh04_frozen_commit: null,
    lh05_corpus_commit: null,
    repo_commit: null,
  };
  const provenance: LH06SubstrateBindingProvenance[] = [];
  for (const field of Object.keys(AUTHORITY_TABLE) as SubstrateField[]) {
    const spec = AUTHORITY_TABLE[field];
    if (field === "repo_commit") {
      const commit = args.repoCommitOverride ?? readRepoCommit(repoRoot);
      if (commit === null) {
        return {
          ok: false,
          kind: "AUTHORITY_RECORD_MISSING",
          field,
          source_path: spec.source_path,
          detail: "could not resolve repository HEAD",
        };
      }
      if (!COMMIT_ID_RE.test(commit)) {
        return {
          ok: false,
          kind: "INVALID_COMMIT_ID",
          field,
          source_path: spec.source_path,
          detail: `git HEAD '${commit}' is not a canonical hex id`,
        };
      }
      binding[field] = commit;
      provenance.push({
        field,
        source_path: spec.source_path,
        source_field: spec.source_field,
        resolved_commit: commit,
      });
      continue;
    }
    const abs = resolve(repoRoot, spec.source_path);
    if (!existsSync(abs)) {
      return {
        ok: false,
        kind: "AUTHORITY_RECORD_MISSING",
        field,
        source_path: spec.source_path,
        detail: `authority record not present at ${abs}`,
      };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(abs, "utf8")) as unknown;
    } catch (e) {
      return {
        ok: false,
        kind: "AUTHORITY_PARSE_FAILED",
        field,
        source_path: spec.source_path,
        detail: `authority record at ${abs} could not be parsed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
    if (
      spec.acceptable_schemas !== undefined &&
      spec.acceptable_schemas.length > 0 &&
      (raw === null ||
        typeof raw !== "object" ||
        !spec.acceptable_schemas.includes(
          (raw as Record<string, unknown>)["schema"] as string,
        ))
    ) {
      return {
        ok: false,
        kind: "AUTHORITY_FIELD_MISSING",
        field,
        source_path: spec.source_path,
        detail: `authority record at ${abs} has wrong schema; expected one of [${spec.acceptable_schemas.join(", ")}], got '${String(
          (raw as Record<string, unknown> | null)?.["schema"] ?? "<missing>",
        )}'`,
      };
    }
    const value = readDottedPath(raw, spec.source_field);
    if (typeof value !== "string") {
      return {
        ok: false,
        kind: "AUTHORITY_FIELD_MISSING",
        field,
        source_path: spec.source_path,
        detail: `authority record at ${abs} has no string at '${spec.source_field}'`,
      };
    }
    if (!COMMIT_ID_RE.test(value)) {
      return {
        ok: false,
        kind: "INVALID_COMMIT_ID",
        field,
        source_path: spec.source_path,
        detail: `authority record at ${abs} field '${spec.source_field}' = '${value}' is not a canonical hex id`,
      };
    }
    binding[field] = value;
    provenance.push({
      field,
      source_path: spec.source_path,
      source_field: spec.source_field,
      resolved_commit: value,
    });
  }
  return {
    ok: true,
    binding: binding as unknown as LH06SubstrateBinding,
    provenance: Object.freeze(provenance),
  };
}

/**
 * Read the repo HEAD commit SHA via bounded git plumbing.
 * Falls back to loose-file resolution for offline tests.
 */
export function readRepoCommit(repoRoot: string): string | null {
  try {
    const stdout = execFileSync(
      "git",
      ["rev-parse", "HEAD"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const commit = stdout.trim();
    if (COMMIT_ID_RE.test(commit)) return commit;
    return null;
  } catch {
    // Fall through.
  }
  try {
    const headPath = resolve(repoRoot, ".git", "HEAD");
    if (!existsSync(headPath)) return null;
    const head = readFileSync(headPath, "utf8").trim();
    if (COMMIT_ID_RE.test(head)) return head;
    if (head.startsWith("ref:")) {
      const refName = head.slice(4).trim();
      const refPath = resolve(repoRoot, ".git", refName);
      if (!existsSync(refPath)) return null;
      const refVal = readFileSync(refPath, "utf8").trim();
      if (COMMIT_ID_RE.test(refVal)) return refVal;
      return null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Test-only: expose the closed-world authority table.
 */
export function authorityTableForTests(): Readonly<
  Record<SubstrateField, AuthoritySpec>
> {
  return AUTHORITY_TABLE;
}

/**
 * Closed-world substrate completeness check. All six
 * substrate identities MUST be present for any
 * PASS-eligible binding.
 */
export function isSubstrateComplete(
  b: LH06SubstrateBinding,
): boolean {
  return (
    b.phase_e_head !== null &&
    b.lh02_head !== null &&
    b.lh03_frozen_commit !== null &&
    b.lh04_frozen_commit !== null &&
    b.lh05_corpus_commit !== null &&
    b.repo_commit !== null
  );
}

