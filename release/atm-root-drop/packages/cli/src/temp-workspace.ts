import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

export function createTempWorkspace(prefix: string) {
  const baseRoot = resolveTempBaseRoot();
  mkdirSync(baseRoot, { recursive: true });
  const workspacePath = path.join(
    baseRoot,
    `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

export function initializeGitRepository(repositoryRoot: string) {
  const result = spawnSync('git', ['init', '-q'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    const stderr = [String(result.stderr ?? ''), result.error?.message ?? ''].filter(Boolean).join('\n');
    if (isSandboxGitProcessFailure(stderr)) {
      throw new Error(`ATM_ENV_SANDBOX_GIT_EPERM: git init failed for ${repositoryRoot}: ${stderr || result.stdout}. Set ATM_TEMP_ROOT=C:\\tmp or rerun with repository-level permissions; this is an environment/sandbox failure, not task evidence.`);
    }
    throw new Error(`git init failed for ${repositoryRoot}: ${stderr || result.stdout}`);
  }
}

function isSandboxGitProcessFailure(stderr: string): boolean {
  return /spawnSync\s+git\s+(?:EPERM|EACCES)/i.test(stderr)
    || /(?:EPERM|EACCES).*git/i.test(stderr)
    || /permission denied/i.test(stderr)
    || /\.git[\\/]+index\.lock/i.test(stderr);
}

function resolveTempBaseRoot() {
  const explicitRoot = process.env.ATM_TEMP_ROOT;
  if (explicitRoot) {
    return explicitRoot;
  }
  const cwd = process.cwd();
  const repoLocalRoot = path.join(cwd, '.atm-temp');
  // WSL interop can surface Linux working directories as UNC paths
  // (for example \\wsl.localhost\Ubuntu\home\user\repo). Temporary
  // validator repos created under that synthetic path can confuse Git/Node
  // child processes, so prefer the platform temp root there.
  if (process.platform !== 'win32' && cwd.startsWith('\\\\')) {
    return os.tmpdir();
  }
  if (existsSync(cwd)) {
    return repoLocalRoot;
  }
  return os.tmpdir();
}
