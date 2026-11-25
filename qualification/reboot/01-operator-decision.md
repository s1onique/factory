# REBOOT-01 — Operator Decisions (current intent)

> These decisions are **current intent only**. They do not alter, supersede, or
> reinterpret any historical record. The LH-07 historical disposition remains
> `HALT_BUDGET` in `qualification/lh07/06-campaign-disposition.json`, unmodified.

---

## 1. Priority order

Correctness is a hard constraint. Speed and simplicity are optimization
objectives. Cost efficiency is secondary. Autonomy duration is postponed.

| Rank | Objective | Status in this ACT |
| --- | --- | --- |
| 1 | Correctness (independently established) | Enforced: acceptance oracle owns the verdict |
| 2 | Speed (elapsed time to a *verified* result) | Measured; recorded per gate run |
| 3 | Simplicity (of code and of the machinery producing it) | One new script, no new dependencies |
| 4 | Cost efficiency | No paid inference was executed |
| 5 | Autonomy duration | **Deferred**, not abandoned |

## 2. Decision to defer LH-07

**LH-07 is deferred, not abandoned.** The corpus remains unratified as a
qualified corpus. The reasons recorded during this ACT are corpus-authoring
defects, not disqualifications:

- **D01** practically states the solution in the task prompt. Useful as a
  smoke fixture; it does not discriminate between capable models.
- **D02** lets the agent author the test that serves as its own success
  oracle. It needs mutation controls before it can be trusted.
- **D04** evaluates an agent-authored verification script by executing that
  very script; an unconditional `exit 0` would satisfy the recorded command.
  D04 also conflicts with the common `forbidden_paths_glob`.
- The fixture hashes and leakage scans were never established by a completed
  run (`leakage_scan_disposition: "PENDING_RUN"` in the frozen corpus).
- **D05** does not yet distinguish duplicate captures from legitimate capture
  reuse during continuation.

D01 was nevertheless qualified in this ACT as a **smoke fixture only**, with
an evaluator-owned oracle that includes a mutation control. See
`02-d01-fixture-qualification.md`.

## 3. Two labs, one improvement cycle

| Variable | Model Lab | Discipline Lab |
| --- | --- | --- |
| Model | changes | fixed |
| Harness | fixed | fixed |
| Task corpus | fixed | fixed |
| Rules | fixed | experimental |
| Skills | fixed | experimental |
| Architecture | fixed | experimental (separate campaigns) |
| Acceptance criteria | fixed | fixed |

Both labs will use the same execution machinery eventually, but that
generalization is deliberately deferred until a few experiments have actually
run. Building one runner now is acceptable; building two is not.

## 4. D01 is a smoke test, not a competence measurement

A successful D01 run establishes that the pipeline, the fixture, and the
oracle work end to end. It says nothing about general model competence, and
must never be reported as such.

## 5. Amendment A — dedicated `codium-lab` instance

The operator has directed that a separate ClineMM/VSCodium instance named
`codium-lab` serve as the initial candidate execution environment, with MCP
as the preferred initial candidate control transport, while `codium-factory`
remains the engineering operator.

**Discovery finding:** `codium-lab` does not exist on this host. It must be
created. The control transport that ClineMM actually implements is a local
Unix-domain-socket "control seam" with a newline-delimited JSON protocol —
**not** an MCP server. See `06-codium-lab-capability-matrix.md` for the
observed interface, the exact operation set, and the authorization model.

This is recorded as a factual discovery result, not as a rejection of the
operator's direction. The control seam exposes exactly the six operations
the Model Lab needs (capabilities, get run, start ACT, read events, send
feedback, cancel run) and is the transport that HAR-02 should qualify.

## 6. Scope discipline for the next ACTs

The next ACTs will **not** build: a generalized benchmark definition language,
a sophisticated agent workflow engine, multi-agent reviewer panels, a universal
skill registry, an evidence database, comprehensive observability
infrastructure, automatic skill mutation, or a composite leaderboard that
conceals individual failure modes.

None of these are prerequisites for comparing two models on one reproducible
task.

## 7. Graduated rigor (Factory's own ACT system)

| Mode | Typical task | Required discipline |
| --- | --- | --- |
| FAST | small localized change | scope, targeted tests, concise evidence |
| STANDARD | ordinary bug fix or feature | reproduction, implementation, regression tests |
| STRICT | authority boundary, security, persistence | adversarial controls, independent review |
| QUALIFICATION | harness or infrastructure certification | full Factory qualification machinery |

A one-line fix must not require a 90-section ACT. A change to the authority
boundary must not be able to select FAST to avoid scrutiny; deterministic
policy should eventually impose a minimum rigor level from the affected
surfaces. That policy work is **not** in scope for this ACT.
