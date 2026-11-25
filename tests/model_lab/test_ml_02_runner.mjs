/**
 * test_ml_02_runner.mjs — FAST, DETERMINISTIC regression controls for the
 * Model Lab runner (ACT ML-02).
 *
 * The controls exercise the REAL client and the REAL runner logic against
 * the SIMULATED native control seam: a minimal AF_UNIX listener that
 * answers the ACTUAL protocol with the ACTUAL request and response
 * shapes. No model is involved and no paid inference occurs.
 *
 * The expensive controls — the ones that execute the REAL historical
 * fixture end to end — live in `test_ml_06a_qualification.sh` and are the
 * FULL qualification level, not the ordinary gate.
 *
 * Exit: 0 when every control behaves as specified, 1 otherwise.
 */

import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { NativeControlSeamClient, SimulatedControlSeam } from "../../labs/model-lab/ml_02_client.mjs"
import {
	ML06A_ALLOWED_PATH,
	ML06A_BASE_COMMIT,
	ML06A_KNOWN_GOOD_COMMIT,
	ML06A_TASK_TEXT,
	buildPatch,
	captureDeliverable,
	claimExperiment,
	collectEvents,
	digestOfDirectory,
	digestOfDirectoryVersioned,
	establishQuiescence,
	evaluateDeliverable,
	executeExperiment,
	readAttempt,
	sha256,
	taskTextDigest,
	verifyReadiness,
} from "../../labs/model-lab/ml_02_runner.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, "..", "..")
const NODE_BIN = process.execPath
const BASE_COMMIT = ML06A_BASE_COMMIT
const KNOWN_GOOD = ML06A_KNOWN_GOOD_COMMIT
const ALLOWED_PATH = ML06A_ALLOWED_PATH

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

/** A simulated seam, listening on its own socket. */
async function withSeam(configure, body) {
	// The AF_UNIX pathname is bounded (104 bytes on this host), so the
	// socket lives directly under /tmp with a SHORT name.
	const dir = "/tmp"
	const name = `ml02-${process.pid}-${Math.floor(Math.random() * 1e6)}`
	const seam = new SimulatedControlSeam({ socketPath: join(dir, `${name}.sock`) })
	configure?.(seam)
	await seam.listen()
	const client = new NativeControlSeamClient({
		seamDir: dir,
		readToken: seam.token,
		writeToken: seam.writeToken,
	})
	// The client resolves the socket path from the seam directory; the
	// simulated seam uses its own short path, so the client's path is
	// overridden to the SAME socket.
	client.socketPath = seam.socketPath
	try {
		return await body({ seam, client, dir })
	} finally {
		await seam.close()
		rmSync(seam.socketPath, { force: true })
	}
}

/** A prepared fixture tree: the real base commit's production file. */
function materializeFixture(root) {
	const target = join(root, "workspace")
	mkdirSync(target, { recursive: true })
	const source = spawnSync("git", ["-C", REPO_ROOT, "show", `${BASE_COMMIT}:${ALLOWED_PATH}`], {
		encoding: "utf8",
	})
	if (source.status !== 0) throw new Error("the base commit's production file could not be read")
	mkdirSync(dirname(join(target, ALLOWED_PATH)), { recursive: true })
	writeFileSync(join(target, ALLOWED_PATH), source.stdout)
	return target
}

console.log("=== Model Lab runner regression controls (fast, simulated seam) ===")
console.log("")

// ---------------------------------------------------------------------------
// R01 / R02 — equivalent independent fixture preparation and an independent
// reference identity.
//
// Two independently materialized trees with the same content must have
// the SAME versioned tree-manifest digest, and the reference must be a
// DISTINCT tree from the workspace.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-02-r01-"))
	try {
		const a = materializeFixture(join(root, "a"))
		const b = materializeFixture(join(root, "b"))
		const digestA = await digestOfDirectoryVersioned(a)
		const digestB = await digestOfDirectoryVersioned(b)
		assert(digestA === digestB, "R01 two independently materialized trees have the SAME identity")
		assert(digestA.length === 64, "R01 the tree identity is a SHA-256 hex digest")
		assert(a !== b, "R02 the reference is a DISTINCT tree from the workspace")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// R03 — a wrong workspace is rejected BEFORE a start.
// ---------------------------------------------------------------------------

await withSeam(
	(seam) => seam.configure({ allowMutation: true, expectedWorkspace: "/the/right/workspace" }),
	async ({ seam, client }) => {
		const execution = await executeExperiment({
			client,
			claimsRoot: mkdtempSync(join(tmpdir(), "ml-02-r03-claims-")),
			runId: "r03",
			requestId: "r03-request",
			prompt: "x",
			expectedWorkspace: "/the/wrong/workspace",
		})
		assert(execution.ok === false, "R03 a wrong workspace is rejected")
		assert(execution.disposition === "REJECTED", "R03 the rejection is named REJECTED")
		assert(seam.startCount === 0, "R03 NO task was started")
	},
)

// ---------------------------------------------------------------------------
// R04 — a stale extension identity is rejected BEFORE a start.
// ---------------------------------------------------------------------------

await withSeam(
	(seam) => seam.configure({ allowMutation: true }),
	async ({ seam, client }) => {
		const readiness = await verifyReadiness({
			client,
			expectedWorkspace: undefined,
			expectedExtensionVersion: "a-different-extension-build",
		})
		assert(readiness.ok === false, "R04 a stale extension identity is rejected")
		assert(readiness.blocker?.code === "control_seam_extension_identity_mismatch", "R04 the mismatch is named")
		assert(seam.startCount === 0, "R04 NO task was started")
	},
)

// ---------------------------------------------------------------------------
// R05 — a missing authorization means ZERO start calls.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-02-r05-"))
	try {
		const cli = spawnSync(
			NODE_BIN,
			[
				join(REPO_ROOT, "labs/model-lab/ml_02_cli.mjs"),
				"execute",
				"--manifest",
				join(root, "experiment.json"),
			],
			{ encoding: "utf8" },
		)
		assert(cli.status !== 0, "R05 a missing authorization produces a non-zero exit")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// R06 — a valid simulated authorization produces EXACTLY ONE start.
// ---------------------------------------------------------------------------

await withSeam(
	(seam) => seam.configure({ allowMutation: true }),
	async ({ seam, client }) => {
		const claims = mkdtempSync(join(tmpdir(), "ml-02-r06-claims-"))
		try {
			const execution = await executeExperiment({
				client,
				claimsRoot: claims,
				runId: "r06",
				requestId: "r06-request",
				prompt: ML06A_TASK_TEXT,
				expectedWorkspace: "/workspace",
			})
			assert(execution.ok === true, "R06 a valid authorization is accepted")
			assert(execution.sessionId !== undefined, "R06 the accepted session identity is returned")
			assert(seam.startCount === 1, "R06 EXACTLY ONE start occurred")
		} finally {
			rmSync(claims, { recursive: true, force: true })
		}
	},
)

// ---------------------------------------------------------------------------
// R07 — two concurrent invocations cannot consume one authorization twice.
// ---------------------------------------------------------------------------

await withSeam(
	(seam) => seam.configure({ allowMutation: true }),
	async ({ seam, client }) => {
		const claims = mkdtempSync(join(tmpdir(), "ml-02-r07-claims-"))
		try {
			const first = await executeExperiment({
				client,
				claimsRoot: claims,
				runId: "r07",
				requestId: "r07-a",
				prompt: "x",
				expectedWorkspace: "/workspace",
			})
			const second = await executeExperiment({
				client,
				claimsRoot: claims,
				runId: "r07",
				requestId: "r07-b",
				prompt: "x",
				expectedWorkspace: "/workspace",
			})
			assert(first.ok === true, "R07 the first invocation claims the authorization")
			assert(second.ok === false, "R07 the second invocation is REFUSED")
			assert(second.disposition === "REFUSED", "R07 the refusal is named REFUSED")
			assert(seam.startCount === 1, "R07 only ONE start occurred")
		} finally {
			rmSync(claims, { recursive: true, force: true })
		}
	},
)

// ---------------------------------------------------------------------------
// R08 — an ambiguous start never causes a duplicate start.
// ---------------------------------------------------------------------------

await withSeam(
	(seam) => seam.configure({ allowMutation: true, ambiguousStart: true }),
	async ({ seam, client }) => {
		const claims = mkdtempSync(join(tmpdir(), "ml-02-r08-claims-"))
		try {
			const execution = await executeExperiment({
				client,
				claimsRoot: claims,
				runId: "r08",
				requestId: "r08-request",
				prompt: "x",
				expectedWorkspace: "/workspace",
			})
			assert(execution.ok === false, "R08 an ambiguous start is not an acceptance")
			assert(execution.disposition === "UNCERTAIN", "R08 the disposition is UNCERTAIN")
			assert(execution.reconciliation !== undefined, "R08 the outcome was reconciled through read-only observations")
			assert(seam.startCount === 0, "R08 NO duplicate start occurred")
			const starts = seam.calls.filter((c) => c.op === "clinemm_start_act")
			assert(starts.length === 1, "R08 EXACTLY ONE start request was sent")
		} finally {
			rmSync(claims, { recursive: true, force: true })
		}
	},
)

// ---------------------------------------------------------------------------
// R09 — a rejected mutation remains rejected.
// ---------------------------------------------------------------------------

await withSeam(
	(seam) => seam.configure({ allowMutation: true, rejectStart: "workspace_mismatch" }),
	async ({ seam, client }) => {
		const claims = mkdtempSync(join(tmpdir(), "ml-02-r09-claims-"))
		try {
			const execution = await executeExperiment({
				client,
				claimsRoot: claims,
				runId: "r09",
				requestId: "r09-request",
				prompt: "x",
				expectedWorkspace: "/workspace",
			})
			assert(execution.ok === false, "R09 a rejected start remains rejected")
			assert(execution.disposition === "REJECTED", "R09 the disposition is REJECTED")
			assert(seam.startCount === 0, "R09 NO task was started")
		} finally {
			rmSync(claims, { recursive: true, force: true })
		}
	},
)

// ---------------------------------------------------------------------------
// R10 — a previously attempted experiment cannot silently start again.
// ---------------------------------------------------------------------------

{
	const claims = mkdtempSync(join(tmpdir(), "ml-02-r10-claims-"))
	try {
		const claim = claimExperiment(claims, "r10")
		assert(claim.claimed === true, "R10 the first claim succeeds")
		const attempt = readAttempt(claim.claimPath)
		assert(attempt === undefined, "R10 no attempt is recorded before one is made")
		const second = claimExperiment(claims, "r10")
		assert(second.claimed === false, "R10 the second claim is REFUSED")
	} finally {
		rmSync(claims, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// R11 — event ordering and incomplete-page detection.
// ---------------------------------------------------------------------------

await withSeam(
	(seam) =>
		seam.configure({
			allowMutation: true,
			events: [
				{ cursor: "1", epoch: 1, type: "say", kind: "text", ts: 1, text: "one" },
				{ cursor: "2", epoch: 1, type: "say", kind: "text", ts: 2, text: "two" },
				{ cursor: "3", epoch: 1, type: "say", kind: "text", ts: 3, text: "three" },
			],
		}),
	async ({ seam, client }) => {
		await executeExperiment({
			client,
			claimsRoot: mkdtempSync(join(tmpdir(), "ml-02-r11-claims-")),
			runId: "r11",
			requestId: "r11-request",
			prompt: "x",
			expectedWorkspace: "/workspace",
		})
		const collected = await collectEvents(client, seam.sessionId, { limit: 2 })
		assert(collected.complete === true, "R11 a complete trajectory is reported as complete")
		assert(collected.events.length === 3, "R11 every event was collected across pages")
		assert(collected.events.map((e) => e.cursor).join(",") === "1,2,3", "R11 the events are in their ORIGINAL order")
		assert(collected.pages === 2, "R11 the traversal paged through the cursor contract")

		seam.configure({ cursorExpired: true })
		const expired = await collectEvents(client, seam.sessionId)
		assert(expired.complete === false, "R11 an expired cursor makes the slice INCOMPLETE")
		assert(expired.error === "cursor_expired", "R11 the expiry is named")
	},
)

// ---------------------------------------------------------------------------
// R12 — a timeout cancels ONLY the owned run.
// ---------------------------------------------------------------------------

await withSeam(
	(seam) => seam.configure({ allowMutation: true }),
	async ({ seam, client }) => {
		await executeExperiment({
			client,
			claimsRoot: mkdtempSync(join(tmpdir(), "ml-02-r12-claims-")),
			runId: "r12",
			requestId: "r12-request",
			prompt: "x",
			expectedWorkspace: "/workspace",
		})
		const foreign = await client.request(
			"clinemm_cancel_run",
			{
				op: "clinemm_cancel_run",
				input: { requestId: "r12-foreign", sessionId: "not-our-session", expectedEpoch: 1 },
			},
			{ mutate: true },
		)
		assert(foreign.ok === false, "R12 a cancellation of a FOREIGN run is refused")
		assert(foreign.error?.code === "control_seam_foreign_session", "R12 the refusal names the foreign session")

		const own = await client.request(
			"clinemm_cancel_run",
			{
				op: "clinemm_cancel_run",
				input: { requestId: "r12-own", sessionId: seam.sessionId, expectedEpoch: 1 },
			},
			{ mutate: true },
		)
		assert(own.ok === true, "R12 the owned run can be cancelled")
		assert(own.result?.outcome === "accepted", "R12 the cancellation was accepted")
	},
)

// ---------------------------------------------------------------------------
// R13 — uncertain termination PREVENTS evaluation.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-02-r13-"))
	try {
		const workspace = materializeFixture(root)
		await withSeam(
			(seam) => seam.configure({ allowMutation: true, keepRunning: true }),
			async ({ seam, client }) => {
				await executeExperiment({
					client,
					claimsRoot: join(root, "claims"),
					runId: "r13",
					requestId: "r13-request",
					prompt: "x",
					expectedWorkspace: workspace,
				})
				const quiescence = await establishQuiescence({
					client,
					sessionId: seam.sessionId,
					workspace,
					allowedPath: ALLOWED_PATH,
					settleMs: 5,
					attempts: 2,
				})
				assert(quiescence.quiescent === false, "R13 a still-running run is NOT quiescent")
			},
		)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// R14 — a fresh task does not inherit prior candidate context.
// ---------------------------------------------------------------------------

{
	const prompt = ML06A_TASK_TEXT
	assert(prompt.includes("Fix the validator"), "R14 the frozen task text carries the symptom-oriented description")
	assert(!prompt.includes("WeakSet"), "R14 the task text does NOT name the historical data structure")
	assert(!prompt.includes("ancestors"), "R14 the task text does NOT name the historical implementation")
	assert(!prompt.includes(KNOWN_GOOD.slice(0, 7)), "R14 the task text does NOT name the known-good revision")
	assert(!prompt.includes("ML06A-0"), "R14 the task text does NOT name the evaluator-only tests")
	assert(!prompt.includes("clinemm_"), "R14 the task text does NOT name the supervisory interface")
	assert(taskTextDigest(prompt) === taskTextDigest(), "R14 the frozen task text has a stable digest")
}

// ---------------------------------------------------------------------------
// R15 / R16 / R17 / R18 — the deliverable, the scope, the dependency
// authority and the patch identity.
//
// These controls use the REAL ML-06A source and the REAL evaluator
// integration path.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-02-r15-"))
	try {
		const workspace = materializeFixture(root)
		const reference = materializeFixture(join(root, "reference"))
		const referenceDigest = await digestOfDirectory(reference)

		// R15: a declared scratch file does not enter the deliverable.
		const scratchDir = join(workspace, "labs/long-horizon-harness/.tmp-home")
		mkdirSync(scratchDir, { recursive: true })
		writeFileSync(join(scratchDir, "scratch.txt"), "scratch\n")
		const deliverable = captureDeliverable(workspace, ALLOWED_PATH)
		assert(deliverable.ok === true, "R15 the deliverable is captured")
		assert(
			!deliverable.bytes.toString().includes("scratch"),
			"R15 the declared scratch file does NOT enter the deliverable",
		)

		// R18: the captured patch identity matches the evaluated bytes.
		const patch = buildPatch(join(reference, ALLOWED_PATH), deliverable, root)
		assert(patch.sha256 === sha256(patch.patch), "R18 the patch digest matches the patch bytes")
		assert(patch.size === patch.patch.length, "R18 the patch size matches the patch bytes")

		// R17: candidate dependencies cannot enter evaluator authority.
		//
		// The evaluator's reconstruction is built from the REFERENCE plus
		// the CAPTURED BYTES. A candidate-owned dependency tree is never
		// consulted, and a candidate-owned dependency tree is a scope
		// violation in its own right.
		const candidateDeps = join(workspace, "labs/long-horizon-harness/node_modules")
		mkdirSync(candidateDeps, { recursive: true })
		writeFileSync(join(candidateDeps, "candidate-owned.js"), "// candidate owned\n")
		const withDeps = await evaluateDeliverable({
			repoRoot: REPO_ROOT,
			referenceDir: reference,
			workspace,
			allowedPath: ALLOWED_PATH,
			expectedReferenceDigest: referenceDigest,
			nodeBin: NODE_BIN,
			workDir: root,
		})
		assert(withDeps.disposition === "FAIL", "R17 a candidate-owned dependency tree is a FAIL")
		assert(withDeps.scopeViolations > 0, "R17 the candidate-owned dependency tree is a scope violation")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// R22 — an evaluator failure is distinct from a candidate failure.
//
// A MISSING evaluator dependency is not a behavioural candidate failure:
// the evaluation HALTs, and its disposition names the evaluator-side
// cause rather than a candidate verdict.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-02-r22-"))
	try {
		const workspace = materializeFixture(root)
		const reference = materializeFixture(join(root, "reference"))
		const evaluation = await evaluateDeliverable({
			repoRoot: REPO_ROOT,
			referenceDir: reference,
			workspace,
			allowedPath: ALLOWED_PATH,
			expectedReferenceDigest: "0".repeat(64),
			nodeBin: NODE_BIN,
			workDir: root,
		})
		assert(evaluation.disposition === "HALT", "R22 a reference-identity mismatch is a HALT, not a candidate FAIL")
		assert(evaluation.reason === "reference_identity_mismatch", "R22 the HALT names the evaluator-side cause")
		assert(evaluation.acceptance === undefined, "R22 no behavioural acceptance is claimed")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

// ---------------------------------------------------------------------------
// R23 — a changed qualification identity prevents stale authority reuse.
//
// The expected reference digest is supplied EXTERNALLY by the supervisor.
// A changed fixture therefore cannot be evaluated against the previous
// authority.
// ---------------------------------------------------------------------------

{
	const root = mkdtempSync(join(tmpdir(), "ml-02-r23-"))
	try {
		const reference = materializeFixture(join(root, "reference"))
		const before = await digestOfDirectory(reference)
		writeFileSync(join(reference, ALLOWED_PATH), "// changed\n")
		const after = await digestOfDirectoryVersioned(reference)
		assert(before !== after, "R23 a changed fixture has a CHANGED identity")
		const evaluation = await evaluateDeliverable({
			repoRoot: REPO_ROOT,
			referenceDir: reference,
			workspace: materializeFixture(join(root, "workspace")),
			allowedPath: ALLOWED_PATH,
			expectedReferenceDigest: before,
			nodeBin: NODE_BIN,
			workDir: root,
		})
		assert(evaluation.disposition === "HALT", "R23 the stale authority is refused")
		assert(evaluation.reason === "reference_identity_mismatch", "R23 the refusal names the identity mismatch")
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

console.log("")
console.log("=== Summary ===")
console.log(`PASS=${passCount}  FAIL=${failCount}`)
process.exit(failCount > 0 ? 1 : 0)