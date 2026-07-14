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

export interface GitIndexLeaseParkEntry {
  readonly path: string;
  readonly ownerTaskId: string | null;
  readonly ownerActorId: string | null;
  readonly stagedBlobId: string | null;
  readonly stagedMode: string | null;
  readonly restoreIdentity: string;
}

export interface GitIndexLeaseParkPlan {
  readonly schemaId: 'atm.gitIndexLeaseParkPlan.v1';
  readonly taskId: string | null;
  readonly leaseId: string;
  readonly generatedAt: string;
  readonly status: 'not-needed' | 'park-and-restore' | 'blocked-foreign-active-staged';
  readonly parkEntries: readonly GitIndexLeaseParkEntry[];
  readonly restoreEntries: readonly GitIndexLeaseParkEntry[];
  readonly approvedPartialStagedBlobIds: readonly string[];
  readonly reason: string;
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

export function buildGitIndexLeaseParkPlan(input: {
  readonly report: GitIndexOwnershipReport;
  readonly expectedStageFiles: readonly string[];
  readonly leaseId?: string | null;
  readonly generatedAt?: string | null;
}): GitIndexLeaseParkPlan {
  const expected = new Set(input.expectedStageFiles.map((entry) => normalizeRelativePath(entry).toLowerCase()));
  const foreignEntries = input.report.entries
    .filter((entry) => !expected.has(normalizeRelativePath(entry.path).toLowerCase()))
    .map((entry): GitIndexLeaseParkEntry => ({
      path: entry.path,
      ownerTaskId: entry.ownerTaskId,
      ownerActorId: entry.ownerActorId,
      stagedBlobId: entry.stagedBlobId,
      stagedMode: entry.stagedMode,
      restoreIdentity: `${entry.stagedMode ?? 'missing'}:${entry.stagedBlobId ?? 'missing'}:${entry.path}`
    }));
  const approvedPartialStagedBlobIds = uniqueSorted(foreignEntries.map((entry) => entry.stagedBlobId ?? '').filter(Boolean));
  const leaseId = input.leaseId?.trim()
    || `index-lease-${shortDigest([
      input.report.taskId ?? 'no-task',
      ...foreignEntries.map((entry) => entry.restoreIdentity)
    ].join('\n'))}`;
  if (input.report.foreignActiveStaged.length > 0) {
    return {
      schemaId: 'atm.gitIndexLeaseParkPlan.v1',
      taskId: input.report.taskId,
      leaseId,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      status: 'blocked-foreign-active-staged',
      parkEntries: foreignEntries,
      restoreEntries: foreignEntries,
      approvedPartialStagedBlobIds,
      reason: 'Foreign active staged paths require an explicit stage-override lease before park/restore.'
    };
  }
  if (foreignEntries.length === 0) {
    return {
      schemaId: 'atm.gitIndexLeaseParkPlan.v1',
      taskId: input.report.taskId,
      leaseId,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      status: 'not-needed',
      parkEntries: [],
      restoreEntries: [],
      approvedPartialStagedBlobIds: [],
      reason: 'Shared Git index already contains only expected close-bundle paths.'
    };
  }
  return {
    schemaId: 'atm.gitIndexLeaseParkPlan.v1',
    taskId: input.report.taskId,
    leaseId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: 'park-and-restore',
    parkEntries: foreignEntries,
    restoreEntries: foreignEntries,
    approvedPartialStagedBlobIds,
    reason: 'Foreign complete bundles can be parked from the live index and restored byte-identically after close-bundle assembly.'
  };
}

export function parkGitIndexLease(cwd: string, plan: GitIndexLeaseParkPlan): readonly string[] {
  if (plan.status !== 'park-and-restore' || plan.parkEntries.length === 0) {
    return [];
  }
  const paths = plan.parkEntries.map((entry) => entry.path);
  execFileSync('git', ['restore', '--staged', '--', ...paths], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return paths;
}

export function restoreGitIndexLease(cwd: string, plan: GitIndexLeaseParkPlan): readonly string[] {
  if (plan.status !== 'park-and-restore' || plan.restoreEntries.length === 0) {
    return [];
  }
  const restored: string[] = [];
  for (const entry of plan.restoreEntries) {
    if (!entry.stagedMode || !entry.stagedBlobId) continue;
    execFileSync('git', ['update-index', '--add', '--cacheinfo', `${entry.stagedMode},${entry.stagedBlobId},${entry.path}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    restored.push(entry.path);
  }
  return uniqueSorted(restored);
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

function shortDigest(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
