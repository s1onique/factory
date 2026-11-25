/**
 * test_ml_smoke_01_lib.mjs — FAST, DETERMINISTIC regression controls for the
 * ML-SMOKE-01 decision logic.
 *
 * These controls are the ordinary development feedback. They run in well
 * under a second because they exercise the DECISION LOGIC with synthetic
 * structured-event inputs and synthetic filesystem trees. No fixture is
 * executed, no Node test runner is started, no historical file is touched.
 *
 * The expensive controls — the ones that execute the REAL historical
 * fixture end to end — live in `test_ml_smoke_01_oracle.sh` and are the
 * FULL qualification level, not the ordinary gate.
 *
 * Every control here exists because a defect was actually reproduced:
 *
 *   L01  Failure identity contamination: an unrelated test's ENOENT
 *        diagnostic made the oracle report DETECTED.
 *   L02  Optional reference: the candidate was compared against itself.
 *   L03  Dependency trust: a candidate-owned node_modules was TRUSTED.
 *   L04  Symlink substitution: a protected file replaced by a symlink to
 *        identical content produced zero scope violations.
 *   L05  Enumeration failure was swallowed instead of failing closed.
 *   L06  Unauthorised mode change was not a violation.
 *   L07  A skipped required test was not distinguished from a pass.
 *   L08  The historical false-PASS counterexample.
 *   L09  Allowed-region validation accepted a change to the assertions.
 *   L10  The known-bad mutation produced invalid source (the P0.1 mode).
 *   L11  Fixture preparation deleted a caller-supplied directory it did
 *        not own.
 *
 * Exit: 0 when every control behaves as specified, 1 otherwise.
 */

import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
	REQUIRED_TESTS,
	applyKnownBadMutation,
	classifyEvents,
	compareTrees,
	decideAcceptance,
	decideMutation,
	digestOfDirectory,
	locateSeam,
	validateAllowedRegion,
} from "../../labs/model-lab/ml_smoke_01_lib.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, "..", "..")
const PREPARE = join(REPO_ROOT, "labs", "model-lab", "prepare_ml_smoke_01.sh")
const REPORTER = join(REPO_ROOT, "labs", "model-lab", "ml_smoke_01_test_reporter.mjs")
const BASE_COMMIT = "09fc12c6fb051dce096252bf30c2e96debed962c"

let passCount = 0
let failCount = 0

function ok(label) {
	passCount += 1
	console.log(`  [PASS] ${label}`)
}
function bad(label) {
	failCount += 1
	console.log(`  [FAIL] ${label}`)
}
function assert(condition, label) {
	if (condition) ok(label)
	else bad(label)
}

/** One synthetic structured event, in the reporter's NDJSON format. */
function event(name, status, codes = [], messages = [], file = undefined) {
	const record = { kind: "test", name, status, codes, messages }
	if (file !== undefined) record.file = file
	return JSON.stringify(record)
}

/**
 * A synthetic event log.
 *
 * The stream is TERMINATED by the completion record, exactly as the real
 * reporter terminates it. A stream without it is a TRUNCATED stream and
 * must be rejected.
 *
 * The completion record carries the SAME SHAPE the real Node runner
 * reports: the total, the per-status counts and the suite count. The
 * classifier RECONCILES the completion record against the observed
 * records, so a synthetic stream must be internally consistent for the
 * controls that exercise the decision logic.
 */
function log(...events) {
	const records = [...events]
	const counts = { passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 }
	for (const record of records) {
		const parsed = JSON.parse(record)
		if (parsed.status === "pass") counts.passed += 1
		else if (parsed.status === "fail") counts.failed += 1
		else if (parsed.status === "skip") counts.skipped += 1
		else if (parsed.status === "todo") counts.todo += 1
		else if (parsed.status === "cancel") counts.cancelled += 1
	}
	const total = counts.passed + counts.failed + counts.skipped + counts.todo + counts.cancelled
	return (
		records.join("\n") +
		"\n" +
		JSON.stringify({
			kind: "complete",
			counts: { tests: total, ...counts, topLevel: total, suites: 0 },
		}) +
		"\n"
	)
}

/**
 * The EXPECTED mutant test-failure process exit.
 *
 * Node's test runner exits 1 when a test fails. The mutant's verdict is
 * only meaningful when the runner's own exit agrees that the run failed.
 */
const MUTANT_FAILURE_EXIT = 1

const REC1 = REQUIRED_TESTS[0].name
const REC2 = REQUIRED_TESTS[1].name
const REC_FILE = REQUIRED_TESTS[0].file

/** A synthetic event for a required test, carrying its exact file. */
function reqEvent(name, status, codes = [], messages = []) {
	return event(name, status, codes, messages, REC_FILE)
}

console.log("=== ML-SMOKE-01 decision-logic regression controls (fast) ===")
console.log("")

// ---------------------------------------------------------------------------
// L01 — failure identity contamination.
//
// The mutant's REC-TMP01 fails with an ASSERTION error, while an UNRELATED
// test emits an ENOENT diagnostic. The old oracle searched the whole log for
// "ENOENT" and reported DETECTED. The bound verdict must be WRONG_FAILURE.
// ---------------------------------------------------------------------------

{
	const contaminated = log(
		reqEvent(REC1, "fail", ["ERR_TEST_FAILURE", "ERR_ASSERTION"], ["1 !== 2"]),
		event("SOME-OTHER-TEST: unrelated diagnostic", "fail", ["ERR_TEST_FAILURE", "ENOENT"], ["ENOENT: no such file or directory"]),
	)
	const decision = decideMutation(classifyEvents(contaminated), REC1, "ENOENT", {
		processExit: MUTANT_FAILURE_EXIT,
	})
	assert(decision.status === "WRONG_FAILURE", "L01 unrelated ENOENT diagnostic does NOT contaminate the verdict")
	assert(decision.detected === false, "L01 unrelated ENOENT diagnostic is NOT a detection")

	const clean = log(reqEvent(REC1, "fail", ["ERR_TEST_FAILURE", "ENOENT"], ["ENOENT: no such file or directory"]))
	const cleanDecision = decideMutation(classifyEvents(clean), REC1, "ENOENT", {
		processExit: MUTANT_FAILURE_EXIT,
	})
	assert(cleanDecision.status === "DETECTED", "L01 the required test's OWN ENOENT is a detection")
	assert(cleanDecision.detected === true, "L01 the required test's OWN ENOENT sets detected=true")
}

// ---------------------------------------------------------------------------
// L01b — the mutant passes / is skipped / is absent.
// ---------------------------------------------------------------------------

{
	assert(decideMutation(classifyEvents(log(reqEvent(REC1, "pass"))), REC1).status === "MUTATION_SURVIVED", "L01b a passing mutant is MUTATION_SURVIVED")
	assert(decideMutation(classifyEvents(log(reqEvent(REC1, "skip"))), REC1).status === "EXECUTION_FAILURE", "L01b a skipped required test is EXECUTION_FAILURE")
	assert(decideMutation(classifyEvents(log(reqEvent(REC2, "pass"))), REC1).status === "EXECUTION_FAILURE", "L01b an absent required test is EXECUTION_FAILURE")
}


// ---------------------------------------------------------------------------
// L02 — the reference must be independent and plain.
//
// The oracle must never compare a candidate against ITSELF. This control
// asserts the LIBRARY side: a self-comparison finds nothing (which is
// exactly why the oracle must refuse to rely on it), and a reference that
// contains a dependency tree is refused.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l02-"))
	try {
		mkdirSync(join(root, "src"), { recursive: true })
		writeFileSync(join(root, "src", "a.ts"), "export const a = 1\n")
		const self = await compareTrees(root, root)
		assert(
			self.error === "reference_and_workspace_are_the_same_tree",
			"L02 comparing a tree with itself is REFUSED (the reproduced defect)",
		)
		assert(
			self.violations.length === 0,
			"L02 a refused comparison yields no violations and never a PASS",
		)

		const withDeps = mkdtempSync(join(tmpdir(), "ml-smoke-01-l02b-"))
		try {
			mkdirSync(join(withDeps, "node_modules"), { recursive: true })
			// The trees must be DISTINCT: the identity check now runs first.
			const plain = mkdtempSync(join(tmpdir(), "ml-smoke-01-l02c-"))
			try {
				mkdirSync(join(plain, "node_modules"), { recursive: true })
				const r = await compareTrees(withDeps, plain)
				assert(
					String(r.error).includes("reference_contains_dependency_tree"),
					"L02 a reference containing a dependency tree is refused",
				)
			} finally {
				rmSync(plain, { recursive: true, force: true })
			}
		} finally {
			rmSync(withDeps, { recursive: true, force: true })
		}
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// L03 — dependency trust.
//
// A candidate-created `node_modules` directory is a FORBIDDEN_DEPENDENCY
// violation, even though its path resolves.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l03-"))
	try {
		const ref = join(root, "ref")
		const ws = join(root, "ws")
		mkdirSync(ref, { recursive: true })
		mkdirSync(ws, { recursive: true })
		writeFileSync(join(ref, "a.ts"), "export const a = 1\n")
		writeFileSync(join(ws, "a.ts"), "export const a = 1\n")
		mkdirSync(join(ws, "labs", "long-horizon-harness", "node_modules"), { recursive: true })
		writeFileSync(join(ws, "labs", "long-horizon-harness", "node_modules", "tsx.js"), "// candidate owned\n")

		const r = await compareTrees(ref, ws)
		const dep = r.violations.find((v) => v.kind === "FORBIDDEN_DEPENDENCY")
		assert(dep !== undefined, "L03 a candidate-owned node_modules is a FORBIDDEN_DEPENDENCY violation")
		assert(dep?.path === "labs/long-horizon-harness/node_modules", "L03 the forbidden dependency path is reported exactly")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// L04 — symlink substitution.
//
// A protected regular file replaced with a symlink to IDENTICAL content
// must be an UNSUPPORTED_OBJECT violation.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l04-"))
	try {
		const ref = join(root, "ref")
		const ws = join(root, "ws")
		mkdirSync(ref, { recursive: true })
		mkdirSync(ws, { recursive: true })
		writeFileSync(join(ref, "protected.ts"), "export const p = 1\n")
		symlinkSync(join(ref, "protected.ts"), join(ws, "protected.ts"))

		const r = await compareTrees(ref, ws)
		const violation = r.violations.find((v) => v.kind === "UNSUPPORTED_OBJECT")
		assert(violation !== undefined, "L04 a symlink replacing a protected file is an UNSUPPORTED_OBJECT violation")
		assert(violation?.path === "protected.ts", "L04 the symlinked path is reported exactly")
		assert(r.violations.length === 1, "L04 the symlink substitution produces exactly one violation (not zero)")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// L05 — enumeration failure fails closed.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l05-"))
	try {
		const missing = join(root, "does-not-exist")
		const r = await compareTrees(missing, missing)
		assert(r.error === "enumeration_failed", "L05 an enumeration error is reported, not swallowed")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// L06 — an unauthorised mode change is a violation.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l06-"))
	try {
		const ref = join(root, "ref")
		const ws = join(root, "ws")
		mkdirSync(ref, { recursive: true })
		mkdirSync(ws, { recursive: true })
		const content = "export const a = 1\n"
		writeFileSync(join(ref, "a.ts"), content)
		writeFileSync(join(ws, "a.ts"), content)
		chmodSync(join(ws, "a.ts"), 0o777)
		const r = await compareTrees(ref, ws)
		const violation = r.violations.find((v) => v.kind === "MODE_CHANGED")
		assert(violation !== undefined, "L06 an unauthorised mode change is a MODE_CHANGED violation")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}


// ---------------------------------------------------------------------------
// L07 — a skipped required test is not a pass.
// ---------------------------------------------------------------------------

{
	const skipped = classifyEvents(log(reqEvent(REC1, "skip"), reqEvent(REC2, "pass")))
	const d = decideAcceptance(skipped, REQUIRED_TESTS)
	assert(d.acceptance === "FAIL", "L07 a skipped required test is not a pass")
	assert(d.reasons.includes("SKIPPED REC-TMP01"), "L07 the skipped required test is named in the reasons")
	assert(d.executed === 1, "L07 only the executed required test counts as executed")

	const allSkipped = classifyEvents(log(reqEvent(REC1, "skip"), reqEvent(REC2, "skip")))
	assert(decideAcceptance(allSkipped, REQUIRED_TESTS).acceptance === "FAIL", "L07 an all-skipped fixture is FAIL")
}

// ---------------------------------------------------------------------------
// L08 — the historical false-PASS counterexample.
//
// Every test skipped plus a helper that passes. The REBOOT-01 oracle
// reported ACCEPTANCE=PASS / DISPOSITION=PASS on this input.
// ---------------------------------------------------------------------------

{
	const counterexample = log(
		reqEvent(REC1, "skip"),
		reqEvent(REC2, "skip"),
		event("SOCK06: helper that passes", "pass", [], [], "test/ledger-writer/ledger-writer-socket-probe.test.ts"),
	)
	const d = decideAcceptance(classifyEvents(counterexample), REQUIRED_TESTS)
	assert(d.acceptance === "FAIL", "L08 the historical false-PASS counterexample is FAIL")
	assert(d.present === true, "L08 the counterexample's required tests ARE present (the defect was elsewhere)")
	assert(d.passing === false, "L08 the counterexample's required tests do NOT pass")
}

// ---------------------------------------------------------------------------
// L09 — the allowed region.
//
// The candidate may change the seam and add imports. It may NOT change the
// assertions.
// ---------------------------------------------------------------------------

{
	const reference = [
		'import { join } from "node:path";',
		'const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));',
		'assert.equal(d.startsWith(absentBase), true, "REC-TMP01: location");',
		"",
	].join("\n")
	const fixed = [
		'import { tmpdir } from "node:os";',
		'import { join } from "node:path";',
		'const tmpRoot = await fs.mkdtemp(join(tmpdir(), "factory-rec-tmp01-"));',
		'assert.equal(d.startsWith(absentBase), true, "REC-TMP01: location");',
		"",
	].join("\n")
	assert(validateAllowedRegion(reference, fixed).ok === true, "L09 the historical fix is inside the permitted region")

	const tampered = fixed.replace('"REC-TMP01: location"', '"REC-TMP01: tampered"')
	const r = validateAllowedRegion(reference, tampered)
	assert(r.ok === false, "L09 a changed assertion is outside the permitted region")
	assert(r.reason === "content_changed_outside_the_permitted_region", "L09 the reason names the permitted region")
}

// ---------------------------------------------------------------------------
// L10 — the known-bad mutation is whole-statement and syntactically safe.
//
// The historical P0.1 defect replaced only the PREFIX of the statement,
// leaving the original arguments behind and producing a SYNTAX ERROR.
// ---------------------------------------------------------------------------

{
	const fixed = [
		'import { tmpdir } from "node:os";',
		'const tmpRoot = await fs.mkdtemp(join(tmpdir(), "factory-rec-tmp01-"));',
		'const absentBase = join(tmpRoot, "absent-" + Date.now());',
		"",
	].join("\n")
	const mutated = applyKnownBadMutation(fixed)
	assert(mutated.applied === true, "L10 the known-bad mutation applies to the seam")
	assert(mutated.text.includes('join(process.cwd(), ".tmp-home", "tmp01-")'), "L10 the mutation restores the historical statement")
	assert(!mutated.text.includes("factory-rec-tmp01-"), "L10 the mutation leaves no residue of the candidate's fix")
	assert(!/tmp01-\"\)\);join\(/.test(mutated.text), "L10 the mutation does not leave trailing arguments behind")

	const alreadyBad = 'const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));\n'
	assert(applyKnownBadMutation(alreadyBad).applied === false, "L10 a mutation that changes nothing is NOT applied")
}

// ---------------------------------------------------------------------------
// L11 — the fixture preparation does not destroy a directory it does not own.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l11-"))
	try {
		const foreign = join(root, "not-ours")
		mkdirSync(foreign, { recursive: true })
		writeFileSync(join(foreign, "precious.txt"), "do not delete me\n")
		let failed = false
		try {
			execFileSync("bash", [PREPARE, REPO_ROOT, "0000000000000000000000000000000000000000", foreign, "--check-only"], {
				stdio: "ignore",
			})
		} catch {
			failed = true
		}
		assert(failed === true, "L11 the preparation refuses an invalid base commit")
		assert(
			readFileSync(join(foreign, "precious.txt"), "utf8") === "do not delete me\n",
			"L11 the preparation does NOT delete a directory it does not own",
		)

		const foreign2 = join(root, "not-ours-2")
		mkdirSync(foreign2, { recursive: true })
		writeFileSync(join(foreign2, "precious.txt"), "do not delete me\n")
		let refused = false
		try {
			execFileSync("bash", [PREPARE, REPO_ROOT, "09fc12c6fb051dce096252bf30c2e96debed962c", foreign2, "--check-only"], {
				stdio: "ignore",
			})
		} catch {
			refused = true
		}
		assert(refused === true, "L11 the preparation refuses an EXISTING output directory")
		assert(
			readFileSync(join(foreign2, "precious.txt"), "utf8") === "do not delete me\n",
			"L11 the refused directory's content is intact",
		)

		// An EMPTY directory is refused too: every preparation uses a
		// fresh directory. A collision is refused, not recycled.
		const empty = join(root, "empty")
		mkdirSync(empty, { recursive: true })
		let emptyRefused = false
		try {
			execFileSync("bash", [PREPARE, REPO_ROOT, BASE_COMMIT, empty, "--check-only"], { stdio: "ignore" })
		} catch {
			emptyRefused = true
		}
		assert(emptyRefused === true, "L11 the preparation refuses even an EMPTY existing output directory")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// L12 — the seam locator selects the fixture root, not the helper.
// ---------------------------------------------------------------------------

{
	const source = [
		"async function tmpDir(base: string = TMP_HOME_BASE): Promise<string> {",
		'  await fs.mkdir(base, { recursive: true });',
		'  return await fs.mkdtemp(join(base, "run-"));',
		"}",
		'test("REC-TMP01: x", async () => {',
		'  const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));',
		"});",
		"",
	].join("\n")
	const seam = locateSeam(source)
	assert(seam !== null, "L12 the seam is located")
	const span = source.slice(seam.start, seam.end)
	assert(span.startsWith("const tmpRoot"), "L12 the seam is the fixture root, not the tmpDir helper")
	assert(!span.includes("run-"), "L12 the seam does not cover the tmpDir helper's mkdtemp")
}

// ---------------------------------------------------------------------------
// L13 — the fixture digest is stable and content-sensitive.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l13-"))
	try {
		mkdirSync(join(root, "b"), { recursive: true })
		writeFileSync(join(root, "b", "two.txt"), "two\n")
		writeFileSync(join(root, "one.txt"), "one\n")
		const first = await digestOfDirectory(root)
		const second = await digestOfDirectory(root)
		assert(first === second, "L13 the fixture digest is stable")
		assert(first.length === 64, "L13 the fixture digest is a SHA-256 hex digest")

		writeFileSync(join(root, "one.txt"), "one changed\n")
		assert((await digestOfDirectory(root)) !== first, "L13 the fixture digest changes when the content changes")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

console.log("")
// ---------------------------------------------------------------------------
// L14 — the fixture preparation uses a FRESH output directory.
//
// The previous revision took an exclusive per-output-directory lock and
// RECYCLED a directory it had created before, deleting its contents to
// re-materialise the fixture. Both mechanisms are gone: the lock (and
// with it the stale-lock reclamation) was unnecessary machinery, and the
// recycling made a stale fixture indistinguishable from a fresh one.
//
// The rule is now: the output directory MUST NOT EXIST. A collision is
// REFUSED.
//
// This control proves the refusal is a REFUSAL and not a silent recycle:
// the foreign directory's content survives untouched.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l14-"))
	try {
		const target = join(root, "prep")
		mkdirSync(target, { recursive: true })
		writeFileSync(join(target, "precious.txt"), "do not delete me\n")

		let refused = false
		try {
			execFileSync("bash", [PREPARE, REPO_ROOT, BASE_COMMIT, target, "--check-only"], { stdio: "ignore" })
		} catch {
			refused = true
		}
		assert(refused === true, "L14 an existing output directory is REFUSED")
		assert(
			readFileSync(join(target, "precious.txt"), "utf8") === "do not delete me\n",
			"L14 the refused directory's content is NOT deleted",
		)

		// A FRESH directory is accepted.
		const fresh = join(root, "fresh")
		let accepted = false
		try {
			execFileSync("bash", [PREPARE, REPO_ROOT, BASE_COMMIT, fresh, "--check-only"], { stdio: "ignore" })
			accepted = true
		} catch {
			accepted = false
		}
		assert(accepted === true, "L14 a FRESH output directory is accepted")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// L15 — the REPRODUCED false-acceptance counterexample.
//
// The independent reviewer extracted the actual CORR02 reporter and
// reproduced a FALSE ACCEPTANCE with a REQUIRED REC-TMP01 carrying
// `{ skip: true }` and a REQUIRED REC-TMP02 carrying `{ todo: true }`.
// Both were reported as PASSING and executed. The old reporter accepted
// only the STRING forms of `skip` and `todo`.
// ---------------------------------------------------------------------------

{
	const booleanSkip = JSON.stringify({
		kind: "test", name: REC1, status: "skip", skip: true,
		codes: [], messages: [], file: REC_FILE,
	})
	const booleanTodo = JSON.stringify({
		kind: "test", name: REC2, status: "todo", todo: true,
		codes: [], messages: [], file: REC_FILE,
	})
	const counterexample =
		booleanSkip + "\n" + booleanTodo + "\n" +
		JSON.stringify({ kind: "complete", counts: { tests: 2 } }) + "\n"

	const classified = classifyEvents(counterexample)
	assert(classified.error === null, "L15 the counterexample stream is well-formed")
	assert(classified.counts.skipped === 1, "L15 the boolean skip is counted as SKIPPED")
	assert(classified.counts.todo === 1, "L15 the boolean todo is counted as TODO")
	assert(classified.counts.passed === 0, "L15 NEITHER counterexample test is counted as PASSED")

	const decision = decideAcceptance(classified, REQUIRED_TESTS)
	assert(decision.acceptance === "FAIL", "L15 the reproduced false-acceptance counterexample is FAIL (it was PASS)")
	assert(decision.reasons.includes("SKIPPED REC-TMP01"), "L15 the boolean skip is reported as a skip")
	assert(decision.reasons.includes("TODO REC-TMP02"), "L15 the boolean todo is reported as a todo")
	assert(decision.executed === 0, "L15 NEITHER counterexample test counts as executed")
}

// ---------------------------------------------------------------------------
// L16 — the REQUIRED test identity is bound to its exact FILE.
// ---------------------------------------------------------------------------

{
	const wrongFile = JSON.stringify({
		kind: "test", name: REC1, status: "pass",
		codes: [], messages: [], file: "test/somewhere-else.test.ts",
	})
	const stream =
		wrongFile + "\n" +
		JSON.stringify({ kind: "complete", counts: { tests: 1 } }) + "\n"
	const decision = decideAcceptance(classifyEvents(stream), REQUIRED_TESTS)
	assert(decision.acceptance === "FAIL", "L16 a required test in the wrong file is not an acceptance")
	assert(decision.reasons.includes("MISSING REC-TMP01"), "L16 the wrong-file test is reported as MISSING")
}

// ---------------------------------------------------------------------------
// L17 — a DUPLICATE terminal observation is ambiguous, not a pass.
// ---------------------------------------------------------------------------

{
	const duplicate =
		reqEvent(REC1, "pass") + "\n" +
		reqEvent(REC1, "pass") + "\n" +
		JSON.stringify({ kind: "complete", counts: { tests: 2 } }) + "\n"
	const decision = decideAcceptance(classifyEvents(duplicate), REQUIRED_TESTS)
	assert(decision.acceptance === "FAIL", "L17 a duplicate required test is not an acceptance")
	assert(decision.reasons.includes("AMBIGUOUS REC-TMP01"), "L17 the duplicate is reported as AMBIGUOUS")
}

// ---------------------------------------------------------------------------
// L18 — a TRUNCATED or MALFORMED event stream is rejected.
// ---------------------------------------------------------------------------

{
	const truncated = reqEvent(REC1, "pass") + "\n" + reqEvent(REC2, "pass") + "\n"
	const truncatedClassified = classifyEvents(truncated)
	assert(truncatedClassified.error === "truncated_event_stream", "L18 a stream without the completion record is TRUNCATED")
	assert(decideAcceptance(truncatedClassified, REQUIRED_TESTS).acceptance === "FAIL", "L18 a truncated stream is never an acceptance")

	const malformed = "{not json}\n" + JSON.stringify({ kind: "complete", counts: { tests: 0 } }) + "\n"
	const malformedClassified = classifyEvents(malformed)
	assert(malformedClassified.error === "malformed_event_stream", "L18 a malformed line is a MALFORMED stream")
	assert(decideAcceptance(malformedClassified, REQUIRED_TESTS).acceptance === "FAIL", "L18 a malformed stream is never an acceptance")

	const lossy =
		reqEvent(REC1, "pass") + "\n" +
		JSON.stringify({ kind: "complete", counts: { tests: 5 } }) + "\n"
	const lossyClassified = classifyEvents(lossy)
	assert(lossyClassified.complete === false, "L18 a stream that lost records is INCOMPLETE")
	assert(decideAcceptance(lossyClassified, REQUIRED_TESTS).acceptance === "FAIL", "L18 a lossy stream is never an acceptance")
}

// ---------------------------------------------------------------------------
// L19 — acceptance is bound to a successful process exit.
// ---------------------------------------------------------------------------

{
	const healthy = classifyEvents(log(reqEvent(REC1, "pass"), reqEvent(REC2, "pass")))
	assert(decideAcceptance(healthy, REQUIRED_TESTS, { processExit: 0 }).acceptance === "PASS", "L19 a clean run with exit 0 is an acceptance")
	const failed = decideAcceptance(healthy, REQUIRED_TESTS, { processExit: 1 })
	assert(failed.acceptance === "FAIL", "L19 a non-zero process exit is NOT an acceptance")
	assert(failed.reasons.includes("PROCESS_EXIT_1"), "L19 the non-zero process exit is named in the reasons")
}

// ---------------------------------------------------------------------------
// L20 — mutation detection is bound to the intended test's own mechanism,
//        its own file, and a completed mutant run.
// ---------------------------------------------------------------------------

{
	const detected = decideMutation(
		classifyEvents(log(reqEvent(REC1, "fail", ["ERR_TEST_FAILURE", "ENOENT"]))),
		REC1, "ENOENT", { requiredFile: REC_FILE, processExit: MUTANT_FAILURE_EXIT },
	)
	assert(detected.status === "DETECTED", "L20 the intended test's OWN ENOENT is a detection")

	const wrongFile = classifyEvents(
		log(event(REC1, "fail", ["ERR_TEST_FAILURE", "ENOENT"], [], "test/other.test.ts")),
	)
	assert(
		decideMutation(wrongFile, REC1, "ENOENT", { requiredFile: REC_FILE, processExit: MUTANT_FAILURE_EXIT }).status === "EXECUTION_FAILURE",
		"L20 the same test name in another file is NOT the required test",
	)

	const timedOut = decideMutation(
		classifyEvents(log(reqEvent(REC1, "fail", ["ERR_TEST_FAILURE", "ENOENT"]))),
		REC1, "ENOENT", { requiredFile: REC_FILE, processExit: 124 },
	)
	assert(timedOut.status === "EXECUTION_FAILURE", "L20 a timed-out mutant is NOT a detection")
	assert(timedOut.detected === false, "L20 a timed-out mutant sets detected=false")

	const parserFailure = decideMutation(classifyEvents("{broken\n"), REC1, "ENOENT", { requiredFile: REC_FILE })
	assert(parserFailure.status === "EXECUTION_FAILURE", "L20 a parser failure is NOT a detection")

	const unrelated = decideMutation(
		classifyEvents(log(reqEvent(REC1, "fail", ["ERR_TEST_FAILURE", "ERR_ASSERTION"]))),
		REC1, "ENOENT", { requiredFile: REC_FILE, processExit: MUTANT_FAILURE_EXIT },
	)
	assert(unrelated.status === "WRONG_FAILURE", "L20 an unrelated failure is NOT a detection")
}

// ---------------------------------------------------------------------------
// L21 — the allowed region preserves the EXISTING imports.
//
// The reproduced defect: replacing the assertion-library import passed
// `validateAllowedRegion()`, because every import was removed before the
// comparison and never compared separately.
// ---------------------------------------------------------------------------

{
	const reference = [
		'import { test, after } from "node:test";',
		'import assert from "node:assert/strict";',
		'import { join } from "node:path";',
		'const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));',
		'assert.equal(d.startsWith(absentBase), true, "REC-TMP01: location");',
		"",
	].join("\n")

	const fixed = [
		'import { test, after } from "node:test";',
		'import assert from "node:assert/strict";',
		'import { tmpdir } from "node:os";',
		'import { join } from "node:path";',
		'const tmpRoot = await fs.mkdtemp(join(tmpdir(), "factory-rec-tmp01-"));',
		'assert.equal(d.startsWith(absentBase), true, "REC-TMP01: location");',
		"",
	].join("\n")
	assert(validateAllowedRegion(reference, fixed).ok === true, "L21 the historical fix is inside the permitted region")

	const replacedAssertion = fixed.replace(
		'import assert from "node:assert/strict";',
		'import assert from "node:assert";',
	)
	const replacedResult = validateAllowedRegion(reference, replacedAssertion)
	assert(replacedResult.ok === false, "L21 a REPLACED assertion import is refused (the reproduced defect)")
	assert(replacedResult.reason === "existing_import_removed_or_replaced", "L21 the reason names the replaced import")

	const replacedRunner = fixed.replace(
		'import { test, after } from "node:test";',
		'import { test } from "node:test";',
	)
	assert(validateAllowedRegion(reference, replacedRunner).ok === false, "L21 a REPLACED test-runner import is refused")

	const dropped = fixed.replace('import { join } from "node:path";\n', "")
	assert(validateAllowedRegion(reference, dropped).ok === false, "L21 a DROPPED import is refused")

	const added = fixed.replace(
		'import { join } from "node:path";',
		'import { join } from "node:path";\nimport something from "lodash";',
	)
	const addedResult = validateAllowedRegion(reference, added)
	assert(addedResult.ok === false, "L21 an import from an unauthorised module is refused")
	assert(addedResult.reason === "import_added_outside_the_permitted_region", "L21 the reason names the unauthorised import")
}

// ---------------------------------------------------------------------------
// L22 — the REFERENCE and the WORKSPACE must be DISTINCT, DISJOINT trees.
//
// `compareTrees(".", ".")` returned zero violations. That is how an
// unauthorised change could be reported as scope-clean.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l22-"))
	try {
		const ref = join(root, "ref")
		const ws = join(root, "ws")
		mkdirSync(ref, { recursive: true })
		mkdirSync(ws, { recursive: true })
		writeFileSync(join(ref, "a.ts"), "export const a = 1\n")
		writeFileSync(join(ws, "a.ts"), "export const a = 1\n")

		assert((await compareTrees(ref, ref)).error === "reference_and_workspace_are_the_same_tree", "L22 the same tree twice is REFUSED")
		assert((await compareTrees(ref, ws)).error === null, "L22 two distinct trees compare normally")

		const nested = join(ref, "nested")
		mkdirSync(nested, { recursive: true })
		assert((await compareTrees(ref, nested)).error === "reference_root_overlaps_workspace_root", "L22 a workspace INSIDE the reference is REFUSED as overlapping")
		assert((await compareTrees(nested, ref)).error === "reference_root_overlaps_workspace_root", "L22 a reference INSIDE the workspace is REFUSED as overlapping")

		const alias = join(root, "alias")
		symlinkSync(ref, alias)
		assert((await compareTrees(ref, alias)).error === "reference_and_workspace_are_the_same_tree", "L22 a symlinked alias of the same tree is REFUSED")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// L23 — the ACTUAL REPORTER against GENUINE Node test events.
//
// Every other control in this file feeds SYNTHETIC objects to the
// classifier. The reporter itself must be exercised against the REAL
// Node test runner, because the reproduced false acceptance was a defect
// in the reporter's reading of Node's event contract, not in the
// classifier's reading of a record.
//
// This control starts a real Node test runner against a real temporary
// test file that exercises every status the fixture can produce, and
// asserts that the REAL event stream classifies correctly.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l23-"))
	try {
		const testFile = join(root, "events.test.mjs")
		writeFileSync(
			testFile,
			[
				'import test from "node:test"',
				'import assert from "node:assert"',
				'test("PLAIN PASS", async () => { assert.ok(true) })',
				'test("SKIP STRING", async (t) => { t.skip("because") })',
				'test("SKIP BOOLEAN", async (t) => { t.skip() })',
				'test("OPTIONS SKIP TRUE", { skip: true }, async () => {})',
				'test("TODO STRING", { todo: "later" }, async () => {})',
				'test("TODO BOOLEAN", { todo: true }, async () => {})',
				'test("REAL FAILURE", async () => { assert.fail("boom") })',
				"",
			].join("\n"),
		)
		// The run intentionally CONTAINS a failing test, so the test runner
		// exits non-zero. The event stream is still the evidence, so the
		// exit status is read, not treated as an error.
		const run = spawnSync(
			process.execPath,
			["--test", `--test-reporter=${REPORTER}`, "events.test.mjs"],
			{ encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "ignore"] },
		)
		const raw = run.stdout ?? ""
		assert(typeof raw === "string" && raw.length > 0, "L23 the real Node run produced an event stream")
		const classified = classifyEvents(raw)
		assert(classified.error === null, "L23 the REAL Node event stream is well-formed")
		assert(classified.complete === true, "L23 the REAL Node event stream carries its completion record")
		assert(classified.counts.passed === 1, "L23 the real passing test is counted as PASSED")
		assert(classified.counts.skipped === 3, "L23 the REAL skips (string, boolean and options) are all counted as SKIPPED")
		assert(classified.counts.todo === 2, "L23 the REAL todos (string and boolean) are both counted as TODO")
		assert(classified.counts.failed === 1, "L23 the real failure is counted as FAILED")
		assert(classified.total === 7, "L23 every REAL terminal observation is present")

		// The file identity is carried, RELATIVE to the runner's cwd.
		const observed = classified.tests.find((t) => t.name === "PLAIN PASS")
		assert(observed !== undefined, "L23 the real passing test is present")
		assert(
			observed.file === "events.test.mjs",
			"L23 the real event carries its RELATIVE file identity",
		)

		// The reporter's own contract, read back from the REAL stream.
		const realSkip = classified.tests.find((t) => t.name === "SKIP BOOLEAN")
		assert(realSkip?.status === "skip", "L23 a REAL boolean skip is a skip")
		const realTodo = classified.tests.find((t) => t.name === "TODO BOOLEAN")
		assert(realTodo?.status === "todo", "L23 a REAL boolean todo is a todo")

		// The REAL failure carries the REAL error chain.
		const realFailure = classified.tests.find((t) => t.name === "REAL FAILURE")
		assert(realFailure?.codes.includes("ERR_TEST_FAILURE"), "L23 the real failure carries ERR_TEST_FAILURE")
		assert(realFailure?.codes.includes("ERR_ASSERTION"), "L23 the real failure carries the assertion code")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// L24 — the MUTANT verdict is bound to the runner's OWN process exit.
//
// The reproduced defect: `decideMutation()` refused only exit 124 (the
// timeout sentinel) and accepted every other status. A mutant whose
// process exited 0 while the required test was observed failing, and a
// mutant whose process was KILLED (137), were both classified DETECTED.
//
// The expected mutant exit is the runner's own TEST-FAILURE exit.
// ---------------------------------------------------------------------------

{
	const enoentStream = () => log(reqEvent(REC1, "fail", ["ERR_TEST_FAILURE", "ENOENT"]))

	const exitZero = decideMutation(classifyEvents(enoentStream()), REC1, "ENOENT", {
		requiredFile: REC_FILE, processExit: 0,
	})
	assert(exitZero.status === "EXECUTION_FAILURE", "L24 a mutant that exited 0 is NOT a detection")
	assert(exitZero.detected === false, "L24 a mutant that exited 0 sets detected=false")
	assert(
		exitZero.note === "mutant_process_exit_zero_contradicts_observed_failure",
		"L24 the exit-0 contradiction is named",
	)

	const killed = decideMutation(classifyEvents(enoentStream()), REC1, "ENOENT", {
		requiredFile: REC_FILE, processExit: 137,
	})
	assert(killed.status === "EXECUTION_FAILURE", "L24 a KILLED mutant (137) is NOT a detection")
	assert(killed.detected === false, "L24 a KILLED mutant sets detected=false")
	assert(killed.note === "mutant_process_killed_exit_137", "L24 the signal death is named")

	const unknown = decideMutation(classifyEvents(enoentStream()), REC1, "ENOENT", {
		requiredFile: REC_FILE,
	})
	assert(unknown.status === "EXECUTION_FAILURE", "L24 an UNKNOWN mutant exit is NOT a detection")

	const expected = decideMutation(classifyEvents(enoentStream()), REC1, "ENOENT", {
		requiredFile: REC_FILE, processExit: MUTANT_FAILURE_EXIT,
	})
	assert(expected.status === "DETECTED", "L24 the EXPECTED mutant test-failure exit IS a detection")
}

// ---------------------------------------------------------------------------
// L25 — the COMPLETION RECORD must RECONCILE with the observed records.
//
// The reproduced defect: `classifyEvents()` compared only
// `observed < runnerTotal`. A completion record with NULL counts, an
// INCONSISTENT total and CONTRADICTORY status counts were all accepted
// as completion evidence.
// ---------------------------------------------------------------------------

{
	// NULL counts.
	const nullCounts =
		reqEvent(REC1, "pass") + "\n" +
		JSON.stringify({ kind: "complete", counts: null }) + "\n"
	const nullClassified = classifyEvents(nullCounts)
	assert(nullClassified.complete === false, "L25 a completion record with NULL counts is INCOMPLETE")
	assert(
		nullClassified.completeReasons.includes("completion_record_carries_no_counts"),
		"L25 the null-counts reason is named",
	)
	assert(decideAcceptance(nullClassified, REQUIRED_TESTS).acceptance === "FAIL", "L25 a null-counts completion is never an acceptance")

	// NO counts at all.
	const noCounts =
		reqEvent(REC1, "pass") + "\n" +
		JSON.stringify({ kind: "complete" }) + "\n"
	const noCountsClassified = classifyEvents(noCounts)
	assert(noCountsClassified.complete === false, "L25 a completion record with NO counts is INCOMPLETE")
	assert(
		noCountsClassified.completeReasons.includes("completion_record_carries_no_counts"),
		"L25 the no-counts reason is named",
	)

	// CONTRADICTORY status counts: the runner says one passed, the stream
	// carries a failure.
	const contradictory =
		reqEvent(REC1, "fail", ["ERR_TEST_FAILURE"]) + "\n" +
		JSON.stringify({
			kind: "complete",
			counts: { tests: 1, passed: 1, failed: 0, skipped: 0, todo: 0, cancelled: 0, suites: 0 },
		}) + "\n"
	const contradictoryClassified = classifyEvents(contradictory)
	assert(contradictoryClassified.complete === false, "L25 CONTRADICTORY status counts are INCOMPLETE")
	assert(
		contradictoryClassified.completeReasons.includes("count_mismatch_passed"),
		"L25 the contradictory status count is named",
	)
	assert(decideAcceptance(contradictoryClassified, REQUIRED_TESTS).acceptance === "FAIL", "L25 contradictory counts are never an acceptance")

	// INCONSISTENT total: the runner's own per-status counts do not sum
	// to its own total.
	const inconsistent =
		reqEvent(REC1, "pass") + "\n" +
		JSON.stringify({
			kind: "complete",
			counts: { tests: 5, passed: 1, failed: 0, skipped: 0, todo: 0, cancelled: 0, suites: 0 },
		}) + "\n"
	const inconsistentClassified = classifyEvents(inconsistent)
	assert(inconsistentClassified.complete === false, "L25 an INCONSISTENT total is INCOMPLETE")
	assert(
		inconsistentClassified.completeReasons.includes("runner_counts_inconsistent"),
		"L25 the inconsistent-total reason is named",
	)

	// MORE observations than the runner reported.
	const moreThanReported =
		reqEvent(REC1, "pass") + "\n" +
		reqEvent(REC2, "pass") + "\n" +
		JSON.stringify({
			kind: "complete",
			counts: { tests: 1, passed: 1, failed: 0, skipped: 0, todo: 0, cancelled: 0, suites: 0 },
		}) + "\n"
	const moreClassified = classifyEvents(moreThanReported)
	assert(moreClassified.complete === false, "L25 MORE observations than reported is INCOMPLETE")
	assert(
		moreClassified.completeReasons.includes("more_observations_than_reported"),
		"L25 the over-count reason is named",
	)

	// A RECONCILING completion record is complete.
	const reconciled = classifyEvents(log(reqEvent(REC1, "pass"), reqEvent(REC2, "pass")))
	assert(reconciled.complete === true, "L25 a RECONCILING completion record is COMPLETE")
	assert(reconciled.completeReasons.length === 0, "L25 a reconciling completion record carries no reasons")
}

// ---------------------------------------------------------------------------
// L26 — a PROTECTED DIRECTORY's mode change is a violation.
//
// The reproduced defect: `compareTrees()` compared modes only for
// NON-DIRECTORY entries, so a candidate could `chmod 700` a protected
// directory and the change was invisible.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l26-"))
	try {
		const ref = join(root, "ref")
		const ws = join(root, "ws")
		mkdirSync(join(ref, "protected"), { recursive: true })
		mkdirSync(join(ws, "protected"), { recursive: true })
		writeFileSync(join(ref, "protected", "a.ts"), "export const a = 1\n")
		writeFileSync(join(ws, "protected", "a.ts"), "export const a = 1\n")
		chmodSync(join(ws, "protected"), 0o700)

		const r = await compareTrees(ref, ws)
		const violation = r.violations.find((v) => v.kind === "MODE_CHANGED")
		assert(violation !== undefined, "L26 a protected DIRECTORY mode change is a MODE_CHANGED violation")
		assert(violation?.path === "protected", "L26 the changed directory is reported exactly")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// L27 — a nested directory named `..nested` OVERLAPS its base.
//
// The reproduced defect: `describeRootOverlap()` decided "outside" with
// `rel.startsWith("..")`, a STRING test. A directory literally named
// `..nested` produces the relative path `..nested`, which starts with
// `..` but is INSIDE the base, so the overlap was reported as disjoint.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l27-"))
	try {
		const base = join(root, "base")
		const nested = join(base, "..nested")
		mkdirSync(nested, { recursive: true })

		assert(
			(await compareTrees(base, nested)).error === "reference_root_overlaps_workspace_root",
			"L27 a `..nested` directory INSIDE the reference OVERLAPS it",
		)
		assert(
			(await compareTrees(nested, base)).error === "reference_root_overlaps_workspace_root",
			"L27 a reference INSIDE a `..nested` directory OVERLAPS it",
		)

		// A genuinely DISJOINT sibling that merely STARTS with `..` in its
		// name is NOT an overlap. The path test must not become a string
		// test in the other direction.
		const sibling = join(root, "..sibling")
		mkdirSync(sibling, { recursive: true })
		assert(
			(await compareTrees(base, sibling)).error === null,
			"L27 a DISJOINT sibling named `..sibling` does NOT overlap",
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// L28 — the fixture preparation creates its output directory ATOMICALLY.
//
// The reproduced defect: the preparation tested for existence and then
// created the directory with a separate `mkdir -p`, so two concurrent
// preparations could both pass the test and both write into the same
// directory. The directory is now created with a single `mkdir`, whose
// failure IS the refusal. No lock, no recycling.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l28-"))
	try {
		const target = join(root, "prep")
		// TWO CONCURRENT PREPARATIONS, same target.
		const script =
			`"${PREPARE}" "${REPO_ROOT}" "${BASE_COMMIT}" "${target}" --check-only & ` +
			`"${PREPARE}" "${REPO_ROOT}" "${BASE_COMMIT}" "${target}" --check-only & ` +
			`wait`
		let combined = ""
		try {
			combined = execFileSync("bash", ["-c", script], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			})
		} catch (error) {
			// One of the two refused; its non-zero status is expected.
			combined = String(error.stdout ?? "")
		}
		assert(existsSync(target), "L28 one of the concurrent preparations created the directory")
		assert(
			combined.includes("ML_SMOKE_01_PREPARE_CHECK_ONLY=YES"),
			"L28 exactly ONE concurrent preparation created the directory (the other refused)",
		)

		// A SECOND preparation against the SAME target is REFUSED, and the
		// directory's content survives.
		writeFileSync(join(target, "precious.txt"), "do not delete me\n")
		let refused = false
		try {
			execFileSync("bash", [PREPARE, REPO_ROOT, BASE_COMMIT, target, "--check-only"], { stdio: "ignore" })
		} catch {
			refused = true
		}
		assert(refused === true, "L28 a second preparation against the SAME target is REFUSED")
		assert(
			readFileSync(join(target, "precious.txt"), "utf8") === "do not delete me\n",
			"L28 the refused directory's content is NOT deleted",
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// L29 — the REAL reporter distinguishes a SUITE from a TEST.
//
// A suite's own terminal observation is a `test:pass`/`test:fail` whose
// `details.type` is `"suite"`. The runner counts suites SEPARATELY
// (`counts.suites`), so counting a suite as a test observation makes the
// completion record impossible to reconcile.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-smoke-01-l29-"))
	try {
		const testFile = join(root, "suite.test.mjs")
		writeFileSync(
			testFile,
			[
				'import test, { describe } from "node:test"',
				'import assert from "node:assert"',
				'describe("A SUITE", () => {',
				'  test("CHILD", async () => { assert.ok(true) })',
				"})",
				'test("TOP LEVEL", async () => { assert.ok(true) })',
				"",
			].join("\n"),
		)
		const run = spawnSync(
			process.execPath,
			["--test", `--test-reporter=${REPORTER}`, "suite.test.mjs"],
			{ encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "ignore"] },
		)
		const classified = classifyEvents(run.stdout ?? "")
		assert(classified.error === null, "L29 the REAL suite stream is well-formed")
		assert(classified.total === 2, "L29 the suite is NOT counted as a test observation")
		assert(classified.complete === true, "L29 the REAL suite stream RECONCILES with the runner's counts")
		assert(
			classified.tests.some((t) => t.name === "CHILD"),
			"L29 the suite's child test is present",
		)
		assert(
			!classified.tests.some((t) => t.name === "A SUITE"),
			"L29 the suite itself is not a test observation",
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

console.log("")
console.log("=== Summary ===")
console.log(`PASS=${passCount}  FAIL=${failCount}`)
process.exit(failCount > 0 ? 1 : 0)

console.log("=== Summary ===")
console.log(`PASS=${passCount}  FAIL=${failCount}`)
