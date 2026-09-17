#!/usr/bin/env node
// Emit the LH-03 capability matrix + discovery records as a
// single deterministic JSON document. Pure, no I/O besides
// reading the existing fixture files and writing the
// consolidated output.
//
// Run via:
//   node scripts/qualification-emit.mjs > qualification/lh03-emit.json
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const labRoot = path.resolve(here, '..');
const repoRoot = path.resolve(labRoot, '..', '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const piIdentity = readJson(
  path.join(labRoot, 'test/fixtures/harnesses/pi/pi-v0_85_1/identity.json'),
);
const piCapabilities = readJson(
  path.join(labRoot, 'test/fixtures/harnesses/pi/pi-v0_85_1/capabilities.json'),
);
const clineIdentity = readJson(
  path.join(labRoot, 'test/fixtures/harnesses/cline/cline-discovery-only/identity.json'),
);
const clineCapabilities = readJson(
  path.join(labRoot, 'test/fixtures/harnesses/cline/cline-discovery-only/capabilities.json'),
);
const discovery = readJson(path.join(labRoot, 'qualification/discovery-records.json'));

function row(candidate, ident, caps, replay, status) {
  const c = caps.capabilities;
  const lookup = k => c[k] || 'UNQUALIFIED';
  return {
    candidate,
    qualification_identity: ident,
    protocol: ident.protocol_mode,
    headless: lookup('HEADLESS'),
    streaming_events: lookup('STREAMING_EVENTS'),
    final_json: lookup('FINAL_JSON'),
    jsonl: lookup('JSONL'),
    rpc: lookup('RPC'),
    session_resume: lookup('SESSION_RESUME'),
    session_fork: lookup('SESSION_FORK'),
    explicit_cwd: lookup('EXPLICIT_CWD'),
    isolated_state: lookup('ISOLATED_DATA_DIR'),
    model_selection: lookup('MODEL_SELECTION'),
    provider_selection: lookup('PROVIDER_SELECTION'),
    timeout: lookup('TIMEOUT'),
    cancellation: lookup('CANCELLATION'),
    tool_visibility: lookup('TOOL_EVENT_VISIBILITY'),
    token_visibility: lookup('TOKEN_USAGE'),
    resource_visibility: lookup('RESOURCE_USAGE'),
    replay_fixture: replay,
    qualification_status: status,
  };
}

const out = {
  lh03_act: 'ACT-FACTORY-LONG-HORIZON-LAB-REAL-HARNESS-ADAPTER-QUALIFICATION01',
  generated_at_iso: '2026-09-17T22:30:00.000Z',
  capability_matrix: [
    row('pi', piIdentity, piCapabilities, 'test/fixtures/harnesses/pi/pi-v0_85_1', 'QUALIFIED_WITH_LIMITATIONS'),
    row('cline', clineIdentity, clineCapabilities, 'test/fixtures/harnesses/cline/cline-discovery-only', 'UNQUALIFIED'),
  ],
  discovery_records: discovery.records,
};
process.stdout.write(JSON.stringify(out, null, 2));
