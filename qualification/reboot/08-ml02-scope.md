# ML-02 — Proposed Exact Scope

> Status: **proposed**. Nothing in this document has been implemented.
> This is the scope proposal for the next ACT, per REBOOT-01's exit contract.

---

## 1. Mission

Implement the smallest possible reusable single-run executor that:

1. materializes the qualified D01 fixture into a disposable workspace;
2. runs exactly one candidate execution against it;
3. extracts the candidate's patch;
4. hands the workspace to the evaluator-owned oracle;
5. records one machine-readable result.

**One run. No orchestration, no service, no daemon, no database.**

## 2. In scope

| # | Item | Notes |
| --- | --- | --- |
| 1 | `labs/model-lab/materialize_fixture.sh` | `git archive <base> \| tar -x` into a fresh temp dir; copies `node_modules`; records the fixture identity (base commit + tree hash) |
| 2 | `labs/model-lab/extract_patch.sh` | Produce a unified diff of the workspace against the base commit, restricted to the allowed paths; record changed-file list and LOC delta |
| 3 | `labs/model-lab/run_once.sh` | The orchestrator: materialize → execute → extract → verify → record |
| 4 | `labs/model-lab/result.schema.json` | The result record schema (see §5) |
| 5 | A candidate transport **stub** that fails closed with a clear message | The real transport is HAR-04's job; ML-02 must not depend on it |
| 6 | `labs/model-lab/README.md` | How to run it, what it does, what it does not do |

## 3. Explicitly out of scope

- No new orchestration framework.
- No message bus, no distributed workers, no database, no Kubernetes.
- No persistent autonomous process.
- No model provider integration (that is HAR-05).
- No new dependencies.
- No paid inference without explicit operator authorization.
- No modification of `labs/long-horizon-harness/src/` — the executor must reuse
  the existing `d01_acceptance_oracle.sh`, not reimplement verification.
- No commit and no push.

## 4. Execution profile

| Stage | Command / mechanism | Budget |
| --- | --- | --- |
| Materialize | `git archive` + `tar -x` + `cp -R node_modules` | ≤ 30 s |
| Execute | candidate transport (stub in ML-02) | ≤ 5 min (the proposed campaign value) |
| Extract | `git diff --no-index` against the base tree | ≤ 10 s |
| Verify | `bash labs/model-lab/d01_acceptance_oracle.sh <repo> <base> <ws>` | ≤ 10 min (observed ~20 s) |
| Record | write one JSON result | ≤ 1 s |

## 5. Result record

One JSON file per run, e.g.
`labs/model-lab/runs/<run_id>/result.json`:

```json
{
  "schema": "model-lab.run-result/v1",
  "run_id": "...",
  "fixture": { "duty_id": "D01", "base_commit": "09fc12c...", "tree_hash": "..." },
  "candidate": { "transport": "stub", "model": "...", "provider": "..." },
  "scope": { "allowed_paths": ["..."], "changed_paths": ["..."] },
  "acceptance": {
    "authority": "labs/model-lab/d01_acceptance_oracle.sh",
    "oracle_disposition": "PASS|FAIL",
    "scope_violations": 0,
    "mutation_detected": "YES|NO",
    "candidate_self_reported_success": true
  },
  "metrics": {
    "wall_clock_ms": 0,
    "first_attempt_success": false,
    "correction_cycles": 0,
    "input_tokens": null,
    "output_tokens": null,
    "production_loc_delta": 0,
    "new_dependencies": 0,
    "new_public_interfaces": 0
  },
  "disposition": "PASS|FAIL|HALT"
}
```

**The `candidate_self_reported_success` field is deliberately recorded next to
the oracle's verdict, and never used to derive it.** This is the structural
form of "a candidate's statement is an observation, not a verdict".

`wall_clock_ms` must measure **elapsed time to a verified result**, including
correction cycles — not time to first output.

## 6. Acceptance criteria for ML-02

- [ ] `run_once.sh` runs end to end against the D01 fixture and produces a
      `result.json`.
- [ ] With the historical fix applied to the workspace, the oracle verdict is
      `PASS`.
- [ ] With the unmodified base workspace, the oracle verdict is `FAIL`.
- [ ] With the qualifying test deleted, the oracle verdict is `FAIL`.
- [ ] No file outside the allowed paths is modified, and the runner detects it.
- [ ] A failure in any stage produces a truthful, non-zero exit and a result
      record with a typed disposition — never a silent success.
- [ ] The runner does not require any new dependency.
- [ ] `node` is resolved explicitly (it is **not** on the default `PATH` on
      this host).

## 7. Blockers and prerequisites

| Item | Status |
| --- | --- |
| D01 fixture qualified | **DONE** (smoke) |
| Evaluator-owned oracle | **DONE** |
| Candidate transport | **BLOCKED on HAR-02/HAR-04** — ML-02 must ship with a fail-closed stub until then |
| Token-level leakage scan | Outstanding from ML-01 |
| `codium-lab` instance | Does not exist |

## 8. Why this order

The executor is the smallest unit that produces a *measured* result. It is
worth building before the transport is complete, because the transport is the
risky part and the executor is the part that must not change later. The
executor defines the result schema; every later experiment — model
comparison, discipline A/B — reuses it unchanged.
