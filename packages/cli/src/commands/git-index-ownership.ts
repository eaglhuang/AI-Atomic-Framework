import { execFileSync } from 'node:child_process';
import { readActiveTaskDirectionLocks } from './task-direction.ts';
import { isPathAllowedByScope } from './work-channels.ts';

export type GitIndexOwnershipClass =
  | 'current-task-owned'
  | 'foreign-active-owned'
  | 'foreign-released-or-abandoned'
  | 'unknown-governance-artifact'
  | 'ordinary-unowned';

export type GitIndexLaneStatus =
  | 'free'
  | 'owned-by-task'
  | 'queued'
  | 'requires-staging-steward'
  | 'blocked-foreign-active-staged';

export interface GitIndexOwnershipEntry {
  readonly path: string;
  readonly ownership: GitIndexOwnershipClass;
  readonly ownerTaskId: string | null;
  readonly ownerActorId: string | null;
  readonly stagedBlobId: string | null;
  readonly stagedMode: string | null;
  readonly source: 'governance-path' | 'active-direction-lock' | 'ordinary';
}

export interface GitIndexOwnershipReport {
  readonly schemaId: 'atm.gitIndexOwnership.v1';
  readonly taskId: string | null;
  readonly generatedAt: string;
  readonly entries: readonly GitIndexOwnershipEntry[];
  readonly foreignActiveStaged: readonly GitIndexOwnershipEntry[];
  readonly indexLane: {
    readonly schemaId: 'atm.gitIndexLane.v1';
    readonly status: GitIndexLaneStatus;
    readonly ownerTaskId: string | null;
    readonly ownerActorId: string | null;
    readonly reason: string;
  };
}

export const ATM_INDEX_FOREIGN_ACTIVE_STAGED = 'ATM_INDEX_FOREIGN_ACTIVE_STAGED';

export function inspectGitIndexOwnership(input: {
  readonly cwd: string;
  readonly taskId?: string | null;
  readonly stagedFiles?: readonly string[] | null;
}): GitIndexOwnershipReport {
  const currentTaskId = normalizeTaskId(input.taskId ?? null);
  const stagedFiles = uniqueSorted(input.stagedFiles ?? readStagedFiles(input.cwd));
  const stagedBlobs = readStagedBlobMap(input.cwd, stagedFiles);
  const activeLocks = readActiveTaskDirectionLocks(input.cwd);
  const entries = stagedFiles.map((filePath): GitIndexOwnershipEntry => {
    const governanceTaskId = extractGovernanceTaskId(filePath);
    const lockOwner = activeLocks.find((lock) => isPathAllowedByScope(filePath, lock.allowedFiles)) ?? null;
    const ownerTaskId = governanceTaskId ?? lockOwner?.taskId ?? null;
    const ownerActorId = lockOwner?.actorId ?? null;
    const stagedBlob = stagedBlobs.get(normalizeRelativePath(filePath).toLowerCase()) ?? null;
    if (ownerTaskId) {
      const normalizedOwner = normalizeTaskId(ownerTaskId);
      const isCurrent = Boolean(currentTaskId && normalizedOwner === currentTaskId);
      const isActive = activeLocks.some((lock) => normalizeTaskId(lock.taskId) === normalizedOwner && lock.status === 'active');
      return {
        path: normalizeRelativePath(filePath),
        ownership: isCurrent ? 'current-task-owned' : isActive ? 'foreign-active-owned' : 'foreign-released-or-abandoned',
        ownerTaskId: normalizedOwner,
        ownerActorId,
        stagedBlobId: stagedBlob?.objectId ?? null,
        stagedMode: stagedBlob?.mode ?? null,
        source: governanceTaskId ? 'governance-path' : 'active-direction-lock'
      };
    }
    const normalized = normalizeRelativePath(filePath).toLowerCase();
    if (normalized.startsWith('.atm/history/') || normalized.startsWith('.atm/runtime/')) {
      return {
        path: normalizeRelativePath(filePath),
        ownership: 'unknown-governance-artifact',
        ownerTaskId: null,
        ownerActorId: null,
        stagedBlobId: stagedBlob?.objectId ?? null,
        stagedMode: stagedBlob?.mode ?? null,
        source: 'governance-path'
      };
    }
    return {
      path: normalizeRelativePath(filePath),
      ownership: 'ordinary-unowned',
      ownerTaskId: null,
      ownerActorId: null,
      stagedBlobId: stagedBlob?.objectId ?? null,
      stagedMode: stagedBlob?.mode ?? null,
      source: 'ordinary'
    };
  });
  const foreignActiveStaged = entries.filter((entry) => entry.ownership === 'foreign-active-owned');
  return {
    schemaId: 'atm.gitIndexOwnership.v1',
    taskId: currentTaskId,
    generatedAt: new Date().toISOString(),
    entries,
    foreignActiveStaged,
    indexLane: buildIndexLane(currentTaskId, entries, foreignActiveStaged)
  };
}

export function buildForeignActiveStagedDiagnostic(report: GitIndexOwnershipReport) {
  const owners = uniqueSorted(report.foreignActiveStaged.map((entry) => entry.ownerTaskId ?? '').filter(Boolean));
  return {
    code: ATM_INDEX_FOREIGN_ACTIVE_STAGED,
    ownerTaskIds: owners,
    ownerActorIds: uniqueSorted(report.foreignActiveStaged.map((entry) => entry.ownerActorId ?? '').filter(Boolean)),
    stagedPaths: report.foreignActiveStaged.map((entry) => entry.path),
    indexLane: report.indexLane,
    safeNextActions: [
      'wait-for-owner',
      'request-broker-index-lane',
      'use-explicit-stage-override-lease-if-human-approved'
    ],
    requiredCommand: 'node atm.mjs git lease stage-override --task <task-id> --actor <actor-id> --paths <paths> --reason <human-approved-reason> --json'
  };
}

function buildIndexLane(
  currentTaskId: string | null,
  entries: readonly GitIndexOwnershipEntry[],
  foreignActiveStaged: readonly GitIndexOwnershipEntry[]
): GitIndexOwnershipReport['indexLane'] {
  if (entries.length === 0) {
    return {
      schemaId: 'atm.gitIndexLane.v1',
      status: 'free',
      ownerTaskId: null,
      ownerActorId: null,
      reason: 'No staged paths are present in the shared Git index.'
    };
  }
  if (foreignActiveStaged.length > 0) {
    const owner = foreignActiveStaged[0]!;
    return {
      schemaId: 'atm.gitIndexLane.v1',
      status: 'blocked-foreign-active-staged',
      ownerTaskId: owner.ownerTaskId,
      ownerActorId: owner.ownerActorId,
      reason: `The shared Git index contains foreign-active staged paths owned by ${owner.ownerTaskId ?? 'unknown-task'}.`
    };
  }
  const currentOwned = entries.filter((entry) => entry.ownership === 'current-task-owned');
  if (currentOwned.length > 0) {
    return {
      schemaId: 'atm.gitIndexLane.v1',
      status: 'owned-by-task',
      ownerTaskId: currentTaskId,
      ownerActorId: currentOwned[0]?.ownerActorId ?? null,
      reason: `The shared Git index currently belongs to ${currentTaskId ?? 'the current task'}.`
    };
  }
  if (entries.some((entry) => entry.ownership === 'unknown-governance-artifact')) {
    return {
      schemaId: 'atm.gitIndexLane.v1',
      status: 'requires-staging-steward',
      ownerTaskId: null,
      ownerActorId: null,
      reason: 'The shared Git index contains governance artifacts whose owner cannot be resolved.'
    };
  }
  return {
    schemaId: 'atm.gitIndexLane.v1',
    status: 'queued',
    ownerTaskId: null,
    ownerActorId: null,
    reason: 'The shared Git index contains staged files but no current-task ownership proof.'
  };
}

function readStagedFiles(cwd: string): readonly string[] {
  try {
    return uniqueSorted(execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).split(/\r?\n/));
  } catch {
    return [];
  }
}

function readStagedBlobMap(cwd: string, stagedFiles: readonly string[]) {
  const map = new Map<string, { mode: string; objectId: string }>();
  if (stagedFiles.length === 0) return map;
  try {
    const output = execFileSync('git', ['ls-files', '-s', '--', ...stagedFiles], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t(.+)$/i);
      if (!match) continue;
      map.set(normalizeRelativePath(match[3]!).toLowerCase(), { mode: match[1]!, objectId: match[2]! });
    }
  } catch {
    // Missing blob metadata should not hide ownership classification.
  }
  return map;
}

function extractGovernanceTaskId(filePath: string): string | null {
  const normalized = normalizeRelativePath(filePath);
  const match = normalized.match(/^\.atm\/history\/(?:tasks|evidence|task-events)\/([^/.]+)(?:[/.]|$)/i);
  return match ? normalizeTaskId(match[1]!) : null;
}

function normalizeTaskId(value: string | null): string | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized || null;
}

function normalizeRelativePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeRelativePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
