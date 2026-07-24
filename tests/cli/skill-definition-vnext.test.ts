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
assert.equal(validate({
  schemaId: 'atm.skillTemplate', specVersion: '0.1.0', id: 'atm-next', title: 'ATM Next', summary: 'test',
  command: 'node atm.mjs next --json', firstCommand: 'node atm.mjs next --json',
  'charter-invariants-injected': true, handoffs: 'node atm.mjs next --json', skillDefinition: definition
}), true);

console.log('[skill-definition-vnext.test] ok');
