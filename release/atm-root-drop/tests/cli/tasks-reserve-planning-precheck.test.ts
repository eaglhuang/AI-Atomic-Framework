import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = path.join(os.tmpdir(), `atm-tasks-reserve-precheck-${Date.now()}`);
const workspace = path.join(tempRoot, 'target');
const planning = path.join(tempRoot, 'planning');

try {
  mkdirSync(path.join(workspace, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(workspace, '.atm', 'history', 'task-events'), { recursive: true });
  mkdirSync(path.join(workspace, '.atm', 'history', 'evidence'), { recursive: true });
  mkdirSync(path.join(planning, 'docs', 'ai_atomic_framework', 'multi-agent-orchestration', 'tasks'), { recursive: true });

  writeFileSync(path.join(workspace, '.atm', 'config.json'), JSON.stringify({}, null, 2));
  writeFileSync(path.join(workspace, '.atm', 'registry.json'), JSON.stringify({ entries: [] }, null, 2));
  writeFileSync(path.join(workspace, '.atm', 'git-baseline.json'), JSON.stringify({
    schemaId: 'atm.gitBaseline.v1',
    repoRoot: workspace,
    commit: 'HEAD'
  }, null, 2));

  const existingPlan = path.join(planning, 'docs', 'ai_atomic_framework', 'multi-agent-orchestration', 'tasks', 'TASK-MAO-EXISTING.task.md');
  writeTaskCard(existingPlan, 'TASK-MAO-EXISTING', 'Existing imported task');
  const existingImport = runAtm(['tasks', 'import', '--cwd', workspace, '--from', relativePathFrom(workspace, existingPlan), '--write', '--json']);
  assert.equal(existingImport.exitCode, 0, existingImport.stderr || existingImport.stdout);

  const targetPlan = path.join(planning, 'docs', 'ai_atomic_framework', 'multi-agent-orchestration', 'tasks', 'TASK-MAO-0054.task.md');
  writeTaskCard(targetPlan, 'TASK-MAO-0054', 'Reserve planning precheck fixture');

  const reserveImported = runAtm(['tasks', 'reserve', '--cwd', workspace, '--task', 'TASK-MAO-0054', '--actor', 'captain', '--json']);
  assert.equal(reserveImported.exitCode, 0, reserveImported.stderr || reserveImported.stdout);
  assert.equal(reserveImported.parsed.ok, true);
  const importedTaskPath = path.join(workspace, '.atm', 'history', 'tasks', 'TASK-MAO-0054.json');
  assert.equal(existsSync(importedTaskPath), true);
  const importedTask = JSON.parse(readFileSync(importedTaskPath, 'utf8'));
  assert.equal(importedTask.status, 'reserved');
  assert.equal(importedTask.source.planPath.replace(/\\/g, '/'), relativePathFrom(workspace, targetPlan).replace(/\\/g, '/'));

  const reserveMissing = runAtm(['tasks', 'reserve', '--cwd', workspace, '--task', 'TASK-MAO-4040', '--actor', 'captain', '--json']);
  assert.equal(reserveMissing.exitCode, 1);
  assert.equal(reserveMissing.parsed.ok, false);
  assert.equal(reserveMissing.parsed.messages?.[0]?.code, 'ATM_TASK_RESERVE_PLANNING_CARD_REQUIRED');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[cli-tasks-reserve-planning-precheck:test] ok');

function writeTaskCard(targetPath: string, taskId: string, title: string) {
  writeFileSync(targetPath, [
    '---',
    `task_id: ${taskId}`,
    `title: "${title}"`,
    'status: planned',
    'planning_repo: 3KLife',
    'target_repo: AI-Atomic-Framework',
    'closure_authority: target_repo',
    'deliverables:',
    '  - "packages/cli/src/commands/tasks.ts"',
    'scopePaths:',
    '  - "packages/cli/src/commands/tasks.ts"',
    'validators:',
    '  - "npm run typecheck"',
    '---',
    '',
    `# ${taskId} - ${title}`,
    ''
  ].join('\n'));
}

function relativePathFrom(fromRoot: string, targetPath: string): string {
  return path.relative(fromRoot, targetPath).replace(/\\/g, '/');
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
