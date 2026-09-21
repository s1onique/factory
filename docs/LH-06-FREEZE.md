# LH-06 Freeze Report

> ACT `ACT-FACTORY-LONG-HORIZON-LAB-LH06-DETERMINISTIC-SOAK01-QUALIFICATION02-CLOSURE-FREEZE01`
>
> This file is the durable closure-of-record for LH-06
> (deterministic soak / qualification). The freeze lands on the
> canonical `main` branch. No linked worktree was used. No
> detachment was used.

## Mission

Close and freeze LH-06 using the successful production
QUALIFICATION02 result.

## Qualified subject

```text
LH06_SUBJECT_COMMIT =
  5d4c9d258446cba1b018ab689433bafe162feefb
```

Successful qualification:

```text
QUALIFICATION02_RUN_ID =
  9abce4954edbdb34

QUALIFICATION02_SUPERVISOR_RUN_ID =
  f7f4b208772caa8b
```

Exit target:

```text
LH_06 = GREEN_FROZEN
READY_FOR_LH_07 = YES
```

## Contract

```text
schema           = lh06.deterministic.soak.result.v1
contract_version = lh06.soak.contract.v1
profile          = QUALIFICATION

minimum_wall_clock_ms = 3,600,000
minimum_epochs        = 500
```

## Environment (frozen identity)

```text
os                 = darwin/arm64
arch               = arm64
node_version       = v26.0.0
cpu_count          = 1
total_memory_bytes = 68,719,476,736
soak_run_id        = 9abce4954edbdb34
```

These describe the qualification environment, not general
claims about every platform.

## QUALIFICATION01 — RED evidence (preserved)

The first LH-06 production qualification run produced a valid
negative result that exposed the then-current experimental
machinery defects:

```text
run_id            = 7aab74ed17082938
supervisor_run_id = 423d4674a3883634
duration_ms       = 3,600,042
epochs_completed  = 38,075
cases_completed   = 1,180,325
worker verdict    = FAIL_SEMANTIC_DRIFT
failure.kind      = LIFECYCLE_DRIFT
lifecycle_drift_count = 38,075
substrate_complete = false
phase_e_head      = null
lh02_head         = null
frozen_tree.changed = false
publication_durability = CRASH_DURABLE

# Supervisor rewrite (terminal artifact):
supervisor verdict = FAIL_WORKER
supervisor reason  = verifier_rejected:INCOMPLETE_SUBSTRATE

# Teardown defect:
terminal teardown: ResourceLedger.endRun
unknown runId 7aab74ed17082938
```

QUALIFICATION01 exposed:

```text
C42  duplicate run-resource release
C43  broken Phase-E / LH-02 substrate authority resolution
C44  supervisor masking truthful negative evidence
C45/C48/C49  LC11 canonical-temp lifetime/path defect
C46  false zero-duration supervisor terminal artifact
C47  missing bounded drift attribution
```

QUALIFICATION01 is preserved as first-class evidence:

```text
labs/long-horizon-harness/qualification/lh06-red-2026-09-21/
qualification/lh06-red-qualification01/
```

Both packets remain SHA-verifiable; the factory-root packet
includes `SHA256SUMS` that the frozen guard re-runs.

## Correction sequence summary

```text
Initial LH-06 implementation
  -> deterministic machinery established

CORRECTION01..10
  -> supervisor execution
  -> honest minimum-duration semantics
  -> recursive frozen-tree integrity
  -> durable telemetry
  -> verifier/supervisor authority
  -> verdict-derived failures
  -> commit witness
  -> closure-phase completeness
  -> durability reconciliation
  -> unified supervisor publication

QUALIFICATION01 RED
  -> systematic LC11 failure
  -> missing Phase-E/LH-02 substrate identity
  -> duplicate run release
  -> negative-evidence masking
  -> false supervisor duration

CORRECTION11/12 zone
  -> single run owner
  -> authoritative substrate records
  -> negative result preservation
  -> canonical async-safe LC11 bridge
  -> honest timing
  -> bounded drift attribution

CI_SMOKE
  -> green production composition

QUALIFICATION02
  -> green 60-minute qualification
```

## QUALIFICATION02 — GREEN evidence

```text
schema            = lh06.deterministic.soak.result.v1
contract_version  = lh06.soak.contract.v1
profile           = QUALIFICATION
started_at        = 2026-09-21T21:08:15.454Z
finished_at       = 2026-09-21T22:08:15.472Z
duration_ms       = 3,600,018
epochs_completed  = 31,531
cases_completed   = 977,461
failure           = null
verdict           = PASS_DETERMINISTIC_SOAK
publication_durability = CRASH_DURABLE
```

Evidence bytes (SHA-256):

```text
result.json            = b55ba6179ef1533b85499c083142604d869549e4fd9b0300b730854a62f6464b
result.commit.json     = 0c5f365112e01b92807e016b3250e2b46378007d3318fb2e44bf9c395e6d52fe
telemetry.jsonl        = fb17967cd3c9375a938937db50447c4a8c2002ed3f5374cfaea8245fbc1538dd
  telemetry bytes      = 4,357,011
  telemetry lines      = 31,531
qualification.log      = 67cb87ba1267e7afea1b3ed33513e34b782832afd866a2b00c1d8f63ca4a2286
```

Frozen packet path:

```text
labs/long-horizon-harness/qualification/lh06-qualification02/
  result.json
  result.commit.json
  telemetry.jsonl
  qualification.log
  MANIFEST.json
  README.md
  SHA256SUMS
```

Freeze record:

```text
qualification/lh06-frozen.json
```

Frozen verifier:

```text
scripts/verify_lh06_frozen.sh
```

Adversarial corpus:

```text
tests/lh06-frozen/test_lh06_frozen.sh
  LH06-FREEZE-CONTROL01  (committed packet)
  LH06-FREEZE-NEG01..15  (15 mutation oracles)
```

## Semantic evidence

```text
drift_count                         = 0
fault_escape_count                  = 0
lifecycle_drift_count               = 0
predecessor_dependency_count        = 0
cases_with_multiple_semantic_results = 0
lifecycle_drift_by_scenario         = {}
canary_before_equals_canary_after   = true

SEMANTIC_DRIFT_OBSERVED       = FALSE
FAULT_ESCAPE_OBSERVED         = FALSE
LIFECYCLE_DRIFT_OBSERVED      = FALSE
PREDECESSOR_DEPENDENCY_OBSERVED = FALSE
MULTIPLE_SEMANTICS_PER_CASE   = FALSE

LC11_DRIFT_OBSERVED = FALSE
```

## Resource evidence

```text
resource_balance_failures = 0
workspace_leaks           = 0

RESOURCE_BALANCE_FAILURE  = FALSE
WORKSPACE_LEAK            = FALSE
```

## Heap evidence (V1)

```text
post_gc_heap_first_window = 11,285,708
post_gc_heap_last_window  = 12,019,932
post_gc_heap_delta        =    734,224
heap_slope_bytes_per_epoch = 84.62998046523425
heap_verdict.pass         = true
heap_verdict.reason       = STABLE

HEAP_STABILITY = PASS
```

## Latency evidence

```text
first_window_median_ms = 117
last_window_median_ms  =  89
drift_ratio            = 0.7606837606837606
verdict                = STABLE

LATENCY_STABILITY = PASS
```

## Frozen-tree evidence

```text
before_sha256 = 9178678c523207db6ad3db683bec3c5611d818e4887831f5dc123fe2daf4c51c
after_sha256  = 9178678c523207db6ad3db683bec3c5611d818e4887831f5dc123fe2daf4c51c
changed       = false
status.ok     = true
status.kind   = VALID

FROZEN_TREE_MUTATION = FALSE
```

## Commit witness

```text
schema           = lh06.commit-witness/v1
result_sha256    = b55ba6179ef1533b85499c083142604d869549e4fd9b0300b730854a62f6464b
supervisor_run_id = f7f4b208772caa8b
run_id           = 9abce4954edbdb34
profile          = QUALIFICATION
verdict          = PASS_DETERMINISTIC_SOAK
durability       = CRASH_DURABLE
```

The witness was originally issued for the runtime canonical
result path (`labs/long-horizon-harness/qualification/lh06-deterministic-soak.json`).
The freeze manifest records both that original path and the
preserved archive path. The witness bytes are not rewritten;
byte-identity between archive `result.json` and the originally
witnessed path is proven via SHA-256.

## Telemetry binding

```text
telemetry.jsonl SHA-256 = fb17967cd3c9375a938937db50447c4a8c2002ed3f5374cfaea8245fbc1538dd
telemetry bytes         = 4,357,011
telemetry lines         = 31,531

# Three-way agreement (recomputed, not trusted):
sha256(telemetry.jsonl)  == result.telemetry_sha256   ✓
byte-count(telemetry)    == result.telemetry_bytes    ✓
line-count(telemetry)    == result.telemetry_line_count ✓
```

Original runtime path (no longer required for freeze):

```text
ORIGINAL_RUNTIME_TELEMETRY_PATH_REQUIRED_FOR_FREEZE = FALSE

/var/folders/0g/mpt_55f524ndzxymkp20wjfc0000gn/T/
  factory-lh06-supervisor-f7f4b208772caa8b/
  lh06-9abce4954edbdb34.telemetry.jsonl
```

## RSS observation (NON-AUTHORITATIVE)

```text
rss_first_window = 118,185,984
rss_last_window  = 197,279,744
rss_delta        =  79,093,760
rss_slope        =   3,656.569706890133

RSS_GROWTH_OBSERVED = TRUE
RSS_DELTA_BYTES     = 79,093,760
RSS_CAUSE           = UNKNOWN
RSS_V1_AUTHORITY    = NONE
RSS_FOLLOW_UP_REQUIRED_FOR_LH06_FREEZE = FALSE

RSS_GROWTH_FOLLOW_UP = DEFERRED
```

Status: **OBSERVED**. **NOT LH-06 V1 PASS/FAIL AUTHORITY.**
Possible interpretations (none established by LH-06 alone):

* allocator retention
* native/runtime memory
* JIT / code pages
* mapped buffers
* fragmentation
* cache growth
* other process-runtime state

LH-06 evidence alone does not attribute cause.

## Limitations

The supported conclusion is:

> Under the frozen LH-06 V1 deterministic-soak contract, on the
> qualified subject
> `5d4c9d258446cba1b018ab689433bafe162feefb`, the corrected
> long-horizon laboratory completed a production QUALIFICATION
> run lasting 3,600,018 ms across 31,531 epochs and 977,461
> case executions without semantic drift, lifecycle drift,
> fault escape, predecessor-dependent semantics, resource-ledger
> imbalance, workspace leakage, frozen-source mutation,
> heap-instability verdict, or latency-instability verdict.
> The result, commit witness and 31,531-line telemetry stream
> are mutually bound by independently verified SHA-256 evidence
> and report crash-durable publication.

The unsupported conclusion is:

> Factory has proven all coding harnesses reliable forever.

This freeze does NOT claim:

```text
- all possible long-horizon coding tasks are reliable
- all harnesses are qualified
- live Pi provider execution is qualified
- Cline live execution is qualified
- RSS is stable
- native memory does not grow
- no leak exists anywhere
- performance is universally representative
```

## Patch hygiene

```text
PATCH_HYGIENE_ADVISORY =
  1 historical EOF finding accepted as non-semantic

  # The file labs/long-horizon-harness/test/lh06/_lh06-lab-root.ts
  # was committed in the qualified subject (5d4c9d2, CORRECTION11)
  # without a trailing LF. This causes the lab's own
  # EOF01 + GP02 tests to fail with:
  #   AssertionError: test/lh06/_lh06-lab-root.ts must end with LF
  # The finding is pre-existing in the qualified subject. The
  # closure's `git diff --check` is clean (the freeze diff itself
  # introduces no new whitespace defects), but the inherited
  # historical finding is consciously accepted per ACT §46
  # (do not let pre-existing residue block the scientific freeze,
  # but closure must describe it accurately).
```

## Freeze verdict

```text
LH_06                = GREEN_FROZEN
READY_FOR_LH_07      = YES
SUBJECT_COMMIT       = 5d4c9d258446cba1b018ab689433bafe162feefb
RESULT_SHA           = b55ba6179ef1533b85499c083142604d869549e4fd9b0300b730854a62f6464b
TELEMETRY_SHA        = fb17967cd3c9375a938937db50447c4a8c2002ed3f5374cfaea8245fbc1538dd
TELEMETRY_LINES      = 31531
QUALIFICATION_VERDICT = PASS_DETERMINISTIC_SOAK
PUBLICATION_DURABILITY = CRASH_DURABLE
SEMANTIC_DRIFT       = 0
LIFECYCLE_DRIFT      = 0
RESOURCE_BALANCE_FAILURES = 0
WORKSPACE_LEAKS      = 0
HEAP_STABILITY       = PASS
LATENCY_STABILITY    = PASS
FROZEN_TREE_INTEGRITY = PASS
SUBSTRATE_COMPLETE   = TRUE
```

## Doctrine extracted from LH-06

```text
D-LH06-01  Repetition count is not defect cardinality.

D-LH06-02  Missing success authority must block success, not
          erase more specific negative evidence.

D-LH06-03  Teardown, publication, provenance and verification
          are part of the experiment.

D-LH06-04  Durable claims require externally re-verifiable
          evidence.

D-LH06-05  Never change qualification thresholds after
          observing the qualification data.

DOCTRINE_PROPOSAL_ONLY = TRUE
```

## Next state

```text
LH_06 = GREEN_FROZEN

NEXT = DEFINE_LH07_ACT_FROM_REMAINING_BOARD_WORK
```

The ACT does not invent an LH-07 mission. The next action is
to inspect the remaining Long-Horizon epic board and define the
next unresolved LH item.

A plausible follow-up observation is RSS/native-memory
characterization, but it is not automatically LH-07 unless the
board says so.
