import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export { runBatch } from '../../packages/cli/src/commands/batch.ts';
export { runFrameworkTempClaim } from '../../packages/cli/src/commands/framework-development.ts';
export { runHook } from '../../packages/cli/src/commands/hook.ts';
export { runIntegrationHookInvocationInProcess } from '../../packages/cli/src/commands/integration-hooks.ts';
export { runLock } from '../../packages/cli/src/commands/lock.ts';
export { runNext } from '../../packages/cli/src/commands/next.ts';
export { buildTaskSelfAllowPaths, readActiveTaskDirectionLocks } from '../../packages/cli/src/commands/task-direction.ts';
export { runTasks } from '../../packages/cli/src/commands/tasks.ts';

export const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

export function fail(message: string): never {
  console.error(`[task-direction-governance:${mode}] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

export function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function assertGovernanceLockAllowedFilesAreSsot(repo: string, taskId: string) {
  const lockPath = path.join(repo, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
  assert(existsSync(lockPath), `governance lock for ${taskId} must exist after claim`);
  const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
  const embedded = (parsed as { taskDirectionLock?: { allowedFiles?: unknown } }).taskDirectionLock;
  const canonical = Array.isArray(embedded?.allowedFiles)
    ? [...(embedded!.allowedFiles as unknown[])].filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.replace(/\\/g, '/')).sort()
    : null;
  const lockFiles = Array.isArray(parsed.files)
    ? [...(parsed.files as unknown[])].filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.replace(/\\/g, '/')).sort()
    : null;
  assert(canonical !== null, `governance lock for ${taskId} must embed taskDirectionLock.allowedFiles`);
  assert(lockFiles !== null, `governance lock for ${taskId} must expose top-level files`);
  assert(JSON.stringify(canonical) === JSON.stringify(lockFiles), `ATM_TASK_DIRECTION_LOCK_FILES_MISMATCH: governance lock top-level files for ${taskId} must equal taskDirectionLock.allowedFiles (SSOT). canonical=${JSON.stringify(canonical)} files=${JSON.stringify(lockFiles)}`);
}

export async function runTimedSection(section: string, fn: () => Promise<void>) {
  const startedAt = Date.now();
  console.log(`[task-direction-governance:${mode}] section start ${section}`);
  await fn();
  console.log(`[task-direction-governance:${mode}] section done ${section} ${Date.now() - startedAt}ms`);
}

export function fixtureStep(label: string) {
  console.log(`[task-direction-governance:${mode}] fixture ${label}`);
}

export function makeAdopterRepo(parent: string, name: string) {
  const repo = path.join(parent, name);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeJson(path.join(repo, 'package.json'), { name, type: 'module' });
  writeFileSync(path.join(repo, 'src', 'one.ts'), 'export const one = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'two.ts'), 'export const two = 2;\n', 'utf8');
  writeLedgerTask(repo, 'TASK-ADOPT-0001', 'Adopter task one', 'src/one.ts');
  writeLedgerTask(repo, 'TASK-ADOPT-0002', 'Adopter task two', 'src/two.ts');
  writeEvidence(repo, 'TASK-ADOPT-0001');
  writeEvidence(repo, 'TASK-ADOPT-0002');
  // 撱箇? actor ?身 identity嚗誑靘?pre-commit hook ??commit attribution ?亥岷 gitName/gitEmail
  writeJson(path.join(repo, '.atm', 'runtime', 'identity', 'default.json'), {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: 'adopter-agent',
    gitName: 'ATM Test',
    gitEmail: 'atm-test@example.invalid',
    updatedAt: new Date().toISOString()
  });
  return repo;
}

export function makeFrameworkRepo(parent: string, name: string) {
  const repo = path.join(parent, name);
  mkdirSync(path.join(repo, 'packages', 'core', 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'packages', 'cli', 'src'), { recursive: true });
  writeJson(path.join(repo, 'package.json'), { name: 'ai-atomic-framework', workspaces: ['packages/*'] });
  writeJson(path.join(repo, 'atomic-registry.json'), { entries: [] });
  writeJson(path.join(repo, '.atm', 'runtime', 'pinned-runner.json'), {
    schemaVersion: 'atm.pinnedRunner.v0.1',
    runnerPath: 'atm.mjs',
    sourcePath: 'release/atm-onefile/atm.mjs'
  });
  mkdirSync(path.join(repo, 'release', 'atm-onefile'), { recursive: true });
  writeFileSync(path.join(repo, 'release', 'atm-onefile', 'atm.mjs'), '#!/usr/bin/env node\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const core = true;\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'one.ts'), 'export const one = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'two.ts'), 'export const two = 2;\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'cli', 'src', 'atm.ts'), 'export const atm = true;\n', 'utf8');
  writeLedgerTask(repo, 'TASK-FW-0001', 'Framework task one', 'packages/core/src/one.ts');
  writeLedgerTask(repo, 'TASK-FW-0002', 'Framework task two', 'packages/core/src/two.ts');
  writeEvidence(repo, 'TASK-FW-0001');
  writeEvidence(repo, 'TASK-FW-0002');
  return repo;
}

export function writeLedgerTask(repo: string, taskId: string, title: string, scopePath: string, options: { readonly scopePaths?: readonly string[]; readonly sourcePlanPath?: string } = {}) {
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title,
    status: 'ready',
    dependencies: [],
    scope: options.scopePaths ?? [scopePath],
    source: {
      planPath: options.sourcePlanPath ?? 'docs/plan.md',
      sectionTitle: title,
      headingLine: 1,
      hash: taskId
    }
  });
}

export function writeEvidence(repo: string, taskId: string) {
  writeJson(path.join(repo, '.atm', 'history', 'evidence', `${taskId}.json`), {
    taskId,
    evidence: [
      {
        evidenceKind: 'validation',
        evidenceType: 'test',
        summary: 'validator fixture evidence',
        details: {
          commandRuns: [
            {
              command: 'fixture-pass',
              exitCode: 0,
              stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
              stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
            }
          ]
        }
      }
    ]
  });
}

export function initializeGit(repo: string) {
  runGit(repo, ['init', '-q']);
  runGit(repo, ['add', '.']);
  runGit(repo, ['-c', 'user.name=ATM Test', '-c', 'user.email=atm-test@example.invalid', 'commit', '-m', 'initial fixture']);
}

export function runGit(repo: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert(result.status === 0, `git ${args.join(' ')} must exit 0: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

