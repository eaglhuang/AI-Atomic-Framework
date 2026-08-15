import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { createSkillDefinitionVNext } from '../../packages/integrations-core/src/compiler/skill-templates.ts';

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
  capabilities: ['compile'],
  atmContractVersions: ['atm.skillTemplate:0.1.0'],
  invocationModes: ['router', 'model', 'router'],
  progressiveDisclosure: [{ id: 'refs', path: 'references/index.md', purpose: 'optional context', maxTokens: 500 }],
  completionCriteria: [{ id: 'tests', validator: 'npm test', required: true }],
  canaryMeasurements: { contextTokens: { target: 400, max: 800 }, falseInvocationRate: { target: 0, max: 0.05 } }
});

assert.deepEqual(definition.invocationModes, ['router', 'model']);
assert.deepEqual(definition.progressiveDisclosure?.[0], { id: 'refs', path: 'references/index.md', purpose: 'optional context', maxTokens: 500 });
assert.equal(definition.completionCriteria?.[0].validator, 'npm test');

const schema = JSON.parse(readFileSync('templates/skills/skill.schema.json', 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
// The fixture carries the complete template contract on purpose: a partial
// frontmatter that still validates would be the same false green this schema
// exists to prevent.
const frontmatterFixture = {
  schemaId: 'atm.skillTemplate', specVersion: '0.1.0', id: 'atm-next', title: 'ATM Next', summary: 'test',
  command: 'node atm.mjs next --json', firstCommand: 'node atm.mjs next --json',
  'charter-invariants-injected': true, handoffs: 'node atm.mjs next --json',
  owner: 'atm-framework', tier: 'entry', installProfiles: ['adopter-bootstrap'],
  invocationPolicy: 'model-or-user', companionFiles: [],
  adapterCapabilityRequirements: [{ adapterId: '*', requires: ['charter-injection'] }],
  skillDefinition: definition
};
assert.equal(validate(frontmatterFixture), true, JSON.stringify(validate.errors));

for (const omittedField of ['id', 'tier', 'installProfiles', 'invocationPolicy']) {
  const { [omittedField]: _omitted, ...partial } = frontmatterFixture as Record<string, unknown>;
  assert.equal(validate(partial), false, `frontmatter missing ${omittedField} must not validate`);
}

console.log('[skill-definition-vnext.test] ok');
