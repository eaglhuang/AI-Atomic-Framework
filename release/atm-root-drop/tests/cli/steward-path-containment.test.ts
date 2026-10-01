import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeTransactionalMutations } from '../../packages/core/src/broker/transactional-composer.ts';
import { applyTransactionalStewardPlan, buildStewardSemanticValidationReceipt } from '../../packages/core/src/broker/steward-transactional-apply.ts';
import { brokerAdapterMigration } from '../../packages/core/src/broker/types.ts';

const fixture = mkdtempSync(path.join(os.tmpdir(), 'atm-steward-containment-'));
const cwd = path.join(fixture, 'canonical');
const outside = path.join(fixture, 'outside');
const before = '{"safe":true}';
mkdirSync(cwd);
mkdirSync(outside);

function apply(filePath: string) {
  const composition = composeTransactionalMutations({
    files: [{ filePath, content: before }],
    requests: [{
      schemaId: 'atm.mutationRequest.v1', specVersion: '0.1.0', migration: brokerAdapterMigration(),
      requestId: 'containment', actorId: 'test', taskId: 'test', filePath,
      op: 'upsert', target: '/safe', value: false
    }]
  });
  assert.equal(composition.ok, true);
  return applyTransactionalStewardPlan({
    cwd, stewardId: 'test', writerRole: 'neutral-steward', plan: composition.plan,
    outputFiles: composition.outputFiles, scopeFiles: [filePath],
    semanticValidation: buildStewardSemanticValidationReceipt(composition)
  });
}

function blocked(filePath: string, physicalTarget: string) {
  const result = apply(filePath);
  assert.equal(result.ok, false, `${filePath} must not write outside canonical root`);
  assert.equal(result.receipt.verdict, 'blocked');
  assert.equal(result.receipt.files.length, 0);
  assert.equal(readFileSync(physicalTarget, 'utf8'), before);
}

try {
  const externalFile = path.join(outside, 'data.json');
  writeFileSync(externalFile, before);
  symlinkSync(outside, path.join(cwd, 'external-directory'), process.platform === 'win32' ? 'junction' : 'dir');
  blocked('external-directory/data.json', externalFile);
  blocked('../outside/data.json', externalFile);

  const internalDirectory = path.join(cwd, 'internal');
  mkdirSync(internalDirectory);
  writeFileSync(path.join(internalDirectory, 'data.json'), before);
  symlinkSync(internalDirectory, path.join(cwd, 'internal-alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(apply('internal-alias/data.json').ok, true);
  assert.equal(JSON.parse(readFileSync(path.join(internalDirectory, 'data.json'), 'utf8')).safe, false);

  writeFileSync(path.join(cwd, '..notes.json'), before);
  assert.equal(apply('..notes.json').ok, true, 'a filename prefix is not parent traversal');

  let fileLinkAvailable = true;
  try {
    symlinkSync(externalFile, path.join(cwd, 'external-file.json'), 'file');
  } catch (error) {
    if (process.platform !== 'win32' || (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    fileLinkAvailable = false;
    console.log('[steward-path-containment] file symlink skipped: Windows privilege unavailable; directory junction tested');
  }
  if (fileLinkAvailable) blocked('external-file.json', externalFile);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
console.log('[steward-path-containment] ok');
