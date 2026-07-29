import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeTransactionalMutations } from '../../packages/core/src/broker/transactional-composer.ts';
import {
  applyTransactionalStewardPlan,
  buildStewardSemanticValidationReceipt
} from '../../packages/core/src/broker/steward-transactional-apply.ts';
import { brokerAdapterMigration, type MutationRequest } from '../../packages/core/src/broker/types.ts';

function mutation(requestId: string, filePath: string, target: string, value: unknown): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    requestId,
    actorId: `actor-${requestId}`,
    taskId: 'ATM-GOV-0249',
    filePath,
    op: 'upsert',
    target,
    value
  };
}

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-transactional-steward-rollback-'));
try {
  const firstPath = path.join(cwd, 'a.json');
  const secondPath = path.join(cwd, 'b.json');
  const firstBefore = '{\n  "records": {}\n}\n';
  const secondBefore = '{\n  "records": {}\n}\n';
  writeFileSync(firstPath, firstBefore, 'utf8');
  writeFileSync(secondPath, secondBefore, 'utf8');

  const composition = composeTransactionalMutations({
    files: [
      { filePath: 'a.json', content: firstBefore },
      { filePath: 'b.json', content: secondBefore }
    ],
    requests: [
      mutation('req-a', 'a.json', '/records/a', 1),
      mutation('req-b', 'b.json', '/records/b', 2)
    ]
  });

  assert.equal(composition.ok, true);
  assert.equal(composition.plan.fileSlices.length, 2);

  const receipt = buildStewardSemanticValidationReceipt({
    plan: composition.plan,
    outputFiles: composition.outputFiles
  });
  const apply = applyTransactionalStewardPlan({
    cwd,
    stewardId: 'neutral-write-steward',
    writerRole: 'neutral-steward',
    plan: composition.plan,
    outputFiles: composition.outputFiles,
    scopeFiles: ['a.json', 'b.json'],
    semanticValidation: receipt,
    failAfterWrites: 1
  });

  assert.equal(apply.ok, false);
  assert.equal(apply.receipt.verdict, 'rolled-back');
  assert.deepEqual(apply.receipt.compensation?.restoredFiles, ['a.json', 'b.json']);
  assert.equal(readFileSync(firstPath, 'utf8'), firstBefore);
  assert.equal(readFileSync(secondPath, 'utf8'), secondBefore);

  const badReceipt = {
    ...receipt,
    candidateDigest: 'sha256:not-authorized',
    outputDigest: 'sha256:not-authorized'
  };
  const blocked = applyTransactionalStewardPlan({
    cwd,
    stewardId: 'neutral-write-steward',
    writerRole: 'neutral-steward',
    plan: composition.plan,
    outputFiles: composition.outputFiles,
    scopeFiles: ['a.json', 'b.json'],
    semanticValidation: badReceipt
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.receipt.verdict, 'blocked');
  assert.match(blocked.receipt.blockedReasons.join('\n'), /semantic validation receipt/);
  assert.equal(readFileSync(firstPath, 'utf8'), firstBefore);
  assert.equal(readFileSync(secondPath, 'utf8'), secondBefore);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('[transactional-steward-rollback] ok');
