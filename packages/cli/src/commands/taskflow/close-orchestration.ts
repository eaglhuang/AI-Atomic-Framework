import type { TaskflowDelegationContract } from './profile-loader.ts';
import type { TaskResidueBucket, TaskResidueClassification } from '../tasks.ts';
import { CliError } from '../shared.ts';

export type TaskflowCloseMode =
  | 'normal-close'
  | 'historical-delivery-close'
  | 'planning-mirror-sync-repair'
  | 'residue-repair'
  | 'ambiguous-manual-review';

export type TaskflowCloseBackend =
  | 'tasks-close'
  | 'tasks-reconcile'
  | 'tasks-import'
  | 'tasks-repair-closure'
  | 'tasks-status';

export interface TaskflowClosebackPlan {
  closeMode: TaskflowCloseMode;
  backendSurface: TaskflowCloseBackend;
  backendCommand: string;
  followUpSteps: string[];
  writerBoundary: {
    adopterAware: true;
    planningMirrorPath: string | null;
    writerSurface: 'planning-mirror-adopter-flow';
    generationSurface: 'tasks-new';
    rosterSyncPolicy: 'inline' | 'follow-up-command' | 'none';
    rosterIndexPath: string | null;
    rosterClosebackCommand: string | null;
    closebackNote: string;
  };
  historicalDeliveryGate: {
    required: boolean;
    refs: string[];
    validatorSurfaces: string[];
  };
  evidenceValidators: string[];
  residue: Pick<TaskResidueClassification, 'bucket' | 'truth' | 'residue' | 'reason' | 'nextCommand'>;
}

function buildTasksCloseCommand(input: {
  taskId: string;
  actorId: string;
  historicalDeliveryRefs?: string[];
}): string {
  const parts = [
    'node atm.mjs tasks close',
    `--task ${input.taskId}`,
    `--actor ${input.actorId}`,
    '--status done',
    '--json'
  ];
  for (const ref of input.historicalDeliveryRefs ?? []) {
    parts.push(`--historical-delivery ${ref}`);
  }
  return parts.join(' ');
}

function buildTasksReconcileCommand(input: {
  taskId: string;
  actorId: string;
  deliveryCommit?: string | null;
}): string {
  const parts = [
    'node atm.mjs tasks reconcile',
    `--task ${input.taskId}`,
    `--actor ${input.actorId}`,
    '--json'
  ];
  if (input.deliveryCommit) {
    parts.push(`--delivery-commit ${input.deliveryCommit}`);
  }
  return parts.join(' ');
}

function buildTasksImportCommand(fromPath: string, force = false): string {
  const parts = ['node atm.mjs tasks import', `--from ${fromPath}`, '--write', '--json'];
  if (force) {
    parts.push('--force');
  }
  return parts.join(' ');
}

function buildTasksRepairClosureCommand(taskId: string, actorId?: string | null): string {
  const parts = ['node atm.mjs tasks repair-closure', `--task ${taskId}`, '--json'];
  if (actorId) {
    parts.push(`--actor ${actorId}`);
  }
  return parts.join(' ');
}

function buildTasksStatusCommand(taskId: string): string {
  return `node atm.mjs tasks status --task ${taskId} --json`;
}

function buildRosterClosebackCommand(input: {
  indexPath: string;
  fromPath: string;
}): string {
  return `node atm.mjs tasks roster update --index ${input.indexPath} --from ${input.fromPath} --json`;
}

function resolveBackendSurface(bucket: TaskResidueBucket, closeMode: TaskflowCloseMode): TaskflowCloseBackend {
  if (closeMode === 'ambiguous-manual-review') {
    return 'tasks-status';
  }
  if (closeMode === 'residue-repair' || bucket === 'interrupted-close') {
    return 'tasks-repair-closure';
  }
  if (closeMode === 'planning-mirror-sync-repair') {
    return 'tasks-import';
  }
  if (bucket === 'complete-but-unfinalized') {
    return 'tasks-reconcile';
  }
  if (closeMode === 'historical-delivery-close') {
    return 'tasks-close';
  }
  return 'tasks-close';
}

export function resolveTaskflowCloseMode(input: {
  bucket: TaskResidueBucket;
  liveStatus: string | null;
  historicalDeliveryRefs: string[];
  divergenceCount: number;
}): TaskflowCloseMode {
  if (input.bucket === 'ambiguous-manual-review') {
    if (
      input.divergenceCount === 0
      && input.liveStatus
      && !['done', 'blocked', 'abandoned'].includes(input.liveStatus)
    ) {
      return input.historicalDeliveryRefs.length > 0 ? 'historical-delivery-close' : 'normal-close';
    }
    return 'ambiguous-manual-review';
  }
  if (input.bucket === 'planning-mirror-only' || input.bucket === 'stale-import') {
    return 'planning-mirror-sync-repair';
  }
  if (input.bucket === 'interrupted-close') {
    return 'residue-repair';
  }
  if (input.bucket === 'complete-but-unfinalized' || input.bucket === 'source-done-governance-incomplete') {
    return 'historical-delivery-close';
  }
  if (input.liveStatus === 'done') {
    return 'ambiguous-manual-review';
  }
  if (input.historicalDeliveryRefs.length > 0) {
    return 'historical-delivery-close';
  }
  if (input.divergenceCount === 0) {
    return 'normal-close';
  }
  return 'ambiguous-manual-review';
}

export function buildClosebackPlan(input: {
  taskId: string;
  actorId: string;
  historicalDeliveryRefs: string[];
  delegationContract: TaskflowDelegationContract;
  diagnosis: {
    bucket: TaskResidueBucket;
    truth: string;
    residue: string;
    reason: string;
    nextCommand: string;
    triangulation: {
      liveLedger: { status: string | null };
      planningFrontmatter: { status: string | null; source: string | null };
      divergence: Array<{ field: string }>;
    };
  };
}): TaskflowClosebackPlan {
  const closeMode = resolveTaskflowCloseMode({
    bucket: input.diagnosis.bucket,
    liveStatus: input.diagnosis.triangulation.liveLedger.status,
    historicalDeliveryRefs: input.historicalDeliveryRefs,
    divergenceCount: input.diagnosis.triangulation.divergence.length
  });
  const backendSurface = resolveBackendSurface(input.diagnosis.bucket, closeMode);
  const planningMirrorPath = input.diagnosis.triangulation.planningFrontmatter.source;
  const rosterIndexPath = input.delegationContract.policy.rosterSync.indexPath;
  const rosterClosebackCommand = rosterIndexPath && planningMirrorPath
    ? buildRosterClosebackCommand({ indexPath: rosterIndexPath, fromPath: planningMirrorPath })
    : null;

  let backendCommand = buildTasksStatusCommand(input.taskId);
  const followUpSteps: string[] = ['diagnose-residue-via-finalize'];
  if (backendSurface === 'tasks-close') {
    backendCommand = buildTasksCloseCommand({
      taskId: input.taskId,
      actorId: input.actorId,
      historicalDeliveryRefs: input.historicalDeliveryRefs
    });
    followUpSteps.push('close-live-ledger');
    if (planningMirrorPath) {
      followUpSteps.push('planning-mirror-closeback');
    }
  } else if (backendSurface === 'tasks-reconcile') {
    backendCommand = buildTasksReconcileCommand({
      taskId: input.taskId,
      actorId: input.actorId,
      deliveryCommit: input.historicalDeliveryRefs[0] ?? null
    });
    followUpSteps.push('reconcile-historical-delivery');
  } else if (backendSurface === 'tasks-import') {
    backendCommand = planningMirrorPath
      ? buildTasksImportCommand(planningMirrorPath, input.diagnosis.bucket === 'stale-import')
      : input.diagnosis.nextCommand;
    followUpSteps.push('refresh-planning-mirror');
  } else if (backendSurface === 'tasks-repair-closure') {
    backendCommand = buildTasksRepairClosureCommand(input.taskId, input.actorId);
    followUpSteps.push('repair-interrupted-close');
  }

  if (rosterClosebackCommand && closeMode !== 'ambiguous-manual-review') {
    if (input.delegationContract.policy.rosterSyncPolicy === 'inline') {
      followUpSteps.push('roster-closeback-inline');
    } else if (input.delegationContract.policy.rosterSyncPolicy === 'follow-up-command') {
      followUpSteps.push('roster-closeback-follow-up-command');
    }
  }

  const historicalDeliveryRequired = closeMode === 'historical-delivery-close'
    || (closeMode === 'normal-close' && input.diagnosis.triangulation.liveLedger.status !== 'done');

  const evidenceValidators = [
    'npm run typecheck',
    'npm run validate:cli',
    'node --strip-types scripts/validate-task-ledger-governance.ts --mode validate'
  ];
  if (closeMode === 'historical-delivery-close' || closeMode === 'normal-close') {
    evidenceValidators.push('node --strip-types scripts/validate-governance-commands.ts --mode validate');
  }

  return {
    closeMode,
    backendSurface,
    backendCommand,
    followUpSteps,
    writerBoundary: {
      adopterAware: true,
      planningMirrorPath,
      writerSurface: 'planning-mirror-adopter-flow',
      generationSurface: 'tasks-new',
      rosterSyncPolicy: input.delegationContract.policy.rosterSyncPolicy,
      rosterIndexPath,
      rosterClosebackCommand,
      closebackNote: 'Planning-mirror closeback reuses tasks import and tasks roster update inside the same adopter-aware flow; ATM does not add a second closeback writer.'
    },
    historicalDeliveryGate: {
      required: historicalDeliveryRequired && input.historicalDeliveryRefs.length === 0 && backendSurface === 'tasks-close',
      refs: input.historicalDeliveryRefs,
      validatorSurfaces: [
        'atm.frameworkDeliveryWindow.v1',
        'tasks close scoped-diff isolation'
      ]
    },
    evidenceValidators,
    residue: {
      bucket: input.diagnosis.bucket,
      truth: input.diagnosis.truth,
      residue: input.diagnosis.residue,
      reason: input.diagnosis.reason,
      nextCommand: input.diagnosis.nextCommand
    }
  };
}

export function buildTaskflowCloseDiagnostics(input: {
  closeMode: TaskflowCloseMode;
  writeRequested: boolean;
  actorSupplied: boolean;
  taskIdSupplied: boolean;
}): { codes: string[]; messages: string[]; missingPrerequisites: string[] } {
  const codes: string[] = [];
  const messages: string[] = [];
  const missingPrerequisites: string[] = [];
  if (!input.taskIdSupplied) {
    codes.push('ATM_TASKFLOW_CLOSE_TASK_REQUIRED');
    missingPrerequisites.push('--task <work-item-id>');
  }
  if (input.writeRequested && !input.actorSupplied) {
    codes.push('ATM_TASKFLOW_CLOSE_ACTOR_REQUIRED');
    missingPrerequisites.push('--actor <id>');
  }
  if (input.closeMode === 'ambiguous-manual-review') {
    codes.push('ATM_TASKFLOW_CLOSE_AMBIGUOUS_RESIDUE');
    messages.push('Close orchestration is blocked until residue classification resolves to one governed backend.');
  }
  if (input.writeRequested && input.closeMode === 'historical-delivery-close') {
    messages.push('Historical-delivery close may require --historical-delivery when framework delivery already landed.');
  }
  return { codes, messages, missingPrerequisites };
}

export function buildCloseBackendArgv(input: {
  cwd: string;
  taskId: string;
  actorId: string;
  backendSurface: TaskflowCloseBackend;
  historicalDeliveryRefs: string[];
  planningMirrorPath: string | null;
  forceImport: boolean;
}): string[] {
  if (input.backendSurface === 'tasks-status') {
    return ['status', '--cwd', input.cwd, '--task', input.taskId];
  }
  if (input.backendSurface === 'tasks-repair-closure') {
    return ['repair-closure', '--cwd', input.cwd, '--task', input.taskId, '--actor', input.actorId];
  }
  if (input.backendSurface === 'tasks-import') {
    if (!input.planningMirrorPath) {
      throw new CliError('ATM_TASKFLOW_CLOSE_PLANNING_MIRROR_REQUIRED', 'Planning mirror path is required for import closeback.', { exitCode: 2 });
    }
    const argv = ['import', '--cwd', input.cwd, '--from', input.planningMirrorPath, '--write'];
    if (input.forceImport) {
      argv.push('--force');
    }
    return argv;
  }
  if (input.backendSurface === 'tasks-reconcile') {
    const argv = ['reconcile', '--cwd', input.cwd, '--task', input.taskId, '--actor', input.actorId];
    if (input.historicalDeliveryRefs[0]) {
      argv.push('--delivery-commit', input.historicalDeliveryRefs[0]);
    }
    return argv;
  }
  const argv = ['close', '--cwd', input.cwd, '--task', input.taskId, '--actor', input.actorId, '--status', 'done'];
  for (const ref of input.historicalDeliveryRefs) {
    argv.push('--historical-delivery', ref);
  }
  return argv;
}

export function resolveCloseWriteSupport(input: {
  writeRequested: boolean;
  closeMode: TaskflowCloseMode;
  actorSupplied: boolean;
  taskIdSupplied: boolean;
  historicalDeliveryGateRequired: boolean;
  historicalDeliverySupplied: boolean;
}): { requested: boolean; allowed: boolean; reason: string } {
  if (!input.writeRequested) {
    return { requested: false, allowed: false, reason: 'dry-run mode' };
  }
  if (!input.taskIdSupplied || !input.actorSupplied) {
    return { requested: true, allowed: false, reason: 'taskflow close --write requires --task and --actor.' };
  }
  if (input.closeMode === 'ambiguous-manual-review') {
    return { requested: true, allowed: false, reason: 'ambiguous residue requires operator review before close write.' };
  }
  if (input.historicalDeliveryGateRequired && !input.historicalDeliverySupplied && input.closeMode === 'normal-close') {
    return {
      requested: true,
      allowed: false,
      reason: 'framework delivery already landed; supply --historical-delivery before taskflow close --write.'
    };
  }
  return { requested: true, allowed: true, reason: 'closeback prerequisites satisfied' };
}
