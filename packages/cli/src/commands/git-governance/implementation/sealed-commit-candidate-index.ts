/** Git adapter for candidate-index assembly; content always comes from a seal. */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import { assertFinalCandidateIndex, candidateGit, candidateGitlinks, isDeclaredCandidate, nulPaths, resolveCandidateFiles, safeCandidatePath, stageExactCandidateFiles, type CandidateFilePolicy } from './candidate-file-policy.ts';
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
import { runGitCommandWithEnv } from './git-process-port.ts';

const QUIET_STDIO = ['ignore', 'pipe', 'pipe'] as const;
const LS_FILES_STAGE_PATTERN = /^(\d+) ([0-9a-f]+) \d+\t([\s\S]+)$/i;
const LS_TREE_PATTERN = /^(\d+) blob ([0-9a-f]+)\t([\s\S]+)$/i;
const NULL_OBJECT_ID = /^0+$/;

function normalizePath(value: string): string { return String(value ?? '').replace(/^\.\//, ''); }

export function sealCommitBundleFromLiveIndex(input: { readonly cwd: string; readonly paths: readonly string[]; readonly provenance: SealedCommitEntryProvenance; readonly baseTreeSha?: string | null; readonly baseRef?: string | null; readonly policy?: CandidateFilePolicy }): SealedCommitBundle {
  const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
  if (paths.length === 0) return sealCommitBundle({ entries: [], baseTreeSha: input.baseTreeSha ?? null });
  const entries: SealedCommitBundleEntry[] = [];
  for (const line of nulPaths(candidateGit(input.cwd, ['ls-files', '-s', '-z', '--', ...paths]))) {
    const match = line.match(LS_FILES_STAGE_PATTERN);
    if (match) entries.push({ path: normalizePath(match[3]), mode: match[1], blobId: match[2], provenance: input.provenance, declared: isDeclaredCandidate(normalizePath(match[3]), input.policy ?? {}, input.cwd), disposition: 'present' });
  }
  for (const entry of readStagedDeletionEntries({ cwd: input.cwd, paths, baseRef: input.baseRef ?? 'HEAD' })) entries.push({ ...entry, provenance: input.provenance });
  return sealCommitBundle({ entries, baseTreeSha: input.baseTreeSha ?? null });
}

export function withWorktreeCandidateIndex<T>(input: { readonly cwd: string; readonly paths: readonly string[]; readonly policy?: CandidateFilePolicy; readonly run: (env: NodeJS.ProcessEnv, files: readonly string[]) => T }): T {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-worktree-candidate-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index'), GIT_LITERAL_PATHSPECS: '1' };
  try {
    runGitCommandWithEnv(input.cwd, ['read-tree', 'HEAD'], env, [...QUIET_STDIO]);
    const files = resolveCandidateFiles(input.cwd, input.paths, input.policy, env);
    stageExactCandidateFiles(input.cwd, files, env);
    assertFinalCandidateIndex(input.cwd, env, input.policy);
    const result = input.run(env, files);
    assertFinalCandidateIndex(input.cwd, env, input.policy);
    return result;
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
  const policy = { declaredPaths: input.bundle.entries.filter((entry) => entry.declared === true).map((entry) => entry.path) };
  const gitlinks = candidateGitlinks(input.cwd, input.env, input.baseRef);
  for (const entry of input.bundle.entries) {
    if (entry.mode === '160000' || (entry.mode === '120000' && !isTombstone(entry) && !entry.declared) || !safeCandidatePath(input.cwd, entry.path, gitlinks)) throw new CliError('ATM_COMMIT_UNSAFE_CANDIDATE_PATH', `Unsafe sealed path: ${entry.path}`, { exitCode: 1 });
  }
  for (const entry of input.bundle.entries.filter(isTombstone)) candidateGit(input.cwd, ['update-index', '--force-remove', '--', entry.path], input.env);
  for (const entry of input.bundle.entries.filter((entry) => !isTombstone(entry))) candidateGit(input.cwd, ['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.blobId},${entry.path}`], input.env);
  // Content comes only from the seal; re-reading worktree paths here used to
  // recursively stage ignored children and could replace admitted bytes.
  assertFinalCandidateIndex(input.cwd, input.env, policy, input.baseRef);

}

export function readCandidateTreeEntries(input: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly baseRef?: string; readonly sealedPaths?: readonly string[] }): readonly CommitTreeEntry[] {
  const sealedPaths = [...new Set((input.sealedPaths ?? []).map(normalizePath).filter(Boolean))].sort();
  const entries = new Map<string, CommitTreeEntry>();
  if (sealedPaths.length > 0) for (const line of nulPaths(candidateGit(input.cwd, ['ls-files', '-s', '-z', '--', ...sealedPaths], input.env))) {
    const match = line.match(LS_FILES_STAGE_PATTERN);
    if (match) entries.set(normalizePath(match[3]), { path: normalizePath(match[3]), mode: match[1], blobId: match[2], disposition: 'present' });
  }
  for (const entry of parseRawDiffEntries(candidateGit(input.cwd, ['diff-index', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z', input.baseRef ?? 'HEAD'], input.env))) if (!entries.has(entry.path)) entries.set(entry.path, entry);
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function readCommittedTreeEntries(cwd: string, commitSha: string, sealedPaths: readonly string[] = []): readonly CommitTreeEntry[] {
  const normalized = [...new Set(sealedPaths.map(normalizePath).filter(Boolean))].sort();
  const entries = new Map<string, CommitTreeEntry>();
  if (normalized.length > 0) for (const line of nulPaths(candidateGit(cwd, ['ls-tree', '-r', '-z', commitSha, '--', ...normalized]))) {
    const match = line.match(LS_TREE_PATTERN);
    if (match) entries.set(normalizePath(match[3]), { path: normalizePath(match[3]), mode: match[1], blobId: match[2], disposition: 'present' });
  }
  for (const entry of parseRawDiffEntries(candidateGit(cwd, ['diff-tree', '--no-commit-id', '--raw', '--no-abbrev', '--no-renames', '-r', '-z', commitSha]))) if (!entries.has(entry.path)) entries.set(entry.path, entry);
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function sealCommitBundleFromCandidateIndex(input: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly paths: readonly string[]; readonly provenance?: SealedCommitEntryProvenance; readonly baseTreeSha?: string | null; readonly baseRef?: string; readonly policy?: CandidateFilePolicy }): SealedCommitBundle {
  const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
  if (paths.length === 0) return sealCommitBundle({ entries: [], baseTreeSha: input.baseTreeSha ?? null });
  const entries: SealedCommitBundleEntry[] = [];
  for (const line of nulPaths(candidateGit(input.cwd, ['ls-files', '-s', '-z', '--', ...paths], input.env))) {
    const match = line.match(LS_FILES_STAGE_PATTERN);
    if (match) entries.push({ path: normalizePath(match[3]), mode: match[1], blobId: match[2], provenance: input.provenance ?? 'governance-evidence', declared: isDeclaredCandidate(normalizePath(match[3]), input.policy ?? {}, input.cwd), disposition: 'present' });
  }
  for (const entry of readStagedDeletionEntries({ cwd: input.cwd, paths, baseRef: input.baseRef ?? 'HEAD', env: input.env, provenance: input.provenance })) entries.push(entry);
  return sealCommitBundle({ entries, baseTreeSha: input.baseTreeSha ?? null });
}

function readStagedDeletionEntries(input: { readonly cwd: string; readonly paths: readonly string[]; readonly baseRef: string; readonly env?: NodeJS.ProcessEnv; readonly provenance?: SealedCommitEntryProvenance }): readonly SealedCommitBundleEntry[] {
  const entries = parseRawDiffEntries(candidateGit(input.cwd, ['diff-index', '--cached', '--raw', '--no-abbrev', '--no-renames', '-z', '--diff-filter=D', input.baseRef, '--', ...input.paths], input.env));
  return entries.map((entry) => ({ ...entry, provenance: input.provenance ?? 'task-scope' }));
}

function parseRawDiffEntries(output: string): readonly CommitTreeEntry[] {
  const records = nulPaths(output);
  const entries: CommitTreeEntry[] = [];
  for (let i = 0; i < records.length; i += 2) {
    const match = records[i].match(/^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])$/i);
    if (!match || records[i + 1] === undefined) continue;
    const deleted = match[5] === 'D' || NULL_OBJECT_ID.test(match[4]);
    entries.push({ path: records[i + 1], mode: deleted ? match[1] : match[2], blobId: deleted ? '' : match[4], disposition: deleted ? 'deleted' : 'present' });
  }
  return entries;
}
