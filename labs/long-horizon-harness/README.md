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

## Recovery monotonicity (CORRECTION03)

After the torn bytes have been durably quarantined and the parent
directory entry has been `fsync`'d (where the platform permits),
recovery is **monotonic**:

```text
P || T   (committed prefix || torn suffix on disk)
↓
quarantine(T) durably into events.jsonl.torn-tail.<sha256>.bin
↓
FileHandle.truncate(len(P)) + fh.sync() + fh.close()
↓
P   (committed prefix, byte-identical to the original)
```

The committed prefix is NEVER re-read or re-written. Recovery removes
uncertainty (the torn suffix); it never reconstructs already-committed
truth.

The pre-truncate fault seam (`beforeAuthoritativeTruncate`) makes
this property testable: `TR01` proves that an injected failure
immediately before truncation leaves the authoritative ledger
byte-identical to its pre-recovery snapshot.

## Gate purity doctrine

Qualification/check commands are observationally pure with respect
to repository source files. A gate may generate ignored build or test
artifacts, but it must not repair or rewrite the subject it is
qualifying.

```text
npm run all
  = npm run check:eof   (read-only)
  + npm run typecheck   (read-only)
  + npm run test        (read-only)
```

`fix:eof` (and the legacy `normalize-eof` alias) is the explicit
mutating convenience for developers; it is NOT invoked by `npm run
all`. `GP02` proves this with a before/after content-hash snapshot.

## Process supervision (FOUNDATION02)

The supervisor at `src/process/` provides POSIX-first supervised
process execution with:

- Externally enforced deadlines (the supervisor owns the deadline).
- Explicit `cancel()` API that uses the same termination engine as
  deadlines (one escalation path; first terminal trigger wins).
- TERM → grace → KILL → grace escalation against the supervised
  process group (negative-PID `kill(2)`).
- Bounded stdout/stderr capture that records
  `bytesSeen / bytesRetained / truncated` per stream and continues
  to drain pipes even after the retention cap is reached.
- Algebraic `ProcessOutcome` distinguishing `exited | signaled |
  deadline | cancelled | spawn_failed | cleanup_failed`.
- Centralized PGID guards: invalid pgids (0, 1, negative, NaN,
  non-integer) are rejected before the OS call. EPERM on
  `kill(-pgid, ...)` from outside the supervised session falls
  back to signalling the immediate child PID (the supervisor owns
  it; descendants cannot be reached via the group in that case).
- PID-reuse discipline: cleanup happens within the supervised
  lifecycle while ownership is known. No delayed `child.kill()`
  after observed exit.
- POSIX scope: darwin + linux supported. `HARNESS_CAN_SIGNAL`
  probe detects sandbox profiles (e.g. Cline IDE shell on macOS)
  that deny cross-sandbox signal delivery; affected tests are
  classified SKIP rather than FAIL.

Known limitation: a descendant that deliberately escapes its
process group via `setsid(2)` cannot be reached via group
signalling from outside the new session. Full containment requires
a stronger execution boundary (container, cgroup, PID namespace,
job object). Process-group ownership is cleanup ownership for
cooperative / non-escaping descendants; it is not a sandbox.

Tests:

- `test/process/process-group.test.ts` exercises the centralized
  signal/probe helper (PG01..PG04).
- `test/process/supervised-process.test.ts` exercises the full
  lifecycle (P01..P20).
- `test/fixtures/child-fixture.ts` is a deterministic Node fixture
  with modes for exit, sleep, ignore-term, term-handler,
  spawn-child, spawn-grandchild, flood-stdout/stderr, mixed,
  invalid-utf8, crash, and echo-pid. Compiled into `build/` and
  run via `process.execPath`.

Sandbox caveat: the Cline IDE shell on macOS prevents
`process.kill(2)` from reaching children we spawn. Tests that
require real signal delivery are SKIPPED in this environment.
Production supervisor code is unchanged.

## FOUNDATION04 — Durable Execution Witness

A persistent authenticated witness process is the
**portable restart-safe execution authority** for FOUNDATION04.

The witness:

- runs as a separate Node process spawned by the supervisor
- holds the live `ChildProcess` handle and the PGID authority for
  the candidate
- generates a fresh Ed25519 keypair at startup; the private key
  never leaves memory
- persists only the **public key** and a fingerprint to the
  run's `events.jsonl`
- exposes a Unix-domain stream socket requiring signed commands
- rejects PID/PGID-only authority requests at every level

A restarted supervisor authenticates the witness by reading
`witness_ready` from the ledger, verifying a signed `HELLO` over
a client nonce, and sending signed commands (`QUERY`, `PING`,
`CANCEL`, `TERMINATE`).

Doctrine (F04):

- Endpoint location is **not** identity — a socket path is just
  a location; the witness proves its identity cryptographically
- PID is **not** identity — it can be recycled by the kernel
- A cryptographically bound live witness **is** identity plus
  continuity
- Destructive commands are **transactions**: durable intent
  before send, idempotent execution, durable result after reply

See:

- `docs/FOUNDATION04-AUTHORITY-MECHANISMS.md` — the full
  mechanism comparison and security statement
- `src/witness/` — the witness module
- `test/witness/pure.test.ts` — pure protocol/state tests
  (`npm run test:witness`)
- `test/witness/witness-live.test.ts` — live qualification lane
  (`npm run qualify:witness-live`)

## FOUNDATION04 — Phase D — Experiment Subject Contract

ACT `ACT-FACTORY-LONG-HORIZON-LAB-FOUNDATION04-PHASE-D-EXPERIMENT-SUBJECT-CONTRACT01`.

> **What exactly is one experimental subject, and how can we
> prove that two runs compared the intended subjects under
> equivalent immutable inputs?**

Phase D establishes the **immutable experimental subject** —
the contract one run is "about." It does NOT measure
convergence. Convergence evidence arrives in Phase E.

### Doctrine

```text
RUN EVIDENCE MAY REFER TO AN EXPERIMENT SUBJECT.
IT MAY NEVER SILENTLY REDEFINE THAT SUBJECT.
```

A SubjectManifest names everything that defines ONE
experimental subject. It is the closed-world claim:

```text
"If you ran me with these inputs, you were running
 experiment X about subject Y under conditions C."
```

### Required identity dimensions

```text
schema_version       : literal "phase-d.subject.v1"
experiment_id        : ExperimentId
subject_id_hint      : SubjectIdHint (human-readable label)

harness              : { id, version, source_revision }
model                : { provider, model_id, configuration }
prompt               : { prompt_id, content_hash }
task                 : { task_id, fixture_revision }
repository           : { commit, dirty_policy }
budget               : { wall_clock_ms, turns, tool_calls,
                         token_limit? }
capabilities         : { tools, network, filesystem,
                         execution_policy }
repetition           : { repetition_index, seed? }
```

`dirty_policy` is closed-world: `"reject" | "allow-record"`.
`"ignore"` is rejected as a safety default — the subject MUST
be bound to a known repository state.

### SubjectId — canonical content hash

```text
subjectId = "subject:" + sha256(
    "factory:phase-d:subject:id:v1" || "\u0000" ||
    canonicalize(manifest)
)
```

Properties:

- **Deterministic.** Same canonical content → same SubjectId.
- **Key-order independent.** Source-object key insertion order
  does not affect the hash (sorted-key canonicalization).
- **One-field-change sensitive.** Changing any required
  dimension changes the canonical bytes → changes the
  SubjectId.
- **Domain-tag separated.** The v1 tag prevents collision with
  any other Factory content identifier that uses the same
  canonical bytes.

### Decoder (the runtime authority)

```ts
import {
  decodeSubjectManifest,
  freezeSubject,
} from "./src/subject/index.js";

const r = decodeSubjectManifest(input);
if (!r.ok) {
  // r.failure.kind is one of:
  //   "not_an_object"       — input was not a JSON object
  //   "schema_validation"   — unknown key, bad type, bad enum,
  //                           bad SHA, etc. (closed-world)
  //   "configuration_value" — model.configuration is an object
  //                           but contains an unsupported value
  //                           (undefined, NaN, BigInt, Date,
  //                           Map, Set, Promise, true cycle, ...)
  //   "boundary_exception"  — a Proxy trap or throwing getter
  //                           escaped the validator's inner
  //                           defensive boundary (D-M01). The
  //                           decoder's outer try/catch
  //                           caught it; never throws.
  //   "id_construction"     — defense in depth; unreachable
  //                           given the validator
  return;
}

const f = freezeSubject(r.value);
if (!f.ok) {
  // r.failure.kind is "manifest_id_mismatch" — caller
  // supplied a SubjectId that does not match the manifest.
  // This is impossible through the decoder; it guards
  // against hand-rolled DecodedSubject values.
  return;
}

const subject: FrozenSubject = f.value;
```

Unknown top-level keys fail closed. The decoder NEVER throws.

### Mutation doctrine parity

Phase D does NOT define a custom typed mutation error.
Mutation is rejected by JavaScript's runtime freeze
semantics: in strict mode (which all .ts files in this lab
use), writing to a frozen object throws `TypeError`. A
custom error class would add machinery without changing the
experiment invariant. Tests assert `TypeError` directly
(FRZ04–FRZ08, FRZ12–FRZ13).

### Acceptance targets

```text
SUBJECT_SCHEMA_VERSIONING       = PASS
SUBJECT_DECODER_FAIL_CLOSED     = PASS  (DEC02, DEC07, JSON07–09)
UNKNOWN_FIELDS_POLICY           = EXPLICIT (fail-closed)
NESTED_CLOSED_WORLD             = PASS  (CLOSED01–03)
CONFIGURATION_JSON_BOUNDARY     = PASS  (JSON01–06, JSON11–13)
DECODER_BOUNDARY_TOTALITY       = PASS  (D-M01 + D-M04: NEVER
                                            throws; opaque catch)
JSON_PATH_CYCLE_SEMANTICS       = PASS  (D-M02: shared DAG ok,
                                            true back-edge rejected)
INERT_OWNED_JSON_SNAPSHOT       = PASS  (D-M05: SubjectId is a
                                            function of captured
                                            inert storage, not
                                            caller live graph)
OBJECT_SHAPE_CLOSED_WORLD       = PASS  (D-M06: accessors,
                                            symbol keys,
                                            non-enumerable keys
                                            rejected — SNAP01–04)
ARRAY_SHAPE_CLOSED_WORLD        = PASS  (D-M09: extra string
                                            keys, symbol keys,
                                            accessor indices,
                                            non-enumerable
                                            indices all rejected
                                            — SNAP11–14)
PROXY_VIRTUAL_OUT_OF_RANGE      = PASS  (D-M09 MICROFIX04: ownKeys
                                            virtual index reported
                                            before length is
                                            rejected; declared length
                                            captured FIRST
                                            — SNAP19)
ARRAY_KEY_ORDER_INDEPENDENCE    = PASS  (D-M09 MICROFIX04: any
                                            ownKeys ordering of
                                            ["length","0",...]
                                            accepted identically
                                            — SNAP20)
SINGLE_DESCRIPTOR_OBSERVATION   = PASS  (D-M09 MICROFIX04: each
                                            index descriptor is
                                            read EXACTLY once; no
                                            TOCTOU window
                                            — SNAP21)
DESCRIPTOR_DRIFT_ISOLATION      = PASS  (D-M09 MICROFIX04: a second
                                            hypothetical descriptor
                                            call cannot influence
                                            captured identity
                                            — SNAP22)
NO_DIRECT_ARRAY_PROPERTY_READ   = PASS  (D-M09 MICROFIX04: get traps
                                            for "length" and src[i]
                                            are never invoked
                                            — SNAP23)
PROTO_KEY_PRESERVATION          = PASS  (D-M10: __proto__ is an
                                            own data property of
                                            a null-prototype
                                            record; SubjectId
                                            reflects it — SNAP16–18)
CALLER_MUTATION_ISOLATION       = PASS  (D-M07: mutating input
                                            after decode cannot
                                            affect DecodedSubject
                                            — SNAP07, SNAP08,
                                            SNAP10)
TYPE_SURFACE_MATCHES_DECODER    = PASS  (D-M11: configuration is
                                            JsonObject, matching
                                            validateSubjectManifest's
                                            runtime contract)
CANONICAL_HASH_DETERMINISTIC    = PASS
SUBJECT_ID_CONTENT_BOUND        = PASS
REPO_REVISION_BOUND             = PASS
PROMPT_CONTENT_BOUND            = PASS
HARNESS_VERSION_BOUND           = PASS
MODEL_CONFIGURATION_BOUND       = PASS
BUDGET_BOUND                    = PASS
CAPABILITY_SET_BOUND            = PASS
DEEP_IMMUTABILITY               = PASS  (FRZ11–13)
MANIFEST_ID_BINDING             = PASS  (BIND01–02)
DOMAIN_SEPARATION_ORACLE        = PASS  (HASH01–02)
MUTATION_AFTER_CREATION         = REJECTED (TypeError)
PHASE_D_SOURCE_SIZE_DISCIPLINE  = PASS  (LOC01)
REPLAY_SAME_MANIFEST_SAME_ID    = PASS
ONE_FIELD_CHANGE_DIFFERENT_ID   = PASS
```

Phase D does NOT yet carry run evidence, gate transitions,
or convergence metrics. Those arrive in Phase E.

### See

- `src/subject/` — `subject-canonicalize`, `subject-id`,
  `subject-types`, `subject-validate`, `subject-json`,
  `subject-decode`, `subject-frozen`, `index`
- `test/subject/` — unit tests for canonicalization,
  decoder, freeze, JsonValue boundary, and source-size
  discipline (`npm run test:subject`)

## FOUNDATION04 — Phase E — Run / Evidence Contract

ACT `ACT-FACTORY-LONG-HORIZON-LAB-FOUNDATION04-PHASE-E-RUN-EVIDENCE-CONTRACT01`.

Phase E introduces the **candidate-neutral run / evidence
contract** that Phase D's subject manifest binds to but does not
own. The contract is:

- **append-only**: events are immutable once committed; no
  mutation API exists in the in-memory store beyond `append`
  and `readRun` (E9)
- **content-bound**: `run_id = sha256(subject_id|schema_version|repetition)`
  (E2)
- **event-id doctrine (E-C06 settled)**:
  - `EVENT_ID_STABLE`                    — id does not change once assigned
  - `EVENT_ID_UNIQUE`                    — no two events in the same run share an id
  - `SAME_ID_DIFFERENT_CONTENT_FAILS_CLOSED` — store rejects a retry whose canonical
    content differs from the originally committed one
- **replayable**: the projector folds the ordered evidence stream
  into a `RunProjection` deterministically; live == replay
  projection for any stream (E12)
- **closed-world**: every decoder rejects unknown keys at every
  layer (envelope, manifest, event payload, identifier)
- **frozen vocabulary**: 15 `RunEvent` variants; no new variant
  may be added without a schema-version bump
- **totality**: every decoder wraps its boundary in a single
  try/catch that returns a typed failure — never propagates a
  throw, never invokes a getter, never introspects a `caught` value
- **agent non-authority**: the optional `agent_report` is
  OBSERVATION only; the projector MUST NOT promote it to a
  terminal claim (E7)

### Run / Evidence Vocabulary (E5)

15 closed-world event types:

- `RUN_STARTED`, `HARNESS_STARTED`, `HARNESS_STOPPED`
- `ACTION_STARTED`, `ACTION_FINISHED`
- `GATE_STARTED`, `GATE_FINISHED`
- `REPAIR_STARTED`, `REPAIR_FINISHED`
- `REVIEW_STARTED`, `REVIEW_FINISHED`
- `RUN_CANCEL_REQUESTED`, `RUN_TIMEOUT`
- `RUN_FINISHED`, `RUN_ABORTED`

### LifecycleState (E11)

| state            | meaning                                                    |
|------------------|------------------------------------------------------------|
| `INCOMPLETE`     | empty stream — no evidence observed                        |
| `ACTIVE`         | non-empty stream, no terminal event observed               |
| `TERMINAL`       | terminal event observed; `terminal_outcome` is derivable   |
| `INVALID_EVIDENCE`| projector rejection (illegal_event, identity_mismatch, …) |

### TerminalSemantic (E6 + E-C08)

9 closed-world terminal claims form the super-set
`TerminalSemantic` and are what the projector derives as
`RunProjection.terminal_outcome`. Each terminal event type
narrows to a per-event sub-type (E-C08); the decoder rejects
mismatches at the trust boundary.

| Event type          | Allowed terminal-semantic values                          |
|---------------------|-----------------------------------------------------------|
| `RUN_FINISHED`      | `SUCCESS`, `VALID_FAILURE`                                |
| `RUN_TIMEOUT`       | `TIMEOUT`, `BUDGET_EXHAUSTED`                             |
| `RUN_ABORTED`       | `CANCELLED`, `HARNESS_FAILURE`, `MODEL_FAILURE`, `ENVIRONMENT_FAILURE`, `EVIDENCE_FAILURE` |
| `RUN_CANCEL_REQUESTED` | non-terminal — carries `reason?` only; the closed-world key list does NOT admit `semantic` |

The terminal-event/semantic matrix is encoded both at the type
level (per-event sub-types) and at runtime (decoder rejection).

### Contract Matrix — Phase E (E-M01..E-M15 + E-M16..E-M20 corrections)

| ID    | Property                                                          | Status |
|-------|-------------------------------------------------------------------|--------|
| E-M01 | `run_id` content-bound (Phase E computeRunId)                     | PASS   |
| E-M02 | subject binding: envelope `subject_id` must match manifest        | PASS   |
| E-M03 | event schema closed-world (15 variants, no extras)                | PASS   |
| E-M04 | append-only history (no mutation API beyond append + readRun)     | PASS   |
| E-M05 | event identity contract (stable id + same-id-diff-content fails)  | PASS   |
| E-M06 | sequence total order (no gaps, no duplicates, no reorders)        | PASS   |
| E-M07 | owned inert payload (store deep-freezes committed graph)          | PASS   |
| E-M08 | boundary totality (every decoder wraps in try/catch)              | PASS   |
| E-M09 | lifecycle state machine (ACTIVE/TERMINAL/INCOMPLETE/INVALID)      | PASS   |
| E-M10 | agent report non-authoritative (observation only)                 | PASS   |
| E-M11 | terminal uniqueness (one terminal outcome per run)                | PASS   |
| E-M12 | truncation detectable (empty stream → INCOMPLETE)                 | PASS   |
| E-M13 | corruption detectable (sequence / identity / state violations)    | PASS   |
| E-M14 | replay deterministic (same stream → identical projection)         | PASS   |
| E-M15 | live == replay projection (pure projector)                        | PASS   |
| E-M16 | store caller isolation (E-C01) — committed graph is owned/frozen  | PASS   |
| E-M17 | success requires authority (E-C02 + E-C07) — SUCCESS needs LAST passing gate | PASS   |
| E-M18 | cancel request non-terminal (E-C03) — request ≠ closure          | PASS   |
| E-M19 | public decoder inertness (E-C04) — snapshot-first hostile boundary| PASS   |
| E-M20 | idempotent append (E-C05) — same id+content returns same committed| PASS   |
| E-M21 | success authority is final-state (E-C07) — last gate wins        | PASS   |
| E-M22 | terminal semantic coherence (E-C08) — event/semantic matrix enforced | PASS   |
| E-M23 | store capture parity (E-C09) — store uses Phase D snapshotter    | PASS   |
| E-M24 | canonical event content (E-C10) — single deterministic encoder  | PASS   |
| E-M25 | snapshot precedes every semantic observation (E-C12) — raw caller graph is never hashed, decoded, or canonicalized | PASS   |
| E-M26 | store enforces closed-world RunEvent schema (E-C13) — unknown own keys rejected before commit | PASS   |
| E-M27 | closure authority is epoch-bound (E-C14) — ACTION_STARTED and REPAIR_STARTED both advance workEpoch and invalidate prior closure gate | PASS   |
| E-M28 | canonical dependency direction is acyclic (E-C15) — `run-events` and `run-projector` MUST NOT import `run-store` | PASS   |
| E-M29 | Phase-E hostile-append boundary acceptance (E-C16) — `store.append` does not execute Proxy `[[Get]]` or accessor traps; `ownKeys`/`getOwnPropertyDescriptor` traps may fire as bounded structural probes | PASS   |
| E-M33 | ACTION_ERROR invalidates closure authority (E-C21) — `ACTION_FINISHED(ERROR)` advances `workEpoch`; the closure-gate epoch then no longer matches and SUCCESS is rejected | PASS   |
| E-M34 | REVIEW_FAILURE blocks SUCCESS (E-C22) — `REVIEW_FINISHED(pass=false)` records `(reviewVerdictEpoch, reviewVerdictPass)`; SUCCESS is rejected when `reviewVerdictEpoch === workEpoch && reviewVerdictPass === false` | PASS   |
| E-M35 | negative evidence visible in projection (E-C23) — `RunProjection` exposes `last_action_status`, `last_review_pass`, `action_failure_at_epoch`, `review_failure_at_epoch`, `current_epoch_action_failure`, `current_epoch_review_failure` | PASS   |
| E-M36 | authority precedence model frozen (E-C24) — WORK invalidates prior closure authority; GATE PASS / FAIL establish positive / negative authority; ACTION_FINISHED(ERROR) invalidates prior positive authority; REVIEW_FINISHED(FAIL/PASS) block / clear at the current work epoch; SUCCESS requires fresh passing gate at the current work epoch AND no current-epoch negative evidence | PASS   |

The Phase E **first correction** (ACT-FACTORY-LONG-HORIZON-LAB-FOUNDATION04-
PHASE-E-RUN-EVIDENCE-CONTRACT01-CORRECTION01) added E-M16..E-M20.

The Phase E **second correction** (ACT-FACTORY-LONG-HORIZON-LAB-FOUNDATION04-
PHASE-E-RUN-EVIDENCE-CONTRACT01-CORRECTION02) added E-M21..E-M24 and
strengthened E-M17 with the temporal-authority rule.

The Phase E **third correction** (ACT-FACTORY-LONG-HORIZON-LAB-FOUNDATION04-
PHASE-E-RUN-EVIDENCE-CONTRACT01-CORRECTION03) added E-M25..E-M29. CORRECTION03
introduced the **capture-first, reason-second** ordering invariant (E-C12):
the store now snapshots AND closed-world-decodes the raw caller graph BEFORE
any canonicalization, EventIdSource, or idempotency observation. CORRECTION03
also introduced the closure-authority **epoch model** (E-C14): `REPAIR_STARTED`
advances `workEpoch`; SUCCESS requires `closureGateEpoch === workEpoch`.
The Phase-D ↔ Phase-E dependency graph was hardened (E-C15): `canonicalEventBytes`
now lives in `run-serialize.ts` (the neutral pure encoder) and `run-events.ts`
imports it from there rather than from `run-store.ts`.

The Phase E **fourth correction** (ACT-FACTORY-LONG-HORIZON-LAB-FOUNDATION04-
PHASE-E-RUN-EVIDENCE-CONTRACT01-CORRECTION04) tightens E-C14 from V1 to V2:
**`ACTION_STARTED` also advances `workEpoch`**. Rationale: ACTION is the
general harness-work primitive. Until an action is mechanically proven
read-only, activity after a passing qualification must stale that
qualification. The V2 rule gives the precise temporal property:

```text
work → gate PASS → success                OK
work → gate PASS → more work → success    INVALID_EVIDENCE
work → gate PASS → more work → gate PASS → success OK
```

This is established by the new probes RUN70, RUN71, RUN72. RUN68 was also
strengthened to test the **completed** post-gate work case (closed attempt
scope), which the prior open-scope check did not catch.

The Phase E **fifth correction** (ACT-FACTORY-LONG-HORIZON-LAB-FOUNDATION04-
PHASE-E-RUN-EVIDENCE-CONTRACT01-CORRECTION05) closes the final semantic
contradiction:

```text
EXPLICIT_NEGATIVE_EVIDENCE
MUST_NOT
COEXIST_WITH_TERMINAL_SUCCESS
```

CORRECTION05 freezes the authority precedence model and binds every kind of
explicit negative evidence (action error, failing review) to the same
work-epoch model that CORRECTION04 already uses for WORK itself. The model
is now:

```text
WORK                            invalidates prior closure authority
GATE PASS                       establishes positive authority at current epoch
GATE FAIL                       establishes negative authority at current epoch
ACTION_FINISHED(ERROR)          invalidates prior positive authority
REVIEW_FINISHED(FAIL)           blocks SUCCESS at the current epoch
REVIEW_FINISHED(PASS)           clears the failing-review block at the current epoch
SUCCESS                         requires:
                                  - harness started/stopped
                                  - at least one completed action
                                  - fresh passing gate at current epoch
                                  - no open scopes
                                  - no current-epoch action failure
                                  - no current-epoch failing review
```

The required negative invariant (E-C24):

```text
SUCCESS_WITH_UNRESOLVED_NEGATIVE_EVIDENCE = IMPOSSIBLE
```

**E-C21** — `applyActionFinished` now advances `workEpoch += 1` when
`status === "ERROR"`. The simplest V1/V3 model: the closure-gate epoch
then no longer matches and the success predicate rejects the SUCCESS
claim. (An equivalent alternative model — a dedicated failure epoch —
yields the same externally observable semantics; this implementation
chooses the simpler shared-epoch model.)

**E-C22** — `applyReviewFinished` captures
`(reviewVerdictEpoch, reviewVerdictPass)` at review close. The success
predicate rejects SUCCESS whenever the current work epoch carries a
failing verdict. A later review at the same epoch with `pass=true`
supersedes the failing verdict; a later `ACTION_STARTED` /
`REPAIR_STARTED` advances `workEpoch` and makes the prior verdict
historical.

**E-C23** — `RunProjection` now exposes six diagnostic fields so the
negative evidence is visible directly without forcing operators to
re-derive it from raw stream archaeology:

```text
last_action_status            : "OK" | "ERROR" | null
last_review_pass              : boolean | null
action_failure_at_epoch       : number | null
review_failure_at_epoch       : number | null
current_epoch_action_failure  : boolean
current_epoch_review_failure  : boolean
```

The projector remains the single authority.

Probes RUN73–RUN77 establish the new invariants:

```text
RUN73  gate PASS → ACTION_FINISHED(ERROR) → SUCCESS                 → INVALID_EVIDENCE
RUN74  gate PASS → ACTION ERROR → new work → new gate PASS → SUCCESS → TERMINAL/SUCCESS
RUN75  gate PASS → REVIEW FAIL → SUCCESS                            → INVALID_EVIDENCE
RUN76  gate PASS → REVIEW FAIL → REVIEW PASS → SUCCESS              → TERMINAL/SUCCESS
RUN77  gate PASS → REVIEW FAIL → REPAIR → new gate PASS → SUCCESS   → TERMINAL/SUCCESS
```

### Invariant Probes

```text
CALLER_MUTATION_AFTER_APPEND_CANNOT_CHANGE_EVIDENCE = PASS  (RUN26, RUN27, RUN28, RUN29)
READ_API_CANNOT_MUTATE_LEDGER                        = PASS  (RUN28)
UNSUPPORTED_SUCCESS_CLAIM                           = IMPOSSIBLE  (RUN30, RUN31, RUN32)
SUCCESS_WITH_AUTHORITY                              = POSSIBLE    (RUN33)
CANCEL_REQUEST_EQUALS_TERMINAL                       = FALSE       (RUN34)
CANCEL_REQUEST_LEGAL_BEFORE_TERMINAL                 = PASS        (RUN35, RUN36)
HOSTILE_PUBLIC_DECODER_GETTER_EXECUTION              = IMPOSSIBLE  (RUN37, RUN38, RUN39, RUN40)
IDENTICAL_RETRY_CREATES_SECOND_EVENT                 = FALSE       (RUN41)
SAME_ID_DIFFERENT_CONTENT                           = FAIL_CLOSED (RUN42)

# CORRECTION02 — E-C07 .. E-C11
EARLIER_PASS_LATER_FAIL_CANNOT_SUCCESS               = PASS        (RUN43)
FAIL_THEN_PASS_REINSTATES_AUTHORITY                  = PASS        (RUN44)
OPEN_REPAIR_AT_TERMINAL_IS_UNAUTHORIZED              = PASS        (RUN45)
RUN_TIMEOUT_SUCCESS                                  = IMPOSSIBLE  (RUN46)
RUN_ABORTED_SUCCESS                                  = IMPOSSIBLE  (RUN47)
RUN_FINISHED_TIMEOUT                                 = IMPOSSIBLE  (RUN48)
ALLOWED_EVENT_SEMANTIC_PAIRS                         = ROUND_TRIP  (RUN49)
CANCEL_REQUEST_CLAIMS_TERMINAL_SEMANTIC              = IMPOSSIBLE  (RUN50)
PROTO_KEY_CAPTURE_DRIFT                              = IMPOSSIBLE  (RUN51, RUN52)
GETTER_EXECUTION_ON_HOSTILE_INPUT                    = IMPOSSIBLE  (RUN53)
PROXY_TRAP_EXECUTION_BEFORE_REJECTION                = IMPOSSIBLE  (RUN54)
SYMBOL_OR_NON_ENUMERABLE_OWN_KEY                     = IMPOSSIBLE  (RUN55)
NESTED_KEY_INSERTION_ORDER_IS_CANONICAL              = PASS        (RUN56)
STORE_PROJECTOR_CANONICAL_AGREEMENT                  = PASS        (RUN57)
DEFAULT_EVENTID_SOURCE_USES_SINGLE_AUTHORITY         = PASS        (RUN58)

# CORRECTION03 — E-C12 .. E-C16
STORE_APPEND_ACCESSOR_PAYLOAD_BEFORE_SNAPSHOT        = IMPOSSIBLE  (RUN59)
STORE_APPEND_PROXY_PAYLOAD_GET_TRAP_FIRED            = IMPOSSIBLE  (RUN60)
BIGINT_PAYLOAD_BEFORE_CANONICALIZATION               = REJECTED    (RUN61)
ACTION_STARTED_EXTRA_PROTO_KEY_REJECTED              = PASS        (RUN62)
RUN_STARTED_EXTRA_STRING_KEY_REJECTED                = PASS        (RUN63)
SYMBOL_OR_NON_ENUMERABLE_OR_ACCESSOR_REJECTED        = PASS        (RUN64)
NESTED_PROTO_DATA_PRESERVED_BY_SNAPSHOTTER           = PASS        (RUN65)
PRE_REPAIR_GATE_AUTHORIZES_POST_REPAIR_SUCCESS       = IMPOSSIBLE  (RUN66)
POST_REPAIR_GATE_AUTHORIZES_POST_REPAIR_SUCCESS      = POSSIBLE    (RUN67)
SUBSEQUENT_ACTION_WITHOUT_REPAIR_DOES_NOT_INVALIDATE = IMPOSSIBLE  (RUN68, completed post-gate work; open scope still caught)
POST_GATE_COMPLETED_WORK_WITHOUT_REGATE_CANNOT_SUCCESS = IMPOSSIBLE (RUN70)
POST_GATE_COMPLETED_WORK_WITH_REGATE_CAN_SUCCESS      = POSSIBLE    (RUN71)
MULTIPLE_ACTION_CYCLES_SINGLE_FINAL_PASS              = POSSIBLE    (RUN72)
FAIL_THEN_REPAIR_THEN_PASS_SUCCESS                   = POSSIBLE    (RUN69)

# CORRECTION05 — E-C21 .. E-C24
GATE_PASS_THEN_ACTION_ERROR_SUCCESS                  = IMPOSSIBLE  (RUN73)
ACTION_ERROR_THEN_NEW_WORK_THEN_NEW_PASS_SUCCESS     = POSSIBLE    (RUN74)
GATE_PASS_THEN_REVIEW_FAIL_SUCCESS                   = IMPOSSIBLE  (RUN75)
RESOLVED_REVIEW_FAILURE_CAN_RECOVER                  = POSSIBLE    (RUN76)
REPAIRED_REVIEW_FAILURE_CAN_REQUALIFY                = POSSIBLE    (RUN77)
SUCCESS_WITH_UNRESOLVED_NEGATIVE_EVIDENCE            = IMPOSSIBLE  (RUN73, RUN75; E-C24 negative invariant)
NEGATIVE_EVIDENCE_VISIBLE_IN_PROJECTION              = PASS        (RUN73, RUN75; E-C23 diagnostic fields)
ACTION_FINISHED_ERROR_ADVANCES_WORK_EPOCH            = PASS        (RUN73 vs RUN70/RUN71)
REVIEW_FINISHED_FAIL_AT_CURRENT_EPOCH_BLOCKS_SUCCESS = PASS        (RUN75 vs RUN76)
REVIEW_VERDICT_SUPERSESSION_BY_LATER_PASS            = PASS        (RUN76)
REVIEW_VERDICT_HISTORICALIZATION_BY_LATER_WORK       = PASS        (RUN77)
RUN_EVENTS_DEPENDS_ON_RUN_STORE                      = FALSE       (RUN_GRAPH)
RUN_PROJECTOR_DEPENDS_ON_RUN_STORE                   = FALSE       (RUN_GRAPH)
HOSTILE_INPUT_REACHES_CANONICAL_ENCODER              = IMPOSSIBLE  (RUN16_E_PHASE_E)
```

### Adversarial Corpus — RUN01..RUN77

The acceptance corpus lives in `test/run/`:

- `run-evidence-contract-projector.test.ts` (RUN01–RUN15,
  RUN21, RUN22, RUN25) — projector + store
- `run-evidence-contract-decode.test.ts` (RUN16–RUN20, RUN23,
  RUN24, RUN25b–RUN25e) — envelope / manifest decoders +
  boundary
- `run-evidence-contract-correction.test.ts` (RUN26–RUN42) —
  Phase E first correction (E-C01..E-C06)
- `run-evidence-contract-correction-02.test.ts` (RUN43–RUN58) —
  Phase E second correction (E-C07..E-C11). RUN51/52/53/54/55
  were REWRITTEN in CORRECTION03 to drive hostile inputs
  through `store.append()` rather than the Phase-D primitive.
- `run-evidence-contract-correction-03.test.ts` (RUN59–RUN77,
  RUN_GRAPH, RUN16_E_PHASE_E) — Phase E third + fourth + fifth
  corrections (E-C12..E-C16 + V2 epoch rule for E-C14 + E-C21..
  E-C24 authority precedence with negative evidence).

Run with:

```text
node --import tsx --test --test-reporter=spec test/run/*.test.ts
```

### Phase E Module Layout

```text
src/run/
  run-types.ts                  branded IDs, manifest, envelope, projection, key constants
  run-event-types.ts            RunEvent vocabulary + per-event semantic sub-types (E-C08)
  run-json.ts                   re-export of Phase D snapshotter
  run-decode.ts                 shared decode helpers
  run-decode-manifest.ts        decodeRunManifest (snapshot-first hostile boundary)
  run-decode-envelope.ts        decodeRunEventEnvelope (snapshot-first hostile boundary)
  run-decode-payload.ts         public decodeRunEventPayload + internal decodeOwnedRunEventPayload
  run-decode-payload-cases.ts   8 non-terminal decoders
  run-decode-payload-helpers.ts 4 terminal decoders enforcing E-C08 sub-types
  run-events.ts                 LegalityTracker (with E-C14 epoch fields + E-C21/E-C22 negative-evidence fields) + applyLegality
  run-events-helpers.ts         per-event legality appliers + applyTerminal; ACTION_FINISHED(ERROR) and REVIEW_FINISHED capture authority precedence (E-C21 + E-C22)
  run-projector.ts              pure projector + epoch-bound successEvidencePredicateSatisfied (E-C02 + E-C07 + E-C14 + E-C21 + E-C22 + E-C23 diagnostic fields)
  run-serialize.ts              deterministicJson + canonicalEventBytes (SINGLE canonical authority, E-C10 + E-C15)
  run-serialize-payload.ts      per-event encoder
  run-store.ts                  InMemoryRunStore (snapshot+decode BEFORE every semantic observation, E-C12 + E-C13)
  index.ts                      public barrel
```

### See

- `src/run/` — full Phase E implementation
- `test/run/` — adversarial corpus `run-evidence-contract-*.test.ts`

---

## Phase F — LH-02 — Convergence Metric Contract

ACT `ACT-FACTORY-LONG-HORIZON-LAB-CONVERGENCE-METRIC-CONTRACT01`
(`LH-02`). Defines a deterministic, candidate-neutral metric
contract for measuring how a harness/model run converges
toward trustworthy terminal closure.

Metrics are **pure derived values** over the Phase E
evidence substrate. LH-02 does NOT alter run legality,
terminal outcome, closure authority, event interpretation,
or subject identity.

```text
MetricReport =
    f(
      immutable Subject,
      immutable RunManifest,
      ordered Phase-E RunEvents,
      versioned MetricContract
    )
```

No harness self-report participates as metric authority
unless Phase E already captured it as an observation.

### Contract identity (M1)

LH-02 ships exactly one V1 contract identity:

```text
CONVERGENCE_METRIC_CONTRACT_V1 =
  "convergence.metric.contract.v1"
METRIC_REPORT_SCHEMA_VERSION =
  "metric.report.schema.v1"
```

Changing metric semantics requires a new contract version.
Silently re-interpreting historical runs under a changed
formula while preserving the same version is forbidden.

### Module layout

```text
src/metrics/
  metric-types.ts                closed-world types: Counters, ConvergenceDistances,
                                 CorrectionBurden, TimeMetrics, ResourceMetrics,
                                 FailureObservations, ConvergenceFacts,
                                 SuccessNormalized, SurvivingDefectSurface,
                                 ReportProvenance, MetricReport; MetricValue
                                 Available/Unavailable algebra; UnavailabilityReason
                                 closed-world set (NOT_OBSERVED, NOT_APPLICABLE,
                                 INCOMPLETE_RUN, INVALID_EVIDENCE,
                                 UNSUPPORTED_BY_CONTRACT, INVALID_DURATION,
                                 MISSING_TIMESTAMPS)
  metric-contract.ts             contract version guard (refuses unknown versions)
  metric-authority.ts            walkAuthority (M-C09 — single pure authority
                                 walk: closure-authority channel + orthogonal
                                 review-blocker channel, M-C08; CORRECTION03
                                 M-C10 work-epoch tracking; M-C11 epoch
                                 advance historicalises the blocker;
                                 M-C12 activation counted as blocker
                                 TRANSITION `not_blocked -> blocked`);
                                 + assertAuthorityEndStateMatchesProjection
                                 (M-C13: end-state parity oracle against
                                 Phase E)
  metric-counters.ts             deriveCounters (single-pass counters, M4)
                                 + deriveAuthorityChannels / deriveAuthorityInvalidation
                                 (CORRECTION01: historical_authority_invalidation_count;
                                 CORRECTION02: historical_review_blocker_activation_count
                                 is the orthogonal review-channel TRANSITION counter,
                                 CORRECTION03 M-C12)
  metric-distances.ts            deriveConvergenceDistances + deriveCorrectionBurden
                                 (M5, M6; CORRECTION01 M-C03 distance units:
                                 actions_to_* use ACTION_STARTED; work_epochs_to_*
                                 use Phase E work epoch; M-C04 authoritative-pass
                                 anchor: gate that authorized terminal SUCCESS;
                                 CORRECTION02 M-C09: authoritative-pass walker
                                 delegates to walkAuthority so the metric has ONE
                                 interpretation of the Phase E precedence model;
                                 CORRECTION03 M-C10..M-C11: authority walk now
                                 tracks work epoch and historicalises the review
                                 blocker on every epoch advance)
  metric-time.ts                 deriveTimeMetrics (M8 deterministic durations;
                                 no clamping; no silent zero)
  metric-resources.ts            deriveResourceMetrics (M9/M10/M11; lifts
                                 RUN_TIMEOUT.observation only; never infers)
  metric-shape.ts                deriveConvergenceFacts + deriveFailureObservations
                                 + deriveSuccessNormalized (M13, M14, M15)
  metric-surviving-defect.ts     deriveSurvivingDefectSurface (M7; surviving
                                 defect count deliberately unavailable)
  metric-hash.ts                 deriveRunEvidenceHash (sha-256 over Phase E
                                 canonical event bytes)
  metric-projector.ts            computeRunMetrics (the single canonical entry
                                 point; identity-bound to subject; the Phase E
                                 projection is INTERNALLY derived from
                                 orderedEvents — callers cannot supply a separate
                                 projection, M-C01; CORRECTION03 M-C13 —
                                 assertAuthorityEndStateMatchesProjection is
                                 called on every report; any authority-algebra
                                 drift between walkAuthority and Phase E
                                 surfaces as a typed rejection); verifyProjectionBind
                                 (CORRECTION02 M-C07: STRUCTURAL-value binding
                                 via node:util.isDeepStrictEqual — NOT reference
                                 identity)
  metric-serialize.ts            serializeMetricReport (reuses Phase E
                                 deterministicJson)
  index.ts                       public barrel
```

### Authoritative commands

```text
# Run LH-02 metrics suite only
node --import tsx --test --test-reporter=spec \
   test/metrics/metric-contract.test.ts \
   test/metrics/metric-golden.test.ts \
   test/metrics/metric-properties.test.ts \
   test/metrics/metric-time.test.ts \
   test/metrics/metric-resources.test.ts
```

### Contract Matrix — Phase F (M-M01..M-M16)

| ID    | Property                                                          | Status |
|-------|-------------------------------------------------------------------|--------|
| M-M01 | metric contract versioned (M1) — single V1 identity; unknown versions refused; `metric_report_schema_version` recorded in every report | PASS |
| M-M02 | pure metric projection (M2) — same inputs + same contract = structurally equal report; no `Date.now()`, no `Math.random()`, no ambient state, no fs/net/pricing reads | PASS |
| M-M03 | Phase E outcome imported (M3) — `convergence.terminal_outcome === projection.terminal_outcome`; metric never recomputes / overrides the projector | PASS |
| M-M04 | structural counters (M4) — action / gate / repair / review counters derived from ordered events only; `counters.work_epoch_count` lifted from the projector | PASS |
| M-M05 | correction burden (M6, CORRECTION01) — exposes `repair_cycle_count`, `failed_action_count`, `failing_gate_count`, `failing_review_count`, `historical_authority_invalidation_count` (historical; survives recovery), `current_authority_blocker_count` (current-state diagnostic, 0/1/2) | PASS |
| M-M06 | time metrics evidence-bound (M8) — only `observed_at`; missing -> `MISSING_TIMESTAMPS`; non-monotonic -> `INVALID_DURATION`; NEVER clamps | PASS |
| M-M07 | resource metrics evidence-bound (M9/M10/M11) — every resource slot is `Available(value)` or `Unavailable(reason)`; NEVER inferred from action/gate counts | PASS |
| M-M08 | missing evidence != zero (M16) — every metric value is one of `{available:true,value}` or `{available:false,reason}`; no silent zero substitution | PASS |
| M-M09 | pricing separated (M12) — `RESOURCE_METRICS` exposes `total_tokens` and `tool_calls_total` only; no CostReport; `MEASURED_CONSUMPTION != PRICING` | PASS |
| M-M10 | failure causality not inferred (M14) — exposes `observed_failure`; `attributed_cause` is `unavailable("UNSUPPORTED_BY_CONTRACT")` in V1 | PASS |
| M-M11 | report evidence-bound (M17) — every report binds `metric_contract_version`, `metric_report_schema_version`, `run_id`, `subject_id`, `terminal_outcome`, `last_sequence`, `event_count`, `run_evidence_hash` | PASS |
| M-M12 | report owned inert (M18) — `metric-projector.ts` reuses Phase E type-aware derivation; no caller-owned references; no parallel cloning | PASS |
| M-M13 | canonical serialization (M19) — `serializeMetricReport` reuses Phase E `deterministicJson`; same semantic report -> same bytes | PASS |
| M-M14 | replay deterministic (M2 oracle) — replaying the same evidence produces byte-equal MetricReports | PASS |
| M-M15 | golden hand calculations (M21) — `metric-golden.test.ts` pins 6+ counter vectors by hand against hand-rolled synthetic streams | PASS |
| M-M16 | metric authority non-interference (M23) — metric cannot authorize SUCCESS; untrusted contract versions / identity mismatches return `{ok:false,reason}` rather than a corrupted report | PASS |

### Acceptance evidence (against committed HEAD)

| Suite                              | Count | Status |
|------------------------------------|-------|--------|
| `test/metrics/metric-contract.test.ts`    |  9/9  | PASS |
| `test/metrics/metric-golden.test.ts`      | 24/24 | PASS |
| `test/metrics/metric-properties.test.ts`  | 17/17 | PASS |
| `test/metrics/metric-time.test.ts`        |  5/5  | PASS |
| `test/metrics/metric-resources.test.ts`   |  6/6  | PASS |
| **LH-02 metrics suite total**             | **61/61** | **PASS** |
| Phase E `test/run/*.test.ts` (frozen)     | 86/86 | PASS   |
| Phase D `test:subject`                    |102/102| PASS   |
| Phase C witness `pure` / `codec`           | 17/17 | PASS   |
| Phase B/C `test:witness-start`             | 47/47 (1 skipped) | PASS |
| `npm run check:eof`                        | 15/15 | PASS   |
| `npm run check:domain-purity`              |  3/3  | PASS   |
| `npm run check:trust-boundary`             |  2/2  | PASS   |
| `npm run typecheck`                        | clean | PASS   |
| `npm run build`                            | clean | PASS   |
| `scripts/verify_factory.sh`                | OK    | PASS   |
| `scripts/verify_worktree_policy.sh`        | OK    | PASS   |
| `tests/worktree_policy/test_worktree_policy.sh` | 9/9 | PASS |
| `git diff HEAD --check`                    | clean | PASS   |
| `git worktree list --porcelain`            | 1 main / 0 linked / 0 detached | OK |

### CORRECTION01 closure matrix

The CORRECTION01 patch closes the three measurement-validity
defects identified in the LH-02 review. Each cell is pinned
by a named probe.

```text
M-M17_PROJECTION_EVIDENCE_IDENTITY          PASS  (METRIC24..METRIC27)
M-M18_HISTORICAL_AUTHORITY_INVALIDATIONS    PASS  (METRIC28..METRIC32)
M-M19_DISTANCE_UNITS_HONEST                 PASS  (METRIC01, METRIC04, METRIC06)
M-M20_AUTHORITATIVE_PASS_SEMANTICS          PASS  (METRIC33..METRIC35)
M-M21_EVIDENCE_HASH_SEMANTICS_FROZEN        PASS  (METRIC20, METRIC27)
M-M22_CANONICALIZATION_METAMORPHIC_ORACLE   PASS  (METRIC19)

REPORT_PROJECTION_EVIDENCE_SPLIT_BRAIN       IMPOSSIBLE  (M-C01)
RECOVERED_INVALIDATION_DISAPPEARS_FROM_BURDEN = IMPOSSIBLE  (M-C02)
EVENT_POSITION_REPORTED_AS_WORK_EPOCH        IMPOSSIBLE  (M-C03)
HISTORICAL_PASS_REPORTED_AS_AUTHORITATIVE    IMPOSSIBLE  (M-C04)
```

### CORRECTION02 closure matrix

The CORRECTION02 patch closes the two residual defects
identified in the LH-02 review of CORRECTION01: (1) the
`verifyProjectionBind` helper previously compared
JavaScript object identity rather than structural
projection equality, and (2) the metric had been
conflating "closure-authority was invalidated" with
"a per-epoch SUCCESS blocker was raised" — these are
two orthogonal authority channels under frozen Phase E
E-C24. The metric module now has (a) a single pure
authority walk that both `metric-counters.ts` and
`metric-distances.ts` consume, and (b) `verifyProjectionBind`
that uses `node:util.isDeepStrictEqual`. No Phase-E
changes, no harness adapters, no composite score.

```text
M-M23_PROJECTION_VALUE_BINDING              PASS  (METRIC26, METRIC36..METRIC39)
M-M24_AUTHORITY_CHANNELS_ORTHOGONAL         PASS  (METRIC05, METRIC31, METRIC40..METRIC43)
M-M25_SINGLE_METRIC_AUTHORITY_ALGEBRA       PASS  (METRIC34, METRIC35, METRIC40..METRIC43)

REFERENCE_IDENTITY_USED_AS_VALUE_EQUALITY    IMPOSSIBLE  (M-C07)
STALE_PROJECTION_ACCEPTED                    IMPOSSIBLE  (M-C07)
REVIEW_BLOCKER_EQUALS_CLOSURE_AUTHORITY_INVALIDATION = FALSE  (M-C08)
CLOSURE_AUTHORITY_AND_SUCCESS_BLOCKERS_ARE_ORTHOGONAL = TRUE   (M-C08)
METRIC_AUTHORITY_ALGEBRA_HAS_TWO_DIVERGENT_IMPLEMENTATIONS = FALSE  (M-C09)
```

Negative-oracle invariants added by CORRECTION02:

```text
STRUCTURALLY_EQUAL_PROJECTION_REJECTED_DUE_TO_REFERENCE_IDENTITY = IMPOSSIBLE  (M-C07)
STALE_PROJECTION_ACCEPTED                                           = IMPOSSIBLE  (M-C07)
REVIEW_FAILURE_STALES_CLOSURE_GATE                                  = FALSE       (M-C08)
METRIC_AUTHORITY_ALGEBRA_HAS_TWO_IMPLEMENTATIONS                    = FALSE       (M-C09)
```

### CORRECTION03 closure matrix

The CORRECTION03 patch tightens the canonical
`walkAuthority()` to reproduce frozen Phase-E epoch
semantics for the review-blocker channel and to make the
`historical_review_blocker_activation_count` a true
state-machine TRANSITION count (rather than a raw
failing-review count). It also adds a hard end-state
parity oracle that the metric projector enforces for
every report it computes: any future authority-algebra
drift now surfaces as a typed rejection.

```text
M-M26_REVIEW_BLOCKER_EPOCH_SCOPED          PASS  (METRIC44..METRIC47)
M-M27_REVIEW_ACTIVATION_MEASURAND_HONEST  PASS  (METRIC48..METRIC50)
M-M28_METRIC_PHASE_E_AUTHORITY_PARITY      PASS  (METRIC51, every-report reject)

HISTORICAL_REVIEW_FAILURE_BLOCKS_NEW_EPOCH              = FALSE       (M-C11)
REPEATED_FAIL_ALREADY_BLOCKED_COUNTS_ACTIVATION         = FALSE       (M-C12)
METRIC_AUTHORITY_END_STATE_DIFFERS_FROM_PHASE_E         = IMPOSSIBLE  (M-C13)
```

Negative-oracle invariants added by CORRECTION03:

```text
REVIEW_BLOCKER_PERSISTS_PAST_WORK_EPOCH_ADVANCE         = IMPOSSIBLE  (M-C11)
ACTIVATION_DOUBLE_COUNTED_FOR_REPEATED_FAIL_SAME_EPOCH  = IMPOSSIBLE  (M-C12)
METRIC_AUTHORITY_WALK_DIFFERS_FROM_PHASE_E_AUTHORITY    = IMPOSSIBLE  (M-C13)
```

### LH-02 Negative Oracles

```text
METRIC_CODE_CAN_CHANGE_TERMINAL_OUTCOME        = FALSE  (M3, M16, M23)
METRIC_CODE_CAN_AUTHORIZE_SUCCESS             = FALSE  (M3, M16, M23)
METRIC_CODE_CAN_INFER_TOOL_CALLS_FROM_ACTIONS = FALSE  (M9)
METRIC_CODE_CAN_INFER_TOKEN_PROVENANCE        = FALSE  (M10)
METRIC_CODE_CAN_CLAMP_NON_MONOTONIC_DURATION  = FALSE  (M8)
METRIC_CODE_CAN_REPLACE_MISSING_WITH_ZERO    = FALSE  (M16)
METRIC_CODE_CAN_FABRICATE_SURVIVING_DEFECTS  = FALSE  (M7)
METRIC_CODE_CAN_APPLY_DIFFERENT_FORMULA_AT_SAME_VERSION = FALSE (M1)
SILENT_REINTERPRETATION_UNDER_SAME_VERSION   = IMPOSSIBLE (M1)
PRICE_TABLE_COUPLED_TO_DETERMINISTIC_METRIC  = FALSE  (M12)

# CORRECTION01 binding / measurand oracles:
REPORT_PROJECTION_EVIDENCE_SPLIT_BRAIN        = IMPOSSIBLE  (M-C01)
RECOVERED_INVALIDATION_DISAPPEARS_FROM_BURDEN = IMPOSSIBLE  (M-C02)
EVENT_POSITION_REPORTED_AS_WORK_EPOCH         = IMPOSSIBLE  (M-C03)
HISTORICAL_PASS_REPORTED_AS_AUTHORITATIVE     = IMPOSSIBLE  (M-C04)

# CORRECTION02 value-binding / orthogonal-channel oracles:
REFERENCE_IDENTITY_USED_AS_VALUE_EQUALITY     = IMPOSSIBLE  (M-C07)
STALE_PROJECTION_ACCEPTED                     = IMPOSSIBLE  (M-C07)
REVIEW_BLOCKER_EQUALS_CLOSURE_AUTHORITY_INVALIDATION = FALSE  (M-C08)
CLOSURE_AUTHORITY_AND_SUCCESS_BLOCKERS_ARE_ORTHOGONAL = TRUE   (M-C08)
METRIC_AUTHORITY_ALGEBRA_HAS_TWO_DIVERGENT_IMPLEMENTATIONS = FALSE  (M-C09)

# CORRECTION03 review-blocker epoch scoping / activation measurand:
HISTORICAL_REVIEW_FAILURE_BLOCKS_NEW_EPOCH              = FALSE       (M-C11)
REPEATED_FAIL_ALREADY_BLOCKED_COUNTS_ACTIVATION         = FALSE       (M-C12)
METRIC_AUTHORITY_END_STATE_DIFFERS_FROM_PHASE_E         = IMPOSSIBLE  (M-C13)
REVIEW_BLOCKER_PERSISTS_PAST_WORK_EPOCH_ADVANCE         = IMPOSSIBLE  (M-C11)
ACTIVATION_DOUBLE_COUNTED_FOR_REPEATED_FAIL_SAME_EPOCH  = IMPOSSIBLE  (M-C12)
METRIC_AUTHORITY_WALK_DIFFERS_FROM_PHASE_E_AUTHORITY    = IMPOSSIBLE  (M-C13)
```

### LH-02 EXIT (after CORRECTION01 + CORRECTION02 + CORRECTION03)

```text
CONVERGENCE_METRIC_CONTRACT            = FROZEN
METRICS                                = PURE / VERSIONED / DETERMINISTIC /
                                         EVIDENCE_BOUND / CANDIDATE_NEUTRAL
METRIC_REPORT  ↔  EXACT_RUN_EVIDENCE   = STRUCTURALLY BOUND
METRIC_REPORT  ↔  PROJECTION          = VALUE-BOUND (verifyProjectionBind
                                         uses node:util.isDeepStrictEqual;
                                         no reference-identity shortcut)
METRIC_AUTHORITY_WALK
    ↔  PHASE_E_AUTHORITY_END_STATE     = TRUE  (computeRunMetrics asserts
                                                 parity on every report;
                                                 any drift surfaces as a
                                                 typed rejection, CORRECTION03
                                                 M-C13)
MISSING_EVIDENCE != ZERO               = TRUE
TERMINAL_OUTCOME_AUTHORITY             = PHASE_E_ONLY
SUCCESS_AUTHORITY                      = PHASE_E_ONLY
AUTHORITY_CHANNELS_ORTHOGONAL          = TRUE  (closure-authority channel
                                                vs review-blocker channel)
REVIEW_BLOCKER_EPOCH_SCOPED            = TRUE  (CORRECTION03 M-C11)
ACTIVATION = BLOCKER_TRANSITION         = TRUE  (CORRECTION03 M-C12)
MEASUREMENT_CAN_REPLAY_WITHOUT_HARNESS = YES
MEASUREMENT_CAN_REPORT_WHAT_IT_MEASURES = YES

LH_02                                  = GREEN_FROZEN
READY_FOR_LH_03_REAL_HARNESS_ADAPTER_QUALIFICATION = YES
```

### LH-02 See

- `src/metrics/` — full LH-02 implementation
- `test/metrics/` — adversarial corpus `metric-*.test.ts`

---

## LH-06 — Deterministic Soak / Qualification

> Phase F continues with the deterministic 60-minute soak
> qualification and its frozen evidence record.

### LH-06 board

```text
LH-06  deterministic soak / qualification
       🟢 GREEN_FROZEN
       QUALIFICATION02 PASS
       60m / 31,531 epochs / 977,461 cases
       semantic drift = 0
       lifecycle drift = 0
       resource balance failures = 0
       workspace leaks = 0
       heap = STABLE
       latency = STABLE
       frozen mutation = false
       durable result+witness+telemetry bound

QUALIFICATION01 = RED / preserved
  (worker FAIL_SEMANTIC_DRIFT / LIFECYCLE_DRIFT
   supervisor FAIL_WORKER / verifier_rejected:INCOMPLETE_SUBSTRATE
   run_id 7aab74ed17082938 / supervisor 423d4674a3883634)

QUALIFIED_SUBJECT  = 5d4c9d258446cba1b018ab689433bafe162feefb
QUALIFICATION_RUN  = 9abce4954edbdb34
SUPERVISOR_RUN     = f7f4b208772caa8b
RESULT_SHA         = b55ba6179ef1533b85499c083142604d869549e4fd9b0300b730854a62f6464b
TELEMETRY_SHA      = fb17967cd3c9375a938937db50447c4a8c2002ed3f5374cfaea8245fbc1538dd
TELEMETRY_LINES    = 31531
READY_FOR_LH_07    = YES
```

### LH-06 frozen evidence

| artifact | path | role |
| --- | --- | --- |
| freeze record | `qualification/lh06-frozen.json` | canonical closure-of-record (Factory-root) |
| evidence packet | `labs/long-horizon-harness/qualification/lh06-qualification02/` | byte-faithful preservation of `result.json`, `result.commit.json`, `telemetry.jsonl`, `qualification.log`, `MANIFEST.json`, `README.md`, `SHA256SUMS` |
| frozen verifier | `scripts/verify_lh06_frozen.sh` | single deterministic freeze guard |
| adversarial corpus | `tests/lh06-frozen/test_lh06_frozen.sh` | 1 control + 15 mutation oracles |
| QUALIFICATION01 RED | `qualification/lh06-red-qualification01/`, `labs/long-horizon-harness/qualification/lh06-red-2026-09-21/` | preserved negative history |
| freeze report | `docs/LH-06-FREEZE.md` | durable human-readable closure narrative |

### LH-06 authoritative exit invariants

```text
QUALIFICATION_PASS_WITH_DURATION_LT_60M                = IMPOSSIBLE
QUALIFICATION_PASS_WITH_EPOCHS_LT_500                 = IMPOSSIBLE
PASS_WITH_SEMANTIC_DRIFT                              = IMPOSSIBLE
PASS_WITH_LIFECYCLE_DRIFT                             = IMPOSSIBLE
PASS_WITH_FAULT_ESCAPE                                = IMPOSSIBLE
PASS_WITH_PREDECESSOR_DEPENDENCY                      = IMPOSSIBLE
PASS_WITH_MULTIPLE_SEMANTICS_PER_CASE                 = IMPOSSIBLE
PASS_WITH_RESOURCE_IMBALANCE                          = IMPOSSIBLE
PASS_WITH_WORKSPACE_LEAK                              = IMPOSSIBLE
PASS_WITH_UNSTABLE_HEAP                               = IMPOSSIBLE
PASS_WITH_UNSTABLE_LATENCY                            = IMPOSSIBLE
PASS_WITH_FROZEN_TREE_MUTATION                        = IMPOSSIBLE
PASS_WITH_INCOMPLETE_SUBSTRATE                        = IMPOSSIBLE
PASS_WITH_RESULT_HASH_DRIFT                           = IMPOSSIBLE
PASS_WITH_TELEMETRY_HASH_DRIFT                        = IMPOSSIBLE
PASS_WITH_TELEMETRY_COUNT_DRIFT                       = IMPOSSIBLE
PASS_WITH_ATOMIC_ONLY_PUBLICATION                     = IMPOSSIBLE
PASS_WITHOUT_COMMIT_WITNESS                           = IMPOSSIBLE
GREEN_FREEZE_WITHOUT_PRESERVED_RED_HISTORY            = IMPOSSIBLE
```

### LH-06 next step

```text
NEXT = DEFINE_LH07_ACT_FROM_REMAINING_BOARD_WORK
```

The ACT does not invent LH-07's mission. The next action is
to inspect the remaining Long-Horizon epic board and define
the next unresolved LH item rather than continuing to harden
an already-qualified soak laboratory.
