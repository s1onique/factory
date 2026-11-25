import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { NativeControlSeamClient } from "./ml_02_client.mjs"
import {
	DEFAULT_DEADLINE_SECONDS,
	ML06A_ALLOWED_PATH,
	ML06A_BASE_COMMIT,
	ML06A_CONTRACT_VERSION,
	ML06A_TASK_TEXT,
	RUNNER_CONTRACT_VERSION,
	collectEvents,
	collectIdentities,
	establishQuiescence,
	evaluateDeliverable,
	executeExperiment,
	nowMs,
	readAttempt,
	sha256,
	taskTextDigest,
	verifyReadiness,
	writeBundle,
} from "./ml_02_runner.mjs"

const [command, ...rest] = process.argv.slice(2)

/** Print a JSON object and exit 0. */
function emit(value) {
	process.stdout.write(JSON.stringify(value, null, 2) + "\n")
}

/** Print a typed blocker and exit 2. */
function emitBlocker(blockerValue) {
	process.stdout.write(JSON.stringify(blockerValue, null, 2) + "\n")
	process.exit(2)
}

/** Parse `--key value` arguments. */
function parseFlags(args) {
	const flags = {}
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (!arg.startsWith("--")) continue
		const key = arg.slice(2)
		const next = args[index + 1]
		if (next === undefined || next.startsWith("--")) {
			flags[key] = true
		} else {
			flags[key] = next
			index += 1
		}
	}
	return flags
}

/** The Node runtime, resolved EXPLICITLY. */
function resolveNode(flags) {
	if (typeof flags.node === "string" && flags.node.length > 0) return flags.node
	const candidates = ["/opt/homebrew/bin/node", process.execPath]
	for (const candidate of candidates) {
		if (candidate && existsSync(candidate)) return candidate
	}
	return process.execPath
}

/** The repository root, resolved from this file's own location. */
function repoRootFromHere() {
	return resolve(dirname(new URL(import.meta.url).pathname), "..", "..")
}

const flags = parseFlags(rest)
const repoRoot = typeof flags.repo === "string" ? resolve(flags.repo) : repoRootFromHere()
const nodeBin = resolveNode(flags)

/** Run the fixture preparation. */
function prepareFixture(prepare, root, baseCommit, outDir) {
	return spawnSync("bash", [prepare, root, baseCommit, outDir], { encoding: "utf8" })
}

/** Materialize the independent reference by copying the workspace. */
function materializeReference(destination, source) {
	const tar = spawnSync("tar", ["-cf", "-", "-C", source, "."], { encoding: "buffer" })
	if (tar.status !== 0) return { status: 1 }
	return spawnSync("tar", ["-xf", "-", "-C", destination], { input: tar.stdout })
}

/** Build a native client for the control seam. */
function seamClient(seamDir) {
	return new NativeControlSeamClient({
		seamDir,
		readToken: readFileSync(join(seamDir, "token"), "utf8").trim(),
		writeToken: existsSync(join(seamDir, "write-token"))
			? readFileSync(join(seamDir, "write-token"), "utf8").trim()
			: undefined,
	})
}

switch (command) {
	case "prepare": {
		// Materialize the fixture and freeze the experiment identity.
		const outDir = typeof flags.out === "string" ? resolve(flags.out) : undefined
		if (!outDir) emitBlocker({ ok: false, blocker: { code: "missing_out_dir", message: "--out <dir> is required" } })
		const runId = typeof flags.runId === "string" ? flags.runId : `ml02-${Date.now()}`
		const prep = prepareFixture(join(repoRoot, "labs/model-lab/prepare_ml_06a.sh"), repoRoot, ML06A_BASE_COMMIT, outDir)
		if (prep.status !== 0) {
			emitBlocker({
				ok: false,
				blocker: {
					code: "fixture_preparation_failed",
					message: "The fixture preparation did not succeed.",
					stderr: prep.stderr?.toString() ?? "",
				},
			})
		}
		const workspace = join(outDir, "workspace")
		const referenceDir = join(outDir, "reference")
		mkdirSync(referenceDir, { recursive: true })
		const copy = materializeReference(referenceDir, workspace)
		if (copy.status !== 0) {
			emitBlocker({
				ok: false,
				blocker: { code: "reference_materialization_failed", message: "The independent reference could not be materialized." },
			})
		}
		const identities = await collectIdentities({
			repoRoot,
			workspace,
			referenceDir,
			evaluatorDeps: join(repoRoot, "labs/long-horizon-harness/node_modules"),
			nodeBin,
		})
		const manifest = {
			runnerContractVersion: RUNNER_CONTRACT_VERSION,
			fixtureContractVersion: ML06A_CONTRACT_VERSION,
			runId,
			baseCommit: ML06A_BASE_COMMIT,
			allowedPath: ML06A_ALLOWED_PATH,
			workspace,
			referenceDir,
			referenceDigest: identities.independentReference.historicalDigestV1,
			referenceVersionedDigest: identities.independentReference.versionedDigest,
			taskText: ML06A_TASK_TEXT,
			taskTextDigest: taskTextDigest(),
			identities,
			preparedAtEpochMs: nowMs(),
		}
		manifest.identityDigest = sha256(
			JSON.stringify(manifest.identities) + manifest.taskTextDigest + manifest.referenceDigest,
		)
		writeFileSync(join(outDir, "experiment.json"), JSON.stringify(manifest, null, 2) + "\n")
		emit({
			ok: true,
			disposition: "PREPARED",
			runId,
			outDir,
			manifestPath: join(outDir, "experiment.json"),
			identityDigest: manifest.identityDigest,
		})
		break
	}

	case "verify": {
		// READ-ONLY readiness. NEVER a start probe.
		const seamDir = typeof flags.seam === "string" ? flags.seam : undefined
		if (!seamDir) emitBlocker({ ok: false, blocker: { code: "missing_seam_dir", message: "--seam <dir> is required" } })
		const client = seamClient(seamDir)
		const readiness = await verifyReadiness({
			client,
			expectedWorkspace: typeof flags.workspace === "string" ? resolve(flags.workspace) : undefined,
			expectedExtensionVersion: typeof flags.extension === "string" ? flags.extension : undefined,
		})
		if (!readiness.ok) emitBlocker({ ...readiness, startCalls: 0 })
		emit({ ok: true, disposition: "READY", ...readiness, startCalls: 0 })
		break
	}

	case "execute": {
		// EXACTLY ONE explicitly authorized experiment.
		const manifestPath = typeof flags.manifest === "string" ? resolve(flags.manifest) : undefined
		const authorizationPath = typeof flags.authorization === "string" ? resolve(flags.authorization) : undefined
		if (!manifestPath || !existsSync(manifestPath)) {
			emitBlocker({ ok: false, blocker: { code: "missing_manifest", message: "--manifest <experiment.json> is required" } })
		}
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
		if (!authorizationPath || !existsSync(authorizationPath)) {
			// NO authorization means ZERO start calls.
			emitBlocker({
				ok: false,
				blocker: {
					code: "missing_authorization",
					message: "Real execution requires an explicit operator authorization bound to this exact experiment.",
					startCalls: 0,
				},
			})
		}
		const authorization = JSON.parse(readFileSync(authorizationPath, "utf8"))
		if (authorization.runId !== manifest.runId || authorization.identityDigest !== manifest.identityDigest) {
			emitBlocker({
				ok: false,
				blocker: {
					code: "authorization_identity_mismatch",
					message: "The authorization does not bind this exact prepared experiment.",
					startCalls: 0,
				},
			})
		}
		const seamDir = typeof flags.seam === "string" ? flags.seam : undefined
		if (!seamDir) {
			emitBlocker({ ok: false, blocker: { code: "missing_seam_dir", message: "--seam <dir> is required", startCalls: 0 } })
		}
		const client = seamClient(seamDir)
		const readiness = await verifyReadiness({
			client,
			expectedWorkspace: manifest.workspace,
			expectedExtensionVersion: typeof flags.extension === "string" ? flags.extension : undefined,
		})
		if (!readiness.ok) emitBlocker({ ...readiness, startCalls: 0 })
		const started = nowMs()
		const execution = await executeExperiment({
			client,
			claimsRoot: join(manifest.workspace, "..", "claims"),
			runId: manifest.runId,
			requestId: `ml02-${manifest.runId}`,
			prompt: manifest.taskText,
			expectedWorkspace: manifest.workspace,
			workspace: manifest.workspace,
			deadlineSeconds: typeof flags.deadline === "string" ? Number(flags.deadline) : DEFAULT_DEADLINE_SECONDS,
		})
		if (!execution.ok) {
			emit({
				ok: false,
				disposition: execution.disposition,
				reason: execution.reason,
				note: execution.note,
				startCalls: 1,
				elapsedMs: nowMs() - started,
			})
			process.exit(1)
		}
		emit({
			ok: true,
			disposition: "STARTED",
			runId: manifest.runId,
			sessionId: execution.sessionId,
			startCalls: 1,
			elapsedMs: nowMs() - started,
		})
		break
	}

	case "evaluate": {
		const manifestPath = typeof flags.manifest === "string" ? resolve(flags.manifest) : undefined
		if (!manifestPath || !existsSync(manifestPath)) {
			emitBlocker({ ok: false, blocker: { code: "missing_manifest", message: "--manifest <experiment.json> is required" } })
		}
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
		const seamDir = typeof flags.seam === "string" ? flags.seam : undefined
		const client = seamDir === undefined ? undefined : seamClient(seamDir)
		let events = { events: [], error: "no_seam", complete: false, pages: 0 }
		let quiescence = { quiescent: false, observations: [] }
		if (client) {
			const attempt = readAttempt(join(manifest.workspace, "..", "claims", manifest.runId))
			const sessionId = attempt?.sessionId
			if (sessionId) {
				events = await collectEvents(client, sessionId)
				quiescence = await establishQuiescence({
					client,
					sessionId,
					workspace: manifest.workspace,
					allowedPath: manifest.allowedPath,
				})
			}
		}
		if (!quiescence.quiescent) {
			// Uncertain termination PREVENTS evaluation.
			emit({
				ok: false,
				disposition: "NOT_EVALUATED",
				reason: "quiescence_not_established",
				note: "A potentially changing workspace is never evaluated.",
				quiescence,
			})
			process.exit(1)
		}
		const workDir = join(manifest.workspace, "..", "work")
		mkdirSync(workDir, { recursive: true })
		const evaluation = await evaluateDeliverable({
			repoRoot,
			referenceDir: manifest.referenceDir,
			workspace: manifest.workspace,
			allowedPath: manifest.allowedPath,
			expectedReferenceDigest: manifest.referenceDigest,
			nodeBin,
			workDir,
		})
		const bundleDir =
			typeof flags.bundle === "string" ? resolve(flags.bundle) : join(manifest.workspace, "..", "bundle")
		const bundleFiles = {
			"manifest.json": {
				runnerContractVersion: RUNNER_CONTRACT_VERSION,
				fixtureContractVersion: ML06A_CONTRACT_VERSION,
				runId: manifest.runId,
				identityDigest: manifest.identityDigest,
				taskTextDigest: manifest.taskTextDigest,
				referenceDigest: manifest.referenceDigest,
			},
			"events.json": {
				events: events.events,
				error: events.error,
				complete: events.complete,
				pages: events.pages,
			},
			"quiescence.json": quiescence,
			"evaluation.json": {
				disposition: evaluation.disposition ?? "UNKNOWN",
				acceptance: evaluation.acceptance ?? "UNKNOWN",
				scopeViolations: evaluation.scopeViolations ?? null,
				deliverable: evaluation.deliverable ?? null,
				referenceDigest: evaluation.referenceDigest ?? null,
			},
		}
		if (evaluation.patch?.text) bundleFiles["candidate.patch"] = evaluation.patch.text
		writeBundle(bundleDir, bundleFiles)
		emit({
			ok: evaluation.ok === true,
			disposition: evaluation.disposition ?? "UNKNOWN",
			acceptance: evaluation.acceptance ?? "UNKNOWN",
			bundleDir,
			events: events.events.length,
			eventsComplete: events.complete,
		})
		break
	}

	case "inspect": {
		const bundleDir = typeof flags.bundle === "string" ? resolve(flags.bundle) : undefined
		if (!bundleDir || !existsSync(bundleDir)) {
			emitBlocker({ ok: false, blocker: { code: "missing_bundle", message: "--bundle <dir> is required" } })
		}
		const manifest = existsSync(join(bundleDir, "manifest.json"))
			? JSON.parse(readFileSync(join(bundleDir, "manifest.json"), "utf8"))
			: null
		const evaluation = existsSync(join(bundleDir, "evaluation.json"))
			? JSON.parse(readFileSync(join(bundleDir, "evaluation.json"), "utf8"))
			: null
		emit({ ok: true, bundleDir, manifest, evaluation })
		break
	}

	default:
		process.stderr.write(
			[
				"usage: ml_02_cli.mjs <prepare|verify|execute|evaluate|inspect> [flags]",
				"",
				"  prepare  --out <dir> [--run-id <id>]",
				"  verify   --seam <dir> [--workspace <dir>] [--extension <version>]",
				"  execute  --manifest <experiment.json> --authorization <auth.json> --seam <dir> [--deadline <s>]",
				"  evaluate --manifest <experiment.json> --seam <dir> [--bundle <dir>]",
				"  inspect  --bundle <dir>",
				"",
			].join("\n"),
		)
		process.exit(2)
}
