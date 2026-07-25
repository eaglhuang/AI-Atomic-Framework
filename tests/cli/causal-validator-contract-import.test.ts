import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  catalogEntryResponsibility,
  isBroadSuiteCommandOrKey,
  projectLegacyCommandValidators,
  readTestCatalog,
  VALIDATOR_RESPONSIBILITIES
} from '../../packages/cli/src/commands/test-catalog.ts';
import { runTasksImport } from '../../packages/cli/src/commands/tasks/import-orchestrator.ts';
import {
  extractFrontMatter,
  validateCausalValidatorContractImport
} from '../../packages/cli/src/commands/tasks/task-import-validators.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = JSON.parse(readFileSync(
  path.join(root, 'schemas/validators/validator-execution-contract.schema.json'),
  'utf8'
));
const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);

assert.deepEqual([...VALIDATOR_RESPONSIBILITIES], ['task-required', 'phase-suite', 'advisory']);

assert.equal(validateSchema({
  schemaId: 'atm.validatorExecutionContract.v1',
  specVersion: '0.1.0',
  responsibility: 'task-required',
  caseId: 'test_task_example_behavior_8f3a2c1d',
  acceptanceIds: ['ACC-1'],
  impactEdges: ['example-public-seam'],
  contractEdge: 'example-contract',
  minExecutedCases: 1
}), true);

assert.equal(validateSchema({
  schemaId: 'atm.validatorExecutionContract.v1',
  specVersion: '0.1.0',
  responsibility: 'unknown',
  caseId: 'bad'
}), false);

const catalog = readTestCatalog(root);
const allEntry = catalog.entries.find((entry) => entry.key === 'language.typescript.static.all');
assert.ok(allEntry);
assert.equal(catalogEntryResponsibility(allEntry!), 'phase-suite');
assert.equal(isBroadSuiteCommandOrKey('npm run typecheck'), true);
assert.equal(isBroadSuiteCommandOrKey('language.typescript.static.all'), true);

const legacy = projectLegacyCommandValidators(['npm run typecheck', 'npm run validate:cli']);
assert.equal(legacy.length, 2);
assert.equal(legacy[0]?.responsibility, 'advisory');
assert.equal(legacy[0]?.legacyProjection, true);
assert.match(legacy[0]?.caseId ?? '', /^legacy_cmd_/);
assert.equal(validateSchema(legacy[0]), true);

const covered = validateCausalValidatorContractImport({
  frontmatter: {
    requiredTestCaseIds: ['test_task_example_behavior_8f3a2c1d'],
    testContributions: [{
      caseId: 'test_task_example_behavior_8f3a2c1d',
      coversAcceptance: ['ACC-1'],
      coversImpactEdges: ['example-public-seam'],
      responsibility: 'task-required',
      contractEdge: 'example-contract'
    }],
    phaseTestCaseIds: ['test_int_phase_suite_1a2b3c4d'],
    advisoryTestCaseIds: ['test_int_advisory_9z8y7x6w'],
    causalGraph: {
      causalImpactEdges: ['example-public-seam']
    }
  },
  acceptance: ['ACC-1 Keep the example seam correct']
});
assert.deepEqual(covered.errors, []);
assert.equal(covered.fields.usesCausalContract, true);
assert.deepEqual(covered.fields.requiredTestCaseIds, ['test_task_example_behavior_8f3a2c1d']);
assert.deepEqual(covered.fields.phaseTestCaseIds, ['test_int_phase_suite_1a2b3c4d']);
assert.deepEqual(covered.fields.advisoryTestCaseIds, ['test_int_advisory_9z8y7x6w']);

const missingCoverage = validateCausalValidatorContractImport({
  frontmatter: {
    testContributions: [{
      caseId: 'test_task_unrelated_aaaaaaaa',
      coversAcceptance: ['ACC-9'],
      coversImpactEdges: [],
      responsibility: 'task-required'
    }],
    requiredTestCaseIds: ['test_task_unrelated_aaaaaaaa'],
    causalGraph: { causalImpactEdges: ['missing-edge'] }
  },
  acceptance: ['ACC-1 Must be covered']
});
assert.ok(missingCoverage.errors.some((entry) => entry.includes('Acceptance criterion')));
assert.ok(missingCoverage.errors.some((entry) => entry.includes('Causal impact edge')));

const fullSuiteBlocked = validateCausalValidatorContractImport({
  frontmatter: {
    requiredTestCaseIds: ['language.typescript.static.all'],
    testContributions: [{
      caseId: 'language.typescript.static.all',
      coversAcceptance: ['ACC-1'],
      responsibility: 'task-required'
    }]
  },
  acceptance: ['ACC-1']
});
assert.ok(fullSuiteBlocked.diagnostics.some((entry) =>
  entry.code === 'ATM_TASK_IMPORT_TASK_REQUIRED_FULL_SUITE_WITHOUT_EDGE'
));

const fullSuiteAllowed = validateCausalValidatorContractImport({
  frontmatter: {
    requiredTestCaseIds: ['language.typescript.static.all'],
    testContributions: [{
      caseId: 'language.typescript.static.all',
      coversAcceptance: ['ACC-1'],
      responsibility: 'task-required',
      dependencyEdge: 'typescript-package-boundary'
    }]
  },
  acceptance: ['ACC-1']
});
assert.deepEqual(fullSuiteAllowed.errors, []);

const tempRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-causal-validator-import-'));
const legacyCard = path.join(tempRepo, 'TASK-TEST-9001.task.md');
writeFileSync(legacyCard, [
  '---',
  'task_id: TASK-TEST-9001',
  'title: Legacy command validators remain importable',
  'status: planned',
  'scopePaths:',
  '  - src/example.ts',
  'deliverables:',
  '  - src/example.ts',
  'validators:',
  '  - npm run typecheck',
  '---',
  '',
  '# TASK-TEST-9001',
  '',
  '## Acceptance',
  '',
  '- Keep legacy command-only cards importable.'
].join('\n'), 'utf8');

const legacyImport = await runTasksImport([
  '--cwd', tempRepo,
  '--from', legacyCard,
  '--dry-run',
  '--json'
]) as any;
assert.equal(legacyImport.ok, true, 'legacy command-only cards must remain importable');
const legacyTask = legacyImport.evidence.manifest.tasks[0];
assert.ok(legacyTask.legacyValidatorProjection?.length >= 1);
assert.ok((legacyTask.importDiagnostics ?? []).some((entry: any) =>
  entry.code === 'ATM_TASK_IMPORT_LEGACY_VALIDATOR_PROJECTION'
));

const vnextCard = path.join(tempRepo, 'TASK-TEST-9002.task.md');
writeFileSync(vnextCard, [
  '---',
  'task_id: TASK-TEST-9002',
  'title: Causal validator contract card',
  'status: planned',
  'scopePaths:',
  '  - src/example.ts',
  'deliverables:',
  '  - src/example.ts',
  'validators:',
  '  - node --strip-types tests/cli/example.test.ts',
  'testContributions:',
  '  - caseId: test_task_example_behavior_8f3a2c1d',
  '    coversAcceptance:',
  '      - ACC-1',
  '    coversImpactEdges:',
  '      - example-public-seam',
  '    responsibility: task-required',
  '    contractEdge: example-contract',
  'requiredTestCaseIds:',
  '  - test_task_example_behavior_8f3a2c1d',
  'phaseTestCaseIds:',
  '  - test_int_phase_suite_1a2b3c4d',
  'advisoryTestCaseIds:',
  '  - test_int_advisory_9z8y7x6w',
  'causalGraph:',
  '  causalImpactEdges:',
  '    - example-public-seam',
  '---',
  '',
  '# TASK-TEST-9002',
  '',
  '## Acceptance',
  '',
  '- ACC-1 Keep the example seam correct.'
].join('\n'), 'utf8');

const parsedFrontmatter = extractFrontMatter(readFileSync(vnextCard, 'utf8'));
assert.ok(Array.isArray(parsedFrontmatter?.data.testContributions));
assert.equal((parsedFrontmatter?.data.testContributions as any[])[0]?.caseId, 'test_task_example_behavior_8f3a2c1d');

const vnextImport = await runTasksImport([
  '--cwd', tempRepo,
  '--from', vnextCard,
  '--dry-run',
  '--json'
]) as any;
assert.equal(vnextImport.ok, true, JSON.stringify(vnextImport.messages ?? vnextImport, null, 2));
const vnextTask = vnextImport.evidence.manifest.tasks[0];
assert.deepEqual(vnextTask.requiredTestCaseIds, ['test_task_example_behavior_8f3a2c1d']);
assert.deepEqual(vnextTask.phaseTestCaseIds, ['test_int_phase_suite_1a2b3c4d']);
assert.deepEqual(vnextTask.advisoryTestCaseIds, ['test_int_advisory_9z8y7x6w']);
assert.equal(vnextTask.testContributions?.[0]?.caseId, 'test_task_example_behavior_8f3a2c1d');

const rejectedCard = path.join(tempRepo, 'TASK-TEST-9003.task.md');
writeFileSync(rejectedCard, [
  '---',
  'task_id: TASK-TEST-9003',
  'title: Missing required case coverage',
  'status: planned',
  'scopePaths:',
  '  - src/example.ts',
  'deliverables:',
  '  - src/example.ts',
  'testContributions:',
  '  - caseId: test_task_other_bbbbbbbb',
  '    coversAcceptance:',
  '      - ACC-9',
  '    responsibility: task-required',
  'requiredTestCaseIds:',
  '  - test_task_other_bbbbbbbb',
  'causalGraph:',
  '  causalImpactEdges:',
  '    - uncovered-edge',
  '---',
  '',
  '# TASK-TEST-9003',
  '',
  '## Acceptance',
  '',
  '- ACC-1 Must fail closed without coverage.'
].join('\n'), 'utf8');

let rejected = false;
try {
  await runTasksImport([
    '--cwd', tempRepo,
    '--from', rejectedCard,
    '--dry-run',
    '--json'
  ]);
} catch (error: any) {
  rejected = true;
  const details = error?.details ?? error?.data ?? {};
  const diagnostics = details.diagnostics ?? [];
  assert.ok(
    diagnostics.some((entry: any) =>
      String(entry.code || '').includes('ACCEPTANCE_CASE_UNRESOLVED')
      || String(entry.code || '').includes('IMPACT_EDGE_CASE_UNRESOLVED')
      || String(entry.text || '').includes('Acceptance criterion')
      || String(entry.text || '').includes('Causal impact edge')
    ),
    JSON.stringify(details, null, 2)
  );
}
assert.equal(rejected, true, 'import must reject unresolved acceptance/impact coverage');

console.log('[causal-validator-contract-import:test] ok');
