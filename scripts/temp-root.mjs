import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function createTempWorkspace(prefix) {
  const baseRoot = resolveTempBaseRoot();
  mkdirSync(baseRoot, { recursive: true });
  const workspacePath = path.join(
    baseRoot,
    `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  );
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

export function initializeGitRepository(repositoryRoot) {
  const result = spawnSync('git', ['init', '-q'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`git init failed for ${repositoryRoot}: ${result.stderr || result.stdout}`);
  }
}

function resolveTempBaseRoot() {
  const explicitRoot = process.env.ATM_TEMP_ROOT;
  if (explicitRoot) {
    return explicitRoot;
  }
  const repoLocalRoot = path.join(process.cwd(), '.atm-temp');
  if (existsSync(process.cwd())) {
    return repoLocalRoot;
  }
  return os.tmpdir();
}
