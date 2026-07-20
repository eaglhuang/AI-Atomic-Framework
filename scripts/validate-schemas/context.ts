import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

export const schemaEntries: Record<string, string> = {
  'atomic-spec': 'schemas/atomic-spec.schema.json',
  'atomic-map': 'schemas/registry/atomic-map.schema.json',
  'agent-prompt': 'schemas/agent-prompt.schema.json',
  'execution-evidence': 'schemas/agent-execute/execution-evidence.schema.json',
  'governance-artifact': 'schemas/governance/artifact.schema.json',
  'governance-log': 'schemas/governance/log.schema.json',
  'governance-run-report': 'schemas/governance/run-report.schema.json',
  'governance-state': 'schemas/governance/markdown-json-state.schema.json',
  'governance-default-guards': 'schemas/governance/default-guards.schema.json',
  'governance-evidence': 'schemas/governance/evidence.schema.json',
  'governance-context-summary': 'schemas/governance/context-summary.schema.json',
  'governance-welcome-lineage': 'schemas/governance/welcome-lineage.schema.json',
  'governance-conversation-transcript': 'schemas/governance/conversation-transcript.schema.json',
  'governance-detector-report': 'schemas/governance/detector-report.schema.json',
  'governance-conversation-review-findings-report': 'schemas/governance/conversation-review-findings-report.schema.json',
  'governance-conversation-patch-draft-report': 'schemas/governance/conversation-patch-draft-report.schema.json',
  'governance-conversation-feedback-report': 'schemas/governance/conversation-feedback-report.schema.json',
  'governance-evolution-scan-report': 'schemas/governance/evolution-scan-report.schema.json',
  'governance-map-curator-report': 'schemas/governance/map-curator-report.schema.json',
  'governance-map-equivalence-report': 'schemas/governance/map-equivalence-report.schema.json',
  'governance-polymorph-impact-report': 'schemas/governance/polymorph-impact-report.schema.json',
  'governance-propagation-report': 'schemas/governance/propagation-report.schema.json',
  'governance-retirement-proof': 'schemas/governance/retirement-proof.schema.json',
  'governance-decomposition-plan': 'schemas/governance/decomposition-plan.schema.json',
  'governance-adapter-report': 'schemas/governance/adapter-report.schema.json',
  'governance-atomize-adapter': 'schemas/governance/atomize-adapter.schema.json',
  'governance-infect-adapter': 'schemas/governance/infect-adapter.schema.json',
  'governance-inject-plan': 'schemas/governance/inject-plan.schema.json',
  'governance-rollback-plan': 'schemas/governance/rollback-plan.schema.json',
  'evidence-usage-feedback': 'schemas/governance/evidence/usage-feedback.schema.json',
  'evidence-quality-baseline': 'schemas/governance/evidence/quality-baseline.schema.json',
  'evidence-quality-comparison': 'schemas/governance/evidence/quality-comparison.schema.json',
  'evidence-rollback-proof': 'schemas/governance/evidence/rollback-proof.schema.json',
  'human-review-decision': 'schemas/human-review/decision.schema.json',
  'governance-work-item': 'schemas/governance/work-item.schema.json',
  'governance-scope-lock': 'schemas/governance/scope-lock.schema.json',
  'governance-bundle': 'schemas/governance/governance-bundle.schema.json',
  'police-registry-candidate-report': 'schemas/police/registry-candidate-report.schema.json',
  'upgrade-proposal': 'schemas/upgrade/upgrade-proposal.schema.json',
  'rollback-proof': 'schemas/registry/rollback-proof.schema.json',
  registry: 'schemas/registry.schema.json',
  'registry-v1': 'schemas/registry.schema.json',
  'version-index': 'schemas/registry/version-index.schema.json',
  'regression-matrix': 'schemas/regression-matrix.schema.json',
  'test-report': 'schemas/test-report.schema.json',
  'behavior-proposal': 'schemas/behavior/behavior-proposal.schema.json',
  'polymorphic-template': 'schemas/polymorphism/polymorphic-template.schema.json',
  'dimension-spec': 'schemas/polymorphism/dimension-spec.schema.json',
  'charter-invariants': 'schemas/charter/charter-invariants.schema.json',
  'charter-bundle': 'schemas/charter/charter-bundle.schema.json',
  'integration-install-manifest': 'schemas/integrations/install-manifest.schema.json',
  'agent-pack-manifest': 'schemas/agent-pack/manifest.schema.json',
  'write-intent': 'schemas/governance/write-intent.schema.json',
  'patch-proposal': 'schemas/governance/patch-proposal.schema.json',
  'content-anchor': 'schemas/governance/content-anchor.schema.json',
  'broker-decision': 'schemas/governance/broker-decision.schema.json',
  'command-manifest': 'schemas/governance/command-manifest.schema.json',
  'merge-plan': 'schemas/governance/merge-plan.schema.json',
  'break-glass-handoff': 'schemas/governance/break-glass-handoff.schema.json',
  'broker-mutation-request': 'schemas/broker/mutation-request.schema.json',
  'broker-operation-run-record': 'schemas/broker/operation-run-record.schema.json',
  'broker-steward-apply-evidence': 'schemas/broker/steward-apply-evidence.schema.json',
  'broker-conflict-key': 'schemas/broker/conflict-key.schema.json',
  'broker-merge-decision': 'schemas/broker/merge-decision.schema.json',
  'broker-mutation-batch-plan': 'schemas/broker/mutation-batch-plan.schema.json',
  'team-wave-envelope': 'schemas/team-wave-envelope.schema.json',
  'team-worker-report': 'schemas/team-worker-report.schema.json'
};

export const supportSchemaEntries: Record<string, string> = {
  'branch-commit-queue': 'schemas/governance/branch-commit-queue.schema.json',
  'cli-result': 'schemas/governance/cli-result.schema.json',
  'test-report-metrics': 'schemas/test-report/metrics.schema.json',
  'team-broker-lane': 'schemas/team-agents/team-broker-lane.schema.json',
  'team-broker-runtime-activation': 'schemas/team-agents/team-broker-runtime-activation.schema.json',
  'team-broker-write-transaction': 'schemas/team-agents/team-broker-write-transaction.schema.json',
  'team-cost-receipt': 'schemas/team-agents/team-cost-receipt.schema.json',
  'team-efficiency-incident': 'schemas/team-agents/team-efficiency-incident.schema.json',
  'team-runtime-contract': 'schemas/team-agents/team-runtime-contract.schema.json',
  'model-price-catalog': 'schemas/team-agents/model-price-catalog.schema.json',
  'atm-operational-bench': 'schemas/bench/atm-operational-bench.schema.json'
};

export const bannedProtectedSurfaceTerms = [
  ['3K', 'Life'].join(''),
  ['Co', 'cos'].join(''),
  ['cocos', '-creator'].join(''),
  ['html', '-to-', 'ucuf'].join(''),
  ['ga', 'cha'].join(''),
  ['UC', 'UF'].join(''),
  ['draft', '-builder'].join(''),
  ['task', '-lock'].join(''),
  ['compute', '-gate'].join(''),
  ['doc', '-id-', 'registry'].join(''),
  ['tools', '_node/'].join(''),
  ['assets', '/scripts/'].join(''),
  ['docs', '/agent-', 'briefs/'].join('')
];

export function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

export function readText(relativePath: any) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

export function fail(message: any) {
  console.error(`[schema:${mode}] ${message}`);
  process.exitCode = 1;
}

export function formatErrors(errors: any) {
  return (errors || [])
    .map((error: any) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

export const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const addedSchemaIds = new Set<string>();

export const supportSchemas = loadSchemas(supportSchemaEntries, { enforceMetadata: false });
export const schemas = loadSchemas(schemaEntries, {
  enforceMetadata: true,
  metadataExemptSchemaNames: ['version-index']
});

for (const [schemaName, schema] of supportSchemas.entries()) {
  const schemaId = typeof schema?.$id === 'string' ? schema.$id : schemaName;
  if (!addedSchemaIds.has(schemaId)) {
    ajv.addSchema(schema, schemaName);
    addedSchemaIds.add(schemaId);
  }
}

for (const [schemaName, schema] of schemas.entries()) {
  const schemaId = typeof schema?.$id === 'string' ? schema.$id : schemaName;
  if (!addedSchemaIds.has(schemaId)) {
    ajv.addSchema(schema, schemaName);
    addedSchemaIds.add(schemaId);
  }
}

for (const [schemaName, schema] of supportSchemas.entries()) {
  if (!ajv.validateSchema(schema)) {
    fail(`${supportSchemaEntries[schemaName]} is not a valid JSON Schema: ${formatErrors(ajv.errors)}`);
  }
}

for (const [schemaName, schema] of schemas.entries()) {
  if (!ajv.validateSchema(schema)) {
    fail(`${schemaEntries[schemaName]} is not a valid JSON Schema: ${formatErrors(ajv.errors)}`);
  }
}

function loadSchemas(entries: Record<string, string>, options: any = {}) {
  const loadedSchemas = new Map<string, any>();
  const metadataExemptSchemaNames = new Set(options.metadataExemptSchemaNames ?? []);
  for (const [schemaName, relativePath] of Object.entries(entries)) {
    if (!existsSync(path.join(root, relativePath))) {
      fail(`missing schema file: ${relativePath}`);
      continue;
    }
    const schema = readJson(relativePath);
    if (!schema.$id || !schema.$schema) {
      fail(`${relativePath} must define $id and $schema`);
    }
    if (options.enforceMetadata && !metadataExemptSchemaNames.has(schemaName)) {
      for (const requiredMetadata of ['schemaId', 'specVersion', 'migration']) {
        if (!schema.required?.includes(requiredMetadata)) {
          fail(`${relativePath} must require ${requiredMetadata}`);
        }
      }
    }
    loadedSchemas.set(schemaName, schema);
  }
  return loadedSchemas;
}
