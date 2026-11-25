/**
 * ml_06a_observations.test.ts — the EVALUATOR-OWNED OBSERVATION file for
 * the ML-06A fixture.
 *
 * This file is NOT part of the candidate's authority. It is never copied
 * into the candidate's workspace and the candidate may not edit it.
 *
 * WHY IT IS SEPARATE FROM THE ACCEPTANCE FILE
 * --------------------------------------------
 * An observation records a behaviour that the KNOWN-BAD revision does not
 * have and that the task prompt does not state. It is EXERCISED and
 * REPORTED, but it is NOT bound to the acceptance verdict: requiring it
 * would impose a HIDDEN requirement, which is exactly what a
 * solution-blind fixture must not do.
 *
 * It therefore lives in its OWN file and is executed in its OWN process.
 * A failing observation cannot change the acceptance process's exit
 * status, and therefore cannot change the acceptance verdict.
 *
 * `ML06A-OBS-01` records that the known-bad revision `0bd72f4` violates
 * its own documented "NEVER throws" contract on hostile Proxy input. The
 * known-good revision `5b7508f` adds that boundary guard; a candidate
 * that fixes only the described symptom will NOT have it.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { validateJsonValue } from "../../src/subject/subject-json.js"

test("ML06A-OBS-01: the validator never throws on hostile input", () => {
	// This is an OBSERVATION, not a REQUIREMENT.
	//
	// The base revision `0bd72f4` violates its OWN documented contract
	// here: its `validateJsonValue` has no outer try/catch, so a Proxy
	// whose `ownKeys` trap throws propagates out of the validator. The
	// known-good revision `5b7508f` adds that boundary guard.
	//
	// That is a SECOND, INDEPENDENT defect. The ML-06A task prompt
	// describes only the shared-substructure false rejection, so
	// requiring this behaviour would impose a requirement the prompt
	// never states — a hidden requirement, which is exactly what a
	// solution-blind fixture must not do.
	//
	// The observation is therefore EXERCISED and REPORTED, and it is NOT
	// bound to the acceptance verdict. A candidate that fixes the
	// described symptom and leaves this pre-existing defect in place is
	// an ACCEPTANCE.
	const hostile = new Proxy(
		{},
		{
			ownKeys() {
				throw new Error("hostile ownKeys")
			},
		},
	)
	let threw = false
	try {
		validateJsonValue(hostile)
	} catch {
		threw = true
	}
	assert.equal(threw, false, "the validator must never throw")
})
