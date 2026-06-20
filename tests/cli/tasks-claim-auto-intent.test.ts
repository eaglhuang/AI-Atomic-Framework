import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = path.join(os.tmpdir(), `atm-tasks-claim-auto-intent-${Date.now()}`);
const workspace = path.join(tempRoot, 'target');
const planning = path.join(tempRoot, 'planning');

try {
  mkdirSync(path.join(workspace, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(workspace, '.atm', 'history', 'task-events'), { recursive: true });
  mkdirSync(path.join(workspace, '.atm', 'history', 'evidence'), { recursive: true });
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  mkdirSync(path.join(workspace, 'docs'), { recursive: true });
  mkdirSync(path.join(planning, 'docs', 'ai_atomic_framework', 'multi-agent-orchestration', 'tasks'), { recursive: true });

  writeFileSync(path.join(workspace, '.atm', 'config.json'), JSON.stringify({}, null, 2));
  writeFileSync(path.join(workspace, '.atm', 'registry.json'), JSON.stringify({ entries: [] }, null, 2));
  writeFileSync(path.join(workspace, '.atm', 'git-baseline.json'), JSON.stringify({
    schemaId: 'atm.gitBaseline.v1',
    repoRoot: workspace,
    commit: 'HEAD'
  }, null, 2));

  runGit(['init']);
  runGit(['config', 'user.name', 'ATM Test']);
  runGit(['config', 'user.email', 'atm-test@example.com']);

  writeTrackedFile('src/dirty-write.ts', 'export const dirtyWrite = 1;\n');
  writeTrackedFile('src/already-landed.ts', 'export const alreadyLanded = true;\n');
  runGit(['add', '.']);
  runGit(['commit', '-m', 'test: baseline']);

  const dirtyPlan = path.join(planning, 'docs', 'ai_atomic_framework', 'multi-agent-orchestration', 'tasks', 'TASK-MAO-AUTO-0001.task.md');
  writeTaskCard(dirtyPlan, 'TASK-MAO-AUTO-0001', 'Dirty source auto-intent', ['src/dirty-write.ts']);
  importAndPrepareTask('TASK-MAO-AUTO-0001', dirtyPlan);
  writeFileSync(path.join(workspace, 'src', 'dirty-write.ts'), 'export const dirtyWrite = 2;\n');

  const dirtyClaim = runAtm(['tasks', 'claim', '--cwd', workspace, '--task', 'TASK-MAO-AUTO-0001', '--actor', 'captain', '--auto-intent', '--files', 'src/dirty-write.ts', '--json']);
  assert.equal(dirtyClaim.exitCode, 0, dirtyClaim.stderr || dirtyClaim.stdout);
  assert.equal(dirtyClaim.parsed.evidence.claimIntent, 'write');
  assert.equal(dirtyClaim.parsed.evidence.claimIntentResolution.autoIntent, true);
  assert.deepEqual(dirtyClaim.parsed.evidence.claimIntentResolution.dirtyInScopeFiles, ['src/dirty-write.ts']);

  runAtm(['tasks', 'release', '--cwd', workspace, '--task', 'TASK-MAO-AUTO-0001', '--actor', 'captain', '--reason', 'fixture reset', '--json']);
  runGit(['restore', '--source=HEAD', '--worktree', '--staged', '--', 'src/dirty-write.ts']);

  const landedPlan = path.join(planning, 'docs', 'ai_atomic_framework', 'multi-agent-orchestration', 'tasks', 'TASK-MAO-AUTO-0002.task.md');
  writeTaskCard(landedPlan, 'TASK-MAO-AUTO-0002', 'Already landed auto-intent', ['src/already-landed.ts']);
  importAndPrepareTask('TASK-MAO-AUTO-0002', landedPlan);

  const landedClaim = runAtm(['tasks', 'claim', '--cwd', workspace, '--task', 'TASK-MAO-AUTO-0002', '--actor', 'captain', '--auto-intent', '--files', 'src/already-landed.ts', '--json']);
  assert.equal(landedClaim.exitCode, 0, landedClaim.stderr || landedClaim.stdout);
  assert.equal(landedClaim.parsed.evidence.claimIntent, 'closeout-only');
  assert.equal(landedClaim.parsed.evidence.claimIntentResolution.reason, 'deliverables-already-in-head');
  assert.deepEqual(landedClaim.parsed.evidence.claimIntentResolution.deliverablesTrackedInHead, ['src/already-landed.ts']);
  runAtm(['tasks', 'release', '--cwd', workspace, '--task', 'TASK-MAO-AUTO-0002', '--actor', 'captain', '--reason', 'fixture reset', '--json']);

  writeFileSync(path.join(workspace, 'src', 'already-landed.ts'), 'export const alreadyLanded = false;\n');
  const reclaimedTaskPath = path.join(workspace, '.atm', 'history', 'tasks', 'TASK-MAO-AUTO-0002.json');
  const reclaimedTaskBefore = JSON.parse(readFileSync(reclaimedTaskPath, 'utf8'));
  reclaimedTaskBefore.status = 'ready';
  writeFileSync(reclaimedTaskPath, `${JSON.stringify(reclaimedTaskBefore, null, 2)}\n`);
  const reclaimedWrite = runAtm(['next', '--cwd', workspace, '--claim', '--task', 'TASK-MAO-AUTO-0002', '--actor', 'captain', '--claim-intent', 'write', '--json']);
  assert.equal(reclaimedWrite.exitCode, 0, reclaimedWrite.stderr || reclaimedWrite.stdout);
  assert.equal(reclaimedWrite.parsed.evidence.nextAction.claimIntent, 'write');
  const reclaimedTask = JSON.parse(readFileSync(reclaimedTaskPath, 'utf8'));
  assert.equal(reclaimedTask.claim?.intent, 'write');

  const nextRoute = runAtm(['next', '--cwd', workspace, '--prompt', 'Continue TASK-MAO-AUTO-0002', '--json']);
  assert.equal(nextRoute.exitCode, 0, nextRoute.stderr || nextRoute.stdout);
  assert.match(nextRoute.parsed.evidence.nextAction.command, /--auto-intent/);
  assert.match(nextRoute.parsed.evidence.nextAction.taskScopedClaimCommand, /--auto-intent/);

  runAtm(['tasks', 'release', '--cwd', workspace, '--task', 'TASK-MAO-AUTO-0002', '--actor', 'captain', '--reason', 'fixture reset', '--json']);

  const conflictPlan = path.join(planning, 'docs', 'ai_atomic_framework', 'multi-agent-orchestration', 'tasks', 'TASK-MAO-AUTO-0003.task.md');
  writeTaskCard(conflictPlan, 'TASK-MAO-AUTO-0003', 'Explicit closeout conflict', ['src/dirty-write.ts']);
  importAndPrepareTask('TASK-MAO-AUTO-0003', conflictPlan);
  writeFileSync(path.join(workspace, 'src', 'dirty-write.ts'), 'export const dirtyWrite = 3;\n');

  const conflictClaim = runAtm(['tasks', 'claim', '--cwd', workspace, '--task', 'TASK-MAO-AUTO-0003', '--actor', 'captain', '--claim-intent', 'closeout-only', '--files', 'src/dirty-write.ts', '--json']);
  assert.equal(conflictClaim.exitCode, 1);
  assert.equal(conflictClaim.parsed.ok, false);
  assert.equal(conflictClaim.parsed.messages?.[0]?.code, 'ATM_CLAIM_INTENT_CONFLICT');
  assert.deepEqual(conflictClaim.parsed.messages?.[0]?.data?.dirtyInScopeFiles, ['src/dirty-write.ts']);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[cli-tasks-claim-auto-intent:test] ok');

function writeTrackedFile(relativePath: string, content: string) {
  const targetPath = path.join(workspace, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content);
}

function writeTaskCard(targetPath: string, taskId: string, title: string, deliverables: readonly string[]) {
  writeFileSync(targetPath, [
    '---',
    `task_id: ${taskId}`,
    `title: "${title}"`,
    'status: planned',
    'planning_repo: 3KLife',
    'target_repo: AI-Atomic-Framework',
    'closure_authority: target_repo',
    'deliverables:',
    ...deliverables.map((entry) => `  - "${entry}"`),
    'scopePaths:',
    ...deliverables.map((entry) => `  - "${entry}"`),
    'validators:',
    '  - "npm run typecheck"',
    '---',
    '',
    `# ${taskId} - ${title}`,
    ''
  ].join('\n'));
}

function importAndPrepareTask(taskId: string, taskPath: string) {
  const imported = runAtm(['tasks', 'import', '--cwd', workspace, '--from', relativePathFrom(workspace, taskPath), '--write', '--json']);
  assert.equal(imported.exitCode, 0, imported.stderr || imported.stdout);
  const reserved = runAtm(['tasks', 'reserve', '--cwd', workspace, '--task', taskId, '--actor', 'captain', '--json']);
  assert.equal(reserved.exitCode, 0, reserved.stderr || reserved.stdout);
  const promoted = runAtm(['tasks', 'promote', '--cwd', workspace, '--task', taskId, '--actor', 'captain', '--json']);
  assert.equal(promoted.exitCode, 0, promoted.stderr || promoted.stdout);
}

function relativePathFrom(fromRoot: string, targetPath: string): string {
  return path.relative(fromRoot, targetPath).replace(/\\/g, '/');
}

function runGit(args: string[]) {
  const result = spawnSync('git', ['-C', workspace, ...args], {
    encoding: 'utf8'
  });
  assert.equal(result.status ?? 0, 0, result.stderr || result.stdout);
}

function runAtm(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.dev.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      ATM_ACTOR_ID: 'captain'
    }
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: JSON.parse(payload || JSON.stringify({ ok: false, stdout: result.stdout, stderr: result.stderr }))
  };
}
