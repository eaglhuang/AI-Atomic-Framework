import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { isTaskCloseGovernanceCriticalPath, type HistoricalDeliveryProvenance } from '../framework-development.ts';
import { isTaskDirectionPathCandidate } from '../task-direction.ts';
import { normalizeRelativePath } from './task-file-io-helpers.ts';

export const DIRECTORY_DELIVERABLE_MANIFEST_SCHEMA_ID = 'atm.directoryDeliverableManifest.v1';

export interface DirectoryDeliverableManifestEntry {
  readonly schemaId: typeof DIRECTORY_DELIVERABLE_MANIFEST_SCHEMA_ID;
  readonly declaredPath: string;
  readonly files: readonly string[];
  readonly missingFiles: readonly string[];
}

export interface DirectoryDeliverableExpansion {
  readonly ok: boolean;
  readonly failClosedReason: string | null;
  readonly effectiveDeliverables: readonly string[];
  readonly directoryManifests: readonly DirectoryDeliverableManifestEntry[];
  readonly expandedFiles: readonly string[];
}

export interface HistoricalDeliveryFileBuckets {
  readonly taskMatchedFiles: readonly string[];
  readonly governanceFiles: readonly string[];
  readonly allowedRunnerOutputFiles: readonly string[];
  readonly outOfScopeSourceFiles: readonly string[];
  readonly ignoredFiles: readonly string[];
}

export interface TaskHistoricalDeliveryReport {
  readonly requestedRef: string;
  readonly commitSha: string | null;
  readonly ok: boolean;
  readonly reason: string;
  readonly changedFiles: readonly string[];
  readonly deliverableFiles: readonly string[];
  readonly fileBuckets: HistoricalDeliveryFileBuckets;
  readonly waiverApplied: boolean;
}

const EMPTY_HISTORICAL_DELIVERY_BUCKETS: HistoricalDeliveryFileBuckets = {
  taskMatchedFiles: [],
  governanceFiles: [],
  allowedRunnerOutputFiles: [],
  outOfScopeSourceFiles: [],
  ignoredFiles: []
};

export function categorizeHistoricalCommitFiles(input: {
  readonly taskId: string;
  readonly changedFiles: readonly string[];
  readonly declaredFiles: readonly string[];
}): HistoricalDeliveryFileBuckets {
  const taskMatchedFiles: string[] = [];
  const governanceFiles: string[] = [];
  const allowedRunnerOutputFiles: string[] = [];
  const outOfScopeSourceFiles: string[] = [];
  const ignoredFiles: string[] = [];

  for (const filePath of input.changedFiles) {
    const normalized = normalizeRelativePath(filePath);
    if (!normalized) continue;

    if (normalized.startsWith('.atm/')) {
      if (isTaskCloseGovernanceCriticalPath(normalized, input.taskId)) {
        governanceFiles.push(normalized);
      } else {
        ignoredFiles.push(normalized);
      }
      continue;
    }

    const inScope = input.declaredFiles.some((declared) => pathMatchesTaskScope(normalized, declared));
    if (inScope && isRealDeliverablePath(normalized)) {
      taskMatchedFiles.push(normalized);
      continue;
    }
    if (isDeclaredRunnerOutputPath(normalized, input.declaredFiles)) {
      allowedRunnerOutputFiles.push(normalized);
      continue;
    }
    if (isRealDeliverablePath(normalized) || normalized.startsWith('release/')) {
      outOfScopeSourceFiles.push(normalized);
      continue;
    }

    ignoredFiles.push(normalized);
  }

  return {
    taskMatchedFiles: uniqueStrings(taskMatchedFiles),
    governanceFiles: uniqueStrings(governanceFiles),
    allowedRunnerOutputFiles: uniqueStrings(allowedRunnerOutputFiles),
    outOfScopeSourceFiles: uniqueStrings(outOfScopeSourceFiles),
    ignoredFiles: uniqueStrings(ignoredFiles)
  };
}

export function inspectHistoricalDelivery(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly requestedRef: string;
  readonly declaredFiles: readonly string[];
  readonly enforceDeclaredScope: boolean;
  readonly waiverOutOfScopeDelivery: boolean;
  readonly waiverReason: string | null;
}): TaskHistoricalDeliveryReport {
  const requestedRef = input.requestedRef.trim();
  if (!requestedRef) {
    return {
      requestedRef,
      commitSha: null,
      ok: false,
      reason: 'empty-ref',
      changedFiles: [],
      deliverableFiles: [],
      fileBuckets: EMPTY_HISTORICAL_DELIVERY_BUCKETS,
      waiverApplied: false
    };
  }
  const commitSha = readGitScalar(input.cwd, ['rev-parse', '--verify', `${requestedRef}^{commit}`]);
  if (!commitSha) {
    return {
      requestedRef,
      commitSha: null,
      ok: false,
      reason: 'commit-not-found',
      changedFiles: [],
      deliverableFiles: [],
      fileBuckets: EMPTY_HISTORICAL_DELIVERY_BUCKETS,
      waiverApplied: false
    };
  }
  const changedFiles = readGitNameOnly(input.cwd, ['show', '--pretty=format:', '--name-only', commitSha, '--']);
  const fileBuckets = categorizeHistoricalCommitFiles({
    taskId: input.taskId,
    changedFiles,
    declaredFiles: input.declaredFiles
  });
  const deliverableFiles = input.enforceDeclaredScope
    ? uniqueStrings([
      ...fileBuckets.taskMatchedFiles,
      ...fileBuckets.allowedRunnerOutputFiles
    ])
    : changedFiles.filter((filePath) => isDeliverableGateCandidate(filePath, input.declaredFiles));
  const hasTaskDeliverable = fileBuckets.taskMatchedFiles.length > 0 || fileBuckets.allowedRunnerOutputFiles.length > 0;
  const hasOutOfScope = fileBuckets.outOfScopeSourceFiles.length > 0;
  const waiverReason = input.waiverReason?.trim() ?? '';
  let ok = hasTaskDeliverable;
  let reason = 'no-scoped-deliverable-files';
  let waiverApplied = false;

  if (!hasTaskDeliverable) {
    ok = false;
    reason = 'no-scoped-deliverable-files';
  } else if (hasOutOfScope && !input.waiverOutOfScopeDelivery) {
    ok = false;
    reason = 'out-of-scope-source-files-present';
  } else if (hasOutOfScope && input.waiverOutOfScopeDelivery && !waiverReason) {
    ok = false;
    reason = 'out-of-scope-waiver-reason-required';
  } else if (hasOutOfScope && input.waiverOutOfScopeDelivery) {
    ok = true;
    reason = 'scoped-deliverable-with-waived-out-of-scope';
    waiverApplied = true;
  } else {
    ok = true;
    reason = 'scoped-deliverable-files-present';
  }

  return {
    requestedRef,
    commitSha,
    ok,
    reason,
    changedFiles,
    deliverableFiles,
    fileBuckets,
    waiverApplied
  };
}

export function buildHistoricalDeliveryProvenance(
  report: TaskHistoricalDeliveryReport | null,
  waiverReason: string | null | undefined
): HistoricalDeliveryProvenance | null {
  if (!report?.commitSha) return null;
  return {
    schemaId: 'atm.historicalDeliveryProvenance.v1',
    deliveryCommitSha: report.commitSha,
    taskMatchedFiles: [...report.fileBuckets.taskMatchedFiles],
    governanceFiles: [...report.fileBuckets.governanceFiles],
    allowedRunnerOutputFiles: [...report.fileBuckets.allowedRunnerOutputFiles],
    outOfScopeSourceFiles: [...report.fileBuckets.outOfScopeSourceFiles],
    waivedOutOfScopeFiles: report.waiverApplied ? [...report.fileBuckets.outOfScopeSourceFiles] : [],
    waiverReason: report.waiverApplied ? (waiverReason?.trim() || null) : null
  };
}

export function isDirectoryStyleDeliverableDeclaration(repoRoot: string, declaredPath: string): boolean {
  const normalized = normalizeRelativePath(declaredPath).replace(/\/+$/, '');
  if (!normalized) return false;
  if (declaredPath.replace(/\\/g, '/').trim().endsWith('/')) return true;
  const absolutePath = path.resolve(repoRoot, normalized);
  try {
    return existsSync(absolutePath) && statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

export function listFilesUnderDeclaredDirectory(repoRoot: string, declaredPath: string): readonly string[] {
  const normalized = normalizeRelativePath(declaredPath).replace(/\/+$/, '');
  if (!normalized) return [];
  const absoluteDirectory = path.resolve(repoRoot, normalized);
  if (!existsSync(absoluteDirectory) || !statSync(absoluteDirectory).isDirectory()) return [];
  return listFilesRecursively(repoRoot, normalized);
}

export function expandDirectoryDeliverableDeclarations(
  repoRoot: string,
  deliverables: readonly string[]
): DirectoryDeliverableExpansion {
  const directoryManifests: DirectoryDeliverableManifestEntry[] = [];
  const effectiveDeliverables: string[] = [];
  const expandedFiles: string[] = [];

  for (const declared of deliverables) {
    const normalizedDeclared = normalizeRelativePath(declared).replace(/\/+$/, '');
    if (!normalizedDeclared) continue;
    if (!isDirectoryStyleDeliverableDeclaration(repoRoot, declared)) {
      effectiveDeliverables.push(normalizedDeclared);
      continue;
    }
    const files = listFilesUnderDeclaredDirectory(repoRoot, normalizedDeclared);
    const missingFiles = files.filter((filePath) => !existsSync(path.resolve(repoRoot, filePath)));
    if (files.length === 0) {
      return {
        ok: false,
        failClosedReason: `Task metadata error: directory deliverable "${declared}" is empty or missing on disk.`,
        effectiveDeliverables: [],
        directoryManifests: [],
        expandedFiles: []
      };
    }
    if (missingFiles.length > 0) {
      return {
        ok: false,
        failClosedReason: `Task metadata error: directory deliverable "${declared}" is missing files (${missingFiles.join(', ')}).`,
        effectiveDeliverables: [],
        directoryManifests: [],
        expandedFiles: []
      };
    }
    directoryManifests.push({
      schemaId: DIRECTORY_DELIVERABLE_MANIFEST_SCHEMA_ID,
      declaredPath: normalizedDeclared,
      files,
      missingFiles
    });
    effectiveDeliverables.push(normalizedDeclared);
    expandedFiles.push(...files);
  }

  return {
    ok: true,
    failClosedReason: null,
    effectiveDeliverables: uniqueStrings(effectiveDeliverables),
    directoryManifests,
    expandedFiles: uniqueStrings(expandedFiles)
  };
}

export function pathMatchesTaskScope(filePath: string, scope: string): boolean {
  const file = normalizeRelativePath(filePath).toLowerCase();
  const candidate = normalizeRelativePath(scope).toLowerCase();
  if (!candidate) return false;
  if (candidate.includes('*')) {
    const escaped = candidate
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '__ATM_DOUBLE_STAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__ATM_DOUBLE_STAR__/g, '.*');
    return new RegExp(`^${escaped}$`).test(file);
  }
  if (file === candidate) return true;
  if (candidate.endsWith('/')) return file.startsWith(candidate);
  return file.startsWith(`${candidate}/`);
}

export function isDeliverableGateCandidate(filePath: string, declaredFiles: readonly string[]): boolean {
  return isRealDeliverablePath(filePath) || isDeclaredRunnerOutputPath(filePath, declaredFiles);
}

function isRealDeliverablePath(filePath: string): boolean {
  const normalized = normalizeRelativePath(filePath);
  if (!normalized) return false;
  if (normalized.startsWith('.atm/')) return false;
  if (normalized.startsWith('.git/')) return false;
  if (/^(node_modules|dist|build|coverage|release|scratch|temp|tmp|\.atm-temp)\//.test(normalized)) return false;
  return isTaskDirectionPathCandidate(normalized);
}

function isDeclaredRunnerOutputPath(filePath: string, declaredFiles: readonly string[]): boolean {
  const normalized = normalizeRelativePath(filePath);
  if (!normalized) return false;
  if (normalized.startsWith('.atm/') || normalized.startsWith('.git/')) return false;
  if (!normalized.startsWith('release/atm-onefile/') && !normalized.startsWith('release/atm-root-drop/')) return false;
  return declaredFiles.some((declared) => pathMatchesTaskScope(normalized, declared));
}

function readGitScalar(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() || null;
  } catch {
    return null;
  }
}

function readGitNameOnly(cwd: string, args: readonly string[]): readonly string[] {
  try {
    const output = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return uniqueStrings(output.split(/\r?\n/).map(normalizeRelativePath).filter(Boolean));
  } catch {
    return [];
  }
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function listFilesRecursively(repoRoot: string, relativeDirectory: string): readonly string[] {
  const absoluteDirectory = path.resolve(repoRoot, relativeDirectory);
  if (!existsSync(absoluteDirectory) || !statSync(absoluteDirectory).isDirectory()) return [];
  const files: string[] = [];
  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const relativePath = path.posix.join(relativeDirectory.replace(/\\/g, '/'), entry.name);
    const absolutePath = path.resolve(repoRoot, relativePath);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(repoRoot, relativePath));
    } else if (entry.isFile()) {
      files.push(normalizeRelativePath(relativePath));
    } else if (entry.isSymbolicLink()) {
      try {
        if (statSync(absolutePath).isFile()) {
          files.push(normalizeRelativePath(relativePath));
        }
      } catch {
        // ignore broken symlinks during manifest expansion
      }
    }
  }
  return uniqueStrings(files);
}
