/** Git adapter for candidate-index assembly; content always comes from a seal. */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ATM_COMMIT_ATTRIBUTION_MISMATCH,
  findSealedBundleProvenanceConflicts,
  isTombstone,
  sealCommitBundle,
  type CommitTreeEntry,
  type SealedCommitBundle,
  type SealedCommitBundleEntry,
  type SealedCommitEntryProvenance
} from '../../../../../core/src/commit-attribution/sealed-commit-bundle.ts';
import { CliError } from '../../shared.ts';
import { runGitCommand, runGitCommandWithEnv } from './git-process-port.ts';

const QUIET_STDIO = ['ignore', 'pipe', 'pipe'] as const;
const LS_FILES_STAGE_PATTERN = /^(\d+) ([0-9a-f]+) \d+\t(.+)$/i;
const LS_TREE_PATTERN = /^(\d+) blob ([0-9a-f]+)\t(.+)$/i;
const RAW_DIFF_PATTERN = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*\t(.+)$/i;
const NULL_OBJECT_ID = /^0+$/;

function normalizePath(value: string): string { return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim(); }
function splitLines(output: string): readonly string[] { return String(output ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }

export function sealCommitBundleFromLiveIndex(input: { readonly cwd: string; readonly paths: readonly string[]; readonly provenance: SealedCommitEntryProvenance; readonly baseTreeSha?: string | null; readonly baseRef?: string | null }): SealedCommitBundle {
  const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
  if (paths.length === 0) return sealCommitBundle({ entries: [], baseTreeSha: input.baseTreeSha ?? null });
  const entries: SealedCommitBundleEntry[] = [];
  for (const line of splitLines(runGitCommand(input.cwd, ['ls-files', '-s', '--', ...paths]))) {
    const match = line.match(LS_FILES_STAGE_PATTERN);
    if (match) entries.push({ path: normalizePath(match[3]), mode: match[1], blobId: match[2], provenance: input.provenance, disposition: 'present' });
  }
  for (const entry of readStagedDeletionEntries({ cwd: input.cwd, paths, baseRef: input.baseRef ?? 'HEAD' })) entries.push({ ...entry, provenance: input.provenance });
  return sealCommitBundle({ entries, baseTreeSha: input.baseTreeSha ?? null });
}

export function withWorktreeCandidateIndex<T>(input: { readonly cwd: string; readonly paths: readonly string[]; readonly run: (env: NodeJS.ProcessEnv) => T }): T {
  const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-worktree-candidate-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
  try {
    runGitCommandWithEnv(input.cwd, ['read-tree', 'HEAD'], env, [...QUIET_STDIO]);
    if (paths.length > 0) runGitCommandWithEnv(input.cwd, ['add', '-A', '-f', '--', ...paths], env, [...QUIET_STDIO]);
    return input.run(env);
  } finally { rmSync(tempDir, { recursive: true, force: true }); }
}

export function mergeSealedCommitBundles(base: SealedCommitBundle, overlay: SealedCommitBundle, options?: { readonly supersedingPaths?: readonly string[]; readonly surface?: string }): SealedCommitBundle {
  const superseding = new Set((options?.supersedingPaths ?? []).map(normalizePath).filter(Boolean));
  const conflicts = findSealedBundleProvenanceConflicts([...base.entries, ...overlay.entries]).filter((finding) => !superseding.has(finding.path));
  if (conflicts.length > 0) throw new CliError(ATM_COMMIT_ATTRIBUTION_MISMATCH, `Sealed commit bundle declares conflicting provenance for ${conflicts.map((finding) => finding.path).join(', ')}.`, { exitCode: 1, details: { surface: options?.surface ?? 'seal-composition', findings: conflicts, safeNextActions: ['re-resolve-the-commit-bundle-and-retry', 'declare-the-superseding-paths-explicitly'] } });
  return sealCommitBundle({ entries: [...base.entries, ...overlay.entries], baseTreeSha: base.baseTreeSha ?? overlay.baseTreeSha ?? null, sealedAt: base.sealedAt });
}

export function assembleSealedCommitIndex(input: { readonly cwd: string; readonly bundle: SealedCommitBundle; readonly env: NodeJS.ProcessEnv; readonly baseRef?: string }): void {
  runGitCommandWithEnv(input.cwd, ['read-tree', input.baseRef ?? 'HEAD'], input.env, [...QUIET_STDIO]);
  const paths = input.bundle.entries.map((entry) => entry.path);
  if (paths.length === 0) return;
  runGitCommandWithEnv(input.cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--force', '--', ...paths], input.env, [...QUIET_STDIO]);
  const presentEntries = input.bundle.entries.filter((entry) => !isTombstone(entry));
  const baseRef = input.baseRef ?? 'HEAD';
  const inheritedEntries = presentEntries.filter((entry) => isTrackedInBaseTree({ cwd: input.cwd, env: input.env, baseRef, path: entry.path }));
  const newEntryPaths = presentEntries.filter((entry) => !inheritedEntries.some((inherited) => inherited.path === entry.path)).map((entry) => entry.path);
  for (const entry of presentEntries) runGitCommandWithEnv(input.cwd, ['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.blobId},${entry.path}`], input.env, [...QUIET_STDIO]);
  if (newEntryPaths.length > 0) {
    runGitCommandWithEnv(input.cwd, ['add', '-A', '-f', '--', ...newEntryPaths], input.env, [...QUIET_STDIO]);
    for (const entry of presentEntries.filter((entry) => newEntryPaths.includes(entry.path))) runGitCommandWithEnv(input.cwd, ['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.blobId},${entry.path}`], input.env, [...QUIET_STDIO]);
  }
  if (inheritedEntries.length > 0) runGitCommandWithEnv(input.cwd, ['update-index', '--assume-unchanged', '--', ...inheritedEntries.map((entry) => entry.path)], input.env, [...QUIET_STDIO]);
}

export function readCandidateTreeEntries(input: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly baseRef?: string; readonly sealedPaths?: readonly string[] }): readonly CommitTreeEntry[] {
  const sealedPaths = [...new Set((input.sealedPaths ?? []).map(normalizePath).filter(Boolean))].sort();
  const entries = new Map<string, CommitTreeEntry>();
  if (sealedPaths.length > 0) for (const line of splitLines(runGitCommandWithEnv(input.cwd, ['ls-files', '-s', '--', ...sealedPaths], input.env, [...QUIET_STDIO]))) {
    const match = line.match(LS_FILES_STAGE_PATTERN);
    if (match) entries.set(normalizePath(match[3]), { path: normalizePath(match[3]), mode: match[1], blobId: match[2], disposition: 'present' });
  }
  for (const entry of parseRawDiffEntries(runGitCommandWithEnv(input.cwd, ['diff-index', '--cached', '--raw', '-M', input.baseRef ?? 'HEAD'], input.env, [...QUIET_STDIO]))) if (!entries.has(entry.path)) entries.set(entry.path, entry);
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function readCommittedTreeEntries(cwd: string, commitSha: string, sealedPaths: readonly string[] = []): readonly CommitTreeEntry[] {
  const normalized = [...new Set(sealedPaths.map(normalizePath).filter(Boolean))].sort();
  const entries = new Map<string, CommitTreeEntry>();
  if (normalized.length > 0) for (const line of splitLines(runGitCommand(cwd, ['ls-tree', '-r', commitSha, '--', ...normalized]))) {
    const match = line.match(LS_TREE_PATTERN);
    if (match) entries.set(normalizePath(match[3]), { path: normalizePath(match[3]), mode: match[1], blobId: match[2], disposition: 'present' });
  }
  for (const entry of parseRawDiffEntries(runGitCommand(cwd, ['diff-tree', '--no-commit-id', '--raw', '-r', '-M', commitSha]))) if (!entries.has(entry.path)) entries.set(entry.path, entry);
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function sealCommitBundleFromCandidateIndex(input: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly paths: readonly string[]; readonly provenance?: SealedCommitEntryProvenance; readonly baseTreeSha?: string | null; readonly baseRef?: string }): SealedCommitBundle {
  const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
  if (paths.length === 0) return sealCommitBundle({ entries: [], baseTreeSha: input.baseTreeSha ?? null });
  const entries: SealedCommitBundleEntry[] = [];
  for (const line of splitLines(runGitCommandWithEnv(input.cwd, ['ls-files', '-s', '--', ...paths], input.env, [...QUIET_STDIO]))) {
    const match = line.match(LS_FILES_STAGE_PATTERN);
    if (match) entries.push({ path: normalizePath(match[3]), mode: match[1], blobId: match[2], provenance: input.provenance ?? 'governance-evidence', disposition: 'present' });
  }
  for (const entry of readStagedDeletionEntries({ cwd: input.cwd, paths, baseRef: input.baseRef ?? 'HEAD', env: input.env, provenance: input.provenance })) entries.push(entry);
  return sealCommitBundle({ entries, baseTreeSha: input.baseTreeSha ?? null });
}

function readStagedDeletionEntries(input: { readonly cwd: string; readonly paths: readonly string[]; readonly baseRef: string; readonly env?: NodeJS.ProcessEnv; readonly provenance?: SealedCommitEntryProvenance }): readonly SealedCommitBundleEntry[] {
  const output = input.env ? runGitCommandWithEnv(input.cwd, ['diff-index', '--cached', '--raw', '--diff-filter=D', input.baseRef, '--', ...input.paths], input.env, [...QUIET_STDIO]) : runGitCommand(input.cwd, ['diff-index', '--cached', '--raw', '--diff-filter=D', input.baseRef, '--', ...input.paths]);
  return splitLines(output).flatMap((line) => {
    const match = line.match(RAW_DIFF_PATTERN);
    return match ? [{ path: normalizePath(match[6]), mode: match[1], blobId: '', provenance: input.provenance ?? 'task-scope', disposition: 'deleted' as const }] : [];
  });
}

function isTrackedInBaseTree(input: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly baseRef: string; readonly path: string }): boolean {
  try { runGitCommandWithEnv(input.cwd, ['cat-file', '-e', `${input.baseRef}:${input.path}`], input.env, [...QUIET_STDIO]); return true; } catch { return false; }
}

function parseRawDiffEntries(output: string): readonly CommitTreeEntry[] {
  return splitLines(output).flatMap((line) => {
    const match = line.match(RAW_DIFF_PATTERN);
    if (!match) return [];
    const [, sourceMode, targetMode, , targetBlob, status, filePath] = match;
    const deleted = status.toUpperCase() === 'D' || NULL_OBJECT_ID.test(targetBlob);
    return [{ path: normalizePath(filePath), mode: deleted ? sourceMode : targetMode, blobId: deleted ? '' : targetBlob, disposition: deleted ? 'deleted' as const : 'present' as const }];
  });
}
