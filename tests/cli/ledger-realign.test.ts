import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../../packages/cli/src/commands/shared.ts';
import { assertRecordCommitPayloadPresent } from '../../packages/cli/src/commands/git-governance/record-commit-payload-assertion.ts';
import {
  REALIGN_PROTECTED_LIFECYCLE_FIELDS,
  buildRealignProposals,
  parseRealignMapFile,
  runTasksRealignPlanSource
} from '../../packages/cli/src/commands/tasks/realign-plan-source.ts';

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-ledger-realign-'));
const planning = path.join(root, 'planning');
const target = path.join(root, 'target');
mkdirSync(path.join(planning, 'docs/ai_atomic_framework/governance-optimization/tasks'), { recursive: true });
mkdirSync(path.join(planning, 'docs/ai_atomic_framework/rft-hardening/tasks'), { recursive: true });
mkdirSync(path.join(target, '.atm/history/tasks'), { recursive: true });

runGit(planning, ['init']);
runGit(planning, ['config', 'user.name', 'ATM Validator']);
runGit(planning, ['config', 'user.email', 'validator@example.invalid']);
runGit(target, ['init']);
runGit(target, ['config', 'user.name', 'ATM Validator']);
runGit(target, ['config', 'user.email', 'validator@example.invalid']);
runGit(target, ['commit', '--allow-empty', '-m', 'bootstrap']);

const cardBodies = [
  { id: 'TASK-DEMO-0001', oldDir: 'rft-hardening/tasks', newDir: 'governance-optimization/tasks', body: '# TASK-DEMO-0001\n\nstatus: done\n' },
  { id: 'TASK-DEMO-0002', oldDir: 'rft-hardening/tasks', newDir: 'governance-optimization/tasks', body: '# TASK-DEMO-0002\n\nstatus: done\n' },
  { id: 'TASK-DEMO-0003', oldDir: 'rft-hardening/tasks', newDir: 'governance-optimization/tasks', body: '# TASK-DEMO-0003\n\nstatus: done\n' }
];

const mappings: Record<string, string> = {};
for (const card of cardBodies) {
  const oldRel = `${card.oldDir}/${card.id}.task.md`;
  const newRel = `${card.newDir}/${card.id}.task.md`;
  const absoluteNew = path.join(planning, 'docs/ai_atomic_framework', newRel);
  writeFileSync(absoluteNew, card.body, 'utf8');
  mappings[`docs/ai_atomic_framework/${oldRel}`] = `docs/ai_atomic_framework/${newRel}`;

  const digest = sha256(card.body);
  writeJson(path.join(target, `.atm/history/tasks/${card.id}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: card.id,
    title: card.id,
    status: 'done',
    closedAt: '2026-07-17T00:00:00.000Z',
    owner: 'fixture-owner',
    claim: { actorId: 'fixture', state: 'released', leaseId: 'lease-1', claimedAt: '2026-07-17T00:00:00.000Z', heartbeatAt: '2026-07-17T00:00:00.000Z', ttlSeconds: 1800, files: [`.atm/history/tasks/${card.id}.json`] },
    taskDirectionLock: { status: 'released' },
    closurePacket: { schemaId: 'atm.closurePacket.v1', taskId: card.id },
    source: {
      planPath: `docs/ai_atomic_framework/${oldRel}`,
      planningSourceSeal: {
        schemaId: 'atm.planningSourceSeal.v1',
        repoIdentity: planning,
        repoRoot: planning.replace(/\\/g, '/'),
        taskCardPath: `docs/ai_atomic_framework/${oldRel}`,
        planningCommitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        contentDigest: digest,
        amendmentEpoch: 0,
        sealedAt: '2026-07-17T00:00:00.000Z'
      }
    }
  });
}

runGit(planning, ['add', '.']);
runGit(planning, ['commit', '-m', 'planning cards']);
runGit(target, ['add', '.']);
runGit(target, ['commit', '-m', 'seed ledger']);

const mapPath = path.join(target, 'realign-map.json');
writeJson(mapPath, mappings);

process.env.ATM_PLANNING_REPO_ROOT = planning;

const parsedMap = parseRealignMapFile(mapPath);
assert.equal(parsedMap.length, 3);

const proposals = buildRealignProposals({
  cwd: target,
  mappings: parsedMap,
  planningRepoRoot: planning
});
const realignable = proposals.filter((entry) => entry.decision === 'realign');
assert.equal(realignable.length, 3, 'pure-move proposals should realign all three closed cards');
assert.ok(realignable.every((entry) => entry.protectedFieldsUnchanged.length === REALIGN_PROTECTED_LIFECYCLE_FIELDS.length));

const dryRun = await runTasksRealignPlanSource([
  '--cwd',
  target,
  '--map',
  mapPath,
  '--dry-run',
  '--planning-repo',
  planning,
  '--json'
]);
assert.equal(dryRun.ok, true);
assert.equal((dryRun.evidence as { dryRun?: boolean }).dryRun, true);

const before = JSON.parse(readFileSync(path.join(target, '.atm/history/tasks/TASK-DEMO-0001.json'), 'utf8'));
const writeResult = await runTasksRealignPlanSource([
  '--cwd',
  target,
  '--map',
  mapPath,
  '--write',
  '--actor',
  'realign-actor',
  '--planning-repo',
  planning,
  '--json'
]);
assert.equal(writeResult.ok, true);
assert.equal((writeResult.evidence as { temporaryIndex?: boolean }).temporaryIndex, true);

const after = JSON.parse(readFileSync(path.join(target, '.atm/history/tasks/TASK-DEMO-0001.json'), 'utf8'));
assert.equal(after.status, before.status);
assert.equal(after.closedAt, before.closedAt);
assert.deepEqual(after.owner, before.owner);
assert.deepEqual(after.claim, before.claim);
assert.deepEqual(after.taskDirectionLock, before.taskDirectionLock);
assert.deepEqual(after.closurePacket, before.closurePacket);
assert.equal(after.source.planPath, 'docs/ai_atomic_framework/governance-optimization/tasks/TASK-DEMO-0001.task.md');
assert.equal(after.source.planningSourceSeal.contentDigest, before.source.planningSourceSeal.contentDigest);

// Digest mismatch refusal on a still-unrealigned closed ledger entry.
const mismatchId = 'TASK-DEMO-MISMATCH';
const mismatchOld = 'docs/ai_atomic_framework/rft-hardening/tasks/TASK-DEMO-MISMATCH.task.md';
const mismatchNew = 'docs/ai_atomic_framework/governance-optimization/tasks/TASK-DEMO-MISMATCH.task.md';
const sealedBody = '# TASK-DEMO-MISMATCH\n\nstatus: done\n';
const changedBody = '# TASK-DEMO-MISMATCH\n\nstatus: done\nchanged\n';
writeFileSync(path.join(planning, 'docs/ai_atomic_framework/governance-optimization/tasks/TASK-DEMO-MISMATCH.task.md'), changedBody, 'utf8');
writeJson(path.join(target, `.atm/history/tasks/${mismatchId}.json`), {
  schemaVersion: 'atm.workItem.v0.2',
  workItemId: mismatchId,
  title: mismatchId,
  status: 'done',
  closedAt: '2026-07-17T00:00:00.000Z',
  owner: 'fixture-owner',
  claim: { actorId: 'fixture', state: 'released', leaseId: 'lease-m', claimedAt: '2026-07-17T00:00:00.000Z', heartbeatAt: '2026-07-17T00:00:00.000Z', ttlSeconds: 1800, files: [`.atm/history/tasks/${mismatchId}.json`] },
  taskDirectionLock: { status: 'released' },
  closurePacket: { schemaId: 'atm.closurePacket.v1', taskId: mismatchId },
  source: {
    planPath: mismatchOld,
    planningSourceSeal: {
      schemaId: 'atm.planningSourceSeal.v1',
      repoIdentity: planning,
      repoRoot: planning.replace(/\\/g, '/'),
      taskCardPath: mismatchOld,
      planningCommitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      contentDigest: sha256(sealedBody),
      amendmentEpoch: 0,
      sealedAt: '2026-07-17T00:00:00.000Z'
    }
  }
});
const mismatchProposals = buildRealignProposals({
  cwd: target,
  mappings: [{ from: mismatchOld, to: mismatchNew }],
  planningRepoRoot: planning
});
assert.equal(
  mismatchProposals.find((entry) => entry.taskId === mismatchId)?.decision,
  'refuse-digest-mismatch'
);

// record-commit payload assertion regression
const assertRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-record-assert-'));
runGit(assertRepo, ['init']);
runGit(assertRepo, ['config', 'user.name', 'ATM Validator']);
runGit(assertRepo, ['config', 'user.email', 'validator@example.invalid']);
writeJson(path.join(assertRepo, '.atm/history/tasks/TASK-DROP-0001.json'), { workItemId: 'TASK-DROP-0001', status: 'done' });
runGit(assertRepo, ['add', '.']);
runGit(assertRepo, ['commit', '-m', 'seed']);
runGit(assertRepo, ['commit', '--allow-empty', '-m', 'empty-drop-sim']);
const emptyHead = runGit(assertRepo, ['rev-parse', 'HEAD']).trim();
let dropped: unknown = null;
try {
  assertRecordCommitPayloadPresent({
    cwd: assertRepo,
    commitSha: emptyHead,
    expectedStagedFiles: ['.atm/history/tasks/TASK-DROP-0001.json']
  });
} catch (error) {
  dropped = error;
}
assert.ok(dropped instanceof CliError);
assert.equal((dropped as CliError).code, 'ATM_GIT_RECORD_COMMIT_PAYLOAD_DROPPED');

console.log(JSON.stringify({
  ok: true,
  case: 'ledger-realign',
  realigned: 3,
  protectedFields: REALIGN_PROTECTED_LIFECYCLE_FIELDS.length,
  digestMismatchRefused: true,
  recordCommitPayloadAssertion: true
}, null, 2));
