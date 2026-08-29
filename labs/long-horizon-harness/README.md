# Long-Horizon Harness Laboratory

ACT `ACT-FACTORY-LONG-HORIZON-LAB-FOUNDATION01`.

> Establish a strict-TypeScript, candidate-neutral long-horizon harness
> laboratory kernel with explicit algebraic state, total state transitions,
> append-only run evidence, deterministic replay, a scripted fake harness
> adapter, and executable tests proving lifecycle invariants.

This lab establishes **protocol**, not real autonomous coding. No real
candidate (Cline, Qwen Code, Pi, OpenCode, Hermes) is integrated here; the
only harness adapter is a deterministic, scripted fake.

---

## Mission

A long-horizon harness is software that drives an autonomous coding
candidate (LLM-backed tool user) across many attempts, gates, repairs,
and reviews until an external definition of "done" is satisfied. The
laboratory's job is to make such runs:

- **measurable** — every lifecycle event is recorded with its identity
- **recoverable** — the supervisor may be killed and restarted; the
  derived run state can be reconstructed from the evidence on disk
- **comparable** — two runs that produced identical event sequences
  produce identical derived state
- **incapable of declaring themselves successful** — only deterministic
  external gates may authorize `completed`; a candidate's self-report is
  merely an observation that triggers gating

---

## Why this lab exists

Factory evaluates projects by exercising them under realistic feedback
loops. Long-horizon coding is a key target. We need a substrate that
keeps runs honest: even if a candidate claims "done", the lab must
refuse to authoritatively complete the run until a gate has passed.
Conversely, the lab must not get stuck: every asynchronous operation
has a deadline or budget, and runs that exhaust their budget become
the explicit terminal state `exhausted`.

---

## Candidate-neutral architecture

```
candidate harness
        |
        v
  HarnessAdapter           <- candidate-specific translation lives here
        |
        | normalized candidate observations
        v
  future supervisor        <- not yet implemented in FOUNDATION01
        |
        | authoritative RunEvents
        v
  +----> append-only JSONL ledger
  |
  v
  pure transition / replay
        |
        v
  derived RunState
```

Three invariants make this stack honest:

1. **The supervisor state is not the agent's conversation state.** The
   lab owns the lifecycle model. A future candidate adapter cannot
   redefine authoritative run state.
2. **A candidate's "done" never directly produces `completed`.** It
   triggers `gating`. Only an external gate (or a short-circuit
   `review_started` from `running`) advances the run toward
   `completed`, and only `review_passed` actually reaches it.
3. **The derived `RunState` is always reconstructible** from the
   append-only ledger. Recovery from any failure mode is a replay.

---

## Authoritative-completion doctrine (D02)

The only path to `completed` is:

---

## Append-only evidence doctrine (D05)

Persisted run events are immutable. The on-disk format is JSONL: one
JSON envelope per line, with a strict schema:

```jsonc
{
  "schema_version": 1,
  "event_id": "<EventId>",
  "run_id":   "<RunId>",
  "mission_id": "<MissionId>",
  "sequence": 1,                 // strictly monotonically increasing by 1
  "observed_at": 1700000000000,  // observational; never affects replay
  "event": {
    "type": "run_created",       // one of 18 RunEventType values
    "...": "type-specific payload"
  }
}
```

Sequences are validated per-ledger:

| Condition                       | Verdict     |
|---------------------------------|-------------|
| duplicate sequence              | fail closed |
| sequence gap                    | fail closed |
| out-of-order sequence           | fail closed |
| mixed `run_id`                  | fail closed |
| mixed `mission_id`              | fail closed |
| unsupported `schema_version`    | fail closed |
| malformed JSON                  | fail closed |
| structurally invalid event      | fail closed |

---

## Replay model

`replay(runId, missionId, events)` folds the events through the pure
transition reducer, starting from the canonical initial state. Given
the same ordered event sequence, replay always produces the same
derived state. There are no `Date.now`, randomness, environment, or
filesystem reads in the reducer.

---

## TypeScript rules

- `strict`, `noImplicitAny`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitReturns`,
  `noFallthroughCasesInSwitch`, `noImplicitOverride`,
  `useUnknownInCatchVariables` are all on.
- No explicit `any`, `@ts-ignore`, `@ts-nocheck`, `as any`, non-null
  `!`, or `!!` in production source (`src/**`).
- `JSON.parse` is restricted to the evidence trust boundary: the
  envelope decoder and the ledger. Everywhere else, decoded bytes stay
  `unknown` until validated.

---

## Module shape

```
src/
  domain/          # pure lifecycle model: ids, mission, state, events,
                   # failures, budgets, transition, replay, Result
  protocol/        # candidate-neutral HarnessAdapter contract
  evidence/        # codec (decode + encode) and JSONL ledger
  adapters/
    fake/          # scripted FakeAdapter (deterministic, no IO)

---

## Explicitly deferred scope

The following are intentionally **not** implemented in FOUNDATION01:

- real Cline / Qwen Code / Pi / OpenCode / Hermes adapters
- LLM provider configuration (vLLM, SGLang, etc.)
- GPU management
- Docker sandbox
- worktree manager
- real gate executor
- real process watchdog / wall-clock timeout enforcement
- convergence scoring
- multi-agent scheduler
- Kanban / web UI / database / distributed execution
- production deployment
- semantic memory
- automatic git commits by agents

These are recorded for future ACTs (see `Deferred` below).

---

## How to run

Inside `labs/long-horizon-harness/`:

```bash
# Install dependencies (Node 20+)
npm install

# Type-check under strict TypeScript
npm run typecheck

# Run the focused lab test suite (node:test runner via tsx)
npm run test:lab

# Run both typecheck and tests
npm run all

# Mechanical purity gate only
npm run check:domain-purity

# Mechanical trust-boundary gate only
npm run check:trust-boundary
```

---

## Architecture sketch

```
candidate harness
        |
        v
  HarnessAdapter
        |
        | (normalized candidate observations:
        |  candidate_started, candidate_message,
        |  tool_started, tool_finished,
        |  candidate_reported_completion, candidate_error)
        v
  future supervisor    (NOT in FOUNDATION01)
        |
        | (authoritative RunEvents)
        v
  +----> append-only JSONL ledger (events.jsonl)
  |
  v
  pure transition / replay
        |
        v
  derived RunState
```

`derived RunState` can always be reconstructed from authoritative
evidence by replaying the ledger.

## Gate state must carry proof

The `gating` state carries an algebraic `GateProgress` sub-state:

```ts
type GateProgress =
  | { readonly phase: "awaiting_start" }
  | {
      readonly phase: "running";
      readonly gate: string;
      readonly attemptId: AttemptId;
    }
  | {
      readonly phase: "passed";
      readonly gate: string;
      readonly attemptId: AttemptId;
    };
```

The transition table is:

| From                          | Event            | To                          |
|-------------------------------|------------------|------------------------------|
| `gating(awaiting_start)`      | `gating_started` | `gating(running, g, a)`      |
| `gating(running, g, a)`       | `gate_passed`    | `gating(passed, g, a)`       |
| `gating(running, g, a)`       | `gate_failed`    | `repairing`                  |
| `gating(passed, g, a)`        | `review_started` | `reviewing`                  |

`gating_started`, `gate_passed`, and `gate_failed` MUST carry the
matching `attemptId`. `gate_passed` and `gate_failed` MUST additionally
carry a `gate` matching the recorded gate.

The FOUNDATION01 gate model is exactly one abstract deterministic gate
phase. Multiple named gates, gate suites, or external gate executors
are out of scope here; they belong to a later real-gate-executor ACT.

## Identifier trust boundary

Every persisted branded identifier must pass runtime grammar validation.
The codec converts persisted bytes through `parseRunId`, `parseMissionId`,
`parseEventId`, and `parseAttemptId` (in `src/domain/ids.ts`). Each
returns `Result<Brand, InvalidId>`; the evidence layer translates
`InvalidId` into `InvalidEvidence` so the persistence boundary never
`as`-casts an unvalidated string into a branded type.

The single identifier grammar:

```
[A-Za-z0-9_.:-]{1,128}
```

Identifiers may NOT contain whitespace, slashes, control characters,
or quotes. Empty strings and out-of-range lengths are also rejected.

## Ledger durability model

```
open               (file does not yet exist) -> truncate to empty,
                                          fsync, done
open               (file ends with no newline) -> torn-tail recovery
open               (file ends with newline) -> validate normally
append(payload)    read+validate, allocate seq, write complete line
                                          terminated by '\n', fsync, close
read_all           read, validate every newline-terminated line
replay             read_all -> envelopeToRunEvent each -> replay
```

A successful append is acknowledged only after `fsync()` of the appended
bytes has returned. The newline is the commit marker. On recovery:

  - **Case A — file ends with `\n`:** validate every record normally.
    Any malformed newline-terminated record fails closed.
  - **Case B — file contains a non-empty unterminated final suffix:**
    the suffix is treated as an uncommitted torn tail. Recovery
    ordering is **CRITICAL** (CORRECTION02):
    1. (test seam) pre-quarantine fault hook may abort the
       recovery BEFORE any destructive IO. If it does, the
       authoritative file is **byte-identical** to its pre-recovery
       snapshot.
    2. durably preserve the torn bytes via
       `events.jsonl.torn-tail.<sha256>.bin`. The quarantine file
       is `open`-ed, written, `sync`-ed, and closed before return.
       If a file already exists with the content-addressed name,
       its bytes are verified by sha256 + byte compare; a
       hash-named file with the wrong bytes is rejected and the
       authoritative file is left untouched.
    3. attempt to `fsync` the parent directory entry where
       supported. The capability is classified as
       `ok | unsupported | error`; the `error` case fails closed
       and the authoritative file is NOT truncated.
    4. only NOW truncate authoritative ledger to committed prefix
       and `fsync` the repaired file.

Within a single process, concurrent `append()` calls are serialized
through a promise-chain mutex. A failed append does not poison the
queue — subsequent appends continue normally. **CORRECTION02**
proves this with a real injected pre-write failure
(`test/ledger.test.ts` `C13 append remains usable after a real
pre-write failure`) that:
  - allocates no sequence for the failed append,
  - leaves the promise-chain mutex unpoisoned,
  - lets a subsequent append succeed with the next contiguous
    sequence.

Cross-process writers are **unsupported** in CORRECTION02; the lab
uses a single-writer process model.

The ledger API takes the event payload + identity metadata and returns a
`CommittedRunEvent` with the ledger-allocated `seq`. Event producers
do NOT fabricate committed events.

## Test-claim congruence

Every claim in the lab's final reports corresponds to a concrete
mechanically executed test. In particular:

  - "32 concurrent appends produced unique contiguous committed
    sequences" — proven by `C12 concurrent sequence allocation`.
  - "fresh ledger instance reopened the file and replayed the
    resulting legal stream" — proven by `C12-R` (fresh ledger
    construction + reopen + `readAll`) and `C12-L` (legal
    concurrent lifecycle replayed after reopen).
  - "append remains usable after failure" — proven by `C13` using
    a real pre-write injected failure; the failed append
    allocates no sequence and the queue is unpoisoned.
  - "quarantine failure leaves authoritative bytes untouched" —
    proven by `QF01`, which byte-compares the authoritative file
    before and after a failing recovery.
  - "torn-tail bytes preserved exactly" — proven by `QF03`, which
    byte-hashes the quarantine file and asserts it equals the
    torn suffix.
  - "malformed committed evidence fails closed" — proven by
    `TT16` (malformed newline-terminated line).



---

## Currently implemented scope

- Strict-TypeScript domain model with branded identifiers.
- Pure total transition reducer (terminal states reject further events).
- 18 RunEventType variants covering the lifecycle vocabulary.
- 9-variant typed Failure taxonomy that survives persistence.
- Typed BudgetKind union with `wall_clock`, `attempts`, `tool_calls`,
  `model_turns`.
- Versioned JSON envelopes with schema validation at the trust
  boundary.
- Append-only JSONL ledger with real fs IO.
- Deterministic replay producing identical state across reruns.
- ScriptedFakeAdapter implementing the candidate-neutral contract.
- Mechanical purity and trust-boundary gates (no `any`, no node
  imports in the domain).


```
queued
  --run_created--> preparing
preparing
  --preparation_started--> preparing
  --preparation_succeeded--> preparing
  --attempt_started--> running
running
  --agent_reported_completion--> gating     (candidate observation; not authoritative)
running / gating
  --gate_passed--> gating
  --review_started--> reviewing
reviewing
  --review_passed--> completed              (AUTHORITATIVE — only this
                                              event produces `completed`)
```

This is the only canonical path. No shortcut bypasses the gating step.
Specifically rejected:

```
running       --review_started-->  (invalid_transition; I01, C01)
running       --gating_started-->   (invalid_transition; C02)
gating.awaiting_start
              --review_started-->  (invalid_transition; C03)
gating.awaiting_start
              --gate_passed-->      (invalid_transition; C04)
gating.awaiting_start
              --gate_failed-->      (invalid_transition; C04)
gating.running
              --review_started-->   (invalid_transition; C03)
gating.passed
              --gate_passed-->      (invalid_transition; duplicate)
```

`review_passed` is the only event that produces `completed`. Review may
begin only after the abstract deterministic gate has passed.
