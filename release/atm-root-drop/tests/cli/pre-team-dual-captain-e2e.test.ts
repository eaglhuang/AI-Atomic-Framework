import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';
import {
  GOVERNANCE_BACKLOG_PROJECTION,
  emptyGovernanceSharedSurfaces
} from '../../packages/core/src/broker/global-resource-projection.ts';
import type { SharedSurfacesRecord, WriteIntent } from '../../packages/core/src/broker/types.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-pre-team-dual-captain-'));
const root = process.cwd();
const atmCliEntrypoint = path.join(root, 'packages/cli/src/atm.ts');

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function write(relativePath: string, content: string): void {
  const absolutePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf8');
}

function writeJson(relativePath: string, value: unknown): void {
  write(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runSpawnedAtm(args: readonly string[]): Record<string, any> {
  const result = spawnSync(process.execPath, ['--strip-types', atmCliEntrypoint, ...args, '--json'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(
    result.status,
    0,
    `spawned ATM CLI command failed: ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  return JSON.parse(result.stdout.trim()) as Record<string, any>;
}

function makeIntent(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly baseCommit: string;
  readonly targetFiles: readonly string[];
  readonly sharedSurfaces?: SharedSurfacesRecord;
}): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'dual-captain spawned broker fixture'
    },
    taskId: input.taskId,
    actorId: input.actorId,
    baseCommit: input.baseCommit,
    targetFiles: input.targetFiles,
    atomRefs: input.targetFiles.map((filePath, index) => ({
      atomId: `${input.taskId}.atom.${index + 1}`,
      atomCid: `sha256-${input.taskId.toLowerCase()}-${index + 1}`,
      operation: 'modify',
      sourceRange: {
        filePath,
        lineStart: 1,
        lineEnd: 1
      }
    })),
    sharedSurfaces: input.sharedSurfaces ?? emptyGovernanceSharedSurfaces(),
    requestedLane: 'auto'
  };
}

function stagedBlobIdentity(relativePath: string): string {
  const line = git(['ls-files', '-s', '--', relativePath]).trim();
  const match = /^(\d+)\s+([0-9a-f]+)\s+\d+\t(.+)$/i.exec(line);
  assert.ok(match, `expected staged blob identity for ${relativePath}`);
  return `${match[1]}:${match[2]}:${match[3]}`;
}

try {
  git(['init']);
  git(['config', 'user.name', 'fixture-captain-a']);
  git(['config', 'user.email', 'fixture-captain-a@example.com']);

  const taskId = 'ATM-GOV-0145';
  const actorId = 'fixture-captain-a';
  const sessionId = 'session-atm-gov-0145';
  const leaseId = 'lease-atm-gov-0145';
  const activeDeliverable = 'src/active-close-deliverable.ts';
  const foreignStaged = 'src/foreign-captain-staged.ts';
  const foreignUnstaged = 'src/foreign-captain-unstaged.ts';

  writeJson('.atm/config.json', {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  writeJson('.atm/runtime/identity/default.json', {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId,
    gitName: 'fixture-captain-a',
    gitEmail: 'fixture-captain-a@example.com',
    updatedAt: '2026-07-15T00:00:00.000Z'
  });
  writeJson(`.atm/history/tasks/${taskId}.json`, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'dual captain foundation gate fixture',
    status: 'running',
    owner: actorId,
    scopePaths: [activeDeliverable],
    deliverables: [activeDeliverable],
    claim: {
      actorId,
      leaseId,
      state: 'active',
      files: [activeDeliverable]
    }
  });
  writeJson(`.atm/runtime/sessions/${sessionId}.json`, {
    schemaId: 'atm.actorWorkSession.v1',
    specVersion: '0.1.0',
    sessionId,
    actorId,
    taskId,
    claimLeaseId: leaseId,
    status: 'active',
    createdAt: '2026-07-15T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z'
  });
  write(activeDeliverable, 'export const activeCloseDeliverable = "base";\n');
  write(foreignStaged, 'export const foreignCaptainStaged = "base";\n');
  write(foreignUnstaged, 'export const foreignCaptainUnstaged = "base";\n');
  git(['add', '.']);
  git(['commit', '-m', 'chore: seed dual captain fixture']);

  write(activeDeliverable, 'export const activeCloseDeliverable = "ready";\n');
  write(foreignStaged, 'export const foreignCaptainStaged = "approved-stage";\n');
  git(['add', foreignStaged]);
  const foreignStagedBefore = stagedBlobIdentity(foreignStaged);
  write(foreignUnstaged, 'export const foreignCaptainUnstaged = "worktree-only";\n');
  const foreignUnstagedBefore = readFileSync(path.join(repo, foreignUnstaged), 'utf8');

  const result = await runAtmGit([
    'commit',
    '--cwd', repo,
    '--actor', actorId,
    '--task', taskId,
    '--session', sessionId,
    '--message', 'test: dual captain scoped commit',
    '--auto-stage',
    '--defer-foreign-staged',
    '--json'
  ]);

  assert.equal(result.ok, true, 'governed commit must succeed while foreign work exists');
  const headFiles = git(['show', '--name-only', '--format=', 'HEAD']);
  assert.equal(headFiles.includes(activeDeliverable), true, 'active task deliverable must be committed');
  assert.equal(headFiles.includes(foreignStaged), false, 'foreign staged file must not enter the active task commit');
  assert.equal(headFiles.includes(foreignUnstaged), false, 'foreign unstaged file must not enter the active task commit');
  assert.equal(stagedBlobIdentity(foreignStaged), foreignStagedBefore, 'foreign staged blob must remain byte-identical');
  assert.equal(readFileSync(path.join(repo, foreignUnstaged), 'utf8'), foreignUnstagedBefore, 'foreign unstaged content must remain byte-identical');
  assert.equal(git(['diff', '--cached', '--name-only']).includes(foreignStaged), true, 'foreign staged file must remain staged for its owner');
  assert.equal(git(['diff', '--name-only']).includes(foreignUnstaged), true, 'foreign unstaged file must remain dirty for its owner');

  const baseCommit = git(['rev-parse', 'HEAD']).trim();
  const rftIntent = makeIntent({
    taskId: 'TASK-RFT-0040',
    actorId: 'fixture-captain-rft',
    baseCommit,
    targetFiles: [
      'packages/cli/src/commands/team-legacy.ts',
      'packages/cli/src/commands/team/legacy/permission-lease-policy.ts',
      'tests/cli/team-legacy-permission-lease-extraction.test.ts',
      'atomic_workbench/atomization-coverage/path-to-atom-map.shards/team-legacy-owner-map.json'
    ]
  });
  const backlogItemIntent = makeIntent({
    taskId: 'ATM-GOV-0149',
    actorId: 'fixture-captain-backlog',
    baseCommit,
    targetFiles: [
      'docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG-2026-07-15-202.json'
    ]
  });
  const projectionStewardIntent = makeIntent({
    taskId: 'ATM-GOV-PROJECTION-STEWARD',
    actorId: 'fixture-projection-steward',
    baseCommit,
    targetFiles: ['docs/governance/atm-bug-and-optimization-backlog.md'],
    sharedSurfaces: {
      ...emptyGovernanceSharedSurfaces(),
      projections: [GOVERNANCE_BACKLOG_PROJECTION]
    }
  });
  const backlogProjectionIntent = makeIntent({
    taskId: 'ATM-GOV-0149-PROJECTION-REBUILD',
    actorId: 'fixture-captain-backlog',
    baseCommit,
    targetFiles: ['docs/governance/atm-bug-and-optimization-backlog.md'],
    sharedSurfaces: {
      ...emptyGovernanceSharedSurfaces(),
      projections: [GOVERNANCE_BACKLOG_PROJECTION]
    }
  });

  writeJson('broker-fixtures/rft-intent.json', rftIntent);
  writeJson('broker-fixtures/backlog-item-intent.json', backlogItemIntent);
  writeJson('broker-fixtures/projection-steward-intent.json', projectionStewardIntent);
  writeJson('broker-fixtures/backlog-projection-intent.json', backlogProjectionIntent);

  const rftRegistration = runSpawnedAtm([
    'broker',
    'register',
    '--task', rftIntent.taskId,
    '--actor', rftIntent.actorId,
    '--intent-file', path.join(repo, 'broker-fixtures', 'rft-intent.json')
  ]);
  assert.equal(rftRegistration.ok, true, 'RFT-like Team surface registration must enter the Broker through the spawned CLI');
  assert.equal(rftRegistration.evidence?.decision?.verdict, 'parallel-safe');

  const backlogDecision = runSpawnedAtm([
    'broker',
    'decision',
    '--intent-file', path.join(repo, 'broker-fixtures', 'backlog-item-intent.json')
  ]);
  assert.equal(
    backlogDecision.evidence?.decision?.verdict,
    'parallel-safe',
    'append-only backlog item shard must stay parallel-safe while an RFT-like Team surface is active'
  );
  assert.equal(
    backlogDecision.evidence?.decision?.conflictMatrix?.arbitrationVerdict,
    'allow',
    'unified admission must allow the non-overlapping backlog item shard'
  );

  const projectionStewardRegistration = runSpawnedAtm([
    'broker',
    'register',
    '--task', projectionStewardIntent.taskId,
    '--actor', projectionStewardIntent.actorId,
    '--intent-file', path.join(repo, 'broker-fixtures', 'projection-steward-intent.json')
  ]);
  assert.equal(projectionStewardRegistration.ok, true, 'projection steward must register the generated projection key through the spawned CLI');

  const projectionDecision = runSpawnedAtm([
    'broker',
    'decision',
    '--intent-file', path.join(repo, 'broker-fixtures', 'backlog-projection-intent.json')
  ]);
  assert.equal(
    projectionDecision.evidence?.decision?.verdict,
    'blocked-shared-surface',
    'generated backlog projection rebuild must be blocked on the canonical projection key'
  );
  assert.equal(
    projectionDecision.evidence?.decision?.failureReason?.sharedSurface,
    GOVERNANCE_BACKLOG_PROJECTION,
    'projection block must name the canonical governance backlog projection key'
  );

  const brokerStatus = runSpawnedAtm(['broker', 'status']);
  const activeTasks = new Set((brokerStatus.evidence?.activeIntents ?? []).map((intent: { taskId?: string }) => intent.taskId));
  assert.equal(activeTasks.has(rftIntent.taskId), true, 'spawned Broker registry must retain the RFT-like active intent');
  assert.equal(activeTasks.has(projectionStewardIntent.taskId), true, 'spawned Broker registry must retain the projection steward intent');

  console.log('[pre-team-dual-captain-e2e] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
