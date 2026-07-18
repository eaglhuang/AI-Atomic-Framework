import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectClaimDirtyWipAdmission, assertClaimDirtyWipAdmission } from '../../packages/cli/src/commands/next/foreign-dirty-wip-admission.ts';

function fail(message: string): never {
  console.error(`[claim-foreign-unstaged-wip.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function initRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-foreign-dirty-wip-'));
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

function writeTracked(repo: string, relativePath: string, text = 'base\n') {
  const absolute = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, text, 'utf8');
  execFileSync('git', ['add', relativePath], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', `add ${relativePath}`], { cwd: repo, stdio: 'ignore' });
}

const candidate = {
  workItemId: 'TASK-CANDIDATE',
  title: 'candidate',
  status: 'ready',
  taskPath: '.atm/history/tasks/TASK-CANDIDATE.json'
} as any;

{
  const repo = initRepo();
  try {
    writeTracked(repo, 'packages/cli/src/target.ts');
    writeFileSync(path.join(repo, 'packages/cli/src/target.ts'), 'dirty\n', 'utf8');
    const admission = inspectClaimDirtyWipAdmission({ cwd: repo, task: candidate, actorId: 'codex', claimFiles: ['packages/cli/src/target.ts'] });
    assert(!admission.ok, 'unowned unstaged code WIP must block matching claim');
    assert(admission.blockers[0]?.ownership === 'unowned', 'unowned blocker must be labelled unowned');
    assert(admission.blockers[0]?.changeKinds.includes('unstaged'), 'unstaged change kind must be reported');
    try {
      assertClaimDirtyWipAdmission({ cwd: repo, task: candidate, actorId: 'codex', claimFiles: ['packages/cli/src/target.ts'] });
      fail('assertion must throw ATM_CLAIM_FOREIGN_UNSTAGED_WIP');
    } catch (error) {
      assert((error as any).code === 'ATM_CLAIM_FOREIGN_UNSTAGED_WIP', 'assertion must throw canonical error code');
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

{
  const repo = initRepo();
  try {
    writeTracked(repo, 'packages/cli/src/owned.ts');
    writeJson(path.join(repo, '.atm/history/tasks/TASK-OWNER.json'), {
      workItemId: 'TASK-OWNER',
      status: 'running',
      claim: {
        state: 'active',
        actorId: 'cursor-owner',
        leaseId: 'lease-owner',
        files: ['packages/cli/src/owned.ts'],
        laneSession: { laneSessionId: 'lane-owner' }
      }
    });
    writeFileSync(path.join(repo, 'packages/cli/src/owned.ts'), 'dirty\n', 'utf8');
    const admission = inspectClaimDirtyWipAdmission({ cwd: repo, task: candidate, actorId: 'codex', claimFiles: ['packages/cli/src/owned.ts'] });
    assert(!admission.ok, 'foreign claimed dirty WIP must block matching claim');
    assert(admission.blockers[0]?.ownership === 'foreign', 'foreign blocker must be labelled foreign');
    assert(admission.blockers[0]?.ownerTaskId === 'TASK-OWNER', 'foreign blocker must report owner task');
    assert(admission.blockers[0]?.ownerActorId === 'cursor-owner', 'foreign blocker must report owner actor');
    assert(admission.blockers[0]?.ownerLaneSessionId === 'lane-owner', 'foreign blocker must report owner lane');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

{
  const repo = initRepo();
  try {
    writeTracked(repo, 'packages/cli/src/other.ts');
    writeFileSync(path.join(repo, 'packages/cli/src/other.ts'), 'dirty\n', 'utf8');
    const admission = inspectClaimDirtyWipAdmission({ cwd: repo, task: candidate, actorId: 'codex', claimFiles: ['packages/cli/src/target.ts'] });
    assert(admission.ok, 'unrelated dirty code WIP must not block');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

{
  const repo = initRepo();
  try {
    writeTracked(repo, 'packages/cli/src/code.ts');
    writeFileSync(path.join(repo, 'packages/cli/src/code.ts'), 'dirty\n', 'utf8');
    const admission = inspectClaimDirtyWipAdmission({ cwd: repo, task: candidate, actorId: 'codex', claimFiles: ['docs/planning.md', '.atm/history/tasks/TASK-CANDIDATE.json'] });
    assert(admission.ok, 'docs/ledger-only candidate must not be blocked by code WIP');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

console.log('[claim-foreign-unstaged-wip.test] ok');
