/**
 * ml_06a_acceptance.test.ts — the EVALUATOR-OWNED acceptance test for the
 * ML-06A fixture.
 *
 * This file is NOT part of the candidate's authority. It is never copied
 * into the candidate's workspace and the candidate may not edit it. It
 * lives beside the oracle, not inside the fixture, so a candidate that
 * edits any fixture file cannot reach it.
 *
 * The evaluator copies this file into its OWN reconstruction, at
 * `labs/long-horizon-harness/test/subject/ml-06a-acceptance.test.ts`, and
 * runs it against the candidate's copy of the production file. The
 * relative import below is the harness's own convention: the test lives
 * two levels below the harness root and names the production module
 * through the harness's `.js`-extension import form.
 *
 * What it pins
 * ------------
 * The public contract of `validateJsonValue`:
 *
 *   1. an ORDINARY JSON tree is accepted;
 *   2. SHARED SIBLING OBJECTS are accepted (the same object referenced
 *      from two places);
 *   3. SHARED SIBLING ARRAYS are accepted;
 *   4. SHARED SUBSTRUCTURE AT DIFFERENT DEPTHS is accepted;
 *   5. a DIRECT cycle is rejected;
 *   6. an INDIRECT cycle is rejected;
 *   7. a cycle WITHIN shared substructure is rejected (no over-broad
 *      acceptance introduced by the fix);
 *   8. the EXISTING invalid-value behaviour is preserved (undefined,
 *      non-finite numbers, BigInt, Symbol, function, Date, Map, Set,
 *      Promise);
 *  10. INPUT IMMUTABILITY is preserved: the validator does not reshape
 *      the input, and the returned value is the SAME reference as the
 *      input.
 *
 * The checks are INEXPENSIVE and DETERMINISTIC: pure function calls, no
 * I/O, no subprocess, no clock, no randomness.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

import { validateJsonValue } from "../../src/subject/subject-json.js"

test("ML06A-01: an ordinary JSON tree is accepted", () => {
	const r = validateJsonValue({ a: 1, b: [1, { c: "x" }], d: null, e: true })
	assert.equal(r.ok, true, "an ordinary JSON tree must be accepted")
})

test("ML06A-02: shared sibling OBJECTS are accepted", () => {
	const shared = { k: 1 }
	const r = validateJsonValue({ left: shared, right: shared })
	assert.equal(r.ok, true, "a manifest may reuse the same nested object in two places")
})

test("ML06A-03: shared sibling ARRAYS are accepted", () => {
	const shared = [1, 2]
	const r = validateJsonValue({ left: shared, right: shared })
	assert.equal(r.ok, true, "a manifest may reuse the same nested array in two places")
})

test("ML06A-04: shared substructure at DIFFERENT DEPTHS is accepted", () => {
	const deep = { m: { n: 1 } }
	const r = validateJsonValue({ a: deep, b: { c: deep } })
	assert.equal(r.ok, true, "shared substructure at different depths is not a cycle")
})

test("ML06A-05: a DIRECT cycle is rejected", () => {
	const o: Record<string, unknown> = {}
	o["self"] = o
	const r = validateJsonValue(o)
	assert.equal(r.ok, false, "an object that contains itself must be refused")
	if (!r.ok) assert.match(r.reason, /\$\.self/)
})

test("ML06A-06: an INDIRECT cycle is rejected", () => {
	const a: Record<string, unknown> = {}
	const b: Record<string, unknown> = { a }
	a["b"] = b
	const r = validateJsonValue(a)
	assert.equal(r.ok, false, "an indirect back-edge must be refused")
	if (!r.ok) assert.match(r.reason, /\$\.b\.a/)
})

test("ML06A-07: a cycle WITHIN shared substructure is rejected", () => {
	const shared: Record<string, unknown> = {}
	shared["self"] = shared
	const r = validateJsonValue({ left: shared, right: shared })
	assert.equal(r.ok, false, "sharing must not launder a genuine cycle")
})

test("ML06A-08: the existing invalid-value behaviour is preserved", () => {
	const cases: ReadonlyArray<readonly [unknown, RegExp]> = [
		[{ x: undefined }, /unsupported JSON-value type/],
		[{ x: NaN }, /non-finite/],
		[{ x: Infinity }, /non-finite/],
		[{ x: BigInt(1) }, /unsupported JSON-value type/],
		[{ x: Symbol("s") }, /unsupported JSON-value type/],
		[{ x: () => 1 }, /unsupported JSON-value type/],
		[{ x: new Date() }, /non-plain object/],
		[{ x: new Map() }, /non-plain object/],
		[{ x: new Set() }, /non-plain object/],
		[{ x: Promise.resolve(1) }, /non-plain object/],
	]
	for (const [value, pattern] of cases) {
		const r = validateJsonValue(value)
		assert.equal(r.ok, false, "expected rejection for " + String(value))
		if (!r.ok) assert.match(r.reason, pattern)
	}
})

test("ML06A-10: the input is not reshaped and the returned value is the SAME reference", () => {
	const shared = { k: 1 }
	const input = { left: shared, right: shared, plain: { z: 1 } }
	const before = JSON.stringify(input)
	const r = validateJsonValue(input)
	assert.equal(r.ok, true, "a shared-substructure manifest must be accepted")
	assert.equal(JSON.stringify(input), before, "the validator must not reshape its input")
	if (r.ok) {
		assert.equal(r.value, input as unknown, "the returned value is the SAME object reference")
	}
})
