/**
 * ml_02_runner.mjs — the deterministic Model Lab runner (ACT ML-02).
 *
 * WHAT THIS IS
 * ------------
 * The smallest deterministic software that executes ONE authorized
 * experiment against ONE qualified fixture (ML-06A) through the ACTUAL
 * native ClineMM control seam, collects the candidate's deliverable,
 * evaluates it INDEPENDENTLY, and records one machine-readable run
 * bundle.
 *
 * It is deterministic software, NOT an LLM-dependent orchestrator: every
 * decision it makes is a pure function over recorded observations, and
 * every step is bounded.
 *
 * WHAT IT IS NOT
 * --------------
 *   - it is not a general benchmark framework;
 *   - it is not a service, a daemon, a database or a message bus;
 *   - it does not implement an MCP server;
 *   - it does not modify the frozen long-horizon adapters.
 *
 * THE FIVE LOGICAL CAPABILITIES
 * -----------------------------
 *   prepare   — materialize the fixture and freeze the experiment identity
 *   verify    — check readiness WITHOUT inference
 *   execute   — execute EXACTLY ONE explicitly authorized experiment
 *   evaluate  — collect the deliverable and evaluate it independently
 *   inspect   — inspect the resulting run bundle
 *
 * THE AUTHORITY HIERARCHY
 * -----------------------
 *   1. the ORACLE (`ml_06a_acceptance_oracle.sh`) is the ONLY authority
 *      that may declare a candidate result correct;
 *   2. the RUNNER records observations and binds identities; it never
 *      re-implements a verdict;
 *   3. the CANDIDATE's own statement of success is an observation, never
 *      an acceptance.
 */

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

import { digestOfDirectory, digestOfDirectoryVersioned } from "./ml_smoke_01_lib.mjs"

export { digestOfDirectory, digestOfDirectoryVersioned }

/** The runner's OWN contract version. */
export const RUNNER_CONTRACT_VERSION = "model-lab-runner/v1"

/** The ML-06A experimental contract version. */
export const ML06A_CONTRACT_VERSION = "ml-06a-contract/v1"

/** The historical base commit of the ML-06A fixture. */
export const ML06A_BASE_COMMIT = "0bd72f4b97486b9b95cbb75e7e384586d03aa22f"

/** The historical known-good revision. It is NOT disclosed to the candidate. */
export const ML06A_KNOWN_GOOD_COMMIT = "5b7508fa09e6f10b6ec683e94a35758a15f9d827"

/** The ONE production file the candidate may edit. */
export const ML06A_ALLOWED_PATH = "labs/long-horizon-harness/src/subject/subject-json.ts"

/** The default candidate deadline, in seconds. */
export const DEFAULT_DEADLINE_SECONDS = 300

/** A monotonic clock, in milliseconds. */
export function nowMs() {
	return Number(process.hrtime.bigint() / 1000000n)
}

/** The SHA-256 of a string or a buffer. */
export function sha256(value) {
	return createHash("sha256").update(value).digest("hex")
}

/** The SHA-256 of a file's bytes. */
export function sha256File(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/**
 * A TYPED BLOCKER.
 *
 * The runner never guesses and never falls back. When a precondition
 * cannot be established, it returns a typed blocker that names the exact
 * necessary operator action.
 */
export function blocker(code, message, detail = {}) {
	return { ok: false, blocker: { code, message, ...detail } }
}

/**
 * The atomic CLAIM mechanism for a single experiment authorization.
 *
 * Two runner processes must never consume the SAME experiment
 * authorization. The claim is a directory created with a single `mkdir`
 * (which fails if it exists): the creation IS the atomic operation, and
 * its failure IS the refusal.
 *
 * The claim is bound to the EXACT run identity: the claim directory's
 * name is the run id.
 */
export function claimExperiment(claimsRoot, runId) {
	const claimPath = join(claimsRoot, runId)
	try {
		mkdirSync(claimsRoot, { recursive: true })
	} catch {
		// The claims root may already exist.
	}
	try {
		mkdirSync(claimPath, { recursive: false })
	} catch (cause) {
		return { claimed: false, claimPath, reason: `claim_directory_exists:${cause?.code ?? "unknown"}` }
	}
	return { claimed: true, claimPath }
}

/**
 * RECORD the attempt BEFORE the mutating request is sent.
 *
 * A restart of the runner must not silently authorize another start for
 * the same experiment: the attempt record is what makes an uncertain prior
 * attempt discoverable.
 */
export function recordAttempt(claimPath, attempt) {
	const attemptPath = join(claimPath, "attempt.json")
	writeFileSync(attemptPath, JSON.stringify(attempt, null, 2) + "\n")
	return attemptPath
}

/**
 * The FROZEN candidate-visible task text for ML-06A, contract V1.
 *
 * The text is the symptom-oriented description from the ML-06A
 * qualification, extended with the explicit experimental-contract
 * statements the ACT requires. It does NOT disclose the historical
 * solution, the known-good revision, the evaluator-only tests, the
 * qualification evidence, the alternative-fix control, or any supervisory
 * interface.
 */
export const ML06A_TASK_TEXT = [
	"The subject-manifest trust boundary rejects some manifests that are perfectly legal.",
	"",
	"A manifest may legitimately reuse the SAME nested object in more than one place — for example a configuration that references one shared options object from two different sections. Today such a manifest is refused with a \"cyclic value is not a JsonValue\" error, even though it contains no cycle at all.",
	"",
	"A manifest that genuinely contains a recursive back-edge (an object that contains itself, directly or indirectly) must still be refused.",
	"",
	"Fix the validator so that only true recursive back-edges are refused.",
	"",
	"## What you may change",
	"",
	`- The ENTIRE file \`${ML06A_ALLOWED_PATH}\` is editable. You may rewrite it however you like.`,
	"- Every other source file, every existing test file, every manifest and every lockfile in this workspace is PROTECTED. Do not modify them.",
	"",
	"## What you may run",
	"",
	"- The existing local tests may be executed. They are a legitimate way to observe the current behaviour.",
	"- The designated dependency directory and the designated scratch directory are available for ordinary local verification. The dependency directory is already populated; do NOT install packages from the network.",
	"- Network package installation is PROHIBITED for this experiment. Do not run `npm ci`, `npm install`, or any other network fetch.",
	"",
	"## What must be preserved",
	"",
	"- The existing invalid-value rejection behaviour must be preserved: unsupported value types and non-finite numbers are still refused.",
	"- The public return semantics must be preserved: on success the returned value is the same reference as the input.",
	"- Input objects must NOT be reshaped. The validator must not modify, clone or normalise its input.",
	"",
	"## Scope",
	"",
	"- Files outside the designated workspace must not be accessed or modified for task completion.",
	"- You have no network package installation. Work with what is already present.",
	"",
].join("\n")

/** The SHA-256 of the frozen candidate-visible task text. */
export function taskTextDigest(text = ML06A_TASK_TEXT) {
	return createHash("sha256").update(text, "utf8").digest("hex")
}

/**
 * The DELIVERABLE capture.
 *
 * The runner captures ONLY the permitted production path. The captured
 * BYTES are the bytes that entered the recorded patch and the bytes the
 * evaluator receives: the deliverable is never re-read from the mutable
 * candidate workspace at a later stage.
 */
export function captureDeliverable(workspace, allowedPath) {
	const absolute = join(workspace, allowedPath)
	if (!existsSync(absolute)) {
		return { ok: false, reason: "allowed_path_absent", path: allowedPath }
	}
	const bytes = readFileSync(absolute)
	return { ok: true, path: allowedPath, bytes, sha256: sha256(bytes), size: bytes.length }
}

/** Is an experiment already attempted? */
export function readAttempt(claimPath) {
	const attemptPath = join(claimPath, "attempt.json")
	if (!existsSync(attemptPath)) return undefined
	try {
		return JSON.parse(readFileSync(attemptPath, "utf8"))
	} catch {
		return { error: "attempt_record_unreadable" }
	}
}

/**
 * The DELIVERABLE PATCH.
 *
 * A unified diff between the reference's copy of the allowed path and the
 * CAPTURED BYTES. The diff is produced from two temporary files, so the
 * patch's content is a function of the captured bytes alone.
 */
export function buildPatch(referenceFile, deliverable, workDir) {
	const a = join(workDir, "patch-a.ts")
	const b = join(workDir, "patch-b.ts")
	writeFileSync(a, readFileSync(referenceFile))
	writeFileSync(b, deliverable.bytes)
	const diff = spawnSync("diff", ["-u", "--label", `a/${deliverable.path}`, "--label", `b/${deliverable.path}`, a, b], {
		encoding: "utf8",
	})
	const patch = diff.stdout ?? ""
	return {
		ok: diff.status === 1,
		patch,
		sha256: sha256(patch),
		size: patch.length,
		note: diff.status === 1 ? "the deliverable differs from the reference" : "the deliverable is identical to the reference",
	}
}

/**
 * The IDENTITIES of one prepared experiment.
 *
 * Every identity the ACT requires is recorded BEFORE the candidate runs.
 */
export async function collectIdentities({ repoRoot, workspace, referenceDir, evaluatorDeps, nodeBin }) {
	const lockfile = join(repoRoot, "labs/long-horizon-harness/package-lock.json")
	const candidateLock = join(workspace, "labs/long-horizon-harness/package-lock.json")
	let nodeVersion = null
	try {
		nodeVersion = spawnSync(nodeBin, ["--version"], { encoding: "utf8" }).stdout?.trim() ?? null
	} catch {
		nodeVersion = null
	}
	return {
		fixture: {
			baseCommit: ML06A_BASE_COMMIT,
			knownGoodCommit: ML06A_KNOWN_GOOD_COMMIT,
			overlay: "none",
			allowedPath: ML06A_ALLOWED_PATH,
		},
		initialCandidateTree: {
			historicalDigestV1: await digestOfDirectory(workspace),
			versionedDigest: await digestOfDirectoryVersioned(workspace),
			manifestVersion: "ml-tree-manifest/v2",
		},
		independentReference: {
			historicalDigestV1: await digestOfDirectory(referenceDir),
			versionedDigest: await digestOfDirectoryVersioned(referenceDir),
		},
		candidateDependency: {
			path: "labs/long-horizon-harness/node_modules",
			present: existsSync(join(workspace, "labs/long-horizon-harness/node_modules")),
			lockfileSha256: existsSync(candidateLock) ? sha256File(candidateLock) : null,
			toolchain: { node: nodeBin, nodeVersion },
		},
		evaluatorDependency: {
			path: evaluatorDeps,
			present: existsSync(evaluatorDeps),
			lockfileSha256: existsSync(lockfile) ? sha256File(lockfile) : null,
			toolchain: { node: nodeBin, nodeVersion },
		},
	}
}

/**
 * The RUN BUNDLE writer.
 *
 * One directory with the minimum reconstructable evidence. There is no
 * database, no event bus and no generalized artifact service.
 */
export function writeBundle(bundleDir, files) {
	mkdirSync(bundleDir, { recursive: true })
	const written = []
	for (const [name, content] of Object.entries(files)) {
		const target = join(bundleDir, name)
		mkdirSync(dirname(target), { recursive: true })
		writeFileSync(target, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n")
		written.push(name)
	}
	return written
}

/**
 * The READINESS verification.
 *
 * It is READ-ONLY. It NEVER invokes `clinemm_start_act`: the first
 * mutating operation is the actual authorized task start.
 *
 * It establishes:
 *   - the control seam's identity (socket, tokens, owner);
 *   - the protocol version and the extension build identity;
 *   - that NO conflicting active run exists;
 *   - that the candidate workspace identity matches the assertion.
 */
export async function verifyReadiness({ client, expectedWorkspace, expectedExtensionVersion }) {
	const observations = []
	const capabilities = await client.request("clinemm_capabilities")
	observations.push({ op: "clinemm_capabilities", ok: capabilities.ok === true })
	if (!capabilities.ok) {
		return blocker(
			"control_seam_capabilities_unavailable",
			"The control seam did not answer the capabilities probe.",
			{ error: capabilities.error?.code ?? "unknown" },
		)
	}
	const result = capabilities.result ?? {}
	const protocolVersion = result.protocolVersion
	const extensionVersion = result.host?.extensionVersion
	if (protocolVersion !== 1) {
		return blocker(
			"control_seam_protocol_version_mismatch",
			`The control seam speaks protocol version ${protocolVersion}, not 1.`,
			{ protocolVersion },
		)
	}
	if (expectedExtensionVersion && extensionVersion !== expectedExtensionVersion) {
		return blocker(
			"control_seam_extension_identity_mismatch",
			`The control seam reports extension ${extensionVersion}, not the expected ${expectedExtensionVersion}.`,
			{ extensionVersion, expectedExtensionVersion },
		)
	}
	const run = await client.request("clinemm_get_run")
	const noActiveRun = run.ok === false && run.error?.code === "control_seam_no_active_run"
	observations.push({ op: "clinemm_get_run", ok: true, noActiveRun })
	if (!noActiveRun) {
		return blocker(
			"conflicting_active_run",
			"A run is already active in the control seam. Resolve it before starting an experiment.",
			{ run: run.result ?? null },
		)
	}
	if (expectedWorkspace && !existsSync(expectedWorkspace)) {
		return blocker(
			"candidate_workspace_absent",
			"The candidate workspace does not exist. Prepare the experiment first.",
			{ expectedWorkspace },
		)
	}
	return {
		ok: true,
		ready: true,
		observations,
		protocolVersion,
		extensionVersion,
		activeRun: null,
	}
}

/**
 * The SINGLE-START authority.
 *
 * The runner:
 *
 *   1. CLAIMS the experiment authorization atomically;
 *   2. RECORDS the attempt BEFORE sending the mutating request;
 *   3. sends EXACTLY ONE `clinemm_start_act`;
 *   4. NEVER retries blindly: an ambiguous outcome is RECONCILED through
 *      read-only observations.
 *
 * The claim is what prevents two runner processes from consuming the same
 * authorization, and what prevents a restart from silently authorizing a
 * second start.
 */
export async function executeExperiment({
	client,
	claimsRoot,
	runId,
	requestId,
	prompt,
	expectedWorkspace,
	workspace,
	deadlineSeconds = DEFAULT_DEADLINE_SECONDS,
	now = nowMs,
}) {
	const claim = claimExperiment(claimsRoot, runId)
	if (!claim.claimed) {
		return {
			ok: false,
			disposition: "REFUSED",
			reason: claim.reason,
			note: "This experiment authorization was already claimed. A second start is never authorized silently.",
			claimPath: claim.claimPath,
		}
	}
	const attempt = {
		runId,
		requestId,
		expectedWorkspace,
		claimedAtEpochMs: now(),
		deadlineSeconds,
		state: "PREPARED",
	}
	recordAttempt(claim.claimPath, attempt)

	const start = await client.request(
		"clinemm_start_act",
		{ op: "clinemm_start_act", input: { requestId, prompt, expectedWorkspace } },
		{ mutate: true },
	)
	attempt.state = "START_SENT"
	attempt.startOutcome = start.ok === true ? start.result?.outcome ?? "unknown" : `error:${start.error?.code ?? "unknown"}`
	recordAttempt(claim.claimPath, attempt)

	if (!start.ok) {
		// The outcome is UNKNOWN. It MUST NOT be retried blindly. The
		// runner reconciles through READ-ONLY observations.
		const reconciliation = await reconcile(client)
		attempt.state = "UNCERTAIN"
		attempt.reconciliation = reconciliation
		recordAttempt(claim.claimPath, attempt)
		return {
			ok: false,
			disposition: "UNCERTAIN",
			reason: start.error?.code ?? "unknown",
			note: "The start outcome could not be proved. It was NOT retried.",
			reconciliation,
			claimPath: claim.claimPath,
		}
	}
	const outcome = start.result?.outcome
	if (outcome !== "accepted") {
		attempt.state = outcome === "rejected" ? "REJECTED" : "NOT_ACCEPTED"
		recordAttempt(claim.claimPath, attempt)
		return {
			ok: false,
			disposition: outcome === "rejected" ? "REJECTED" : "NOT_ACCEPTED",
			reason: start.result?.reason ?? outcome,
			note: "The control seam did not accept the task start.",
			claimPath: claim.claimPath,
		}
	}
	const sessionId = start.result?.sessionId
	attempt.state = "ACCEPTED"
	attempt.sessionId = sessionId
	recordAttempt(claim.claimPath, attempt)
	return { ok: true, disposition: "ACCEPTED", sessionId, taskId: start.result?.taskId, claimPath: claim.claimPath }
}

/**
 * The READ-ONLY RECONCILIATION.
 *
 * It is the ONLY way an uncertain start may be resolved. It never sends a
 * mutating request.
 */
export async function reconcile(client) {
	const run = await client.request("clinemm_get_run")
	if (run.ok === true) {
		return { activeRun: run.result ?? null, established: true }
	}
	const code = run.error?.code ?? "unknown"
	if (code === "control_seam_no_active_run") {
		return { activeRun: null, established: false }
	}
	return { activeRun: null, established: false, error: code }
}

/**
 * The BOUNDED EVENT COLLECTION.
 *
 * It pages through the ACTUAL cursor contract and detects gaps,
 * duplicates, incomplete pages and unavailable content. A page that
 * reports `cursorExpired` is INCOMPLETE: the runner must not treat the
 * returned slice as the whole trajectory.
 */
export async function collectEvents(client, sessionId, { limit = 100, maxPages = 200 } = {}) {
	const events = []
	const seen = new Set()
	let cursor = undefined
	let pages = 0
	while (pages < maxPages) {
		pages += 1
		const response = await client.request(
			"clinemm_read_events",
			{ op: "clinemm_read_events", input: { sessionId, afterCursor: cursor, limit } },
			{ mutate: true },
		)
		if (!response.ok) {
			return { events, error: response.error?.code ?? "unknown", cursorExpired: false, pages, complete: false }
		}
		const result = response.result ?? {}
		if (result.cursorExpired) {
			return { events, error: "cursor_expired", cursorExpired: true, pages, complete: false }
		}
		for (const event of result.events ?? []) {
			if (seen.has(event.cursor)) {
				return { events, error: "duplicate_cursor", cursorExpired: false, pages, complete: false }
			}
			seen.add(event.cursor)
			events.push(event)
		}
		if (result.nextCursor === undefined) {
			return { events, error: null, cursorExpired: false, pages, complete: true }
		}
		if (result.nextCursor === cursor) {
			return { events, error: "cursor_did_not_advance", cursorExpired: false, pages, complete: false }
		}
		cursor = result.nextCursor
	}
	return { events, error: "page_limit_exceeded", cursorExpired: false, pages, complete: false }
}

/**
 * The QUIESCENCE boundary.
 *
 * A terminal UI label is NOT sufficient evidence that detached child
 * commands have stopped. The runner therefore establishes quiescence
 * through the OWNED run's authoritative state AND a bounded settling
 * window during which the deliverable's identity does not change.
 *
 * If quiescence cannot be established, the runner does NOT evaluate a
 * potentially changing workspace.
 */
export async function establishQuiescence({ client, sessionId, workspace, allowedPath, settleMs = 250, attempts = 4 }) {
	const observations = []
	let lastDigest = null
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const run = await client.request("clinemm_get_run")
		const state = run.ok === true ? run.result : null
		const phase = state?.taskState?.phase ?? null
		const running = state?.running === true
		let digest = null
		try {
			digest = await digestOfDirectoryVersioned(workspace)
		} catch {
			digest = null
		}
		observations.push({ attempt, phase, running, digest })
		const settled = lastDigest !== null && digest !== null && digest === lastDigest
		if (!running && settled && phase !== null) {
			return { quiescent: true, observations, finalDigest: digest, phase }
		}
		lastDigest = digest
		await new Promise((resolvePromise) => setTimeout(resolvePromise, settleMs))
	}
	return { quiescent: false, observations, finalDigest: lastDigest, phase: null }
}

/**
 * The INDEPENDENT EVALUATION.
 *
 * The sequence is fixed:
 *
 *   1. inspect the final candidate tree;
 *   2. validate the source scope and the declared scratch policy;
 *   3. capture the exact permitted deliverable bytes;
 *   4. generate the corresponding patch and digest;
 *   5. reverify the reference, evaluator and qualification identities;
 *   6. construct a FRESH independent evaluator environment;
 *   7. apply the validated captured deliverable;
 *   8. execute the qualified ML-06A evaluator;
 *   9. record the authoritative outcome.
 *
 * The bytes evaluated are the bytes that passed scope validation and
 * entered the recorded patch: the evaluator's workspace is built from the
 * CAPTURED bytes, never from a later re-read of the candidate tree.
 */
export async function evaluateDeliverable({
	repoRoot,
	referenceDir,
	workspace,
	allowedPath,
	expectedReferenceDigest,
	baseCommit = ML06A_BASE_COMMIT,
	nodeBin,
	oracle = join(repoRoot, "labs/model-lab/ml_06a_acceptance_oracle.sh"),
	workDir,
}) {
	const timings = {}
	const started = nowMs()

	// 1 + 2 + 3: inspect, validate the scope, capture the bytes.
	const scopeRun = spawnSync(
		nodeBin,
		[
			join(repoRoot, "labs/model-lab/ml_failclosed.mjs"),
			"scope",
			join(repoRoot, "labs/model-lab/ml_smoke_01_tool.mjs"),
			referenceDir,
			workspace,
			allowedPath,
		],
		{ encoding: "utf8" },
	)
	timings.scopeMs = nowMs() - started
	const scopeState = (scopeRun.stdout ?? "").match(/^FC_STATUS=(.*)$/m)?.[1] ?? "FAILED"
	const scopeViolations = Number((scopeRun.stdout ?? "").match(/^FC_VIOLATIONS=(\d+)$/m)?.[1] ?? NaN)
	const scopePayload = (scopeRun.stdout ?? "").match(/^FC_OUTPUT=(.*)$/m)?.[1] ?? ""
	const scope = { state: scopeState, violations: scopeViolations, payload: scopePayload }
	if (scopeState !== "OK" || !Number.isInteger(scopeViolations)) {
		return {
			ok: false,
			disposition: "HALT",
			reason: "scope_inspection_failed",
			scope,
			timings,
		}
	}
	const deliverable = captureDeliverable(workspace, allowedPath)
	if (!deliverable.ok) {
		return { ok: false, disposition: "HALT", reason: deliverable.reason, scope, timings }
	}
	if (scope.violations > 0) {
		// An unauthorized change is REJECTED BEFORE the evaluator is
		// executed. The evaluator never receives the candidate's tree, so
		// the rejection happens here, in the runner, and the candidate's
		// bytes never enter an evaluator reconstruction.
		return {
			ok: true,
			disposition: "FAIL",
			acceptance: "FAIL",
			gateExecuted: "NO",
			scopeViolations: scope.violations,
			reason: "unauthorized_patch_rejected_before_execution",
			scope,
			timings,
		}
	}
	// 4: the patch, generated from the CAPTURED bytes.
	const patch = buildPatch(join(referenceDir, allowedPath), deliverable, workDir)
	// 5: reverify the reference identity against the SUPERVISOR's expected
	// digest. The expected digest is supplied EXTERNALLY; it is never read
	// from a file next to the reference.
	const referenceDigest = await digestOfDirectory(referenceDir)
	if (!expectedReferenceDigest || referenceDigest !== expectedReferenceDigest) {
		return {
			ok: false,
			disposition: "HALT",
			reason: "reference_identity_mismatch",
			referenceDigest,
			expectedReferenceDigest,
			scope,
			timings,
		}
	}
	// 6 + 7 + 8: a FRESH evaluator workspace built from the trusted
	// reference plus the CAPTURED bytes, and the qualified oracle.
	const evaluatorWorkspace = join(workDir, "evaluator-workspace")
	rmSync(evaluatorWorkspace, { force: true, recursive: true })
	mkdirSync(evaluatorWorkspace, { recursive: true })
	const tar = spawnSync("tar", ["-cf", "-", "-C", referenceDir, "."], { encoding: "buffer" })
	if (tar.status !== 0) {
		return { ok: false, disposition: "HALT", reason: "evaluator_reconstruction_failed", scope, timings }
	}
	const extract = spawnSync("tar", ["-xf", "-", "-C", evaluatorWorkspace], { input: tar.stdout })
	if (extract.status !== 0) {
		return { ok: false, disposition: "HALT", reason: "evaluator_reconstruction_failed", scope, timings }
	}
	writeFileSync(join(evaluatorWorkspace, allowedPath), deliverable.bytes)
	const oracleRun = spawnSync(
		"bash",
		[oracle, repoRoot, baseCommit, evaluatorWorkspace, referenceDir, expectedReferenceDigest],
		{ encoding: "utf8" },
	)
	timings.evaluationMs = nowMs() - started
	const oracleOutput = oracleRun.stdout ?? ""
	const disposition = oracleOutput.match(/^ML_06A_DISPOSITION=(.*)$/m)?.[1] ?? "UNKNOWN"
	const acceptance = oracleOutput.match(/^ML_06A_ACCEPTANCE=(.*)$/m)?.[1] ?? "UNKNOWN"
	const gateExecuted = oracleOutput.match(/^ML_06A_GATE_EXECUTED=(.*)$/m)?.[1] ?? "NO"
	const scopeViolationsOracle = Number(oracleOutput.match(/^ML_06A_SCOPE_VIOLATIONS=(\d+)$/m)?.[1] ?? NaN)
	return {
		ok: true,
		disposition,
		acceptance,
		gateExecuted,
		scopeViolations: scopeViolationsOracle,
		deliverable: { path: deliverable.path, sha256: deliverable.sha256, size: deliverable.size },
		patch: { sha256: patch.sha256, size: patch.size, text: patch.patch },
		referenceDigest,
		oracleExitCode: oracleRun.status,
		oracleOutput,
		timings,
	}
}
