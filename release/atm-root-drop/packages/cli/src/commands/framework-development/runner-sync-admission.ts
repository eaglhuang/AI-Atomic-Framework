import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type RunnerSyncAdmissionReport = {
  readonly schemaId: 'atm.runnerSyncAdmission.v1';
  readonly ok: boolean;
  readonly stewardActorId: string;
  readonly sealedSourceSha: string | null;
  readonly runnerSyncSteward: {
    readonly stewardWorkId: string;
    readonly queuePosition: number;
    readonly suggestedNextAction: string;
  } | null;
  readonly queueHeadOwnership: {
    readonly ok: boolean;
    readonly stewardWorkId: string | null;
    readonly queuePosition: number | null;
    readonly waitingTasks: readonly string[];
    readonly ownerActorIds: readonly string[];
    readonly reason: string | null;
  };
  readonly foreignNonReleaseWip: readonly string[];
  readonly releaseWip: readonly string[];
  readonly ordinaryTaskReleaseAutoStageAllowed: false;
  readonly requiredCommand: string | null;
};

export function inspectRunnerSyncAdmission(input: {
  readonly cwd: string;
  readonly stewardActorId: string;
  readonly sealedSourceSha?: string | null;
  readonly runnerSyncSteward?: {
    readonly stewardWorkId: string;
    readonly queuePosition: number;
    readonly suggestedNextAction: string;
  } | null;
  readonly dirtyFiles?: readonly string[] | null;
}): RunnerSyncAdmissionReport {
  const dirtyFiles = normalizePaths(input.dirtyFiles ?? readGitDirtyFiles(input.cwd));
  const releaseWip = dirtyFiles.filter(isReleasePath);
  const foreignNonReleaseWip = dirtyFiles.filter((file) => !isReleasePath(file));
  const queueHeadOwnership = inspectRunnerSyncQueueHeadOwnership(input);
  return {
    schemaId: 'atm.runnerSyncAdmission.v1',
    ok: foreignNonReleaseWip.length === 0 && queueHeadOwnership.ok,
    stewardActorId: input.stewardActorId,
    sealedSourceSha: input.sealedSourceSha ?? null,
    runnerSyncSteward: input.runnerSyncSteward ?? null,
    queueHeadOwnership,
    foreignNonReleaseWip,
    releaseWip,
    ordinaryTaskReleaseAutoStageAllowed: false,
    requiredCommand: foreignNonReleaseWip.length > 0
      ? 'commit, stash, or close the foreign non-release WIP before runner sync; do not publish release/** from an ordinary task'
      : queueHeadOwnership.ok
        ? null
        : queueHeadOwnership.reason
  };
}

export function assertRunnerSyncAdmission(report: RunnerSyncAdmissionReport): void {
  if (!report.ok) {
    const reason = report.foreignNonReleaseWip.length > 0
      ? `Runner sync refused foreign non-release WIP: ${report.foreignNonReleaseWip.join(', ')}`
      : report.queueHeadOwnership.reason ?? 'Runner sync requires steward queue-head ownership.';
    const error = new Error(reason);
    Object.assign(error, {
      code: report.foreignNonReleaseWip.length > 0
        ? 'ATM_RUNNER_SYNC_FOREIGN_WIP_BLOCKED'
        : 'ATM_RUNNER_SYNC_QUEUE_HEAD_REQUIRED',
      details: report
    });
    throw error;
  }
}

export function ordinaryTaskCanAutoStageRelease(input: {
  readonly taskId: string;
  readonly files: readonly string[];
}): false {
  void input;
  return false;
}

function readGitDirtyFiles(cwd: string): readonly string[] {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0 || result.error) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.length >= 4 ? line.slice(3).trim() : '')
    .map((entry) => entry.includes(' -> ') ? entry.split(' -> ').at(-1) ?? entry : entry)
    .filter(Boolean);
}

function normalizePaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))].sort();
}

function isReleasePath(file: string): boolean {
  return file === 'release' || file.startsWith('release/');
}

function inspectRunnerSyncQueueHeadOwnership(input: {
  readonly cwd: string;
  readonly stewardActorId: string;
  readonly sealedSourceSha?: string | null;
  readonly runnerSyncSteward?: {
    readonly stewardWorkId: string;
    readonly queuePosition: number;
    readonly suggestedNextAction: string;
  } | null;
}): RunnerSyncAdmissionReport['queueHeadOwnership'] {
  const steward = input.runnerSyncSteward ?? readRunnerSyncStewardForSealedSource(input.cwd, input.sealedSourceSha);
  if (!steward) {
    return {
      ok: false,
      stewardWorkId: null,
      queuePosition: null,
      waitingTasks: [],
      ownerActorIds: [],
      reason: 'runner sync requires a broker runner-sync queue-head reservation before build or internal-release sync'
    };
  }
  const ownerActorIds = normalizeOwnerActorIds((steward as { requests?: unknown }).requests);
  const actorOwnsHead = ownerActorIds.length === 0 || ownerActorIds.includes(input.stewardActorId);
  const ok = steward.queuePosition === 1 && actorOwnsHead;
  return {
    ok,
    stewardWorkId: steward.stewardWorkId,
    queuePosition: steward.queuePosition,
    waitingTasks: normalizeStringArray((steward as { waitingTasks?: unknown }).waitingTasks),
    ownerActorIds,
    reason: ok
      ? null
      : steward.queuePosition !== 1
        ? `runner sync steward ${steward.stewardWorkId} is queued at position ${steward.queuePosition}; wait for queue head before build or sync`
        : `runner sync steward ${steward.stewardWorkId} is owned by ${ownerActorIds.join(', ') || 'unknown actor'}, not ${input.stewardActorId}`
  };
}

function readRunnerSyncStewardForSealedSource(cwd: string, sealedSourceSha: string | null | undefined): ({
  readonly stewardWorkId: string;
  readonly queuePosition: number;
  readonly suggestedNextAction: string;
  readonly waitingTasks?: unknown;
  readonly requests?: unknown;
} | null) {
  const sealedSource = String(sealedSourceSha ?? '').trim();
  if (!sealedSource) return null;
  const queuePath = path.join(cwd, '.atm', 'runtime', 'runner-sync-steward-queue.json');
  if (!existsSync(queuePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(queuePath, 'utf8')) as { groups?: unknown };
    const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
    for (const group of groups) {
      if (!group || typeof group !== 'object') continue;
      const record = group as {
        sealedSourceSha?: unknown;
        stewardWorkId?: unknown;
        queuePosition?: unknown;
        suggestedNextAction?: unknown;
        waitingTasks?: unknown;
        requests?: unknown;
      };
      if (record.sealedSourceSha !== sealedSource) continue;
      if (typeof record.stewardWorkId !== 'string' || typeof record.queuePosition !== 'number') return null;
      return {
        stewardWorkId: record.stewardWorkId,
        queuePosition: record.queuePosition,
        suggestedNextAction: typeof record.suggestedNextAction === 'string' ? record.suggestedNextAction : '',
        waitingTasks: record.waitingTasks,
        requests: record.requests
      };
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeOwnerActorIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((entry) => entry && typeof entry === 'object' ? String((entry as { actorId?: unknown }).actorId ?? '').trim() : '')
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}
