import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hasAtmCriticalNonDocSurface } from './framework-development/path-classification.ts';
import { inspectGitWorktreeReadiness } from './git-worktree-readiness.ts';

export const gitHeadEvidencePaths = {
  legacyJson: '.atm/history/evidence/git-head.json',
  jsonl: '.atm/history/evidence/git-head.jsonl',
  runtimeJsonl: '.atm/runtime/telemetry/git-head.jsonl',
  trackedReceipt: '.atm/history/evidence/git-head.json'
};
export const gitHeadEvidencePath = gitHeadEvidencePaths.trackedReceipt;

/**
 * Returns the task identity asserted by the newest parseable governed Git-head
 * receipt.  Callers must treat null as unowned: a path name, an older record,
 * or malformed JSON is never an ownership grant.
 */
export function readLatestGitHeadReceiptTaskId(cwd: string): string | null {
  for (const relativePath of [gitHeadEvidencePaths.trackedReceipt, gitHeadEvidencePaths.jsonl]) {
    const receipt = path.join(cwd, relativePath);
    if (!existsSync(receipt)) continue;
    try {
      const entries = readFileSync(receipt, 'utf8').trim().split(/\r?\n/).filter(Boolean);
      const latest = JSON.parse(entries.at(-1) ?? '{}') as {
        evidence?: Array<{ details?: { taskId?: unknown } }>;
      };
      if (isCompactReceipt(latest) && !isValidCompactReceipt(latest)) continue;
      const taskId = latest.evidence?.[0]?.details?.taskId;
      if (typeof taskId === 'string' && taskId.trim()) return taskId.trim();
    } catch {
      continue;
    }
  }
  return null;
}

export interface GitDetails {
  commitSha: string | null;
  treeSha: string | null;
  parentCommitShas: string[];
}

export interface EvidenceRecord {
  path: string;
  index: number;
  git: GitDetails;
}

export function createGitHeadEvidenceCheck(cwd: string, runtime: unknown) {
  const workTree = readGitWorkTree(cwd);
  if (workTree.status === 'bare-worktree-mismatch') {
    return createGitEvidenceDetails('bare-worktree-mismatch', {
      workTreeRoot: workTree.root,
      gitDir: workTree.gitDir,
      localConfigLikely: workTree.localConfigLikely,
      reason: workTree.reason,
      recommendedFixCommand: workTree.recommendedFixCommand
    }, false);
  }
  if (!workTree.ok) {
    return createGitEvidenceDetails('not-git', {
      reason: workTree.reason
    });
  }

  if (!hasAtmRuntime(cwd, runtime)) {
    return createGitEvidenceDetails('not-adopted', {
      workTreeRoot: workTree.root
    });
  }

  const head = runGit(cwd, ['rev-parse', '--verify', 'HEAD']);
  if (!head.ok) {
    return createGitEvidenceDetails('no-commits', {
      workTreeRoot: workTree.root,
      reason: head.stderr || head.stdout
    });
  }

  const commitSha = head.stdout.trim();
  const parentCommitShas = readParentCommitShas(cwd);
  const treeSha = readGitScalar(cwd, ['rev-parse', `${commitSha}^{tree}`]);
  const governedTreeSha = readGovernedHeadTreeSha(cwd, commitSha, gitHeadEvidencePath) ?? treeSha;
  const evidenceRecords = readEvidenceRecords(cwd, runtime);
  const commitMatch = evidenceRecords.find((entry) => entry.git.commitSha === commitSha);
  const treeMatch = commitMatch
    ? null
    : evidenceRecords.find((entry) => {
      const evidenceTreeSha = entry.git.treeSha;
      return Boolean(evidenceTreeSha)
        && (evidenceTreeSha === governedTreeSha || evidenceTreeSha === treeSha)
        && sameStringSet(entry.git.parentCommitShas, parentCommitShas);
    });
  const evidenceOnlyParentMatch = commitMatch || treeMatch
    ? null
    : findEvidenceOnlyParentMatch(cwd, commitSha, parentCommitShas, evidenceRecords);
  const matchedRecord = commitMatch ?? treeMatch ?? evidenceOnlyParentMatch?.record ?? null;
  const matchedBy = commitMatch
    ? 'commitSha'
    : treeMatch
      ? 'treeSha+parentCommitShas'
      : evidenceOnlyParentMatch?.matchedBy ?? null;
  const ok = matchedRecord !== null;

  if (!ok) {
    const changedPaths = readCommitChangedPaths(cwd, commitSha);
    if (!hasAtmCriticalNonDocSurface(changedPaths)) {
      return createGitEvidenceDetails('not-required-non-critical-head', {
        workTreeRoot: workTree.root,
        commitSha,
        treeSha,
        governedTreeSha,
        parentCommitShas,
        expectedEvidencePath: gitHeadEvidencePath,
        evidenceRecordsScanned: evidenceRecords.length,
        matchedBy,
        matchedEvidencePath: null,
        evidenceOnlyHead: evidenceOnlyParentMatch !== null,
        evidenceOnlyCoveredCommitSha: evidenceOnlyParentMatch?.coveredCommitSha ?? null,
        changedPaths,
        criticalChangedFiles: []
      }, true);
    }
  }

  return createGitEvidenceDetails(ok ? 'matched' : 'missing', {
    workTreeRoot: workTree.root,
    commitSha,
    treeSha,
    governedTreeSha,
    parentCommitShas,
    expectedEvidencePath: gitHeadEvidencePath,
    evidenceRecordsScanned: evidenceRecords.length,
    matchedBy,
    matchedEvidencePath: matchedRecord?.path ?? null,
    evidenceOnlyHead: evidenceOnlyParentMatch !== null,
    evidenceOnlyCoveredCommitSha: evidenceOnlyParentMatch?.coveredCommitSha ?? null
  }, ok);
}

function createGitEvidenceDetails(status: string, details: Record<string, unknown>, ok = true) {
  return {
    name: 'git-head-evidence',
    ok,
    details: {
      status,
      ...details
    }
  };
}

function hasAtmRuntime(cwd: string, runtime: unknown) {
  return Boolean((runtime as { config?: unknown })?.config)
    || existsSync(path.join(cwd, '.atm', 'config.json'))
    || existsSync(path.join(cwd, '.atm', 'runtime', 'current-task.json'));
}

function readGitWorkTree(cwd: string) {
  const readiness = inspectGitWorktreeReadiness(cwd);
  if (readiness.status === 'bare-worktree-mismatch') {
    return {
      ok: false,
      status: readiness.status,
      root: readiness.worktreeRoot,
      gitDir: readiness.gitDir,
      localConfigLikely: readiness.localConfigLikely,
      reason: readiness.reason,
      recommendedFixCommand: readiness.recommendedFixCommand
    };
  }
  if (readiness.status !== 'ready') {
    return { ok: false, status: readiness.status, reason: readiness.reason || 'not a git worktree' };
  }
  return {
    ok: true,
    status: 'ready',
    root: readiness.worktreeRoot ?? toPortablePath(cwd),
    gitDir: readiness.gitDir,
    localConfigLikely: readiness.localConfigLikely,
    reason: readiness.reason,
    recommendedFixCommand: readiness.recommendedFixCommand
  };
}

function readParentCommitShas(cwd: string) {
  const result = runGit(cwd, ['rev-list', '--parents', '-n', '1', 'HEAD']);
  if (!result.ok) {
    return [];
  }
  return result.stdout.trim().split(/\s+/).slice(1).filter(Boolean);
}

function readGitScalar(cwd: string, args: readonly string[]) {
  const result = runGit(cwd, args);
  return result.ok ? result.stdout.trim() : null;
}

function readGovernedHeadTreeSha(cwd: string, commitSha: string, evidencePath: string) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-git-head-'));
  const tempIndex = path.join(tempDir, 'index');
  try {
    const readTree = runGit(cwd, ['read-tree', commitSha], {
      GIT_INDEX_FILE: tempIndex
    });
    if (!readTree.ok) {
      return null;
    }
    runGit(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', gitHeadEvidencePaths.legacyJson, gitHeadEvidencePaths.jsonl], {
      GIT_INDEX_FILE: tempIndex
    });
    const writeTree = runGit(cwd, ['write-tree'], {
      GIT_INDEX_FILE: tempIndex
    });
    return writeTree.ok ? writeTree.stdout.trim() : null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function findEvidenceOnlyParentMatch(
  cwd: string,
  commitSha: string,
  parentCommitShas: readonly string[],
  evidenceRecords: readonly EvidenceRecord[]
) {
  if (!Array.isArray(parentCommitShas) || parentCommitShas.length !== 1) {
    return null;
  }
  if (!isEvidenceOnlyCommit(cwd, commitSha)) {
    return null;
  }
  const parentCommitSha = parentCommitShas[0];
  const parentCommitMatch = evidenceRecords.find((entry) => entry.git.commitSha === parentCommitSha);
  if (parentCommitMatch) {
    return {
      record: parentCommitMatch,
      matchedBy: 'evidenceOnlyParentCommitSha',
      coveredCommitSha: parentCommitSha
    };
  }

  const parentTreeSha = readGitScalar(cwd, ['rev-parse', `${parentCommitSha}^{tree}`]);
  const parentGovernedTreeSha = readGovernedHeadTreeSha(cwd, parentCommitSha, gitHeadEvidencePath) ?? parentTreeSha;
  const parentParents = readParentCommitShasForCommit(cwd, parentCommitSha);
  const parentTreeMatch = evidenceRecords.find((entry) => {
    const evidenceTreeSha = entry.git.treeSha;
    return Boolean(evidenceTreeSha)
      && (evidenceTreeSha === parentGovernedTreeSha || (parentTreeSha && evidenceTreeSha === parentTreeSha))
      && sameStringSet(entry.git.parentCommitShas, parentParents);
  });
  return parentTreeMatch
    ? {
      record: parentTreeMatch,
      matchedBy: 'evidenceOnlyParentTreeSha',
      coveredCommitSha: parentCommitSha
    }
    : null;
}

function isEvidenceOnlyCommit(cwd: string, commitSha: string) {
  const changedPaths = readCommitChangedPaths(cwd, commitSha);
  return changedPaths.length > 0 && changedPaths.every((entry) => entry === gitHeadEvidencePaths.legacyJson || entry === gitHeadEvidencePaths.jsonl);
}

function readCommitChangedPaths(cwd: string, commitSha: string): string[] {
  const result = runGit(cwd, ['diff-tree', '--no-commit-id', '--name-only', '-r', commitSha]);
  if (!result.ok) {
    return [];
  }
  return result.stdout.split(/\r?\n/).map((entry) => toPortablePath(entry.trim())).filter(Boolean);
}

function readParentCommitShasForCommit(cwd: string, commitSha: string) {
  const result = runGit(cwd, ['rev-list', '--parents', '-n', '1', commitSha]);
  if (!result.ok) {
    return [];
  }
  return result.stdout.trim().split(/\s+/).slice(1).filter(Boolean);
}

function readEvidenceRecords(cwd: string, runtime: unknown): EvidenceRecord[] {
  const evidenceRoots = (runtime as { layoutVersion?: unknown })?.layoutVersion === 1
    ? [path.join(cwd, '.atm', 'evidence')]
    : [path.join(cwd, '.atm', 'history', 'evidence')];
  return evidenceRoots.filter(existsSync).flatMap((evidenceRoot) => listJsonFiles(evidenceRoot)).flatMap((filePath: string) => {
    const isJsonl = filePath.endsWith('.jsonl');
    if (!isJsonl && toPortablePath(path.relative(cwd, filePath)) === gitHeadEvidencePaths.trackedReceipt) {
      const compact = readJsonIfPossible(filePath);
      if (isCompactReceipt(compact) && !isValidCompactReceipt(compact)) return [];
    }
    const records = isJsonl
      ? readJsonlObjects(filePath).flatMap(extractEvidenceRecords)
      : extractEvidenceRecords(readJsonIfPossible(filePath));
    return records.map((record: unknown, index: number) => {
      const rec = record as { details?: { git?: unknown } };
      return {
        path: toPortablePath(path.relative(cwd, filePath)),
        index,
        git: normalizeGitDetails(rec?.details?.git)
      };
    }).filter((entry): entry is EvidenceRecord => entry.git !== null);
  });
}

function isCompactReceipt(value: unknown): value is Record<string, unknown> & { schemaVersion: string } {
  return Boolean(value && typeof value === 'object' && (value as { schemaVersion?: unknown }).schemaVersion === 'atm.gitHeadAcceptance.v1');
}

function isValidCompactReceipt(value: Record<string, unknown>): boolean {
  if (value.storagePolicy !== 'runtime-raw-tracked-digest') return false;
  const source = value.source;
  if (!source || typeof source !== 'object') return false;
  const sourceValue = source as Record<string, unknown>;
  if (sourceValue.availability !== 'runtime-local'
    || sourceValue.rawJournalPath !== gitHeadEvidencePaths.runtimeJsonl
    || !isSha256(sourceValue.rawEventDigest)) return false;
  if (!Array.isArray(value.evidence) || !isSha256(value.digest)) return false;
  const { digest: _digest, ...withoutDigest } = value;
  const expected = `sha256:${createHash('sha256').update(JSON.stringify(withoutDigest), 'utf8').digest('hex')}`;
  return value.digest === expected;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function extractEvidenceRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is unknown => entry && typeof entry === 'object');
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const val = value as { evidence?: unknown; evidenceKind?: unknown; details?: unknown };
  if (Array.isArray(val.evidence)) {
    return val.evidence.filter((entry): entry is unknown => entry && typeof entry === 'object');
  }
  if (val.evidenceKind || val.details) {
    return [value];
  }
  return [];
}

function normalizeGitDetails(value: unknown): GitDetails | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const val = value as { commitSha?: unknown; treeSha?: unknown; parentCommitShas?: unknown };
  return {
    commitSha: typeof val.commitSha === 'string' ? val.commitSha.trim() : null,
    treeSha: typeof val.treeSha === 'string' ? val.treeSha.trim() : null,
    parentCommitShas: Array.isArray(val.parentCommitShas)
      ? val.parentCommitShas.map((entry: unknown) => String(entry).trim()).filter(Boolean)
      : []
  };
}

function listJsonFiles(directoryPath: string): string[] {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return listJsonFiles(absolutePath);
    }
    return entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.jsonl')) ? [absolutePath] : [];
  });
}

function readJsonIfPossible(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readJsonlObjects(filePath: string): unknown[] {
  try {
    const content = readFileSync(filePath, 'utf8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]) {
  const normalize = (values: readonly string[]) => [...new Set((values ?? []).map((value: string) => String(value).trim()).filter(Boolean))].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function runGit(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync('git', args, {
    cwd,
    env: createSanitizedGitEnv(env),
    encoding: 'utf8'
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? '',
    stderr: [result.stderr ?? '', result.error?.message ?? ''].filter(Boolean).join('\n')
  };
}

function createSanitizedGitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extra
  };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_PREFIX', 'GIT_COMMON_DIR', 'GIT_NAMESPACE']) {
    delete env[key];
  }
  if (!Object.prototype.hasOwnProperty.call(extra, 'GIT_INDEX_FILE')) {
    delete env.GIT_INDEX_FILE;
  }
  return env;
}

function toPortablePath(value: string | null | undefined) {
  return String(value || '').replace(/\\/g, '/');
}
