import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { runTasksImport } from '../../packages/cli/src/commands/tasks/import-orchestrator.ts';
import { parseAcceptanceEvidenceMap } from '../../packages/cli/src/commands/tasks/task-import-validators.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const validFixture = JSON.parse(readFileSync(
  path.join(root, 'tests/schema-fixtures/acceptance-evidence/valid-real-dogfood.json'),
  'utf8'
));
const invalidFixture = JSON.parse(readFileSync(
  path.join(root, 'tests/schema-fixtures/acceptance-evidence/invalid-forged-realness.json'),
  'utf8'
));
const evidenceSchema = JSON.parse(readFileSync(
  path.join(root, 'schemas/governance/acceptance-evidence-map.schema.json'),
  'utf8'
));

const validateEvidenceSchema = new Ajv2020({ allErrors: true }).compile(evidenceSchema);
assert.equal(validateEvidenceSchema(validFixture), true);
assert.equal(validateEvidenceSchema(invalidFixture), false);

const parsedValid = parseAcceptanceEvidenceMap(validFixture);
assert.deepEqual(parsedValid.errors, []);
assert.equal(parsedValid.value?.['parallel-run-is-real'].requiredRealness, 'real-dogfood');

const parsedInvalid = parseAcceptanceEvidenceMap(invalidFixture);
assert.ok(parsedInvalid.errors.some((entry) => entry.includes('requiredRealness is unknown')));
assert.ok(parsedInvalid.errors.some((entry) => entry.includes('negative control')));
assert.ok(parsedInvalid.errors.some((entry) => entry.includes('must be inconclusive')));

const absent = parseAcceptanceEvidenceMap(undefined);
assert.equal(absent.value, undefined, 'legacy prose-only cards must remain unchanged');
assert.deepEqual(absent.errors, []);

const tempRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-acceptance-evidence-import-'));
const cardPath = path.join(tempRepo, 'ATM-TEST-0001.task.md');
writeFileSync(cardPath, [
  '---',
  'task_id: ATM-TEST-0001',
  'title: Evidence import fixture',
  'status: planned',
  'scopePaths: [src/example.ts]',
  'deliverables: [src/example.ts]',
  `acceptanceEvidence: '${JSON.stringify(validFixture)}'`,
  '---',
  '',
  '# ATM-TEST-0001 Evidence import fixture',
  '',
  '## Acceptance',
  '',
  '- Preserve the authored machine-readable evidence contract.'
].join('\n'), 'utf8');

const dryRun = await runTasksImport([
  '--cwd', tempRepo,
  '--from', cardPath,
  '--dry-run',
  '--json'
]) as any;
assert.equal(dryRun.ok, true);
const imported = dryRun.evidence.manifest.tasks[0];
assert.deepEqual(imported.acceptanceEvidence, validFixture);

writeFileSync(cardPath, [
  '---',
  'task_id: ATM-TEST-0001',
  'title: Legacy prose-only fixture',
  'status: planned',
  'scopePaths: [src/example.ts]',
  'deliverables: [src/example.ts]',
  '---',
  '',
  '# ATM-TEST-0001 Legacy prose-only fixture',
  '',
  '## Acceptance',
  '',
  '- Continue importing without synthesized evidence metadata.'
].join('\n'), 'utf8');

const legacyDryRun = await runTasksImport([
  '--cwd', tempRepo,
  '--from', cardPath,
  '--dry-run',
  '--json'
]) as any;
assert.equal(legacyDryRun.evidence.manifest.tasks[0].acceptanceEvidence, undefined);

console.log('[task-import-acceptance-evidence:test] ok');
