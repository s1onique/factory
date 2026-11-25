/**
 * ml_smoke_01_test_reporter.mjs — a small STRUCTURED Node test reporter.
 *
 * Why not TAP
 * -----------
 * The REBOOT/CORR01 oracle parsed TAP text. That made a negative control
 * unprovable: the oracle searched the WHOLE log for a signature string, so
 * an UNRELATED test's diagnostic could satisfy the "intended failure"
 * rule. This reporter emits ONE JSON object per line, carrying the test's
 * exact identity, its status, and the CHAIN of error codes it produced.
 *
 * The chain matters. Node wraps a test failure in an `ERR_TEST_FAILURE`
 * error whose `cause` is the original error. The original error's `code`
 * is the mechanism: `ENOENT` for a missing path, `ERR_ASSERTION` for a
 * failed assertion. Both are visible in the chain, so the oracle can bind
 * a verdict to the exact mechanism rather than to a log substring.
 *
 * THE REAL NODE EVENT CONTRACT
 * -----------------------------
 * This reporter was corrected against the ACTUAL Node test-runner events
 * (Node v26.0.0), because the previous revision mis-read three of them
 * and thereby produced a FALSE ACCEPTANCE:
 *
 *   1. Node reports a SKIPPED test as a `test:pass` event whose `data.skip`
 *      is set. The value is a STRING for `t.skip("reason")` and a BOOLEAN
 *      for `t.skip()` and for `{ skip: true }`. The previous revision
 *      accepted only `typeof data.skip === "string"`, so every BOOLEAN skip
 *      was reported as a PASS.
 *   2. Node reports a TODO test as a `test:pass` event whose `data.todo` is
 *      set — again a STRING for `{ todo: "reason" }` and a BOOLEAN for
 *      `{ todo: true }`. The previous revision accepted only the string
 *      form, so `{ todo: true }` was reported as a PASS.
 *   3. Node reports a CANCELLED test as a `test:fail` event whose error
 *      carries NO `code`, NO `cause` and a stack whose first line is
 *      `AbortError: ...`. It is not distinguishable by a status flag; it
 *      must be recognised from the error's own shape.
 *
 * A FILE-LEVEL failure (the test file could not even be loaded) is
 * reported by Node as a `test:fail` event whose `data.name` is the test
 * FILE's path, not a test identity. That is how the oracle distinguishes
 * "the gate could not even load" from "a test failed".
 *
 * Output contract: NEWLINE-DELIMITED JSON on stdout, one record per line,
 * terminated by an explicit COMPLETION record.
 *
 *   {"kind":"test","name":"<test name>","status":"pass|fail|skip|todo|cancel",
 *    "codes":["ENOENT", ...],"messages":["..."],"nesting":0,"file":"<rel path>"}
 *   {"kind":"file","name":"<file path>","status":"fail", ...}
 *   {"kind":"complete","counts":{...}}      <- the LAST record, always
 *
 * The completion record is explicit evidence that the stream was not
 * truncated. The classifier REJECTS a stream that does not end with it,
 * and rejects a stream whose record count is below the runner's own test
 * count. A permissive brace scanner cannot express either guarantee.
 */

import { relative } from "node:path"

export default async function* reporter(source) {
	const root = process.cwd()
	let summary = null
	for await (const event of source) {
		const data = event.data ?? {}
		if (event.type === "test:summary") {
			// The LAST summary is the runner's overall count for the whole
			// invocation. It is the evidence the classifier cross-checks
			// the parsed record count against.
			summary = data.counts ?? null
			continue
		}
		if (event.type !== "test:pass" && event.type !== "test:fail") continue
		const record = describe(event.type === "test:pass" ? "pass" : "fail", data, root)
		yield `${JSON.stringify(record)}\n`
	}
	// The completion record is emitted LAST and ALWAYS, even when the
	// run produced no test events at all.
	yield `${JSON.stringify({ kind: "complete", counts: summary })}\n`
}

/**
 * The test file's path, RELATIVE to the runner's working directory.
 *
 * The oracle binds a required test to its EXACT relative source file.
 * An absolute path would bind the verdict to the disposable reconstruction
 * directory instead of to the fixture.
 */
function relativeFile(file, root) {
	if (typeof file !== "string" || file.length === 0) return undefined
	let rel = relative(root, file)
	if (rel.length === 0 || rel.startsWith("..")) return file
	return rel.split("\\").join("/")
}

function describe(eventStatus, data, root) {
	const file = relativeFile(data.file, root)
	const name = typeof data.name === "string" ? data.name : ""
	const record = {
		kind: "test",
		name,
		status: eventStatus,
		codes: [],
		messages: [],
		nesting: data.nesting ?? 0,
	}
	if (file !== undefined) record.file = file

	// A SUITE is not a test. Node reports a suite's own terminal
	// observation as a `test:pass`/`test:fail` whose `details.type` is
	// `"suite"`, and the runner's own summary counts suites SEPARATELY
	// (`counts.suites`), not in `counts.tests`.
	//
	// The previous revision did not distinguish a suite from a test, so a
	// run with one suite produced ONE MORE terminal observation than the
	// runner's own `counts.tests`, and the reconciliation could never
	// succeed. The suite is now reported with its own kind and excluded
	// from the test counts.
	if (data.details?.type === "suite") {
		record.kind = "suite"
	}

	// A FILE-LEVEL failure: Node names the FILE, not a test.
	if (file !== undefined && (name === file || file.endsWith(`/${name}`))) {
		record.kind = "file"
	}

	// SKIP and TODO are reported by Node on a `test:pass` event. The value
	// may be a STRING or a BOOLEAN; BOTH must be honoured.
	if (data.todo !== undefined) {
		record.status = "todo"
		record.todo = data.todo
	} else if (data.skip !== undefined) {
		record.status = "skip"
		record.skip = data.skip
	}

	const error = data.details?.error
	if (error) {
		// A CANCELLED test is a `test:fail` whose error has no `code` and
		// no `cause` and whose stack is the AbortError DOMException.
		if (isCancellation(error)) {
			record.status = "cancel"
		}
		let current = error
		const seen = new Set()
		let guard = 0
		while (current && typeof current === "object" && !seen.has(current) && guard < 32) {
			seen.add(current)
			guard += 1
			if (typeof current.code === "string") record.codes.push(current.code)
			if (typeof current.message === "string" && current.message.length > 0) {
				record.messages.push(current.message)
			}
			current = current.cause
		}
	}
	return record
}

/**
 * Recognise Node's cancellation error.
 *
 * The observed shape (Node v26.0.0): an `Error` whose own properties are
 * exactly `["stack"]`, with no `code` and no `cause`, and whose stack's
 * first line is `AbortError: This operation was aborted`. A genuine test
 * failure always carries `code: "ERR_TEST_FAILURE"` and a `cause`.
 */
function isCancellation(error) {
	if (!error || typeof error !== "object") return false
	if (typeof error.code === "string") return false
	if (error.cause !== undefined) return false
	const stack = typeof error.stack === "string" ? error.stack : ""
	return stack.startsWith("AbortError:")
}

