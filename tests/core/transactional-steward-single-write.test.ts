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

function mutation(overrides: Partial<MutationRequest> & Pick<MutationRequest, 'requestId' | 'target' | 'value'>): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    actorId: overrides.actorId ?? 'agent-a',
    taskId: overrides.taskId ?? 'ATM-GOV-0249',
    filePath: 'registry.json',
    op: 'upsert',
    ...overrides
  };
}

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-transactional-steward-single-'));
try {
  const targetPath = path.join(cwd, 'registry.json');
  writeFileSync(targetPath, '{\n  "records": {}\n}\n', 'utf8');

  const composition = composeTransactionalMutations({
    files: [{ filePath: 'registry.json', content: readFileSync(targetPath, 'utf8') }],
    requests: [
      mutation({ requestId: 'req-a', actorId: 'worker-a', target: '/records/a', value: { ok: true } }),
      mutation({ requestId: 'req-b', actorId: 'worker-b', target: '/records/b', value: { ok: true } })
    ],
    validators: ['node --strip-types tests/core/transactional-steward-single-write.test.ts']
  });

  assert.equal(composition.ok, true);
  assert.deepEqual(composition.plan.selectedRequestIds, ['req-a', 'req-b']);
  assert.equal(composition.plan.fileSlices.length, 1);

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
    scopeFiles: ['registry.json'],
    semanticValidation: receipt,
    baseHead: 'test-head'
  });

  assert.equal(apply.ok, true);
  assert.equal(apply.receipt.writerRole, 'neutral-steward');
  assert.equal(apply.receipt.files.length, 1);
  assert.equal(apply.receipt.files[0].canonicalWriteCount, 1);
  assert.deepEqual(apply.receipt.memberAttribution.map((entry) => entry.actorId), ['worker-a', 'worker-b']);
  assert.match(readFileSync(targetPath, 'utf8'), /"a"/);
  assert.match(readFileSync(targetPath, 'utf8'), /"b"/);

  const stale = applyTransactionalStewardPlan({
    cwd,
    stewardId: 'neutral-write-steward',
    writerRole: 'neutral-steward',
    plan: composition.plan,
    outputFiles: composition.outputFiles,
    scopeFiles: ['registry.json'],
    semanticValidation: receipt
  });

  assert.equal(stale.ok, false);
  assert.equal(stale.receipt.verdict, 'blocked');
  assert.match(stale.receipt.blockedReasons.join('\n'), /base hash is stale/);
  assert.equal(stale.receipt.files.length, 0);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('[transactional-steward-single-write] ok');
