import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { generateAtom, createMinimalAtomSpec } from '../../packages/core/src/manager/atom-generator.ts';

if (process.argv.includes('--self-check')) {
  const spec = createMinimalAtomSpec({
    atomId: 'ATM-CORE-9999',
    bucket: 'CORE',
    title: 'Self Check',
    description: 'Self-check fixture.',
    logicalName: 'atom.core-self-check'
  });
  assert.equal(spec.id, 'ATM-CORE-9999');
  assert.equal(spec.logicalName, 'atom.core-self-check');
  assert.equal(spec.validation.commands[0], 'node -e "console.log(\'ATM-CORE-9999 validation ok\')"');
  console.log('[atom-generator:self-check] ok');
  process.exit(0);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-atom-generator-'));
try {
  const dryRun = generateAtom({
    bucket: 'core',
    title: 'Dry Run Atom',
    description: 'Preview only.',
    logicalName: 'atom.core-dry-run-atom'
  }, { repositoryRoot: tempRoot, dryRun: true, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.atomId, 'ATM-CORE-0001');
  assert.equal(existsSync(path.join(tempRoot, 'atomic_workbench')), false);

  const first = generateAtom({
    bucket: 'CORE',
    title: 'Generated Atom',
    description: 'Create a generated atom.',
    logicalName: 'atom.core-generated-atom'
  }, { repositoryRoot: tempRoot, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(first.ok, true);
  assert.equal(first.atomId, 'ATM-CORE-0001');
  assert.equal(first.allocation.sequence, 1);
  assert.equal(existsSync(path.join(tempRoot, first.specPath)), true);
  assert.equal(existsSync(path.join(tempRoot, first.sourcePath)), true);
  assert.equal(existsSync(path.join(tempRoot, first.testPath)), true);
  assert.equal(existsSync(path.join(tempRoot, 'atomic-registry.json')), true);
  assert.equal(existsSync(path.join(tempRoot, 'atomic_workbench/registry-catalog.md')), true);

  const registry = JSON.parse(readFileSync(path.join(tempRoot, 'atomic-registry.json'), 'utf8'));
  assert.equal(registry.entries.length, 1);
  assert.equal(registry.entries[0].logicalName, 'atom.core-generated-atom');
  assert.deepEqual(registry.entries[0].location.codePaths, [first.sourcePath]);
  assert.notEqual(registry.entries[0].selfVerification.sourcePaths.code[0], registry.entries[0].selfVerification.sourcePaths.spec);

  const sourceSelfCheck = spawnSync(process.execPath, [path.join(tempRoot, first.sourcePath), '--self-check'], {
    cwd: tempRoot,
    encoding: 'utf8'
  });
  assert.equal(sourceSelfCheck.status, 0);

  const second = generateAtom({
    bucket: 'CORE',
    title: 'Generated Atom',
    description: 'Create a generated atom.',
    logicalName: 'atom.core-generated-atom'
  }, { repositoryRoot: tempRoot, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);
  assert.equal(second.atomId, 'ATM-CORE-0001');

  const next = generateAtom({
    bucket: 'CORE',
    title: 'Next Generated Atom',
    description: 'Create the next atom.',
    logicalName: 'atom.core-next-generated-atom'
  }, { repositoryRoot: tempRoot, now: '2026-01-01T00:00:00.000Z' });
  assert.equal(next.ok, true);
  assert.equal(next.atomId, 'ATM-CORE-0002');

  const invalidBucket = generateAtom({ bucket: '', title: 'Bad', description: 'Bad.' }, { repositoryRoot: tempRoot });
  assert.equal(invalidBucket.ok, false);
  assert.equal(invalidBucket.error.code, 'ATM_BUCKET_INVALID');

  writeFileSync(path.join(tempRoot, 'atomic-registry.json'), '{bad json', 'utf8');
  const invalidRegistry = generateAtom({
    bucket: 'CORE',
    title: 'Broken Registry',
    description: 'Should fail.',
    logicalName: 'atom.core-broken-registry'
  }, { repositoryRoot: tempRoot });
  assert.equal(invalidRegistry.ok, false);
  assert.equal(invalidRegistry.error.code, 'ATM_REGISTRY_INVALID');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[atom-generator:test] ok (10 acceptance checks)');