import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  createDeepModuleReviewReport,
  deepModuleProviderInfo,
  deepModuleProviderVocabulary
} from '../../packages/plugin-review-advisory/src/index.ts';

const report = createDeepModuleReviewReport({
  taskId: 'ATM-GOV-0264',
  candidate: {
    moduleId: 'broker-route-resolution-review',
    sourcePaths: ['packages/cli/src/commands/next/route-resolution/example.ts'],
    ownerAtomOrMap: 'atom-cli-router',
    publicInterface: 'reviewDeepModuleCandidate(candidate, observedFriction)',
    rollback: 'revert provider receipt and keep existing Broker route behavior',
    causalValidators: ['test_task_skl_0027_deep_module_provider_8f47d4a1']
  },
  observedFriction: {
    triggers: ['duplicated-policy', 'caller-complexity', 'missing-test-seam', 'file-length'],
    evidenceRefs: ['ATM-GOV-0264.preflight']
  },
  dependencyClasses: ['in-process', 'local-substitutable'],
  proposedAdapters: ['sealed-review-receipt-adapter', 'in-memory-test-adapter']
});

assert.equal(report.schemaId, 'atm.deepModuleReviewReport.v1');
assert.equal(report.providerContract, 'atm.deepModuleRefactorProvider.v1');
assert.equal(report.providerId, 'matt-pocock-deep-module-reference');
assert.equal(report.status, 'pass');
assert.equal(report.triggerVerdict.fileLengthAdvisoryOnly, true);
assert.deepEqual(report.triggerVerdict.actionableTriggers, ['duplicated-policy', 'caller-complexity', 'missing-test-seam']);
assert.equal(report.seam.requiresTwoAdapters, true);
assert.equal(report.seam.proposedAdapters.length, 2);
assert.match(report.seam.deletionTest, /module/);
assert.match(report.seam.interfaceTest, /interface/);
assert.equal(report.hiddenComplexity.depth, 'high');
assert.match(report.hiddenComplexity.leverage, /interface/);
assert.match(report.hiddenComplexity.locality, /owner atom or map/);
assert.deepEqual(report.dependencyClass, ['in-process', 'local-substitutable']);
assert.match(report.replaceDontLayerTest, /Replace old private-internal tests/);
assert.equal(report.causalValidators[0], 'test_task_skl_0027_deep_module_provider_8f47d4a1');
assert.match(report.receiptFingerprint, /^deep-module-review:[a-f0-9]{8}$/);

const lengthOnly = createDeepModuleReviewReport({
  taskId: 'TASK-LENGTH-ONLY',
  candidate: {
    moduleId: 'large-file',
    sourcePaths: ['large.ts'],
    ownerAtomOrMap: 'atom-large',
    publicInterface: 'large()',
    rollback: 'revert',
    causalValidators: ['focused']
  },
  observedFriction: {
    triggers: ['file-length'],
    evidenceRefs: ['line-count']
  },
  dependencyClasses: ['in-process'],
  proposedAdapters: ['single-adapter']
});
assert.equal(lengthOnly.status, 'blocked');
assert.deepEqual(lengthOnly.triggerVerdict.actionableTriggers, []);

assert.deepEqual(deepModuleProviderVocabulary(), ['module', 'interface', 'seam', 'adapter', 'depth', 'leverage', 'locality']);
assert.equal(deepModuleProviderInfo.upstreamCommit, 'ed37663cc5fbef691ddfecd080dff42f7e7e350d');
assert.equal(deepModuleProviderInfo.codebaseDesignDigest, 'sha256:c46b49303a81c7fc8934d0f4fbc44382cdecb73942d85d8d7db3523407fff8fa');
assert.equal(deepModuleProviderInfo.improveArchitectureDigest, 'sha256:d3682058df92c259b47c36503baa02345d5811758621b5dc03081d5ba0f7b69b');

const skill = readFileSync('templates/skills/atm-deep-module-refactor.skill.md', 'utf8');
for (const term of deepModuleProviderVocabulary()) {
  assert(skill.includes(term), `skill missing vocabulary term: ${term}`);
}
assert(skill.includes('references/deepening.md'));
assert(skill.includes('references/design-it-twice.md'));
assert(skill.includes('Replacing this provider must not change ATM review receipt, task-card'));

const definitionMatch = skill.match(/```json\n([\s\S]*?)\n```/);
assert(definitionMatch, 'skill must include a JSON skillDefinition fixture');
const definition = JSON.parse(definitionMatch[1]);
const schema = JSON.parse(readFileSync('templates/skills/skill.schema.json', 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateTemplate = ajv.compile(schema);
assert.equal(validateTemplate({
  schemaId: 'atm.skillTemplate',
  specVersion: '0.1.0',
  id: 'atm-deep-module-refactor',
  title: 'ATM Deep Module Refactor',
  summary: 'Review replaceable deep-module refactor candidates through a provider-neutral ATM receipt.',
  command: 'node atm.mjs next --prompt "$ARGUMENTS" --json',
  firstCommand: 'node atm.mjs next --prompt "$ARGUMENTS" --json',
  'charter-invariants-injected': true,
  handoffs: 'node atm.mjs handoff summarize --task "$ARGUMENTS" --json',
  skillDefinition: definition
}), true);
assert.equal(definition.provider.license, 'MIT');
assert.equal(definition.provider.provenance.upstreamUrl, 'https://github.com/mattpocock/skills');
assert.equal(definition.shadowRun, true);
assert.equal(definition.promotion, 'manual-review');
assert.equal(definition.rollbackPolicy, 'provider-only');

console.log(JSON.stringify({
  marker: '[deep-module-refactor-provider.test] ok',
  schemaId: report.schemaId,
  providerContract: report.providerContract,
  providerId: report.providerId,
  status: report.status,
  queueVerdict: 'provider-neutral-receipt-ready',
  fingerprint: report.receiptFingerprint
}));
