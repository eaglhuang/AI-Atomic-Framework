import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID,
  evidenceBundleManifestPathForTask,
  readEvidenceBundleManifest,
  runEvidence
} from '../../packages/cli/src/commands/evidence.ts';
import {
  DIRECTORY_DELIVERABLE_MANIFEST_SCHEMA_ID,
  expandDirectoryDeliverableDeclarations,
  isDirectoryStyleDeliverableDeclaration
} from '../../packages/cli/src/commands/tasks/historical-delivery.ts';
import { listOptionalEvidenceBundleGovernanceArtifacts } from '../../packages/cli/src/commands/taskflow/close-orchestration.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-test-evidence-bundle-manifest');

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  const taskId = 'TASK-EVIDENCE-BUNDLE-0041';
  writeJson(path.join(tempDir, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  writeJson(path.join(tempDir, '.atm/runtime/identity/default.json'), {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: 'fixture-agent',
    gitName: 'fixture-agent',
    gitEmail: 'fixture-agent@example.com',
    updatedAt: '2026-06-17T00:00:00.000Z'
  });
  writeJson(path.join(tempDir, '.atm/history/tasks', `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Evidence bundle manifest fixture',
    status: 'running',
    validators: ['typecheck']
  });

  const freshAdd = await runEvidence([
    'add',
    '--cwd', tempDir,
    '--task', taskId,
    '--actor', 'fixture-agent',
    '--kind', 'test',
    '--summary', 'fresh validator pass',
    '--command', 'npm run typecheck',
    '--exit-code', '0',
    '--stdout-sha256', 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    '--stderr-sha256', 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '--validators', 'typecheck',
    '--json'
  ]) as any;

  assert.equal(freshAdd.ok, true);
  assert.ok(freshAdd.evidence.bundleManifestPath?.endsWith(`${taskId}.bundle-manifest.json`));
  const freshManifest = readEvidenceBundleManifest(tempDir, taskId);
  assert.ok(freshManifest);
  assert.equal(freshManifest?.schemaId, EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID);
  assert.deepEqual(freshManifest?.freshValidationPasses, ['typecheck']);
  assert.equal(freshManifest?.staleValidationPasses.length, 0);
  assert.equal(freshManifest?.commandRuns.length, 1);
  assert.ok(existsSync(evidenceBundleManifestPathForTask(tempDir, taskId)));
  assert.deepEqual(listOptionalEvidenceBundleGovernanceArtifacts(tempDir, taskId), [
    `.atm/history/evidence/${taskId}.bundle-manifest.json`
  ]);

  const staleAdd = await runEvidence([
    'add',
    '--cwd', tempDir,
    '--task', taskId,
    '--actor', 'fixture-agent',
    '--kind', 'test',
    '--summary', 'historical validator pass',
    '--command', 'npm run validate:cli',
    '--exit-code', '0',
    '--stdout-sha256', 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    '--stderr-sha256', 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '--validators', 'validate:cli',
    '--freshness', 'historical-reference',
    '--json'
  ]) as any;
  assert.equal(staleAdd.ok, true);
  const mixedManifest = readEvidenceBundleManifest(tempDir, taskId);
  assert.deepEqual(mixedManifest?.freshValidationPasses, ['typecheck']);
  assert.deepEqual(mixedManifest?.staleValidationPasses, ['validate:cli']);

  const fixtureDir = path.join(tempDir, 'tests/cli-fixtures/evidence-bundle-dir');
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(path.join(fixtureDir, 'alpha.json'), '{}\n', 'utf8');
  writeFileSync(path.join(fixtureDir, 'beta.json'), '{}\n', 'utf8');
  const declaredDir = 'tests/cli-fixtures/evidence-bundle-dir';
  assert.equal(isDirectoryStyleDeliverableDeclaration(tempDir, declaredDir), true);
  const expansion = expandDirectoryDeliverableDeclarations(tempDir, [declaredDir]);
  assert.equal(expansion.ok, true);
  assert.equal(expansion.directoryManifests.length, 1);
  assert.equal(expansion.directoryManifests[0]?.schemaId, DIRECTORY_DELIVERABLE_MANIFEST_SCHEMA_ID);
  assert.deepEqual([...expansion.directoryManifests[0]?.files ?? []].sort(), [
    `${declaredDir}/alpha.json`,
    `${declaredDir}/beta.json`
  ]);

  const emptyDir = path.join(tempDir, 'tests/cli-fixtures/empty-dir');
  mkdirSync(emptyDir, { recursive: true });
  const emptyExpansion = expandDirectoryDeliverableDeclarations(tempDir, ['tests/cli-fixtures/empty-dir']);
  assert.equal(emptyExpansion.ok, false);
  assert.match(emptyExpansion.failClosedReason ?? '', /empty or missing/i);

  const manifestOnDisk = JSON.parse(readFileSync(evidenceBundleManifestPathForTask(tempDir, taskId), 'utf8'));
  assert.equal(manifestOnDisk.schemaId, EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID);
  assert.equal(manifestOnDisk.taskId, taskId);

  console.log('evidence-bundle-manifest.test.ts: all assertions passed');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
