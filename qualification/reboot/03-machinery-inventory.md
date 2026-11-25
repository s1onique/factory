# REBOOT-01 — Existing Machinery Inventory

> Purpose: identify what Factory **already has**, so the Model Lab and the
> Discipline Lab reuse instead of rebuilding. No replacement machinery was
> created for capabilities that already exist.

---

## 1. Repository layout

```text
.factory repo
├── AGENTS.md                     canonical agent entrypoint
├── .clinerules/00-agents.md      redirect to AGENTS.md
├── docs/                         concepts, doctrine, playbooks, templates, evaluation
├── labs/long-horizon-harness/    the existing harness laboratory (TypeScript)
├── qualification/                frozen-substrate verifiers + LH-06/LH-07 evidence
├── scripts/                      deterministic verifiers and digest tooling
└── tests/                        worktree-policy and LH-06 frozen adversarial tests
```

## 2. Deterministic verifiers (all executable today)

| Path | Purpose | Status |
| --- | --- | --- |
| `scripts/verify_factory.sh` | Top-level authoritative gate; chains 1–6 below | IMPLEMENTED, PASSING |
| `scripts/verify_worktree_policy.sh` | `FACTORY_GIT_WORKTREE_POLICY` enforcement | IMPLEMENTED, PASSING |
| `scripts/check_links.sh` | Documentation link sanity; also runs the worktree policy | IMPLEMENTED, PASSING |
| `scripts/verify_lh03_frozen.sh` | Phase E + LH-02 frozen-contract guard | IMPLEMENTED, PASSING |
| `scripts/verify_lh04_frozen.sh` | LH-04 fault-lab frozen guard | IMPLEMENTED, PASSING |
| `scripts/verify_lh05_frozen.sh` | LH-05 adversarial lifecycle corpus guard | IMPLEMENTED, PASSING |
| `scripts/verify_lh06_frozen.sh` | LH-06 deterministic-soak freeze guard | IMPLEMENTED, PASSING |
| `scripts/verify_lh06_frozen_data.ts` | Companion data verifier for LH-06 | IMPLEMENTED |
| `scripts/make_targeted_digest.sh` | Repository digest generation | IMPLEMENTED |
| `scripts/make_review_prompt.py` | Digest → review-prompt generation | IMPLEMENTED |

The gate pattern is consistent and is the template the Model Lab should follow:
a small cohesive script, a machine-readable `*_DISPOSITION=OK|FAIL` line, exit
code 0/1, read-only with respect to the repository.

## 3. Harness laboratory (`labs/long-horizon-harness`)

TypeScript, `type: module`, `engines.node >= 20`. Dependencies: `tsx`,
`typescript`, `@types/node`. **No new dependencies are required for the Model
Lab.**

### 3.1 Protocol and identity

| Path | Purpose |
| --- | --- |
| `src/protocol/harness-adapter.ts` | V1 adapter contract |
| `src/protocol/harness-adapter-v2.ts` | V2 adapter contract |
| `src/protocol/harness-identity.ts` | Harness identity model |
| `src/protocol/harness-capabilities.ts` | Capability declaration model |
| `src/protocol/harness-run.ts` | Run envelope model |
| `src/protocol/harness-adapter-errors.ts` | Typed adapter errors |

### 3.2 Adapters

| Path | Purpose | Status |
| --- | --- | --- |
| `src/adapters/cline/cline-adapter.ts` | Cline / ClineMM adapter | **STUB** — identity fields are null until ClineMM is live; `Live-capture entry. NOT YET CALLED` |
| `src/adapters/pi/pi-adapter.ts` | Pi adapter | IMPLEMENTED |
| `src/adapters/fake/scripted-fake-adapter.ts` | Scripted fake adapter | IMPLEMENTED |
| `src/adapter-common/` | Shared adapter helpers | IMPLEMENTED |

The Cline adapter is the closest existing analogue to a codium-lab adapter and
should be **extended**, not replaced, by HAR-04.

### 3.3 Execution and evidence subsystems

| Path | Purpose | Status |
| --- | --- | --- |
| `src/process/` | Supervised process, process group | IMPLEMENTED |
| `src/evidence/` | JSONL ledger | IMPLEMENTED |
| `src/ledger-writer/` | Sole-writer ledger authority | IMPLEMENTED, LH-06 frozen |
| `src/recovery/` | Crash/restart reconciliation | IMPLEMENTED |
| `src/witness/` | Witness codec | IMPLEMENTED |
| `src/witness-start/` | Witness start/readiness | IMPLEMENTED |
| `src/run/` | Run evidence contract | IMPLEMENTED |
| `src/metrics/` | Metric computation | IMPLEMENTED |
| `src/subject/` | Subject canonicalization / freeze | IMPLEMENTED |
| `src/redaction/` | Secret redaction | IMPLEMENTED |
| `src/qualification/` | Qualification support | IMPLEMENTED |

### 3.4 Fixture and corpus assets

| Path | Purpose |
| --- | --- |
| `test/fixtures/harnesses/pi/pi-v0_85_1/` | Frozen Pi capture fixtures (identity, capabilities, projection, events) |
| `test/fixtures/harnesses/cline/cline-discovery-only/` | Cline **discovery-only** fixture (no live capture) |
| `lifecycle-corpus/` | Adversarial lifecycle scenarios LC01..LC12 |
| `lifecycle-corpus/catalog.ts`, `expected/` | Scenario catalog + expected projections |
| `fault-lab/deterministic/` | Deterministic fault injection laboratory |

## 4. Reuse map for the Model Lab pipeline

The proposed Model Lab pipeline maps onto existing machinery as follows.

| ML pipeline stage | Existing Factory component | Gap |
| --- | --- | --- |
| 01 Materialize fixture | `git archive` + `src/subject/` canonicalization | **GAP**: no disposable-fixture materializer exists |
| 02 Execute candidate | `src/process/` supervised process; Cline adapter | **GAP**: adapter is a stub |
| 03 Collect patch | `src/evidence/` JSONL ledger; `src/run/` contract | **GAP**: no patch extraction step |
| 04 Independently verify | `scripts/verify_*` pattern | **PARTIAL**: D01 oracle now exists (`labs/model-lab/d01_acceptance_oracle.sh`) |
| 05 Record result | `src/metrics/`, `qualification/` JSON evidence | **PARTIAL**: no model-lab result schema |

### Capability summary

| Capability | Status |
| --- | --- |
| Fixture materialization | MISSING |
| Isolated candidate execution | PARTIAL (process supervision exists; Cline adapter is a stub) |
| Harness invocation | PARTIAL |
| Native event collection | IMPLEMENTED for Pi; STUB for Cline |
| Independent verification | IMPLEMENTED for frozen substrates; NEW for candidate patches (D01 oracle) |
| Patch scope enforcement | NEW (`d01_acceptance_oracle.sh`, path-based only) |
| Evidence collection | IMPLEMENTED (JSONL ledger, qualification records) |
| Model identity / usage reporting | PARTIAL (Pi adapter reports; Cline adapter does not) |
| Result recording | MISSING for the model-lab schema |

**Only two capabilities are genuinely missing for a first single run: fixture
materialization and patch extraction.** Everything else can be reused.

## 5. Documentation and process conventions to follow

- Epic board template: `docs/templates/epic.md` (sections: Problem, Goal,
  Non-goals, Context/Evidence, Constraints, ACT Board, Verification Strategy,
  Risks and Unknowns, Close Criteria, Follow-ups).
- ACT template: `docs/templates/act.md`.
- Close report template: `docs/templates/close-report.md`.
- Playbook conventions: `docs/playbooks/README.md` — sequential steps, explicit
  entry/exit criteria, checkpoints, honesty about what is not yet written.
- Doctrine conventions: `docs/doctrine/README.md` — evidence-backed only; no
  placeholder doctrine pages.

**There is no existing epic board file.** `docs/templates/epic.md` is the only
epic artifact. The board created by this ACT is therefore a new file, not an
edit to an existing one.

## 6. What this ACT did *not* create

Deliberately absent, per the simplicity constraints:

- no orchestration framework
- no database or persistent service
- no distributed execution
- no new harness implementation
- no new model provider integration
- no new dependency of any kind

The only code added is one shell script, `labs/model-lab/d01_acceptance_oracle.sh`,
which uses `git`, `node`, `python3`, and coreutils already present on the host.
