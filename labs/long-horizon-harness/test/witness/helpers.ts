/**
 * FOUNDATION04 — witness test helpers.
 */

import {
  makeWitnessId,
  makeWitnessInstanceId,
} from "../../src/witness/index.js";
import type { WitnessRuntimeContext } from "../../src/witness/witness-runtime-sm-helpers.js";
import type { WitnessBootstrapConfig } from "../../src/witness/witness-runtime-types.js";
import { makeProcessId } from "../../src/process/process-types.js";
import {
  makeRunId,
  makeMissionId,
  makeAttemptId,
} from "../../src/domain/ids.js";

/**
 * Build a fresh runtime context for unit tests.
 */
export function makeRuntimeContext(): WitnessRuntimeContext {
  const witnessId = makeWitnessId("w-test");
  const witnessInstanceId = makeWitnessInstanceId("wi-test");
  const bootstrap: WitnessBootstrapConfig = {
    binding: {
      runId: makeRunId("r-test"),
      missionId: makeMissionId("m-test"),
      attemptId: makeAttemptId("a-test"),
      processId: makeProcessId("p-test"),
      witnessId,
      witnessInstanceId,
    },
    controllerPublicKeyFingerprint: "fp-ctrl",
    socketPath: "/tmp/f4w/test.sock",
    protocolVersion: 1,
    bootstrapLeaseMs: 5000,
  };
  return {
    bootstrap,
    witnessPublicKey: "pk",
    witnessPublicKeyFingerprint: "fp-w",
    witnessPid: 100,
    controllerPublicKeyFingerprint: "fp-ctrl",
    state: {
      kind: "bootstrapping",
      binding: bootstrap.binding,
      historicalWitnessPid: 100,
    },
    commandJournal: [],
    activated: false,
    candidate: null,
    lastExecutionStatus: { kind: "not_started" },
  };
}
