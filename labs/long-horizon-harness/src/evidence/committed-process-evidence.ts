/**
 * Typed committed process-evidence record (FOUNDATION03).
 *
 * This is the process-evidence analogue of
 * {@link CommittedRunEvent}: a payload stamped with ledger-owned
 * metadata.
 *
 * The ledger produces this shape; producers (the process supervisor
 * and the crash harness) produce payloads and let the ledger stamp
 * them. The persistence boundary is exactly the moment the
 * in-memory payload becomes a {@link CommittedProcessEvidence} (i.e.
 * when fsync has acknowledged the append).
 *
 * Process-evidence records share the run/mission identity of the
 * surrounding run ledger. They are sequenced in the same global
 * monotonic order as lifecycle events.
 */

import type { EventId, MissionId, RunId } from "../domain/ids.js";
import type { PersistedProcessEvidencePayload } from "./codec-types.js";

export type CommittedProcessEvidence = {
  readonly eventId: EventId;
  readonly runId: RunId;
  readonly missionId: MissionId;
  readonly seq: number;
  readonly observedAt: number;
  readonly payload: PersistedProcessEvidencePayload;
};
