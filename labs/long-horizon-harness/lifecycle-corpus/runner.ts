/**
 * LH-05 adversarial lifecycle corpus — canonical runner.
 *
 * (ACT-FACTORY-LONG-HORIZON-LAB-LH05-ADVERSARIAL-LIFECYCLE-CORPUS01)
 *
 * L05-C08 (CORRECTION01): the runner was split across
 * `runner/{_identities,_fixtures,_normalize,_handoff,_replay,_public,index}.ts`
 * to honor the SOURCE_SIZE_DISCIPLINE 400-LOC ceiling. This
 * file remains the SINGLE logical authority: it re-exports
 * the assembly produced by the runner module.
 *
 * Tests and external code continue to import from `./runner.js`
 * unchanged.
 */
export {
  PI_QUALIFICATION_IDENTITY,
  CLINE_INELIGIBLE_IDENTITY,
  FAKE_REFERENCE_CONTROL_IDENTITY,
  listEligibleHarnesses,
  loadRawFixtureText,
  loadFakeScript,
  loadFactoryExternalEvents,
  makeSubjectIdForScenario,
  buildManifest,
  commitEvents,
  normalizePi,
  normalizeFake,
  runLh04Handoff,
  runReplay,
  runScenarioForHarness,
  runCorpus,
  semanticReplayShape,
} from "./runner/index.js";
export type { AdapterOutcome } from "./runner/index.js";
