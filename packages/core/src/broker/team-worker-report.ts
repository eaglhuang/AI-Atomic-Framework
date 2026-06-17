// TASK-MAO-0028: Team worker report ingestion contract. A worker (never the
// coordinator) reports the outcome of implementing one card in a wave: changed
// files, validator results with the first failing diagnostic, declared
// deviations, and an execution state. The coordinator ingests these to drive
// evidence slicing (TASK-MAO-0029) and checkpoint (TASK-MAO-0030).
// Conforms to schemas/team-worker-report.schema.json.

export type WorkerExecutionState =
  | 'done'
  | 'partial'
  | 'blocked'
  | 'not-started'
  | 'needs-review';

export interface WorkerValidatorRun {
  readonly command: string;
  readonly passed: boolean;
  readonly firstFailingDiagnostic?: string | null;
}

export interface TeamWorkerReport {
  readonly schemaId: 'atm.teamWorkerReport.v1';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly reportId: string;
  readonly taskId: string;
  readonly workerActorId: string;
  readonly executionState: WorkerExecutionState;
  readonly changedFiles: readonly string[];
  readonly validatorRuns: readonly WorkerValidatorRun[];
  readonly deviations?: readonly string[];
  readonly metadata: {
    readonly reportedAt: string;
    readonly waveId: string | null;
    readonly notes?: string | null;
  };
}

export function createWorkerReport(input: {
  readonly taskId: string;
  readonly workerActorId: string;
  readonly executionState: WorkerExecutionState;
  readonly changedFiles?: readonly string[];
  readonly validatorRuns?: readonly WorkerValidatorRun[];
  readonly deviations?: readonly string[];
  readonly waveId?: string | null;
  readonly reportedAt?: string;
  readonly notes?: string | null;
}): TeamWorkerReport {
  return {
    schemaId: 'atm.teamWorkerReport.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'Team worker report baseline record.' },
    reportId: `worker-report-${input.taskId}-${Date.now()}`,
    taskId: input.taskId,
    workerActorId: input.workerActorId,
    executionState: input.executionState,
    changedFiles: input.changedFiles ?? [],
    validatorRuns: input.validatorRuns ?? [],
    deviations: input.deviations ?? [],
    metadata: {
      reportedAt: input.reportedAt ?? new Date().toISOString(),
      waveId: input.waveId ?? null,
      notes: input.notes ?? null
    }
  };
}

export interface WorkerReportValidation {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * Validate a worker report's internal consistency:
 *  - a `done` report cannot carry a failing validator run,
 *  - a `done` report must declare at least one changed file,
 *  - every failing validator run should surface a first failing diagnostic.
 * The coordinator treats an inconsistent report as `needs-review`.
 */
export function validateWorkerReport(report: TeamWorkerReport): WorkerReportValidation {
  if (report.schemaId !== 'atm.teamWorkerReport.v1') {
    return { ok: false, reason: 'schemaId must be atm.teamWorkerReport.v1' };
  }
  const anyFailing = report.validatorRuns.some((run) => !run.passed);
  if (report.executionState === 'done' && anyFailing) {
    return { ok: false, reason: 'a done report cannot contain a failing validator run' };
  }
  if (report.executionState === 'done' && report.changedFiles.length === 0) {
    return { ok: false, reason: 'a done report must declare at least one changed file' };
  }
  for (const run of report.validatorRuns) {
    if (!run.passed && !(run.firstFailingDiagnostic ?? '').trim()) {
      return {
        ok: false,
        reason: `failing validator ${run.command} must include a first failing diagnostic`
      };
    }
  }
  return { ok: true, reason: 'worker report is consistent' };
}

/**
 * Reconcile a worker report's self-declared state with its validator evidence.
 * A `done` claim with any failing validator is downgraded to `needs-review`.
 */
export function effectiveExecutionState(report: TeamWorkerReport): WorkerExecutionState {
  const anyFailing = report.validatorRuns.some((run) => !run.passed);
  if (report.executionState === 'done' && anyFailing) return 'needs-review';
  return report.executionState;
}
