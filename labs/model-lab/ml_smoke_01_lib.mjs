/**
 * ml_smoke_01_lib.mjs — the DECISION LOGIC of the ML-SMOKE-01 acceptance
 * oracle, kept separate from the orchestration so that it can be exercised
 * with inexpensive SYNTHETIC inputs.
 *
 * Why this file exists
 * --------------------
 * The REBOOT/CORR01 oracle classified TAP TEXT. That made two things
 * impossible:
 *
 *   1. bind a negative result to the exact test identity and the exact
 *      underlying error (a substring search over the whole log let an
 *      UNRELATED test's diagnostic satisfy the "intended signature" rule);
 *   2. test the classification and scope logic without paying for a full
 *      fixture execution (which is what made the Factory gate take minutes).
 *
 * This module therefore has two halves:
 *
 *   - a STRUCTURED EVENT vocabulary (the Node test reporter in
 *     `ml_smoke_01_test_reporter.mjs` emits it), and
 *   - pure decision functions over that vocabulary plus over filesystem
 *     trees.
 *
 * Everything here is deliberately small and single-fixture. It is NOT a
 * general test-mutation framework.
 */

import { createHash } from "node:crypto"
import { lstat, readFile, readdir } from "node:fs/promises"
import { realpathSync } from "node:fs"
import { isAbsolute, join, relative } from "node:path"

/** Dependency trees are evaluator-owned. A candidate may never own one. */
export const FORBIDDEN_DEPENDENCY_PREFIXES = [
	"node_modules",
	"labs/long-horizon-harness/node_modules",
]

/** The one file a candidate is allowed to change. */
export const ALLOWED_PATHS = ["labs/long-horizon-harness/test/recovery/cp-crash.test.ts"]

/**
 * The two tests the oracle requires to be present, executed and passing.
 *
 * Each required test is bound to its EXACT relative source file AND its
 * exact name. The identities were obtained from the ACTUAL fixture, by
 * executing the real Node test runner against the prepared fixture and
 * reading the real event stream. They are NOT invented.
 *
 * The `file` field is RELATIVE to the harness root
 * (`labs/long-horizon-harness`), which is the runner's working
 * directory. It is the identity that distinguishes this test from a
 * test with the same name in another file.
 */
export const REQUIRED_TESTS = [
	{
		label: "REC-TMP01",
		name: "REC-TMP01: tmpDir(base) self-constructs the parent when definitely absent",
		file: "test/recovery/cp-crash.test.ts",
	},
	{
		label: "REC-TMP02",
		name: "REC-TMP02: tmpDir() returns a unique dir per call",
		file: "test/recovery/cp-crash.test.ts",
	},
]

/**
 * The SOCK tests that are APPLICABLE on the evaluated host.
 *
 * These identities were read from the ACTUAL fixture file
 * (`test/ledger-writer/ledger-writer-socket-probe.test.ts`) AFTER the
 * preparation overlay was applied, and cross-checked against the ACTUAL
 * Node event stream of the real fixture run. They are not invented.
 *
 * The historical SOCK06 defect was a test that silently SKIPPED. A
 * skipped SOCK test is therefore evidence of the very defect class under
 * test, and is a FAIL, not a pass.
 */
export const REQUIRED_SOCK_TESTS = [
	{ label: "SOCK01", name: "SOCK01 absent path \u2192 absent (B0-CORR05 \u00a712)", file: "test/ledger-writer/ledger-writer-socket-probe.test.ts" },
	{ label: "SOCK02", name: "SOCK02 regular file at path \u2192 path_collision (B0-CORR05 \u00a78)", file: "test/ledger-writer/ledger-writer-socket-probe.test.ts" },
	{ label: "SOCK03", name: "SOCK03 directory at path \u2192 path_collision (B0-CORR05 \u00a78)", file: "test/ledger-writer/ledger-writer-socket-probe.test.ts" },
	{ label: "SOCK04", name: "SOCK04 symlink at path \u2192 path_collision (B0-CORR05 \u00a78)", file: "test/ledger-writer/ledger-writer-socket-probe.test.ts" },
	{ label: "SOCK05", name: "SOCK05 WHO timeout \u2192 unknown_socket (B0-CORR06)", file: "test/ledger-writer/ledger-writer-socket-probe.test.ts" },
	{ label: "SOCK06", name: "SOCK06 malformed WHO \u2192 unknown_socket (B0-CORR06)", file: "test/ledger-writer/ledger-writer-socket-probe.test.ts" },
	{ label: "SOCK06A", name: "SOCK06A: helper READY barrier implies pathname exists and is a socket", file: "test/ledger-writer/ledger-writer-socket-probe.test.ts" },
	{ label: "SOCK06D", name: "SOCK06D: malformed-WHO helper survives two sequential probes (no wall-clock fence)", file: "test/ledger-writer/ledger-writer-socket-probe.test.ts" },
	{ label: "SOCK06E", name: "SOCK06E: helper termination observes close boundary + endpoint no longer answers; fixture owner cleans up", file: "test/ledger-writer/ledger-writer-socket-probe.test.ts" },
]

/**
 * The known-bad statement. The historical defect is that `fs.mkdtemp` does
 * not create missing parents, so anchoring the fixture under a directory
 * that does not exist throws ENOENT.
 */
export const KNOWN_BAD_SEAM_STATEMENT =
	'const tmpRoot = await fs.mkdtemp(join(process.cwd(), ".tmp-home", "tmp01-"));'

/** The underlying error code the intended failure must carry. */
export const INTENDED_FAILURE_CODE = "ENOENT"

/**
 * The ESTABLISHED Node test-runner test-failure process exit.
 *
 * Node's test runner exits `1` when a test fails. A mutation detection
 * requires EXACTLY this exit: a timeout, a signal death, a missing exit,
 * a parser failure and any other exit are unrelated execution failures,
 * never detections.
 */
export const MUTANT_FAILURE_EXIT = 1

/**
 * The ML-06A acceptance test identities.
 *
 * Each entry is the EXACT test name the evaluator's own acceptance test
 * declares. The acceptance verdict is bound to the (file, name) identity
 * of every one of them: a test with the right behaviour under a
 * different name is NOT the required test.
 *
 * The file is RELATIVE to the harness root, which is the runner's
 * working directory.
 */
export const ML06A_REQUIRED_TESTS = [
	{ label: "ML06A-01", name: "ML06A-01: an ordinary JSON tree is accepted", file: "test/subject/ml-06a-acceptance.test.ts" },
	{ label: "ML06A-02", name: "ML06A-02: shared sibling OBJECTS are accepted", file: "test/subject/ml-06a-acceptance.test.ts" },
	{ label: "ML06A-03", name: "ML06A-03: shared sibling ARRAYS are accepted", file: "test/subject/ml-06a-acceptance.test.ts" },
	{ label: "ML06A-04", name: "ML06A-04: shared substructure at DIFFERENT DEPTHS is accepted", file: "test/subject/ml-06a-acceptance.test.ts" },
	{ label: "ML06A-05", name: "ML06A-05: a DIRECT cycle is rejected", file: "test/subject/ml-06a-acceptance.test.ts" },
	{ label: "ML06A-06", name: "ML06A-06: an INDIRECT cycle is rejected", file: "test/subject/ml-06a-acceptance.test.ts" },
	{ label: "ML06A-07", name: "ML06A-07: a cycle WITHIN shared substructure is rejected", file: "test/subject/ml-06a-acceptance.test.ts" },
	{ label: "ML06A-08", name: "ML06A-08: the existing invalid-value behaviour is preserved", file: "test/subject/ml-06a-acceptance.test.ts" },
	{ label: "ML06A-10", name: "ML06A-10: the input is not reshaped and the returned value is the SAME reference", file: "test/subject/ml-06a-acceptance.test.ts" },
]

/**
 * The ML-06A OBSERVATIONS.
 *
 * These are EXERCISED and REPORTED, but they are NOT bound to the
 * acceptance verdict. Each one describes a behaviour that the KNOWN-BAD
 * revision does not have and that the task prompt does not state.
 * Requiring them would impose a HIDDEN requirement, which is exactly
 * what a solution-blind fixture must not do.
 *
 * `ML06A-OBS-01` records that the known-bad revision violates its own
 * documented "NEVER throws" contract on hostile Proxy input.
 */
export const ML06A_OBSERVATIONS = [
	{ label: "ML06A-OBS-01", name: "ML06A-OBS-01: the validator never throws on hostile input", file: "test/subject/ml-06a-observations.test.ts" },
]

class EnumerationError extends Error {
	constructor(cause) {
		super("enumeration_failed")
		this.cause = cause
	}
}

/**
 * Recursively list a tree WITHOUT following symlinks.
 *
 * A directory named `node_modules` is recorded but never descended into: the
 * candidate may not own a dependency tree, and descending into one would be
 * both pointless and expensive.
 */
export async function listTree(root, { stopAt = ["node_modules"] } = {}) {
	const entries = []
	async function walk(absDir, relDir) {
		let items
		try {
			items = await readdir(absDir, { withFileTypes: true })
		} catch (cause) {
			throw new EnumerationError(cause)
		}
		for (const item of items) {
			const rel = relDir ? `${relDir}/${item.name}` : item.name
			const abs = join(absDir, item.name)
			let st
			try {
				st = await lstat(abs)
			} catch (cause) {
				throw new EnumerationError(cause)
			}
			let type
			if (item.isSymbolicLink()) type = "symlink"
			else if (item.isDirectory()) type = "dir"
			else if (item.isFile()) type = "file"
			else type = "other"
			entries.push({ path: rel, type, mode: st.mode & 0o7777, size: st.size })
			if (type === "dir" && !stopAt.includes(item.name)) {
				await walk(abs, rel)
			}
		}
	}
	await walk(root, "")
	return entries
}

/**
 * The HISTORICAL fixture identity digest (version `v1`).
 *
 * It is the SHA-256 of the concatenated per-file SHA-256 listing of every
 * regular file, ordered by relative path. The reference preparation and the
 * oracle both compute it through THIS function, so the two can never drift.
 *
 * HISTORICAL MEANING IS PRESERVED. The digests recorded by the ML-SMOKE-01
 * and ML-06A qualifications were computed with THIS function, so this
 * function is NOT changed by the introduction of the versioned tree
 * manifest below. A historical digest keeps its historical meaning; it is
 * never silently reinterpreted through the new format.
 */
export async function digestOfDirectory(root) {
	const entries = (await listTree(root)).filter((e) => e.type === "file")
	entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
	const lines = []
	for (const entry of entries) {
		const buf = await readFile(join(root, entry.path))
		const hash = createHash("sha256").update(buf).digest("hex")
		lines.push(`${hash}  ./${entry.path}\n`)
	}
	return createHash("sha256").update(lines.join("")).digest("hex")
}

/**
 * The VERSIONED tree-manifest format.
 *
 * The historical `v1` digest binds only FILE CONTENT. It cannot see:
 *
 *   - a removed EMPTY DIRECTORY (it contributes no file);
 *   - an object TYPE substitution (a file replaced by a directory);
 *   - a MODE change;
 *   - the identity of a directory at all.
 *
 * The manifest below binds, for every entry in the tree:
 *
 *   - the RELATIVE path;
 *   - the OBJECT TYPE (`file`, `dir`, `symlink`, `other`);
 *   - the MODE (`st_mode & 0o7777`);
 *   - the FILE-CONTENT SHA-256 (`file` entries only);
 *   - the PRESENCE of a DIRECTORY, including an EMPTY one.
 *
 * The serialization is UNAMBIGUOUS: one JSON object per entry, one entry
 * per line, entries ordered by relative path, and the format version on
 * the first line. No timestamps, no absolute paths, no ambient state: two
 * INDEPENDENTLY MATERIALIZED trees with the same content have the same
 * manifest digest.
 */
export const TREE_MANIFEST_VERSION = "ml-tree-manifest/v2"

/** The SHA-256 of one file's bytes. */
async function hashFile(path) {
	return createHash("sha256").update(await readFile(path)).digest("hex")
}

/**
 * The deterministic tree manifest of a directory.
 *
 * Returns `{ version, entries }` where `entries` is an ordered array of
 * `{ path, type, mode, sha256? }` records. An unsupported object type is
 * RECORDED (never silently dropped), so a caller can reject it.
 */
export async function treeManifest(root, { stopAt = ["node_modules"] } = {}) {
	const entries = await listTree(root, { stopAt })
	entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
	const records = []
	for (const entry of entries) {
		const record = { path: entry.path, type: entry.type, mode: entry.mode }
		if (entry.type === "file") record.sha256 = await hashFile(join(root, entry.path))
		records.push(record)
	}
	return { version: TREE_MANIFEST_VERSION, entries: records }
}

/**
 * The VERSIONED tree-manifest digest.
 *
 * `digestOfDirectory(root)` is the HISTORICAL `v1` digest and keeps its
 * historical meaning. `digestOfDirectory(root, { version: "v2" })` is the
 * NEW, explicitly versioned digest, and it is a DIFFERENT identity: it is
 * never compared with a `v1` digest and never overwrites one.
 */
export async function digestOfDirectoryVersioned(root, { version = TREE_MANIFEST_VERSION } = {}) {
	if (version === "v1") return digestOfDirectory(root)
	if (version !== TREE_MANIFEST_VERSION) {
		throw new Error(`unknown_tree_manifest_version:${version}`)
	}
	const manifest = await treeManifest(root)
	const payload = `${manifest.version}\n${manifest.entries.map((e) => JSON.stringify(e)).join("\n")}\n`
	return createHash("sha256").update(payload).digest("hex")
}

/**
 * Locate the fixture-construction seam: the statement that calls
 * `fs.mkdtemp` AND BINDS ITS RESULT TO A VARIABLE.
 *
 * The file contains two `fs.mkdtemp` calls. One is inside the `tmpDir`
 * helper (`return await fs.mkdtemp(...)`) and is NOT the seam — it is the
 * helper under test. The seam is the statement that constructs the
 * hermetic fixture ROOT, and it always binds its result:
 *
 *   const tmpRoot = await fs.mkdtemp(join(tmpdir(), "factory-rec-tmp01-"));
 *
 * Selecting on the declaration distinguishes them without depending on
 * the variable's name or on the argument the candidate chose.
 *
 * The span returned starts at the declaration keyword and ends after the
 * statement's terminating semicolon. Multi-line statements are handled.
 */
export function locateSeam(text) {
	const callPattern = /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:await\s+)?fs\.mkdtemp\s*\(/g
	let match
	let last = null
	while ((match = callPattern.exec(text)) !== null) {
		last = { index: match.index, callStart: match.index + match[0].length - "fs.mkdtemp(".length }
	}
	if (!last) return null
	const start = last.index
	// The statement ends at the first semicolon after the closing paren of
	// the mkdtemp call. The arguments of `fs.mkdtemp` cannot contain one.
	const semiIdx = text.indexOf(";", last.callStart)
	if (semiIdx < 0) return null
	return { start, end: semiIdx + 1 }
}


/**
 * The import statements of a source file, in order.
 *
 * Each entry is the statement's own text, with its trailing semicolon
 * removed. The order is significant: an import list is part of the
 * file's identity.
 */
export function extractImports(text) {
	const imports = []
	const pattern = /^import\b[^;]*;/gm
	let match
	while ((match = pattern.exec(text)) !== null) {
		imports.push(match[0].replace(/;\s*$/, "").trim())
	}
	return imports
}

/**
 * The import specifier of an import statement: the module it names.
 *
 * `import { tmpdir } from "node:os";` -> `node:os`
 * `import assert from "node:assert/strict";` -> `node:assert/strict`
 */
export function importSpecifier(statement) {
	const match = /from\s+["']([^"']+)["']/.exec(statement)
	if (match) return match[1]
	const bare = /^import\s+["']([^"']+)["']/.exec(statement)
	return bare ? bare[1] : undefined
}

/**
 * Normalise a source file so that two versions can be compared OUTSIDE the
 * permitted change region.
 *
 * Removed: the IMPORT STATEMENTS, line comments, and the seam statement.
 *
 * Removing line comments is deliberate: the historical fix documents its
 * reasoning in comments, and a comment is not an assertion. Everything
 * else — every expression, every assertion, every string literal — must
 * match byte for byte.
 *
 * The imports are removed here ONLY because they are compared SEPARATELY
 * and STRICTLY by `validateAllowedRegion`. The previous revision removed
 * them and never compared them, which is how an assertion-library import
 * could be replaced outright and still pass.
 */
export function normaliseOutsideSeam(text) {
	const seam = locateSeam(text)
	let body = text
	if (seam) body = text.slice(0, seam.start) + text.slice(seam.end)
	body = body.replace(/^import\b[^;]*;/gm, "")
	body = body.replace(/^\s*\/\/.*$/gm, "")
	body = body.replace(/\/\*[\s\S]*?\*\//g, "")
	return body.replace(/\s+/g, " ").trim()
}

/**
 * Is a RELATIVE path a path that LEAVES its base directory?
 *
 * `path.relative()` returns a `..`-prefixed path for a target OUTSIDE the
 * base and a plain relative path for a target INSIDE it. The previous
 * revision decided "outside" with `rel.startsWith("..")`, which is a
 * STRING test, not a PATH test: a directory literally named `..nested`
 * produces the relative path `..nested`, which starts with `..` but is
 * INSIDE the base. Such a nested root was therefore reported as
 * disjoint when it actually overlaps.
 *
 * The decision is made on the FIRST PATH SEGMENT: only a segment that is
 * exactly `..` leaves the base.
 */
function leavesBase(rel) {
	if (rel === "") return false
	if (isAbsolute(rel)) return true
	return rel.split("/")[0] === ".."
}

/**
 * Describe the identity/overlap relationship between two tree roots.
 *
 * Returns `null` when the roots are distinct and disjoint, and a typed
 * error code otherwise:
 *
 *   - `reference_and_workspace_are_the_same_tree`
 *   - `reference_root_overlaps_workspace_root`
 *
 * The paths are RESOLVED first, so `a/../a`, a symlinked alias and the
 * real path are all recognised as the same tree.
 */
export function describeRootOverlap(refDir, wsDir) {
	let refReal
	let wsReal
	try {
		refReal = realpathSync(refDir)
		wsReal = realpathSync(wsDir)
	} catch {
		// A root that does not exist cannot overlap anything; the
		// enumeration step reports it.
		return null
	}
	if (refReal === wsReal) return "reference_and_workspace_are_the_same_tree"
	const rel = relative(wsReal, refReal)
	if (!leavesBase(rel)) {
		// The reference lives INSIDE the workspace.
		return "reference_root_overlaps_workspace_root"
	}
	const relBack = relative(refReal, wsReal)
	if (!leavesBase(relBack)) {
		// The workspace lives INSIDE the reference.
		return "reference_root_overlaps_workspace_root"
	}
	return null
}

/**
 * Compare a candidate workspace against an evaluator-owned reference tree.
 *
 * Fails closed: an enumeration error is returned, never swallowed.
 */
export async function compareTrees(
	refDir,
	wsDir,
	{ allowedPaths = ALLOWED_PATHS, exemptDependencyPaths = [] } = {},
) {
	const violations = []
	// IDENTITY AND OVERLAP. The candidate workspace must be a DISTINCT
	// tree from the reference. A self-comparison (`compareTrees(".", ".")`)
	// finds zero violations for ANY unauthorised change, which is exactly
	// how the previous revision could report a scope-clean verdict for a
	// candidate that had rewritten the fixture.
	//
	// The comparison is on RESOLVED paths, so a symlink or a `..` segment
	// cannot disguise the identity.
	const overlap = describeRootOverlap(refDir, wsDir)
	if (overlap !== null) {
		return { error: overlap, violations }
	}
	let refEntries
	let wsEntries
	try {
		refEntries = await listTree(refDir)
		wsEntries = await listTree(wsDir)
	} catch (cause) {
		return { error: "enumeration_failed", violations }
	}

	// The reference must be a plain tree: no dependency tree, no symlink.
	for (const entry of refEntries) {
		if (entry.type === "symlink") {
			return { error: `reference_contains_symlink:${entry.path}`, violations }
		}
		if (entry.path === "node_modules" || entry.path.endsWith("/node_modules")) {
			return { error: `reference_contains_dependency_tree:${entry.path}`, violations }
		}
	}

	// Two views of the same trees: EVERY entry (for presence and object
	// type) and every NON-DIRECTORY entry (for content comparison).
	const refAll = new Map(refEntries.map((e) => [e.path, e]))
	const wsAll = new Map(wsEntries.map((e) => [e.path, e]))
	const refMap = new Map(refEntries.filter((e) => e.type !== "dir").map((e) => [e.path, e]))
	const wsMap = new Map(wsEntries.filter((e) => e.type !== "dir").map((e) => [e.path, e]))

	// PROTECTED DIRECTORY IDENTITY AND MODES.
	//
	// The previous revision compared modes only for NON-DIRECTORY entries,
	// so a candidate could `chmod 700` a protected DIRECTORY and the
	// change was invisible: the directory's own path was present in both
	// trees, so it was not an ADDED entry, and directories were excluded
	// from the content comparison, so its mode was never read.
	//
	// A directory's PRESENCE and MODE are part of the protected tree's
	// identity. Every directory present in BOTH trees must carry the SAME
	// mode, and a directory present ONLY in the reference (including an
	// EMPTY one, which contributes no file and was therefore invisible to
	// the previous revision) is a DELETION.
	for (const [path, ref] of refAll) {
		if (ref.type !== "dir") continue
		const ws = wsAll.get(path)
		if (!ws) {
			// The directory was removed — including an EMPTY directory,
			// which carries no file and was invisible to the previous
			// revision.
			violations.push({ kind: "DELETED", path })
			continue
		}
		if (ws.type !== "dir") {
			// A protected directory replaced by a non-directory is a TYPE
			// SUBSTITUTION.
			violations.push({ kind: "TYPE_SUBSTITUTED", path })
			continue
		}
		if (ws.mode !== ref.mode) {
			violations.push({ kind: "MODE_CHANGED", path })
		}
	}

	for (const [path, ref] of refMap) {
		const ws = wsMap.get(path)
		if (!ws) {
			// The entry may have been replaced by a DIRECTORY. The
			// previous revision compared only NON-DIRECTORY entries, so a
			// type substitution was reported as a plain DELETION — or, when
			// the directory was empty, was invisible altogether.
			const wsDir = wsAll.get(path)
			if (wsDir && wsDir.type === "dir") {
				violations.push({ kind: "TYPE_SUBSTITUTED", path })
				continue
			}
			violations.push({ kind: "DELETED", path })
			continue
		}
		if (ws.type === "symlink" || ws.type === "other") {
			// A protected regular file replaced with a symlink is an
			// unsupported object type for this oracle. Fail closed.
			violations.push({ kind: "UNSUPPORTED_OBJECT", path })
			continue
		}
		if (ws.type !== ref.type) {
			// A protected regular file replaced by a DIRECTORY is a TYPE
			// SUBSTITUTION. The previous revision compared the CONTENT of
			// the two entries, and a directory cannot be read as a file, so
			// the substitution was either invisible or crashed the
			// comparison.
			violations.push({ kind: "TYPE_SUBSTITUTED", path })
			continue
		}
		if (ws.mode !== ref.mode) {
			violations.push({ kind: "MODE_CHANGED", path })
		}
		const refBuf = await readFile(join(refDir, path))
		const wsBuf = await readFile(join(wsDir, path))
		if (
			createHash("sha256").update(refBuf).digest("hex") !==
			createHash("sha256").update(wsBuf).digest("hex")
		) {
			// A modification of an allowed path is the candidate's job; it
			// is checked separately by the allowed-region rule. Any other
			// modification is a scope violation.
			if (!allowedPaths.includes(path)) {
				violations.push({ kind: "MODIFIED", path })
			}
		}
	}

	for (const [path, ws] of wsAll) {
		if (refAll.has(path)) continue
		if (exemptDependencyPaths.includes(path) && ws.type === "symlink") {
			// The evaluator's own dependency tree, symlinked into the
			// workspace. It is trusted by IDENTITY (the dependency-trust
			// step proves it resolves to the evaluator's tree), not by
			// content, and it is excluded from the content diff.
			//
			// The exemption requires a SYMLINK. A candidate-owned dependency
			// tree is a real DIRECTORY, and is a violation below.
			continue
		}
		const base = path.split("/").pop()
		if (
			base === "node_modules" ||
			FORBIDDEN_DEPENDENCY_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
		) {
			// A candidate-owned dependency tree is a violation even though the
			// dependency tree itself is excluded from the content diff.
			violations.push({ kind: "FORBIDDEN_DEPENDENCY", path })
			continue
		}
		if (ws.type === "symlink" || ws.type === "other") {
			violations.push({ kind: "UNSUPPORTED_OBJECT", path })
			continue
		}
		violations.push({ kind: "ADDED", path })
	}

	return { error: null, violations }
}

/**
 * Parse a NEWLINE-DELIMITED JSON event stream.
 *
 * The previous revision used a brace-depth scanner over the whole stream.
 * A permissive scanner cannot tell a TRUNCATED stream from a complete
 * one: a stream cut in half still yields the records it managed to
 * parse, and the oracle would then treat "the required test's record
 * happens to be missing" as a scope problem rather than as an
 * untrustworthy observation.
 *
 * The stream format is now NDJSON with an explicit COMPLETION record as
 * the LAST record. Parsing therefore yields THREE outcomes:
 *
 *   - `malformed`: a line is not valid JSON. The stream is untrustworthy.
 *   - `truncated`: the stream does not end with the completion record.
 *   - `ok`: every line parsed and the completion record is present.
 *
 * A permissive brace scanner cannot express any of the three.
 */
export function parseEventStream(text) {
	const lines = text.split("\n")
	const records = []
	let complete = null
	let sawComplete = false
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index].trim()
		if (line.length === 0) continue
		let parsed
		try {
			parsed = JSON.parse(line)
		} catch {
			return { error: "malformed_event_stream", records: [], complete: null, line: index + 1 }
		}
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return { error: "malformed_event_record", records: [], complete: null, line: index + 1 }
		}
		if (parsed.kind === "complete") {
			// The completion record must be LAST. Anything after it means the
			// stream is not the stream the reporter produced.
			for (let rest = index + 1; rest < lines.length; rest += 1) {
				if (lines[rest].trim().length > 0) {
					return { error: "records_after_completion", records: [], complete: null, line: rest + 1 }
				}
			}
			complete = parsed
			sawComplete = true
			continue
		}
		records.push(parsed)
	}
	if (!sawComplete) {
		return { error: "truncated_event_stream", records, complete: null }
	}
	return { error: null, records, complete }
}

/**
 * Classify the structured events emitted by the Node test reporter.
 *
 * Each event describes ONE test: its exact name, its exact relative
 * source file, its status and the chain of error codes it produced.
 * Nothing is inferred from free text.
 */
export function classifyEvents(stdout, { runnerCounts } = {}) {
	const parsed = parseEventStream(stdout)
	if (parsed.error) {
		return {
			error: parsed.error,
			tests: [],
			counts: { passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 },
			fileError: false,
			total: 0,
			complete: false,
		}
	}
	const tests = []
	let fileError = false
	// MALFORMED OR UNKNOWN terminal observations are NOT silently
	// discarded. The previous revision `continue`d past them, so a stream
	// carrying a malformed or unknown record still produced a complete,
	// reconciling verdict about a SUBSET of the run.
	const malformedReasons = []
	for (const event of parsed.records) {
		if (typeof event.name !== "string" || event.name.length === 0) {
			malformedReasons.push("terminal_observation_without_identity")
			continue
		}
		if (event.kind === "file") {
			// A FILE-LEVEL failure: the test file could not even be loaded.
			fileError = true
			continue
		}
		if (event.kind === "suite") {
			// A SUITE is not a test. The runner counts suites separately
			// (`counts.suites`), so a suite must not be counted as a test
			// observation.
			continue
		}
		const status = event.status
		if (
			status !== "pass" &&
			status !== "fail" &&
			status !== "skip" &&
			status !== "todo" &&
			status !== "cancel"
		) {
			// An invalid terminal status is an invalid observation.
			malformedReasons.push(`unknown_terminal_status:${String(status)}`)
			continue
		}
		tests.push({
			name: event.name,
			file: typeof event.file === "string" ? event.file : undefined,
			status,
			codes: Array.isArray(event.codes) ? event.codes : [],
			messages: Array.isArray(event.messages) ? event.messages : [],
		})
	}

	// COMPLETION EVIDENCE. The runner's own counts must agree with the
	// number of terminal observations the stream carries. A stream that
	// lost records cannot produce an acceptance.
	//
	// The runner's summary counts are RECONCILED against the observed
	// per-status counts, not merely against a total:
	//
	//   - the runner's `tests` total must equal the number of observed
	//     terminal test observations;
	//   - each per-status count the runner reports must equal the number
	//     of observations with that status;
	//   - the runner's per-status counts must SUM to its own total.
	//
	// The previous revision compared only `observed < runnerTotal`, so a
	// stream carrying MORE observations than the runner reported, or
	// observations whose per-status breakdown contradicted the runner's
	// breakdown, was accepted. A completion record with NULL counts, an
	// inconsistent total and contradictory status counts were all
	// accepted. A completion record that does not reconcile is NOT
	// completion evidence.
	const counts = { passed: 0, failed: 0, skipped: 0, todo: 0, cancelled: 0 }
	for (const test of tests) {
		if (test.status === "pass") counts.passed += 1
		else if (test.status === "fail") counts.failed += 1
		else if (test.status === "skip") counts.skipped += 1
		else if (test.status === "todo") counts.todo += 1
		else if (test.status === "cancel") counts.cancelled += 1
	}
	const reported = parsed.complete?.counts ?? null
	const observed = tests.length
	let complete = true
	const reasons = [...malformedReasons]
	if (malformedReasons.length > 0) {
		complete = false
		reasons.unshift("malformed_terminal_observations")
	}
	// THE COMPLETE EVENT-COUNTER CONTRACT.
	//
	// The pinned runner contract (the Node test runner's own
	// `test:summary` counts, as observed on THIS host's Node v26.0.0)
	// carries these counters:
	//
	//   tests     the cumulative test count of the whole invocation
	//   passed    the tests that PASSED
	//   failed    the tests that FAILED
	//   skipped   the tests that were SKIPPED
	//   todo      the tests that are TODO
	//   cancelled the tests that were CANCELLED
	//
	// EVERY ONE OF THEM MUST BE PRESENT and MUST be a NONNEGATIVE
	// INTEGER. The previous revision only compared the per-status counts
	// that happened to be present (`if (typeof runnerValue !== "number")
	// continue`), so a completion record that carried only
	// `{"counts":{"tests":9}}` was accepted, and its missing per-status
	// counters were silently ignored. A completion record that does not
	// carry the WHOLE contract is not completion evidence.
	//
	// The reconciliation is UNCONDITIONAL: the five per-status counters
	// must sum to the reported total, and each must equal the number of
	// observed terminal observations with that status. A zero sum is NOT
	// exempt: an all-zero record still has to be consistent with zero
	// observations.
	const statusMap = [
		["passed", "passed"],
		["failed", "failed"],
		["skipped", "skipped"],
		["todo", "todo"],
		["cancelled", "cancelled"],
	]
	let runnerTotal
	if (reported === null || typeof reported !== "object" || Array.isArray(reported)) {
		// A completion record with NO counts is not completion evidence.
		complete = false
		reasons.push("completion_record_carries_no_counts")
	} else {
		const required = ["tests", ...statusMap.map(([runnerKey]) => runnerKey)]
		for (const key of required) {
			const value = reported[key]
			if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
				complete = false
				reasons.push(`completion_record_counter_missing_or_invalid:${key}`)
			}
		}
		runnerTotal = typeof reported.tests === "number" ? reported.tests : undefined
		if (typeof runnerTotal === "number") {
			if (observed < runnerTotal) {
				// The stream carries FEWER terminal observations than the
				// runner reported: records were lost. Not acceptable.
				complete = false
				reasons.push("fewer_observations_than_reported")
			} else if (observed > runnerTotal) {
				// The stream carries MORE terminal observations than the
				// runner reported: the observations are not the runner's
				// own. Not acceptable.
				complete = false
				reasons.push("more_observations_than_reported")
			}
		}
		// PER-STATUS RECONCILIATION.
		let statusSum = 0
		for (const [runnerKey, observedKey] of statusMap) {
			const runnerValue = reported[runnerKey]
			if (typeof runnerValue !== "number") continue
			statusSum += runnerValue
			if (runnerValue !== counts[observedKey]) {
				complete = false
				reasons.push(`count_mismatch_${runnerKey}`)
			}
		}
		if (typeof runnerTotal === "number" && statusSum !== runnerTotal) {
			// The runner's own per-status counts do not sum to its own
			// total. The completion record contradicts itself.
			complete = false
			reasons.push("runner_counts_inconsistent")
		}
	}
	return {
		error: null,
		tests,
		counts,
		fileError,
		total: observed,
		expectedTotal: runnerTotal,
		complete,
		completeReasons: reasons,
	}
}

/**
 * Find the terminal observation for ONE required test identity.
 *
 * The identity is (file, name). A match by NAME ALONE is not enough:
 * the same test name in another file is a different test.
 *
 * The outcome distinguishes four cases:
 *
 *   - `ok`:       exactly one observation, in the right file.
 *   - `missing`:  no observation at all.
 *   - `ambiguous`:more than one observation for the identity.
 *   - `invalid`:  the identity itself is unusable (no file or no name).
 */
export function findRequiredTest(classified, requirement) {
	const name = requirement?.name
	const file = requirement?.file
	if (typeof name !== "string" || name.length === 0) {
		return { outcome: "invalid", status: undefined }
	}
	if (typeof file !== "string" || file.length === 0) {
		return { outcome: "invalid", status: undefined }
	}
	const matches = classified.tests.filter((t) => t.name === name && t.file === file)
	if (matches.length === 0) return { outcome: "missing", status: undefined }
	if (matches.length > 1) return { outcome: "ambiguous", status: undefined }
	return { outcome: "ok", status: matches[0].status, test: matches[0] }
}

/**
 * The acceptance decision.
 *
 * Every required test must be:
 *
 *   - PRESENT      (exactly one terminal observation, in its exact file);
 *   - EXECUTED     (not skipped, not todo, not cancelled);
 *   - PASSING;
 *
 * and the whole run must be healthy: no file-level error, no failed test,
 * a complete (non-truncated) event stream, and a successful process exit.
 */
export function decideAcceptance(
	classified,
	requiredTests = REQUIRED_TESTS,
	{ processExit = 0, additionalRequired = [] } = {},
) {
	const reasons = []
	const perTest = []
	let present = true
	let passing = true
	let executed = 0
	const allRequired = [...requiredTests, ...additionalRequired]
	for (const req of allRequired) {
		const found = findRequiredTest(classified, req)
		if (found.outcome === "invalid") {
			present = false
			passing = false
			perTest.push({ label: req.label, status: "INVALID_IDENTITY" })
			reasons.push(`INVALID_IDENTITY ${req.label}`)
			continue
		}
		if (found.outcome === "missing") {
			present = false
			passing = false
			perTest.push({ label: req.label, status: "MISSING" })
			reasons.push(`MISSING ${req.label}`)
			continue
		}
		if (found.outcome === "ambiguous") {
			present = false
			passing = false
			perTest.push({ label: req.label, status: "AMBIGUOUS" })
			reasons.push(`AMBIGUOUS ${req.label}`)
			continue
		}
		perTest.push({ label: req.label, status: found.status })
		if (found.status === "skip") {
			passing = false
			reasons.push(`SKIPPED ${req.label}`)
			continue
		}
		if (found.status === "todo") {
			passing = false
			reasons.push(`TODO ${req.label}`)
			continue
		}
		if (found.status === "cancel") {
			passing = false
			reasons.push(`CANCELLED ${req.label}`)
			continue
		}
		executed += 1
		if (found.status !== "pass") {
			passing = false
			reasons.push(`FAILED ${req.label}`)
		}
	}

	// The SOCK tests are the APPLICABLE siblings. A SKIPPED or TODO SOCK
	// test is the historical defect class (a silently skipped test) and is
	// a failure even when every REC test passed.
	for (const test of classified.tests) {
		if (!test.file || !test.file.includes("ledger-writer-socket-probe.test.ts")) continue
		if (test.status === "skip" || test.status === "todo" || test.status === "cancel") {
			passing = false
			reasons.push(`NOT_EXECUTED ${test.name}`)
		}
	}

	const unavailable =
		classified.error !== null && classified.error !== undefined
			? true
			: classified.fileError || classified.total === 0
	if (unavailable) reasons.push("GATE_UNAVAILABLE")
	if (classified.counts && classified.counts.failed > 0) reasons.push("GATE_FAILED")
	if (classified.complete === false) reasons.push("EVENT_STREAM_INCOMPLETE")
	if (processExit !== 0) reasons.push(`PROCESS_EXIT_${processExit}`)

	const acceptance =
		!unavailable &&
		classified.complete !== false &&
		processExit === 0 &&
		classified.counts.failed === 0 &&
		classified.counts.passed > 0 &&
		present &&
		passing &&
		executed === allRequired.length
			? "PASS"
			: "FAIL"
	return { acceptance, present, passing, executed, perTest, reasons, unavailable }
}

/**
 * The mutation decision: FAILURE IDENTITY.
 *
 * A mutation counts as detected ONLY when the required test itself ran, in
 * the mutant, and failed THROUGH the intended mechanism — an error whose
 * chain carries the intended code, in THAT test's own error chain, in
 * THAT test's own file. An unrelated diagnostic elsewhere in the run is
 * irrelevant.
 *
 * A TIMEOUT, a PARSER FAILURE or an UNRELATED EXECUTION FAILURE is not
 * successful mutation detection.
 *
 * THE PROCESS EXIT IS PART OF THE EVIDENCE.
 *
 * The previous revision refused only exit 124 (the timeout sentinel). Every
 * other exit status was accepted, so:
 *
 *   - exit 0   — the runner reported SUCCESS while the required test was
 *                observed failing. The two observations contradict each
 *                other; at most one of them is the runner's own.
 *   - exit 137 — the process was KILLED (SIGKILL). The event stream was
 *                cut short by the kill, and the intended failure may have
 *                been produced by a run that never reached its own verdict.
 *
 * A detection therefore requires the EXPECTED MUTANT TEST-FAILURE EXIT: a
 * non-zero status that is neither the timeout sentinel nor a signal death.
 * Node's test runner exits 1 when a test fails.
 */
export function decideMutation(
	classified,
	requiredName,
	intendedCode = INTENDED_FAILURE_CODE,
	{ requiredFile = undefined, processExit = undefined } = {},
) {
	if (classified.error) {
		return {
			status: "EXECUTION_FAILURE",
			detected: false,
			note: `event_stream_${classified.error}`,
		}
	}
	const matches = classified.tests.filter(
		(t) =>
			t.name === requiredName &&
			(requiredFile === undefined || t.file === requiredFile),
	)
	if (matches.length === 0) {
		return { status: "EXECUTION_FAILURE", detected: false, note: "required_test_absent_in_mutant" }
	}
	if (matches.length > 1) {
		return { status: "EXECUTION_FAILURE", detected: false, note: "required_test_ambiguous_in_mutant" }
	}
	const found = matches[0]
	if (found.status === "skip" || found.status === "todo" || found.status === "cancel") {
		return {
			status: "EXECUTION_FAILURE",
			detected: false,
			note: "required_test_not_executed_in_mutant",
		}
	}
	if (found.status === "pass") {
		return { status: "MUTATION_SURVIVED", detected: false, note: "mutant_passed_mutation_survived" }
	}
	// The mutant run must itself have completed. A mutant whose process
	// died for an unrelated reason did not DETECT the mutation.
	if (classified.complete === false) {
		return {
			status: "EXECUTION_FAILURE",
			detected: false,
			note: "mutant_event_stream_incomplete",
		}
	}
	// THE EXPECTED MUTANT TEST-FAILURE PROCESS EXIT.
	//
	// The detection requires EXACTLY the established Node test-runner
	// failure exit: `processExit === 1`.
	//
	// The previous revision refused only a TIMEOUT (124) and a SIGNAL
	// DEATH (>= 128), and accepted every other status — including 2, 125,
	// 126 and 127, which are NOT the Node test runner's failure exit. A
	// mutant that died for an unrelated infrastructure reason, or that
	// exited with some other non-zero status, was reported DETECTED.
	//
	// A timeout, a signal death, a missing exit, a parser failure and any
	// unrelated execution failure are NOT mutation detection.
	if (processExit === undefined) {
		return {
			status: "EXECUTION_FAILURE",
			detected: false,
			note: "mutant_process_exit_unknown",
		}
	}
	if (processExit === 124) {
		return { status: "EXECUTION_FAILURE", detected: false, note: "mutant_run_timed_out" }
	}
	if (processExit >= 128) {
		// A signal death (SIGKILL is 137). The run was killed; its event
		// stream is not the runner's own completed verdict.
		return {
			status: "EXECUTION_FAILURE",
			detected: false,
			note: `mutant_process_killed_exit_${processExit}`,
		}
	}
	if (processExit === 0) {
		// The runner exited successfully while the required test was
		// observed failing. The observations contradict each other.
		return {
			status: "EXECUTION_FAILURE",
			detected: false,
			note: "mutant_process_exit_zero_contradicts_observed_failure",
		}
	}
	if (processExit !== MUTANT_FAILURE_EXIT) {
		// Any other non-zero exit is an UNRELATED execution failure, not
		// the runner's own test-failure verdict.
		return {
			status: "EXECUTION_FAILURE",
			detected: false,
			note: `mutant_process_exit_unexpected_${processExit}`,
		}
	}
	if (found.codes.includes(intendedCode)) {
		return {
			status: "DETECTED",
			detected: true,
			note: "required_test_failed_with_intended_code",
		}
	}
	return {
		status: "WRONG_FAILURE",
		detected: false,
		note: "required_test_failed_with_unintended_mechanism",
	}
}

/**
 * Apply the known-bad mutation to a source file.
 *
 * The mutation replaces the WHOLE seam statement, so it always yields
 * syntactically valid source regardless of how the candidate wrote the fix.
 *
 * Returns `{ text, applied }`. `applied` is false when the seam could not
 * be located or when the replacement is byte-identical to the original (a
 * mutation that changes nothing is NOT evidence of anything).
 */
export function applyKnownBadMutation(text) {
	const seam = locateSeam(text)
	if (!seam) return { text, applied: false }
	const mutated = text.slice(0, seam.start) + KNOWN_BAD_SEAM_STATEMENT + text.slice(seam.end)
	if (mutated === text) return { text, applied: false }
	return { text: mutated, applied: true }
}

/**
 * Validate the candidate's change to an allowed path.
 *
 * Permitted: the fixture-construction seam and the imports it needs.
 * Everything else — every assertion, every literal — must be unchanged.
 */
export function validateAllowedRegion(referenceText, candidateText) {
	const refSeam = locateSeam(referenceText)
	const candSeam = locateSeam(candidateText)
	if (!refSeam) return { ok: false, reason: "reference_seam_not_locatable" }
	if (!candSeam) return { ok: false, reason: "candidate_seam_not_locatable" }

	// The IMPORTS are compared STRICTLY and SEPARATELY.
	//
	// Every import the reference carries must still be present in the
	// candidate, with the SAME specifier. In particular the assertion
	// library and the test runner may not be replaced, dropped or
	// re-pointed. The previous revision removed every import before
	// comparing, so replacing the assertion import passed.
	//
	// The candidate may ADD imports: for this smoke fixture the permitted
	// addition is the `node:os` import the historical fix needs. An
	// addition from any other module is refused.
	const refImports = extractImports(referenceText)
	const candImports = extractImports(candidateText)
	for (const statement of refImports) {
		const specifier = importSpecifier(statement)
		if (!candImports.includes(statement)) {
			return {
				ok: false,
				reason: "existing_import_removed_or_replaced",
				import: statement,
				specifier: specifier ?? "",
			}
		}
	}
	for (const statement of candImports) {
		if (refImports.includes(statement)) continue
		const specifier = importSpecifier(statement)
		if (specifier !== "node:os") {
			return {
				ok: false,
				reason: "import_added_outside_the_permitted_region",
				import: statement,
				specifier: specifier ?? "",
			}
		}
	}

	if (normaliseOutsideSeam(referenceText) !== normaliseOutsideSeam(candidateText)) {
		return { ok: false, reason: "content_changed_outside_the_permitted_region" }
	}
	return { ok: true, reason: "within_the_permitted_region" }
}
