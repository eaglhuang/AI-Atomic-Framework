import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  VALIDATION_OBLIGATION_MAP_SCHEMA_ID,
  VALIDATION_OBLIGATION_MAP_VERSION,
  createMappingGapIncident,
  createSealedCommitCanaryPlan,
  resolveValidationObligations
} from '../../packages/cli/src/commands/validation-obligations.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

{
  const resolution = resolveValidationObligations([
    'scripts/run-validators.ts',
    'packages/cli/src/commands/validation-obligations.ts'
  ]);
  assert.equal(resolution.schemaId, VALIDATION_OBLIGATION_MAP_SCHEMA_ID);
  assert.equal(resolution.mappingVersion, VALIDATION_OBLIGATION_MAP_VERSION);
  assert.deepEqual(resolution.validators, ['typecheck', 'validate-test-facade']);
  assert.ok(resolution.matchedRules.some((entry) => entry.ruleId === 'validator-facade-selection'));
  assert.equal(resolution.deferred.symbolLevelMinimization.status, 'deferred');
  assert.deepEqual(resolution.deferred.symbolLevelMinimization.requiredEvidence, ['import-graph', 'fs-trace']);
}

{
  const plan = createSealedCommitCanaryPlan({
    commitSha: 'abcdef1234567890',
    validators: ['validate-test-facade', 'typecheck']
  });
  assert.equal(plan.schemaId, 'atm.sealedCommitCanaryPlan.v1');
  assert.equal(plan.mode, 'non-blocking');
  assert.equal(plan.checkout.cleanCheckoutRequired, true);
  assert.equal(plan.checkout.exactCommitSha, 'abcdef1234567890');
  assert.equal(plan.mappingVersion, VALIDATION_OBLIGATION_MAP_VERSION);
  assert.ok(plan.command.includes('git worktree add --detach'));
  assert.ok(plan.command.includes('scripts/run-validators.ts full'));
}

{
  const incident = createMappingGapIncident({
    commitSha: 'abcdef1',
    changedPaths: ['scripts/run-validators.ts'],
    expectedValidators: ['validate-test-facade'],
    failedValidators: ['validate-test-facade']
  });
  assert.equal(incident.schemaId, 'atm.mappingGapIncident.v1');
  assert.equal(incident.commitSha, 'abcdef1');
  assert.equal(incident.mappingVersion, VALIDATION_OBLIGATION_MAP_VERSION);
  assert.deepEqual(incident.failedValidators, ['validate-test-facade']);
  assert.equal(incident.severity, 'advisory');
}

{
  const runnerSource = readRepoFile('scripts/run-validators.ts');
  assert.match(runnerSource, /resolveValidationObligations/);
  assert.match(runnerSource, /createSealedCommitCanaryPlan/);
  assert.match(runnerSource, /obligationMap/);
}

console.log('validation obligation map: ok');
