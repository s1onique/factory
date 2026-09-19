/**
 * LH-05 fault-catalog bridge.
 *
 * Re-exports the canonical LH-04 F01..F17 fault catalog
 * so the LC11 handoff can look up the fault primitive by id
 * without duplicating the LH-04 implementation.
 */
export { FAULT_CATALOG, findFault } from "../fault-lab/deterministic/fault-catalog.js";
