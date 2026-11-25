# Discipline Lab — provisional disciplines and DL-02's acceptance criteria

> ACT: `ACT-FACTORY-ML-02-MINIMAL-RUNNER-01`.
>
> These disciplines are PROVISIONAL. Each is grounded in an OBSERVED Factory
> failure, and each names the evidence that produced it. They are not
> doctrine: `docs/doctrine/README.md` only adopts a doctrine page when it
> is evidence-backed AND mechanically enforceable.

## The provisional disciplines

| # | Discipline | Grounded in the observed failure |
| --- | --- | --- |
| D1 | **Failure identity** | A negative verdict must be bound to the EXACT test identity and the EXACT failure mechanism, never to a substring of a whole log. `decideMutation` once accepted any non-zero exit (2, 125, 126, 127) as a detection; the classification was about the wrong failure. |
| D2 | **Evidence completeness** | A stream that lost records is not evidence. The completion record must carry the WHOLE counter contract, and the counters must reconcile unconditionally. The previous classifier accepted `{"counts":{"tests":9}}` and silently ignored the missing per-status counters. |
| D3 | **Reference independence** | A comparison against itself proves nothing. The reference must be an independent, identity-bound tree, and the expected digest must be supplied EXTERNALLY. |
| D4 | **Verification economics** | The ordinary gate must stay below five seconds on this host, and the acceptance criteria must NOT be weakened to recover the time. The real-fixture controls were MOVED to their own mandatory qualification level. |
| D5 | **Authorization non-consumption** | A capability is not an authorization. An existing credential, a write token, a mutation advertisement, auto-approval, or a previous authorized experiment must NOT authorize a new start. |
| D6 | **Positive authorization** | A refusal is not enough: an authorization must be BOUND to the exact prepared identity, and its absence must produce ZERO start calls. |
| D7 | **Provider protocol fidelity** | A configured reasoning effort is not proof of the effective wire-level effort, and a wall-clock deadline is not a provider-enforced cap. Provider fidelity is independent of lifecycle and source correctness. |
| D8 | **Experimental contract congruence** | The candidate-visible environment must match the declared contract: the dependencies the task assumes must actually be present, and network installation must be explicitly prohibited. LIVE-SMOKE-01B's candidate ran `npm ci` because neither the prompt nor the environment prevented it. |
| D9 | **Specification over historical implementation** | A known historical fix is ONE valid solution, not the specification. The task must describe the observable problem and the required behaviour, never the historical algorithm. |
| D10 | **Commit-per-ACT evidence locality** | Every ACT's implementation and evidence land in ONE cohesive local commit, so a reviewer can read the change as a unit. The operator has made this an explicit requirement for Factory development. |

## DL-02 — the first Factory verification skill: applicability and acceptance criteria

DL-02 is NOT built in this ACT. What follows is the PREPARATION: when it
may apply, and what would count as accepting it.

### Applicability

DL-02 applies when an agent is about to:

1. change a Model Lab oracle, its decision library, or its fixture
   preparation;
2. change a Factory gate script (`scripts/verify_factory*.sh`);
3. claim that a candidate result, a qualification identity, or a run
   bundle is valid;
4. prepare, execute or evaluate a Model Lab experiment.

### What the skill must do

A skill is a **ROUTING GUIDE to the EXISTING deterministic mechanisms**. It
must:

- name the existing command that already establishes the claim
  (`scripts/verify_factory.sh` for the ordinary gate,
  `scripts/verify_factory_qualification.sh` for the authoritative gate,
  `tests/model_lab/test_ml_02_runner.mjs` for the runner controls,
  `tests/model_lab/test_ml_06a_qualification.sh` for the ML-06A fixture);
- state WHEN that command is MANDATORY (an oracle authority change; before
  minting a candidate result; a fixture change);
- state what the command's PASS does and does NOT establish.

### What the skill must NOT do

- It must NOT reproduce the verifiers' logic in prose. A prose copy of a
  verifier is a second implementation, and a second implementation drifts.
- It must NOT introduce a skill registry, an installation mechanism, or a
  dispatcher framework.
- It must NOT be installed as `pstack`.
- It must NOT be evaluated by an A/B experiment in this ACT.

### Acceptance criteria for DL-02

DL-02 is accepted when, on a fresh task in this repository:

1. the agent invokes the EXISTING verification command for the claim it is
   making, rather than re-deriving the check;
2. the agent reports the command's ACTUAL exit code and the MEASURED
   elapsed time;
3. the agent does NOT weaken an acceptance criterion to satisfy the
   performance target;
4. the agent distinguishes what the command established from what it did
   not;
5. no new mechanism was introduced: the skill adds ROUTING, not
   machinery.

### Why the skill is a skill and not a script

A script that already exists is a script. DL-02 exists because the
MECHANISMS are scattered across several gate levels and several ACTs, and
an agent that does not know WHICH one applies will run the wrong one — or
none. The skill's value is SELECTION and PROVENANCE, not enforcement.

### Not done in this ACT

- No skill registry.
- No `pstack` installation.
- No skill A/B experiment.
