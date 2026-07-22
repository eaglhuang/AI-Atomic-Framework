import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectTouchedPhysicalLineBudget } from '../../packages/cli/src/commands/git-governance/commit-scope-policy.ts';

function fail(message: string): never {
  console.error(`[git-commit-staged-line-budget-isolation.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function initRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-staged-line-budget-'));
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

function writeTracked(repo: string, relativePath: string, text: string) {
  const absolute = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, text, 'utf8');
  execFileSync('git', ['add', relativePath], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', `add ${relativePath}`], { cwd: repo, stdio: 'ignore' });
}

const largeBase = Array.from({ length: 700 }, (_, index) => `export const line${index} = ${index};`).join('\n') + '\n';

{
  const repo = initRepo();
  try {
    writeTracked(repo, 'packages/cli/src/large.ts', largeBase);
    writeFileSync(path.join(repo, 'packages/cli/src/large.ts'), largeBase.replace('export const line0 = 0;', 'export const line0 = 1000;'), 'utf8');
    execFileSync('git', ['add', 'packages/cli/src/large.ts'], { cwd: repo, stdio: 'ignore' });

    const report = inspectTouchedPhysicalLineBudget(repo, ['packages/cli/src/large.ts'], {
      taskId: 'TASK-CANDIDATE',
      actorId: 'codex',
      gate: 'git-commit'
    });

    assert(report.ok, 'small staged candidate must not fail merely because the source file has more than 600 physical lines');
    assert(report.topFile?.lines === 2, `expected staged candidate line count 2, got ${report.topFile?.lines}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

{
  const repo = initRepo();
  try {
    writeTracked(repo, 'packages/cli/src/small.ts', 'export const base = 1;\n');
    writeFileSync(path.join(repo, 'packages/cli/src/small.ts'), Array.from({ length: 650 }, (_, index) => `export const next${index} = ${index};`).join('\n') + '\n', 'utf8');
    execFileSync('git', ['add', 'packages/cli/src/small.ts'], { cwd: repo, stdio: 'ignore' });

    const report = inspectTouchedPhysicalLineBudget(repo, ['packages/cli/src/small.ts'], {
      taskId: 'TASK-CANDIDATE',
      actorId: 'codex',
      gate: 'git-commit'
    });

    assert(!report.ok, 'large staged candidate must still fail closed');
    assert(report.hardViolations[0]?.lines > 600, 'hard violation must report candidate diff line count');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

console.log('[git-commit-staged-line-budget-isolation.test] ok');
