# LH-06 QUALIFICATION02 — GREEN evidence packet

> **Preserved GREEN evidence from the second production LH-06
> qualification.** QUALIFICATION02 produced
> `PASS_DETERMINISTIC_SOAK` on the qualified subject
> `5d4c9d258446cba1b018ab689433bafe162feefb`. The artifacts
> in this directory are byte-identical copies of the
> production runtime outputs and are the durable evidence
> of LH-06 qualification.

## Identity

| field | value |
| --- | --- |
| schema | `lh06.qualification.evidence-manifest/v1` |
| qualified subject commit | `5d4c9d258446cba1b018ab689433bafe162feefb` |
| worker run_id | `9abce4954edbdb34` |
| supervisor run_id | `f7f4b208772caa8b` |
| profile | `QUALIFICATION` |
| started_at | `2026-09-21T21:08:15.454Z` |
| finished_at | `2026-09-21T22:08:15.472Z` |
| duration_ms | `3,600,018` (~60 min) |
| epochs_completed | `31,531` |
| cases_completed | `977,461` |
| verdict | `PASS_DETERMINISTIC_SOAK` |

## Evidence artifacts

| path | role | SHA-256 | bytes | lines |
| --- | --- | --- | --- | --- |
| `result.json` | structured result (authoritative) | `b55ba6179ef1533b85499c083142604d869549e4fd9b0300b730854a62f6464b` | 3037 | — |
| `result.commit.json` | commit witness (binds run_id, supervisor_run_id, durability) | `0c5f365112e01b92807e016b3250e2b46378007d3318fb2e44bf9c395e6d52fe` | 489 | — |
| `telemetry.jsonl` | 60-min heartbeat telemetry stream | `fb17967cd3c9375a938937db50447c4a8c2002ed3f5374cfaea8245fbc1538dd` | 4,357,011 | 31,531 |
| `qualification.log` | heartbeat log (supporting, not authoritative) | `67cb87ba1267e7afea1b3ed33513e34b782832afd866a2b00c1d8f63ca4a2286` | 2,886,164 | 31,531 |
| `MANIFEST.json` | closed-world evidence manifest | (see file) | — | — |
| `SHA256SUMS` | checksum file (verifies with `shasum -a 256 -c SHA256SUMS`) | — | — | — |

## Result/witness/telemetry binding

* `result.json` SHA-256 = `b55ba617…` is independently
  recomputed by the frozen guard from the on-disk bytes.
* `result.commit.json` records the same `result_sha256`
  field. The guard compares both directions.
* `telemetry.jsonl` SHA-256, byte count, and line count
  agree with `result.telemetry_sha256`,
  `result.telemetry_bytes`, and
  `result.telemetry_line_count`.
* The witness records the **original runtime paths** for
  the result and the telemetry. Those paths are not
  rewritten into the archive. The MANIFEST preserves
  both the original paths and the archive paths.

## Frozen substrate identities (carried in `result.substrate`)

```text
phase_e_head       = 61b0979ebba52e391e1408561fb2c20a79d28af7
lh02_head          = 715e6390d78228f089270259e1bd1307140adb75
lh03_frozen_commit = 7be31164b939f327c557847eb9a8b0c4ffd16b87
lh04_frozen_commit = a8caa82655ca6036bc40a43be5000bdda5bb84bf
lh05_corpus_commit = c898f05ccb1966c5074f6483bad106b3d093b169
repo_commit        = 5d4c9d258446cba1b018ab689433bafe162feefb
substrate_complete = true
```

The freeze invariant `repo_commit == subject_commit` is
re-checked by the frozen guard.

## Semantic zero-drift facts

```text
drift_count                         = 0
fault_escape_count                  = 0
lifecycle_drift_count               = 0
predecessor_dependency_count        = 0
cases_with_multiple_semantic_results = 0
lifecycle_drift_by_scenario         = {}
canary_before_equals_canary_after   = true

SEMANTIC_DRIFT_OBSERVED             = FALSE
FAULT_ESCAPE_OBSERVED               = FALSE
LIFECYCLE_DRIFT_OBSERVED            = FALSE
PREDECESSOR_DEPENDENCY_OBSERVED     = FALSE
MULTIPLE_SEMANTICS_PER_CASE         = FALSE

LC11_DRIFT_OBSERVED                 = FALSE
```

## Resource / lifecycle facts

```text
resource_balance_failures = 0
workspace_leaks           = 0

RESOURCE_BALANCE_FAILURE  = FALSE
WORKSPACE_LEAK            = FALSE
```

## Heap stability (V1 threshold)

```text
post_gc_heap_first_window = 11,285,708
post_gc_heap_last_window  = 12,019,932
post_gc_heap_delta        =    734,224
heap_slope_bytes_per_epoch = 84.62998046523425
heap_verdict.pass         = true
heap_verdict.reason       = STABLE

HEAP_STABILITY = PASS
```

## Latency stability

```text
first_window_median_ms = 117
last_window_median_ms  =  89
drift_ratio            = 0.7606837606837606
verdict                = STABLE

LATENCY_STABILITY = PASS
```

## Frozen-tree integrity

```text
before_sha256 = 9178678c523207db6ad3db683bec3c5611d818e4887831f5dc123fe2daf4c51c
after_sha256  = 9178678c523207db6ad3db683bec3c5611d818e4887831f5dc123fe2daf4c51c
changed       = false
status.ok     = true
status.kind   = VALID

FROZEN_TREE_MUTATION = FALSE
```

## Repeatability

```text
semantic_repeatability = true
```

Scope: repeatability across the qualification execution
according to the frozen LH-06 semantic projection contract.
This does **not** prove process-byte identity, timing
identity, or memory identity.

## Publication durability

```text
result.publication_durability = CRASH_DURABLE
witness.durability           = CRASH_DURABLE
```

## RSS observation (NON-AUTHORITATIVE)

```text
RSS first window: 118,185,984
RSS last window:  197,279,744
RSS delta:        79,093,760
```

Status:

* **OBSERVED**
* **NOT LH-06 V1 PASS/FAIL AUTHORITY**
* `RSS_GROWTH_OBSERVED = TRUE`
* `RSS_IS_LH06_V1_PASS_FAIL_AUTHORITY = FALSE`
* `RSS_GROWTH_FOLLOW_UP = DEFERRED`

Possible interpretations (none established by LH-06 alone):

* allocator retention
* native/runtime memory
* JIT / code pages
* mapped buffers
* fragmentation
* cache growth
* other process-runtime state

LH-06 evidence does not attribute cause.

## QUALIFICATION01 history (preserved separately)

The first LH-06 qualification run,
`7aab74ed17082938` / `423d4674a3883634`, produced a valid
**RED** result (`FAIL_SEMANTIC_DRIFT` /
`LIFECYCLE_DRIFT`) that was rewritten by the supervisor as
`FAIL_WORKER / verifier_rejected:INCOMPLETE_SUBSTRATE`.
That RED packet is preserved separately and is NOT
overwritten by this GREEN packet:

* `labs/long-horizon-harness/qualification/lh06-red-2026-09-21/`
  (in-lab evidence copy)
* `qualification/lh06-red-qualification01/`
  (Factory-root evidence copy with SHA256SUMS)

`GREEN_FREEZE_DOES_NOT_DELETE_RED_HISTORY = TRUE`.

## Authority

This packet is the durable evidence source for
`LH_06 = GREEN_FROZEN`. The original runtime telemetry
path is no longer required after archival:

```text
ORIGINAL_RUNTIME_TELEMETRY_PATH_REQUIRED_FOR_FREEZE = FALSE
```

The bytes in this directory are immutable. Any later
transformation creates a derived artifact with its own
SHA; the raw qualification evidence stays byte-faithful.
