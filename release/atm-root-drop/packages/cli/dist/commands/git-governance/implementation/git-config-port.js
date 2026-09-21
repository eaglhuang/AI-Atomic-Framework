import { execFileSync } from 'node:child_process';
import { createSanitizedGitEnv } from './git-process-port.js';
/** Local Git configuration port; identity policy stays in the caller. */
export function readGitConfig(cwd, key) {
    try {
        const value = execFileSync('git', ['config', '--local', '--get', key], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            env: createSanitizedGitEnv(),
        }).trim();
        return value || null;
    }
    catch {
        return null;
    }
}
export function writeGitConfig(cwd, key, value) {
    execFileSync('git', ['config', '--local', key, value], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: createSanitizedGitEnv(),
    });
}
