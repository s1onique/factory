/**
 * FOUNDATION04 — typed committed witness-evidence record.
 *
 * The witness-evidence analogue of {@link CommittedProcessEvidence}:
 * a payload stamped with ledger-owned metadata.
 *
 * The witness runtime produces payloads; the dedicated witness
 * ledger appender (witness-ledger.ts) stamps metadata, allocates
 * sequence via the existing JsonlLedger, and persists the
 * envelope via the existing low-level fsync helper.
 *
 * This file is the trusted boundary between the witness runtime
 * and the on-disk evidence ledger.
 */

import type { EventId, MissionId, RunId } from "../domain/ids.js";
import type { PersistedWitnessEvidence } from "./witness-types-persisted.js";

export type CommittedWitnessEvidence = {
  readonly eventId: EventId;
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly seq: number;
  readonly observedAt: number;
  readonly payload: PersistedWitnessEvidence;
};
