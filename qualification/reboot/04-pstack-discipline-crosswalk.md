# REBOOT-01 — pstack → Factory Discipline Crosswalk

> Upstream: `cursor/plugins` → `pstack/` at commit
> `9e278fe4d4ecd8bfe98b1b79bf4be662efb338cc` (2026-11-24T00:41:29Z), branch
> `main`. License: **MIT**.
>
> Inspection was **read-only**. No upstream script was executed, no plugin was
> installed, and no upstream file was copied into this repository.

---

## 1. What upstream actually provides (observed)

pstack is a Cursor plugin exposing one main entry-point skill (`poteto-mode`)
plus 22 playbooks, 60+ skills, and 24 named principles. Its relevant surface:

| Upstream item | Observed nature |
| --- | --- |
| `poteto-mode` | Main entry point: reads the request, picks a playbook, routes to other skills, writes a verbatim todo list |
| `correct` | Mines history for mistake classes; fixes each at the **highest level that works** (architecture → types → lint → CI → tests → docs); requires proving each new check fails on a real past mistake; maintains a rule→enforcer table |
| `reflect` | Mines the transcript for durable learnings; routes each to an edit on an existing skill; Accepted / Rejected / Backlog; requires approval before editing |
| `create-verification-skill` | Generates a project-local `verify-<app>` skill with sections **Launch / Doctor / Drive / Evidence / Cleanup / Helpers**, plus a `features/` map (one file per user-facing feature, four H2s) |
| `maintain-verification-skill` | Keeps the feature map honest as the app changes |
| `tdd` | Write the failing test first, then the fix |
| `benchmark-checklist` | Vets a measured number before it is reported or acted on: limiter, tuning, errors, repeat runs, end-to-end relevance |
| `principle-encode-lessons-in-structure` | "Encode the rule as a lint, metadata flag, runtime check, or script instead of more text" |
| `principle-prove-it-works` | Verify against the real artifact, not a proxy, self-report, or "it compiles" |
| `principle-test-behavior-not-implementation` | Assert observable behavior, not internals |
| `principle-explain-the-number` | Find what limits a measurement; rule out that it measured something other than the work |

**ClineMM compatibility is not established.** Upstream documents Cursor and
Claude Code support. pstack relies on Cursor-specific primitives
(`.cursor/skills/`, `/poteto-mode` slash routing, `poteto-agent` subagent type,
`Comment Sicko`, plugin marketplace install). None of these are verified
present in ClineMM.

## 2. Capability crosswalk

| Upstream capability | Existing Factory equivalent | Gap | Proposed experiment | Destination |
| --- | --- | --- | --- | --- |
| `create-verification-skill` → `verify-<app>` skill with Launch/Doctor/Drive/Evidence/Cleanup | `scripts/verify_factory.sh` + the five `verify_lh*_frozen.sh` gates; `docs/playbooks/` | Factory has **gates** but no **skill** that tells an agent how to invoke them, distinguish smoke from qualification, and collect evidence | DL-02: author `verify-factory` skill; DL-03: blinded A/B, same fixture, with vs without skill | **Skill** (an interface to existing deterministic code) |
| `correct` → fix mistake classes at the highest level that works; keep a rule→enforcer table | `docs/doctrine/` + the frozen-substrate guards; no rule→enforcer table exists | Factory records doctrine **narratively**; it does not pair each rule with the mechanism that enforces it | DL-04: extend the D01 mutation control into a reusable rule→enforcer ledger | **Deterministic code** + a table, not prose |
| `reflect` → route learnings to skill edits; Accepted/Rejected/Backlog | `docs/templates/close-report.md` has a "Reviewer Feedback Addressed" section | No triage step; no "does this lesson route to a skill or to nothing?" decision | DL-04: add a 5-way routing decision to the close report (architecture / deterministic gate / skill / rule / no change) | **Rule** (process) + a template edit |
| `tdd` → failing test first | `src/ledger-writer/` sole-writer; LH-03/LH-04 fault lab; D01's mutation control | Factory has *mutation controls* but not a *test-first* discipline for ordinary work | Compare a candidate fixing D01 with vs without the tdd playbook | **Skill** |
| `benchmark-checklist` → vet a measured number before reporting it | `src/metrics/`; `scripts/verify_lh06_frozen.sh` | Metrics exist; there is no "explain the number" step before publishing a result | Apply the checklist to the first Model Lab report; check whether it changes any conclusion | **Rule** |
| `principle-encode-lessons-in-structure` | `scripts/verify_worktree_policy.sh` (a doctrine encoded as a gate) | Already strongly embodied | **No experiment needed** — cite as the reference implementation | **Architecture** (already done) |
| `principle-prove-it-works` | `docs/doctrine/README.md` ("Untested principles belong in speculation") | Already embodied; the D01 oracle operationalizes it | **No experiment needed** | **Architecture** (already done) |
| `principle-test-behavior-not-implementation` | LH-05/LH-06 adversarial corpus; `lifecycle-corpus/expected/` | Partially embodied | Check whether the Model Lab oracle tests behavior or implementation | **Deterministic code** |
| `principle-subtract-before-you-add`, `principle-laziness-protocol` | `labs/long-horizon-harness/docs/SOURCE_SIZE_DISCIPLINE.md` (400-LOC cap) | Partially embodied — a size cap, not a subtraction bias | DL-05: measure production LOC delta and new abstractions as first-class Model Lab metrics | **Metric** |
| `principle-never-block-on-the-human` | Factory's HALT discipline (truthful halt dispositions) | Factory *does* block on the human for budget — deliberately and correctly | No experiment | **Rule** (already correct) |

## 3. The inverse trust pyramid — Factory adaptation

pstack's central claim is that a recurring correction should become a property
of the engineering environment rather than something a reviewer must keep
explaining. Factory already embodies this in several places; the table below
maps the recurring agent mistakes to what actually enforces them today.

| Recurring mistake | Weak solution | Factory's strong mechanism | **Exists today?** |
| --- | --- | --- | --- |
| Agent declares success without evidence | another prompt warning | only the external gate can produce a verdict | **YES** — `d01_acceptance_oracle.sh` (this ACT) |
| Agent creates a vacuous test | TDD instructions | a known-bad mutation must fail | **YES** — mutation control, Control 3 |
| Agent validates the wrong platform | "tell it to check the platform" | CI compiles the actual target | **YES** — `npm run typecheck`, `verify_factory.sh` |
| Agent modifies protected artifacts | "tell it not to" | filesystem boundary + fingerprint gate | **PARTIAL** — D01 oracle scope check is path-based; frozen-substrate guards are fingerprint-based |
| Agent confuses missing evidence with negative evidence | explain the distinction | distinct typed outcome states | **YES** — `harness-adapter-errors.ts`, typed dispositions, `HALT_*` / `PASS_*` vocabulary |
| Agent repeats obsolete patterns | document the preferred pattern | remove the obsolete implementation | **GAP** |
| Agent overengineers | "write simpler code" | reviewable complexity budget + constrained interfaces | **PARTIAL** — 400-LOC source-size discipline exists; no automatic measurement of *added* complexity |

**The two genuine gaps are: removing obsolete implementations, and measuring
added complexity.** The second is directly actionable as DL-05.

## 4. Recommended initial discipline experiments (at most three)

Per the ACT's constraint of *at most three* initial experiments, and ordered by
expected information gain per unit of effort:

### Experiment 1 — `verify-factory` skill (DL-02 + DL-03)

**Question:** does a skill that teaches an agent to invoke Factory's existing
verifiers, navigate acceptance gates, distinguish smoke from qualification, and
collect evidence improve correctness and elapsed time to a verified result?

**Design:** blinded A/B on the same qualified D01 fixture.
- Arm A: baseline, no skill.
- Arm B: `verify-factory` skill present.
- Identical fixture, identical model, identical prompt, identical budget.
- Metric: independent-oracle acceptance (mandatory), wall-clock to verified
  result, correction cycles.

**Why first:** the skill's whole content is "here are the verifiers that
already exist and how to call them". It is the smallest possible skill, it
needs no new machinery, and it is the substrate every other discipline
experiment depends on. If a skill cannot improve D01, no skill will.

**Destination:** Skill (interface to existing deterministic code). It must
**not** reimplement the verifiers in prose.

### Experiment 2 — feedback compiler with the 5-way routing decision (DL-04)

**Question:** do Factory corrections produce a measurable improvement in
subsequent runs when routed by destination, rather than accumulating as
anecdotal doctrine?

**Design:** take every correction observed during Experiment 1 and the first
Model Lab campaign. Route each to architecture / deterministic gate / skill /
rule / no-change. Then run the next candidate repetition and measure whether
the error class recurred.

**Destination:** the routing decision itself is a **rule** (a process edit to
the close-report template); the routed outcomes are **deterministic code**,
**skills**, or **doctrine** as appropriate.

### Experiment 3 — simplicity measurement (DL-05)

**Question:** does the environment's complexity budget actually reduce
unnecessary change?

**Design:** instrument the Model Lab to record production LOC delta, new
dependencies, new public interfaces, and new abstractions per run. Compare
arms.

**Destination:** **Metric** in the Model Lab result schema, plus possibly a
**deterministic gate** once a baseline exists.

## 5. What must NOT be copied wholesale

- Do **not** install pstack into ClineMM. Cursor-specific primitives
  (`.cursor/skills/`, slash-command routing, `poteto-agent` subagent type,
  plugin marketplace) are unverified in ClineMM.
- Do **not** copy the 22-playbook router. Factory needs *one* skill first.
- Do **not** copy upstream skills that reimplement what deterministic code
  already does.
- Do **not** create a universal skill registry. The proposed Factory skill
  layout is `SKILL.md` + optional `references/`, `scripts/`, `evals/`, and
  `evals/` must contain Factory-owned evaluation cases.

## 6. A caution on skill-count

pstack ships 60+ skills. Factory's evidence-based culture argues for measuring
before adopting. The claim that a smaller model equipped with focused skills
can match a larger model without them is plausible but, for Factory, still a
hypothesis. **DL-03's blinded A/B is the test.** Until it runs, no skill
count target is justified.

## 7. Crosswalk status

```text
PSTACK_CROSSWALK_DISPOSITION = COMPLETE
UPSTREAM_INSPECTED            = true
UPSTREAM_COMMIT               = 9e278fe4d4ecd8bfe98b1b79bf4be662efb338cc
UPSTREAM_EXECUTED             = false
UPSTREAM_INSTALLED            = false
CLINEMM_COMPATIBILITY         = NOT_ESTABLISHED
INITIAL_EXPERIMENTS_RECOMMENDED = 3
```

The crosswalk is tracked separately from the primary disposition, as required.
