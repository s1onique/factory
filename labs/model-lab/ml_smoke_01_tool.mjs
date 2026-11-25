/**
 * ml_smoke_01_tool.mjs — the command-line surface of the ML-SMOKE-01
 * decision logic.
 *
 * The oracle (`ml_smoke_01_acceptance_oracle.sh`) is orchestration; every
 * decision it makes lives in `ml_smoke_01_lib.mjs`. This tool is the thin
 * bridge between them, so the shell never has to embed JavaScript.
 *
 * It is also the seam the cheap regression controls use to exercise the
 * decision logic with SYNTHETIC inputs — no fixture execution, no seconds.
 *
 * Usage:
 *   ml_smoke_01_tool.mjs digest <dir>
 *   ml_smoke_01_tool.mjs scope <reference_dir> <workspace_dir> [allowed_csv]
 *   ml_smoke_01_tool.mjs classify <event_log>
 *   ml_smoke_01_tool.mjs accept <event_log>
 *   ml_smoke_01_tool.mjs mutate-decide <event_log> <required_test_name> [code]
 *   ml_smoke_01_tool.mjs apply-mutation <file>
 *   ml_smoke_01_tool.mjs validate-allowed <reference_file> <candidate_file>
 *
 * Every command prints one JSON object on stdout, except `digest`, which
 * prints the bare digest, and `apply-mutation`, which prints the JSON
 * result of the mutation.
 */

import { readFile, writeFile } from "node:fs/promises"

import {
	ALLOWED_PATHS,
	ML06A_OBSERVATIONS,
	ML06A_REQUIRED_TESTS,
	REQUIRED_SOCK_TESTS,
	REQUIRED_TESTS,
	TREE_MANIFEST_VERSION,
	applyKnownBadMutation,
	classifyEvents,
	compareTrees,
	decideAcceptance,
	decideMutation,
	digestOfDirectory,
	digestOfDirectoryVersioned,
	findRequiredTest,
	treeManifest,
	validateAllowedRegion,
} from "./ml_smoke_01_lib.mjs"

const [command, ...rest] = process.argv.slice(2)

/**
 * Read a JSON payload. The payload is given as an argument when it is
 * short, and on STDIN when it is long. STDIN is the rule for anything the
 * shell would otherwise have to quote.
 */
async function readJson(argument) {
	if (argument !== undefined && argument !== "-") return argument
	let buffer = ""
	for await (const chunk of process.stdin) buffer += chunk
	return buffer.trim()
}

switch (command) {
	case "digest": {
		process.stdout.write(await digestOfDirectory(rest[0]))
		process.stdout.write("\n")
		break
	}
	case "digest-v2": {
		// The EXPLICITLY VERSIONED tree-manifest digest. It is a
		// DIFFERENT identity from the historical `v1` digest and is never
		// compared with one.
		process.stdout.write(await digestOfDirectoryVersioned(rest[0]))
		process.stdout.write("\n")
		break
	}
	case "manifest": {
		process.stdout.write(JSON.stringify(await treeManifest(rest[0])) + "\n")
		break
	}
	case "manifest-version": {
		process.stdout.write(TREE_MANIFEST_VERSION + "\n")
		break
	}
	case "scope": {
		const allowed = rest[2] ? rest[2].split(",").filter(Boolean) : ALLOWED_PATHS
		const exempt = rest[3] ? rest[3].split(",").filter(Boolean) : []
		const result = await compareTrees(rest[0], rest[1], { allowedPaths: allowed, exemptDependencyPaths: exempt })
		process.stdout.write(JSON.stringify(result))
		process.stdout.write("\n")
		break
	}
	case "classify": {
		const classified = classifyEvents(await readFile(rest[0], "utf8"))
		const unavailable = classified.fileError || classified.total === 0
		process.stdout.write(
			[
				`PASSED=${classified.counts.passed}`,
				`FAILED=${classified.counts.failed}`,
				`SKIPPED=${classified.counts.skipped}`,
				`TODO=${classified.counts.todo}`,
				`CANCELLED=${classified.counts.cancelled}`,
				`UNAVAILABLE=${unavailable ? 1 : 0}`,
				`STREAM_ERROR=${classified.error ?? ""}`,
				`STREAM_COMPLETE=${classified.complete ? 1 : 0}`,
				`STREAM_COMPLETE_REASONS=${(classified.completeReasons ?? []).join(",")}`,
			].join("\n") + "\n",
		)
		break
	}
	case "classify-json": {
		// The STRUCTURED form of `classify`, for the fail-closed
		// invocation surface. The shell oracles must be able to consume a
		// JSON object and validate its fields, not a free-text block.
		const classified = classifyEvents(await readFile(rest[0], "utf8"))
		const unavailable = classified.fileError || classified.total === 0
		process.stdout.write(
			JSON.stringify({
				counts: classified.counts,
				fileError: classified.fileError,
				total: classified.total,
				expectedTotal: classified.expectedTotal ?? null,
				unavailable,
				error: classified.error ?? null,
				complete: classified.complete,
				completeReasons: classified.completeReasons ?? [],
			}) + "\n",
		)
		break
	}
	case "scope-error": {
		process.stdout.write(String(JSON.parse(await readJson(rest[0])).error ?? ""))
		process.stdout.write("\n")
		break
	}
	case "scope-violations": {
		process.stdout.write(String(JSON.parse(await readJson(rest[0])).violations.length))
		process.stdout.write("\n")
		break
	}
	case "scope-lines": {
		for (const v of JSON.parse(await readJson(rest[0])).violations) {
			process.stdout.write(`SCOPE_VIOLATION ${v.kind} ${v.path}\n`)
		}
		break
	}
	case "reasons": {
		for (const r of JSON.parse(await readJson(rest[0])).reasons) {
			process.stdout.write(`${r}\n`)
		}
		break
	}
	case "field": {
		// `field <json> <key>` — read one field of a JSON object.
		//
		// The key may be a DOT-SEPARATED PATH (`counts.passed`), so the
		// structured classification payload can be consumed without
		// embedding JavaScript in the shell.
		const parsed = JSON.parse(await readJson(rest[0]))
		let current = parsed
		for (const segment of String(rest[1] ?? "").split(".")) {
			if (current === null || current === undefined) break
			current = current[segment]
		}
		process.stdout.write(String(current ?? ""))
		process.stdout.write("\n")
		break
	}
	case "has": {
		// `has <json> <key>` — exit 0 when the JSON object has a truthy key.
		const value = JSON.parse(await readJson(rest[0]))[rest[1]]
		process.exit(value ? 0 : 1)
	}
	case "accept": {
		const classified = classifyEvents(await readFile(rest[0], "utf8"))
		const processExit = rest[1] === undefined ? 0 : Number(rest[1])
		const decision = decideAcceptance(classified, REQUIRED_TESTS, {
			processExit,
			additionalRequired: rest[2] === "with-sock" ? REQUIRED_SOCK_TESTS : [],
		})
		process.stdout.write(JSON.stringify(decision))
		process.stdout.write("\n")
		break
	}
	case "accept-ml06a": {
		const classified = classifyEvents(await readFile(rest[0], "utf8"))
		const processExit = rest[1] === undefined ? 0 : Number(rest[1])
		const decision = decideAcceptance(classified, ML06A_REQUIRED_TESTS, {
			processExit,
		})
		process.stdout.write(JSON.stringify(decision))
		process.stdout.write("\n")
		break
	}
	case "observe-ml06a": {
		const classified = classifyEvents(await readFile(rest[0], "utf8"))
		const observations = []
		for (const observation of ML06A_OBSERVATIONS) {
			const found = findRequiredTest(classified, observation)
			observations.push({
				label: observation.label,
				outcome: found.outcome,
				status: found.status ?? "ABSENT",
			})
		}
		process.stdout.write(
			JSON.stringify({
				observations,
				reasons: observations
					.filter((o) => o.outcome !== "ok" || o.status !== "pass")
					.map((o) => `${o.label} ${o.outcome === "ok" ? o.status.toUpperCase() : o.outcome.toUpperCase()}`),
			}) + "\n",
		)
		break
	}
	case "observation-status": {
		const report = JSON.parse(await readJson(rest[0]))
		const found = (report.observations ?? []).find((o) => o.label === rest[1])
		process.stdout.write(String(found?.status ?? "ABSENT"))
		process.stdout.write("\n")
		break
	}
	case "mutate-decide": {
		const classified = classifyEvents(await readFile(rest[0], "utf8"))
		const processExit = rest[3] === undefined ? undefined : Number(rest[3])
		const decision = decideMutation(classified, rest[1], rest[2] ?? "ENOENT", {
			requiredFile: REQUIRED_TESTS[0].file,
			processExit,
		})
		process.stdout.write(JSON.stringify(decision))
		process.stdout.write("\n")
		break
	}
	case "apply-mutation": {
		const text = await readFile(rest[0], "utf8")
		const result = applyKnownBadMutation(text)
		if (result.applied) await writeFile(rest[0], result.text)
		process.stdout.write(JSON.stringify({ applied: result.applied }))
		process.stdout.write("\n")
		break
	}
	case "validate-allowed": {
		const reference = await readFile(rest[0], "utf8")
		const candidate = await readFile(rest[1], "utf8")
		process.stdout.write(JSON.stringify(validateAllowedRegion(reference, candidate)))
		process.stdout.write("\n")
		break
	}
	default:
		process.stderr.write(`unknown command: ${command}\n`)
		process.exit(2)
}
