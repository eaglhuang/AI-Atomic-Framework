import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  createSkillDefinitionVNext,
  projectSkillDefinition,
  parseSkillTemplate
} from '../../packages/integrations-core/src/compiler/skill-templates.ts';
import { TeamProviderRegistry } from '../../packages/core/src/team-runtime/provider-registry.ts';

const provider = {
  providerId: 'provider-a',
  version: '1.0.0',
  provenance: {
    upstreamUrl: 'https://example.invalid/provider-a',
    upstreamCommit: 'abc123',
    sourceDigest: `sha256:${'a'.repeat(64)}` as `sha256:${string}`
  },
  license: 'MIT'
};

const definition = createSkillDefinitionVNext({
  provider,
  capabilities: ['review', 'code', 'review'],
  atmContractVersions: ['atm.skillTemplate:0.1.0'],
  shadowRun: true
});
assert.deepEqual(definition.capabilities, ['code', 'review']);
assert.equal(definition.schemaId, 'atm.skillDefinition.vNext');

const legacy = parseSkillTemplate('---\nschemaId: atm.skillTemplate\nspecVersion: 0.1.0\nid: atm-next\ntitle: ATM Next\nsummary: legacy\ncommand: node atm.mjs next --json\nfirstCommand: node atm.mjs next --json\ncharter-invariants-injected: true\nhandoffs: node atm.mjs next --json\n---\nbody');
assert.equal(projectSkillDefinition(legacy, {
  provider,
  capabilities: ['code'],
  atmContractVersions: ['atm.skillTemplate:0.1.0']
}).legacyReadable, true);

const registry = new TeamProviderRegistry();
registry.registerSkillCapabilities({
  schemaId: 'atm.skillDefinition.vNext',
  providerId: 'provider-a',
  providerVersion: '1.0.0',
  capabilities: ['code'],
  atmContractVersions: ['atm.skillTemplate:0.1.0'],
  fallbackPolicy: 'degrade-with-evidence',
  rollbackPolicy: 'provider-only'
});
assert.equal(registry.checkSkillCapability('provider-a', 'code').ok, true);
const degraded = registry.checkSkillCapability('provider-a', 'vision');
assert.equal(degraded.ok, false);
if (degraded.ok) throw new Error('expected unsupported capability evidence');
assert.equal(degraded.evidence.schemaId, 'atm.skillProviderDegradation.v1');

const schema = JSON.parse(readFileSync('templates/skills/skill.schema.json', 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
assert.equal(validate({
  schemaId: 'atm.skillTemplate',
  specVersion: '0.1.0',
  id: 'atm-next',
  title: 'ATM Next',
  summary: 'legacy',
  command: 'node atm.mjs next --json',
  firstCommand: 'node atm.mjs next --json',
  'charter-invariants-injected': true,
  handoffs: 'node atm.mjs next --json',
  skillDefinition: definition
}), true);

console.log('[skill-provider-capability-contract.test] ok');
