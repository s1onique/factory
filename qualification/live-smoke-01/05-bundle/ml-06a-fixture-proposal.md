# ML-06A — First Solution-Blind Production-Code Fixture (PROPOSAL)

> ACT: `ACT-FACTORY-LIVE-SMOKE-01`
> Status: **PROPOSED — not qualified, not executed.** Per the ACT, this fixture
> is proposed only. No qualification and no execution happened in this ACT.

---

## 1. The defect

**Module:** `labs/long-horizon-harness/src/subject/subject-json.ts`
**Function:** `validateJsonValue(value: unknown, path: string): JsonValidation`

A pure, dependency-free validator at the Phase D subject trust boundary. Its
documented contract is that a JSON value is valid when it contains no
non-JSON primitives and no **recursive back-edge**.

The known-bad revision (`0bd72f4`) implemented the cycle guard with a single
`WeakSet` that recorded **every object ever visited**, not the objects on the
**current recursion path**. The consequence:

| Input | KNOWN BAD (`0bd72f4`) | KNOWN GOOD (`5b7508f`) |
| --- | --- | --- |
| `{ left: shared, right: shared }` (acyclic DAG) | `ok:false` — "cyclic value" | `ok:true` |
| `{ self: itself }` (true back-edge) | `ok:false` | `ok:false` |

The known-bad revision rejects a **perfectly valid** manifest whose two
branches share the same child object. `canonicalize()` encodes that value
happily, so the validator was stricter than the thing it validates — a false
rejection at a trust boundary, i.e. a false alarm on a legal input.

### 1.1 Reproduction on the actual host

Executed on this host with the harness's own `tsx` loader, Node `v26.0.0`:

```text
$ node --import <abs>/labs/long-horizon-harness/node_modules/tsx/dist/loader.mjs probe.ts

# KNOWN BAD (0bd72f4)
SHARED_DAG  => {"ok":false,"reason":"$.right: cyclic value is not a JsonValue"}
TRUE_CYCLE  => {"ok":false,"reason":"$.self: cyclic value is not a JsonValue"}

# KNOWN GOOD (5b7508f)
SHARED_DAG  => {"ok":true,"value":{"left":{"k":1},"right":{"k":1}}}
TRUE_CYCLE  => {"ok":false,"reason":"$.self: cyclic value is not a JsonValue"}
```

The known-bad revision produces a **false rejection on a legal input**. The
known-good revision accepts the DAG and still rejects the true back-edge.
Both controls are cheap: one function call, no I/O, no process.

---

## 2. Why this fixture satisfies the ML-06A requirements

| Requirement | How this fixture satisfies it |
| --- | --- |
| The task modifies PRODUCTION code, not its own acceptance test | The allowed path is `src/subject/subject-json.ts` — production source under `src/`. The evaluator-owned test is a SEPARATE, immutable file. |
| The prompt describes SYMPTOMS and required behaviour, not the implementation | The prompt below names the observable symptom and the required outcome. It does NOT mention `WeakSet`, recursion stacks, ancestors, or `try/finally`. |
| Evaluator-owned tests remain IMMUTABLE | The acceptance test file is owned by the evaluator and is not in the allowed path set. |
| Historical fixed and defective states are AVAILABLE | Known-bad `0bd72f4`; known-good `5b7508f`. Both are real commits in this repository's history. |
| Known-bad and known-good controls are INEXPENSIVE | One pure function call each. No fixture execution, no subprocess, no timer. |
| No continuation or multi-execution dependency | A single edit, a single test run. `continuation_required: false`. |
| No new infrastructure required | Reuses the existing `labs/model-lab` oracle shape, the existing `subject-json` module and the existing `tsx` loader. |
| A PURE function or deterministic validator defect | `validateJsonValue` is pure: no I/O, no fs, no network, no clock, no randomness. |

---

## 3. Proposed fixture definition

### 3.1 Base and overlay

| Property | Value |
| --- | --- |
| Base commit | `0bd72f4b97486b9b95cbb75e7e384586d03aa22f` (the known-bad revision) |
| Known-good commit | `5b7508fa09e6f10b6ec683e94a35758a15f9d827` |
| Preparation overlay | **none required** — the base commit already carries the defect |
| Allowed path | `labs/long-horizon-harness/src/subject/subject-json.ts` |
| Forbidden paths | `labs/long-horizon-harness/src/**` (except the allowed path), `labs/long-horizon-harness/test/**`, `labs/long-horizon-harness/lifecycle-corpus/**` |
| Single execution | yes — one edit, one acceptance run |

### 3.2 The task prompt (solution-blind)

> The subject-manifest trust boundary rejects some manifests that are
> perfectly legal.
>
> A manifest may legitimately reuse the SAME nested object in more than one
> place — for example a configuration that references one shared options
> object from two different sections. Today such a manifest is refused with
> a "cyclic value is not a JsonValue" error, even though it contains no
> cycle at all.
>
> A manifest that genuinely contains a recursive back-edge (an object that
> contains itself) must still be refused.
>
> Fix the validator so that only true recursive back-edges are refused.
> Do not change any test file.

This prompt states the symptom and the required behaviour. It does not
name the data structure, the traversal, or the fix. It is materially
different from ML-SMOKE-01, whose prompt states the remedy outright.

### 3.3 Evaluator-owned acceptance

The evaluator owns an immutable test that asserts, at the production
boundary:

1. an acyclic DAG with shared substructure is ACCEPTED (`ok:true`);
2. a true recursive back-edge is REJECTED (`ok:false`);
3. a cycle nested inside a sibling-shared DAG is REJECTED (no over-broad
   acceptance introduced by the fix);
4. the validator still NEVER throws on hostile input.

Known-bad control: the evaluator's test FAILS on the base commit (assertion
1 fails). Known-good control: it PASSES on `5b7508f`.

### 3.4 Why ML-SMOKE-01's machinery does not transfer verbatim, and what does

ML-SMOKE-01's oracle is bound to a fixture that executes a real Node test
runner against a TypeScript test file. ML-06A's acceptance does not need
that: the validator is a pure function. The oracle therefore needs only:

| Component | Reuse |
| --- | --- |
| The scoped-tree comparison (`compareTrees`) | **reuse unchanged** |
| The allowed-region validation | **reuse**, with the permitted region redefined as "the cycle-guard logic in `validateJsonValue`" rather than "the fixture-construction seam" |
| The reference-digest discipline (supervisor-supplied, not read from an adjacent file) | **reuse unchanged** |
| The fresh-output-directory rule | **reuse unchanged** |
| The structured event reporter | **not needed** — no test-runner event stream is involved |

**This is one fixture, not a corpus, and it does not require a generalized
benchmark framework.**

---

## 4. Explicit non-claims

- This fixture has **not** been qualified. Its controls are **proposed**.
- It has **not** been executed against any model.
- It makes **no** claim about any model's ranking ability.
- ML-SMOKE-01 remains a **solution-bearing smoke fixture**; ML-06A is the
  first proposal that is genuinely solution-blind.
