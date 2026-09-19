/**
 * LH-05 expected helpers — compatibility shim.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01-CORRECTION02)
 *
 * The expected helpers have been split into the `expected/`
 * subdirectory for source-size discipline (L05-C13). This
 * file remains as a re-export shim so existing imports of
 * `expected.js` continue to work unchanged.
 *
 * Production code MUST prefer importing from `./expected/`
 * directly. Tests and runners may continue to use this
 * shim.
 */
export {
  checkAdapterDisposition,
  checkHandoffResult,
  checkPhaseE,
  checkLH02,
  buildLH02ActualPredicates,
  checkForbiddenOutcomes,
  compareScenario,
  compareScenarioWithHandoff,
} from "./expected/index.js";
