import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = path.join(os.tmpdir(), `atm-tasks-scope-add-clarity-${Date.now()}`);
const workspace = path.join(tempRoot, 'target');
const planning = path.join(tempRoot, 'planning');

try {
  mkdirSync(path.join(workspace, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(workspace, '.atm', 'history', 'task-events'), { recursive: true });
  mkdirSync(path.join(workspace, '.atm', 'history', 'evidence'), { recursive: true });
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
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
  writeTrackedFile('src/feature.ts', 'export const feature = 1;\n');
  runGit(['add', '.']);
  runGit(['commit', '-m', 'test: baseline']);

  const clarityPlan = writeTaskCard('TASK-MAO-CLARITY-0001', 'Scope add clarity', ['src/feature.ts']);
  importAndPrepareTask('TASK-MAO-CLARITY-0001', clarityPlan);
  const clarityResult = runAtm([
    'tasks', 'scope', 'add',
    '--cwd', workspace,
    '--task', 'TASK-MAO-CLARITY-0001',
    '--actor', 'captain',
    '--add', 'docs/linked.md',
    '--json'
  ]);
  assert.equal(clarityResult.exitCode, 1);
  assert.equal(clarityResult.parsed.ok, false);
  assert.equal(clarityResult.parsed.messages?.[0]?.code, 'ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK');
  assert.match(clarityResult.parsed.messages?.[0]?.text ?? '', /requires an active claim/i);
  assert.match(clarityResult.parsed.messages?.[0]?.text ?? '', /next --claim/i);
  assert.equal(clarityResult.parsed.messages?.[0]?.data?.claimState, 'none');

  const claimFirstPlan = writeTaskCard('TASK-MAO-CLARITY-0002', 'Scope add claim-first success', ['src/feature.ts']);
  importAndPrepareTask('TASK-MAO-CLARITY-0002', claimFirstPlan);
  const claimFirstResult = runAtm([
    'tasks', 'scope', 'add',
    '--cwd', workspace,
    '--task', 'TASK-MAO-CLARITY-0002',
    '--actor', 'captain',
    '--claim-first',
    '--add', 'docs/linked.md',
    '--json'
  ]);
  assert.equal(claimFirstResult.exitCode, 0, claimFirstResult.stderr || claimFirstResult.stdout);
  assert.equal(claimFirstResult.parsed.evidence.preconditionResolution.resolvedBy, 'claim-first');
  assert.deepEqual(claimFirstResult.parsed.evidence.addedPaths, ['docs/linked.md']);
  const claimedTask = JSON.parse(readFileSync(path.join(workspace, '.atm', 'history', 'tasks', 'TASK-MAO-CLARITY-0002.json'), 'utf8'));
  assert.equal(claimedTask.status, 'running');
  assert.equal(claimedTask.claim?.state, 'active');
  const runtimeLock = JSON.parse(readFileSync(path.join(workspace, '.atm', 'runtime', 'locks', 'TASK-MAO-CLARITY-0002.lock.json'), 'utf8'));
  assert.ok((runtimeLock.taskDirectionLock?.allowedFiles ?? []).includes('docs/linked.md'));
  const claimFirstEventDir = path.join(workspace, '.atm', 'history', 'task-events', 'TASK-MAO-CLARITY-0002');
  assert.equal(existsSync(claimFirstEventDir), true);
  assert.match(readFileSync(findEventByAction(claimFirstEventDir, 'scope-amendment.claim-first-resolved'), 'utf8'), /scope-amendment\.claim-first-resolved/);

  const blockerDepPlan = writeTaskCard('TASK-MAO-CLARITY-DEP', 'Blocking dependency', ['src/feature.ts']);
  const blockerTaskPlan = writeTaskCard('TASK-MAO-CLARITY-0003', 'Scope add claim-first blocked', ['src/feature.ts'], ['TASK-MAO-CLARITY-DEP']);
  importAndPrepareTask('TASK-MAO-CLARITY-DEP', blockerDepPlan);
  importAndPrepareTask('TASK-MAO-CLARITY-0003', blockerTaskPlan);
  const blockedResult = runAtm([
    'tasks', 'scope', 'add',
    '--cwd', workspace,
    '--task', 'TASK-MAO-CLARITY-0003',
    '--actor', 'captain',
    '--claim-first',
    '--add', 'docs/blocked.md',
    '--json'
  ]);
  assert.equal(blockedResult.exitCode, 1);
  assert.equal(blockedResult.parsed.messages?.[0]?.code, 'ATM_TASK_CLAIM_DEPENDENCY_BLOCKED');
  const blockedTask = JSON.parse(readFileSync(path.join(workspace, '.atm', 'history', 'tasks', 'TASK-MAO-CLARITY-0003.json'), 'utf8'));
  assert.equal(blockedTask.claim ?? null, null);
  assert.equal(existsSync(path.join(workspace, '.atm', 'runtime', 'locks', 'TASK-MAO-CLARITY-0003.lock.json')), false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[cli-tasks-scope-add-error-clarity:test] ok');

function writeTrackedFile(relativePath: string, content: string) {
  const targetPath = path.join(workspace, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, content);
}

function writeTaskCard(taskId: string, title: string, deliverables: readonly string[], dependsOn: readonly string[] = []) {
  const targetPath = path.join(planning, 'docs', 'ai_atomic_framework', 'multi-agent-orchestration', 'tasks', `${taskId}.task.md`);
  writeFileSync(targetPath, [
    '---',
    `task_id: ${taskId}`,
    `title: "${title}"`,
    'status: planned',
    'planning_repo: 3KLife',
    'target_repo: AI-Atomic-Framework',
    'closure_authority: target_repo',
    ...(dependsOn.length > 0 ? ['depends_on:', ...dependsOn.map((entry) => `  - "${entry}"`)] : []),
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
  return targetPath;
}

function importAndPrepareTask(taskId: string, taskPath: string) {
  const imported = runAtm(['tasks', 'import', '--cwd', workspace, '--from', relativePathFrom(workspace, taskPath), '--write', '--json']);
  assert.equal(imported.exitCode, 0, imported.stderr || imported.stdout);
  const reserved = runAtm(['tasks', 'reserve', '--cwd', workspace, '--task', taskId, '--actor', 'captain', '--json']);
  assert.equal(reserved.exitCode, 0, reserved.stderr || reserved.stdout);
  const promoted = runAtm(['tasks', 'promote', '--cwd', workspace, '--task', taskId, '--actor', 'captain', '--json']);
  assert.equal(promoted.exitCode, 0, promoted.stderr || promoted.stdout);
}

function findEventByAction(eventDir: string, action: string): string {
  const files = readdirSync(eventDir)
    .filter((entry) => entry.endsWith('.json'))
    .sort()
    .map((entry) => path.join(eventDir, entry));
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (text.includes(`"action": "${action}"`)) {
      return file;
    }
  }
  assert.fail(`Missing event action ${action} in ${eventDir}`);
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
