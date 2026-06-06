import { execFileSync } from 'node:child_process';
import type { TaskClaimRecord } from '@ai-atomic-framework/core';
import { normalizeRelativePath } from './task-file-io-helpers.ts';

const uniqueStrings = (arr: readonly string[]): readonly string[] => [...new Set(arr)];

function readGitNameOnly(cwd: string, args: readonly string[]): readonly string[] {
  try {
    const output = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return uniqueStrings(output.split(/\r?\n/).map(normalizeRelativePath).filter(Boolean));
  } catch {
    return [];
  }
}

/**
 * Reads a single git output scalar securely.
 */
export function readGitScalar(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/**
 * List files committed to Git index since claim heartbeat.
 */
export function listCommittedFilesSinceClaim(cwd: string, claim: TaskClaimRecord | null): { readonly files: readonly string[]; readonly gitAvailable: boolean } {
  if (!claim?.claimedAt) return { files: [], gitAvailable: false };
  const baseline = readGitScalar(cwd, ['rev-list', '-1', `--before=${claim.claimedAt}`, 'HEAD']);
  if (baseline === null) return { files: [], gitAvailable: false };
  const files = baseline
    ? readGitNameOnly(cwd, ['diff', '--name-only', `${baseline}..HEAD`])
    : readGitNameOnly(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD']);
  return {
    files,
    gitAvailable: true
  };
}
