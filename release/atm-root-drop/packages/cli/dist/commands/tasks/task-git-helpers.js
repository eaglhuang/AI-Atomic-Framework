import { execFileSync } from 'node:child_process';
import { normalizeRelativePath } from './task-file-io-helpers.js';
const uniqueStrings = (arr) => [...new Set(arr)];
function readGitNameOnly(cwd, args) {
    try {
        const output = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return uniqueStrings(output.split(/\r?\n/).map(normalizeRelativePath).filter(Boolean));
    }
    catch {
        return [];
    }
}
/**
 * Reads a single git output scalar securely.
 */
export function readGitScalar(cwd, args) {
    try {
        return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    }
    catch {
        return null;
    }
}
/**
 * List files committed to Git index since claim heartbeat.
 */
export function listCommittedFilesSinceClaim(cwd, claim) {
    if (!claim?.claimedAt)
        return { files: [], gitAvailable: false };
    const baseline = readGitScalar(cwd, ['rev-list', '-1', `--before=${claim.claimedAt}`, 'HEAD']);
    if (baseline === null)
        return { files: [], gitAvailable: false };
    const files = baseline
        ? readGitNameOnly(cwd, ['diff', '--name-only', `${baseline}..HEAD`])
        : readGitNameOnly(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD']);
    return {
        files,
        gitAvailable: true
    };
}
