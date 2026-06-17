import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TaskflowDelegationContract, TaskflowProfileV1 } from './profile-loader.ts';
import type { TaskResidueBucket, TaskResidueClassification } from '../tasks/public-surface.ts';
import {
  resolveTaskflowCloseBackend,
  resolveTaskflowCloseMode,
  taskflowCloseEvidenceValidators,
  taskflowCloseGovernanceEvidenceValidator,
  type TaskflowCloseBackend,
  type TaskflowCloseMode
} from '../tasks/surface-invariants.ts';
import { extractFrontMatter, normalizeTaskId } from '../tasks/task-import-validators.ts';
import { CliError, relativePathFrom } from '../shared.ts';

export type ClosebackPlanningPathRoute =
  | 'source-plan-path'
  | 'profile-root-fallback'
  | 'missing'
  | 'ambiguous';

export interface ClosebackPlanningPathResolution {
  route: ClosebackPlanningPathRoute;
  planningMirrorPath: string | null;
  profileRepoRoot: string | null;
  planningStatus: string | null;
  diagnostics: {
    codes: string[];
    messages: string[];
  };
}

export type { TaskflowCloseBackend, TaskflowCloseMode };

/** closeback 摘要中暴露的單筆範圍增修紀錄，讓 reviewer 在收口時區分正常 linked-surface 成長與可疑 scope drift。 */
export interface TaskScopeAmendmentSummary {
  transitionId: string;
  actorId: string | null;
  createdAt: string;
  addedPaths: string[];
  amendmentClass: string | null;
  amendmentPhase: string | null;
  amendmentMode: 'normal' | 'repair' | null;
  reason: string | null;
}

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
  planningAuthorityDeliveryGate: {
    required: boolean;
    ok: boolean;
    repoRoot: string | null;
    matchedFiles: string[];
    reason: string | null;
  };
  evidenceValidators: string[];
  residue: Pick<TaskResidueClassification, 'bucket' | 'truth' | 'residue' | 'reason' | 'nextCommand'>;
  /** 該任務已記錄的範圍增修歷史（依時間順序），收口摘要中可見。 */
  amendmentHistory: TaskScopeAmendmentSummary[];
  closebackPathResolution?: ClosebackPlanningPathResolution;
}

function buildTasksCloseCommand(input: {
  taskId: string;
  actorId: string;
  historicalDeliveryRefs?: string[];
  historicalBatchRef?: string | null;
  historicalDeliveryRepo?: string | null;
  waiverOutOfScopeDelivery?: boolean;
  waiverReason?: string | null;
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
  if (input.historicalBatchRef) {
    parts.push(`--historical-batch ${input.historicalBatchRef}`);
  }
  if (input.historicalDeliveryRepo) {
    parts.push(`--historical-delivery-repo ${input.historicalDeliveryRepo}`);
  }
  if (input.waiverOutOfScopeDelivery) {
    parts.push('--waiver-out-of-scope-delivery');
    if (input.waiverReason) {
      parts.push(`--reason ${JSON.stringify(input.waiverReason)}`);
    }
  }
  return parts.join(' ');
}

function buildTasksReconcileCommand(input: {
  taskId: string;
  actorId: string;
  deliveryCommit?: string | null;
  waiverOutOfScopeDelivery?: boolean;
  waiverReason?: string | null;
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
  if (input.waiverOutOfScopeDelivery) {
    parts.push('--waiver-out-of-scope-delivery');
    if (input.waiverReason) {
      parts.push(`--reason ${JSON.stringify(input.waiverReason)}`);
    }
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

export function buildClosebackPlan(input: {
  taskId: string;
  actorId: string;
  historicalDeliveryRefs: string[];
  historicalBatchRef?: string | null;
  planningAuthorityDeliveryGate?: {
    required: boolean;
    ok: boolean;
    repoRoot: string | null;
    matchedFiles: string[];
    reason: string | null;
  };
  waiverOutOfScopeDelivery?: boolean;
  waiverReason?: string | null;
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
      amendmentHistory?: ReadonlyArray<TaskScopeAmendmentSummary>;
    };
  };
  closebackPathResolution?: ClosebackPlanningPathResolution;
}): TaskflowClosebackPlan {
  const closeMode = resolveTaskflowCloseMode({
    bucket: input.diagnosis.bucket,
    liveStatus: input.diagnosis.triangulation.liveLedger.status,
    planningStatus: input.diagnosis.triangulation.planningFrontmatter.status,
    historicalDeliveryRefs: input.historicalDeliveryRefs,
    planningAuthorityDeliveryOk: input.planningAuthorityDeliveryGate?.ok === true,
    divergenceCount: input.diagnosis.triangulation.divergence.length
  });
  const backendSurface = input.planningAuthorityDeliveryGate?.ok === true
    ? 'tasks-close'
    : resolveTaskflowCloseBackend(input.diagnosis.bucket, closeMode);
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
      historicalDeliveryRefs: input.historicalDeliveryRefs,
      historicalBatchRef: input.historicalBatchRef ?? null,
      historicalDeliveryRepo: input.planningAuthorityDeliveryGate?.repoRoot ?? null,
      waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery === true,
      waiverReason: input.waiverReason ?? null
    });
    followUpSteps.push('close-live-ledger');
    if (planningMirrorPath) {
      followUpSteps.push('planning-mirror-closeback');
    }
  } else if (backendSurface === 'tasks-reconcile') {
    backendCommand = buildTasksReconcileCommand({
      taskId: input.taskId,
      actorId: input.actorId,
      deliveryCommit: input.historicalDeliveryRefs[0] ?? null,
      waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery === true,
      waiverReason: input.waiverReason ?? null
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

  const evidenceValidators = [...taskflowCloseEvidenceValidators];
  if (closeMode === 'historical-delivery-close' || closeMode === 'normal-close') {
    evidenceValidators.push(taskflowCloseGovernanceEvidenceValidator);
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
    planningAuthorityDeliveryGate: input.planningAuthorityDeliveryGate ?? {
      required: false,
      ok: false,
      repoRoot: null,
      matchedFiles: [],
      reason: null
    },
    evidenceValidators,
    residue: {
      bucket: input.diagnosis.bucket,
      truth: input.diagnosis.truth,
      residue: input.diagnosis.residue,
      reason: input.diagnosis.reason,
      nextCommand: input.diagnosis.nextCommand
    },
    amendmentHistory: [...(input.diagnosis.triangulation.amendmentHistory ?? [])],
    closebackPathResolution: input.closebackPathResolution
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
  historicalBatchRef?: string | null;
  historicalDeliveryRepo?: string | null;
  waiverOutOfScopeDelivery?: boolean;
  waiverReason?: string | null;
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
  if (input.historicalBatchRef) {
    argv.push('--historical-batch', input.historicalBatchRef);
  }
  if (input.historicalDeliveryRepo) {
    argv.push('--historical-delivery-repo', input.historicalDeliveryRepo);
  }
  if (input.waiverOutOfScopeDelivery) {
    argv.push('--waiver-out-of-scope-delivery');
    if (input.waiverReason) {
      argv.push('--reason', input.waiverReason);
    }
  }
  return argv;
}

function readTaskDocumentSourcePlanPath(taskDocument: Record<string, unknown>): string | null {
  const source = taskDocument.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const planPath = (source as Record<string, unknown>).planPath;
  return typeof planPath === 'string' && planPath.trim() ? planPath.trim() : null;
}

function readTaskDocumentRelatedPlanPath(taskDocument: Record<string, unknown>): string | null {
  const relatedPlan = taskDocument.related_plan ?? taskDocument.relatedPlan;
  return typeof relatedPlan === 'string' && relatedPlan.trim() ? relatedPlan.trim() : null;
}

function slugifyPlanningTitle(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'task';
}

function resolveCanonicalPlanningRelativePath(
  taskId: string,
  title: string | null,
  policy: TaskflowDelegationContract['policy']
): string | null {
  const pattern = policy.resolveCanonicalOutputPath.pattern;
  if (!pattern || !pattern.includes('${taskId}')) {
    return null;
  }
  const slug = slugifyPlanningTitle(title ?? taskId);
  return pattern
    .split('${taskId}').join(taskId)
    .split('${slug}').join(slug)
    .replace(/\\/g, '/');
}

function readPlanningCardMetadata(absolutePath: string): { taskId: string | null; status: string | null } {
  if (!existsSync(absolutePath)) {
    return { taskId: null, status: null };
  }
  const frontMatter = extractFrontMatter(readFileSync(absolutePath, 'utf8'));
  if (!frontMatter) {
    return { taskId: null, status: null };
  }
  const rawTaskId = typeof frontMatter.data.task_id === 'string'
    ? frontMatter.data.task_id
    : typeof frontMatter.data.id === 'string'
      ? frontMatter.data.id
      : null;
  return {
    taskId: rawTaskId ? normalizeTaskId(rawTaskId) : null,
    status: typeof frontMatter.data.status === 'string' ? frontMatter.data.status : null
  };
}

function normalizeComparablePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/');
}

export function resolveClosebackPlanningPath(input: {
  cwd: string;
  taskId: string;
  taskDocument: Record<string, unknown>;
  profile: TaskflowProfileV1 | null;
  profileRepoRoot: string | null;
  delegationContract: TaskflowDelegationContract;
}): ClosebackPlanningPathResolution {
  const normalizedTaskId = normalizeTaskId(input.taskId);
  const title = typeof input.taskDocument.title === 'string' ? input.taskDocument.title : null;

  const directPlanPath = readTaskDocumentSourcePlanPath(input.taskDocument);
  if (directPlanPath) {
    const absolutePath = path.isAbsolute(directPlanPath)
      ? path.resolve(directPlanPath)
      : path.resolve(input.cwd, directPlanPath);
    if (!existsSync(absolutePath)) {
      return {
        route: 'missing',
        planningMirrorPath: directPlanPath.replace(/\\/g, '/'),
        profileRepoRoot: null,
        planningStatus: null,
        diagnostics: {
          codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_MISSING'],
          messages: [`Planning card path from source.planPath does not exist: ${directPlanPath}.`]
        }
      };
    }
    const metadata = readPlanningCardMetadata(absolutePath);
    if (metadata.taskId && metadata.taskId !== normalizedTaskId) {
      return {
        route: 'missing',
        planningMirrorPath: directPlanPath.replace(/\\/g, '/'),
        profileRepoRoot: null,
        planningStatus: metadata.status,
        diagnostics: {
          codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_TASK_MISMATCH'],
          messages: [`Planning card task id ${metadata.taskId} does not match runtime task ${normalizedTaskId}.`]
        }
      };
    }
    return {
      route: 'source-plan-path',
      planningMirrorPath: directPlanPath.replace(/\\/g, '/'),
      profileRepoRoot: null,
      planningStatus: metadata.status,
      diagnostics: {
        codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_DIRECT'],
        messages: [`Closeback planning path resolved from source.planPath: ${directPlanPath}.`]
      }
    };
  }

  if (!input.profile || !input.profileRepoRoot) {
    return {
      route: 'missing',
      planningMirrorPath: null,
      profileRepoRoot: null,
      planningStatus: null,
      diagnostics: {
        codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_UNAVAILABLE'],
        messages: ['source.planPath is absent and no taskflow profile was supplied for governed fallback recovery.']
      }
    };
  }

  const relativeOutput = resolveCanonicalPlanningRelativePath(
    normalizedTaskId,
    title,
    input.delegationContract.policy
  );
  if (!relativeOutput) {
    return {
      route: 'missing',
      planningMirrorPath: null,
      profileRepoRoot: input.profileRepoRoot,
      planningStatus: null,
      diagnostics: {
        codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_POLICY_MISSING'],
        messages: ['Profile canonical output-path policy cannot deterministically resolve a planning card path for closeback.']
      }
    };
  }

  const profileAbsolutePath = path.resolve(input.profileRepoRoot, relativeOutput);
  const relatedPlanPath = readTaskDocumentRelatedPlanPath(input.taskDocument);
  if (relatedPlanPath) {
    const relatedAbsolutePath = path.isAbsolute(relatedPlanPath)
      ? path.resolve(relatedPlanPath)
      : path.resolve(input.cwd, relatedPlanPath);
    if (
      existsSync(relatedAbsolutePath)
      && normalizeComparablePath(relatedAbsolutePath) !== normalizeComparablePath(profileAbsolutePath)
    ) {
      return {
        route: 'ambiguous',
        planningMirrorPath: null,
        profileRepoRoot: input.profileRepoRoot,
        planningStatus: null,
        diagnostics: {
          codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_AMBIGUOUS'],
          messages: [
            `Profile canonical path ${relativeOutput} conflicts with related_plan ${relatedPlanPath}; closeback requires one deterministic planning path.`
          ]
        }
      };
    }
  }

  if (!existsSync(profileAbsolutePath)) {
    return {
      route: 'missing',
      planningMirrorPath: profileAbsolutePath.replace(/\\/g, '/'),
      profileRepoRoot: input.profileRepoRoot,
      planningStatus: null,
      diagnostics: {
        codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_MISSING'],
        messages: [`Recovered profile-root planning path does not exist: ${relativeOutput}.`]
      }
    };
  }

  const metadata = readPlanningCardMetadata(profileAbsolutePath);
  if (!metadata.taskId || metadata.taskId !== normalizedTaskId) {
    return {
      route: 'missing',
      planningMirrorPath: profileAbsolutePath.replace(/\\/g, '/'),
      profileRepoRoot: input.profileRepoRoot,
      planningStatus: metadata.status,
      diagnostics: {
        codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_TASK_MISMATCH'],
        messages: [`Recovered planning card task id ${metadata.taskId ?? '<missing>'} does not match runtime task ${normalizedTaskId}.`]
      }
    };
  }

  return {
    route: 'profile-root-fallback',
    planningMirrorPath: profileAbsolutePath.replace(/\\/g, '/'),
    profileRepoRoot: input.profileRepoRoot,
    planningStatus: metadata.status,
    diagnostics: {
      codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_PROFILE_FALLBACK'],
      messages: [`Recovered planning path ${relativeOutput} from profile canonical output policy.`]
    }
  };
}

export function assertClosebackPlanningPathReady(
  resolution: ClosebackPlanningPathResolution,
  input: { profileSupplied: boolean; requirePlanningPath: boolean }
): void {
  if (!input.requirePlanningPath) {
    return;
  }
  if (resolution.route === 'source-plan-path' || resolution.route === 'profile-root-fallback') {
    return;
  }
  const code = resolution.diagnostics.codes[0] ?? 'ATM_TASKFLOW_CLOSE_PLANNING_PATH_MISSING';
  throw new CliError(code, resolution.diagnostics.messages.join(' '), {
    exitCode: 1,
    details: { closebackPathResolution: resolution, profileSupplied: input.profileSupplied }
  });
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

export type CloseWriteTransactionPhase = 'pending' | 'committed' | 'rolled_back';

export interface CloseWriteRollbackSnapshot {
  readonly taskPath: string;
  readonly previousTaskContent: string;
  readonly transitionPath: string | null;
  readonly closurePacketPath: string | null;
  readonly closeCommitWindowPath: string | null;
  readonly planningCard: {
    readonly absolutePath: string;
    readonly previousContent: string;
  } | null;
  readonly stagedArtifacts: readonly string[];
}

export interface CloseWriteTransactionReport {
  readonly schemaId: 'atm.closeWriteTransaction.v1';
  readonly taskId: string;
  readonly phase: CloseWriteTransactionPhase;
  readonly ok: boolean;
  readonly failureStep: string | null;
  readonly failureCode: string | null;
  readonly rolledBackArtifacts: readonly string[];
  readonly recoveryCommand: string | null;
  readonly backendCloseApplied: boolean;
  readonly commitBundleApplied: boolean;
}

function resolveGitExecutableForRollback(): string {
  const configured = process.env.ATM_GIT_EXECUTABLE?.trim();
  if (configured && existsSync(configured)) {
    return configured;
  }
  if (process.platform === 'win32') {
    const windowsGit = 'C:\\Program Files\\Git\\cmd\\git.exe';
    if (existsSync(windowsGit)) {
      return windowsGit;
    }
  }
  return 'git';
}

export function buildCloseWriteRollbackSnapshot(input: {
  cwd: string;
  taskId: string;
  previousTaskContent: string;
  backendEvidence: Record<string, unknown> | null | undefined;
  planningCard: CloseWriteRollbackSnapshot['planningCard'];
  extraStagedArtifacts?: readonly string[];
}): CloseWriteRollbackSnapshot {
  const evidence = input.backendEvidence ?? {};
  const stagedArtifacts = uniqueRelativePaths([
    typeof evidence.taskPath === 'string' ? evidence.taskPath : `.atm/history/tasks/${input.taskId}.json`,
    typeof evidence.transitionPath === 'string' ? evidence.transitionPath : null,
    typeof evidence.closurePacketPath === 'string' ? evidence.closurePacketPath : null,
    `.atm/history/evidence/${input.taskId}.json`,
    ...(input.extraStagedArtifacts ?? [])
  ]);
  return {
    taskPath: `.atm/history/tasks/${input.taskId}.json`,
    previousTaskContent: input.previousTaskContent,
    transitionPath: typeof evidence.transitionPath === 'string' ? evidence.transitionPath : null,
    closurePacketPath: typeof evidence.closurePacketPath === 'string' ? evidence.closurePacketPath : null,
    closeCommitWindowPath: typeof evidence.closeCommitWindowPath === 'string' ? evidence.closeCommitWindowPath : null,
    planningCard: input.planningCard,
    stagedArtifacts
  };
}

function uniqueRelativePaths(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.map((entry) => (typeof entry === 'string' ? entry.trim().replace(/\\/g, '/') : '')).filter(Boolean))];
}

export function rollbackCloseWriteTransaction(input: {
  cwd: string;
  taskId: string;
  snapshot: CloseWriteRollbackSnapshot;
  failureStep: string;
  failureCode: string;
  failureReason?: string | null;
}): CloseWriteTransactionReport {
  const rolledBackArtifacts: string[] = [];
  const taskAbsolutePath = path.resolve(input.cwd, input.snapshot.taskPath);
  writeFileSync(taskAbsolutePath, input.snapshot.previousTaskContent, 'utf8');
  rolledBackArtifacts.push(relativePathFrom(input.cwd, taskAbsolutePath));

  for (const artifactPath of [input.snapshot.transitionPath, input.snapshot.closurePacketPath]) {
    if (!artifactPath) continue;
    const absolutePath = path.resolve(input.cwd, artifactPath);
    if (existsSync(absolutePath)) {
      unlinkSync(absolutePath);
      rolledBackArtifacts.push(relativePathFrom(input.cwd, absolutePath));
    }
  }

  if (input.snapshot.closeCommitWindowPath) {
    const windowAbsolutePath = path.resolve(input.cwd, input.snapshot.closeCommitWindowPath);
    if (existsSync(windowAbsolutePath)) {
      unlinkSync(windowAbsolutePath);
      rolledBackArtifacts.push(relativePathFrom(input.cwd, windowAbsolutePath));
    }
  }

  if (input.snapshot.planningCard) {
    writeFileSync(input.snapshot.planningCard.absolutePath, input.snapshot.planningCard.previousContent, 'utf8');
    rolledBackArtifacts.push(input.snapshot.planningCard.absolutePath);
  }

  const staged = uniqueRelativePaths(input.snapshot.stagedArtifacts);
  if (staged.length > 0) {
    try {
      execFileSync(resolveGitExecutableForRollback(), ['restore', '--staged', '--', ...staged], {
        cwd: input.cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      rolledBackArtifacts.push(...staged.map((entry) => `${entry} (unstaged)`));
    } catch {
      // preserve rollback report even if index cleanup fails
    }
  }

  return {
    schemaId: 'atm.closeWriteTransaction.v1',
    taskId: input.taskId,
    phase: 'rolled_back',
    ok: false,
    failureStep: input.failureStep,
    failureCode: input.failureCode,
    rolledBackArtifacts,
    recoveryCommand: `node atm.mjs tasks status --task ${input.taskId} --json`,
    backendCloseApplied: true,
    commitBundleApplied: false
  };
}

export async function executeCloseWriteCommitPhase<TBundle extends { failClosed?: boolean }>(input: {
  cwd: string;
  taskId: string;
  snapshot: CloseWriteRollbackSnapshot;
  commit: () => Promise<TBundle>;
}): Promise<{ bundle: TBundle; transaction: CloseWriteTransactionReport }> {
  try {
    const bundle = await input.commit();
    if (bundle.failClosed) {
      return {
        bundle,
        transaction: rollbackCloseWriteTransaction({
          cwd: input.cwd,
          taskId: input.taskId,
          snapshot: input.snapshot,
          failureStep: 'commit-bundle',
          failureCode: 'ATM_TASKFLOW_CLOSE_COMMIT_BUNDLE_FAILED',
          failureReason: 'Governed target/planning commit bundle did not complete.'
        })
      };
    }
    return {
      bundle,
      transaction: {
        schemaId: 'atm.closeWriteTransaction.v1',
        taskId: input.taskId,
        phase: 'committed',
        ok: true,
        failureStep: null,
        failureCode: null,
        rolledBackArtifacts: [],
        recoveryCommand: null,
        backendCloseApplied: true,
        commitBundleApplied: true
      }
    };
  } catch (error) {
    const failureCode = error instanceof CliError ? error.code : 'ATM_TASKFLOW_CLOSE_WRITE_FAILED';
    const failureReason = error instanceof Error ? error.message : String(error);
    return {
      bundle: { failClosed: true } as TBundle,
      transaction: rollbackCloseWriteTransaction({
        cwd: input.cwd,
        taskId: input.taskId,
        snapshot: input.snapshot,
        failureStep: 'commit-bundle',
        failureCode,
        failureReason
      })
    };
  }
}

export {
  buildHistoricalClosePreflight,
  preflightBlockersToWriteReadinessBlockers,
  type HistoricalClosePreflightSummary,
  type HistoricalClosePreflightBlocker
} from './historical-close-preflight.ts';
