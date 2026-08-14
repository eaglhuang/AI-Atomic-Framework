import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathMatchesWriteScope } from '../packages/core/src/broker/write-scope-policy.ts';
import { readFrameworkTempLockProjection } from '../packages/cli/src/commands/framework-development/framework-temp-lock-projection.ts';
import {
  assertRunnerSyncAdmission,
  inspectRunnerSyncAdmission,
  type RunnerSyncAdmissionReport
} from '../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import {
  captureRunnerBuildOutputSnapshot,
  validateRunnerPublicationTakeoverPlan,
  type RunnerBuildOutputTarget
} from '../packages/core/src/broker/runner-build-output-inventory.ts';
import { getActiveTasks } from '../packages/core/src/broker/cross-task-mutation-guard.ts';

/**
 * The narrow publication boundary for a sealed candidate. Candidate compilation
 * occurs elsewhere; this module performs the queue-head revalidation and
 * captures the root snapshot immediately before the shared write.
 */
export function resolveSealedRunnerPublication(input: {
  readonly cwd: string;
  readonly stewardActorId: string;
  readonly sealedSourceSha: string;
  readonly buildTarget: RunnerBuildOutputTarget;
  readonly publicationTaskId?: string | null;
  readonly beforeBuildSnapshot?: ReturnType<typeof captureRunnerBuildOutputSnapshot>;
}): {
  readonly admission: RunnerSyncAdmissionReport;
  readonly currentTaskId: string | null;
  readonly beforeBuildSnapshot: ReturnType<typeof captureRunnerBuildOutputSnapshot>;
  readonly takeoverPaths: readonly string[];
} {
  const admission = ensureRunnerPublicationReservation(input);
  assertRunnerSyncAdmission(admission);
  const currentTaskId = admission.queueHeadOwnership.waitingTasks[0] ?? null;
  const currentTask = currentTaskId
    ? getActiveTasks(input.cwd).find((entry) => entry.taskId === currentTaskId.toUpperCase())
    : null;
  const currentTaskAllowedFiles = currentTask?.allowedFiles
    ?? readActivePublicationLockFiles({
      cwd: input.cwd,
      taskId: currentTaskId,
      actorId: input.stewardActorId,
      now: new Date().toISOString()
    });
  const beforeBuildSnapshot = input.beforeBuildSnapshot ?? captureRunnerBuildOutputSnapshot({
    cwd: input.cwd,
    buildTarget: input.buildTarget,
    currentTaskId,
    currentTaskAllowedFiles
  });
  return {
    admission,
    currentTaskId,
    beforeBuildSnapshot,
    takeoverPaths: readValidatedPublicationTakeover({
      cwd: input.cwd,
      taskId: currentTaskId,
      sealedSourceSha: input.sealedSourceSha,
      snapshot: beforeBuildSnapshot
    })
  };
}

/**
 * Capture the live publication surface before private candidate generation.
 * This deliberately resolves the same task authority as the later publication
 * boundary without acquiring the queue; it keeps queue residency minimal while
 * making a digest-bound takeover receipt stable across the private build.
 */
export function captureSealedRunnerPublicationSnapshot(input: {
  readonly cwd: string;
  readonly stewardActorId: string;
  readonly buildTarget: RunnerBuildOutputTarget;
  readonly publicationTaskId?: string | null;
}): ReturnType<typeof captureRunnerBuildOutputSnapshot> {
  const currentTaskId = resolveActiveRunnerPublicationTask({
    cwd: input.cwd,
    actorId: input.stewardActorId,
    now: new Date().toISOString(),
    taskId: input.publicationTaskId
  });
  const currentTask = getActiveTasks(input.cwd).find((entry) => entry.taskId === currentTaskId.toUpperCase());
  const currentTaskAllowedFiles = currentTask?.allowedFiles
    ?? readActivePublicationLockFiles({
      cwd: input.cwd,
      taskId: currentTaskId,
      actorId: input.stewardActorId,
      now: new Date().toISOString()
    });
  return captureRunnerBuildOutputSnapshot({
    cwd: input.cwd,
    buildTarget: input.buildTarget,
    currentTaskId,
    currentTaskAllowedFiles
  });
}

/**
 * Framework-temporary publication authority is intentionally lock-backed and
 * has no task-ledger row. The takeover producer and publication consumer must
 * therefore resolve the same active lock, or their snapshot digests diverge.
 */
export function readActivePublicationLockFiles(input: {
  readonly cwd: string;
  readonly taskId: string | null;
  readonly actorId: string;
  readonly now: string;
}): readonly string[] | undefined {
  if (!input.taskId) return undefined;
  const lockPath = path.join(input.cwd, '.atm', 'runtime', 'locks', `${input.taskId}.lock.json`);
  if (!existsSync(lockPath)) return undefined;
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
    const lockTaskId = String(lock.workItemId ?? '').trim();
    const lockActorId = String(lock.actorId ?? lock.lockedBy ?? '').trim();
    const heartbeatAt = Date.parse(String(lock.heartbeatAt ?? lock.lockedAt ?? ''));
    const ttlSeconds = Number(lock.ttlSeconds ?? 0);
    const nowMs = Date.parse(input.now);
    const active = lock.released !== true
      && String(lock.status ?? '').trim().toLowerCase() !== 'released'
      && lockTaskId === input.taskId
      && lockActorId === input.actorId
      && Number.isFinite(nowMs)
      && Number.isFinite(heartbeatAt)
      && Number.isFinite(ttlSeconds)
      && ttlSeconds > 0
      && nowMs < heartbeatAt + ttlSeconds * 1000;
    return active && Array.isArray(lock.files) ? lock.files.map(String) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Acquire the runner-sync mutex at the publication boundary, after the sealed
 * candidate has been built.  Framework claims declare ownership; they must not
 * force callers to reserve the globally serialized publication queue while a
 * detached, private build is still running.
 */
export function ensureRunnerPublicationReservation(input: {
  readonly cwd: string;
  readonly stewardActorId: string;
  readonly sealedSourceSha: string;
  readonly buildTarget: RunnerBuildOutputTarget;
  readonly publicationTaskId?: string | null;
}): RunnerSyncAdmissionReport {
  const inspect = () => inspectRunnerSyncAdmission({
    cwd: input.cwd,
    stewardActorId: input.stewardActorId,
    sealedSourceSha: input.sealedSourceSha,
    candidateSourceIsolation: 'sealed-detached'
  });
  const initial = inspect();
  if (initial.queueHeadOwnership.ok) return initial;
  if (initial.runnerSyncSteward) {
    runAtm(input.cwd, [
      'broker', 'runner-sync', 'cleanup',
      '--actor', input.stewardActorId,
      '--json'
    ], 'Runner publication stale-queue reconciliation');
    const reconciled = inspect();
    if (reconciled.queueHeadOwnership.ok || reconciled.runnerSyncSteward) return reconciled;
  }

  const taskId = resolveActiveRunnerPublicationTask({
    cwd: input.cwd,
    actorId: input.stewardActorId,
    now: new Date().toISOString(),
    taskId: input.publicationTaskId
  });
  const surfaces = publicationSurfaces(input.buildTarget);
  runAtm(input.cwd, [
    'broker', 'runner-sync', 'enqueue',
    '--task', taskId,
    '--actor', input.stewardActorId,
    '--sealed-source-sha', input.sealedSourceSha,
    ...surfaces.flatMap((surface) => ['--surface', surface]),
    '--json'
  ], 'Runner publication queue acquisition');
  return inspect();
}

function runAtm(cwd: string, argv: readonly string[], operation: string): void {
  const result = spawnSync(process.execPath, [path.join(cwd, 'atm.mjs'), ...argv], {
    cwd,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if ((result.status ?? 1) !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new Error(`${operation} failed: ${detail || `exit ${result.status ?? 1}`}`);
  }
}

export function resolveActiveRunnerPublicationTask(input: {
  readonly cwd: string;
  readonly actorId: string;
  readonly now: string;
  readonly taskId?: string | null;
}): string {
  const lockRoot = path.join(input.cwd, '.atm', 'runtime', 'locks');
  const nowMs = Date.parse(input.now);
  const explicitlyRequested = input.taskId?.trim();
  const frameworkTempCandidates = readFrameworkTempLockProjection(input.cwd, nowMs)
    .filter((lock) => lock.workItemId.startsWith('ATM-FRAMEWORK-TEMP-'))
    .filter((lock) => lock.actorId === input.actorId && lock.disposition === 'foreign-live')
    .filter((lock) => !explicitlyRequested || lock.workItemId === explicitlyRequested)
    .filter((lock) => ownsReleaseSurface(lock.files))
    .map((lock) => lock.workItemId);
  const candidates = existsSync(lockRoot)
    ? readdirSync(lockRoot, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.lock.json')) return [];
      try {
        const lock = JSON.parse(readFileSync(path.join(lockRoot, entry.name), 'utf8')) as Record<string, unknown>;
        const taskId = String(lock.workItemId ?? '');
        const actorId = String(lock.actorId ?? lock.lockedBy ?? '');
        const heartbeatAt = Date.parse(String(lock.heartbeatAt ?? lock.lockedAt ?? ''));
        const ttlSeconds = Number(lock.ttlSeconds ?? 0);
        const files = Array.isArray(lock.files) ? lock.files.map(String) : [];
        const lockActive = Number.isFinite(nowMs)
          && Number.isFinite(heartbeatAt)
          && Number.isFinite(ttlSeconds)
          && nowMs < heartbeatAt + ttlSeconds * 1000;
        return actorId === input.actorId
          && !taskId.startsWith('ATM-FRAMEWORK-TEMP-')
          && (explicitlyRequested ? hasActiveLedgerClaim(input.cwd, taskId, input.actorId, nowMs) : lockActive)
          && (explicitlyRequested
            ? taskId === explicitlyRequested
            : ownsReleaseSurface(files))
          ? [taskId]
          : [];
      } catch {
        return [];
      }
    })
    : [];
  const unique = [...new Set([...candidates, ...frameworkTempCandidates])].sort();
  if (unique.length !== 1) {
    throw new Error(`Runner publication requires exactly one active release-surface claim for ${input.actorId}; found ${unique.length}.`);
  }
  return unique[0];
}

function ownsReleaseSurface(files: readonly string[]): boolean {
  return ['release/atm-onefile/atm.mjs', 'release/atm-root-drop']
    .some((surface) => files.some((file) => pathMatchesWriteScope(surface, file)));
}

function hasActiveLedgerClaim(cwd: string, taskId: string, actorId: string, nowMs: number): boolean {
  try {
    const task = JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), 'utf8')) as { claim?: Record<string, unknown> };
    const claim = task.claim;
    const heartbeatAt = Date.parse(String(claim?.heartbeatAt ?? claim?.claimedAt ?? ''));
    const ttlSeconds = Number(claim?.ttlSeconds ?? 0);
    return claim?.state === 'active' && claim.actorId === actorId && Number.isFinite(nowMs) && Number.isFinite(heartbeatAt) && Number.isFinite(ttlSeconds) && nowMs < heartbeatAt + ttlSeconds * 1000;
  } catch { return false; }
}

function publicationSurfaces(buildTarget: RunnerBuildOutputTarget): readonly string[] {
  if (buildTarget === 'onefile') return ['release/atm-onefile/atm.mjs'];
  if (buildTarget === 'root-drop') return ['release/atm-root-drop'];
  return ['release/atm-onefile/atm.mjs', 'release/atm-root-drop'];
}

function readValidatedPublicationTakeover(input: {
  readonly cwd: string;
  readonly taskId: string | null;
  readonly sealedSourceSha: string;
  readonly snapshot: ReturnType<typeof captureRunnerBuildOutputSnapshot>;
}): readonly string[] {
  if (!input.taskId || input.snapshot.preexistingDirtyPaths.length === 0) return [];
  const relative = `.atm/history/evidence/${input.taskId}.runner-publication-takeover.json`;
  const absolute = path.join(input.cwd, relative);
  if (!existsSync(absolute)) return [];
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(absolute, 'utf8'));
  } catch {
    throw new Error(`Runner publication takeover receipt is not valid JSON: ${relative}`);
  }
  const validated = validateRunnerPublicationTakeoverPlan({
    plan: document,
    sealedSourceSha: input.sealedSourceSha,
    snapshot: input.snapshot
  });
  if (!validated.ok || !validated.plan) {
    throw new Error(`Runner publication takeover receipt is invalid: ${validated.reason ?? relative}`);
  }
  return validated.plan.entries.map((entry) => entry.path);
}
