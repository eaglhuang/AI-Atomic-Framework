import { execFileSync } from 'node:child_process';
import { consumeHookBypassAtProtectedWrite } from './broker-hook-bypass-preflight.js';
import { resolveGitExecutable } from './git-process-port.js';
/**
 * The only boundary allowed to consume a hook-bypass lease. It is invoked
 * after branch-queue admission and sealed candidate construction.
 */
export function executeHookBypassCommitBoundary(input) {
    const protectedOverrideAudit = input.hookBypassRequest
        ? consumeHookBypassAtProtectedWrite(input.hookBypassRequest)
        : null;
    const value = execFileSync(resolveGitExecutable(), input.gitArgs, {
        cwd: input.cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: input.env,
        timeout: input.timeoutMs,
    });
    return { value, protectedOverrideAudit };
}
