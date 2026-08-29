/**
 * T17 fake adapter determinism and T18 candidate/domain separation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ScriptedFakeAdapter,
  defaultHappyPathScript,
} from "../src/adapters/fake/scripted-fake-adapter.js";
import { makeHarnessHandle } from "../src/domain/ids.js";

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) {
    out.push(v);
  }
  return out;
}

test("T17 fake adapter determinism: same script yields same sequence", async () => {
  const a = new ScriptedFakeAdapter({ script: defaultHappyPathScript("attempt-1") });
  const b = new ScriptedFakeAdapter({ script: defaultHappyPathScript("attempt-1") });
  const h1 = makeHarnessHandle("h1");
  const h2 = makeHarnessHandle("h2");
  await a.start({ handle: h1, args: {} });
  await b.start({ handle: h2, args: {} });
  const ea = await collect(a.events(h1));
  const eb = await collect(b.events(h2));
  assert.equal(ea.length, eb.length);
  for (let i = 0; i < ea.length; i++) {
    assert.deepEqual(ea[i], eb[i]);
  }
});

test("T17 fake adapter: status transitions starting -> running -> completed", async () => {
  const a = new ScriptedFakeAdapter({ script: defaultHappyPathScript("attempt-1") });
  const h = makeHarnessHandle("h1");
  let s = await a.status(h);
  assert.equal(s.phase, "starting");
  await a.start({ handle: h, args: {} });
  s = await a.status(h);
  assert.equal(s.phase, "running");
  await collect(a.events(h));
  s = await a.status(h);
  assert.equal(s.phase, "completed");
});

test("T18 candidate/domain separation: candidate completion observation does not produce authoritative completion", async () => {
  const a = new ScriptedFakeAdapter({ script: defaultHappyPathScript("attempt-1") });
  const h = makeHarnessHandle("h1");
  await a.start({ handle: h, args: {} });
  const events = await collect(a.events(h));
  // The script's last event is a candidate observation.
  assert.equal(events[events.length - 1]?.type, "candidate_reported_completion");
  // The adapter does not produce any authoritative completion. The events
  // emitted by the adapter are observations only.
  for (const e of events) {
    assert.notEqual(e.type, "completed");
  }
});
