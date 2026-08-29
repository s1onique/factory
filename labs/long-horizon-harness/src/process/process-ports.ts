/**
 * Re-exports of the runtime port types.
 *
 * The runtime ports (Clock, SignalPort, SpawnPort, RuntimeEvent,
 * RuntimeEventSink, IdFactory, SpawnedChild) live in
 * process-types.ts so that the pure-data layer and the port
 * layer can be edited coherently.
 *
 * This module exists so production code can keep importing
 * "from ./process-ports.js" for those ports without breaking
 * existing call sites.
 */

export type {
  Clock,
  SignalPort,
  SpawnedChild,
  SpawnPort,
  RuntimeEvent,
  RuntimeEventSink,
  IdFactory,
} from "./process-types.js";
