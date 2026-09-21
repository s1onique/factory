# LH-06 QUALIFICATION01 — RED evidence packet

> **Preserved RED evidence from the first production LH-06
> qualification.** QUALIFICATION01 produced a valid negative
> result (`FAIL_SEMANTIC_DRIFT` / `LIFECYCLE_DRIFT`) that
> was rewritten by the supervisor as `FAIL_WORKER /
> verifier_rejected:INCOMPLETE_SUBSTRATE`. The evidence
> below is the authoritative experimental record of that
> qualification run. CORRECTION11 treats it as immutable.

## Provenance

| field | value |
| --- | --- |
| repo HEAD | `4193beec7dc0e97001b4741b484e293af00bd316` |
| worker run_id | `7aab74ed17082938` |
| supervisor run_id | `423d4674a3883634` |
| duration | 3,600,042 ms (~60 min) |
| epochs | 38,075 |
| cases | 1,180,325 |
| worker verdict | `FAIL_SEMANTIC_DRIFT` |
| worker failure | `LIFECYCLE_DRIFT` (`last_completed_case = LC01`) |
| supervisor verdict | `FAIL_WORKER` (re-synthesized) |
| supervisor reason | `verifier_rejected:INCOMPLETE_SUBSTRATE` |
| substrate null fields | `phase_e_head`, `lh02_head` |
| frozen-tree digest | `9178678c523207db6ad3db683bec3c5611d818e4887831f5dc123fe2daf4c51c` (VALID) |
| telemetry SHA-256 | `a79c947cf19d20c0c9932a98f05d1339210d4fe580cf08352c4d5e03e8a564b6` |

## Files

| path | description |
| --- | --- |
| `supervisor-terminal.json` | supervisor-generated terminal result (rewrote the worker verdict) |
| `worker-result.json` | worker's actual negative result (`FAIL_SEMANTIC_DRIFT`) |
| `telemetry.jsonl` | durable telemetry stream from the worker |
| `qualification.log` | captured heartbeat log (one heartbeat per epoch) |
| `SHA256SUMS` | `shasum -a 256` of every file in this directory |

## Why this evidence is preserved unchanged

The CORRECTION11 ACT is bounded to:

*   closing the five defects exposed by QUALIFICATION01, and
*   preserving the RED evidence packet as the experimental
    record of those defects.

This packet is the authoritative experiment; the
CORRECTION11 code changes are the response. The bytes in
this directory MUST NOT be modified without a fresh
qualification.

## Substrate null-field analysis

QUALIFICATION01 emitted `phase_e_head = null` and
`lh02_head = null` because the production binding code
tried to read those fields from `capability-matrix.json`,
which is a different record. CORRECTION11 introduces
`qualification/phase-e-frozen.json` and
`qualification/lh02-frozen.json` (in the lab) so each
frozen substrate identity resolves from its own freeze
authority.