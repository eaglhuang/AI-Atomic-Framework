import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  attachSharedWriteActorAuthority,
  buildCommandManifest,
  buildOrderedCommandStep,
  renderCommandManifest,
  type OrderedCommandManifestStep
} from '../shared/command-manifest.ts';
import {
  buildSharedWriteActorRecoveryCommand,
  explicitActorIdEnvVar,
  legacyActorIdEnvVar,
  mintFrameworkTempTaskId,
  resolveSharedWriteActorAuthority,
  sanitizeIdentityValue,
  type SharedWriteActorAuthority
} from '../shared/identity-normalization.ts';

export type RunnerSyncAdmissionReport = {
  readonly schemaId: 'atm.runnerSyncAdmission.v1';
  readonly ok: boolean;
  readonly stewardActorId: string;
  readonly sealedSourceSha: string | null;
  readonly actorAuthority: SharedWriteActorAuthority;
  readonly runnerSyncSteward: {
    readonly stewardWorkId: string;
    readonly queuePosition: number;
    readonly suggestedNextAction: string;
    readonly requestedSurfaces: readonly string[];
    readonly waitingTasks: readonly string[];
    readonly requests: readonly RunnerSyncAdmissionStewardRequest[];
  } | null;
  readonly queueHeadOwnership: {
    readonly ok: boolean;
    readonly stewardWorkId: string | null;
    readonly queuePosition: number | null;
    readonly queueHeadHealth: 'task-active' | 'task-missing' | 'task-terminal';
    readonly waitingTasks: readonly string[];
    readonly ownerActorIds: readonly string[];
    readonly reason: string | null;
    readonly cleanupCommand: string | null;
  };
  readonly foreignNonReleaseWip: readonly string[];
  readonly foreignBuildInputConflicts: readonly RunnerSyncForeignBuildInputConflict[];
  readonly releaseWip: readonly string[];
  readonly ordinaryTaskReleaseAutoStageAllowed: false;
  readonly brokerTicket: RunnerSyncAdmissionBrokerTicket | null;
  readonly requiredCommand: string | null;
  readonly orderedCommandManifests?: readonly OrderedCommandManifestStep[];
};

export type RunnerSyncAdmissionBrokerTicket = {
  readonly schemaId: 'atm.brokerTicket.v1';
  readonly ticketId: string;
  readonly position: number;
  readonly headOwner: string | null;
  readonly headHealth: 'task-active' | 'task-missing' | 'task-terminal';
  readonly batchEligible: boolean;
  readonly enqueuedAt: string;
  readonly waitedMs: number;
  readonly sharedSurface: string;
  readonly scopeClass: readonly string[];
};

export type RunnerSyncAdmissionStewardRequest = {
  readonly taskId: string;
  readonly actorId: string;
  readonly requestedSurfaces: readonly string[];
};

export type RunnerSyncForeignBuildInputConflict = {
  readonly blockingTaskId: string;
  readonly blockingActorId: string | null;
  readonly blockingLaneSessionId: string | null;
  readonly heartbeatAt: string | null;
  readonly intersectingFiles: readonly string[];
  readonly dirtyIntersectingFiles: readonly string[];
  readonly landedIntersectingFiles: readonly string[];
  readonly reasonCode: 'landed-not-closed-build-input-risk';
};

export function inspectRunnerSyncAdmission(input: {
  readonly cwd: string;
  readonly stewardActorId: string;
  readonly sealedSourceSha?: string | null;
  readonly laneSessionId?: string | null;
  readonly actorIdentitySource?: string | null;
  readonly envActorId?: string | null;
  readonly legacyEnvActorId?: string | null;
  readonly runnerSyncSteward?: {
    readonly stewardWorkId: string;
    readonly queuePosition: number;
    readonly suggestedNextAction: string;
    readonly requestedSurfaces?: readonly string[];
    readonly waitingTasks?: readonly string[];
    readonly requests?: readonly RunnerSyncAdmissionStewardRequest[];
  } | null;
  readonly dirtyFiles?: readonly string[] | null;
  readonly foreignClaims?: readonly RunnerSyncForeignClaimInput[] | null;
  readonly landedFiles?: readonly string[] | null;
}): RunnerSyncAdmissionReport {
  const dirtyFiles = normalizePaths(input.dirtyFiles ?? readGitDirtyFiles(input.cwd));
  const releaseWip = dirtyFiles.filter(isReleasePath);
  const foreignClaims = input.foreignClaims ?? readActiveForeignClaims(input.cwd, input.stewardActorId);
  const foreignBuildInputConflicts = inspectForeignBuildInputConflicts({
    cwd: input.cwd,
    dirtyFiles,
    foreignClaims,
    landedFiles: input.landedFiles ?? null
  });
  const foreignNonReleaseWip = uniqueSorted(foreignBuildInputConflicts.flatMap((conflict) => conflict.intersectingFiles));
  const steward = normalizeInputRunnerSyncSteward(input.runnerSyncSteward) ?? readRunnerSyncStewardForSealedSource(input.cwd, input.sealedSourceSha);
  const queueHeadOwnership = inspectRunnerSyncQueueHeadOwnership(input, steward);
  const activeClaimOwnerActorId = resolveActiveClaimOwnerActorId(input.cwd);
  const laneSessionId = sanitizeIdentityValue(input.laneSessionId)
    ?? resolveActiveLaneSessionId(input.cwd, input.stewardActorId);
  const envActorId = sanitizeIdentityValue(input.envActorId)
    ?? sanitizeIdentityValue(process.env[explicitActorIdEnvVar]);
  const legacyEnvActorId = sanitizeIdentityValue(input.legacyEnvActorId)
    ?? sanitizeIdentityValue(process.env[legacyActorIdEnvVar]);
  const actorAuthority = resolveSharedWriteActorAuthority({
    explicitActorId: input.stewardActorId,
    envActorId,
    legacyEnvActorId,
    queueHeadOwnerActorIds: queueHeadOwnership.ownerActorIds,
    activeClaimOwnerActorId,
    laneSessionId,
    buildCommand: 'npm run build'
  });
  const continuityActorId = actorAuthority.ok
    ? (actorAuthority.actorId ?? input.stewardActorId)
    : (queueHeadOwnership.ownerActorIds[0] ?? actorAuthority.actorId ?? input.stewardActorId);
  const recoveryInput = {
    ...input,
    stewardActorId: continuityActorId,
    laneSessionId,
    actorAuthority
  };
  const brokerTicket = buildAdmissionBrokerTicket(input, queueHeadOwnership);
  const orderedCommandManifests = buildRunnerSyncRecoveryManifests(recoveryInput);
  const actorMismatch = Boolean(
    queueHeadOwnership.stewardWorkId
    && queueHeadOwnership.ownerActorIds.length > 0
    && !queueHeadOwnership.ownerActorIds.includes(input.stewardActorId)
  );
  const legacyHijack = Boolean(
    legacyEnvActorId
    && legacyEnvActorId === input.stewardActorId
    && envActorId
    && envActorId !== input.stewardActorId
  );
  const continuityBlocked = actorMismatch
    || legacyHijack
    || (actorAuthority.legacyEnvDisagrees
      && queueHeadOwnership.ownerActorIds.length > 0
      && !queueHeadOwnership.ownerActorIds.includes(input.stewardActorId));
  const requiredCommand = foreignNonReleaseWip.length > 0
    ? 'commit, stash, or close the foreign non-release WIP before runner sync; do not publish release/** from an ordinary task'
    : continuityBlocked
      ? (actorAuthority.recoveryCommand
        ?? buildSharedWriteActorRecoveryCommand({
          actorId: queueHeadOwnership.ownerActorIds[0] ?? envActorId ?? continuityActorId,
          buildCommand: 'npm run build'
        }))
      : queueHeadOwnership.ok
        ? null
        : queueHeadOwnership.stewardWorkId
          ? (queueHeadOwnership.cleanupCommand ?? queueHeadOwnership.reason)
          : buildRunnerSyncEnqueueCommand(recoveryInput);
  return {
    schemaId: 'atm.runnerSyncAdmission.v1',
    ok: foreignNonReleaseWip.length === 0 && queueHeadOwnership.ok && !continuityBlocked,
    stewardActorId: input.stewardActorId,
    sealedSourceSha: input.sealedSourceSha ?? null,
    actorAuthority,
    runnerSyncSteward: steward,
    queueHeadOwnership,
    foreignNonReleaseWip,
    foreignBuildInputConflicts,
    releaseWip,
    ordinaryTaskReleaseAutoStageAllowed: false,
    brokerTicket,
    orderedCommandManifests,
    requiredCommand
  };
}

function buildAdmissionBrokerTicket(
  input: Parameters<typeof inspectRunnerSyncAdmission>[0],
  ownership: RunnerSyncAdmissionReport['queueHeadOwnership']
): RunnerSyncAdmissionBrokerTicket | null {
  if (!ownership.stewardWorkId && !input.sealedSourceSha) return null;
  const now = new Date().toISOString();
  return {
    schemaId: 'atm.brokerTicket.v1',
    ticketId: ownership.stewardWorkId
      ? `${ownership.stewardWorkId}:${input.sealedSourceSha ?? 'unknown'}`
      : `runner-sync:${input.sealedSourceSha}`,
    position: ownership.queuePosition ?? 0,
    headOwner: ownership.waitingTasks[0] ?? null,
    headHealth: ownership.queueHeadHealth,
    batchEligible: false,
    enqueuedAt: now,
    waitedMs: 0,
    sharedSurface: 'runner-sync',
    scopeClass: ['code']
  };
}

function buildRunnerSyncEnqueueCommand(input: Parameters<typeof inspectRunnerSyncAdmission>[0]): string {
  const enqueue = buildRunnerSyncRecoveryManifests(input).find((entry) => entry.id === 'runner-sync-enqueue');
  return enqueue?.display ?? renderCommandManifest(buildRunnerSyncEnqueueManifest(input));
}

function inferRunnerSyncTaskId(input: { readonly stewardActorId: string }): string {
  return mintFrameworkTempTaskId(input.stewardActorId);
}

function quoteCliArg(value: string): string {
  return JSON.stringify(String(value ?? ''));
}

export function buildRunnerSyncRecoveryManifests(input: {
  readonly stewardActorId: string;
  readonly sealedSourceSha?: string | null;
  readonly laneSessionId?: string | null;
  readonly actorAuthority?: SharedWriteActorAuthority | null;
}): readonly OrderedCommandManifestStep[] {
  const resolutionSource = input.actorAuthority?.resolutionSource ?? 'steward-input';
  const laneSessionId = sanitizeIdentityValue(input.laneSessionId)
    ?? input.actorAuthority?.laneSessionId
    ?? null;
  const steps = [
    buildOrderedCommandStep('framework-temp-claim', buildCommandManifest({
      executable: 'node',
      argv: [
        'atm.mjs', 'framework-mode', 'claim',
        '--actor', input.stewardActorId,
        '--files', 'release/atm-onefile/atm.mjs,release/atm-root-drop',
        '--reason', `runner-sync steward reservation for ${input.sealedSourceSha ?? '<sha>'}`,
        '--json'
      ],
      envRefs: ['PATH'],
      timeoutMs: 120000,
      notes: 'claim release surfaces before runner-sync enqueue'
    })),
    buildOrderedCommandStep('runner-sync-enqueue', buildRunnerSyncEnqueueManifest(input)),
    buildOrderedCommandStep('runner-sync-build', buildCommandManifest({
      executable: 'npm',
      argv: ['run', 'build'],
      env: {
        ATM_ACTOR_ID: input.stewardActorId,
        ATM_RETAIN_RELEASE_ARTIFACTS: '1'
      },
      envRefs: ['PATH'],
      timeoutMs: 420000,
      notes: 'preserve queue-head steward actor through sealed runner build'
    }))
  ];
  return steps.map((step) => attachSharedWriteActorAuthority(step, {
    actorId: input.stewardActorId,
    resolutionSource: resolutionSource === 'insufficient' ? 'steward-input' : resolutionSource,
    laneSessionId,
    copyableCommand: step.display
  }));
}

function buildRunnerSyncEnqueueManifest(input: {
  readonly stewardActorId: string;
  readonly sealedSourceSha?: string | null;
}) {
  return buildCommandManifest({
    executable: 'node',
    argv: [
      'atm.mjs', 'broker', 'runner-sync', 'enqueue',
      '--task', inferRunnerSyncTaskId(input),
      '--actor', input.stewardActorId,
      '--sealed-source-sha', input.sealedSourceSha ?? '<sha>',
      '--surface', 'release/atm-onefile/atm.mjs',
      '--surface', 'release/atm-root-drop',
      '--json'
    ],
    envRefs: ['PATH'],
    timeoutMs: 120000,
    notes: 'enqueue shellless runner-sync steward reservation'
  });
}

export type RunnerSyncForeignClaimInput = {
  readonly taskId: string;
  readonly actorId?: string | null;
  readonly laneSessionId?: string | null;
  readonly heartbeatAt?: string | null;
  readonly claimedAt?: string | null;
  readonly files: readonly string[];
};

export function assertRunnerSyncAdmission(report: RunnerSyncAdmissionReport): void {
  if (!report.ok) {
    const reason = report.foreignNonReleaseWip.length > 0
      ? `Runner sync refused foreign non-release WIP: ${report.foreignNonReleaseWip.join(', ')}`
      : report.actorAuthority.ok === false && report.actorAuthority.reason
        ? report.actorAuthority.reason
      : report.queueHeadOwnership.reason ?? 'Runner sync requires steward queue-head ownership.';
    const recoveryCommand = report.requiredCommand
      ?? report.actorAuthority.recoveryCommand
      ?? null;
    const error = new Error(recoveryCommand ? `${reason} Recovery: ${recoveryCommand}` : reason);
    Object.assign(error, {
      code: report.foreignNonReleaseWip.length > 0
        ? 'ATM_RUNNER_SYNC_FOREIGN_WIP_BLOCKED'
        : report.actorAuthority.ok === false && report.queueHeadOwnership.ownerActorIds.length > 0
          ? 'ATM_RUNNER_SYNC_QUEUE_HEAD_REQUIRED'
        : report.queueHeadOwnership.queueHeadHealth !== 'task-active'
          ? 'ATM_RUNNER_SYNC_QUEUE_HEAD_ORPHANED'
        : 'ATM_RUNNER_SYNC_QUEUE_HEAD_REQUIRED',
      details: {
        ...report,
        recoveryCommand
      }
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

function uniqueSorted(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.map((entry) => entry.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function isReleasePath(file: string): boolean {
  return file === 'release' || file.startsWith('release/');
}

function isRunnerBuildInputPath(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized === 'package.json'
    || normalized === 'package-lock.json'
    || normalized === 'tsconfig.json'
    || normalized === 'tsconfig.build.json'
    || normalized.startsWith('packages/')
    || normalized.startsWith('scripts/');
}

function inspectForeignBuildInputConflicts(input: {
  readonly cwd: string;
  readonly dirtyFiles: readonly string[];
  readonly foreignClaims: readonly RunnerSyncForeignClaimInput[];
  readonly landedFiles: readonly string[] | null;
}): readonly RunnerSyncForeignBuildInputConflict[] {
  const dirtySet = new Set(input.dirtyFiles);
  const explicitLandedFiles = input.landedFiles === null ? null : new Set(normalizePaths(input.landedFiles));
  const conflicts: RunnerSyncForeignBuildInputConflict[] = [];
  for (const claim of input.foreignClaims) {
    const intersectingFiles = normalizePaths(claim.files).filter((file) => !isReleasePath(file) && isRunnerBuildInputPath(file));
    if (intersectingFiles.length === 0) continue;
    const landedIntersectingFiles = explicitLandedFiles
      ? intersectingFiles.filter((file) => explicitLandedFiles.has(file))
      : intersectingFiles.filter((file) => hasLandedSinceClaim(input.cwd, file, claim.claimedAt ?? null));
    if (landedIntersectingFiles.length === 0) continue;
    conflicts.push({
      blockingTaskId: claim.taskId,
      blockingActorId: claim.actorId ?? null,
      blockingLaneSessionId: claim.laneSessionId ?? null,
      heartbeatAt: claim.heartbeatAt ?? null,
      intersectingFiles,
      dirtyIntersectingFiles: intersectingFiles.filter((file) => dirtySet.has(file)),
      landedIntersectingFiles,
      reasonCode: 'landed-not-closed-build-input-risk'
    });
  }
  return conflicts;
}

function readActiveForeignClaims(cwd: string, stewardActorId: string): readonly RunnerSyncForeignClaimInput[] {
  const tasksDir = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(tasksDir)) return [];
  const claims: RunnerSyncForeignClaimInput[] = [];
  for (const entry of readdirSync(tasksDir)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const task = JSON.parse(readFileSync(path.join(tasksDir, entry), 'utf8')) as Record<string, unknown>;
      const claim = task.claim && typeof task.claim === 'object' ? task.claim as Record<string, unknown> : null;
      if (!claim || claim.state !== 'active') continue;
      const actorId = typeof claim.actorId === 'string' ? claim.actorId : null;
      if (actorId === stewardActorId) continue;
      const files = Array.isArray(claim.files) ? claim.files.map((file) => String(file)) : [];
      const laneSession = claim.laneSession && typeof claim.laneSession === 'object' ? claim.laneSession as Record<string, unknown> : null;
      claims.push({
        taskId: typeof task.workItemId === 'string' ? task.workItemId : entry.replace(/\.json$/, ''),
        actorId,
        laneSessionId: typeof laneSession?.laneSessionId === 'string' ? laneSession.laneSessionId : null,
        heartbeatAt: typeof claim.heartbeatAt === 'string' ? claim.heartbeatAt : null,
        claimedAt: typeof claim.claimedAt === 'string' ? claim.claimedAt : null,
        files
      });
    } catch {
      continue;
    }
  }
  return claims;
}

function hasLandedSinceClaim(cwd: string, file: string, claimedAt: string | null): boolean {
  const args = ['log', '--format=%H', '--', file];
  if (claimedAt) args.splice(1, 0, `--since=${claimedAt}`);
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (result.status !== 0 || result.error) return false;
  return result.stdout.trim().length > 0;
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
}, steward: RunnerSyncAdmissionReport['runnerSyncSteward']): RunnerSyncAdmissionReport['queueHeadOwnership'] {
  if (!steward) {
    return {
      ok: false,
      stewardWorkId: null,
      queuePosition: null,
      queueHeadHealth: 'task-active',
      waitingTasks: [],
      ownerActorIds: [],
      reason: 'runner sync requires a broker runner-sync queue-head reservation before build or internal-release sync',
      cleanupCommand: null
    };
  }
  const ownerActorIds = normalizeOwnerActorIds((steward as { requests?: unknown }).requests);
  const actorOwnsHead = ownerActorIds.length === 0 || ownerActorIds.includes(input.stewardActorId);
  const queueHeadHealth = resolveQueueHeadHealth(input.cwd, (steward as { requests?: unknown }).requests);
  const cleanupCommand = queueHeadHealth === 'task-active'
    ? null
    : 'node atm.mjs broker runner-sync cleanup --json';
  const ok = steward.queuePosition === 1 && actorOwnsHead && queueHeadHealth === 'task-active';
  return {
    ok,
    stewardWorkId: steward.stewardWorkId,
    queuePosition: steward.queuePosition,
    queueHeadHealth,
    waitingTasks: normalizeStringArray((steward as { waitingTasks?: unknown }).waitingTasks),
    ownerActorIds,
    reason: ok
      ? null
      : queueHeadHealth !== 'task-active'
        ? `runner sync steward ${steward.stewardWorkId} queue head is orphaned (${queueHeadHealth}); run ${cleanupCommand} before build or sync`
      : steward.queuePosition !== 1
        ? `runner sync steward ${steward.stewardWorkId} is queued at position ${steward.queuePosition}; wait for queue head before build or sync`
        : `runner sync steward ${steward.stewardWorkId} is owned by ${ownerActorIds.join(', ') || 'unknown actor'}, not ${input.stewardActorId}`,
    cleanupCommand
  };
}

function readRunnerSyncStewardForSealedSource(cwd: string, sealedSourceSha: string | null | undefined): ({
  readonly stewardWorkId: string;
  readonly queuePosition: number;
  readonly suggestedNextAction: string;
  readonly requestedSurfaces: readonly string[];
  readonly waitingTasks: readonly string[];
  readonly requests: readonly RunnerSyncAdmissionStewardRequest[];
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
        requestedSurfaces?: unknown;
        waitingTasks?: unknown;
        requests?: unknown;
      };
      if (record.sealedSourceSha !== sealedSource) continue;
      if (typeof record.stewardWorkId !== 'string' || typeof record.queuePosition !== 'number') return null;
      return {
        stewardWorkId: record.stewardWorkId,
        queuePosition: record.queuePosition,
        suggestedNextAction: typeof record.suggestedNextAction === 'string' ? record.suggestedNextAction : '',
        requestedSurfaces: normalizeStringArray(record.requestedSurfaces),
        waitingTasks: normalizeStringArray(record.waitingTasks),
        requests: normalizeStewardRequests(record.requests)
      };
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeInputRunnerSyncSteward(value: Parameters<typeof inspectRunnerSyncAdmission>[0]['runnerSyncSteward']): RunnerSyncAdmissionReport['runnerSyncSteward'] {
  if (!value) return null;
  return {
    stewardWorkId: value.stewardWorkId,
    queuePosition: value.queuePosition,
    suggestedNextAction: value.suggestedNextAction,
    requestedSurfaces: normalizeStringArray(value.requestedSurfaces),
    waitingTasks: normalizeStringArray(value.waitingTasks),
    requests: normalizeStewardRequests(value.requests)
  };
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

function normalizeStewardRequests(value: unknown): readonly RunnerSyncAdmissionStewardRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as { taskId?: unknown; actorId?: unknown; requestedSurfaces?: unknown };
    const taskId = String(record.taskId ?? '').trim();
    const actorId = String(record.actorId ?? '').trim();
    if (!taskId || !actorId) return [];
    return [{
      taskId,
      actorId,
      requestedSurfaces: normalizeStringArray(record.requestedSurfaces)
    }];
  });
}

function resolveActiveClaimOwnerActorId(cwd: string): string | null {
  const tasksDir = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(tasksDir)) return null;
  for (const entry of readdirSync(tasksDir)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const task = JSON.parse(readFileSync(path.join(tasksDir, entry), 'utf8')) as Record<string, unknown>;
      const claim = task.claim && typeof task.claim === 'object' ? task.claim as Record<string, unknown> : null;
      if (!claim || claim.state !== 'active') continue;
      const actorId = sanitizeIdentityValue(claim.actorId);
      if (actorId) return actorId;
    } catch {
      continue;
    }
  }
  return null;
}

function resolveActiveLaneSessionId(cwd: string, stewardActorId: string): string | null {
  const tasksDir = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(tasksDir)) return null;
  for (const entry of readdirSync(tasksDir)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const task = JSON.parse(readFileSync(path.join(tasksDir, entry), 'utf8')) as Record<string, unknown>;
      const claim = task.claim && typeof task.claim === 'object' ? task.claim as Record<string, unknown> : null;
      if (!claim || claim.state !== 'active') continue;
      if (sanitizeIdentityValue(claim.actorId) !== stewardActorId) continue;
      const laneSession = claim.laneSession && typeof claim.laneSession === 'object'
        ? claim.laneSession as Record<string, unknown>
        : null;
      const laneSessionId = sanitizeIdentityValue(laneSession?.laneSessionId);
      if (laneSessionId) return laneSessionId;
    } catch {
      continue;
    }
  }
  return null;
}

function resolveQueueHeadHealth(
  cwd: string,
  requests: unknown
): 'task-active' | 'task-missing' | 'task-terminal' {
  if (!Array.isArray(requests) || requests.length === 0) return 'task-active';
  const taskId = String((requests[0] as { taskId?: unknown })?.taskId ?? '').trim();
  if (!taskId) return 'task-active';
  const frameworkTempHealth = resolveFrameworkTempRunnerSyncTaskHealth(cwd, taskId);
  if (frameworkTempHealth) {
    return frameworkTempHealth;
  }
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) return 'task-missing';
  try {
    const task = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
    const status = typeof task.status === 'string' ? task.status.trim().toLowerCase() : '';
    return status === 'done' || status === 'verified' || status === 'abandoned'
      ? 'task-terminal'
      : 'task-active';
  } catch {
    return 'task-active';
  }
}

function resolveFrameworkTempRunnerSyncTaskHealth(
  cwd: string,
  taskId: string
): 'task-active' | 'task-missing' | 'task-terminal' | null {
  const normalizedTaskId = String(taskId ?? '').trim();
  if (!normalizedTaskId.startsWith('ATM-FRAMEWORK-TEMP-')) {
    return null;
  }
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${normalizedTaskId}.lock.json`);
  if (!existsSync(lockPath)) {
    return 'task-missing';
  }
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
    const workItemId = typeof lock.workItemId === 'string' ? lock.workItemId.trim() : '';
    const leaseId = typeof lock.leaseId === 'string' ? lock.leaseId.trim() : '';
    const heartbeatAt = typeof lock.heartbeatAt === 'string' ? lock.heartbeatAt : null;
    const released = lock.released === true || String(lock.status ?? '').trim().toLowerCase() === 'released';
    const ttlSeconds = typeof lock.ttlSeconds === 'number' && Number.isFinite(lock.ttlSeconds)
      ? lock.ttlSeconds
      : 0;
    if (workItemId !== normalizedTaskId || !leaseId || !heartbeatAt || ttlSeconds <= 0) {
      return 'task-missing';
    }
    return released ? 'task-terminal' : 'task-active';
  } catch {
    return 'task-missing';
  }
}
