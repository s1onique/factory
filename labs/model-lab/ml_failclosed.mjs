/**
 * ml_failclosed.mjs — the FAIL-CLOSED invocation surface for the Model Lab
 * oracles.
 *
 * WHY THIS EXISTS
 * ---------------
 * Both oracles invoke the scope-tool and then use NUMERIC shell
 * comparisons on whatever the tool printed. An EMPTY or MALFORMED scope
 * result could therefore reach the execution path: Bash treats an invalid
 * integer comparison as a failed CONDITION, which is indistinguishable
 * from a genuine "the tool reported zero violations" verdict.
 *
 * The reproduced failure was exactly this: a controlled scope-tool
 * failure produced an empty violation count, the numeric comparison on it
 * behaved as a failed condition, and the oracle proceeded with the
 * candidate's bytes instead of halting.
 *
 * THIS MODULE IS THE FIX. It performs the invocation, and it refuses to
 * hand the oracle anything unless ALL of the following hold:
 *
 *   1. the CLI invocation EXITED SUCCESSFULLY;
 *   2. the CLI produced a NON-EMPTY payload;
 *   3. the payload is VALID STRUCTURED JSON (an object);
 *   4. the specific field the caller needs is present and, where it is a
 *      count, is a VALID NONNEGATIVE INTEGER.
 *
 * A missing, malformed or failed inspection result is a TYPED FAILURE,
 * never a value the caller can accidentally treat as "zero".
 *
 * Usage:
 *   ml_failclosed.mjs scope  <tool.mjs> <reference_dir> <workspace_dir> <allowed_csv> [exempt_csv]
 *   ml_failclosed.mjs json   <tool.mjs> <command> [args...]   (payload on STDIN)
 *
 * Output contract (machine-readable):
 *   FC_STATUS=OK|FAILED|MALFORMED
 *   FC_ERROR=<code>
 *   FC_VIOLATIONS=<n>       (scope only; present only when FC_STATUS=OK)
 *   FC_ERROR_CODE=<code>    (scope only; the scope tool's own error field)
 *   FC_OUTPUT=<payload>     (json only; the validated payload)
 *
 * Exit code: 0 on OK, 3 on a FAILED invocation, 4 on a MALFORMED payload.
 */

import { spawnSync } from "node:child_process"

const [mode, ...rest] = process.argv.slice(2)

/** Print the failure contract and exit non-zero. */
function fail(status, error) {
	process.stdout.write(`FC_STATUS=${status}\n`)
	process.stdout.write(`FC_ERROR=${error}\n`)
	process.exit(status === "FAILED" ? 3 : 4)
}

/** Is this a valid nonnegative integer? */
function isCount(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0
}

if (mode === "scope") {
	const [tool, referenceDir, workspaceDir, allowedCsv = "", exemptCsv = ""] = rest
	if (!tool || !referenceDir || !workspaceDir) {
		fail("FAILED", "scope_invocation_arguments_missing")
	}
	const args = ["scope", referenceDir, workspaceDir, allowedCsv]
	if (exemptCsv.length > 0) args.push(exemptCsv)
	const run = spawnSync(process.execPath, [tool, ...args], { encoding: "utf8" })
	const status = run.status === null ? 2 : run.status
	if (status !== 0) {
		// The CLI itself FAILED. This is an evaluator-side failure, not a
		// candidate verdict.
		fail("FAILED", `scope_tool_exited_${status}`)
	}
	const payload = (run.stdout ?? "").trim()
	if (payload.length === 0) {
		fail("FAILED", "scope_tool_produced_no_output")
	}
	let parsed
	try {
		parsed = JSON.parse(payload)
	} catch {
		fail("MALFORMED", "scope_tool_output_is_not_json")
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		fail("MALFORMED", "scope_tool_output_is_not_an_object")
	}
	const scopeError = parsed.error
	if (typeof scopeError === "string" && scopeError.length > 0) {
		// The comparison itself was unusable (a self-comparison, an
		// overlapping root, an enumeration failure). This is a HALT for
		// the caller, not a violation count.
		process.stdout.write("FC_STATUS=FAILED\n")
		process.stdout.write(`FC_ERROR=scope_comparison_unusable\n`)
		process.stdout.write(`FC_ERROR_CODE=${scopeError}\n`)
		process.exit(3)
	}
	if (!Array.isArray(parsed.violations)) {
		fail("MALFORMED", "scope_tool_output_carries_no_violations_array")
	}
	const violations = parsed.violations.length
	if (!isCount(violations)) {
		fail("MALFORMED", "scope_violation_count_is_not_a_nonnegative_integer")
	}
	process.stdout.write("FC_STATUS=OK\n")
	process.stdout.write("FC_ERROR=\n")
	process.stdout.write(`FC_ERROR_CODE=\n`)
	process.stdout.write(`FC_VIOLATIONS=${violations}\n`)
	process.stdout.write(`FC_OUTPUT=${payload}\n`)
	process.exit(0)
}

if (mode === "json") {
	const [tool, command, ...args] = rest
	if (!tool || !command) {
		fail("FAILED", "json_invocation_arguments_missing")
	}
	let payload = ""
	for await (const chunk of process.stdin) payload += chunk
	const run = spawnSync(process.execPath, [tool, command, ...args], {
		input: payload,
		encoding: "utf8",
	})
	const status = run.status === null ? 2 : run.status
	if (status !== 0) {
		fail("FAILED", `tool_exited_${status}`)
	}
	const output = (run.stdout ?? "").trim()
	if (output.length === 0) {
		fail("FAILED", "tool_produced_no_output")
	}
	let parsed
	try {
		parsed = JSON.parse(output)
	} catch {
		fail("MALFORMED", "tool_output_is_not_json")
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		fail("MALFORMED", "tool_output_is_not_an_object")
	}
	process.stdout.write("FC_STATUS=OK\n")
	process.stdout.write("FC_ERROR=\n")
	process.stdout.write(`FC_OUTPUT=${output}\n`)
	process.exit(0)
}

process.stderr.write("usage: ml_failclosed.mjs scope|json ...\n")
process.exit(2)
