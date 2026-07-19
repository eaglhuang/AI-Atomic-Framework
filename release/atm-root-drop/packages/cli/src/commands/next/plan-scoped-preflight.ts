import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { emitGateTelemetryEvent } from '../../../../core/src/telemetry/index.ts';
import { pathMatchesTaskScope, uniqueSorted } from '../git-governance/commit-scope-policy.ts';
import { readConfiguredPlanningRoots } from '../planning-repo-root.ts';
import { normalizeWorkPath } from './playbook-projection.ts';
import type { ClaimDirtyWipAdmission } from './foreign-dirty-wip-admission.ts';
import type { ImportedTaskSummary } from './route-predicates.ts';
import type { TaskIntent } from './intent-normalizers.ts';

export interface PlanScopedRoutingPreflight {
  readonly schemaId: 'atm.planScopedRoutingPreflight.v1';
  readonly taskId: string;
  readonly generatedAt: string;
  readonly plan: {
    readonly sourcePlanPath: string | null;
    readonly resolvedPath: string | null;
    readonly digest: string | null;
    readonly state: 'resolved' | 'missing' | 'unknown';
  };
  readonly routing: {
    readonly selectedTaskIds: readonly string[];
    readonly doneOrAbandonedSkipped: boolean;
    readonly recoveryCommand: string;
  };
  readonly identity: {
    readonly actorId: string;
    readonly laneSessionId: string | null;
    readonly readOnlyLanePresence: boolean;
  };
  readonly wip: {
    readonly classes: readonly PlanScopedWipClass[];
    readonly intersectingFiles: readonly string[];
    readonly recoveryCommand: string | null;
  };
  readonly telemetry: {
    readonly checkId: 'next.route-resolution';
    readonly result: 'pass' | 'block' | 'warn';
    readonly eventWritten: boolean;
    readonly warning: string | null;
  };
}

export type PlanScopedWipClass =
  | 'clean'
  | 'own-lane'
  | 'foreign-active'
  | 'unowned'
  | 'stale-generated-receipt'
  | 'unrelated-dirty'
  | 'observability-missing';

export function buildPlanScopedRoutingPreflight(input: {
  readonly cwd: string;
  readonly task: ImportedTaskSummary;
  readonly selectedTasks: readonly ImportedTaskSummary[];
  readonly taskIntent: TaskIntent | null;
  readonly actorId: string;
  readonly laneSessionId: string | null;
  readonly dirtyWipAdmission: ClaimDirtyWipAdmission;
  readonly command: string;
}): PlanScopedRoutingPreflight {
  const startedAt = Date.now();
  const plan = resolvePlanDigest(input.cwd, input.task.sourcePlanPath);
  const selectedTaskIds = uniqueSorted(input.selectedTasks.map((task) => task.workItemId));
  const classes = classifyWip(input);
  const result = input.dirtyWipAdmission.ok
    ? (classes.includes('observability-missing') ? 'warn' : 'pass')
    : 'block';
  const telemetry = emitGateTelemetryEvent(input.cwd, {
    gate: 'next',
    checkId: 'next.route-resolution',
    result,
    reasonClass: result === 'block' ? 'wip-intersection' : (plan.state === 'missing' ? 'plan-missing' : 'plan-scoped-route'),
    durationMs: Date.now() - startedAt,
    actorId: input.actorId,
    laneSessionId: input.laneSessionId,
    taskId: input.task.workItemId,
    command: input.command,
    inputDigest: digestJson({
      taskId: input.task.workItemId,
      sourcePlanPath: input.task.sourcePlanPath,
      selectedTaskIds,
      prompt: input.taskIntent?.userPrompt ?? null
    }),
    configDigest: digestJson({
      sourcePlanDigest: plan.digest,
      targetAllowedFiles: input.task.targetAllowedFiles
    }),
    source: 'runtime'
  });
  return {
    schemaId: 'atm.planScopedRoutingPreflight.v1',
    taskId: input.task.workItemId,
    generatedAt: new Date().toISOString(),
    plan,
    routing: {
      selectedTaskIds,
      doneOrAbandonedSkipped: input.selectedTasks.every((task) => task.workItemId !== input.task.workItemId || !isTerminalStatus(task.status)),
      recoveryCommand: `node atm.mjs next --prompt ${JSON.stringify(input.taskIntent?.userPrompt ?? input.task.workItemId)} --json`
    },
    identity: {
      actorId: input.actorId,
      laneSessionId: input.laneSessionId,
      readOnlyLanePresence: Boolean(input.laneSessionId)
    },
    wip: {
      classes,
      intersectingFiles: input.dirtyWipAdmission.intersectingFiles,
      recoveryCommand: input.dirtyWipAdmission.ok ? null : 'node atm.mjs tasks status --task <blocking-task-id> --json'
    },
    telemetry: {
      checkId: 'next.route-resolution',
      result,
      eventWritten: telemetry.ok,
      warning: telemetry.ok ? null : telemetry.warning
    }
  };
}

function classifyWip(input: {
  readonly cwd: string;
  readonly task: ImportedTaskSummary;
  readonly dirtyWipAdmission: ClaimDirtyWipAdmission;
}): readonly PlanScopedWipClass[] {
  const classes = new Set<PlanScopedWipClass>();
  if (input.dirtyWipAdmission.blockers.some((blocker) => blocker.ownership === 'foreign')) classes.add('foreign-active');
  if (input.dirtyWipAdmission.blockers.some((blocker) => blocker.ownership === 'unowned')) classes.add('unowned');
  const dirtyFiles = readGitDirtyFiles(input.cwd);
  const allowedFiles = input.task.targetAllowedFiles.length > 0 ? input.task.targetAllowedFiles : input.task.scopePaths;
  const intersecting = new Set(input.dirtyWipAdmission.intersectingFiles);
  for (const file of dirtyFiles) {
    if (intersecting.has(file)) continue;
    if (isStaleGeneratedReceipt(file)) {
      classes.add('stale-generated-receipt');
      continue;
    }
    const inScope = allowedFiles.some((scope) => pathMatchesTaskScope(file, scope) || pathMatchesTaskScope(scope, file));
    if (inScope) classes.add('own-lane');
    else classes.add('unrelated-dirty');
  }
  if (dirtyFiles.length === 0) classes.add('clean');
  if (classes.size === 0) classes.add('observability-missing');
  return [...classes].sort();
}

function resolvePlanDigest(cwd: string, sourcePlanPath: string | null): PlanScopedRoutingPreflight['plan'] {
  if (!sourcePlanPath) return { sourcePlanPath: null, resolvedPath: null, digest: null, state: 'unknown' };
  const configuredRoots = readConfiguredPlanningRoots(cwd);
  const envRoot = process.env.ATM_PLANNING_REPO_ROOT?.trim();
  const planningRoots = uniqueSorted([
    ...configuredRoots,
    ...(envRoot ? [envRoot] : [])
  ]);
  const candidates = [
    path.isAbsolute(sourcePlanPath) ? sourcePlanPath : path.resolve(cwd, sourcePlanPath),
    ...planningRoots.flatMap((root) => [
      path.resolve(root, sourcePlanPath),
      path.resolve(root, 'docs', 'ai_atomic_framework', sourcePlanPath.replace(/^docs\/ai_atomic_framework\//, ''))
    ])
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) return { sourcePlanPath, resolvedPath: null, digest: null, state: 'missing' };
  return {
    sourcePlanPath,
    resolvedPath: found.replace(/\\/g, '/'),
    digest: digestText(readFileSync(found, 'utf8')),
    state: 'resolved'
  };
}

function readGitDirtyFiles(cwd: string): readonly string[] {
  const collect = (args: readonly string[]) => {
    const result = spawnSync('git', args as string[], { cwd, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) return [] as string[];
    return result.stdout.split(/\r?\n/).map(normalizeWorkPath).filter(Boolean);
  };
  return uniqueSorted([
    ...collect(['diff', '--name-only', '--cached']),
    ...collect(['diff', '--name-only']),
    ...collect(['ls-files', '--others', '--exclude-standard'])
  ]);
}

function isStaleGeneratedReceipt(file: string): boolean {
  return /^\.atm\/history\/evidence\/[^/]+\.runner-sync-receipt\.json$/.test(file);
}

function isTerminalStatus(status: string): boolean {
  return /^(?:done|closed|abandoned|cancelled|blocked)$/i.test(status.trim());
}

function digestJson(value: unknown): string {
  return digestText(JSON.stringify(value));
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
