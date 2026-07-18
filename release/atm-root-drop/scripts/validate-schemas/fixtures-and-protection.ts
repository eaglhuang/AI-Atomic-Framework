import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ajv, bannedProtectedSurfaceTerms, fail, formatErrors, mode, readJson, readText, root, schemaEntries, schemas, supportSchemaEntries } from './context.ts';

export function validateFixtureAndProtectedSurfaceContracts() {
  const brokerOperationRunRecordSchema = ajv.getSchema('broker-operation-run-record');
  const brokerStewardApplyEvidenceSchema = ajv.getSchema('broker-steward-apply-evidence');
  if (!brokerOperationRunRecordSchema) {
    fail('broker operation run record schema must be registered');
  } else {
    const operationRunRecordEnvelope = {
      schemaId: 'atm.brokerOperationRunRecordEnvelope.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'schema operation run fixture' },
      runId: 'run-schema-operation-log',
      planId: 'plan-schema-operation-log',
      records: [
        {
          schemaId: 'atm.brokerOperationRunRecord.v1',
          specVersion: '0.1.0',
          migration: { strategy: 'none', fromVersion: null, notes: 'schema operation run fixture' },
          runId: 'run-schema-operation-log',
          planId: 'plan-schema-operation-log',
          request_identity: ['req-schema-operation-log'],
          actor_ids: ['schema-validator'],
          request_files: ['docs/broker-operation-log.md'],
          adapter_choice: 'text-range',
          applied_files: ['docs/broker-operation-log.md'],
          lane_decision: 'neutral-steward',
          merge_verdict: 'mergeable',
          evidence_path: '.atm/history/evidence/broker-runs/run-schema-operation-log.json',
          task_ids: ['TASK-TEAM-SCHEMA-OPLOG'],
          commit_sha: 'abc123schemaoperation',
          transaction_ids: ['txn-schema-operation-log']
        }
      ]
    };
    if (!brokerOperationRunRecordSchema(operationRunRecordEnvelope)) {
      fail(`broker operation run record schema must accept task/commit/transaction linkage: ${formatErrors(brokerOperationRunRecordSchema.errors)}`);
    }
  
    if (!brokerStewardApplyEvidenceSchema) {
      fail('broker steward apply evidence schema must be registered');
    } else {
      const stewardApplyEvidence = {
        schemaId: 'atm.stewardApplyEvidence.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'schema steward apply fixture' },
        stewardId: 'neutral-write-steward',
        mergePlanId: 'plan-schema-operation-log',
        proposalIds: ['proposal-schema-steward'],
        targetFiles: ['docs/broker-operation-log.md'],
        appliedFiles: ['docs/broker-operation-log.md'],
        fileBeforeHashes: {
          'docs/broker-operation-log.md': 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        },
        fileAfterHashes: {
          'docs/broker-operation-log.md': 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
        },
        permissions: {
          fileWrite: ['docs/broker-operation-log.md'],
          gitWrite: false,
          taskLifecycle: false,
          selfClose: false
        },
        applyMethod: 'patch-apply',
        verdict: 'applied',
        brokerOperationRun: operationRunRecordEnvelope
      };
      if (!brokerStewardApplyEvidenceSchema(stewardApplyEvidence)) {
        fail(`broker steward apply evidence schema must accept steward boundary and operation linkage: ${formatErrors(brokerStewardApplyEvidenceSchema.errors)}`);
      }
    }
  }
  
  const patchProposalSchema = ajv.getSchema('patch-proposal');
  if (!patchProposalSchema) {
    fail('patch proposal schema must be registered');
  } else {
    const transactionLinkedProposal = {
      schemaId: 'atm.patchProposal.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'schema transaction proposal fixture' },
      proposalId: 'prop-schema-transaction-link',
      taskId: 'TASK-TEAM-SCHEMA-PROP-TXN',
      actorId: 'schema-validator',
      transactionId: 'txn-proposal-single',
      transactionIds: ['txn-proposal-camel'],
      transaction_ids: ['txn-proposal-snake'],
      baseCommit: 'abc123schema',
      fileBeforeHash: 'sha256:abc123schema',
      targetFile: 'docs/broker-proposal-transaction-link.md',
      atomRefs: [{ atomId: 'atom-schema', atomCid: 'cid-schema' }],
      anchors: [{ kind: 'line', hint: 'EOF' }],
      intent: 'schema proposal transaction linkage',
      patch: '@@ -0,0 +1 @@\n+schema proposal transaction linkage',
      validators: ['node --strip-types scripts/validate-schemas.ts --mode validate'],
      rollback: 'revert proposal transaction linkage fixture'
    };
    if (!patchProposalSchema(transactionLinkedProposal)) {
      fail(`patch proposal schema must accept transaction linkage fields: ${formatErrors(patchProposalSchema.errors)}`);
    }
  }
  
  const versionIndexSchema = schemas.get('version-index');
  if (versionIndexSchema?.minProperties !== 1) {
    fail('version-index must require at least one row');
  }
  if (!versionIndexSchema?.$defs?.versionIndexRow?.properties?.latest) {
    fail('version-index row must expose latest');
  }
  if (!versionIndexSchema?.$defs?.versionIndexRow?.properties?.versions) {
    fail('version-index row must expose versions');
  }
  
  const manifestPath = 'tests/schema-fixtures/manifest.json';
  const manifest = readJson(manifestPath);
  for (const fixture of manifest.positive || []) {
    const validate = ajv.getSchema(fixture.schema);
    if (!validate) {
      fail(`unknown positive fixture schema: ${fixture.schema}`);
      continue;
    }
    const relativePath = `tests/schema-fixtures/${fixture.path}`;
    const valid = validate(readJson(relativePath));
    if (!valid) {
      fail(`positive fixture failed (${fixture.name}): ${formatErrors(validate.errors)}`);
    }
  }
  
  for (const fixture of manifest.negative || []) {
    const validate = ajv.getSchema(fixture.schema);
    if (!validate) {
      fail(`unknown negative fixture schema: ${fixture.schema}`);
      continue;
    }
    const relativePath = `tests/schema-fixtures/${fixture.path}`;
    const valid = validate(readJson(relativePath));
    if (valid) {
      fail(`negative fixture unexpectedly passed: ${fixture.name}`);
      continue;
    }
    const matched = (validate.errors || []).some((error) => {
      if (error.keyword !== fixture.expectedKeyword) {
        return false;
      }
      if (fixture.expectedMissingProperty) {
        return error.params?.missingProperty === fixture.expectedMissingProperty;
      }
      return true;
    });
    if (!matched) {
      fail(`negative fixture did not produce expected ${fixture.expectedKeyword}: ${fixture.name}; got ${formatErrors(validate.errors)}`);
    }
  }
  
  const protectedFiles = [
    ...Object.values(schemaEntries),
    ...Object.values(supportSchemaEntries),
    'schemas/README.md',
    'scripts/validate-schemas.ts',
    manifestPath,
    ...readdirSync(path.join(root, 'tests', 'schema-fixtures', 'positive')).map((entry) => `tests/schema-fixtures/positive/${entry}`),
    ...readdirSync(path.join(root, 'tests', 'schema-fixtures', 'negative')).map((entry) => `tests/schema-fixtures/negative/${entry}`)
  ];
  
  const upgradeFixtureDir = path.join(root, 'fixtures', 'upgrade');
  if (existsSync(upgradeFixtureDir)) {
    protectedFiles.push(...readdirSync(upgradeFixtureDir).map((entry) => `fixtures/upgrade/${entry}`));
  }
  
  const evolutionPatternFixtureDir = path.join(root, 'fixtures', 'evolution', 'evidence-patterns');
  if (existsSync(evolutionPatternFixtureDir)) {
    protectedFiles.push(...readdirSync(evolutionPatternFixtureDir).map((entry) => `fixtures/evolution/evidence-patterns/${entry}`));
  }
  
  const humanReviewFixtureDir = path.join(root, 'fixtures', 'human-review');
  if (existsSync(humanReviewFixtureDir)) {
    protectedFiles.push(...readdirSync(humanReviewFixtureDir).map((entry) => `fixtures/human-review/${entry}`));
  }
  
  const rollbackFixtureDir = path.join(root, 'fixtures', 'rollback');
  if (existsSync(rollbackFixtureDir)) {
    protectedFiles.push(...readdirSync(rollbackFixtureDir).map((entry) => `fixtures/rollback/${entry}`));
  }
  
  for (const relativePath of protectedFiles) {
    const content = readText(relativePath);
    for (const term of bannedProtectedSurfaceTerms) {
      if (content.includes(term)) {
        fail(`${relativePath} contains downstream-only term: ${term}`);
      }
    }
  }
  
  if (!process.exitCode) {
    console.log(`[schema:${mode}] ok (${Object.keys(schemaEntries).length} schemas, ${manifest.positive.length} positive fixtures, ${manifest.negative.length} negative fixtures)`);
  }
}
