import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectResolutionAuthorizedForeignTaskIds } from '../../packages/cli/src/commands/broker-conflict-resolution.ts';
import { createBrokerConflictResolutionArtifact } from '../../packages/core/src/team-runtime/permission-broker.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-conflict-supersession-'));
const resolutionsDir = path.join(repo, '.atm', 'runtime', 'broker-conflict-resolutions');
mkdirSync(resolutionsDir, { recursive: true });

try {
  const older = createBrokerConflictResolutionArtifact({
    primaryTaskId: 'TASK-A',
    conflictingTaskIds: ['TASK-B'],
    sharedPaths: ['packages/shared.ts'],
    releaseOrder: ['TASK-A', 'TASK-B'],
    createdAt: '2026-09-05T03:00:00.000Z',
    decisionReason: 'older release order'
  });
  const newerOpposing = createBrokerConflictResolutionArtifact({
    primaryTaskId: 'TASK-B',
    conflictingTaskIds: ['TASK-A'],
    sharedPaths: ['packages/shared.ts'],
    releaseOrder: ['TASK-B', 'TASK-A'],
    createdAt: '2026-09-05T03:01:00.000Z',
    decisionReason: 'newer opposing release order'
  });
  writeFileSync(path.join(resolutionsDir, `${older.resolutionId}.json`), `${JSON.stringify(older)}\n`);
  writeFileSync(path.join(resolutionsDir, `${newerOpposing.resolutionId}.json`), `${JSON.stringify(newerOpposing)}\n`);

  const taskAAuthority = collectResolutionAuthorizedForeignTaskIds(repo, 'TASK-A');
  const taskBAuthority = collectResolutionAuthorizedForeignTaskIds(repo, 'TASK-B');
  assert.equal(taskAAuthority.has('TASK-B'), false, 'older opposing authority must not continue authorizing TASK-A');
  assert.equal(taskBAuthority.has('TASK-A'), true, 'newest release order must authorize only its current task');
  console.log('broker-conflict-supersession: PASS');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
