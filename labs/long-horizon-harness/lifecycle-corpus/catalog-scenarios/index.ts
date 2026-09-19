/**
 * LH-05 catalog assembly (split for source-size discipline).
 *
 * L05-C08: catalog.ts is the SINGLE logical authority.
 */
import type { LifecycleScenario } from "../types.js";
import { lc01, lc02, lc03, lc04 } from "./lc01-lc04.js";
import { lc05, lc06, lc07, lc08 } from "./lc05-lc08.js";
import { lc09, lc10, lc11, lc12 } from "./lc10-lc12.js";

export {
  PI_ELIGIBLE,
  CLINE_INELIGIBLE,
  FAKE_REFERENCE_CONTROL,
  FAKE_NOT_APPLICABLE,
  accepted,
  rejected,
  phaseE,
  lh02,
  forbidden,
  golden,
} from "./helpers.js";

export const LIFECYCLE_CORPUS_CATALOG: readonly LifecycleScenario[] =
  Object.freeze([
    lc01(),
    lc02(),
    lc03(),
    lc04(),
    lc05(),
    lc06(),
    lc07(),
    lc08(),
    lc09(),
    lc10(),
    lc11(),
    lc12(),
  ]);

export function findScenario(id: string): LifecycleScenario | undefined {
  return LIFECYCLE_CORPUS_CATALOG.find((s) => s.id === id);
}
