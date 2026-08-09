import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listActorWorkSessions } from './actor-session.ts';
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
  readonly ownerSessionId: string | null;
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
    readonly ownerSessionId: string | null;
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

export interface GitIndexOverrideLeaseEntry {
  readonly path: string;
  readonly stagedBlobId: string;
  readonly stagedMode: string;
}

export interface GitIndexOverrideLease {
  readonly schemaId: 'atm.gitIndexOverrideLease.v1';
  readonly leaseId: string;
  readonly kind: 'stage-override' | string;
  readonly permission: string;
  readonly actorId: string;
  readonly taskId: string;
  readonly paths: readonly string[];
  readonly stagedEntries: readonly GitIndexOverrideLeaseEntry[];
  readonly singleUse: boolean;
  readonly used: boolean;
  readonly expiresAt: string;
}

export type GitIndexOverrideLeaseAuthorization =
  | { readonly ok: true; readonly lease: GitIndexOverrideLease; readonly plan: GitIndexLeaseParkPlan }
  | { readonly ok: false; readonly code: string; readonly summary: string };

export const ATM_INDEX_FOREIGN_ACTIVE_STAGED = 'ATM_INDEX_FOREIGN_ACTIVE_STAGED';

/**
 * Validates the capability against the live index before any foreign entry is
 * parked.  The lease is intentionally content-bound: a path-only approval is
 * not enough to move a later, different staged blob.
 */
export function authorizeGitIndexOverrideLease(input: {
  readonly cwd: string;
  readonly leaseId: string | null | undefined;
  readonly actorId: string;
  readonly taskId: string;
  readonly report: GitIndexOwnershipReport;
}): GitIndexOverrideLeaseAuthorization {
  const leaseId = String(input.leaseId ?? '').trim();
  if (!leaseId) {
    return { ok: false, code: 'ATM_GIT_INDEX_OVERRIDE_LEASE_REQUIRED', summary: 'Foreign protected staged entries require an explicit --stage-override-lease.' };
  }
  const leasePath = path.join(input.cwd, '.atm', 'runtime', 'git-index-leases', `${leaseId}.json`);
  if (!existsSync(leasePath)) {
    return { ok: false, code: 'ATM_GIT_INDEX_OVERRIDE_LEASE_NOT_FOUND', summary: `Stage override lease ${leaseId} was not found.` };
  }
  let lease: GitIndexOverrideLease;
  try {
    lease = JSON.parse(readFileSync(leasePath, 'utf8')) as GitIndexOverrideLease;
  } catch {
    return { ok: false, code: 'ATM_GIT_INDEX_OVERRIDE_LEASE_INVALID', summary: `Stage override lease ${leaseId} is not valid JSON.` };
  }
  if (lease.schemaId !== 'atm.gitIndexOverrideLease.v1' || lease.kind !== 'stage-override' || lease.permission !== 'git.index.stageOverride') {
    return { ok: false, code: 'ATM_GIT_INDEX_OVERRIDE_LEASE_INVALID', summary: `Stage override lease ${leaseId} has the wrong authority shape.` };
  }
  if (lease.actorId !== input.actorId || normalizeTaskId(lease.taskId) !== normalizeTaskId(input.taskId)) {
    return { ok: false, code: 'ATM_GIT_INDEX_OVERRIDE_LEASE_OWNER_MISMATCH', summary: `Stage override lease ${leaseId} does not belong to this actor and task.` };
  }
  if (lease.singleUse && lease.used) {
    return { ok: false, code: 'ATM_GIT_INDEX_OVERRIDE_LEASE_ALREADY_USED', summary: `Stage override lease ${leaseId} is single-use and has already been consumed.` };
  }
  if (!Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= Date.now()) {
    return { ok: false, code: 'ATM_GIT_INDEX_OVERRIDE_LEASE_EXPIRED', summary: `Stage override lease ${leaseId} has expired.` };
  }
  // A released task's staged governance bundle remains protected until its
  // owner commits or explicitly discards it. The capability is content-bound,
  // so active and released foreign entries share the same authorization rule.
  const liveEntries = input.report.entries.filter((entry) =>
    entry.ownership === 'foreign-active-owned'
    || entry.ownership === 'foreign-released-or-abandoned'
  );
  const expected = uniqueSorted((lease.stagedEntries ?? []).map((entry) => `${entry.stagedMode}:${entry.stagedBlobId}:${entry.path}`));
  const actual = uniqueSorted(liveEntries.map((entry) => `${entry.stagedMode ?? 'missing'}:${entry.stagedBlobId ?? 'missing'}:${entry.path}`));
  const paths = uniqueSorted(lease.paths ?? []);
  if (expected.length === 0 || JSON.stringify(expected) !== JSON.stringify(actual) || JSON.stringify(paths) !== JSON.stringify(uniqueSorted(liveEntries.map((entry) => entry.path)))) {
    return { ok: false, code: 'ATM_GIT_INDEX_OVERRIDE_LEASE_INDEX_DRIFT', summary: `Stage override lease ${leaseId} does not exactly match the live foreign staged entries.` };
  }
  const plan = buildGitIndexLeaseParkPlan({ report: input.report, expectedStageFiles: [], leaseId });
  return {
    ok: true,
    lease,
    plan: { ...plan, status: liveEntries.length === 0 ? 'not-needed' : 'park-and-restore', reason: 'Validated stage-override lease authorizes byte-identical park and restore of the current foreign staged entries.' }
  };
}

export function consumeGitIndexOverrideLease(cwd: string, lease: GitIndexOverrideLease): void {
  const leasePath = path.join(cwd, '.atm', 'runtime', 'git-index-leases', `${lease.leaseId}.json`);
  writeFileSync(leasePath, `${JSON.stringify({ ...lease, used: true, usedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
}

export function inspectGitIndexOwnership(input: {
  readonly cwd: string;
  readonly taskId?: string | null;
  readonly stagedFiles?: readonly string[] | null;
}): GitIndexOwnershipReport {
  const currentTaskId = normalizeTaskId(input.taskId ?? null);
  const stagedFiles = uniqueSorted(input.stagedFiles ?? readStagedFiles(input.cwd));
  const stagedBlobs = readStagedBlobMap(input.cwd, stagedFiles);
  const activeLocks = readActiveTaskDirectionLocks(input.cwd);
  const sessionsByTaskActor = readActiveSessionMap(input.cwd);
  const entries = stagedFiles.map((filePath): GitIndexOwnershipEntry => {
    const governanceTaskId = extractGovernanceTaskId(filePath);
    const lockOwner = activeLocks.find((lock) => isPathAllowedByScope(filePath, lock.allowedFiles)) ?? null;
    // Shared evidence (for example git-head.jsonl) is not task-named.  Its
    // active direction lock is the authoritative owner, rather than the
    // filename prefix that happens to precede the first dot.
    const ownerTaskId = lockOwner?.taskId ?? governanceTaskId ?? null;
    const ownerActorId = lockOwner?.actorId ?? null;
    const ownerSessionId = lockOwner?.sessionId ?? resolveOwnerSessionId(sessionsByTaskActor, ownerTaskId, ownerActorId);
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
        ownerSessionId,
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
        ownerSessionId: null,
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
      ownerSessionId: null,
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
    ownerSessionIds: uniqueSorted(report.foreignActiveStaged.map((entry) => entry.ownerSessionId ?? '').filter(Boolean)),
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
      ownerSessionId: null,
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
      ownerSessionId: owner.ownerSessionId,
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
      ownerSessionId: currentOwned[0]?.ownerSessionId ?? null,
      reason: `The shared Git index currently belongs to ${currentTaskId ?? 'the current task'}.`
    };
  }
  if (entries.some((entry) => entry.ownership === 'unknown-governance-artifact')) {
    return {
      schemaId: 'atm.gitIndexLane.v1',
      status: 'requires-staging-steward',
      ownerTaskId: null,
      ownerActorId: null,
      ownerSessionId: null,
      reason: 'The shared Git index contains governance artifacts whose owner cannot be resolved.'
    };
  }
  return {
    schemaId: 'atm.gitIndexLane.v1',
    status: 'queued',
    ownerTaskId: null,
    ownerActorId: null,
    ownerSessionId: null,
    reason: 'The shared Git index contains staged files but no current-task ownership proof.'
  };
}

function readActiveSessionMap(cwd: string): Map<string, string> {
  const sessions = new Map<string, string>();
  for (const session of listActorWorkSessions(cwd)) {
    if (session.status !== 'active') continue;
    sessions.set(sessionKey(session.taskId, session.actorId), session.sessionId);
  }
  return sessions;
}

function resolveOwnerSessionId(sessionsByTaskActor: ReadonlyMap<string, string>, ownerTaskId: string | null, ownerActorId: string | null): string | null {
  if (!ownerTaskId || !ownerActorId) return null;
  return sessionsByTaskActor.get(sessionKey(ownerTaskId, ownerActorId)) ?? null;
}

function sessionKey(taskId: string, actorId: string): string {
  return `${normalizeTaskId(taskId) ?? taskId}::${actorId}`;
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
  if (normalized.toLowerCase() === '.atm/history/evidence/git-head.jsonl') return null;
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
