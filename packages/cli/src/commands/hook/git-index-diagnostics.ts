import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { relativePathFrom } from '../shared.ts';

export function inspectGitIndexAccess(cwd: string) {
  const indexLockPath = path.join(cwd, '.git', 'index.lock');
  const status = runGit(cwd, ['status', '--short']);
  const stderr = status.stderr.trim();
  const environmentFailure = classifySandboxGitFailure(stderr);
  const gitIndexPermissionFailure = classifyGitIndexPermissionFailure(stderr);
  const detail = status.exitCode === 0
    ? 'Git index is readable by ATM pre-commit diagnostics.'
    : classifyGitIndexFailure(stderr || `git status exited with ${status.exitCode}`);
  return {
    schemaId: 'atm.gitIndexDiagnostic.v1',
    ok: status.exitCode === 0,
    code: status.exitCode === 0
      ? 'ATM_GIT_INDEX_OK'
      : environmentFailure
        ? 'ATM_ENV_SANDBOX_GIT_EPERM'
      : gitIndexPermissionFailure
        ? 'ATM_GIT_INDEX_PERMISSION_DENIED'
        : 'ATM_GIT_INDEX_UNAVAILABLE',
    exitCode: status.exitCode,
    indexLockPath: normalizeRelativePath(relativePathFrom(cwd, indexLockPath)),
    indexLockPresent: existsSync(indexLockPath),
    stderr,
    detail,
    requiredCommand: status.exitCode === 0
      ? null
      : environmentFailure
        ? 'Rerun the same command with repository-level permissions, or set ATM_TEMP_ROOT=C:\\tmp for validators that create temporary git repositories, then retry. This is an environment diagnostic, not task evidence.'
      : 'Resolve the local Git/index permission problem outside ATM, then rerun the commit. Do not edit .git/index.lock by hand unless you have confirmed no Git process is active.'
  };
}

export function classifyGitIndexFailure(stderr: string) {
  if (classifyGitIndexPermissionFailure(stderr)) {
    return `Git could not access the index lock (${stderr}). This is an environment or sandbox permission problem, not a task evidence failure.`;
  }
  return `Git index diagnostic failed (${stderr}).`;
}

export function classifySandboxGitFailure(stderr: string): boolean {
  return /spawnSync\s+git(?:\.exe)?\s+(?:EPERM|EACCES)/i.test(stderr)
    || /Error:\s+spawn\s+git(?:\.exe)?\s+(?:EPERM|EACCES)/i.test(stderr);
}

export function classifyGitIndexPermissionFailure(stderr: string): boolean {
  return /(?:^|[\\/])?\.?git[\\/]+index\.lock|index\.lock/i.test(stderr)
    && /permission denied|eperm|eacces|unable to create/i.test(stderr);
}

export function createSanitizedGitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_NAMESPACE']) {
    delete env[key];
  }
  return env;
}

export function runGitLines(cwd: string, args: readonly string[]): readonly string[] {
  const result = runGit(cwd, args);
  if (result.exitCode !== 0) return [];
  return result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

export function runGitScalar(cwd: string, args: readonly string[]): string | null {
  const result = runGit(cwd, args);
  return result.exitCode === 0 && result.stdout.trim().length > 0 ? result.stdout.trim() : null;
}

export function runGit(cwd: string, args: readonly string[], env: Record<string, string> = {}) {
  const result = spawnSync('git', [...args], {
    cwd,
    env: createSanitizedGitEnv(env),
    encoding: 'utf8'
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout ?? ''),
    stderr: [String(result.stderr ?? ''), result.error?.message ?? ''].filter(Boolean).join('\n')
  };
}

export function normalizeRelativePath(value: string): string {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
