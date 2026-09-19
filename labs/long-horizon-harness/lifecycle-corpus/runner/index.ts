/**
 * LH-05 runner assembly (split for source-size discipline).
 *
 * L05-C08: runner.ts is the SINGLE logical authority.
 */
export { PI_QUALIFICATION_IDENTITY, CLINE_INELIGIBLE_IDENTITY, FAKE_REFERENCE_CONTROL_IDENTITY, listEligibleHarnesses } from "./_identities.js";
export { loadRawFixtureText, loadFakeScript, loadFactoryExternalEvents, makeSubjectIdForScenario, commitEvents, buildManifest } from "./_fixtures.js";
export { normalizePi, normalizeFake } from "./_normalize.js";
export type { AdapterOutcome } from "./_normalize.js";
export { runLh04Handoff } from "./_handoff.js";
export { runReplay } from "./_replay.js";
export { runScenarioForHarness, runCorpus, semanticReplayShape } from "./_public.js";
