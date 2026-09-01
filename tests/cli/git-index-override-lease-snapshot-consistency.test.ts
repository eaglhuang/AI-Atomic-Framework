import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectGitIndexOwnership } from '../../packages/cli/src/commands/git-index-ownership.ts';
import { runGitLease } from '../../packages/cli/src/commands/git-governance/implementation/lease-command.ts';
import { buildHistoricalClosePreflight } from '../../packages/cli/src/commands/taskflow/historical-close-preflight.ts';

const tempDir = path.join(os.tmpdir(), `atm-index-snapshot-${process.pid}`);
const runGit = (args: string[]) => execFileSync('git', args, { cwd: tempDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

try {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
  runGit(['init']);
  runGit(['config', 'user.name', 'fixture-agent']);
  runGit(['config', 'user.email', 'fixture-agent@example.invalid']);
  writeFileSync(path.join(tempDir, 'README.md'), 'fixture\n', 'utf8');
  runGit(['add', 'README.md']);
  runGit(['commit', '-m', 'fixture']);

  const foreignTaskId = 'TASK-FOREIGN-0008';
  const stagedPath = '.atm/history/evidence/git-head.jsonl';
  mkdirSync(path.join(tempDir, path.dirname(stagedPath)), { recursive: true });
  writeFileSync(path.join(tempDir, stagedPath), '{"fixture":true}\n', 'utf8');
  mkdirSync(path.join(tempDir, '.atm/runtime/task-direction-locks'), { recursive: true });
  mkdirSync(path.join(tempDir, '.atm/history/tasks'), { recursive: true });
  writeFileSync(path.join(tempDir, '.atm/history/tasks', `${foreignTaskId}.json`), `${JSON.stringify({
    workItemId: foreignTaskId,
    status: 'running',
    claim: {
      actorId: 'foreign-agent',
      leaseId: 'lease-foreign-0008',
      claimedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      ttlSeconds: 3600,
      files: [stagedPath],
      state: 'active'
    },
    workAdmissionTicket: {
      schemaId: 'atm.workAdmissionTicket.v1',
      grants: [{ kind: 'file-write', values: [stagedPath] }]
    }
  }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(tempDir, '.atm/runtime/task-direction-locks', `${foreignTaskId}.json`), `${JSON.stringify({
    schemaId: 'atm.taskDirectionLock.v1',
    specVersion: '0.1.0',
    taskId: foreignTaskId,
    batchId: null,
    scopeKey: null,
    queueId: null,
    queueIndex: null,
    allowedFiles: [],
    planningReadOnlyPaths: [],
    planningMirrorPaths: [],
    allowPlanningMirror: false,
    promptHash: null,
    actorId: 'foreign-agent',
    sessionId: 'session-foreign',
    createdAt: new Date().toISOString(),
    status: 'active'
  }, null, 2)}\n`, 'utf8');
  runGit(['add', stagedPath]);

  const ownership = inspectGitIndexOwnership({ cwd: tempDir, taskId: 'TASK-CLOSE-0008' });
  assert.deepEqual(ownership.foreignActiveStaged.map((entry) => entry.path), [stagedPath]);
  assert.equal(ownership.foreignActiveStaged[0]?.ownerTaskId, foreignTaskId);

  const issued = runGitLease({
    cwd: tempDir,
    actorId: 'fixture-agent',
    taskId: 'TASK-CLOSE-0008',
    leaseKind: 'stage-override',
    paths: [stagedPath],
    overrideReason: 'fixture human approval',
    ttlSeconds: 60
  });
  assert.equal(issued.ok, true, 'the issuer must consume the same ownership snapshot as the close gate');
  assert.deepEqual((issued.evidence as { lease: { paths: string[] } }).lease.paths, [stagedPath]);

  const closePreflight = buildHistoricalClosePreflight({
    cwd: tempDir,
    taskId: 'TASK-CLOSE-0008',
    actorId: 'fixture-agent',
    taskDocument: { workItemId: 'TASK-CLOSE-0008', scopePaths: [], deliverables: [] },
    previewCommitBundle: {
      targetRepo: { repoRoot: tempDir, stageFiles: [] },
      planningRepo: { repoRoot: null, stageFiles: [] }
    },
    historicalDeliveryRefs: [],
    waiverOutOfScopeDelivery: false,
    waiverReason: null
  });
  assert.deepEqual(
    closePreflight.unexpectedStagedTasks.map((entry) => ({ taskId: entry.taskId, stagedFiles: entry.stagedFiles })),
    [{ taskId: foreignTaskId, stagedFiles: [stagedPath] }],
    'close preflight must consume the same active-owner snapshot as lease issuance'
  );

  console.log(JSON.stringify({ marker: '[git-index-override-lease-snapshot-consistency] ok' }));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
