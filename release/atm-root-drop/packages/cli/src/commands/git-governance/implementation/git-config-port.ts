import { execFileSync } from 'node:child_process';
import { createSanitizedGitEnv } from './git-process-port.ts';

/** Local Git configuration port; identity policy stays in the caller. */
export function readGitConfig(cwd: string, key: string): string | null {
  try {
    const value = execFileSync('git', ['config', '--local', '--get', key], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: createSanitizedGitEnv(),
    }).trim();
    return value || null;
  } catch {
    return null;
  }
}

export function writeGitConfig(cwd: string, key: string, value: string): void {
  execFileSync('git', ['config', '--local', key, value], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: createSanitizedGitEnv(),
  });
}
