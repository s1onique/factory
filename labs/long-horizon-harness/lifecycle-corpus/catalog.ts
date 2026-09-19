/**
 * LH-05 adversarial lifecycle corpus — canonical catalog.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 *
 * L05-C08 (CORRECTION01): the catalog was split across
 * `catalog-scenarios/{helpers,lc01-lc04,lc05-lc08,lc10-lc12,index}.ts`
 * to honor the SOURCE_SIZE_DISCIPLINE 400-LOC ceiling. This
 * file remains the SINGLE logical authority: it re-exports
 * the assembly produced by the catalog-scenarios module.
 * Tests and runner modules continue to import from
 * `./catalog.js` unchanged.
 *
 * Required invariant:
 *   LIFECYCLE_CORPUS_HAS_SINGLE_CONTRACT_AUTHORITY = TRUE
 */
export {
  LIFECYCLE_CORPUS_CATALOG,
  findScenario,
} from "./catalog-scenarios/index.js";
