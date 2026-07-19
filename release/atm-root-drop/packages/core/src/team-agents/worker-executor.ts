import { effectiveExecutionState, validateWorkerReport, type TeamWorkerReport } from '../broker/team-worker-report.ts';
import type { WaveManifest } from '../broker/wave-manifest.ts';

export type TeamWorkerExecutorResultState =
  | 'executing'
  | 'ready-for-write'
  | 'needs-review'
  | 'serial-fallback';

export type TeamWorkerLifecycleEventKind =
  | 'worker.start'
  | 'worker.heartbeat'
  | 'worker.report'
  | 'worker.retry'
  | 'worker.defer'
  | 'worker.needs-review';

export interface TeamWorkerExecutionLane {
  readonly taskId: string;
  readonly laneSessionId: string;
  readonly workerCanCommitOrClose: false;
  readonly allowedReturnSchemas: readonly ['atm.patchEnvelope.v1', 'atm.teamWorkerReport.v1'];
  readonly heartbeat: {
    readonly status: 'started' | 'reported' | 'missing-report';
    readonly startedAt: string;
    readonly heartbeatAt: string;
    readonly reportId: string | null;
    readonly tokenUsageSource: 'provider' | 'editor' | 'manual' | 'unavailable';
  };
  readonly lifecycleEvents: readonly TeamWorkerLifecycleEventKind[];
}

export interface TeamWorkerOutOfScopeFinding {
  readonly taskId: string;
  readonly files: readonly string[];
}

export interface TeamWorkerExecutorTelemetrySummary {
  readonly schemaId: 'atm.teamWorkerLifecycleTelemetrySummary.v1';
  readonly waveId: string;
  readonly checkId: 'team.worker-lifecycle';
  readonly missingWorkerReports: readonly string[];
  readonly invalidWorkerReports: readonly { readonly taskId: string; readonly reason: string }[];
  readonly outOfScopeFindings: readonly TeamWorkerOutOfScopeFinding[];
  readonly deferredTaskIds: readonly string[];
  readonly acceptedTaskIds: readonly string[];
  readonly sourceAvailability: Record<string, 'available' | 'unavailable'>;
}

export interface TeamWorkerExecutionRuntime {
  readonly schemaId: 'atm.teamWorkerExecutionRuntime.v1';
  readonly specVersion: '0.1.0';
  readonly waveId: string;
  readonly batchId: string;
  readonly executor: WaveManifest['executor'];
  readonly coordinatorActorId: string;
  readonly taskIds: readonly string[];
  readonly lanes: readonly TeamWorkerExecutionLane[];
  readonly workerReports: readonly TeamWorkerReport[];
  readonly acceptedTaskIds: readonly string[];
  readonly deferredTaskIds: readonly string[];
  readonly missingWorkerReports: readonly string[];
  readonly invalidWorkerReports: readonly { readonly taskId: string; readonly reason: string }[];
  readonly outOfScopeFindings: readonly TeamWorkerOutOfScopeFinding[];
  readonly resultState: TeamWorkerExecutorResultState;
  readonly writesPerformed: false;
  readonly telemetrySummary: TeamWorkerExecutorTelemetrySummary;
  readonly createdAt: string;
}

export function buildTeamWorkerExecutionRuntime(input: {
  readonly manifest: WaveManifest;
  readonly workerReports?: readonly TeamWorkerReport[];
  readonly now?: string;
}): TeamWorkerExecutionRuntime {
  const now = input.now ?? new Date().toISOString();
  const reports = input.workerReports ?? [];
  const reportsByTask = new Map(reports.map((report) => [report.taskId, report]));
  const validationByTask = new Map(reports.map((report) => [report.taskId, validateWorkerReport(report)]));
  const invalidWorkerReports = reports
    .map((report) => ({ taskId: report.taskId, reason: validationByTask.get(report.taskId)?.reason ?? 'unknown validation failure' }))
    .filter((entry) => validationByTask.get(entry.taskId)?.ok === false);
  const invalidTaskIds = new Set(invalidWorkerReports.map((entry) => entry.taskId));
  const outOfScopeFindings = buildOutOfScopeFindings(input.manifest, reports);
  const outOfScopeTaskIds = new Set(outOfScopeFindings.map((entry) => entry.taskId));
  const missingWorkerReports = input.manifest.tasks
    .map((task) => task.taskId)
    .filter((taskId) => !reportsByTask.has(taskId));
  const deferredTaskIds = input.manifest.tasks
    .map((task) => task.taskId)
    .filter((taskId) => {
      const report = reportsByTask.get(taskId);
      if (!report) return false;
      const state = effectiveExecutionState(report);
      return state === 'partial' || state === 'blocked' || state === 'not-started';
    });
  const acceptedTaskIds = input.manifest.tasks
    .map((task) => task.taskId)
    .filter((taskId) => {
      const report = reportsByTask.get(taskId);
      if (!report) return false;
      return effectiveExecutionState(report) === 'done'
        && !invalidTaskIds.has(taskId)
        && !outOfScopeTaskIds.has(taskId);
    });
  const resultState = resolveResultState({
    totalTasks: input.manifest.tasks.length,
    reportCount: reports.length,
    missingWorkerReports,
    invalidWorkerReports,
    outOfScopeFindings,
    acceptedTaskIds,
    deferredTaskIds
  });
  const sourceAvailability = Object.fromEntries(
    input.manifest.tasks.map((task) => [task.taskId, reportsByTask.has(task.taskId) ? 'available' : 'unavailable'] as const)
  );
  const lanes = input.manifest.tasks.map((task, index): TeamWorkerExecutionLane => {
    const report = reportsByTask.get(task.taskId);
    const lifecycleEvents: TeamWorkerLifecycleEventKind[] = ['worker.start', 'worker.heartbeat'];
    if (report) lifecycleEvents.push('worker.report');
    if (deferredTaskIds.includes(task.taskId)) lifecycleEvents.push('worker.defer', 'worker.retry');
    if (invalidTaskIds.has(task.taskId) || outOfScopeTaskIds.has(task.taskId)) lifecycleEvents.push('worker.needs-review');
    return {
      taskId: task.taskId,
      laneSessionId: task.laneSessionId ?? `lane-${input.manifest.waveId}-${String(index + 1).padStart(2, '0')}-${task.taskId.toLowerCase()}`,
      workerCanCommitOrClose: false,
      allowedReturnSchemas: ['atm.patchEnvelope.v1', 'atm.teamWorkerReport.v1'],
      heartbeat: {
        status: report ? 'reported' : 'missing-report',
        startedAt: input.manifest.createdAt,
        heartbeatAt: report?.metadata.reportedAt ?? now,
        reportId: report?.reportId ?? null,
        tokenUsageSource: 'unavailable'
      },
      lifecycleEvents
    };
  });
  const telemetrySummary: TeamWorkerExecutorTelemetrySummary = {
    schemaId: 'atm.teamWorkerLifecycleTelemetrySummary.v1',
    waveId: input.manifest.waveId,
    checkId: 'team.worker-lifecycle',
    missingWorkerReports,
    invalidWorkerReports,
    outOfScopeFindings,
    deferredTaskIds,
    acceptedTaskIds,
    sourceAvailability
  };
  return {
    schemaId: 'atm.teamWorkerExecutionRuntime.v1',
    specVersion: '0.1.0',
    waveId: input.manifest.waveId,
    batchId: input.manifest.batchRunId,
    executor: input.manifest.executor,
    coordinatorActorId: input.manifest.coordinatorActorId,
    taskIds: input.manifest.tasks.map((task) => task.taskId),
    lanes,
    workerReports: reports,
    acceptedTaskIds,
    deferredTaskIds,
    missingWorkerReports,
    invalidWorkerReports,
    outOfScopeFindings,
    resultState,
    writesPerformed: false,
    telemetrySummary,
    createdAt: now
  };
}

function resolveResultState(input: {
  readonly totalTasks: number;
  readonly reportCount: number;
  readonly missingWorkerReports: readonly string[];
  readonly invalidWorkerReports: readonly { readonly taskId: string; readonly reason: string }[];
  readonly outOfScopeFindings: readonly TeamWorkerOutOfScopeFinding[];
  readonly acceptedTaskIds: readonly string[];
  readonly deferredTaskIds: readonly string[];
}): TeamWorkerExecutorResultState {
  if (input.invalidWorkerReports.length > 0 || input.outOfScopeFindings.length > 0) return 'needs-review';
  if (input.reportCount === 0) return 'executing';
  if (input.acceptedTaskIds.length === input.totalTasks && input.totalTasks > 0) return 'ready-for-write';
  if (input.deferredTaskIds.length > 0 || input.acceptedTaskIds.length < input.totalTasks) return 'serial-fallback';
  if (input.missingWorkerReports.length > 0) return 'executing';
  return 'executing';
}

function buildOutOfScopeFindings(manifest: WaveManifest, reports: readonly TeamWorkerReport[]): readonly TeamWorkerOutOfScopeFinding[] {
  const byTask = new Map(manifest.tasks.map((task) => [task.taskId, task]));
  return reports
    .map((report) => {
      const task = byTask.get(report.taskId);
      const files = task ? report.changedFiles.filter((file) => !pathAllowedByScope(file, task.scopePaths)) : report.changedFiles;
      return { taskId: report.taskId, files };
    })
    .filter((entry) => entry.files.length > 0);
}

function pathAllowedByScope(filePath: string, scopePaths: readonly string[]): boolean {
  const normalized = normalizeRepoPath(filePath);
  return scopePaths.some((scope) => {
    const allowed = normalizeRepoPath(scope);
    if (allowed.endsWith('/**')) return normalized.startsWith(allowed.slice(0, -3));
    return normalized === allowed || normalized.startsWith(`${allowed.replace(/\/$/, '')}/`);
  });
}

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, '/').trim().replace(/^\.\//, '');
}
