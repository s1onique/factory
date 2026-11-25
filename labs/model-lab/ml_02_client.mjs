/**
 * ml_02_client.mjs — the NATIVE control-seam client and its SIMULATED
 * counterpart (ACT ML-02).
 *
 * THE ACTUAL PROTOCOL
 * -------------------
 * The runner speaks the ACTUAL native Unix-domain-socket protocol of the
 * installed ClineMM extension host. No request field is invented here.
 * The wire is NDJSON: one JSON object per line, `v: 1`, an operation id,
 * the read bearer token, the SEPARATE write token for mutations, and the
 * operation-specific payload.
 *
 * The schemas are the ones in
 * `apps/vscode/src/sdk/control-seam/control-seam-protocol.ts` of the
 * installed ClineMM repository:
 *
 *   clinemm_capabilities  { v, op, token }
 *   clinemm_get_run       { v, op, token }
 *   clinemm_start_act     { v, op, token, writeToken,
 *                           payload: { op, input: { requestId, prompt,
 *                                                     expectedWorkspace } } }
 *   clinemm_read_events   { v, op, token, writeToken,
 *                           payload: { op, input: { sessionId, afterCursor,
 *                                                     limit } } }
 *   clinemm_cancel_run    { v, op, token, writeToken,
 *                           payload: { op, input: { requestId, sessionId,
 *                                                     expectedEpoch } } }
 *
 * THE SIMULATED SEAM
 * ------------------
 * The simulated seam is a minimal, DETERMINISTIC stand-in for the
 * extension host's listener. It answers the ACTUAL protocol on an ACTUAL
 * AF_UNIX socket, with the ACTUAL request and response shapes, so the
 * runner's real client and runner logic are exercised unchanged.
 *
 * It is NOT a fake agent: it produces no candidate work. It only answers
 * the lifecycle operations, so the runner's own decisions can be
 * exercised without paid inference.
 */

import net from "node:net"
import { rmSync } from "node:fs"

/** The native control-seam protocol version this runner speaks. */
export const CONTROL_SEAM_PROTOCOL_VERSION = 1

/** The registered operation ids, in the protocol's own order. */
export const CONTROL_SEAM_OPERATION_IDS = [
	"clinemm_capabilities",
	"clinemm_get_run",
	"clinemm_start_act",
	"clinemm_read_events",
	"clinemm_send_feedback",
	"clinemm_cancel_run",
]

/** The READ-ONLY operation ids. */
export const CONTROL_SEAM_READ_OPERATION_IDS = ["clinemm_capabilities", "clinemm_get_run"]

/**
 * The NATIVE CONTROL-SEAM CLIENT.
 *
 * One request, one response, over the AF_UNIX socket. The socket is
 * opened and closed per request: the protocol is a strict
 * request/response exchange, and a fresh connection per request keeps
 * the client stateless and its failures attributable.
 */
export class NativeControlSeamClient {
	constructor({ seamDir, readToken, writeToken, requestTimeoutMs = 10_000 }) {
		this.seamDir = seamDir
		this.socketPath = `${seamDir}/control.sock`
		this.readToken = readToken
		this.writeToken = writeToken
		this.requestTimeoutMs = requestTimeoutMs
	}

	/** Is this a mutating operation? */
	static isMutating(op) {
		return !CONTROL_SEAM_READ_OPERATION_IDS.includes(op)
	}

	/** One request, one response. */
	request(op, payload = undefined, { mutate = undefined } = {}) {
		const isMutating = mutate === undefined ? NativeControlSeamClient.isMutating(op) : mutate
		const envelope = { v: CONTROL_SEAM_PROTOCOL_VERSION, op, token: this.readToken }
		if (isMutating) {
			if (!this.writeToken) {
				return Promise.resolve({
					ok: false,
					error: { code: "control_seam_mutation_not_authorized", message: "no write credential" },
				})
			}
			envelope.writeToken = this.writeToken
		}
		if (payload !== undefined) envelope.payload = payload

		const line = `${JSON.stringify(envelope)}\n`
		return new Promise((resolvePromise) => {
			const socket = net.createConnection(this.socketPath)
			let buffer = ""
			let settled = false
			const settle = (value) => {
				if (settled) return
				settled = true
				try {
					socket.destroy()
				} catch {
					// The socket may already be closed.
				}
				resolvePromise(value)
			}
			const timer = setTimeout(() => {
				settle({ ok: false, error: { code: "control_seam_request_timeout", message: "no response" } })
			}, this.requestTimeoutMs)
			timer.unref?.()
			socket.on("connect", () => socket.write(line))
			socket.on("data", (chunk) => {
				buffer += chunk.toString()
				const index = buffer.indexOf("\n")
				if (index < 0) return
				const text = buffer.slice(0, index).trim()
				clearTimeout(timer)
				try {
					settle(JSON.parse(text))
				} catch {
					settle({ ok: false, error: { code: "control_seam_malformed_response", message: "response is not JSON" } })
				}
			})
			socket.on("error", (error) => {
				clearTimeout(timer)
				settle({ ok: false, error: { code: "control_seam_transport_error", message: error.message } })
			})
			socket.on("close", () => {
				clearTimeout(timer)
				settle({ ok: false, error: { code: "control_seam_connection_closed", message: "closed before a response" } })
			})
		})
	}
}

/**
 * The SIMULATED native control seam.
 *
 * It is a minimal, DETERMINISTIC stand-in for the extension host's
 * listener: it answers the ACTUAL protocol on an ACTUAL AF_UNIX socket,
 * with the ACTUAL request and response shapes.
 */
export class SimulatedControlSeam {
	constructor({
		socketPath,
		token = "sim-read-token",
		writeToken = "sim-write-token",
		extensionVersion = "simulated-0.0.0",
	} = {}) {
		this.socketPath = socketPath
		this.token = token
		this.writeToken = writeToken
		this.extensionVersion = extensionVersion
		this.server = null
		this.calls = []
		this.startCount = 0
		this.events = []
		this.run = undefined
		this.sessionId = undefined
		this.behaviour = {}
		this.epoch = 1
	}

	/** Configure the simulated seam's response behaviour. */
	configure(behaviour) {
		this.behaviour = { ...this.behaviour, ...behaviour }
		return this
	}

	/** Start the simulated listener. */
	async listen() {
		await new Promise((resolvePromise, rejectPromise) => {
			try {
				rmSync(this.socketPath, { force: true })
			} catch {
				// The socket may not exist.
			}
			this.server = net.createServer((socket) => {
				let buffer = ""
				socket.on("data", (chunk) => {
					buffer += chunk.toString()
					const index = buffer.indexOf("\n")
					if (index < 0) return
					const line = buffer.slice(0, index).trim()
					buffer = buffer.slice(index + 1)
					socket.write(`${JSON.stringify(this.handle(line))}\n`)
				})
				socket.on("error", () => {
					// A broken client connection is not the seam's failure.
				})
			})
			this.server.on("error", rejectPromise)
			this.server.listen(this.socketPath, resolvePromise)
		})
		return this
	}

	/** Stop the simulated listener. */
	async close() {
		if (!this.server) return
		await new Promise((resolvePromise) => this.server.close(resolvePromise))
		this.server = null
		try {
			rmSync(this.socketPath, { force: true })
		} catch {
			// The socket may already be removed.
		}
	}

	/** The one request handler. */
	handle(line) {
		let request
		try {
			request = JSON.parse(line)
		} catch {
			return { v: 1, ok: false, error: { code: "control_seam_bad_request", message: "not JSON" } }
		}
		this.calls.push({ op: request.op, at: Date.now() })
		if (request.token !== this.token) {
			return { v: 1, ok: false, error: { code: "control_seam_unauthorized", message: "bad token" } }
		}
		if (!CONTROL_SEAM_OPERATION_IDS.includes(request.op)) {
			return { v: 1, ok: false, error: { code: "control_seam_unknown_operation", message: request.op } }
		}
		const mutating = NativeControlSeamClient.isMutating(request.op)
		if (mutating) {
			if (!this.behaviour.allowMutation) {
				return {
					v: 1,
					ok: false,
					error: { code: "control_seam_mutation_not_authorized", message: "mutation is disabled" },
				}
			}
			if (request.writeToken !== this.writeToken) {
				return {
					v: 1,
					ok: false,
					error: { code: "control_seam_mutation_not_authorized", message: "bad write token" },
				}
			}
		}
		if (request.op === "clinemm_capabilities") {
			return {
				v: 1,
				ok: true,
				result: {
					protocolVersion: 1,
					readOnly: !mutating,
					operations: mutating
						? CONTROL_SEAM_OPERATION_IDS.map((id) => ({ id, description: id }))
						: CONTROL_SEAM_READ_OPERATION_IDS.map((id) => ({ id, description: id })),
					host: { extensionVersion: this.extensionVersion, platform: process.platform },
				},
			}
		}
		if (request.op === "clinemm_get_run") {
			if (!this.run) {
				return { v: 1, ok: false, error: { code: "control_seam_no_active_run", message: "no active run" } }
			}
			return { v: 1, ok: true, result: { ...this.run } }
		}
		if (request.op === "clinemm_start_act") return this.handleStart(request)
		if (request.op === "clinemm_read_events") return this.handleReadEvents(request)
		if (request.op === "clinemm_cancel_run") return this.handleCancel(request)
		return { v: 1, ok: false, error: { code: "control_seam_unknown_operation", message: request.op } }
	}

	handleStart(request) {
		const input = request.payload?.input
		if (
			!input ||
			typeof input.requestId !== "string" ||
			typeof input.prompt !== "string" ||
			typeof input.expectedWorkspace !== "string"
		) {
			return { v: 1, ok: false, error: { code: "control_seam_bad_request", message: "malformed start payload" } }
		}
		if (this.behaviour.rejectStart) {
			return {
				v: 1,
				ok: true,
				result: { outcome: "rejected", requestId: input.requestId, reason: this.behaviour.rejectStart },
			}
		}
		if (this.behaviour.ambiguousStart) {
			// The host cannot prove whether a start occurred. The client
			// MUST reconcile through read-only observations and MUST NOT
			// retry blindly.
			return { v: 1, ok: false, error: { code: "control_seam_internal", message: "unknown outcome" } }
		}
		if (this.run) {
			return {
				v: 1,
				ok: true,
				result: { outcome: "superseded", requestId: input.requestId, reason: "an active run already exists" },
			}
		}
		if (this.behaviour.expectedWorkspace && input.expectedWorkspace !== this.behaviour.expectedWorkspace) {
			return {
				v: 1,
				ok: true,
				result: { outcome: "rejected", requestId: input.requestId, reason: "workspace_mismatch" },
			}
		}
		this.startCount += 1
		this.sessionId = this.behaviour.sessionId ?? `sim-session-${this.startCount}`
		this.epoch += 1
		this.run = {
			sessionId: this.sessionId,
			taskId: `sim-task-${this.startCount}`,
			running: this.behaviour.keepRunning ?? false,
			taskState: {
				phase: "streaming",
				source: "host",
				seq: 1,
				epoch: this.epoch,
				stateVersion: 1,
				label: "Running",
			},
		}
		this.events = this.behaviour.events ?? [
			{
				cursor: "1",
				epoch: this.epoch,
				type: "say",
				kind: "text",
				ts: Date.now(),
				text: "simulated candidate message",
			},
		]
		return {
			v: 1,
			ok: true,
			result: {
				outcome: "accepted",
				sessionId: this.sessionId,
				taskId: this.run.taskId,
				requestId: input.requestId,
			},
		}
	}

	handleReadEvents(request) {
		const input = request.payload?.input
		if (!input || typeof input.sessionId !== "string") {
			return { v: 1, ok: false, error: { code: "control_seam_bad_request", message: "malformed events payload" } }
		}
		if (!this.sessionId || input.sessionId !== this.sessionId) {
			return { v: 1, ok: false, error: { code: "control_seam_foreign_session", message: "foreign session" } }
		}
		const limit = typeof input.limit === "number" ? input.limit : 20
		const after = input.afterCursor === undefined ? null : Number(input.afterCursor)
		const all = this.events
		const from = after === null ? 0 : after
		const slice = all.slice(from, from + limit)
		const nextIndex = from + slice.length
		const nextCursor = nextIndex < all.length ? String(nextIndex) : undefined
		return {
			v: 1,
			ok: true,
			result: {
				sessionId: this.sessionId,
				events: slice,
				nextCursor,
				cursorExpired: this.behaviour.cursorExpired ?? false,
			},
		}
	}

	handleCancel(request) {
		const input = request.payload?.input
		if (!input || typeof input.sessionId !== "string") {
			return { v: 1, ok: false, error: { code: "control_seam_bad_request", message: "malformed cancel payload" } }
		}
		if (!this.sessionId || input.sessionId !== this.sessionId) {
			return { v: 1, ok: false, error: { code: "control_seam_foreign_session", message: "foreign session" } }
		}
		if (this.run) {
			this.run.running = false
			this.run.taskState = {
				phase: "completed",
				source: "host",
				seq: 2,
				epoch: this.epoch,
				stateVersion: 2,
				label: "Complete",
			}
		}
		return {
			v: 1,
			ok: true,
			result: { outcome: "accepted", requestId: input.requestId, sessionId: this.sessionId, phase: "completed" },
		}
	}
}
