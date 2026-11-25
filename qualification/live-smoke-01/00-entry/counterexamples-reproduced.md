# LIVE-SMOKE-01 — The Reproduced Counterexamples and Their Corrections

> ACT: `ACT-FACTORY-LIVE-SMOKE-01`
> Every counterexample below was reproduced on THIS host, against the ACTUAL
> corrected-in-progress code, before the correction was written.

---

## A1 — A boolean skip was reported as a PASS

**Reproduced.** The previous reporter accepted only `typeof data.skip === "string"`.
Node reports a skipped test as a `test:pass` event whose `data.skip` is a
BOOLEAN for `t.skip()` and for `{ skip: true }`.

```text
$ node --test --test-reporter=<previous reporter> t.test.mjs
{"name":"SKIP BOOL","status":"pass",...}     <-- WRONG: it is a SKIP
{"name":"OPTS SKIP TRUE","status":"pass",...} <-- WRONG: it is a SKIP
```

**Correction.** The reporter honours `data.skip !== undefined` and
`data.todo !== undefined`, so both the string and the boolean forms are
recognised. Control **L23** exercises the ACTUAL reporter against a REAL
Node test runner and asserts 3 skips and 2 todos are counted.

## A2 — A boolean todo was reported as a PASS

**Reproduced.** Same root cause: only `typeof data.todo === "string"` was
accepted, so `{ todo: true }` was reported as a PASS.

```text
{"name":"TODO BOOL","status":"pass",...}     <-- WRONG: it is a TODO
```

**Correction.** As A1. Control **L23**.

## A3 — The reproduced false-acceptance counterexample

**Reproduced.** The independent reviewer's counterexample, expressed in the
reporter's own vocabulary: a REQUIRED `REC-TMP01` carrying `{ skip: true }`
and a REQUIRED `REC-TMP02` carrying `{ todo: true }`.

- Before: `acceptance = PASS`, `executed = 2`.
- After: `acceptance = FAIL`, `executed = 0`, reasons `SKIPPED REC-TMP01`
  and `TODO REC-TMP02`.

Control **L15**.

## A4 — A required test identity was not bound to its file

**Reproduced.** The previous classifier matched a required test by NAME
ALONE. The same name in another file satisfied the requirement.

**Correction.** `findRequiredTest()` binds the identity to (file, name).
Missing, ambiguous (duplicate) and invalid identities are distinct
outcomes and each is a FAIL. Controls **L16**, **L17**.

## A5 — A truncated event stream was indistinguishable from a complete one

**Reproduced.** The previous classifier used a brace-depth scanner. A stream
cut in half still yields the records it managed to parse.

**Correction.** The stream is newline-delimited JSON terminated by an
explicit completion record. `parseEventStream()` distinguishes
`malformed_event_stream`, `truncated_event_stream` and `records_after_completion`,
and `classifyEvents()` additionally rejects a stream whose record count is
below the runner's own test count. Control **L18**.

## A6 — Acceptance was not bound to the process exit

**Reproduced.** The oracle read the event stream but not the gate's exit
status. A gate that failed for an unrelated reason could still be read as a
PASS by the stream alone.

**Correction.** `decideAcceptance()` takes `processExit` and refuses a
non-zero exit. Control **L19**.

## A7 — Mutation detection was not bound to the intended test's own file

**Reproduced.** The same-name-in-another-file case of A4 applied to the
mutation verdict.

**Correction.** `decideMutation()` binds the required test to its file, and
refuses a timeout (exit 124), a parser failure and an unrelated execution
failure. Control **L20**.

## B1 — `compareTrees(".", ".")` returned zero violations

**Reproduced.** A self-comparison found nothing, so an unauthorised change
could be reported as scope-clean.

```text
compareTrees(".", ".") -> { error: null, violations: [] }   <-- the defect
```

**Correction.** `describeRootOverlap()` resolves both roots and refuses the
identity case (`reference_and_workspace_are_the_same_tree`) and the
overlap case (`reference_root_overlaps_workspace_root`), including a
symlinked alias. The oracle HALTs on either. Control **L22**.

## B2 — The reference authority was a mutable adjacent file

**Reproduced.** The oracle read the expected reference digest from
`<prepared_dir>/../identity.txt` — a mutable file next to the reference
tree, which was authority over itself.

**Correction.** The expected digest is supplied BY THE SUPERVISOR as the
oracle's fifth argument, from state recorded BEFORE candidate execution. A
missing expected digest is a HALT (`expected_reference_digest_not_supplied`).
The qualification controls now record the digest independently and pass it
in.

## B3 — An assertion-library import could be replaced outright

**Reproduced.** `validateAllowedRegion()` removed every import before
comparing, and never compared them separately. Replacing
`import assert from "node:assert/strict"` with `import assert from "node:assert"`
passed.

**Correction.** The imports are extracted and compared strictly: every
reference import must still be present, byte for byte, and only a `node:os`
import may be ADDED (the historical fix's need). Controls **L21**.

## C1 — The fixture preparation recycled a stale directory

**Reproduced.** The previous preparation reused an output directory it had
created before, deleting its contents and re-materialising the fixture into
it.

**Correction.** Every preparation requires an output directory that does NOT
exist. A collision is refused, not recycled. The ownership marker, the
destructive reuse and the stale-lock reclamation are all gone. Controls
**L11**, **L14**.

## C2 — The evaluator's dependency tree was a candidate-accessible symlink

**Reproduced.** The oracle symlinked the evaluator's own `node_modules` into
the reconstruction.

**Correction.** The reconstruction receives a disposable COPY of the
evaluator's tree, supplied independently. There is no candidate-accessible
path to evaluator-owned dependencies.

## D1 — The gate loaded its test files for the wrong reason

**Reproduced.** The oracle resolved `EVALUATOR_DEPS` from a RELATIVE
`repo_root`. The gate runs in a reconstruction under a different working
directory, so the TypeScript loader path resolved against the
reconstruction and every test file failed to load — reported as
`GATE_UNAVAILABLE=1` with zero scope violations. It looked like a
candidate failure; it was a path bug.

**Correction.** Every path the oracle uses is resolved to an absolute path
before use.
