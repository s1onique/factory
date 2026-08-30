/**
 * FOUNDATION03 — recovery port.
 *
 * Read-only capability the reconciler uses to inspect the
 * current kernel state of a historical process group. The port
 * is intentionally NARROW: it exposes ONLY a signal-zero group
 * probe. There is no method for sending TERM or KILL.
 *
 * Type-level restriction (F03 §27): we deliberately do NOT pass
 * {@link SignalPort} into the reconciler. SignalPort carries
 * destructive `signalGroup()` which the recovery layer must not
 * be able to call.
 */

import type { GroupProbeSnapshot } from "./recovery-types.js";

/**
 * A read-only capability over historical PGIDs.
 *
 * In production, an implementation typically wraps a
 * signal-zero `killpg(2)` call. In tests, a stub returns
 * programmable responses keyed by PGID.
 */
export interface RecoveryProbe {
  probeHistoricalGroup(pgid: number): GroupProbeSnapshot;
}
