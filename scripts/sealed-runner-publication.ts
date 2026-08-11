import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
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
  const beforeBuildSnapshot = captureRunnerBuildOutputSnapshot({
    cwd: input.cwd,
    buildTarget: input.buildTarget,
    currentTaskId,
    currentTaskAllowedFiles: currentTask?.allowedFiles
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
}): RunnerSyncAdmissionReport {
  const inspect = () => inspectRunnerSyncAdmission({
    cwd: input.cwd,
    stewardActorId: input.stewardActorId,
    sealedSourceSha: input.sealedSourceSha
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
    now: new Date().toISOString()
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
}): string {
  const lockRoot = path.join(input.cwd, '.atm', 'runtime', 'locks');
  const nowMs = Date.parse(input.now);
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
        const active = Number.isFinite(nowMs)
          && Number.isFinite(heartbeatAt)
          && Number.isFinite(ttlSeconds)
          && nowMs < heartbeatAt + ttlSeconds * 1000;
        return taskId.startsWith('ATM-FRAMEWORK-TEMP-')
          && actorId === input.actorId
          && active
          && files.some((file) => file === 'release/atm-onefile/atm.mjs' || file === 'release/atm-root-drop')
          ? [taskId]
          : [];
      } catch {
        return [];
      }
    })
    : [];
  const unique = [...new Set(candidates)].sort();
  if (unique.length !== 1) {
    throw new Error(`Runner publication requires exactly one active framework release claim for ${input.actorId}; found ${unique.length}.`);
  }
  return unique[0];
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
