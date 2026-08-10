import { existsSync, readFileSync } from 'node:fs';
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
  const admission = inspectRunnerSyncAdmission({
    cwd: input.cwd,
    stewardActorId: input.stewardActorId,
    sealedSourceSha: input.sealedSourceSha
  });
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
