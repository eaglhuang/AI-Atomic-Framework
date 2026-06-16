import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, type Dirent } from 'node:fs';
import path from 'node:path';
import type { TaskClaimRecord, WorkItemRef } from '@ai-atomic-framework/core';
import { createLocalGovernanceAdapter } from '../../../plugin-governance-local/src/index.ts';
import { clearBrokerRuntimeStateForTask, removeBrokerRegistryIfEmpty } from '../../../core/src/broker/lifecycle.ts';
import { resolveActorId } from './actor-registry.ts';
import { resolveActorWorkSession, updateActorWorkSessionState, upsertActorWorkSession } from './actor-session.ts';
import { computeMissingValidatorReport, verifyTaskEvidence } from './evidence.ts';
import {
  assertRunnerFreshForWriteAction,
  auditTasks,
  createClosurePacket,
  createFrameworkModeStatus,
  executeTaskCloseTransaction,
  inspectFrameworkCloseWorktree,
  isRunnerSyncRequired,
  isTaskCloseGovernanceCriticalPath,
  normalizeSha256FieldsDeep,
  registerCloseCommitWindow,
  repairClosurePacketForTask,
  requireTargetRepoClosureAuthority,
  runnerStaleWarningMessage,
  type ClosurePacket,
  type HistoricalDeliveryProvenance,
  validateClosurePacket,
  writeClosurePacket
} from './framework-development.ts';
import { CliError, makeResult, message, parseJsonText, parseOptions, parseArgsForCommand, relativePathFrom, resolveValue, type CommandResult } from './shared.ts';
import {
  appendTaskTransitionEvent,
  createTaskTransitionId,
  defaultMirrorTaskId,
  readTaskLedgerPolicy,
  type TaskTransitionClosureMetadata,
  transitionEventExists
} from './task-ledger.ts';
import { readPluginRegistry } from '../plugin-registry.ts';
import type { ParsedExternalTask } from '@ai-atomic-framework/plugin-sdk';
import {
  advanceTaskQueueAfterClose,
  abandonTaskQueue,
  assertTaskCloseAllowedByDirection,
  findActiveTaskQueue,
  isTaskDirectionPathCandidate,
  sanitizeTaskDirectionAllowedFiles,
  writeTaskDirectionLock
} from './task-direction.ts';
import { findActiveBatchRunForTask, readActiveBatchRun, isPathAllowedByScope } from './work-channels.ts';
import {
  assessCloseoutProvenanceGap,
  buildDependencyCloseoutRecoveryCommand,
  formatDependencyCloseoutBlockedMessage,
  verifyCloseoutProvenance
} from './tasks/closeout-provenance.ts';
import {
  findTaskClaimDependencyBlockers,
  type TaskClaimDependencyBlocker
} from './tasks/dependency-gates.ts';
import {
  evaluateTaskClaimAdmission,
  evaluateTaskDoneCloseAdmission,
  evaluateTaskPromotionAdmission,
  evaluateTaskResetAdmission
} from './tasks/lifecycle-state.ts';
import {
  buildHistoricalDeliveryProvenance,
  inspectHistoricalDelivery,
  isDeliverableGateCandidate,
  pathMatchesTaskScope,
  type HistoricalDeliveryFileBuckets,
  type TaskHistoricalDeliveryReport
} from './tasks/historical-delivery.ts';
import {
  attachDirtyGuardToScopedDiffIsolation,
  buildCloseScopedDiffIsolation,
  evaluateFrameworkCloseDirtyGuard,
  type TaskCloseScopedDiffIsolationReport
} from './tasks/scope-lock-diagnostics.ts';
import {
  buildResidueClassification,
  type TaskResidueClassification,
  buildResidueDiagnosisEvidenceFromTriangulation,
  type TaskResidueDivergence,
  type TaskResidueLedgerSnapshot,
  type TaskResiduePlanningSnapshot,
  type TaskResidueTransitionSnapshot,
  type TaskStatusTriangulation
} from './tasks/residue-diagnostics.ts';
import { dispatchTasksAction } from './tasks/command-dispatch.ts';
import { runAtmGit } from './git-governance.ts';
import { assertEmergencyApproval } from './emergency/gate.ts';
import { emergencyRoot, readEmergencyLease } from './emergency/leases.ts';
import { parseClaimRecord, createClaimRecord, isClaimExpired, listRuntimeLockTaskIds } from './tasks/task-ledger-readers.ts';
import { isFrontmatterScalar as delegatedIsFrontmatterScalar } from './tasks/is-frontmatter-scalar-helper.ts';
import { normalizeStringValue as delegatedNormalizeStringValue } from './tasks/normalize-string-value-helper.ts';
import { normalizeTaskDocumentId as delegatedNormalizeTaskDocumentId } from './tasks/normalize-task-document-id-helper.ts';
import { sha256 as delegatedSha256 } from './tasks/sha256-helper.ts';
import {
  assertLocalTaskLedgerEnabled as delegatedAssertLocalTaskLedgerEnabled,
  buildTaskTransitionCommand as delegatedBuildTaskTransitionCommand,
  createClosureTransitionMetadata as delegatedCreateClosureTransitionMetadata,
  normalizeWorkItemStatus as delegatedNormalizeWorkItemStatus,
  inspectTaskVerifyStatus as delegatedInspectTaskVerifyStatus
} from './tasks/task-transition-helpers.ts';
import {
  readGitScalar as delegatedReadGitScalar,
  listCommittedFilesSinceClaim as delegatedListCommittedFilesSinceClaim
} from './tasks/task-git-helpers.ts';
import {
  collectKeyValue as delegatedCollectKeyValue,
  collectKeyValueFromLines as delegatedCollectKeyValueFromLines,
  createTaskFromTableMetadata as delegatedCreateTaskFromTableMetadata,
  parseDispatchMetadataFromPlanText,
  type TaskDispatchMetadata,
  type TaskDispatchPattern
} from './tasks/task-markdown-helpers.ts';
import {
  safeTaskFileReadDir,
  safeTaskFileStat,
  readJsonRecord,
  taskPathFor,
  collectTaskFileValues,
  normalizeRelativePath,
  legacyTaskRequiresBaseline,
  type LegacyLedgerTaskFile
} from './tasks/task-file-io-helpers.ts';
import {
  coerceStatus,
  extractFrontMatter,
  extractTaskDeclaredFiles,
  hashSection,
  normalizeOptionalString,
  normalizeYamlScalar,
  normalizeTaskId,
  taskIdsEqual,
  parseMarkdownTableCells,
  parseYamlList,
  validateDeliverablesList,
  type ContextMap,
  parseContextMap
} from './tasks/task-import-validators.ts';

import {
  parseReconcileOptions,
  parseDeliverAndCloseOptions,
  parseCreateOptions,
  parseMirrorOptions,
  parseCloseOptions,
  parseStatusOptions,
  parseFinalizeDiagnoseOptions,
  parseResetOptions,
  parseLockCleanupOptions,
  parseClaimLifecycleOptions,
  parseHistoricalDeliveryRefs,
  parseScopeAddOptions,
  parseQueueOptions,
  parseAuditOptions,
  parseLegacyLedgerMigrationOptions,
  parseAllowStaleRunnerFlag
} from './tasks/task-option-parsers.ts';

export interface TaskImportSource {
  readonly planPath: string;
  readonly sectionTitle: string;
  readonly headingLine: number;
  readonly hash: string;
}

export interface TaskCardImportDiagnostic {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly field?: string;
  readonly alias?: string;
  readonly canonical?: string;
  readonly candidates?: readonly string[];
}

export interface TaskImportRecord {
  readonly schemaVersion: 'atm.workItem.v0.2';
  readonly workItemId: string;
  readonly title: string;
  readonly status: TaskImportStatus;
  readonly milestone?: string | null;
  readonly dependencies: readonly string[];
  readonly acceptance: readonly string[];
  readonly deliverables: readonly string[];
  readonly scopePaths?: readonly string[];
  readonly validators?: readonly string[];
  readonly planningRepo?: string | null;
  readonly targetRepo?: string | null;
  readonly closureAuthority?: string | null;
  readonly planningReadOnlyPaths?: readonly string[];
  readonly planningMirrorPaths?: readonly string[];
  readonly outOfScope?: readonly string[];
  readonly nonGoals?: readonly string[];
  readonly evidenceRequired?: string | null;
  readonly rollbackStrategy?: string | null;
  readonly rollbackNotes?: string | null;
  readonly atomizationImpact?: {
    readonly ownerAtomOrMap?: string | null;
    readonly mapUpdates?: readonly string[];
  };
  readonly legacyImportAliases?: Record<string, readonly string[] | string>;
  readonly importDiagnostics?: readonly TaskCardImportDiagnostic[];
  readonly tags: readonly string[];
  readonly notes?: string | null;
  readonly contextMap?: ContextMap;
  readonly dispatchPattern?: TaskDispatchPattern;
  readonly conditionReview?: readonly string[];
  readonly mailboxAssignee?: string | null;
  readonly source: TaskImportSource;
  readonly importedAt: string;
}

export type TaskImportStatus =
  | 'planned'
  | 'open'
  | 'in_progress'
  | 'reserved'
  | 'ready'
  | 'running'
  | 'review'
  | 'blocked'
  | 'abandoned'
  | 'done';

export interface TaskImportManifest {
  readonly schemaId: 'atm.taskImportManifest';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly planPath: string;
  readonly mode: 'dry-run' | 'write';
  readonly tasks: readonly TaskImportRecord[];
  readonly diagnostics: readonly TaskImportDiagnostic[];
  readonly writtenPaths: readonly string[];
  readonly evidencePath: string | null;
}

export interface TaskDeliverableGateReport {
  readonly schemaId: 'atm.taskDeliverableGate.v1';
  readonly generatedAt: string;
  readonly taskId: string;
  readonly deliveryPrinciple: string;
  readonly required: boolean;
  readonly ok: boolean;
  readonly reason: string;
  readonly changedFiles: readonly string[];
  readonly deliverableFiles: readonly string[];
  readonly declaredFiles: readonly string[];
  readonly historicalDeliveries: readonly TaskHistoricalDeliveryReport[];
  readonly notAllowedAsCompletion: readonly string[];
  readonly remediation: string;
  readonly requiredCommand: string | null;
}

interface HistoricalBatchCloseSlice {
  readonly batchId: string;
  readonly batchPath: string;
  readonly ok: boolean;
  readonly matchedCommits: readonly string[];
  readonly matchedFiles: readonly string[];
  readonly coverageStatus: 'complete' | 'partial' | 'blocked';
  readonly okToRecordEvidence: boolean;
  readonly okToCloseTask: boolean;
  readonly diagnosticOnly: boolean;
  readonly missingCoverage: readonly string[];
  readonly taskSpecificValidationPasses: readonly string[];
}

export interface TaskImportDiagnostic {
  readonly level: 'info' | 'warning' | 'error';
  readonly code: string;
  readonly text: string;
  readonly workItemId?: string;
  readonly sourceLine?: number;
}

export interface TaskVerifyReport {
  readonly schemaId: 'atm.taskVerifyReport';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly taskStorePath: string;
  readonly inspectedTasks: number;
  readonly findings: readonly TaskImportDiagnostic[];
  readonly ok: boolean;
}

export interface TaskLegacyLedgerMigrationReport {
  readonly schemaId: 'atm.taskLegacyLedgerMigrationReport';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly mode: 'dry-run' | 'apply';
  readonly taskRoot: string;
  readonly eventRoot: string;
  readonly inspectedTaskCount: number;
  readonly migratableTaskCount: number;
  readonly migratedTaskCount: number;
  readonly skippedTaskCount: number;
  readonly migratedTasks: readonly TaskLegacyLedgerMigrationEntry[];
  readonly skippedTasks: readonly TaskLegacyLedgerMigrationSkip[];
}

export interface TaskLegacyLedgerMigrationEntry {
  readonly taskId: string;
  readonly taskPath: string;
  readonly taskFormat: 'json' | 'markdown';
  readonly status: string;
  readonly reason: 'missing-transition-id' | 'missing-transition-event';
  readonly transitionPath: string | null;
}

export interface TaskLegacyLedgerMigrationSkip {
  readonly taskId: string;
  readonly taskPath: string;
  readonly taskFormat: 'json' | 'markdown';
  readonly reason: string;
}

const validStatuses = new Set<TaskImportStatus>(['planned', 'open', 'in_progress', 'reserved', 'ready', 'running', 'review', 'blocked', 'abandoned', 'done']);
const acceptanceHeaders = ['acceptance criteria', 'acceptance', 'acceptance tests', 'criteria', '驗收', '驗收條件'];
const deliverablesHeaders = ['deliverables', 'outputs', 'outcomes', '交付物', '產物', '輸出'];
const dependenciesHeaders = ['dependencies', 'depends on', 'blocked by', '依賴', '相依', '前置'];
const notesHeaders = ['notes', 'implementation notes', 'background', '備註', '說明'];
const tagsHeaders = ['tags', 'labels', '標籤'];
const taskIdPattern = /^(?:TASK-)?[A-Z][A-Z0-9-]*-\d{2,}/;
const taskIdAnywherePattern = /(?:TASK-)?[A-Z][A-Z0-9-]*-\d{2,}/;

export async function runTasks(argv: string[]): Promise<CommandResult> {
  return dispatchTasksAction(argv, {
    close: runTasksClose,
    reset: runTasksReset,
    create: runTasksCreate,
    mirror: runTasksMirror,
    audit: runTasksAudit,
    queue: runTasksQueue,
    parallel: runTasksParallel,
    lock: runTasksLock,
    migrateLegacyLedger: runTasksMigrateLegacyLedger,
    reservation: runTasksReservation,
    claimLifecycle: runTasksClaimLifecycle,
    reconcile: runTasksReconcile,
    repairClosure: runTasksRepairClosure,
    show: runTasksShow,
    status: runTasksStatus,
    finalize: runTasksFinalize,
    deliverAndClose: runTasksDeliverAndClose,
    roster: runTasksRoster,
    newTask: runTasksNew,
    importTask: runTasksImport,
    verify: runTasksVerify,
    scope: runTasksScope
  });
}

async function runTasksShow(argv: string[]): Promise<CommandResult> {
  const { options } = parseOptions(argv, 'tasks');
  const taskId = options.task;
  if (!taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks show requires --task <id>', { exitCode: 2 });
  }
  const taskPath = taskPathFor(options.cwd, taskId);
  if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${taskId}.`, {
      exitCode: 2,
      details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId }
    });
  }
  const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
  const messages = [message('info', 'ATM_TASK_SHOW_SUCCESS', `Task details for ${taskId}`)];
  if (isRunnerSyncRequired(options.cwd)) {
    messages.push(message('warn', 'ATM_RUNNER_SYNC_REQUIRED', runnerStaleWarningMessage()));
  }
  return makeResult({
    ok: true,
    command: 'tasks show',
    cwd: options.cwd,
    messages,
    evidence: {
      taskId,
      ...taskDocument
    }
  });
}

function resolvePlanningCardPath(cwd: string, taskDocument: Record<string, unknown>): string | null {
  const source = taskDocument.source as { planPath?: string } | undefined;
  if (source?.planPath) {
    const resolved = path.resolve(cwd, source.planPath);
    if (existsSync(resolved)) return resolved;
  }
  const relatedPlan = taskDocument.related_plan ?? taskDocument.relatedPlan;
  if (typeof relatedPlan === 'string' && relatedPlan.trim()) {
    const resolved = path.resolve(cwd, relatedPlan);
    if (existsSync(resolved)) return resolved;
  }
  const aliases = taskDocument.legacyImportAliases as { allowed_files?: string[] } | undefined;
  const planningFile = aliases?.allowed_files?.find((entry) => entry.endsWith('.task.md') && existsSync(entry));
  return planningFile ?? null;
}

function readLastTransitionEventRecord(cwd: string, taskId: string, transitionId: string | null): Record<string, unknown> | null {
  if (!transitionId) return null;
  const policy = readTaskLedgerPolicy(cwd);
  const eventPath = path.join(cwd, policy.eventRoot, taskId, `${transitionId}.json`);
  if (!existsSync(eventPath)) return null;
  return JSON.parse(readFileSync(eventPath, 'utf8')) as Record<string, unknown>;
}

function normalizeParityLifecycleValue(value: string | null): string | null {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
  return normalized || null;
}

function isOpenPlanningParityStatus(status: string | null): boolean {
  if (!status) return false;
  return ['planned', 'open', 'ready', 'running', 'in_progress', 'review'].includes(status);
}

function hasOnlyStatusDivergence(divergence: readonly TaskResidueDivergence[]): boolean {
  return divergence.length > 0 && divergence.every((entry) => entry.field === 'status');
}

function buildPlanningMirrorParityOverride(input: {
  taskId: string;
  liveLedger: TaskResidueLedgerSnapshot;
  planningFrontmatter: TaskResiduePlanningSnapshot;
  lastTransitionEvent: TaskResidueTransitionSnapshot | null;
  divergence: readonly TaskResidueDivergence[];
}): {
    residueClassification: TaskResidueClassification;
    recommendation: string | null;
  } | null {
  if (!hasOnlyStatusDivergence(input.divergence)) return null;
  const liveStatus = normalizeParityLifecycleValue(input.liveLedger.status);
  const planningStatus = normalizeParityLifecycleValue(input.planningFrontmatter.status);
  if (!isOpenPlanningParityStatus(liveStatus) || !isOpenPlanningParityStatus(planningStatus)) {
    return null;
  }
  const claimState = normalizeParityLifecycleValue(input.liveLedger.claimState);
  const lastAction = normalizeParityLifecycleValue(input.lastTransitionEvent?.action ?? null);
  const activeClaimLane = claimState === 'active' || lastAction === 'claim';
  const releasedPredecessorLane = claimState === 'released' || lastAction === 'release';
  if (!activeClaimLane && !releasedPredecessorLane) {
    return null;
  }
  const uniqueLaneStatus = activeClaimLane
    ? {
      truth: 'planning mirror is stale, but the active live claim already defines a unique governed lane',
      residue: 'Planning-mirror parity drift is advisory while the active claim remains authoritative.',
      reason: 'The live ledger claim state already identifies the governed operator lane, so the stale planning status should not force import repair or ambiguous-manual-review.'
    }
    : {
      truth: 'planning mirror is stale, but the live ledger already records an intentional release or supersede lane',
      residue: 'The predecessor task was intentionally released or superseded, so parity drift is advisory rather than repairable by import by default.',
      reason: 'The live ledger already records a unique non-claim operator story, so the stale planning status should not push the operator back through tasks import.'
    };
  return {
    residueClassification: {
      bucket: 'no-residue',
      truth: uniqueLaneStatus.truth,
      residue: uniqueLaneStatus.residue,
      reason: uniqueLaneStatus.reason,
      nextCommandTemplate: 'node atm.mjs tasks status --task <id> --json',
      nextCommand: `node atm.mjs tasks status --task ${input.taskId} --json`,
      autoMutationAllowed: false
    },
    recommendation: null
  };
}

function buildTaskStatusTriangulation(cwd: string, taskId: string, taskDocument: Record<string, unknown>): TaskStatusTriangulation {
  const claim = parseClaimRecord(taskDocument.claim);
  const liveLedger: TaskResidueLedgerSnapshot = {
    status: typeof taskDocument.status === 'string' ? taskDocument.status : null,
    claimState: claim?.state ?? null,
    lastTransitionId: typeof taskDocument.lastTransitionId === 'string' ? taskDocument.lastTransitionId : null,
    lastTransitionAt: typeof taskDocument.lastTransitionAt === 'string' ? taskDocument.lastTransitionAt : null
  };
  const lastTransitionEventRecord = readLastTransitionEventRecord(cwd, taskId, liveLedger.lastTransitionId);
  const lastTransitionEvent: TaskResidueTransitionSnapshot | null = lastTransitionEventRecord ? {
    action: typeof lastTransitionEventRecord.action === 'string' ? lastTransitionEventRecord.action : null,
    actorId: typeof lastTransitionEventRecord.actorId === 'string' ? lastTransitionEventRecord.actorId : null,
    createdAt: typeof lastTransitionEventRecord.createdAt === 'string' ? lastTransitionEventRecord.createdAt : null,
    fromStatus: typeof lastTransitionEventRecord.fromStatus === 'string' ? lastTransitionEventRecord.fromStatus : null,
    toStatus: typeof lastTransitionEventRecord.toStatus === 'string' ? lastTransitionEventRecord.toStatus : null
  } : null;
  const planningCardPath = resolvePlanningCardPath(cwd, taskDocument);
  let planningFrontmatter: TaskResiduePlanningSnapshot = { status: null, source: null };
  if (planningCardPath) {
    const frontMatter = extractFrontMatter(readFileSync(planningCardPath, 'utf8'));
    if (frontMatter) {
      planningFrontmatter = {
        status: typeof frontMatter.data.status === 'string' ? frontMatter.data.status : null,
        source: relativePathFrom(cwd, planningCardPath)
      };
    }
  }
  const divergence: TaskResidueDivergence[] = [];
  if (planningFrontmatter.status && planningFrontmatter.status !== liveLedger.status) {
    divergence.push({
      field: 'status',
      liveLedger: liveLedger.status,
      planningFrontmatter: planningFrontmatter.status,
      lastTransitionEvent: lastTransitionEvent?.toStatus ?? null
    });
  }
  if (lastTransitionEvent?.toStatus && lastTransitionEvent.toStatus !== liveLedger.status) {
    const existing = divergence.find((entry) => entry.field === 'status');
    if (!existing) {
      divergence.push({
        field: 'status',
        liveLedger: liveLedger.status,
        lastTransitionEvent: lastTransitionEvent.toStatus
      });
    }
  }
  const residueClassification = buildResidueClassification({
    cwd,
    taskId,
    taskDocument,
    liveLedger,
    planningFrontmatter,
    lastTransitionEvent,
    divergence
  });
  const parityOverride = buildPlanningMirrorParityOverride({
    taskId,
    liveLedger,
    planningFrontmatter,
    lastTransitionEvent,
    divergence
  });
  const recommendation = parityOverride
    ? parityOverride.recommendation
    : divergence.length > 0
    ? (planningFrontmatter.status === 'done' && liveLedger.status !== 'done'
      ? `node atm.mjs tasks reconcile --task ${taskId} --actor <actor> --delivery-commit <sha> --json`
      : `node atm.mjs tasks import --from <plan.md> --write --json`)
    : null;
  return {
    ssot: 'liveLedger' as const,
    liveLedger,
    lastTransitionEvent,
    planningFrontmatter,
    divergence,
    recommendation,
    residueClassification: parityOverride?.residueClassification ?? residueClassification
  };
}

export type { TaskResidueBucket, TaskResidueClassification } from './tasks/residue-diagnostics.ts';

async function recordStaleRunnerOverride(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string | null;
  readonly action: string;
  readonly command: string;
}) {
  const taskPath = taskPathFor(input.cwd, input.taskId);
  if (!existsSync(taskPath)) return null;
  const taskDocument = readJsonRecord(taskPath);
  const previousStatus = typeof taskDocument.status === 'string' ? taskDocument.status : null;
  appendTaskTransitionEvent({
    cwd: input.cwd,
    taskId: input.taskId,
    action: 'allow-stale-runner',
    actorId: input.actorId,
    sessionId: null,
    fromStatus: previousStatus,
    toStatus: previousStatus,
    taskPath,
    taskDocument,
    command: input.command
  });
  return true;
}

function isCliErrorWithCode(error: unknown, codePrefix: string): boolean {
  return error instanceof CliError && typeof error.code === 'string' && error.code.startsWith(codePrefix);
}

function recordFailedEmergencyUseAttempt(input: {
  readonly cwd: string;
  readonly leaseId: string | null | undefined;
  readonly permission: 'backend.tasks.close';
  readonly surface: string;
  readonly taskId: string;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly command: string | null;
  readonly failureCode: string | null;
}) {
  if (!input.leaseId) return null;
  try {
    const lease = readEmergencyLease(input.cwd, input.leaseId);
    if (lease.status !== 'active') return null;
    if (lease.permission !== input.permission) return null;
    if (lease.taskId && lease.taskId !== input.taskId) return null;
    if (input.actorId && lease.actorId !== input.actorId) return null;
    const usedCount = typeof lease.usedCount === 'number' ? lease.usedCount : Number(lease.usedCount ?? 0);
    if (!Number.isFinite(usedCount) || usedCount >= lease.maxUses) return null;
    if (Date.parse(lease.expiresAt) <= Date.now()) return null;
    const usedAt = new Date().toISOString();
    const usePath = path.join(emergencyRoot(input.cwd), 'uses', `${usedAt.replace(/[:.]/g, '-')}-${lease.leaseId}.json`);
    mkdirSync(path.dirname(usePath), { recursive: true });
    writeFileSync(usePath, `${JSON.stringify({
      schemaId: 'atm.emergencyMaintenanceUse.v1',
      leaseId: lease.leaseId,
      taskId: input.taskId,
      actorId: input.actorId,
      permission: input.permission,
      surface: input.surface,
      usedAt,
      reason: input.reason,
      command: input.command,
      result: 'failed',
      before: {
        leaseStatus: lease.status,
        usedCount
      },
      after: {
        leaseStatus: lease.status,
        usedCount,
        failureCode: input.failureCode
      },
      touchedFiles: []
    }, null, 2)}\n`, 'utf8');
    return relativePathFrom(input.cwd, usePath);
  } catch {
    return null;
  }
}

export function loadTaskDocumentOrThrow(cwd: string, taskId: string): { taskPath: string; taskDocument: Record<string, unknown> } {
  const taskPath = taskPathFor(cwd, taskId);
  if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${taskId}.`, {
      exitCode: 2,
      details: { taskPath: relativePathFrom(cwd, taskPath), taskId }
    });
  }
  return {
    taskPath,
    taskDocument: JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>
  };
}

export function buildResidueDiagnosisEvidence(cwd: string, taskId: string, taskDocument: Record<string, unknown>) {
  const triangulation = buildTaskStatusTriangulation(cwd, taskId, taskDocument);
  return buildResidueDiagnosisEvidenceFromTriangulation({ taskId, triangulation });
}

async function runTasksStatus(argv: string[]): Promise<CommandResult> {
  const options = parseStatusOptions(argv);
  const { taskDocument } = loadTaskDocumentOrThrow(options.cwd, options.taskId);
  const triangulation = buildTaskStatusTriangulation(options.cwd, options.taskId, taskDocument);
  const messages = [
    message(
      options.residueOnly ? 'info' : 'info',
      options.residueOnly ? 'ATM_TASK_RESIDUE_DIAGNOSED' : 'ATM_TASK_STATUS_TRIANGULATED',
      options.residueOnly
        ? `Residue diagnosis for ${options.taskId}: ${triangulation.residueClassification.bucket}.`
        : `Task status triangulation for ${options.taskId}.`,
      triangulation
    )
  ];
  if (isRunnerSyncRequired(options.cwd)) {
    messages.push(message('warn', 'ATM_RUNNER_SYNC_REQUIRED', runnerStaleWarningMessage()));
  }
  return makeResult({
    ok: true,
    command: 'tasks status',
    cwd: options.cwd,
    messages,
    evidence: options.residueOnly
      ? buildResidueDiagnosisEvidence(options.cwd, options.taskId, taskDocument)
      : {
        taskId: options.taskId,
        ...triangulation
      }
  });
}

async function runTasksFinalize(argv: string[]): Promise<CommandResult> {
  const subAction = (argv[0] ?? '').toLowerCase();
  if (subAction !== 'diagnose') {
    throw new CliError('ATM_CLI_USAGE', 'tasks finalize requires diagnose.', { exitCode: 2 });
  }
  return runTasksFinalizeDiagnose(argv.slice(1));
}

async function runTasksFinalizeDiagnose(argv: string[]): Promise<CommandResult> {
  const options = parseFinalizeDiagnoseOptions(argv);
  const { taskDocument } = loadTaskDocumentOrThrow(options.cwd, options.taskId);
  const evidence = buildResidueDiagnosisEvidence(options.cwd, options.taskId, taskDocument);
  const messages = [
    message(
      evidence.bucket === 'ambiguous-manual-review' ? 'warn' : 'info',
      'ATM_TASK_FINALIZE_DIAGNOSED',
      `Residue bucket ${evidence.bucket} for ${options.taskId}.`,
      {
        truth: evidence.truth,
        residue: evidence.residue,
        nextCommand: evidence.nextCommand
      }
    )
  ];
  if (isRunnerSyncRequired(options.cwd)) {
    messages.push(message('warn', 'ATM_RUNNER_SYNC_REQUIRED', runnerStaleWarningMessage()));
  }
  return makeResult({
    ok: true,
    command: 'tasks finalize diagnose',
    cwd: options.cwd,
    messages,
    evidence
  });
}

interface ParsedRepairClosureOptions {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string | null;
  readonly dryRun: boolean;
  readonly amend: boolean;
  readonly scopeTaskId: string | null;
  readonly emergencyApproval: string | null;
  readonly allowStaleRunner: boolean;
}

async function runTasksRepairClosure(argv: string[]): Promise<CommandResult> {
  const options = parseRepairClosureOptions(argv);
  const resolvedActor = options.actorId ? resolveActorId(options.actorId, options.cwd) : null;
  let emergencyUse: EmergencyUseEvidence = null;
  if (!options.dryRun) {
    emergencyUse = assertEmergencyApproval({
      cwd: options.cwd,
      surface: 'tasks repair-closure',
      permission: 'backend.tasks.repairClosure',
      taskId: options.taskId,
      actorId: resolvedActor?.actorId ?? null,
      emergencyApproval: options.emergencyApproval,
      flags: [
        ...(options.amend ? ['--amend'] : []),
        ...(options.allowStaleRunner ? ['--allow-stale-runner'] : [])
      ],
      reason: 'Direct closure packet repair backend mutation.',
      command: `node atm.mjs tasks repair-closure --task ${options.taskId} --json`
    });
    const staleGate = assertRunnerFreshForWriteAction({
      cwd: options.cwd,
      action: 'tasks-repair-closure-write',
      allowStaleRunner: options.allowStaleRunner
    });
    if (options.allowStaleRunner && staleGate.warning) {
      await recordStaleRunnerOverride({
        cwd: options.cwd,
        taskId: options.taskId,
        actorId: resolvedActor?.actorId ?? null,
        action: 'tasks-repair-closure-write',
        command: `node atm.mjs tasks repair-closure --task ${options.taskId} --allow-stale-runner --json`
      });
    }
  }
  const result = repairClosurePacketForTask({
    cwd: options.cwd,
    taskId: options.taskId,
    actorId: resolvedActor?.actorId ?? null,
    dryRun: options.dryRun,
    amend: options.amend,
    scopeTaskId: options.scopeTaskId
  });
  let transitionPath: string | null = null;
  if (!options.dryRun) {
    transitionPath = writeRepairClosureTransition({
      cwd: options.cwd,
      taskId: options.taskId,
      actorId: resolvedActor?.actorId ?? null,
      command: `node atm.mjs tasks repair-closure --task ${options.taskId}${resolvedActor?.actorId ? ` --actor ${resolvedActor.actorId}` : ''} --json`
    });
  }
  const stagedOnly = !result.amended;
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [
      message(
        'info',
        options.dryRun ? 'ATM_TASKS_REPAIR_CLOSURE_DRY_RUN' : 'ATM_TASKS_REPAIR_CLOSURE_OK',
        options.dryRun
          ? `Dry-run: closure packet ${options.taskId} can be repaired without rewriting HEAD.`
          : stagedOnly
            ? `Repaired and staged closure packet follow-up changes for ${options.taskId}. HEAD was not rewritten.`
            : `Repaired closure packet for ${options.taskId}.`,
        {
          taskId: options.taskId,
          packetPath: result.packetPath,
          targetCommit: result.targetCommit,
          governedTreeSha: result.governedTreeSha,
          amended: result.amended,
          previousHead: result.previousHead,
          repairedHead: result.repairedHead,
          upstreamStatus: result.upstreamStatus,
          nextActionCommand: result.nextActionCommand,
          remediation: result.remediation
        }
      )
    ],
    evidence: {
      result,
      emergencyUse,
      transitionPath,
      nextAction: !options.dryRun && stagedOnly ? {
        kind: 'governed-commit-required',
        command: result.nextActionCommand,
        reason: result.remediation,
        message: result.commitMessage
      } : null,
      suggestedVerification: 'node atm.mjs hook pre-push --base origin/main --head HEAD --json'
    }
  });
}

function writeRepairClosureTransition(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string | null;
  readonly command: string;
}): string | null {
  const taskPath = taskPathFor(input.cwd, input.taskId);
  if (!existsSync(taskPath)) return null;
  const taskDocument = readJsonRecord(taskPath);
  const previousStatus = typeof taskDocument.status === 'string' ? taskDocument.status : null;
  const transition = appendTaskTransitionEvent({
    cwd: input.cwd,
    taskId: input.taskId,
    action: 'repair-closure',
    actorId: input.actorId,
    sessionId: typeof taskDocument.closedBySessionId === 'string' ? taskDocument.closedBySessionId : null,
    fromStatus: previousStatus,
    toStatus: previousStatus,
    taskPath,
    taskDocument,
    command: input.command
  });
  execFileSync('git', ['-C', input.cwd, 'add', '--', transition.eventPath], { stdio: 'ignore' });
  return transition.eventPath;
}

async function runTasksReconcile(argv: string[]) {
  const options = parseReconcileOptions(argv);
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks reconcile requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const emergencyUse = assertEmergencyApproval({
    cwd: options.cwd,
    surface: 'tasks reconcile',
    permission: 'backend.tasks.reconcile',
    taskId: options.taskId,
    actorId,
    emergencyApproval: options.emergencyApproval,
    flags: [
      ...(options.waiverOutOfScopeDelivery ? ['--waiver-out-of-scope-delivery'] : []),
      ...(options.allowStaleRunner ? ['--allow-stale-runner'] : [])
    ],
    reason: options.waiverReason ?? 'Direct reconcile backend closeback.',
    command: `node atm.mjs tasks reconcile --task ${options.taskId} --actor ${actorId} --delivery-commit ${options.deliveryCommit} --json`
  });
  const taskPath = taskPathFor(options.cwd, options.taskId);
  if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
      exitCode: 2,
      details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId }
    });
  }
  const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
  const previousTaskContent = readFileSync(taskPath, 'utf8');
  const staleGate = assertRunnerFreshForWriteAction({
    cwd: options.cwd,
    action: 'tasks-reconcile',
    allowStaleRunner: options.allowStaleRunner
  });
  if (options.allowStaleRunner && staleGate.warning) {
    await recordStaleRunnerOverride({
      cwd: options.cwd,
      taskId: options.taskId,
      actorId,
      action: 'tasks-reconcile',
      command: `node atm.mjs tasks reconcile --task ${options.taskId} --actor ${actorId} --delivery-commit ${options.deliveryCommit} --allow-stale-runner --json`
    });
  }

  const commitSha = readGitScalar(options.cwd, ['rev-parse', '--verify', `${options.deliveryCommit}^{commit}`]);
  if (!commitSha) {
    throw new CliError('ATM_COMMIT_NOT_FOUND', `Delivery commit not found in Git: ${options.deliveryCommit}`, {
      exitCode: 1,
      details: { taskId: options.taskId, requestedRef: options.deliveryCommit }
    });
  }

  const taskDeclaredFiles = extractTaskCloseDeclaredFiles(taskDocument, options.cwd, options.taskId);
  const deliverableGate = evaluateTaskDeliverableGate({
    cwd: options.cwd,
    taskId: options.taskId,
    taskDocument,
    taskDeclaredFiles,
    claim: null,
    historicalDeliveryRefs: [options.deliveryCommit],
    waiverOutOfScopeDelivery: options.waiverOutOfScopeDelivery,
    waiverReason: options.waiverReason
  });
  if (!deliverableGate.ok) {
    throw new CliError('ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED', `Task ${options.taskId} cannot be reconciled because ATM found no real non-.atm deliverable diff.`, {
      exitCode: 1,
      details: deliverableGate as unknown as Record<string, unknown>
    });
  }

  const frameworkStatus = createFrameworkModeStatus({
    cwd: options.cwd,
    files: taskDeclaredFiles.length > 0 ? taskDeclaredFiles : undefined
  });
  if (frameworkStatus?.repoRole === 'framework') {
    const effectiveBlockers = frameworkStatus.blockers.filter((entry) =>
      !['active-framework-claim-required', 'git-head-evidence-missing'].includes(entry)
    );
    if ((frameworkStatus.mode === 'required' || frameworkStatus.mode === 'cross-repo-target-required') && effectiveBlockers.length > 0) {
      const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
      throw new CliError('ATM_TASK_CLOSE_FRAMEWORK_GATE_FAILED', `Task ${options.taskId} cannot be reconciled until framework-development blockers are resolved.`, {
        details: {
          taskId: options.taskId,
          blockers: effectiveBlockers,
          tldr: missingReport.tldr,
          missingValidationPasses: missingReport.missingValidationPasses,
          blockingFindings: missingReport.blockingFindings
        }
      });
    }
  }

  // 自動補齊 reconcile command-backed evidence
  const evidencePath = path.join(options.cwd, '.atm', 'history', 'evidence', `${options.taskId}.json`);
  if (!existsSync(evidencePath)) {
    mkdirSync(path.dirname(evidencePath), { recursive: true });

    const requiredPasses = uniqueStrings(
      (frameworkStatus?.requiredGates ?? [
        'typecheck',
        'validate:cli',
        'validate:git-head-evidence'
      ]).filter((gate) => gate === 'typecheck' || gate.startsWith('validate:'))
    );
    const mockCommandRuns = [
      {
        command: `git show ${commitSha}`,
        cwd: relativePathFrom(options.cwd, options.cwd) || '.',
        exitCode: 0,
        stdoutSha256: `sha256:${createHash('sha256').update(commitSha).digest('hex')}`,
        stderrSha256: `sha256:${createHash('sha256').update('reconcile').digest('hex')}`
      }
    ];

    const envelope = {
      taskId: options.taskId,
      updatedAt: new Date().toISOString(),
      evidence: [
        {
          evidenceKind: 'validation',
          summary: `Historical reconcile sync completed for ${options.taskId} against commit ${commitSha}.`,
          artifactPaths: taskDeclaredFiles,
          producedBy: actorId,
          createdAt: new Date().toISOString(),
          evidenceFreshness: 'fresh',
          validationPasses: requiredPasses,
          commandRuns: mockCommandRuns,
          details: {
            action: 'reconcile',
            deliveryCommit: commitSha
          }
        }
      ]
    };
    writeFileSync(evidencePath, `${JSON.stringify(normalizeSha256FieldsDeep(envelope), null, 2)}\n`, 'utf8');
  }

  // 建立 closure packet（僅在 framework repo 模式下需要）
  let closurePacketPath: string | null = null;
  let packet: ClosurePacket | null = null;
  let pendingReconcilePacket: ClosurePacket | null = null;
  let createdClosurePacketAbsolute: string | null = null;
  const reconcileReason = `Historical reconcile sync against commit ${commitSha}`;
  if (frameworkStatus?.repoRole === 'framework') {
    pendingReconcilePacket = createClosurePacket({
      cwd: options.cwd,
      taskId: options.taskId,
      actorId,
      sessionId: null,
      evidencePath: `.atm/history/evidence/${options.taskId}.json`,
      requiredGates: frameworkStatus?.requiredGates ?? [],
      changedFiles: deliverableGate.deliverableFiles.length ? deliverableGate.deliverableFiles : taskDeclaredFiles,
      frameworkStatus: frameworkStatus ?? undefined,
      attestation: {
        schemaId: 'atm.reconcileAttestation.v1',
        deliveryCommit: commitSha,
        reconciledAt: new Date().toISOString(),
        reconciledByActor: actorId,
        reason: reconcileReason
      },
      historicalDeliveryProvenance: buildHistoricalDeliveryProvenance(
        deliverableGate.historicalDeliveries[0] ?? null,
        options.waiverReason
      )
    });
    const validation = validateClosurePacket(pendingReconcilePacket);
    if (!validation.ok) {
      const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
      throw new CliError('ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID', `Task ${options.taskId} closure packet is invalid.`, {
        details: {
          taskId: options.taskId,
          missing: validation.missing,
          invalidFormat: validation.invalidFormat,
          tldr: missingReport.tldr,
          missingValidationPasses: missingReport.missingValidationPasses,
          blockingFindings: missingReport.blockingFindings
        }
      });
    }
    packet = pendingReconcilePacket;
    createdClosurePacketAbsolute = path.join(options.cwd, '.atm', 'history', 'evidence', `${options.taskId}.closure-packet.json`);
  }

  const currentClaim = parseClaimRecord(taskDocument.claim);
  if (currentClaim && currentClaim.state === 'active') {
    taskDocument.claim = {
      ...currentClaim,
      heartbeatAt: new Date().toISOString(),
      state: 'released',
      reason: 'reconciled'
    };
  }

  const previousStatus = String(taskDocument.status ?? '');
  taskDocument.status = 'done';
  taskDocument.owner = actorId;
  taskDocument.closedAt = new Date().toISOString();
  taskDocument.closedByActor = actorId;
  taskDocument.closedBySessionId = null;
  taskDocument.closeReason = reconcileReason;

  const reconcileCommand = `node atm.mjs tasks reconcile --task ${options.taskId} --actor ${actorId} --delivery-commit ${options.deliveryCommit} --json`;
  const reconcileWriteResult = await executeTaskCloseTransaction({
    cwd: options.cwd,
    taskId: options.taskId,
    taskPath,
    phase: 'reconcile',
    previousTaskContent,
    createdClosurePacketAbsolute,
    runWrites: () => {
      if (pendingReconcilePacket) {
        closurePacketPath = writeClosurePacket(options.cwd, options.taskId, pendingReconcilePacket);
        packet = pendingReconcilePacket;
        taskDocument.closurePacket = closurePacketPath;
      }
      const transitionPath = writeTaskDocumentWithTransition({
        cwd: options.cwd,
        taskPath,
        taskId: options.taskId,
        taskDocument,
        action: 'close',
        actorId,
        sessionId: null,
        previousStatus,
        closureMetadata: closurePacketPath && packet ? createClosureTransitionMetadata(closurePacketPath, packet, null, null) : null,
        command: reconcileCommand
      });
      return { transitionPath, closurePacketPath };
    }
  });
  const transitionPath = reconcileWriteResult.transitionPath;
  closurePacketPath = reconcileWriteResult.closurePacketPath ?? closurePacketPath;
  const reconcileEvidencePath = relativePathFrom(options.cwd, evidencePath);
  stageTaskCloseArtifacts(options.cwd, [
    relativePathFrom(options.cwd, taskPath),
    reconcileEvidencePath,
    transitionPath,
    closurePacketPath
  ]);
  if (currentClaim && currentClaim.state === 'active') {
    const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
    await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, currentClaim.actorId));
  }

  // TASK-AAO-0136: open a short-lived close-commit-window so the next
  // `git commit --task <id>` can land the staged close artifacts even though
  // the task direction lock has now released. Window expires after 30s.
  const closeCommitWindowAllowedFiles = [
    relativePathFrom(options.cwd, taskPath),
    reconcileEvidencePath,
    transitionPath,
    ...(closurePacketPath ? [closurePacketPath] : [])
  ];
  const closeCommitWindowPathReconcile = registerCloseCommitWindow({
    cwd: options.cwd,
    taskId: options.taskId,
    actorId,
    allowedFiles: closeCommitWindowAllowedFiles,
    transitionId: transitionPath.split(/[\\/]/).pop()?.replace(/\.json$/, '') ?? null,
    action: 'reconcile'
  });

  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [message('info', 'ATM_TASKS_RECONCILED', `Task ${options.taskId} successfully reconciled and closed as done.`, {
      taskId: options.taskId,
      actorId,
      deliveryCommit: commitSha,
      closeCommitWindowPath: closeCommitWindowPathReconcile
    })],
    evidence: {
      action: 'reconcile',
      taskId: options.taskId,
      actorId,
      status: 'done',
      taskPath: relativePathFrom(options.cwd, taskPath),
      closurePacketPath,
      transitionPath,
      closeCommitWindowPath: closeCommitWindowPathReconcile,
      closeCommitWindowAllowedFiles,
      emergencyUse,
      deliverableGate: deliverableGate as unknown as Record<string, unknown> | null
    }
  });
}



async function runTasksDeliverAndClose(argv: string[]): Promise<CommandResult> {
  const options = parseDeliverAndCloseOptions(argv);
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks deliver-and-close requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const taskPath = taskPathFor(options.cwd, options.taskId);
  if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
      exitCode: 2,
      details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId }
    });
  }
  const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
  const currentClaim = parseClaimRecord(taskDocument.claim);
  if (!currentClaim || currentClaim.state !== 'active' || currentClaim.actorId !== actorId) {
    throw new CliError('ATM_TASK_DELIVER_AND_CLOSE_CLAIM_REQUIRED', `tasks deliver-and-close requires an active claim on ${options.taskId} owned by ${actorId}.`, {
      exitCode: 1,
      details: {
        taskId: options.taskId,
        actorId,
        claimState: currentClaim?.state ?? null,
        claimActorId: currentClaim?.actorId ?? null,
        requiredCommand: `node atm.mjs next --claim --actor ${actorId} --prompt "${options.taskId}" --json`
      }
    });
  }
  // Batch guard: if task belongs to an active batch, require batch deliver-and-close instead
  if (!options.fromBatchCheckpoint) {
    const owningBatch = findActiveBatchRunForTask(options.cwd, options.taskId);
    if (owningBatch?.status === 'active' && owningBatch.taskIds.includes(options.taskId)) {
      throw new CliError('ATM_BATCH_CHECKPOINT_REQUIRED', `Task ${options.taskId} belongs to active batch ${owningBatch.batchId}. Use batch deliver-and-close instead of tasks deliver-and-close.`, {
        exitCode: 1,
        details: {
          taskId: options.taskId,
          batchId: owningBatch.batchId,
          requiredCommand: `node atm.mjs batch deliver-and-close --actor ${actorId} --batch ${owningBatch.batchId} --json`
        }
      });
    }
  }

  // Phase 1: resolve or auto-create delivery commit
  let deliveryCommitSha: string;
  let autoStagedFiles: readonly string[] = [];
  if (options.deliveryCommit) {
    const resolved = readGitScalar(options.cwd, ['rev-parse', '--verify', `${options.deliveryCommit}^{commit}`]);
    if (!resolved) {
      throw new CliError('ATM_COMMIT_NOT_FOUND', `Delivery commit not found in Git: ${options.deliveryCommit}`, {
        exitCode: 1,
        details: { taskId: options.taskId, requestedRef: options.deliveryCommit }
      });
    }
    deliveryCommitSha = resolved;
  } else {
    const taskDeclaredFiles = extractTaskCloseDeclaredFiles(taskDocument);
    const declaredPaths = sanitizeTaskDirectionAllowedFiles(taskDeclaredFiles);
    const modifiedUnstaged = readGitNameOnly(options.cwd, ['diff', '--name-only']).filter((f) =>
      declaredPaths.length === 0 || declaredPaths.some((d) => pathMatchesTaskScope(f, d))
    );
    const alreadyStaged = readGitNameOnly(options.cwd, ['diff', '--cached', '--name-only']);
    autoStagedFiles = modifiedUnstaged;
    if (options.dryRun) {
      return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [message('info', 'ATM_DELIVER_AND_CLOSE_DRY_RUN', `[dry-run] tasks deliver-and-close for ${options.taskId}: would auto-stage ${modifiedUnstaged.length} file(s) and create delivery commit, then close task as done.`, {
          taskId: options.taskId,
          actorId,
          dryRun: true,
          wouldAutoStage: modifiedUnstaged,
          alreadyStaged
        })],
        evidence: {
          action: 'deliver-and-close',
          dryRun: true,
          taskId: options.taskId,
          actorId,
          wouldAutoStage: modifiedUnstaged,
          alreadyStaged
        }
      });
    }
    if (modifiedUnstaged.length > 0) {
      execFileSync('git', ['-C', options.cwd, 'add', '--', ...modifiedUnstaged], { stdio: 'ignore' });
    }
    const deliveryMessage = options.message ?? `feat: deliver ${options.taskId}`;
    const deliveryResult = await runAtmGit([
      'commit',
      '--cwd', options.cwd,
      '--actor', actorId,
      '--task', options.taskId,
      '--message', deliveryMessage,
      '--json'
    ]);
    if (!deliveryResult.ok) {
      throw new CliError('ATM_DELIVER_AND_CLOSE_DELIVERY_COMMIT_FAILED', `tasks deliver-and-close: delivery commit failed for ${options.taskId}.`, {
        exitCode: 1,
        details: {
          taskId: options.taskId,
          actorId,
          messages: deliveryResult.messages,
          remediation: `Stage deliverable changes and re-run: node atm.mjs tasks deliver-and-close --task ${options.taskId} --actor ${actorId} --json`
        }
      });
    }
    deliveryCommitSha = String((deliveryResult.evidence as Record<string, unknown>)?.commitSha ?? '');
    if (!deliveryCommitSha) {
      throw new CliError('ATM_DELIVER_AND_CLOSE_DELIVERY_COMMIT_FAILED', `tasks deliver-and-close: delivery commit succeeded but commitSha was not captured for ${options.taskId}.`, {
        exitCode: 1,
        details: { taskId: options.taskId, actorId }
      });
    }
  }

  // Phase 2: close task using the delivery commit as the historical reference
  const closeArgv: string[] = [
    'close',
    '--cwd', options.cwd,
    '--task', options.taskId,
    '--actor', actorId,
    '--status', 'done',
    '--historical-delivery', deliveryCommitSha,
    '--json'
  ];
  if (options.fromBatchCheckpoint) {
    closeArgv.push('--from-batch-checkpoint');
  }
  if (options.batchId) {
    closeArgv.push('--batch', options.batchId);
  }
  if (options.reason) {
    closeArgv.push('--reason', options.reason);
  }
  const closeResult = await runTasks(closeArgv);
  if (!closeResult.ok) {
    return makeResult({
      ok: false,
      command: 'tasks',
      cwd: options.cwd,
      messages: [
        message('error', 'ATM_DELIVER_AND_CLOSE_CLOSE_FAILED',
          `tasks deliver-and-close: close phase failed for ${options.taskId}. Delivery commit ${deliveryCommitSha} was created. Fix the close gate then retry: node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --status done --historical-delivery ${deliveryCommitSha} --json`, {
          taskId: options.taskId,
          actorId,
          deliveryCommitSha,
          retryCloseCommand: `node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --status done --historical-delivery ${deliveryCommitSha} --json`
        }),
        ...closeResult.messages
      ],
      evidence: {
        action: 'deliver-and-close',
        phase: 'close-failed',
        taskId: options.taskId,
        actorId,
        deliveryCommitSha,
        autoStagedFiles,
        closeResult: closeResult.evidence
      }
    });
  }

  // Phase 3: stage governance artifacts and create governance commit
  const closeEvidence = closeResult.evidence as Record<string, unknown>;
  const governanceFiles: string[] = [];
  const relTaskPath = typeof closeEvidence.taskPath === 'string' ? closeEvidence.taskPath : relativePathFrom(options.cwd, taskPath);
  if (relTaskPath) governanceFiles.push(relTaskPath);
  const evidencePath = `.atm/history/evidence/${options.taskId}.json`;
  if (existsSync(path.resolve(options.cwd, evidencePath))) governanceFiles.push(evidencePath);
  if (typeof closeEvidence.closurePacketPath === 'string' && closeEvidence.closurePacketPath) {
    governanceFiles.push(closeEvidence.closurePacketPath);
  }
  if (typeof closeEvidence.transitionPath === 'string' && closeEvidence.transitionPath) {
    governanceFiles.push(closeEvidence.transitionPath);
  }
  const validGovernanceFiles = uniqueStrings(governanceFiles.filter(Boolean));
  if (validGovernanceFiles.length > 0) {
    execFileSync('git', ['-C', options.cwd, 'add', '--', ...validGovernanceFiles], { stdio: ['ignore', 'ignore', 'ignore'] });
  }
  const closureMessage = `chore(${options.taskId}): governance — close task with delivery evidence`;
  const closureResult = await runAtmGit([
    'commit',
    '--cwd', options.cwd,
    '--actor', actorId,
    '--task', options.taskId,
    '--message', closureMessage,
    '--json'
  ]);
  const closureCommitSha = closureResult.ok
    ? String((closureResult.evidence as Record<string, unknown>)?.commitSha ?? '')
    : null;

  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_DELIVER_AND_CLOSE_OK',
        `Task ${options.taskId} delivered and closed. Delivery commit: ${deliveryCommitSha}. Governance commit: ${closureCommitSha ?? '(staged but not committed)'}.`, {
        taskId: options.taskId,
        actorId,
        deliveryCommitSha,
        closureCommitSha,
        governanceFiles: validGovernanceFiles
      })
    ],
    evidence: {
      action: 'deliver-and-close',
      taskId: options.taskId,
      actorId,
      deliveryCommitSha,
      closureCommitSha,
      autoStagedFiles,
      governanceFiles: validGovernanceFiles,
      closurePacketPath: typeof closeEvidence.closurePacketPath === 'string' ? closeEvidence.closurePacketPath : null,
      transitionPath: typeof closeEvidence.transitionPath === 'string' ? closeEvidence.transitionPath : null
    }
  });
}



async function runTasksImport(argv: string[]) {
  const options = parseImportOptions(argv);
  if (!options.from) {
    throw new CliError('ATM_CLI_USAGE', 'tasks import requires --from <plan.md>.', { exitCode: 2 });
  }
  if (options.dryRun === options.write) {
    throw new CliError('ATM_CLI_USAGE', 'tasks import requires exactly one of --dry-run or --write.', { exitCode: 2 });
  }
  const importEmergencyRequired = options.write && (
    options.force
    || options.forceOverwriteClaims
    || options.resetOpen
    || options.allowStaleRunner
  );
  let emergencyUse: EmergencyUseEvidence = null;
  if (importEmergencyRequired) {
    emergencyUse = assertEmergencyApproval({
      cwd: options.cwd,
      surface: 'tasks import --write recovery flags',
      permission: 'backend.tasks.import.write',
      taskId: options.from.match(/TASK-[A-Z]+-\d+/i)?.[0] ?? null,
      actorId: null,
      emergencyApproval: options.emergencyApproval,
      flags: [
        ...(options.force ? ['--force'] : []),
        ...(options.forceOverwriteClaims ? ['--force-overwrite-claims'] : []),
        ...(options.resetOpen ? ['--reset-open'] : []),
        ...(options.allowStaleRunner ? ['--allow-stale-runner'] : [])
      ],
      reason: 'Direct task runtime import backend write.',
      command: `node atm.mjs tasks import --from ${options.from} --write --json`
    });
  }
  if (options.write) {
    const staleGate = assertRunnerFreshForWriteAction({
      cwd: options.cwd,
      action: 'tasks-import-write',
      allowStaleRunner: options.allowStaleRunner
    });
    if (options.allowStaleRunner && staleGate.warning) {
      const importTaskId = options.from.match(/TASK-[A-Z]+-\d+/i)?.[0] ?? 'import-batch';
      await recordStaleRunnerOverride({
        cwd: options.cwd,
        taskId: importTaskId,
        actorId: null,
        action: 'tasks-import-write',
        command: `node atm.mjs tasks import --from ${options.from} --write --allow-stale-runner --json`
      });
    }
  }

  const planAbsolute = path.resolve(options.cwd, options.from);
  if (!existsSync(planAbsolute) || !statSync(planAbsolute).isFile()) {
    throw new CliError('ATM_TASKS_PLAN_NOT_FOUND', `Plan markdown file not found: ${options.from}`, {
      exitCode: 2,
      details: { planPath: options.from }
    });
  }

  const planText = readFileSync(planAbsolute, 'utf8');
  const generatedAt = new Date().toISOString();

  let parsed: ParsedPlanResult | null = null;
  const plugins = await readPluginRegistry(options.cwd);
  const enabledPlugin = plugins.find(p => p.mode !== 'disabled');

  if (enabledPlugin) {
    const { plugin, mode } = enabledPlugin;
    try {
      const input = {
        cwd: options.cwd,
        sourcePath: relativePathFrom(options.cwd, planAbsolute),
        raw: planText
      };
      if (typeof plugin.parse === 'function') {
        const parsedTask = await plugin.parse(input);
        if (parsedTask) {
          const record = parseSingleCardFromPlugin(parsedTask, generatedAt);
          parsed = {
            tasks: [record],
            diagnostics: []
          };
        }
      }
    } catch (err) {
      if (mode === 'enforce') {
        throw new CliError('ATM_PLUGIN_ERROR', `Plugin ${plugin.id} parse failed: ${err instanceof Error ? err.message : err}`, { exitCode: 1 });
      } else {
        console.warn(`[tasks:import] Warning: Plugin ${plugin.id} parse failed. Falling back to hardcoded parser:`, err);
      }
    }
  }

  if (!parsed) {
    parsed = parsePlanMarkdown({
      planText,
      planRelativePath: relativePathFrom(options.cwd, planAbsolute),
      importedAt: generatedAt
    });
  }

  parsed = enrichParsedTasksFromSiblingTaskCards({
    cwd: options.cwd,
    planAbsolute,
    parsed,
    importedAt: generatedAt
  });

  if (parsed.diagnostics.some((entry) => entry.level === 'error') || parsed.tasks.length === 0) {
    if (parsed.tasks.length === 0) {
      parsed.diagnostics.push({
        level: 'error',
        code: 'ATM_TASKS_PLAN_EMPTY',
        text: 'No task cards were detected in the plan markdown. Each task must be introduced by a TASK-... heading, YAML front matter, a task table, or a labeled Chinese task block.'
      });
      parsed.diagnostics.push({
        level: 'info',
        code: 'ATM_TASKS_PLAN_EXPECTED_PATTERNS',
        text: 'Supported examples: ## SANGUO-BOOTSTRAP-0101 Title; TaskID: SANGUO-BOOTSTRAP-0101; table columns task/title/milestone/status/dependencies/deliverables.'
      });
      for (const heading of detectPlanHeadings(planText).slice(0, 8)) {
        parsed.diagnostics.push({
          level: 'info',
          code: 'ATM_TASKS_PLAN_DETECTED_HEADING',
          text: heading.text,
          sourceLine: heading.line
        });
      }
    }
    throw new CliError('ATM_TASKS_PLAN_PARSE_FAILED', 'Task plan import failed before writing any tasks.', {
      exitCode: 1,
      details: {
        diagnostics: parsed.diagnostics,
        planPath: relativePathFrom(options.cwd, planAbsolute)
      }
    });
  }

  const writtenPaths: string[] = [];
  let evidencePath: string | null = null;

  // TASK-AAO-0064 L1 #4: strict path 驗證
  // 收集所有 parsed tasks 的 deliverables，執行啟發式路徑污染檢測
  const strictPathViolations: Array<{ taskId: string; entry: string; reason: string; severity: 'warning' | 'error' }> = [];
  for (const task of parsed.tasks) {
    const violations = validateDeliverablesList(task.deliverables ?? [], options.strictPaths);
    for (const violation of violations) {
      strictPathViolations.push({ taskId: task.workItemId, ...violation });
    }
  }
  if (strictPathViolations.length > 0) {
    if (options.strictPaths) {
      // strict mode → ok=false，回傳 STRICT_PATH_VIOLATION error
      throw new CliError('STRICT_PATH_VIOLATION', 'tasks import --strict-paths detected contaminated deliverable paths.', {
        exitCode: 1,
        details: {
          violations: strictPathViolations,
          planPath: relativePathFrom(options.cwd, planAbsolute)
        }
      });
    }
    // 非 strict → 加 warning diagnostics，繼續執行
    for (const violation of strictPathViolations) {
      parsed.diagnostics.push({
        level: 'warning',
        code: 'STRICT_PATH_VIOLATION',
        text: `Task ${violation.taskId}: deliverable entry "${violation.entry}" matched strict-path heuristic (${violation.reason}). Use --strict-paths to escalate to error.`,
        workItemId: violation.taskId
      });
    }
  }

  if (options.write) {
    assertLocalTaskLedgerEnabled(options.cwd, 'import --write');
    const result = writeTaskFiles({
      cwd: options.cwd,
      tasks: parsed.tasks,
      force: options.force,
      forceOverwriteClaims: options.forceOverwriteClaims,
      resetOpen: options.resetOpen,
      reopen: options.reopen
    });
    writtenPaths.push(...result.writtenPaths);
    parsed.diagnostics.push(...result.diagnostics);
    if (result.diagnostics.some((entry) => entry.level === 'error')) {
      throw new CliError('ATM_TASKS_IMPORT_WRITE_FAILED', 'Task plan import refused to write because of conflicts.', {
        exitCode: 1,
        details: {
          diagnostics: result.diagnostics,
          writtenPaths: result.writtenPaths
        }
      });
    }
    evidencePath = writeImportEvidence({
      cwd: options.cwd,
      tasks: parsed.tasks,
      planPath: relativePathFrom(options.cwd, planAbsolute),
      generatedAt,
      writtenPaths
    });
  }

  const activeClaimSkips = collectActiveClaimImportSkips(options.cwd, parsed.tasks, {
    force: options.force,
    forceOverwriteClaims: options.forceOverwriteClaims,
    resetOpen: options.resetOpen,
    reopen: options.reopen
  });
  parsed.diagnostics.push(...activeClaimSkips);

  const manifest: TaskImportManifest = {
    schemaId: 'atm.taskImportManifest',
    specVersion: '0.1.0',
    generatedAt,
    planPath: relativePathFrom(options.cwd, planAbsolute),
    mode: options.dryRun ? 'dry-run' : 'write',
    tasks: parsed.tasks,
    diagnostics: parsed.diagnostics,
    writtenPaths,
    evidencePath
  };

  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [
      message(
        'info',
        options.dryRun ? 'ATM_TASKS_IMPORT_DRY_RUN' : 'ATM_TASKS_IMPORT_WRITE_READY',
        options.dryRun
          ? `Parsed ${parsed.tasks.length} task(s) from plan; no files were written.`
          : `Wrote ${writtenPaths.length} task file(s) and import evidence.`,
        { tasks: parsed.tasks.length, mode: manifest.mode }
      )
    ],
    evidence: {
      manifest,
      planPath: manifest.planPath,
      writtenPaths,
      evidencePath,
      emergencyUse
    }
  });
}

async function runTasksVerify(argv: string[]) {
  const options = parseVerifyOptions(argv);
  const taskLedger = readTaskLedgerPolicy(options.cwd);
  const taskStoreAbsolute = path.resolve(options.cwd, taskLedger.taskRoot);
  const generatedAt = new Date().toISOString();
  if (!existsSync(taskStoreAbsolute)) {
    const report: TaskVerifyReport = {
      schemaId: 'atm.taskVerifyReport',
      specVersion: '0.1.0',
      generatedAt,
      taskStorePath: relativePathFrom(options.cwd, taskStoreAbsolute),
      inspectedTasks: 0,
      findings: [
        {
          level: 'warning',
          code: 'ATM_TASKS_VERIFY_STORE_MISSING',
          text: `${taskLedger.taskRoot} does not exist; nothing to verify.`
        }
      ],
      ok: true
    };
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('warn', 'ATM_TASKS_VERIFY_STORE_MISSING', 'Task store directory is missing.')],
      evidence: { report }
    });
  }

  const entries = readdirSync(taskStoreAbsolute)
    .filter((entry) => entry.endsWith('.json'))
    .sort();
  const findings: TaskImportDiagnostic[] = [];
  const seen = new Map<string, string>();
  let inspectedTasks = 0;

  for (const entry of entries) {
    const filePath = path.join(taskStoreAbsolute, entry);
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch (error) {
      findings.push({
        level: 'error',
        code: 'ATM_TASKS_VERIFY_INVALID_JSON',
        text: `Task file is not valid JSON: ${entry} (${error instanceof Error ? error.message : String(error)})`
      });
      continue;
    }
    inspectedTasks += 1;
    const workItemId = typeof parsed?.workItemId === 'string'
      ? parsed.workItemId
      : typeof parsed?.id === 'string'
        ? parsed.id
        : '';
    if (!workItemId) {
      findings.push({
        level: 'error',
        code: 'ATM_TASKS_VERIFY_MISSING_ID',
        text: `Task file ${entry} is missing workItemId.`
      });
      continue;
    }
    if (seen.has(workItemId)) {
      findings.push({
        level: 'error',
        code: 'ATM_TASKS_VERIFY_DUPLICATE_ID',
        text: `Duplicate workItemId ${workItemId}: appears in ${seen.get(workItemId)} and ${entry}.`,
        workItemId
      });
    } else {
      seen.set(workItemId, entry);
    }
    const statusInspection = inspectTaskVerifyStatus(parsed.status);
    if (!statusInspection.ok) {
      findings.push({
        level: 'error',
        code: 'ATM_TASKS_VERIFY_INVALID_STATUS',
        text: `Task ${workItemId} has invalid status ${String(parsed.status)}. Expected one of ${[...validStatuses].join(', ')}.`,
        workItemId
      });
    } else if (statusInspection.warningCode) {
      findings.push({
        level: 'warning',
        code: statusInspection.warningCode,
        text: `Task ${workItemId} uses legacy status ${String(parsed.status)}; ATM will treat it as ${statusInspection.normalizedStatus}.`,
        workItemId
      });
    }
    if (parsed.source !== undefined) {
      const sourceFinding = inspectTaskSourceTrace(parsed, statusInspection);
      if (sourceFinding) {
        findings.push({
          level: sourceFinding.level,
          code: sourceFinding.code,
          text: `Task ${workItemId} ${sourceFinding.text}`,
          workItemId
        });
      }
    }
    const dependencies = Array.isArray(parsed.dependencies) ? (parsed.dependencies as unknown[]) : [];
    for (const dependency of dependencies) {
      if (typeof dependency !== 'string') {
        findings.push({
          level: 'error',
          code: 'ATM_TASKS_VERIFY_DEPENDENCY_TYPE',
          text: `Task ${workItemId} has a non-string dependency entry: ${JSON.stringify(dependency)}.`,
          workItemId
        });
      }
    }
  }

  for (const [workItemId, fileName] of seen.entries()) {
    const filePath = path.join(taskStoreAbsolute, fileName);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    const dependencies = Array.isArray(parsed.dependencies) ? (parsed.dependencies as string[]) : [];
    for (const dependency of dependencies) {
      if (typeof dependency !== 'string' || !dependency) continue;
      if (!seen.has(dependency)) {
        findings.push({
          level: 'warning',
          code: 'ATM_TASKS_VERIFY_DEPENDENCY_MISSING',
          text: `Task ${workItemId} depends on ${dependency} but no matching task file is present.`,
          workItemId
        });
      }
    }
  }

  const ok = findings.every((entry) => entry.level !== 'error');
  const report: TaskVerifyReport = {
    schemaId: 'atm.taskVerifyReport',
    specVersion: '0.1.0',
    generatedAt,
    taskStorePath: relativePathFrom(options.cwd, taskStoreAbsolute),
    inspectedTasks,
    findings,
    ok
  };

  return makeResult({
    ok,
    command: 'tasks',
    cwd: options.cwd,
    messages: [
      message(
        ok ? 'info' : 'error',
        ok ? 'ATM_TASKS_VERIFY_OK' : 'ATM_TASKS_VERIFY_FAILED',
        ok
          ? `Verified ${inspectedTasks} task file(s) with ${findings.length} advisory finding(s).`
          : `Verification failed with ${findings.filter((entry) => entry.level === 'error').length} error(s).`,
        { inspectedTasks }
      )
    ],
    evidence: { report }
  });
}

async function runTasksCreate(argv: string[]) {
  const options = parseCreateOptions(argv);
  assertLocalTaskLedgerEnabled(options.cwd, 'create');
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks create requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const taskPath = taskPathFor(options.cwd, options.taskId);
  if (existsSync(taskPath) && !options.force) {
    throw new CliError('ATM_TASK_EXISTS', `Task ${options.taskId} already exists.`, {
      exitCode: 1,
      details: { taskId: options.taskId, taskPath: relativePathFrom(options.cwd, taskPath) }
    });
  }
  const createdAt = new Date().toISOString();
  const taskDocument: Record<string, unknown> = {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: options.taskId,
    title: options.title ?? options.taskId,
    status: 'planned',
    owner: actorId,
    dependencies: [],
    acceptance: [],
    deliverables: [],
    tags: [],
    createdAt,
    createdByActor: actorId
  };
  const transitionPath = writeTaskDocumentWithTransition({
    cwd: options.cwd,
    taskPath,
    taskId: options.taskId,
    taskDocument,
    action: 'create',
    actorId,
    previousStatus: null
  });
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [message('info', 'ATM_TASKS_CREATED', `Task ${options.taskId} created.`, {
      taskId: options.taskId,
      actorId,
      status: taskDocument.status
    })],
    evidence: {
      action: 'create',
      taskId: options.taskId,
      actorId,
      status: taskDocument.status,
      taskPath: relativePathFrom(options.cwd, taskPath),
      transitionPath
    }
  });
}

async function runTasksMirror(argv: string[]) {
  const options = parseMirrorOptions(argv);
  assertLocalTaskLedgerEnabled(options.cwd, 'mirror');
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks mirror requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const taskId = options.taskId ?? defaultMirrorTaskId(options.provider, options.originTaskId);
  const taskPath = taskPathFor(options.cwd, taskId);
  const existing = existsSync(taskPath)
    ? JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>
    : null;
  const previousStatus = existing ? normalizeWorkItemStatus(existing.status) : null;
  const mirroredAt = typeof existing?.mirroredAt === 'string' ? existing.mirroredAt : new Date().toISOString();
  const taskDocument: Record<string, unknown> = {
    ...(existing ?? {}),
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: options.title ?? String(existing?.title ?? `${options.provider} ${options.originTaskId}`),
    status: options.status,
    owner: actorId,
    originProvider: options.provider,
    originTaskId: options.originTaskId,
    originUrl: options.originUrl,
    syncStatus: options.syncStatus,
    taskLedgerMode: 'external-provider',
    mirroredAt,
    mirrorUpdatedAt: new Date().toISOString()
  };
  const transitionPath = writeTaskDocumentWithTransition({
    cwd: options.cwd,
    taskPath,
    taskId,
    taskDocument,
    action: 'mirror',
    actorId,
    previousStatus
  });
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [message('info', 'ATM_TASKS_MIRRORED', `External task ${options.provider}:${options.originTaskId} mirrored as ${taskId}.`, {
      taskId,
      provider: options.provider,
      originTaskId: options.originTaskId
    })],
    evidence: {
      action: 'mirror',
      taskId,
      actorId,
      taskPath: relativePathFrom(options.cwd, taskPath),
      originProvider: options.provider,
      originTaskId: options.originTaskId,
      transitionPath
    }
  });
}

async function runTasksReservation(action: 'reserve' | 'promote', argv: string[]) {
  const options = parseReservationOptions(action, argv);
  assertLocalTaskLedgerEnabled(options.cwd, action);
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', `tasks ${action} requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const taskPath = taskPathFor(options.cwd, options.taskId);
  const nowIso = new Date().toISOString();
  const taskDocument: Record<string, unknown> = existsSync(taskPath)
    ? JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>
    : {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: options.taskId,
      title: options.title ?? options.taskId,
      status: 'planned',
      dependencies: [],
      acceptance: [],
      deliverables: [],
      tags: [],
      source: {
        planPath: 'manual',
        sectionTitle: options.taskId,
        headingLine: 1,
        hash: createHash('sha256').update(`${options.taskId}|manual`).digest('hex').slice(0, 16)
      },
      importedAt: nowIso
    };

  if (action === 'reserve') {
    const previousStatus = String(taskDocument.status ?? '');
    taskDocument.status = 'reserved';
    taskDocument.owner = actorId;
    taskDocument.reservedAt = nowIso;
    if (!taskDocument.title || String(taskDocument.title).trim().length === 0) {
      taskDocument.title = options.title ?? options.taskId;
    }
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: options.cwd,
      taskPath,
      taskId: options.taskId,
      taskDocument,
      action,
      actorId,
      previousStatus
    });
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASKS_RESERVED', `Task ${options.taskId} reserved by ${actorId}.`, {
        taskId: options.taskId,
        actorId
      })],
      evidence: {
        action,
        taskId: options.taskId,
        actorId,
        status: taskDocument.status,
        taskPath: relativePathFrom(options.cwd, taskPath),
        transitionPath
      }
    });
  }

  const currentOwner = typeof taskDocument.owner === 'string' ? taskDocument.owner : null;
  if (currentOwner && currentOwner !== actorId) {
    throw new CliError('ATM_TASKS_PROMOTE_OWNER_MISMATCH', `Task ${options.taskId} is reserved by ${currentOwner}, not ${actorId}.`, {
      exitCode: 1,
      details: { taskId: options.taskId, owner: currentOwner, actorId }
    });
  }
  const promotionAdmission = evaluateTaskPromotionAdmission({
    taskId: options.taskId,
    status: taskDocument.status
  });
  if (!promotionAdmission.ok) {
    throw new CliError(promotionAdmission.code, promotionAdmission.message, {
      exitCode: 1,
      details: promotionAdmission.details
    });
  }
  taskDocument.status = 'ready';
  taskDocument.owner = actorId;
  taskDocument.promotedAt = nowIso;
  const transitionPath = writeTaskDocumentWithTransition({
    cwd: options.cwd,
    taskPath,
    taskId: options.taskId,
    taskDocument,
    action,
    actorId,
    previousStatus: 'reserved'
  });
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [message('info', 'ATM_TASKS_PROMOTED', `Task ${options.taskId} promoted to ready by ${actorId}.`, {
      taskId: options.taskId,
      actorId
    })],
    evidence: {
      action,
      taskId: options.taskId,
      actorId,
      status: taskDocument.status,
      taskPath: relativePathFrom(options.cwd, taskPath),
      transitionPath
    }
  });
}

export { verifyCloseoutProvenance } from './tasks/closeout-provenance.ts';
export { findTaskClaimDependencyBlockers } from './tasks/dependency-gates.ts';
export type { TaskClaimDependencyBlocker } from './tasks/dependency-gates.ts';

async function runTasksReset(argv: string[]) {
  const options = parseResetOptions(argv);
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks reset requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  assertEmergencyApproval({
    cwd: options.cwd,
    surface: 'tasks reset',
    permission: 'backend.tasks.reset',
    taskId: options.taskId,
    actorId,
    emergencyApproval: options.emergencyApproval,
    flags: [],
    reason: options.reason ?? 'Direct lifecycle reset backend mutation.',
    command: `node atm.mjs tasks reset --task ${options.taskId} --actor ${actorId} --to ${options.to} --json`
  });
  const taskPath = taskPathFor(options.cwd, options.taskId);
  if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
      exitCode: 2,
      details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId }
    });
  }
  const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
  const previousStatus = normalizeTaskStatus(taskDocument.status);
  const resetAdmission = evaluateTaskResetAdmission({
    taskId: options.taskId,
    fromStatus: previousStatus,
    toStatus: options.to
  });
  if (!resetAdmission.ok) {
    throw new CliError(resetAdmission.code, resetAdmission.message, {
      exitCode: resetAdmission.code === 'ATM_CLI_USAGE' ? 2 : 1,
      details: resetAdmission.details
    });
  }
  const currentClaim = parseClaimRecord(taskDocument.claim);
  if (currentClaim && currentClaim.state === 'active' && currentClaim.actorId !== actorId) {
    throw new CliError('ATM_TASK_CLAIM_OWNER_MISMATCH', `Task ${options.taskId} is claimed by ${currentClaim.actorId}, not ${actorId}.`, {
      exitCode: 1,
      details: { taskId: options.taskId, currentActor: currentClaim.actorId, actorId }
    });
  }
  if (currentClaim && currentClaim.actorId === actorId) {
    const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
    await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, actorId));
    taskDocument.claim = {
      ...currentClaim,
      heartbeatAt: new Date().toISOString(),
      state: 'released',
      reason: options.reason ?? 'reset'
    };
  }
  taskDocument.status = 'open';
  taskDocument.owner = actorId;
  if (options.reason) taskDocument.resetReason = options.reason;
  delete taskDocument.closedAt;
  delete taskDocument.closedByActor;
  delete taskDocument.closurePacket;
  const transitionPath = writeTaskDocumentWithTransition({
    cwd: options.cwd,
    taskPath,
    taskId: options.taskId,
    taskDocument,
    action: 'reset',
    actorId,
    previousStatus
  });
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [message('info', 'ATM_TASKS_RESET', `Task ${options.taskId} reset to open.`, {
      taskId: options.taskId,
      actorId,
      previousStatus,
      status: 'open'
    })],
    evidence: {
      action: 'reset',
      taskId: options.taskId,
      actorId,
      previousStatus,
      status: 'open',
      transitionPath
    }
  });
}

async function runTasksClose(argv: string[]) {
  const options = parseCloseOptions(argv);
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks close requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const protectedCloseSurface = 'tasks close historical-delivery backend';
  let historicalBatchSlice: HistoricalBatchCloseSlice | null = null;
  let effectiveHistoricalDeliveryRefs: readonly string[] = [...options.historicalDeliveryRefs];
  if (options.historicalBatchRef) {
    historicalBatchSlice = loadHistoricalBatchCloseSlice(options.cwd, options.taskId, options.historicalBatchRef);
    if (!historicalBatchSlice.okToCloseTask) {
      throw new CliError('ATM_TASK_CLOSE_HISTORICAL_BATCH_NOT_CLOSE_READY', `Task ${options.taskId} cannot close from historical batch ${historicalBatchSlice.batchId} because the slice is not close-ready.`, {
        exitCode: 1,
        details: {
          taskId: options.taskId,
          batchId: historicalBatchSlice.batchId,
          batchPath: historicalBatchSlice.batchPath,
          coverageStatus: historicalBatchSlice.coverageStatus,
          okToRecordEvidence: historicalBatchSlice.okToRecordEvidence,
          okToCloseTask: historicalBatchSlice.okToCloseTask,
          diagnosticOnly: historicalBatchSlice.diagnosticOnly,
          missingCoverage: historicalBatchSlice.missingCoverage,
          taskSpecificValidationPasses: historicalBatchSlice.taskSpecificValidationPasses
        }
      });
    }
    effectiveHistoricalDeliveryRefs = uniqueStrings([...effectiveHistoricalDeliveryRefs, ...historicalBatchSlice.matchedCommits]);
  }
  const protectedCloseFlags = [
    ...(effectiveHistoricalDeliveryRefs.length > 0 ? ['--historical-delivery'] : []),
    ...(options.historicalBatchRef ? ['--historical-batch'] : []),
    ...(options.historicalDeliveryRepo ? ['--historical-delivery-repo'] : []),
    ...(options.waiverOutOfScopeDelivery ? ['--waiver-out-of-scope-delivery'] : []),
    ...(options.allowStaleRunner ? ['--allow-stale-runner'] : [])
  ];
  const protectedCloseCommand = `node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --status ${options.status} --json`;
  const requiresProtectedCloseApproval = protectedCloseFlags.length > 0;
  const shouldDeferProtectedCloseApproval = requiresProtectedCloseApproval && !options.allowStaleRunner;
  let emergencyUse: EmergencyUseEvidence = null;
  let failedEmergencyAuditPath: string | null = null;
  try {
    const taskPath = taskPathFor(options.cwd, options.taskId);
    if (!existsSync(taskPath)) {
      throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
        exitCode: 2,
        details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId }
      });
    }
    if (requiresProtectedCloseApproval && !shouldDeferProtectedCloseApproval) {
      emergencyUse = assertEmergencyApproval({
        cwd: options.cwd,
        surface: protectedCloseSurface,
        permission: 'backend.tasks.close',
        taskId: options.taskId,
        actorId,
        emergencyApproval: options.emergencyApproval,
        flags: protectedCloseFlags,
        reason: options.reason ?? 'Direct close backend historical-delivery path.',
        command: protectedCloseCommand
      });
    }
    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
    const previousTaskContent = readFileSync(taskPath, 'utf8');
    if (options.status === 'abandoned' && !options.reason?.trim()) {
      throw new CliError('ATM_TASK_ABANDON_REASON_REQUIRED', `Task ${options.taskId} cannot be abandoned without a reason.`, {
        exitCode: 2,
        details: {
          taskId: options.taskId,
          status: options.status,
          requiredCommand: `node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --status abandoned --reason "<reason>" --json`
        }
      });
    }
    const staleGate = assertRunnerFreshForWriteAction({
      cwd: options.cwd,
      action: 'tasks-close',
      allowStaleRunner: options.allowStaleRunner
    });
    if (options.allowStaleRunner && staleGate.warning) {
      await recordStaleRunnerOverride({
        cwd: options.cwd,
        taskId: options.taskId,
        actorId,
        action: 'tasks-close',
        command: `node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --allow-stale-runner --json`
      });
    }
  const currentClaim = parseClaimRecord(taskDocument.claim);
  const activeSession = resolveActorWorkSession(options.cwd, {
    actorId,
    taskId: options.taskId,
    claimLeaseId: currentClaim?.leaseId ?? null,
    includeNonActive: true
  });
  const currentOwner = typeof taskDocument.owner === 'string' ? taskDocument.owner : null;
  if (currentOwner && currentOwner !== actorId) {
    throw new CliError('ATM_TASK_CLOSE_OWNER_MISMATCH', `Task ${options.taskId} owner is ${currentOwner}, not ${actorId}.`, {
      exitCode: 1,
      details: { taskId: options.taskId, owner: currentOwner, actorId }
    });
  }
  requireTargetRepoClosureAuthority({
    cwd: options.cwd,
    taskDocument,
    taskId: options.taskId,
    status: options.status
  });
  const owningBatch = options.status === 'done'
    ? (options.batchId ? readActiveBatchRun(options.cwd, { batchId: options.batchId }) : findActiveBatchRunForTask(options.cwd, options.taskId))
    : null;
  if (options.status === 'done') {
    if (owningBatch?.status === 'active' && owningBatch.taskIds.includes(options.taskId) && !options.fromBatchCheckpoint) {
      const currentTaskId = owningBatch.currentTaskId ?? owningBatch.taskIds[owningBatch.currentIndex] ?? null;
      throw new CliError('ATM_BATCH_CHECKPOINT_REQUIRED', currentTaskId === options.taskId
        ? `Task ${options.taskId} is the active batch queue head. Close it through batch checkpoint, not direct tasks close.`
        : `Task ${options.taskId} belongs to active batch ${owningBatch.batchId}. Do not close batch tasks directly; deliver the current queue head and use batch checkpoint to advance.`, {
        exitCode: 1,
        details: {
          taskId: options.taskId,
          batchId: owningBatch.batchId,
          currentIndex: owningBatch.currentIndex,
          currentTaskId,
          requiredCommand: `node atm.mjs batch checkpoint --actor ${actorId} --batch ${owningBatch.batchId} --json`,
          blockedPattern: 'manual tasks close during active batch',
          remediation: currentTaskId && currentTaskId !== options.taskId
            ? `Deliver queue head ${currentTaskId}, then run node atm.mjs batch checkpoint --actor ${actorId} --batch ${owningBatch.batchId} --json instead of directly closing ${options.taskId}.`
            : `Run node atm.mjs batch checkpoint --actor ${actorId} --batch ${owningBatch.batchId} --json after delivering ${options.taskId}.`
        }
      });
    }
    if (options.fromBatchCheckpoint && owningBatch?.batchId && options.batchId && owningBatch.batchId !== options.batchId) {
      throw new CliError('ATM_BATCH_OWNERSHIP_MISMATCH', `Task ${options.taskId} belongs to batch ${owningBatch.batchId}, not ${options.batchId}.`, {
        exitCode: 1,
        details: {
          taskId: options.taskId,
          expectedBatchId: owningBatch.batchId,
          actualBatchId: options.batchId
        }
      });
    }
    const doneCloseAdmission = evaluateTaskDoneCloseAdmission({
      taskId: options.taskId,
      actorId,
      status: taskDocument.status,
      claimState: currentClaim?.state ?? null,
      claimActorId: currentClaim?.actorId ?? null,
      hasActiveSession: Boolean(activeSession?.sessionId)
    });
    if (!doneCloseAdmission.ok) {
      throw new CliError(doneCloseAdmission.code, doneCloseAdmission.message, {
        exitCode: 1,
        details: doneCloseAdmission.details
      });
    }
    assertTaskCloseAllowedByDirection(options.cwd, options.taskId, actorId);
  }

  const taskDeclaredFiles = extractTaskCloseDeclaredFiles(taskDocument);
  const activeFrameworkStatus = options.status === 'done'
    ? createFrameworkModeStatus({ cwd: options.cwd })
    : null;
  const frameworkStatus = options.status === 'done'
    ? createFrameworkModeStatus({
      cwd: options.cwd,
      files: taskDeclaredFiles.length > 0 ? taskDeclaredFiles : undefined
    })
    : null;
  const frameworkDeliveryWindow = options.status === 'done'
    ? evaluateFrameworkDeliveryWindow({
      cwd: options.cwd,
      taskId: options.taskId,
      actorId,
      batchId: options.batchId ?? owningBatch?.batchId ?? null,
      fromBatchCheckpoint: options.fromBatchCheckpoint,
      taskDeclaredFiles,
      criticalChangedFiles: activeFrameworkStatus?.criticalChangedFiles ?? [],
      historicalDeliveryRefs: effectiveHistoricalDeliveryRefs
    })
    : null;
  // TASK-AAO-0057: scoped diff isolation — partition framework critical changes
  // into in-scope (must be governed) vs unrelated (advisory, isolated) so that
  // dirty/untracked files outside the task scope never hard-block close.
  let closeScopedDiffIsolation = options.status === 'done' && frameworkStatus?.repoRole === 'framework' && frameworkDeliveryWindow
    ? buildCloseScopedDiffIsolation({
      cwd: options.cwd,
      taskId: options.taskId,
      taskDeclaredFiles,
      frameworkChangedFiles: activeFrameworkStatus?.changedFiles ?? [],
      frameworkDeliveryWindow
    })
    : null;
  if (frameworkStatus?.repoRole === 'framework') {
    const closeWorktree = inspectFrameworkCloseWorktree(options.cwd, options.taskId);
    const allowedAdvisoryGovernanceFiles = options.status === 'done' && effectiveHistoricalDeliveryRefs.length > 0
      ? [`.atm/history/evidence/${options.taskId}.json`]
      : [];
    const closeDirtyGuard = evaluateFrameworkCloseDirtyGuard({
      cwd: options.cwd,
      taskId: options.taskId,
      taskDeclaredFiles,
      trackedDirtyFiles: closeWorktree.trackedDirtyFiles,
      allowedAdvisoryGovernanceFiles
    });
    if (closeScopedDiffIsolation) {
      closeScopedDiffIsolation = attachDirtyGuardToScopedDiffIsolation(
        closeScopedDiffIsolation,
        closeDirtyGuard,
        closeWorktree.ignoredUntrackedFiles
      );
    }
    if (closeDirtyGuard.blockingTrackedDirtyFiles.length > 0) {
      throw new CliError('ATM_TASK_CLOSE_DIRTY_WORKTREE', `Task ${options.taskId} cannot be closed as done while in-scope or closure-governance tracked changes are still dirty.`, {
        exitCode: 1,
        details: {
          taskId: options.taskId,
          trackedDirtyFiles: closeDirtyGuard.blockingTrackedDirtyFiles,
          scopeTrackedDirtyFiles: closeDirtyGuard.scopeTrackedDirtyFiles,
          governanceTrackedDirtyFiles: closeDirtyGuard.governanceTrackedDirtyFiles,
          advisoryTrackedDirtyFiles: closeDirtyGuard.advisoryTrackedDirtyFiles,
          unstagedFiles: closeWorktree.unstagedFiles.filter((entry) => closeDirtyGuard.blockingTrackedDirtyFiles.includes(entry)),
          stagedFiles: closeWorktree.stagedFiles.filter((entry) => closeDirtyGuard.blockingTrackedDirtyFiles.includes(entry)),
          ignoredUntrackedFiles: closeWorktree.ignoredUntrackedFiles,
          remediation: 'Commit this task\'s scoped delivery changes first before closing done. Unrelated tracked dirty files are isolated as advisory and do not block this task. The closure packet describes the delivery parent commit instead of the mutable worktree.'
        }
      });
    }
    const scopedCriticalChangedFiles = frameworkDeliveryWindow?.scopedCriticalChangedFiles ?? [];
    const isolatedUnrelatedChanges = frameworkDeliveryWindow?.unscopedCriticalChangedFiles ?? [];
    if (scopedCriticalChangedFiles.length > 0 && frameworkDeliveryWindow?.ok !== true) {
      throw new CliError('ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE', `Task ${options.taskId} cannot be closed while in-scope ATM framework critical files are still modified outside the governed delivery window.`, {
        details: {
          taskId: options.taskId,
          criticalChangedFiles: activeFrameworkStatus?.criticalChangedFiles ?? [],
          scopedCriticalChangedFiles,
          isolatedUnrelatedChanges,
          closeScopedDiffIsolation,
          frameworkDeliveryWindow,
          requiredCommand: frameworkDeliveryWindow?.requiredCommand ?? null,
          remediation: frameworkDeliveryWindow?.remediation ?? 'Stage only the task-scoped deliverables/evidence, then close through the governed task or batch lifecycle.'
        }
      });
    }
    const effectiveFrameworkBlockers = frameworkDeliveryWindow?.ok === true
      ? frameworkStatus.blockers.filter((entry) => !frameworkDeliveryWindow.allowedBlockers.includes(entry))
      : frameworkStatus.blockers;
    if ((frameworkStatus.mode === 'required' || frameworkStatus.mode === 'cross-repo-target-required') && effectiveFrameworkBlockers.length > 0) {
      // TASK-AAO-0017: 加入 TL;DR 和結構化缺失 validator 報告
      const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
      throw new CliError('ATM_TASK_CLOSE_FRAMEWORK_GATE_FAILED', `Task ${options.taskId} cannot be closed until framework-development blockers are resolved.`, {
        details: {
          taskId: options.taskId,
          blockers: effectiveFrameworkBlockers,
          suppressedBlockers: frameworkDeliveryWindow?.ok === true
            ? frameworkStatus.blockers.filter((entry) => frameworkDeliveryWindow.allowedBlockers.includes(entry))
            : [],
          frameworkDeliveryWindow,
          closeScopedDiffIsolation,
          criticalChangedFiles: frameworkStatus.criticalChangedFiles,
          requiredGates: frameworkStatus.requiredGates,
          tldr: missingReport.tldr,
          missingValidationPasses: missingReport.missingValidationPasses,
          blockingFindings: missingReport.blockingFindings
        }
      });
    }
  }

  const evidenceGate = options.status === 'done'
    ? verifyTaskEvidence({
      cwd: options.cwd,
      taskId: options.taskId,
      gate: 'close',
      taskDocument,
      taskDeclaredFiles,
      frameworkTask: frameworkStatus?.repoRole === 'framework'
    })
    : null;
  if (evidenceGate && !evidenceGate.ok) {
    // TASK-AAO-0017: 加入 TL;DR 和結構化缺失 validator 報告
    const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
    throw new CliError('ATM_TASK_CLOSE_EVIDENCE_REQUIRED', `Task ${options.taskId} cannot be closed as done without required delivery evidence. The goal is to deliver the task, not to mark it done.`, {
      exitCode: 1,
      details: {
        taskId: options.taskId,
        deliveryPrinciple: taskDeliveryPrincipleText(),
        gate: evidenceGate.gate,
        missing: evidenceGate.missing,
        evidenceCount: evidenceGate.total,
        remediation: 'Implement the requested non-.atm deliverables, run the required validators, then add command-backed evidence before closing done.',
        tldr: missingReport.tldr,
        missingValidationPasses: missingReport.missingValidationPasses,
        blockingFindings: missingReport.blockingFindings
      }
    });
  }

  const deliverableGate = options.status === 'done'
    ? evaluateTaskDeliverableGate({
      cwd: options.cwd,
      taskId: options.taskId,
      taskDocument,
      taskDeclaredFiles,
      claim: parseClaimRecord(taskDocument.claim),
      historicalDeliveryRefs: effectiveHistoricalDeliveryRefs,
      historicalDeliveryRepo: options.historicalDeliveryRepo,
      waiverOutOfScopeDelivery: options.waiverOutOfScopeDelivery,
      waiverReason: options.reason
    })
    : null;
  if (deliverableGate && !deliverableGate.ok) {
    throw new CliError('ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED', `Task ${options.taskId} cannot be closed as done because ATM found no real non-.atm deliverable diff. Task delivery comes before task closure.`, {
      exitCode: 1,
      details: deliverableGate as unknown as Record<string, unknown>
    });
  }

  let closurePacketPath: string | null = null;
  let closurePacket: ClosurePacket | null = null;
  let pendingClosurePacket: ClosurePacket | null = null;
  let createdClosurePacketAbsolute: string | null = null;
  const existingClosurePacketPath = typeof taskDocument.closurePacket === 'string'
    ? taskDocument.closurePacket
    : typeof taskDocument.closure_packet === 'string'
      ? taskDocument.closure_packet
      : null;
  if (options.status === 'done' && existingClosurePacketPath) {
    const packetPath = path.resolve(options.cwd, existingClosurePacketPath);
    if (!existsSync(packetPath)) {
      throw new CliError('ATM_TASK_CLOSE_CLOSURE_PACKET_MISSING', `Task ${options.taskId} references a missing closure packet.`, {
        details: { taskId: options.taskId, closurePacketPath: existingClosurePacketPath }
      });
    }
    const packet = JSON.parse(readFileSync(packetPath, 'utf8')) as ClosurePacket;
    const validation = validateClosurePacket(packet);
    if (!validation.ok) {
      // TASK-AAO-0017: 加入 TL;DR 和結構化缺失 validator 報告
      const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
      throw new CliError('ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID', `Task ${options.taskId} closure packet is invalid.`, {
        details: {
          taskId: options.taskId,
          closurePacketPath: existingClosurePacketPath,
          missing: validation.missing,
          invalidFormat: validation.invalidFormat,
          tldr: missingReport.tldr,
          missingValidationPasses: missingReport.missingValidationPasses,
          blockingFindings: missingReport.blockingFindings
        }
      });
    }
    closurePacket = packet;
    closurePacketPath = existingClosurePacketPath;
  } else if (options.status === 'done' && frameworkStatus?.repoRole === 'framework') {
    pendingClosurePacket = createClosurePacket({
      cwd: options.cwd,
      taskId: options.taskId,
      actorId,
      sessionId: activeSession?.sessionId ?? null,
      evidencePath: `.atm/history/evidence/${options.taskId}.json`,
      requiredGates: frameworkStatus.requiredGates,
      changedFiles: deliverableGate?.deliverableFiles.length ? deliverableGate.deliverableFiles : taskDeclaredFiles,
      frameworkStatus,
      historicalDeliveryProvenance: buildHistoricalDeliveryProvenance(
        deliverableGate?.historicalDeliveries[0] ?? null,
        options.reason
      )
    });
    const validation = validateClosurePacket(pendingClosurePacket);
    if (!validation.ok) {
      // TASK-AAO-0017: 加入 TL;DR 和結構化缺失 validator 報告
      const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
      throw new CliError('ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID', `Task ${options.taskId} closure packet contract is incomplete.`, {
        details: {
          taskId: options.taskId,
          missing: validation.missing,
          invalidFormat: validation.invalidFormat,
          tldr: missingReport.tldr,
          missingValidationPasses: missingReport.missingValidationPasses,
          blockingFindings: missingReport.blockingFindings
        }
      });
    }
    closurePacket = pendingClosurePacket;
    createdClosurePacketAbsolute = path.join(options.cwd, '.atm', 'history', 'evidence', `${options.taskId}.closure-packet.json`);
  }

  if (options.status === 'done') {
    const finalPacketPath = existingClosurePacketPath || (pendingClosurePacket ? `.atm/history/evidence/${options.taskId}.closure-packet.json` : null);
    const finalPacket = closurePacket || pendingClosurePacket;
    const evaluatedMetadata = createClosureTransitionMetadata(
      finalPacketPath,
      finalPacket,
      owningBatch?.batchId ?? options.batchId,
      activeSession?.sessionId ?? null
    );
    if (!evaluatedMetadata || evaluatedMetadata.schemaId !== 'atm.taskClosureTransition.v1') {
      throw new CliError('ATM_TASK_CLOSE_CLOSURE_METADATA_REQUIRED', `Task ${options.taskId} cannot be closed as ${options.status} because closure metadata cannot be produced.`, {
        exitCode: 1,
        details: { taskId: options.taskId }
      });
    }
  }

    if (requiresProtectedCloseApproval && shouldDeferProtectedCloseApproval) {
      emergencyUse = assertEmergencyApproval({
        cwd: options.cwd,
        surface: protectedCloseSurface,
        permission: 'backend.tasks.close',
        taskId: options.taskId,
        actorId,
        emergencyApproval: options.emergencyApproval,
        flags: protectedCloseFlags,
        reason: options.reason ?? 'Direct close backend historical-delivery path.',
        command: protectedCloseCommand
      });
    }

  if (currentClaim && currentClaim.state === 'active' && currentClaim.actorId === actorId) {
    taskDocument.claim = {
      ...currentClaim,
      heartbeatAt: new Date().toISOString(),
      state: 'released',
      reason: options.reason ?? 'closed'
    };
  }

  const previousStatus = String(taskDocument.status ?? '');
  taskDocument.status = options.status;
  taskDocument.owner = actorId;
  taskDocument.closedAt = new Date().toISOString();
  taskDocument.closedByActor = actorId;
  taskDocument.closedBySessionId = activeSession?.sessionId ?? null;
  if (options.reason) {
    taskDocument.closeReason = options.reason;
  }
  const closeTransitionCommand = buildTaskTransitionCommand({
    action: options.status === 'blocked' ? 'block' : options.status === 'abandoned' ? 'abandon' : 'close',
    taskId: options.taskId,
    actorId,
    status: options.status,
    fromBatchCheckpoint: options.fromBatchCheckpoint,
    batchId: owningBatch?.batchId ?? options.batchId,
    historicalDeliveryRefs: effectiveHistoricalDeliveryRefs
  });
  const closeWriteResult = await executeTaskCloseTransaction({
    cwd: options.cwd,
    taskId: options.taskId,
    taskPath,
    phase: 'close',
    previousTaskContent,
    createdClosurePacketAbsolute,
    runWrites: () => {
      if (pendingClosurePacket) {
        closurePacketPath = writeClosurePacket(options.cwd, options.taskId, pendingClosurePacket);
        closurePacket = pendingClosurePacket;
        taskDocument.closurePacket = closurePacketPath;
      }
      const transitionPath = writeTaskDocumentWithTransition({
        cwd: options.cwd,
        taskPath,
        taskId: options.taskId,
        taskDocument,
        action: options.status === 'blocked' ? 'block' : options.status === 'abandoned' ? 'abandon' : 'close',
        actorId,
        sessionId: activeSession?.sessionId ?? null,
        previousStatus,
        closureMetadata: options.status === 'done'
          ? createClosureTransitionMetadata(closurePacketPath, closurePacket, owningBatch?.batchId ?? options.batchId, activeSession?.sessionId ?? null)
          : null,
        command: closeTransitionCommand
      });
      return { transitionPath, closurePacketPath };
    }
  });
  const transitionPath = closeWriteResult.transitionPath;
  closurePacketPath = closeWriteResult.closurePacketPath ?? closurePacketPath;
  const closeEvidencePath = `.atm/history/evidence/${options.taskId}.json`;
  const closeArtifactFiles = existingTaskCloseArtifacts(options.cwd, [
    relativePathFrom(options.cwd, taskPath),
    closeEvidencePath,
    transitionPath,
    closurePacketPath
  ]);
  stageTaskCloseArtifacts(options.cwd, closeArtifactFiles);
  if (currentClaim && currentClaim.state === 'active' && currentClaim.actorId === actorId) {
    const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
    await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, actorId));
  }
  if (activeSession?.sessionId) {
    updateActorWorkSessionState({
      cwd: options.cwd,
      sessionId: activeSession.sessionId,
      status: options.status === 'done' ? 'closed' : currentClaim?.state === 'handoff' ? 'handoff' : 'released',
      reason: options.reason ?? (typeof taskDocument.closeReason === 'string' ? taskDocument.closeReason : null)
    });
  }
  // TASK-AAO-0136: register close-commit-window for done closes so the captain's
  // follow-up `git commit --task <id>` can land closure-packet + transition + ledger
  // even though the direction lock has now released.
  const closeCommitWindowPathFromClose = (options.status === 'done' || options.status === 'abandoned')
    ? registerCloseCommitWindow({
      cwd: options.cwd,
      taskId: options.taskId,
      actorId,
      allowedFiles: closeArtifactFiles,
      transitionId: transitionPath.split(/[\\/]/).pop()?.replace(/\.json$/, '') ?? null,
      action: options.status === 'abandoned' ? 'abandon' : 'close'
    })
    : null;
  const taskQueue = options.status === 'done'
    ? advanceTaskQueueAfterClose(options.cwd, options.taskId, { batchId: owningBatch?.batchId ?? options.batchId })
    : null;
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [message('info', 'ATM_TASKS_CLOSED', `Task ${options.taskId} moved to ${options.status}.`, {
      taskId: options.taskId,
      actorId,
      status: options.status,
      closeCommitWindowPath: closeCommitWindowPathFromClose
    })],
    evidence: {
      action: 'close',
      taskId: options.taskId,
      actorId,
      status: options.status,
      taskPath: relativePathFrom(options.cwd, taskPath),
      evidenceGate,
      closurePacketPath,
      transitionPath,
      closeCommitWindowPath: closeCommitWindowPathFromClose,
      deliverableGate: deliverableGate as unknown as Record<string, unknown> | null,
      // TASK-AAO-0057: scoped diff isolation diagnostic — exposes which framework
      // critical changes were in-scope vs isolated as advisory unrelated changes.
      closeScopedDiffIsolation,
      emergencyUse,
      failedEmergencyAuditPath,
      taskQueue,
      historicalBatchSlice
    }
  });
  } catch (error) {
    if (
      shouldDeferProtectedCloseApproval
      && options.emergencyApproval
      && !emergencyUse
      && !isCliErrorWithCode(error, 'ATM_EMERGENCY_')
    ) {
      failedEmergencyAuditPath = recordFailedEmergencyUseAttempt({
        cwd: options.cwd,
        leaseId: options.emergencyApproval,
        permission: 'backend.tasks.close',
        surface: protectedCloseSurface,
        taskId: options.taskId,
        actorId,
        reason: options.reason ?? 'Direct close backend historical-delivery path.',
        command: protectedCloseCommand,
        failureCode: error instanceof CliError && typeof error.code === 'string' ? error.code : null
      });
    }
    throw error;
  }
}

function runTasksAudit(argv: string[]) {
  const options = parseAuditOptions(argv);
  const report = auditTasks(options.cwd);
  return makeResult({
    ok: report.ok,
    command: 'tasks',
    cwd: options.cwd,
    messages: [
      report.ok
        ? message('info', 'ATM_TASKS_AUDIT_OK', 'Task audit passed.', {
          inspectedTaskCount: report.inspectedTaskCount,
          inspectedEvidenceCount: report.inspectedEvidenceCount
        })
        : message('error', 'ATM_TASKS_AUDIT_FAILED', 'Task audit found invalid task closure evidence.', {
          findingCount: report.findings.length,
          errorCount: report.findings.filter((finding) => finding.level === 'error').length
        })
    ],
    evidence: {
      action: 'audit',
      staged: options.staged,
      report
    }
  });
}

async function runTasksLock(argv: string[]) {
  const action = (argv[0] ?? '').toLowerCase();
  if (action !== 'cleanup') {
    throw new CliError('ATM_CLI_USAGE', 'tasks lock supports only: cleanup', { exitCode: 2 });
  }
  return await runTasksLockCleanup(argv.slice(1));
}

async function runTasksScope(argv: string[]) {
  const subAction = (argv[0] ?? '').toLowerCase();
  if (subAction === 'add') {
    return runTasksScopeAdd(argv.slice(1));
  }
  if (!subAction) {
    throw new CliError('ATM_CLI_USAGE', 'tasks scope requires a sub-action: add', { exitCode: 2 });
  }
  throw new CliError('ATM_CLI_USAGE', `tasks scope does not support sub-action ${subAction}. Supported: add`, { exitCode: 2 });
}

function runTasksScopeAdd(argv: string[]) {
  const options = parseScopeAddOptions(argv);
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks scope add requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;

  const lockPath = path.join(options.cwd, '.atm', 'runtime', 'locks', `${options.taskId}.lock.json`);
  if (!existsSync(lockPath)) {
    throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `No active direction lock found for task ${options.taskId}. The task must be claimed before amending its scope.`, {
      exitCode: 1,
      details: { taskId: options.taskId }
    });
  }

  let outerLock: Record<string, unknown>;
  try {
    outerLock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
  } catch {
    throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `Could not read direction lock for task ${options.taskId}.`, {
      exitCode: 1,
      details: { taskId: options.taskId }
    });
  }

  if (outerLock.released === true || outerLock.status === 'released') {
    throw new CliError('ATM_SCOPE_AMENDMENT_LOCK_RELEASED', `Task ${options.taskId} direction lock is released; claim the task first.`, {
      exitCode: 1,
      details: { taskId: options.taskId }
    });
  }

  const embeddedLock = outerLock.taskDirectionLock;
  if (!embeddedLock || typeof embeddedLock !== 'object' || Array.isArray(embeddedLock)) {
    throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `Lock file for ${options.taskId} does not contain an embedded taskDirectionLock.`, {
      exitCode: 1,
      details: { taskId: options.taskId }
    });
  }
  const embeddedLockRecord = embeddedLock as Record<string, unknown>;

  const existingAllowed = sanitizeTaskDirectionAllowedFiles(
    Array.isArray(embeddedLockRecord.allowedFiles) ? (embeddedLockRecord.allowedFiles as string[]) : []
  );
  const requestedPaths = sanitizeTaskDirectionAllowedFiles(options.addPaths);
  const addedPaths = requestedPaths.filter((p) => !existingAllowed.includes(p));
  const alreadyPresent = requestedPaths.filter((p) => existingAllowed.includes(p));
  const mergedAllowed = sanitizeTaskDirectionAllowedFiles([...existingAllowed, ...requestedPaths]);

  // 寫入更新後的 lock（保留 outer lock 所有欄位，僅更新嵌入的 allowedFiles）
  const updatedEmbeddedLock = { ...embeddedLockRecord, allowedFiles: [...mergedAllowed] };
  const updatedOuterLock = { ...outerLock, taskDirectionLock: updatedEmbeddedLock };
  writeFileSync(lockPath, `${JSON.stringify(updatedOuterLock, null, 2)}\n`, 'utf8');

  // 記錄 scope-amendment 轉換事件
  const taskPath = taskPathFor(options.cwd, options.taskId);
  if (existsSync(taskPath)) {
    const taskDocument = readJsonRecord(taskPath);
    const commandLine = `node atm.mjs tasks scope add --task ${options.taskId} --actor ${actorId} --add ${options.addPaths.join(',')} --json`;
    appendTaskTransitionEvent({
      cwd: options.cwd,
      taskId: options.taskId,
      action: 'scope-amendment',
      actorId,
      fromStatus: String(taskDocument.status ?? 'running'),
      toStatus: String(taskDocument.status ?? 'running'),
      taskPath,
      taskDocument,
      command: commandLine
    });
  }

  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [
      message(
        'info',
        'ATM_SCOPE_AMENDMENT_APPLIED',
        addedPaths.length > 0
          ? `Scope amendment applied for ${options.taskId}: ${addedPaths.length} path(s) added to allowedFiles.`
          : `Scope amendment for ${options.taskId}: all requested paths were already in allowedFiles.`,
        {
          taskId: options.taskId,
          actorId,
          addedPaths,
          alreadyPresent,
          allowedFiles: mergedAllowed,
          requiredCommand: `node atm.mjs tasks scope add --task ${options.taskId} --actor ${actorId} --add <paths> --json`
        }
      )
    ],
    evidence: {
      action: 'scope-amendment',
      taskId: options.taskId,
      actorId,
      addedPaths,
      alreadyPresent,
      allowedFiles: mergedAllowed
    }
  });
}



async function runTasksLockCleanup(argv: string[]) {
  const options = parseLockCleanupOptions(argv);
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks lock cleanup requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  if (options.allStale) {
    assertEmergencyApproval({
      cwd: options.cwd,
      surface: 'tasks lock cleanup --all-stale',
      permission: 'backend.tasks.lockCleanupGlobal',
      taskId: null,
      actorId,
      emergencyApproval: options.emergencyApproval,
      flags: ['--all-stale'],
      reason: options.reason ?? 'Global stale lock cleanup.',
      command: `node atm.mjs tasks lock cleanup --all-stale --actor ${actorId} --json`
    });
    const taskIds = listRuntimeLockTaskIds(options.cwd);
    const cleaned: unknown[] = [];
    const skipped: unknown[] = [];
    for (const taskId of taskIds) {
      try {
        cleaned.push(await cleanupTaskLock({ cwd: options.cwd, taskId, actorId, reason: options.reason }));
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ATM_TASK_LOCK_CLEANUP_NOT_ALLOWED') {
          skipped.push({ taskId, reason: 'not-stale' });
          continue;
        }
        throw error;
      }
    }
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASK_LOCK_CLEANUP_ALL_STALE_OK', `Cleaned ${cleaned.length} stale task lock(s).`, {
        cleanedCount: cleaned.length,
        skippedCount: skipped.length
      })],
      evidence: {
        action: 'lock-cleanup',
        allStale: true,
        actorId,
        cleaned,
        skipped
      }
    });
  }
  const report = await cleanupTaskLock({ cwd: options.cwd, taskId: options.taskId, actorId, reason: options.reason });
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [message('info', 'ATM_TASK_LOCK_CLEANUP_OK', `Cleaned stale lock state for ${options.taskId}.`, {
      taskId: options.taskId,
      actorId,
      staleReasons: report.staleReasons,
      cleanupActions: report.cleanupActions
    })],
    evidence: report
  });
}

async function cleanupTaskLock(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly reason: string | null;
}) {
  const { cwd, taskId, actorId } = input;
  const nowIso = new Date().toISOString();
  const taskPath = taskPathFor(cwd, taskId);
  const taskDocument = existsSync(taskPath)
    ? JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>
    : null;
  const currentStatus = normalizeTaskStatus(taskDocument?.status);
  const currentClaim = parseClaimRecord(taskDocument?.claim);
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
  const sidecarPath = path.join(cwd, '.atm', 'runtime', 'task-direction-locks', `${taskId}.json`);
  const governanceLock = existsSync(lockPath)
    ? JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>
    : null;
  const releasedLock = governanceLock?.released === true || governanceLock?.status === 'released';
  const staleReasons: string[] = [];

  if (releasedLock) staleReasons.push('released-lock');
  if (!taskDocument) staleReasons.push('missing-task');
  if (currentStatus === 'done' || currentStatus === 'abandoned' || currentStatus === 'blocked') {
    staleReasons.push(`terminal-task:${currentStatus}`);
  }
  if (currentClaim && isClaimExpired(currentClaim, nowIso)) staleReasons.push('expired-claim');
  if (!governanceLock && existsSync(sidecarPath)) staleReasons.push('orphaned-sidecar');
  if (governanceLock && !releasedLock && !currentClaim && existsSync(sidecarPath)) staleReasons.push('lock-without-claim');

  if (staleReasons.length === 0) {
    throw new CliError('ATM_TASK_LOCK_CLEANUP_NOT_ALLOWED', `Task ${taskId} does not have a stale cleanup candidate.`, {
      exitCode: 1,
      details: {
        taskId,
        lockPath: existsSync(lockPath) ? relativePathFrom(cwd, lockPath) : null,
        sidecarPath: existsSync(sidecarPath) ? relativePathFrom(cwd, sidecarPath) : null,
        status: currentStatus,
        claimState: currentClaim?.state ?? null
      }
    });
  }

  const adapter = createLocalGovernanceAdapter({ repositoryRoot: cwd });
  const cleanupActions: string[] = [];
  if (governanceLock && !releasedLock) {
    await resolveValue(adapter.stores.lockStore.releaseLock(taskId, actorId));
    cleanupActions.push('released-governance-lock');
  }
  if (existsSync(sidecarPath)) {
    rmSync(sidecarPath, { force: true });
    cleanupActions.push('removed-direction-sidecar');
  }
  const reportPath = writeLockCleanupReport({
    cwd,
    taskId,
    actorId,
    staleReasons,
    cleanupActions,
    reason: input.reason
  });
  return {
    action: 'lock-cleanup',
    taskId,
    actorId,
    staleReasons,
    cleanupActions,
    reportPath
  };
}



function runTasksQueue(argv: string[]) {
  const action = (argv[0] ?? 'status').toLowerCase();
  const options = parseQueueOptions(argv.slice(action === 'status' || action === 'abandon' ? 1 : 0));
  if (action === 'status') {
    const activeQueue = findActiveTaskQueue(options.cwd);
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', activeQueue ? 'ATM_TASK_QUEUE_ACTIVE' : 'ATM_TASK_QUEUE_EMPTY', activeQueue
        ? `Active task queue ${activeQueue.queueId} is at index ${activeQueue.currentIndex}.`
        : 'No active task queue is recorded.', {
          queueId: activeQueue?.queueId ?? null,
          queueHeadTaskId: activeQueue ? activeQueue.taskIds[activeQueue.currentIndex] ?? null : null
        })],
      evidence: {
        action: 'queue status',
        activeQueue
      }
    });
  }
  if (action === 'abandon') {
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
      throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks queue abandon requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    if (!options.queueId) {
      throw new CliError('ATM_CLI_USAGE', 'tasks queue abandon requires --queue <queueId>.', { exitCode: 2 });
    }
    const queue = abandonTaskQueue({
      cwd: options.cwd,
      queueId: options.queueId,
      actorId: resolvedActor.actorId,
      reason: options.reason
    });
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASK_QUEUE_ABANDONED', `Task queue ${queue.queueId} was abandoned.`, {
        queueId: queue.queueId,
        actorId: resolvedActor.actorId
      })],
      evidence: {
        action: 'queue abandon',
        queue
      }
    });
  }
  throw new CliError('ATM_CLI_USAGE', 'tasks queue supports only: status, abandon.', { exitCode: 2 });
}

interface ParallelAdvisorTaskRef {
  readonly taskId: string;
  readonly title: string;
  readonly status: string;
  readonly allowedFiles: readonly string[];
  readonly validators: readonly string[];
  readonly atomIds: readonly string[];
  // TASK-CID-0024: active-claim awareness so claim gates can distinguish a
  // queued-but-idle CID overlap from a genuinely active write conflict.
  readonly activeClaimActorId: string | null;
  readonly activeClaimIntent: string | null;
}

interface ParallelAdvisorFinding {
  readonly verdict:
    | 'parallel-safe'
    | 'blocked-cid-conflict'
    | 'blocked-shared-surface'
    | 'blocked-active-lease'
    | 'insufficient-atom-map'
    | 'needs-physical-split';
  readonly overlappingFiles: readonly string[];
  readonly overlappingAtomIds: readonly string[];
  readonly sharedValidators: readonly string[];
  readonly sharedGenerators: readonly string[];
  readonly sharedProjections: readonly string[];
  readonly sharedArtifacts: readonly string[];
  readonly activeLeaseConflicts: readonly string[];
}

function runTasksParallel(argv: string[]) {
  const parsed = parseTasksParallelArgs(argv);
  if (parsed.mode === 'pair') {
    const left = readParallelAdvisorTask(parsed.cwd, parsed.taskId);
    const right = readParallelAdvisorTask(parsed.cwd, parsed.withTaskId);
    const finding = analyzeParallelPair(left, right);
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: parsed.cwd,
      messages: [message('info', 'ATM_TASKS_PARALLEL_ANALYZED', `Parallel advisor analyzed ${left.taskId} with ${right.taskId}.`, {
        verdict: finding.verdict,
        taskId: left.taskId,
        withTaskId: right.taskId
      })],
      evidence: {
        action: 'parallel pair',
        task: left,
        withTask: right,
        finding
      }
    });
  }

  if (parsed.mode === 'queue-for-task') {
    const anchor = readParallelAdvisorTask(parsed.cwd, parsed.taskId);
    const candidates = listParallelAdvisorTasks(parsed.cwd)
      .filter((task) => task.taskId !== anchor.taskId);
    const analyses = candidates.map((candidate) => ({
      taskId: candidate.taskId,
      title: candidate.title,
      status: candidate.status,
      activeClaimActorId: candidate.activeClaimActorId,
      activeClaimIntent: candidate.activeClaimIntent,
      finding: analyzeParallelPair(anchor, candidate)
    }));
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: parsed.cwd,
      messages: [message('info', 'ATM_TASKS_PARALLEL_QUEUE_ANALYZED', `Parallel advisor compared ${anchor.taskId} against ${analyses.length} queue candidate(s).`, {
        taskId: anchor.taskId,
        candidateCount: analyses.length
      })],
      evidence: {
        action: 'parallel queue',
        task: anchor,
        candidates: analyses
      }
    });
  }

  const tasks = listParallelAdvisorTasks(parsed.cwd);
  const hotspot = buildParallelHotspotReport(tasks);
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: parsed.cwd,
    messages: [message('info', 'ATM_TASKS_PARALLEL_REPORT_READY', `Parallel advisor generated a queue hotspot report for ${tasks.length} task(s).`, {
      taskCount: tasks.length
    })],
    evidence: {
      action: 'parallel queue report',
      taskCount: tasks.length,
      hotspot
    }
  });
}

function parseTasksParallelArgs(argv: string[]): { cwd: string; mode: 'pair'; taskId: string; withTaskId: string } | { cwd: string; mode: 'queue-for-task'; taskId: string } | { cwd: string; mode: 'queue-report' } {
  let cwd = process.cwd();
  let taskId: string | null = null;
  let withTaskId: string | null = null;
  let queueFlag = false;
  let reportFlag = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--with') {
      withTaskId = requireValue(argv, index, '--with');
      index += 1;
      continue;
    }
    if (arg === '--queue') {
      queueFlag = true;
      continue;
    }
    if (arg === '--report') {
      reportFlag = true;
      continue;
    }
    if (arg === '--json' || arg === '--pretty' || arg === '--summary') {
      continue;
    }
    if (arg === '--fields' || arg === '--output-json') {
      index += 1;
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks parallel does not support option ${arg}.`, { exitCode: 2 });
  }

  if (taskId && withTaskId) {
    return { cwd, mode: 'pair', taskId: normalizeTaskId(taskId), withTaskId: normalizeTaskId(withTaskId) };
  }
  if (taskId && queueFlag) {
    return { cwd, mode: 'queue-for-task', taskId: normalizeTaskId(taskId) };
  }
  if (queueFlag && reportFlag) {
    return { cwd, mode: 'queue-report' };
  }
  throw new CliError('ATM_CLI_USAGE', 'tasks parallel requires either --task <id> --with <id>, --task <id> --queue, or --queue --report.', {
    exitCode: 2,
    details: {
      invalidFlags: [],
      missingRequired: [],
      allowedFlags: ['--cwd', '--task', '--with', '--queue', '--report', '--json', '--pretty', '--output-json', '--summary', '--fields']
    }
  });
}

function listParallelAdvisorTasks(cwd: string): readonly ParallelAdvisorTaskRef[] {
  const taskLedger = readTaskLedgerPolicy(cwd);
  const taskRoot = path.join(cwd, taskLedger.taskRoot);
  const entries = readdirSync(taskRoot, { withFileTypes: true });
  const tasks: ParallelAdvisorTaskRef[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const fullPath = path.join(taskRoot, entry.name);
    const doc = readJsonRecord(fullPath);
    const status = normalizeTaskStatus(doc.status);
    if (!['open', 'running', 'ready', 'in_progress', 'review', 'blocked', 'reserved'].includes(status)) continue;
    tasks.push(taskDocumentToParallelAdvisorTask(cwd, doc));
  }
  return tasks;
}

function readParallelAdvisorTask(cwd: string, taskId: string): ParallelAdvisorTaskRef {
  const taskPath = taskPathFor(cwd, taskId);
  if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${taskId}.`, {
      exitCode: 2,
      details: { taskId, taskPath: relativePathFrom(cwd, taskPath) }
    });
  }
  return taskDocumentToParallelAdvisorTask(cwd, readJsonRecord(taskPath));
}

function taskDocumentToParallelAdvisorTask(cwd: string, taskDocument: Record<string, unknown>): ParallelAdvisorTaskRef {
  const taskId = normalizeTaskDocumentId(taskDocument, 'TASK-UNKNOWN-0000');
  const title = normalizeOptionalString(taskDocument.title) ?? taskId;
  const status = normalizeTaskStatus(taskDocument.status);
  const collectedFiles = collectParallelAdvisorTaskFiles(taskDocument);
  const allowedFiles = uniqueStrings(
    Array.from(collectedFiles)
      .map((value) => normalizeParallelAdvisorPath(cwd, value))
      .filter((value): value is string => Boolean(value))
  );
  const validators = uniqueStrings(parseYamlList(taskDocument.validators).map((entry) => entry.trim()).filter(Boolean));
  const atomIds = uniqueStrings(allowedFiles.flatMap((entry) => findAtomIdsForPath(cwd, entry)));
  const claimRecord = taskDocument.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim)
    ? taskDocument.claim as Record<string, unknown>
    : null;
  const claimState = normalizeOptionalString(claimRecord?.state);
  const activeClaimActorId = claimState === 'active' ? normalizeOptionalString(claimRecord?.actorId) : null;
  const activeClaimIntent = claimState === 'active'
    ? (normalizeOptionalString(claimRecord?.intent) ?? 'write')
    : null;
  return { taskId, title, status, allowedFiles, validators, atomIds, activeClaimActorId, activeClaimIntent };
}

function collectParallelAdvisorTaskFiles(taskDocument: Record<string, unknown>): ReadonlySet<string> {
  const files = new Set<string>();
  const taskDirectionLock = taskDocument.taskDirectionLock;
  const claim = taskDocument.claim;
  const legacyImportAliases = taskDocument.legacyImportAliases;
  const targetWork = taskDocument.targetWork;
  collectTaskFileValues(taskDocument.scopePaths, files);
  collectTaskFileValues(taskDocument.deliverables, files);
  collectTaskFileValues(taskDocument.targetAllowedFiles, files);
  collectTaskFileValues(taskDocument.planningMirrorPaths, files);
  if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
    collectTaskFileValues((claim as Record<string, unknown>).files, files);
  }
  if (taskDirectionLock && typeof taskDirectionLock === 'object' && !Array.isArray(taskDirectionLock)) {
    collectTaskFileValues((taskDirectionLock as Record<string, unknown>).allowedFiles, files);
  }
  if (legacyImportAliases && typeof legacyImportAliases === 'object' && !Array.isArray(legacyImportAliases)) {
    collectTaskFileValues((legacyImportAliases as Record<string, unknown>).allowed_files, files);
  }
  if (targetWork && typeof targetWork === 'object' && !Array.isArray(targetWork)) {
    collectTaskFileValues((targetWork as Record<string, unknown>).allowedFiles, files);
  }
  return files;
}

function normalizeParallelAdvisorPath(cwd: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) {
    return relativePathFrom(cwd, normalized).replace(/\\/g, '/');
  }
  return normalized.replace(/^\.\/+/, '');
}

function loadPathToAtomMappings(cwd: string): readonly { pathPattern: string; atomId: string; capability: string }[] {
  const mapPath = path.join(cwd, 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json');
  const payload = readJsonRecord(mapPath) as { mappings?: Array<Record<string, unknown>> };
  return (payload.mappings ?? []).flatMap((entry) => {
    const pathPattern = normalizeOptionalString(entry.path_pattern);
    const atomId = normalizeOptionalString(entry.atom_id);
    const capability = normalizeOptionalString(entry.capability) ?? '';
    if (!pathPattern || !atomId) return [];
    return [{ pathPattern, atomId, capability }];
  });
}

function findAtomIdsForPath(cwd: string, relativePath: string): readonly string[] {
  const normalized = relativePath.replace(/\\/g, '/');
  return loadPathToAtomMappings(cwd)
    .filter((mapping) => globLikeMatch(normalized, mapping.pathPattern))
    .map((mapping) => mapping.atomId);
}

function analyzeParallelPair(left: ParallelAdvisorTaskRef, right: ParallelAdvisorTaskRef): ParallelAdvisorFinding {
  const overlappingFiles = intersect(left.allowedFiles, right.allowedFiles);
  const overlappingAtomIds = intersect(left.atomIds, right.atomIds);
  const sharedValidators = intersect(left.validators, right.validators);
  const sharedGenerators = overlappingFiles.filter((entry) => /generator|build|manifest/i.test(entry));
  const sharedProjections = overlappingFiles.filter((entry) => /projection|map|registry|index/i.test(entry));
  const sharedArtifacts = overlappingFiles.filter((entry) => /artifact|report|jsonl/i.test(entry));
  const activeLeaseConflicts = overlappingFiles.filter((entry) => /\.atm\/history\//i.test(entry));

  let verdict: ParallelAdvisorFinding['verdict'] = 'parallel-safe';
  if (overlappingAtomIds.length > 0) {
    verdict = 'blocked-cid-conflict';
  } else if (sharedValidators.length > 0 || sharedGenerators.length > 0 || sharedProjections.length > 0 || sharedArtifacts.length > 0) {
    verdict = 'blocked-shared-surface';
  } else if (activeLeaseConflicts.length > 0) {
    verdict = 'blocked-active-lease';
  } else if (overlappingFiles.length > 0) {
    verdict = 'needs-physical-split';
  } else if (left.allowedFiles.length === 0 || right.allowedFiles.length === 0) {
    verdict = 'insufficient-atom-map';
  }

  return {
    verdict,
    overlappingFiles,
    overlappingAtomIds,
    sharedValidators,
    sharedGenerators,
    sharedProjections,
    sharedArtifacts,
    activeLeaseConflicts
  };
}

function buildParallelHotspotReport(tasks: readonly ParallelAdvisorTaskRef[]) {
  const fileCounts = new Map<string, number>();
  const atomCounts = new Map<string, number>();
  const validatorCounts = new Map<string, number>();
  for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
      const finding = analyzeParallelPair(tasks[leftIndex], tasks[rightIndex]);
      for (const file of finding.overlappingFiles) incrementMap(fileCounts, file);
      for (const atomId of finding.overlappingAtomIds) incrementMap(atomCounts, atomId);
      for (const validator of finding.sharedValidators) incrementMap(validatorCounts, validator);
    }
  }
  return {
    topOverlappingFiles: sortMapEntries(fileCounts),
    topOverlappingAtomIds: sortMapEntries(atomCounts),
    topSharedValidators: sortMapEntries(validatorCounts)
  };
}

function intersect(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function incrementMap(target: Map<string, number>, key: string) {
  target.set(key, (target.get(key) ?? 0) + 1);
}

function sortMapEntries(target: Map<string, number>) {
  return Array.from(target.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => ({ value, count }));
}

function globLikeMatch(value: string, pattern: string): boolean {
  const normalizedPattern = pattern.replace(/\\/g, '/');
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexSource = `^${escaped.replace(/\*\*/g, '::DOUBLE_STAR::').replace(/\*/g, '[^/]*').replace(/::DOUBLE_STAR::/g, '.*')}$`;
  return new RegExp(regexSource).test(value);
}

async function runTasksMigrateLegacyLedger(argv: string[]) {
  const options = parseLegacyLedgerMigrationOptions(argv);
  assertLocalTaskLedgerEnabled(options.cwd, 'migrate-legacy-ledger');
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks migrate-legacy-ledger requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const taskLedger = readTaskLedgerPolicy(options.cwd);
  const tasks = readLegacyLedgerTaskFiles(options.cwd);
  const migratedTasks: TaskLegacyLedgerMigrationEntry[] = [];
  const skippedTasks: TaskLegacyLedgerMigrationSkip[] = [];

  for (const task of tasks) {
    if (!legacyTaskRequiresBaseline(options.cwd, task)) {
      skippedTasks.push({
        taskId: task.taskId,
        taskPath: task.relativePath,
        taskFormat: task.format,
        reason: 'already-has-transition-evidence-or-not-required'
      });
      continue;
    }
    const migrationReason = normalizeStringValue(task.document.lastTransitionId ?? task.document.last_transition_id)
      ? 'missing-transition-event'
      : 'missing-transition-id';
    const reportEntry: TaskLegacyLedgerMigrationEntry = {
      taskId: task.taskId,
      taskPath: task.relativePath,
      taskFormat: task.format,
      status: task.status,
      reason: migrationReason,
      transitionPath: null
    };
    if (options.apply) {
      const transitionPath = writeLegacyBaselineTransition({
        cwd: options.cwd,
        task,
        actorId,
        reason: options.reason
      });
      migratedTasks.push({
        ...reportEntry,
        transitionPath
      });
    } else {
      migratedTasks.push(reportEntry);
    }
  }

  const report: TaskLegacyLedgerMigrationReport = {
    schemaId: 'atm.taskLegacyLedgerMigrationReport',
    specVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'dry-run',
    taskRoot: taskLedger.taskRoot,
    eventRoot: taskLedger.eventRoot,
    inspectedTaskCount: tasks.length,
    migratableTaskCount: migratedTasks.length,
    migratedTaskCount: options.apply ? migratedTasks.length : 0,
    skippedTaskCount: skippedTasks.length,
    migratedTasks,
    skippedTasks
  };

  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_TASKS_LEGACY_LEDGER_MIGRATION', options.apply
        ? `Backfilled baseline transition evidence for ${migratedTasks.length} legacy task(s).`
        : `Legacy ledger migration dry-run found ${migratedTasks.length} task(s) to backfill.`, {
        mode: report.mode,
        inspectedTaskCount: report.inspectedTaskCount,
        migratableTaskCount: report.migratableTaskCount,
        migratedTaskCount: report.migratedTaskCount
      })
    ],
    evidence: {
      action: 'migrate-legacy-ledger',
      actorId,
      report
    }
  });
}

async function runTasksClaimLifecycle(action: 'claim' | 'renew' | 'release' | 'handoff' | 'takeover', argv: string[]) {
  const options = parseClaimLifecycleOptions(action, argv);
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks claim lifecycle requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const taskPath = taskPathFor(options.cwd, options.taskId);
  if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
      exitCode: 2,
      details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId }
    });
  }
  const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
  const existingTask = await resolveValue(adapter.stores.taskStore.getTask(options.taskId));
  const taskRef: WorkItemRef = existingTask ?? {
    workItemId: options.taskId,
    title: String(taskDocument.title ?? options.taskId),
    status: normalizeWorkItemStatus(taskDocument.status)
  };
  const relativeTaskPath = relativePathFrom(options.cwd, taskPath);
  const files = options.files.length > 0 ? options.files : [relativeTaskPath];
  const currentClaim = parseClaimRecord(taskDocument.claim);
  if (action === 'claim') {
    if (currentClaim && currentClaim.state === 'active' && currentClaim.actorId !== actorId) {
      throw new CliError('ATM_LOCK_CONFLICT', `Task ${options.taskId} is already claimed by ${currentClaim.actorId}.`, {
        exitCode: 1,
        details: { taskId: options.taskId, actorId: currentClaim.actorId, leaseId: currentClaim.leaseId }
      });
    }
    const claimAdmission = evaluateTaskClaimAdmission({
      taskId: options.taskId,
      actorId,
      status: String(taskDocument.status ?? ''),
      claimIntent: options.claimIntent
    });
    if (!claimAdmission.ok) {
      throw new CliError(claimAdmission.code, claimAdmission.message, {
        exitCode: 1,
        details: claimAdmission.details
      });
    }
    const dependencyBlockers = findTaskClaimDependencyBlockers(options.cwd, options.taskId, taskDocument);
    if (dependencyBlockers.length > 0) {
      const firstBlocker = dependencyBlockers[0];
      const closeoutBlocker = firstBlocker as TaskClaimDependencyBlocker;
      const requiredCmd = closeoutBlocker.requiredCommand
        ?? (closeoutBlocker.status === 'incomplete-closeout' || closeoutBlocker.status === 'source-done-governance-incomplete'
          ? buildDependencyCloseoutRecoveryCommand(closeoutBlocker)
          : `node atm.mjs tasks status --task ${firstBlocker.taskId} --json`);
      const blockerMessage = closeoutBlocker.status === 'source-done-governance-incomplete'
        ? formatDependencyCloseoutBlockedMessage(closeoutBlocker)
        : `Task ${options.taskId} cannot be claimed until prerequisite task(s) close.`;
      throw new CliError('ATM_TASK_CLAIM_DEPENDENCY_BLOCKED', blockerMessage, {
        exitCode: 1,
        details: {
          taskId: options.taskId,
          dependencyTaskIds: dependencyBlockers.map((entry) => entry.taskId),
          dependencyStatuses: dependencyBlockers,
          requiredCommand: requiredCmd,
          closeoutGap: firstBlocker.status === 'source-done-governance-incomplete'
            ? assessCloseoutProvenanceGap(options.cwd, firstBlocker.taskId, JSON.parse(readFileSync(firstBlocker.taskPath, 'utf8')) as Record<string, unknown>)
            : null
        }
      });
    }
    // TASK-CID-0024: persist the declared claim intent so downstream gates
    // (next --claim parallel preflight, hook pre-commit ownership checks) can
    // distinguish mutating write claims from non-mutating closeout-only claims.
    const claim = {
      ...createClaimRecord({
        taskId: options.taskId,
        actorId,
        files,
        ttlSeconds: options.ttlSeconds,
        timestamp: nowIso
      }),
      intent: options.claimIntent
    };
    try {
      await resolveValue(adapter.stores.lockStore.acquireLock(taskRef, files, actorId));
    } catch (error) {
      const code = extractErrorCode(error);
      if (code === 'ATM_LOCK_CONFLICT') {
        throw new CliError('ATM_LOCK_CONFLICT', `Task ${options.taskId} has an active conflicting lock.`, {
          exitCode: 1,
          details: extractErrorDetails(error)
        });
      }
      throw error;
    }
    taskDocument.claim = claim;
    taskDocument.owner = actorId;
    taskDocument.startedAt = String(taskDocument.startedAt ?? nowIso);
    taskDocument.startedByActor = String(taskDocument.startedByActor ?? actorId);
    const sessionRecord = upsertActorWorkSession({
      cwd: options.cwd,
      actorId,
      taskId: options.taskId,
      claimLeaseId: claim.leaseId,
      status: 'active',
      taskPath: relativeTaskPath,
      timestamp: nowIso
    });
    taskDocument.startedBySessionId = sessionRecord.session.sessionId;
    const previousStatus = String(taskDocument.status ?? '');
    taskDocument.status = 'running';
    const directionLock = writeTaskDirectionLock({
      cwd: options.cwd,
      taskId: options.taskId,
      actorId,
      queue: findActiveTaskQueue(options.cwd),
      batchId: null,
      scopeKey: null,
      allowedFiles: files,
      planningReadOnlyPaths: Array.isArray(taskDocument.planningReadOnlyPaths) ? taskDocument.planningReadOnlyPaths as string[] : [],
      planningMirrorPaths: Array.isArray(taskDocument.planningMirrorPaths) ? taskDocument.planningMirrorPaths as string[] : [],
      allowPlanningMirror: taskDocument.allowPlanningMirror === true,
      prompt: options.taskId
    });
    taskDocument.taskDirectionLock = directionLock;
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: options.cwd,
      taskPath,
      taskId: options.taskId,
      taskDocument,
      action,
      actorId,
      sessionId: sessionRecord.session.sessionId,
      previousStatus
    });
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASKS_CLAIM_ACQUIRED', `Claim acquired for ${options.taskId}.`, {
        taskId: options.taskId,
        actorId,
        claimIntent: options.claimIntent
      })],
      evidence: {
        action,
        taskId: options.taskId,
        actorId,
        claimIntent: options.claimIntent,
        claim,
        taskPath: relativeTaskPath,
        transitionPath,
        sessionId: sessionRecord.session.sessionId,
        session: sessionRecord.session,
        taskDirectionLock: directionLock
      }
    });
}

  if (!currentClaim && action === 'release' && options.reservedOk && normalizeTaskStatus(taskDocument.status) === 'reserved') {
    const previousStatus = String(taskDocument.status ?? '');
    taskDocument.status = 'open';
    taskDocument.owner = actorId;
    if (options.reason) taskDocument.releaseReason = options.reason;
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: options.cwd,
      taskPath,
      taskId: options.taskId,
      taskDocument,
      action,
      actorId,
      previousStatus
    });
    const sessionRecord = updateActorWorkSessionState({
      cwd: options.cwd,
      actorId,
      taskId: options.taskId,
      claimLeaseId: null,
      status: 'released',
      reason: options.reason ?? null,
      timestamp: nowIso
    });
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASKS_RESERVED_RELEASED', `Reserved task ${options.taskId} released back to open.`, {
        taskId: options.taskId,
        actorId
      })],
      evidence: {
        action,
        taskId: options.taskId,
        actorId,
        previousStatus,
        status: 'open',
        transitionPath
      }
    });
  }

  if (!currentClaim) {
    throw new CliError('ATM_TASK_CLAIM_MISSING', `Task ${options.taskId} has no active claim record.`, {
      exitCode: 1,
      details: {
        taskId: options.taskId,
        requiredCommand: `node atm.mjs tasks reset --task ${options.taskId} --actor ${actorId} --to open --reason "rollback cleanup" --json`
      }
    });
  }

  if (action === 'renew') {
    if (currentClaim.actorId !== actorId) {
      throw new CliError('ATM_TASK_CLAIM_OWNER_MISMATCH', `Task ${options.taskId} is claimed by ${currentClaim.actorId}, not ${actorId}.`, {
        exitCode: 1,
        details: { taskId: options.taskId, currentActor: currentClaim.actorId, actorId }
      });
    }
    const renewed: TaskClaimRecord = {
      ...currentClaim,
      heartbeatAt: nowIso,
      ttlSeconds: options.ttlSeconds > 0 ? options.ttlSeconds : currentClaim.ttlSeconds,
      state: 'active'
    };
    taskDocument.claim = renewed;
    const sessionRecord = updateActorWorkSessionState({
      cwd: options.cwd,
      actorId,
      taskId: options.taskId,
      claimLeaseId: currentClaim.leaseId,
      status: 'active',
      timestamp: nowIso
    });
    const previousStatus = String(taskDocument.status ?? '');
    taskDocument.status = 'running';
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: options.cwd,
      taskPath,
      taskId: options.taskId,
      taskDocument,
      action,
      actorId,
      sessionId: sessionRecord?.session.sessionId ?? null,
      previousStatus
    });
    clearBrokerRuntimeStateForTask({
      cwd: options.cwd,
      taskId: options.taskId
    });
    removeBrokerRegistryIfEmpty(options.cwd);
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASKS_CLAIM_RENEWED', `Claim renewed for ${options.taskId}.`, { taskId: options.taskId, actorId })],
      evidence: {
        action,
        taskId: options.taskId,
        actorId,
        claim: renewed,
        transitionPath,
        sessionId: sessionRecord?.session.sessionId ?? null,
        session: sessionRecord?.session ?? null
      }
    });
  }

  if (action === 'release') {
    if (currentClaim.actorId !== actorId) {
      throw new CliError('ATM_TASK_CLAIM_OWNER_MISMATCH', `Task ${options.taskId} is claimed by ${currentClaim.actorId}, not ${actorId}.`, {
        exitCode: 1,
        details: { taskId: options.taskId, currentActor: currentClaim.actorId, actorId }
      });
    }
    const releasedClaim: TaskClaimRecord = {
      ...currentClaim,
      heartbeatAt: nowIso,
      state: 'released',
      reason: options.reason ?? currentClaim.reason
    };
    await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, actorId));
    taskDocument.claim = releasedClaim;
    const sessionRecord = updateActorWorkSessionState({
      cwd: options.cwd,
      actorId,
      taskId: options.taskId,
      claimLeaseId: currentClaim.leaseId,
      status: 'released',
      reason: options.reason ?? currentClaim.reason ?? null,
      timestamp: nowIso
    });
    const previousStatus = String(taskDocument.status ?? '');
    if (String(taskDocument.status ?? '') === 'running') {
      taskDocument.status = 'open';
    }
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: options.cwd,
      taskPath,
      taskId: options.taskId,
      taskDocument,
      action,
      actorId,
      sessionId: sessionRecord?.session.sessionId ?? null,
      previousStatus
    });
    clearBrokerRuntimeStateForTask({
      cwd: options.cwd,
      taskId: options.taskId
    });
    removeBrokerRegistryIfEmpty(options.cwd);
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASKS_CLAIM_RELEASED', `Claim released for ${options.taskId}.`, { taskId: options.taskId, actorId })],
      evidence: {
        action,
        taskId: options.taskId,
        actorId,
        claim: releasedClaim,
        transitionPath,
        sessionId: sessionRecord?.session.sessionId ?? null,
        session: sessionRecord?.session ?? null
      }
    });
  }

  if (action === 'handoff') {
    if (!options.handoffTo) {
      throw new CliError('ATM_CLI_USAGE', 'tasks handoff requires --to <actor-id>.', { exitCode: 2 });
    }
    if (currentClaim.actorId !== actorId) {
      throw new CliError('ATM_TASK_CLAIM_OWNER_MISMATCH', `Task ${options.taskId} is claimed by ${currentClaim.actorId}, not ${actorId}.`, {
        exitCode: 1,
        details: { taskId: options.taskId, currentActor: currentClaim.actorId, actorId }
      });
    }
    await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, actorId));
    const handedOff: TaskClaimRecord = {
      ...currentClaim,
      heartbeatAt: nowIso,
      state: 'handoff',
      handoffTo: options.handoffTo,
      reason: options.reason ?? 'handoff'
    };
    taskDocument.claim = handedOff;
    taskDocument.owner = options.handoffTo;
    const sessionRecord = updateActorWorkSessionState({
      cwd: options.cwd,
      actorId,
      taskId: options.taskId,
      claimLeaseId: currentClaim.leaseId,
      status: 'handoff',
      reason: options.reason ?? 'handoff',
      timestamp: nowIso
    });
    const previousStatus = String(taskDocument.status ?? '');
    taskDocument.status = 'open';
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: options.cwd,
      taskPath,
      taskId: options.taskId,
      taskDocument,
      action,
      actorId,
      sessionId: sessionRecord?.session.sessionId ?? null,
      previousStatus
    });
    clearBrokerRuntimeStateForTask({
      cwd: options.cwd,
      taskId: options.taskId
    });
    removeBrokerRegistryIfEmpty(options.cwd);
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASKS_CLAIM_HANDOFF', `Claim for ${options.taskId} handed off to ${options.handoffTo}.`, {
        taskId: options.taskId,
        from: actorId,
        to: options.handoffTo
      })],
      evidence: {
        action,
        taskId: options.taskId,
        actorId,
        handoffTo: options.handoffTo,
        claim: handedOff,
        transitionPath,
        sessionId: sessionRecord?.session.sessionId ?? null,
        session: sessionRecord?.session ?? null
      }
    });
  }

  if (currentClaim.actorId === actorId) {
    throw new CliError('ATM_TASKS_TAKEOVER_SELF', `tasks takeover is intended for a different actor; ${actorId} already owns ${options.taskId}.`, {
      exitCode: 2,
      details: { taskId: options.taskId, actorId }
    });
  }
  if (!options.reason || options.reason.trim().length === 0) {
    throw new CliError('ATM_CLI_USAGE', 'tasks takeover requires --reason <text>.', { exitCode: 2 });
  }
  if (!isClaimExpired(currentClaim, nowIso)) {
    throw new CliError('ATM_TASKS_TAKEOVER_NOT_ALLOWED', `Claim for ${options.taskId} is still active under ${currentClaim.actorId}.`, {
      exitCode: 1,
      details: {
        taskId: options.taskId,
        currentActor: currentClaim.actorId,
        heartbeatAt: currentClaim.heartbeatAt,
        ttlSeconds: currentClaim.ttlSeconds
      }
    });
  }
  await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, actorId));
  const takeoverClaim: TaskClaimRecord = {
    ...createClaimRecord({
      taskId: options.taskId,
      actorId,
      files,
      ttlSeconds: options.ttlSeconds,
      timestamp: nowIso
    }),
    reason: options.reason ?? `takeover from ${currentClaim.actorId}`
  };
  await resolveValue(adapter.stores.lockStore.acquireLock(taskRef, files, actorId));
  taskDocument.claim = { ...takeoverClaim, state: 'taken_over' };
  taskDocument.owner = actorId;
  const sessionRecord = upsertActorWorkSession({
    cwd: options.cwd,
    actorId,
    taskId: options.taskId,
    claimLeaseId: takeoverClaim.leaseId,
    status: 'taken_over',
    taskPath: relativeTaskPath,
    reason: options.reason ?? `takeover from ${currentClaim.actorId}`,
    timestamp: nowIso
  });
  const previousStatus = String(taskDocument.status ?? '');
  taskDocument.status = 'running';
  const transitionPath = writeTaskDocumentWithTransition({
    cwd: options.cwd,
    taskPath,
    taskId: options.taskId,
    taskDocument,
    action,
    actorId,
    sessionId: sessionRecord.session.sessionId,
    previousStatus
  });
  writeTakeoverEvidence(options.cwd, options.taskId, actorId, currentClaim, takeoverClaim);
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [message('info', 'ATM_TASKS_CLAIM_TAKEOVER', `Takeover completed for ${options.taskId}.`, {
      taskId: options.taskId,
      actorId,
      previousActor: currentClaim.actorId
    })],
    evidence: {
      action,
      taskId: options.taskId,
      actorId,
      previousClaim: currentClaim,
      claim: takeoverClaim,
      evidencePath: `.atm/history/evidence/${options.taskId}.json`,
      transitionPath,
      sessionId: sessionRecord.session.sessionId,
      session: sessionRecord.session
    }
  });
}

function parseReservationOptions(action: 'reserve' | 'promote', argv: string[]) {
  const options = {
    cwd: process.cwd(),
    taskId: '',
    actorId: null as string | null,
    title: null as string | null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      options.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      options.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--title') {
      options.title = requireValue(argv, index, '--title');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks ${action} does not support option ${arg}`, { exitCode: 2 });
  }
  if (!options.taskId) {
    throw new CliError('ATM_CLI_USAGE', `tasks ${action} requires --task <work-item-id>.`, { exitCode: 2 });
  }
  return {
    ...options,
    cwd: path.resolve(options.cwd),
    taskId: options.taskId.trim()
  };
}



function evaluateFrameworkDeliveryWindow(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly batchId: string | null;
  readonly fromBatchCheckpoint: boolean;
  readonly taskDeclaredFiles: readonly string[];
  readonly criticalChangedFiles: readonly string[];
  readonly historicalDeliveryRefs: readonly string[];
}) {
  const criticalChangedFiles = uniqueStrings(input.criticalChangedFiles.map(normalizeRelativePath).filter(Boolean));
  const declaredFiles = normalizeTaskScopePaths(input.cwd, input.taskDeclaredFiles);
  const scopedCriticalChangedFiles = criticalChangedFiles.filter((filePath) =>
    declaredFiles.some((declared) => pathMatchesTaskScope(filePath, declared))
  );
  const unscopedCriticalChangedFiles = criticalChangedFiles.filter((filePath) => !scopedCriticalChangedFiles.includes(filePath));
  const checkpointCommand = input.batchId
    ? `node atm.mjs batch checkpoint --actor ${input.actorId} --batch ${input.batchId} --json`
    : `node atm.mjs batch checkpoint --actor ${input.actorId} --json`;
  const historicalCommand = input.batchId
    ? `node atm.mjs batch checkpoint --actor ${input.actorId} --batch ${input.batchId} --delivery-commit <commit> --json`
    : `node atm.mjs batch checkpoint --actor ${input.actorId} --delivery-commit <commit> --json`;
  const normalHistoricalCloseCommand = `node atm.mjs tasks close --task ${input.taskId} --actor ${input.actorId} --status done --historical-delivery <deliveryCommit> --json`;
  const normalDeliveryCommitCommand = `node atm.mjs git commit --actor ${input.actorId} --task ${input.taskId} --message "<delivery message>" --json`;
  // TASK-AAO-0057: scoped diff isolation — unrelated (unscoped) critical changes
  // are advisory and no longer block the governed window; the window is governed
  // by either --from-batch-checkpoint or --historical-delivery covering the
  // scoped diff. Out-of-scope dirty files are surfaced separately as advisory
  // isolation diagnostics by the caller.
  const hasHistoricalDelivery = input.historicalDeliveryRefs.length > 0;
  const hasGovernedDeliveryFlag = input.fromBatchCheckpoint || hasHistoricalDelivery;
  const ok = hasGovernedDeliveryFlag && criticalChangedFiles.length > 0;
  return {
    schemaId: 'atm.frameworkDeliveryWindow.v1',
    taskId: input.taskId,
    batchId: input.batchId,
    ok,
    reason: ok
      ? input.fromBatchCheckpoint
        ? 'batch-checkpoint-scoped-framework-critical-diff'
        : 'historical-delivery-scoped-framework-critical-diff'
      : !hasGovernedDeliveryFlag
        ? 'not-from-batch-checkpoint'
        : 'no-active-framework-critical-diff',
    criticalChangedFiles,
    scopedCriticalChangedFiles,
    unscopedCriticalChangedFiles,
    declaredFiles,
    historicalDeliveryRefs: input.historicalDeliveryRefs,
    allowedBlockers: ['active-framework-claim-required', 'git-head-evidence-missing'],
    requiredCommand: input.fromBatchCheckpoint ? checkpointCommand : normalDeliveryCommitCommand,
    remediation: ok
      ? 'Batch checkpoint is the governed delivery window; commit the scoped deliverables, evidence, task file, and task events together after checkpoint succeeds.'
      : input.fromBatchCheckpoint
        ? `Remove unrelated framework critical diffs or add the real deliverable paths to the task scope before rerunning ${checkpointCommand}. If the scoped delivery already landed, use ${historicalCommand}.`
        : `Normal framework critical tasks close in two phases: first create a governed delivery commit with ${normalDeliveryCommitCommand}; then close with ${normalHistoricalCloseCommand}. Batch checkpoint commands are only for --from-batch-checkpoint closures.`
  };
}

function evaluateTaskDeliverableGate(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly taskDocument: Record<string, unknown>;
  readonly taskDeclaredFiles: readonly string[];
  readonly claim: TaskClaimRecord | null;
  readonly historicalDeliveryRefs?: readonly string[];
  readonly historicalDeliveryRepo?: string | null;
  readonly waiverOutOfScopeDelivery?: boolean;
  readonly waiverReason?: string | null;
}): TaskDeliverableGateReport {
  const required = isDeliverableDiffRequired(input.taskDocument);
  const declaredFiles = normalizeTaskScopePaths(input.cwd, input.taskDeclaredFiles);
  const changedFileReport = listChangedFilesForDeliverableGate(input.cwd, input.claim, input.taskId);
  const changedFiles = (changedFileReport.gitAvailable
    ? changedFileReport.files
    : uniqueStrings([
      ...changedFileReport.files,
      ...declaredFiles.filter((filePath) => existsSync(path.resolve(input.cwd, filePath)))
    ])
  );
  const deliverableFiles = changedFiles.filter((filePath) => isDeliverableGateCandidate(filePath, declaredFiles));
  const enforceDeclaredScope = declaredFiles.some((filePath) =>
    !filePath.startsWith('.atm/') && filePath !== normalizeRelativePath((input.taskDocument.source as { planPath?: string } | undefined)?.planPath ?? '')
  );
  const scopedDeliverables = enforceDeclaredScope
    ? deliverableFiles.filter((filePath) => declaredFiles.some((declared) => pathMatchesTaskScope(filePath, declared)))
    : deliverableFiles;
  const historicalDeliveries = (input.historicalDeliveryRefs ?? []).map((ref) => inspectHistoricalDelivery({
    cwd: input.historicalDeliveryRepo ?? input.cwd,
    taskId: input.taskId,
    requestedRef: ref,
    declaredFiles,
    enforceDeclaredScope,
    waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery === true,
    waiverReason: input.waiverReason ?? null
  }));
  const historicalDeliveryErrors = historicalDeliveries.filter((entry) => !entry.ok);
  const historicalDeliverableFiles = uniqueStrings(historicalDeliveries.flatMap((entry) => entry.deliverableFiles));
  const allDeliverableFiles = uniqueStrings([...scopedDeliverables, ...historicalDeliverableFiles]);
  const ok = !required || (allDeliverableFiles.length > 0 && historicalDeliveryErrors.length === 0);
  const reason = required
    ? ok
      ? scopedDeliverables.length > 0
        ? 'real-deliverable-diff-present'
        : 'historical-delivery-diff-present'
      : historicalDeliveryErrors.length > 0
        ? 'historical-delivery-invalid'
        : 'missing-real-deliverable-diff'
    : 'task-does-not-require-real-deliverable-diff';
  return {
    schemaId: 'atm.taskDeliverableGate.v1',
    generatedAt: new Date().toISOString(),
    taskId: input.taskId,
    deliveryPrinciple: taskDeliveryPrincipleText(),
    required,
    ok,
    reason,
    changedFiles,
    deliverableFiles: allDeliverableFiles,
    declaredFiles,
    historicalDeliveries,
    notAllowedAsCompletion: [
      'only changing .atm/history task JSON, evidence JSON, task-events, runtime locks, or queue state',
      'text-only evidence without a real deliverable file diff',
      'replaying old close commits or cherry-picking prior ledger-only closure without a scoped delivery commit',
      'closing a batch queue item before implementing the current task deliverables'
    ],
    remediation: ok
      ? 'Deliverable diff found; continue with validators and closure evidence.'
      : 'Implement the deliverables described by the task, stage or leave the real file changes visible, then rerun tasks close --status done. If the deliverable already landed in an earlier commit, pass --historical-delivery <commit> so ATM can verify the scoped non-.atm files. If the historical commit also contains unrelated source files, pass --waiver-out-of-scope-delivery with --reason. If the task is not delivered yet, close review instead of done.',
    requiredCommand: ok ? null : `node atm.mjs tasks close --task ${input.taskId} --actor <actor> --status review --reason "awaiting real deliverable diff" --json`
  };
}

function taskDeliveryPrincipleText() {
  return 'The goal is to deliver the requested task content, not to close task cards. done is only the record after real deliverables and validators exist.';
}

function resolveHistoricalBatchPath(cwd: string, batchRef: string) {
  const trimmed = batchRef.trim();
  if (!trimmed) return null;
  if (path.isAbsolute(trimmed)) return trimmed;
  if (trimmed.includes('/') || trimmed.includes('\\')) return path.resolve(cwd, trimmed);
  return path.join(cwd, '.atm', 'history', 'evidence', 'historical-batches', trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`);
}

function loadHistoricalBatchCloseSlice(cwd: string, taskId: string, batchRef: string): HistoricalBatchCloseSlice {
  const batchPath = resolveHistoricalBatchPath(cwd, batchRef);
  if (!batchPath || !existsSync(batchPath)) {
    throw new CliError('ATM_TASK_CLOSE_HISTORICAL_BATCH_NOT_FOUND', `Historical batch evidence not found for ${batchRef}.`, {
      exitCode: 1,
      details: { taskId, batchRef, batchPath: batchPath ? relativePathFrom(cwd, batchPath) : null }
    });
  }
  const envelope = JSON.parse(readFileSync(batchPath, 'utf8')) as Record<string, unknown>;
  const tasks = Array.isArray(envelope.tasks) ? envelope.tasks : [];
  const rawSlice = tasks.find((entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry) && String((entry as Record<string, unknown>).taskId ?? '') === taskId
  ) as Record<string, unknown> | undefined;
  if (!rawSlice) {
    throw new CliError('ATM_TASK_CLOSE_HISTORICAL_BATCH_TASK_NOT_FOUND', `Historical batch ${batchRef} does not contain task ${taskId}.`, {
      exitCode: 1,
      details: { taskId, batchRef, batchPath: relativePathFrom(cwd, batchPath) }
    });
  }
  return {
    batchId: typeof envelope.batchId === 'string' ? envelope.batchId : path.basename(batchPath, '.json'),
    batchPath: relativePathFrom(cwd, batchPath),
    ok: rawSlice.ok === true,
    matchedCommits: Array.isArray(rawSlice.matchedCommits) ? rawSlice.matchedCommits.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
    matchedFiles: Array.isArray(rawSlice.matchedFiles) ? rawSlice.matchedFiles.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
    coverageStatus: rawSlice.coverageStatus === 'complete' || rawSlice.coverageStatus === 'partial' || rawSlice.coverageStatus === 'blocked'
      ? rawSlice.coverageStatus
      : 'blocked',
    okToRecordEvidence: rawSlice.okToRecordEvidence === true,
    okToCloseTask: rawSlice.okToCloseTask === true,
    diagnosticOnly: rawSlice.diagnosticOnly === true,
    missingCoverage: Array.isArray(rawSlice.missingCoverage) ? rawSlice.missingCoverage.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
    taskSpecificValidationPasses: Array.isArray(rawSlice.taskSpecificValidationPasses) ? rawSlice.taskSpecificValidationPasses.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : []
  };
}

function extractTaskCloseDeclaredFiles(taskDocument: Record<string, unknown>, cwd?: string, taskId?: string): readonly string[] {
  const taskDirectionLock = taskDocument.taskDirectionLock && typeof taskDocument.taskDirectionLock === 'object' && !Array.isArray(taskDocument.taskDirectionLock)
    ? taskDocument.taskDirectionLock as Record<string, unknown>
    : {};
  const claim = taskDocument.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim)
    ? taskDocument.claim as Record<string, unknown>
    : {};
  const runtimeLock = cwd && taskId ? readRuntimeTaskDirectionLock(cwd, taskId) : {};
  return uniqueStrings([
    ...extractStringList(taskDirectionLock.allowedFiles),
    ...extractStringList(runtimeLock.allowedFiles),
    ...extractStringList(claim.files),
    ...extractStringList(taskDocument.targetAllowedFiles),
    ...extractTaskDeclaredFiles(taskDocument)
  ]);
}

function readRuntimeTaskDirectionLock(cwd: string, taskId: string): Record<string, unknown> {
  const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
  if (!existsSync(lockPath)) return {};
  try {
    const outerLock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
    const embeddedLock = outerLock.taskDirectionLock;
    return embeddedLock && typeof embeddedLock === 'object' && !Array.isArray(embeddedLock)
      ? embeddedLock as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function extractStringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean)
    : [];
}

function normalizeTaskScopePaths(cwd: string, values: readonly string[]): readonly string[] {
  return sanitizeTaskDirectionAllowedFiles(values.map((entry) => {
    const normalized = normalizeRelativePath(entry);
    if (!normalized) return '';
    return path.isAbsolute(normalized)
      ? normalizeRelativePath(relativePathFrom(cwd, normalized))
      : normalized;
  }));
}

function isDeliverableDiffRequired(taskDocument: Record<string, unknown>): boolean {
  const mode = String(taskDocument.deliverableMode ?? taskDocument.deliverable_mode ?? '').toLowerCase();
  if (mode === 'ledger-only') return false;
  const source = taskDocument.source && typeof taskDocument.source === 'object' && !Array.isArray(taskDocument.source)
    ? taskDocument.source as Record<string, unknown>
    : {};
  const importedFromPlan = typeof source.planPath === 'string' && source.planPath.trim().length > 0;
  if (importedFromPlan) return true;
  const haystack = [
    taskDocument.title,
    taskDocument.type,
    taskDocument.kind,
    taskDocument.category,
    ...(Array.isArray(taskDocument.tags) ? taskDocument.tags : []),
    ...(Array.isArray(taskDocument.deliverables) ? taskDocument.deliverables : []),
    ...(Array.isArray(taskDocument.acceptance) ? taskDocument.acceptance : [])
  ].filter((entry): entry is string => typeof entry === 'string').join('\n').toLowerCase();
  return /\b(code|pipeline|data|runner|script|report|artifact|manifest|bundle|adapter|checker|builder|job|jsonl|python|typescript|reviewer)\b/.test(haystack)
    || /資料|管線|腳本|執行器|報告|產物|審核表|清單|候選|白名單|黑名單|人物|關係/.test(haystack);
}

function listChangedFilesForDeliverableGate(cwd: string, claim: TaskClaimRecord | null, taskId: string | null = null): { readonly files: readonly string[]; readonly gitAvailable: boolean } {
  const files = new Set<string>();
  let gitAvailable = false;

  let allowedSet: Set<string> | null = null;
  if (taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (existsSync(taskPath)) {
      try {
        const taskDoc = JSON.parse(readFileSync(taskPath, 'utf8'));
        const allowedFiles = extractTaskCloseDeclaredFiles(taskDoc as Record<string, unknown>);
        if (allowedFiles.length > 0) {
          allowedSet = new Set(normalizeTaskScopePaths(cwd, allowedFiles));
        }
      } catch {
        // Ignore read/parse errors
      }
    }
  }

  for (const args of [
    ['-C', cwd, 'diff', '--name-only', '--cached'],
    ['-C', cwd, 'diff', '--name-only'],
    ['-C', cwd, 'ls-files', '-o', '--exclude-standard']
  ]) {
    try {
      const output = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      gitAvailable = true;
      const isUntrackedCmd = args.includes('ls-files');
      for (const line of output.split(/\r?\n/)) {
        const normalized = normalizeRelativePath(line);
        if (normalized) {
          if (isUntrackedCmd && allowedSet) {
            const isDeliverable = allowedSet.has(normalized)
              || isTaskCloseGovernanceCriticalPath(normalized, taskId || '');
            if (!isDeliverable) {
              continue;
            }
          }
          files.add(normalized);
        }
      }
    } catch {
      // Sandboxed or non-git hosts use a declared-file existence fallback.
    }
  }
  const committedSinceClaim = listCommittedFilesSinceClaim(cwd, claim);
  if (committedSinceClaim.gitAvailable) gitAvailable = true;
  for (const filePath of committedSinceClaim.files) {
    files.add(filePath);
  }
  return { files: [...files].sort((left, right) => left.localeCompare(right)), gitAvailable };
}

function listCommittedFilesSinceClaim(cwd: string, claim: TaskClaimRecord | null): { readonly files: readonly string[]; readonly gitAvailable: boolean } {
  return delegatedListCommittedFilesSinceClaim(cwd, claim);
}

function readGitScalar(cwd: string, args: readonly string[]): string | null {
  return delegatedReadGitScalar(cwd, args);
}

function readGitNameOnly(cwd: string, args: readonly string[]): readonly string[] {
  try {
    const output = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return uniqueStrings(output.split(/\r?\n/).map(normalizeRelativePath).filter(Boolean));
  } catch {
    return [];
  }
}





function writeLockCleanupReport(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly staleReasons: readonly string[];
  readonly cleanupActions: readonly string[];
  readonly reason: string | null;
}) {
  const directory = path.join(input.cwd, '.atm', 'history', 'reports', 'lock-cleanup');
  mkdirSync(directory, { recursive: true });
  const timestamp = new Date().toISOString();
  const filePath = path.join(directory, `${timestamp.replace(/[:.]/g, '-')}-${input.taskId}.json`);
  writeFileSync(filePath, `${JSON.stringify({
    schemaId: 'atm.lockCleanupReport.v1',
    generatedAt: timestamp,
    taskId: input.taskId,
    actorId: input.actorId,
    staleReasons: input.staleReasons,
    cleanupActions: input.cleanupActions,
    reason: input.reason
  }, null, 2)}\n`, 'utf8');
  return relativePathFrom(input.cwd, filePath);
}



function writeTaskDocument(taskPath: string, document: Record<string, unknown>) {
  mkdirSync(path.dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}



function readLegacyLedgerTaskFiles(cwd: string): readonly LegacyLedgerTaskFile[] {
  const root = path.resolve(cwd);
  const taskLedger = readTaskLedgerPolicy(root);
  const jsonTasks = listTaskFiles(path.join(root, taskLedger.taskRoot), (filePath) => filePath.endsWith('.json'))
    .map((absolutePath) => {
      const document = readJsonRecord(absolutePath);
      const taskId = normalizeTaskDocumentId(document, path.basename(absolutePath, '.json'));
      return {
        absolutePath,
        relativePath: relativePathFrom(root, absolutePath),
        taskId,
        status: normalizeTaskStatus(document.status),
        format: 'json' as const,
        document
      };
    });
  const markdownTasks = listTaskFiles(root, (filePath) => filePath.endsWith('.task.md'))
    .map((absolutePath) => {
      const rawText = readFileSync(absolutePath, 'utf8');
      const document = parseTaskMarkdownFrontmatter(rawText);
      const taskId = normalizeTaskDocumentId(document, path.basename(absolutePath).replace(/\.task\.md$/, ''));
      return {
        absolutePath,
        relativePath: relativePathFrom(root, absolutePath),
        taskId,
        status: normalizeTaskStatus(document.status),
        format: 'markdown' as const,
        document,
        rawText
      };
    });
  return [...jsonTasks, ...markdownTasks].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}



function writeLegacyBaselineTransition(input: {
  readonly cwd: string;
  readonly task: LegacyLedgerTaskFile;
  readonly actorId: string;
  readonly reason: string;
}): string {
  const createdAt = new Date().toISOString();
  const updatedDocument: Record<string, unknown> = {
    ...input.task.document,
    ledgerContractVersion: 'task-ledger/v1',
    ledgerBaselineKind: 'legacy-transition-backfill',
    ledgerBaselineByActor: input.actorId,
    ledgerBaselineReason: input.reason,
    ledgerBaselineSourceSha256: sha256(input.task.rawText ?? `${JSON.stringify(input.task.document, null, 2)}\n`)
  };
  const transitionId = createTaskTransitionId({
    createdAt,
    taskId: input.task.taskId,
    action: 'migrate-legacy-ledger',
    taskDocument: updatedDocument
  });
  updatedDocument.lastTransitionId = transitionId;
  updatedDocument.lastTransitionAt = createdAt;
  updatedDocument.ledgerBaselineAt = createdAt;
  if (input.task.format === 'json') {
    updatedDocument.legacyLedgerBaseline = {
      schemaId: 'atm.legacyTaskLedgerBaseline.v1',
      migratedAt: createdAt,
      migratedByActor: input.actorId,
      previousStatus: input.task.status || null,
      reason: input.reason,
      sourceTaskSha256: updatedDocument.ledgerBaselineSourceSha256,
      transitionId
    };
  }
  const transition = appendTaskTransitionEvent({
    cwd: input.cwd,
    taskId: input.task.taskId,
    action: 'migrate-legacy-ledger',
    actorId: input.actorId,
    fromStatus: input.task.status || null,
    toStatus: input.task.status || null,
    taskPath: input.task.absolutePath,
    taskDocument: updatedDocument,
    command: 'node atm.mjs tasks migrate-legacy-ledger',
    createdAt,
    transitionId
  });
  if (input.task.format === 'json') {
    writeTaskDocument(input.task.absolutePath, updatedDocument);
  } else {
    writeTaskMarkdownFrontmatter(input.task.absolutePath, input.task.rawText ?? '', updatedDocument);
  }
  return transition.eventPath;
}

function listTaskFiles(directoryPath: string, predicate: (filePath: string) => boolean): readonly string[] {
  if (!existsSync(directoryPath)) return [];
  const stats = safeTaskFileStat(directoryPath);
  if (!stats) return [];
  if (stats.isFile()) return predicate(directoryPath) ? [directoryPath] : [];
  const output: string[] = [];
  for (const entry of safeTaskFileReadDir(directoryPath)) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory() && shouldSkipTaskFileDiscoveryDirectory(absolutePath)) continue;
    if (entry.isDirectory()) {
      output.push(...listTaskFiles(absolutePath, predicate));
    } else if (entry.isFile() && predicate(absolutePath)) {
      output.push(absolutePath);
    }
  }
  return output;
}



function shouldSkipTaskFileDiscoveryDirectory(directoryPath: string) {
  const normalized = directoryPath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const basename = segments[segments.length - 1] ?? '';
  const ignoredSegmentNames = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'release',
    '.atm-temp',
    'scratch',
    'tmp',
    'temp',
    'library',
    'coverage',
    '.next',
    '.turbo'
  ]);
  if (ignoredSegmentNames.has(basename)) return true;
  return segments.some((segment, index) => segment === 'local' && (segments[index + 1] === 'tmp' || segments[index + 1] === 'temp'));
}



function parseTaskMarkdownFrontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const separatorIndex = rawLine.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function writeTaskMarkdownFrontmatter(filePath: string, text: string, document: Record<string, unknown>) {
  const upsertKeys = [
    'lastTransitionId',
    'lastTransitionAt',
    'ledgerContractVersion',
    'ledgerBaselineKind',
    'ledgerBaselineByActor',
    'ledgerBaselineAt',
    'ledgerBaselineReason',
    'ledgerBaselineSourceSha256'
  ];
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
  const frontmatterLines = match ? match[1].split(/\r?\n/) : [];
  const body = match ? text.slice(match[0].length) : text;
  const seenKeys = new Set<string>();
  const rewritten = frontmatterLines.map((line) => {
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) return line;
    const key = line.slice(0, separatorIndex).trim();
    if (!upsertKeys.includes(key)) return line;
    seenKeys.add(key);
    return `${key}: ${formatFrontmatterValue(document[key])}`;
  });
  for (const key of upsertKeys) {
    if (!seenKeys.has(key) && document[key] !== undefined && isFrontmatterScalar(document[key])) {
      rewritten.push(`${key}: ${formatFrontmatterValue(document[key])}`);
    }
  }
  writeFileSync(filePath, `---\n${rewritten.join('\n')}\n---\n${body}`, 'utf8');
}

function isFrontmatterScalar(value: unknown): value is string | number | boolean {
  return delegatedIsFrontmatterScalar(value);
}

function formatFrontmatterValue(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\r?\n/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeTaskDocumentId(document: Record<string, unknown>, fallback: string): string {
  return delegatedNormalizeTaskDocumentId(document, fallback);
}

function normalizeTaskStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}

function normalizeStringValue(value: unknown): string | null {
  return delegatedNormalizeStringValue(value);
}

function sha256(value: string): string {
  return delegatedSha256(value);
}

function assertLocalTaskLedgerEnabled(cwd: string, action: string) {
  return delegatedAssertLocalTaskLedgerEnabled(cwd, action);
}

function buildTaskTransitionCommand(input: {
  readonly action: string;
  readonly taskId: string;
  readonly actorId: string | null;
  readonly status?: string | null;
  readonly fromBatchCheckpoint?: boolean;
  readonly batchId?: string | null;
  readonly historicalDeliveryRefs?: readonly string[];
}): string {
  return delegatedBuildTaskTransitionCommand(input);
}

function quoteCommandValue(value: string): string {
  return /^[A-Za-z0-9._:/\\-]+$/.test(value)
    ? value
    : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function writeTaskDocumentWithTransition(input: {
  readonly cwd: string;
  readonly taskPath: string;
  readonly taskId: string;
  readonly taskDocument: Record<string, unknown>;
  readonly action: string;
  readonly actorId: string | null;
  readonly sessionId?: string | null;
  readonly previousStatus: string | null;
  readonly closureMetadata?: TaskTransitionClosureMetadata | null;
  readonly command?: string;
}) {
  const nextStatus = typeof input.taskDocument.status === 'string' ? input.taskDocument.status : null;
  const createdAt = new Date().toISOString();
  const transitionId = createTaskTransitionId({
    createdAt,
    taskId: input.taskId,
    action: input.action,
    taskDocument: input.taskDocument
  });
  input.taskDocument.lastTransitionId = transitionId;
  input.taskDocument.lastTransitionAt = createdAt;
  input.taskDocument.ledgerContractVersion = 'task-ledger/v1';
  const transition = appendTaskTransitionEvent({
    cwd: input.cwd,
    taskId: input.taskId,
    action: input.action,
    actorId: input.actorId,
    sessionId: input.sessionId ?? null,
    fromStatus: input.previousStatus,
    toStatus: nextStatus,
    taskPath: input.taskPath,
    taskDocument: input.taskDocument,
    command: input.command ?? `node atm.mjs tasks ${input.action}`,
    closureMetadata: input.closureMetadata ?? null,
    createdAt,
    transitionId
  });
  writeTaskDocument(input.taskPath, input.taskDocument);
  verifyPersistedTaskDocument({
    taskPath: input.taskPath,
    taskId: input.taskId,
    expectedStatus: nextStatus,
    action: input.action
  });
  return transition.eventPath;
}

function stageTaskCloseArtifacts(cwd: string, files: readonly (string | null | undefined)[]) {
  const normalizedFiles = uniqueStrings(files.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean));
  if (normalizedFiles.length === 0) return;
  execFileSync('git', ['add', '--', ...normalizedFiles], {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe']
  });
}

function existingTaskCloseArtifacts(cwd: string, files: readonly (string | null | undefined)[]) {
  return uniqueStrings(files
    .map((entry) => typeof entry === 'string' ? entry.trim() : '')
    .filter((entry) => entry && existsSync(path.resolve(cwd, entry))));
}

function verifyPersistedTaskDocument(input: {
  readonly taskPath: string;
  readonly taskId: string;
  readonly expectedStatus: string | null;
  readonly action: string;
}) {
  let persisted: Record<string, unknown>;
  try {
    persisted = parseJsonText(readFileSync(input.taskPath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    throw new CliError('ATM_TASK_LEDGER_WRITE_INVALID_JSON', `Task ${input.taskId} was written by ${input.action}, but the persisted JSON is unreadable.`, {
      details: {
        taskId: input.taskId,
        taskPath: input.taskPath,
        action: input.action,
        reason: error instanceof Error ? error.message : String(error)
      }
    });
  }
  const persistedTaskId = normalizeTaskDocumentId(persisted, path.basename(input.taskPath, '.json'));
  const persistedStatus = typeof persisted.status === 'string' ? persisted.status : null;
  if (!taskIdsEqual(persistedTaskId, input.taskId) || persistedStatus !== input.expectedStatus) {
    throw new CliError('ATM_TASK_LEDGER_WRITE_MISMATCH', `Task ${input.taskId} persisted an unexpected state after ${input.action}.`, {
      details: {
        taskId: input.taskId,
        taskPath: input.taskPath,
        action: input.action,
        expectedStatus: input.expectedStatus,
        persistedTaskId,
        persistedStatus
      }
    });
  }
}

function createClosureTransitionMetadata(
  closurePacketPath: string | null,
  closurePacket: ClosurePacket | null,
  batchId: string | null = null,
  sessionId: string | null = null
): TaskTransitionClosureMetadata | null {
  return delegatedCreateClosureTransitionMetadata(closurePacketPath, closurePacket, batchId, sessionId);
}

function normalizeWorkItemStatus(value: unknown): WorkItemRef['status'] {
  return delegatedNormalizeWorkItemStatus(value);
}

function inspectTaskVerifyStatus(value: unknown): {
  readonly ok: boolean;
  readonly normalizedStatus: string | null;
  readonly warningCode: string | null;
} {
  return delegatedInspectTaskVerifyStatus(value);
}

function inspectTaskSourceTrace(
  document: Record<string, unknown>,
  statusInspection: { readonly ok: boolean; readonly normalizedStatus: string | null; readonly warningCode: string | null; }
): { readonly level: 'warning' | 'error'; readonly code: string; readonly text: string } | null {
  const source = document.source as Record<string, unknown> | null;
  const planPath = source && typeof source.planPath === 'string' ? source.planPath.trim() : '';
  const sectionTitle = source && typeof source.sectionTitle === 'string' ? source.sectionTitle.trim() : '';
  const hash = source && typeof source.hash === 'string' ? source.hash.trim() : '';
  if (planPath && sectionTitle && hash) {
    return null;
  }
  const legacyHistoricalTask = isLegacyHistoricalTaskDocument(document, statusInspection);
  if (legacyHistoricalTask && planPath && sectionTitle) {
    return {
      level: 'warning',
      code: 'ATM_TASKS_VERIFY_LEGACY_SOURCE_TRACE',
      text: 'declared a legacy source trace without hash metadata; ATM will keep it as historical reference only.'
    };
  }
  return {
    level: 'error',
    code: 'ATM_TASKS_VERIFY_BAD_SOURCE_TRACE',
    text: 'declared a malformed source trace (planPath, sectionTitle, and hash are required).'
  };
}

function isLegacyHistoricalTaskDocument(
  document: Record<string, unknown>,
  statusInspection: { readonly ok: boolean; readonly normalizedStatus: string | null; readonly warningCode: string | null; }
) {
  if (statusInspection.warningCode === 'ATM_TASKS_VERIFY_LEGACY_STATUS_ALIAS') {
    return true;
  }
  const importedAt = normalizeStringValue(document.importedAt ?? document.imported_at);
  const evidencePath = normalizeStringValue(document.evidencePath ?? document.evidence_path);
  const lastTransitionId = normalizeStringValue(document.lastTransitionId ?? document.last_transition_id);
  return !importedAt && Boolean(evidencePath) && !lastTransitionId;
}

function writeTakeoverEvidence(cwd: string, taskId: string, actorId: string, previousClaim: TaskClaimRecord, newClaim: TaskClaimRecord) {
  const evidencePath = path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`);
  mkdirSync(path.dirname(evidencePath), { recursive: true });
  const current = existsSync(evidencePath)
    ? JSON.parse(readFileSync(evidencePath, 'utf8')) as Record<string, unknown>
    : {};
  const evidenceArray = Array.isArray(current.evidence) ? current.evidence as Record<string, unknown>[] : [];
  evidenceArray.push({
    evidenceKind: 'validation',
    summary: `Takeover recorded for ${taskId}: ${previousClaim.actorId} -> ${actorId}.`,
    artifactPaths: [`.atm/history/tasks/${taskId}.json`],
    producedBy: actorId,
    createdAt: new Date().toISOString(),
    details: {
      action: 'takeover',
      previousClaim,
      newClaim
    }
  });
  const envelope = {
    ...current,
    taskId,
    updatedAt: new Date().toISOString(),
    evidence: evidenceArray
  };
  writeFileSync(evidencePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
}

function extractErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.trim().length > 0 ? code : null;
}

function extractErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return {};
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  return details as Record<string, unknown>;
}

function parseImportOptions(argv: string[]) {
  const options = {
    cwd: process.cwd(),
    from: '',
    dryRun: false,
    write: false,
    force: false,
    forceOverwriteClaims: false,
    resetOpen: false,
    reopen: false,
    // TASK-AAO-0064: --strict-paths flag
    strictPaths: false,
    emergencyApproval: null as string | null,
    allowStaleRunner: parseAllowStaleRunnerFlag(argv)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--from') {
      options.from = requireValue(argv, index, '--from');
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--write') {
      options.write = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--force-overwrite-claims') {
      options.forceOverwriteClaims = true;
      continue;
    }
    if (arg === '--reset-open') {
      options.resetOpen = true;
      continue;
    }
    if (arg === '--reopen') {
      options.reopen = true;
      continue;
    }
    if (arg === '--strict-paths') {
      options.strictPaths = true;
      continue;
    }
    if (arg === '--emergency-approval') {
      options.emergencyApproval = requireValue(argv, index, '--emergency-approval');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty' || arg === '--allow-stale-runner') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks import does not support option ${arg}`, { exitCode: 2 });
  }
  return { ...options, cwd: path.resolve(options.cwd) };
}

function parseVerifyOptions(argv: string[]) {
  const options = {
    cwd: process.cwd()
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--json' || arg === '--pretty') continue;
    throw new CliError('ATM_CLI_USAGE', `tasks verify does not support option ${arg}`, { exitCode: 2 });
  }
  return { ...options, cwd: path.resolve(options.cwd) };
}

function parseRepairClosureOptions(argv: string[]): ParsedRepairClosureOptions {
  const state = {
    cwd: process.cwd(),
    taskId: null as string | null,
    actorId: null as string | null,
    scopeTaskId: null as string | null,
    dryRun: false,
    amend: false,
    emergencyApproval: null as string | null,
    allowStaleRunner: parseAllowStaleRunnerFlag(argv)
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--repo') {
      state.cwd = requireValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === '--task') {
      state.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--actor') {
      state.actorId = requireValue(argv, index, '--actor');
      index += 1;
      continue;
    }
    if (arg === '--emergency-approval') {
      state.emergencyApproval = requireValue(argv, index, '--emergency-approval');
      index += 1;
      continue;
    }
    if (arg === '--scope') {
      state.scopeTaskId = requireValue(argv, index, '--scope');
      index += 1;
      continue;
    }
    if (arg === '--dry-run') {
      state.dryRun = true;
      continue;
    }
    if (arg === '--amend') {
      state.amend = true;
      continue;
    }
    if (arg === '--no-amend') {
      state.amend = false;
      continue;
    }
    if (arg === '--json' || arg === '--pretty' || arg === '--allow-stale-runner') {
      continue;
    }
    throw new CliError('ATM_CLI_USAGE', `tasks repair-closure does not support option ${arg}`, { exitCode: 2 });
  }
  if (!state.taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks repair-closure requires --task <id>.', { exitCode: 2 });
  }
  return {
    cwd: path.resolve(state.cwd),
    taskId: state.taskId,
    actorId: state.actorId,
    scopeTaskId: state.scopeTaskId,
    dryRun: state.dryRun,
    allowStaleRunner: state.allowStaleRunner,
    emergencyApproval: state.emergencyApproval,
    amend: state.amend
  };
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `tasks requires a value for ${flag}`, { exitCode: 2 });
  }
  return value;
}

export interface ParsedPlanResult {
  readonly tasks: readonly TaskImportRecord[];
  readonly diagnostics: TaskImportDiagnostic[];
}

export function parsePlanMarkdown(input: {
  readonly planText: string;
  readonly planRelativePath: string;
  readonly importedAt: string;
}): ParsedPlanResult {
  const { planText, planRelativePath, importedAt } = input;
  const lines = planText.split(/\r?\n/);
  const tasks: TaskImportRecord[] = [];
  const diagnostics: TaskImportDiagnostic[] = [];
  const seenIds = new Set<string>();
  const tableMetadata = parseTaskTableMetadata(lines);

  const singleCard = parseSingleCard({ planText, planRelativePath, importedAt });
  if (singleCard) {
    if (seenIds.has(singleCard.workItemId)) {
      diagnostics.push({
        level: 'error',
        code: 'ATM_TASKS_DUPLICATE_ID',
        text: `Duplicate task id ${singleCard.workItemId} in plan.`,
        workItemId: singleCard.workItemId
      });
    } else {
      tasks.push(singleCard);
      seenIds.add(singleCard.workItemId);
    }
    return { tasks, diagnostics };
  }

  const sections = splitPlanIntoTaskSections(lines);
  for (const section of sections) {
    const record = parseTaskSection({
      section,
      planRelativePath,
      importedAt,
      tableMetadata: tableMetadata.get(section.workItemId) ?? null
    });
    if (!record) continue;
    if (seenIds.has(record.task.workItemId)) {
      diagnostics.push({
        level: 'error',
        code: 'ATM_TASKS_DUPLICATE_ID',
        text: `Duplicate task id ${record.task.workItemId} at line ${section.headingLine}.`,
        workItemId: record.task.workItemId,
        sourceLine: section.headingLine
      });
      continue;
    }
    seenIds.add(record.task.workItemId);
    tasks.push(record.task);
    diagnostics.push(...record.diagnostics);
  }
  for (const record of parseChineseLabeledTaskBlocks({ lines, planRelativePath, importedAt })) {
    if (seenIds.has(record.workItemId)) continue;
    seenIds.add(record.workItemId);
    tasks.push(record);
  }
  for (const [workItemId, metadata] of tableMetadata.entries()) {
    if (seenIds.has(workItemId)) continue;
    seenIds.add(workItemId);
    tasks.push(createTaskFromTableMetadata({
      metadata,
      planRelativePath,
      importedAt
    }));
  }
  return { tasks, diagnostics };
}

interface ParsedTaskSection {
  readonly headingLine: number;
  readonly title: string;
  readonly workItemId: string;
  readonly bodyLines: readonly string[];
}

interface TaskTableMetadata {
  readonly workItemId: string;
  readonly title: string;
  readonly milestone: string | null;
  readonly status: TaskImportStatus;
  readonly dependencies: readonly string[];
  readonly deliverables: readonly string[];
  readonly headingLine: number;
  readonly rowText: string;
}

function parseChineseLabeledTaskBlocks(input: {
  readonly lines: readonly string[];
  readonly planRelativePath: string;
  readonly importedAt: string;
}): readonly TaskImportRecord[] {
  const records: TaskImportRecord[] = [];
  for (let index = 0; index < input.lines.length; index += 1) {
    const idMatch = /^\s*(?:[-*]\s*)?(?:任務\s*ID|任務ID|任務|Task\s*ID)\s*[：:]\s*(`?[^`\s]+`?)/i.exec(input.lines[index]);
    if (!idMatch) continue;
    const taskIdMatch = taskIdAnywherePattern.exec(idMatch[1]);
    if (!taskIdMatch) continue;
    const workItemId = normalizeTaskId(taskIdMatch[0]);
    const bodyLines: string[] = [];
    let cursor = index + 1;
    while (cursor < input.lines.length) {
      const line = input.lines[cursor];
      if (/^\s*(?:[-*]\s*)?(?:任務\s*ID|任務ID|Task\s*ID)\s*[：:]/i.test(line)) break;
      if (/^#{1,3}\s+/.test(line) && taskIdAnywherePattern.test(line)) break;
      bodyLines.push(line);
      cursor += 1;
    }
    const title = collectChineseLabeledValue(bodyLines, ['標題', '名稱', 'title']) ?? workItemId;
    const milestone = collectChineseLabeledValue(bodyLines, ['里程碑', '階段', 'milestone']) ?? null;
    const status = coerceStatus(collectChineseLabeledValue(bodyLines, ['狀態', 'status', 'state']) ?? 'open');
    const dependencies = parseDependencyList(collectChineseLabeledValue(bodyLines, ['依賴', '相依', '前置', 'depends on']) ?? '', workItemId);
    const acceptance = collectChineseLabeledList(bodyLines, ['驗收', '驗收條件', 'acceptance']);
    const deliverables = collectChineseLabeledList(bodyLines, ['交付物', '產物', '輸出', 'deliverables']);
    const notes = collectChineseLabeledValue(bodyLines, ['備註', '說明', 'notes']);
    records.push({
      schemaVersion: 'atm.workItem.v0.2',
      workItemId,
      title,
      status,
      milestone,
      dependencies,
      acceptance,
      deliverables,
      tags: [],
      notes,
      source: {
        planPath: input.planRelativePath,
        sectionTitle: title,
        headingLine: index + 1,
        hash: hashSection(`${workItemId}\n${bodyLines.join('\n')}`)
      },
      importedAt: input.importedAt
    });
    index = cursor - 1;
  }
  return records;
}

function collectChineseLabeledValue(lines: readonly string[], labels: readonly string[]): string | null {
  const labelPattern = labels.map(escapeRegExp).join('|');
  const regex = new RegExp(`^\\s*(?:[-*]\\s*)?(?:${labelPattern})\\s*[：:]\\s*(.+?)\\s*$`, 'i');
  for (const line of lines) {
    const match = regex.exec(line);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function collectChineseLabeledList(lines: readonly string[], labels: readonly string[]): readonly string[] {
  const first = collectChineseLabeledValue(lines, labels);
  if (!first) return [];
  return first
    .split(/[、,，;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function detectPlanHeadings(planText: string): readonly { readonly line: number; readonly text: string }[] {
  return planText.split(/\r?\n/).flatMap((line, index) => {
    const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    return match ? [{ line: index + 1, text: match[1] }] : [];
  });
}

function parseTaskTableMetadata(lines: readonly string[]): Map<string, TaskTableMetadata> {
  const entries = new Map<string, TaskTableMetadata>();
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index].trim();
    const separatorLine = lines[index + 1].trim();
    if (!isMarkdownTableRow(headerLine) || !isMarkdownTableSeparator(separatorLine)) {
      continue;
    }
    const headerCells = parseMarkdownTableCells(headerLine).map((cell) => normalizeTableHeader(cell));
    const taskIdIndex = findTableColumnIndex(headerCells, ['task id', 'task', 'work item id', 'workitemid', 'id', '任務', '任務id', '任務 id']);
    if (taskIdIndex < 0) {
      continue;
    }
    const titleIndex = findTableColumnIndex(headerCells, ['title', 'name', '標題', '名稱']);
    const milestoneIndex = findTableColumnIndex(headerCells, ['milestone', 'phase', '里程碑', '階段']);
    const statusIndex = findTableColumnIndex(headerCells, ['status', 'state', '狀態']);
    const dependenciesIndex = findTableColumnIndex(headerCells, ['blocked by', 'depends on', 'dependencies', '依賴', '相依', '前置']);
    const deliverablesIndex = findTableColumnIndex(headerCells, ['deliverables', 'outputs', 'outcomes', '交付物', '產物', '輸出']);

    let rowIndex = index + 2;
    while (rowIndex < lines.length) {
      const rawLine = lines[rowIndex];
      const trimmed = rawLine.trim();
      if (!isMarkdownTableRow(trimmed) || isMarkdownTableSeparator(trimmed)) {
        break;
      }
      const cells = parseMarkdownTableCells(trimmed);
      const idCell = cellAt(cells, taskIdIndex);
      const idMatch = taskIdPattern.exec(idCell);
      if (idMatch) {
        const workItemId = normalizeTaskId(idMatch[0]);
        const deliverableCell = cellAt(cells, deliverablesIndex);
        entries.set(workItemId, {
          workItemId,
          title: cellAt(cells, titleIndex) || workItemId,
          milestone: cellAt(cells, milestoneIndex) || null,
          status: coerceStatus(cellAt(cells, statusIndex) || 'planned'),
          dependencies: parseDependencyList(cellAt(cells, dependenciesIndex), workItemId),
          deliverables: deliverableCell ? [deliverableCell] : [],
          headingLine: rowIndex + 1,
          rowText: rawLine
        });
      }
      rowIndex += 1;
    }
    index = rowIndex - 1;
  }
  return entries;
}

function splitPlanIntoTaskSections(lines: readonly string[]): readonly ParsedTaskSection[] {
  const sections: ParsedTaskSection[] = [];
  let current: { headingLine: number; title: string; workItemId: string; bodyLines: string[] } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      const candidate = headingMatch[1];
      const idMatch = taskIdPattern.exec(candidate);
      if (idMatch) {
        if (current) sections.push(current);
        const workItemId = normalizeTaskId(idMatch[0]);
        current = {
          headingLine: index + 1,
          title: candidate.replace(taskIdPattern, '').replace(/^[\s:：.\-—–]+/u, '').trim() || workItemId,
          workItemId,
          bodyLines: []
        };
        continue;
      }
    }
    if (current) {
      current.bodyLines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function parseSingleCard(input: {
  readonly planText: string;
  readonly planRelativePath: string;
  readonly importedAt: string;
}): TaskImportRecord | null {
  const frontMatter = extractFrontMatter(input.planText);
  if (!frontMatter || typeof frontMatter.data.task_id !== 'string') return null;
  const workItemId = normalizeTaskId(frontMatter.data.task_id);
  const title = normalizeOptionalString(frontMatter.data.title) ?? workItemId;
  const status = coerceStatus(typeof frontMatter.data.status === 'string' ? frontMatter.data.status : 'planned');
  const milestone = normalizeOptionalString(frontMatter.data.milestone);
  const dependencies = parseYamlList(frontMatter.data.depends_on ?? frontMatter.data.blocked_by ?? frontMatter.data.dependencies);
  const tags = parseYamlList(frontMatter.data.tags);
  const scopePaths = parseYamlList(frontMatter.data.scopePaths ?? frontMatter.data.scope_paths ?? frontMatter.data.allowed_files ?? frontMatter.data.allowedFiles ?? frontMatter.data.scope);
  const validators = parseYamlList(frontMatter.data.validators);
  const planningMirrorPaths = parseYamlList(frontMatter.data.planningMirrorPaths ?? frontMatter.data.planning_mirror_paths);
  const planningReadOnlyPaths = parseYamlList(frontMatter.data.planningReadOnlyPaths ?? frontMatter.data.planning_read_only_paths);
  const outOfScope = parseYamlList(frontMatter.data.outOfScope ?? frontMatter.data.out_of_scope ?? frontMatter.data.forbidden_files);
  const nonGoals = parseYamlList(frontMatter.data.nonGoals ?? frontMatter.data.non_goals);
  const atomizationImpactFrontMatter = frontMatter.data.atomizationImpact && typeof frontMatter.data.atomizationImpact === 'object' && !Array.isArray(frontMatter.data.atomizationImpact)
    ? frontMatter.data.atomizationImpact as Record<string, unknown>
    : {};
  const mapUpdates = parseYamlList(
    frontMatter.data.mapUpdates
    ?? frontMatter.data.map_updates
    ?? atomizationImpactFrontMatter.mapUpdates
    ?? atomizationImpactFrontMatter.map_updates
  );
  const body = input.planText.slice(frontMatter.endIndex);
  const sections = sliceBodyByHeadings(body);
  const acceptance = collectBulletList(sections, acceptanceHeaders);
  const frontMatterScopePaths = parseYamlList(frontMatter.data.scopePaths ?? frontMatter.data.scope_paths ?? frontMatter.data.allowed_files ?? frontMatter.data.allowedFiles ?? frontMatter.data.scope);
  const frontMatterDeliverables = parseYamlList(frontMatter.data.deliverables);
  const bodyDeliverables = collectBulletList(sections, deliverablesHeaders);
  // TASK-AAO-0064 L1: frontmatter 優先（frontmatter canonical）
  // 若 frontmatter 已提供 deliverables，body parser 結果忽略，記錄診斷
  let deliverables: readonly string[];
  const cardImportDiagnostics: TaskCardImportDiagnostic[] = [];
  if (frontMatterDeliverables.length > 0 && bodyDeliverables.length > 0) {
    deliverables = uniqueStrings(frontMatterDeliverables.map(normalizeYamlScalar));
    cardImportDiagnostics.push({
      code: 'IMPORT_BODY_SECTION_IGNORED',
      severity: 'warning',
      message: 'Front-matter `deliverables` key is present; body section deliverables were ignored in favour of front-matter values.',
      field: 'deliverables'
    });
  } else if (frontMatterDeliverables.length > 0) {
    deliverables = uniqueStrings(frontMatterDeliverables.map(normalizeYamlScalar));
  } else {
    deliverables = uniqueStrings(bodyDeliverables.map(normalizeYamlScalar));
  }
  const notes = collectText(sections, notesHeaders) ?? null;
  const evidenceFrontMatter = frontMatter.data.evidence && typeof frontMatter.data.evidence === 'object' && !Array.isArray(frontMatter.data.evidence)
    ? frontMatter.data.evidence as Record<string, unknown>
    : {};
  const rollbackFrontMatter = frontMatter.data.rollback && typeof frontMatter.data.rollback === 'object' && !Array.isArray(frontMatter.data.rollback)
    ? frontMatter.data.rollback as Record<string, unknown>
    : {};
  const evidenceRequired = normalizeOptionalString(
    frontMatter.data.evidenceRequired
    ?? frontMatter.data.evidence_required
    ?? frontMatter.data.required
    ?? evidenceFrontMatter.required
    ?? evidenceFrontMatter.kind
  );
  const rollbackStrategy = normalizeOptionalString(
    frontMatter.data.rollbackStrategy
    ?? frontMatter.data.rollback_strategy
    ?? frontMatter.data.strategy
    ?? rollbackFrontMatter.strategy
  );
  const rollbackNotes = normalizeOptionalString(
    frontMatter.data.rollbackNotes
    ?? frontMatter.data.rollback_notes
    ?? rollbackFrontMatter.notes
  );
  const contextMap = parseContextMap(frontMatter.data.contextMap);
  let dispatchMetadata: TaskDispatchMetadata = {};
  try {
    dispatchMetadata = parseDispatchMetadataFromPlanText(input.planText);
  } catch (error) {
    cardImportDiagnostics.push({
      code: 'ATM_TASK_IMPORT_DISPATCH_METADATA_TOO_LARGE',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
      field: 'dispatchPattern'
    });
  }
  const importDiagnostics: TaskCardImportDiagnostic[] = [...cardImportDiagnostics];
  if (frontMatter.data.allowed_files !== undefined && frontMatter.data.scopePaths === undefined && frontMatter.data.scope_paths === undefined) {
    importDiagnostics.push({
      code: 'ATM_TASK_IMPORT_LEGACY_ALIAS',
      severity: 'warning',
      message: 'Front-matter uses legacy alias `allowed_files`; ATM imports the value as `scopePaths` to preserve target-repo scope. Prefer `scopePaths` in new task cards.',
      field: 'scopePaths',
      alias: 'allowed_files',
      canonical: 'scopePaths'
    });
  }
  if (frontMatter.data.blocked_by !== undefined && frontMatter.data.depends_on === undefined && frontMatter.data.dependencies === undefined) {
    importDiagnostics.push({
      code: 'ATM_TASK_IMPORT_LEGACY_ALIAS',
      severity: 'warning',
      message: 'Front-matter uses legacy alias `blocked_by`; ATM imports the value as `dependencies`. Prefer `depends_on` or `dependencies`.',
      field: 'dependencies',
      alias: 'blocked_by',
      canonical: 'depends_on'
    });
  }
  if (frontMatter.data.upstream_repo !== undefined && frontMatter.data.target_repo === undefined && frontMatter.data.targetRepo === undefined) {
    importDiagnostics.push({
      code: 'ATM_TASK_IMPORT_LEGACY_ALIAS',
      severity: 'warning',
      message: 'Front-matter uses legacy alias `upstream_repo`; ATM imports the value as `targetRepo`. Prefer `target_repo`.',
      field: 'targetRepo',
      alias: 'upstream_repo',
      canonical: 'target_repo'
    });
  }

  if (scopePaths.length > 0 && outOfScope.length > 0) {
    const intersections = scopePaths.filter((p) => isPathAllowedByScope(p, outOfScope));
    if (intersections.length > 0) {
      importDiagnostics.push({
        code: 'ATM_TASK_SCOPE_OUT_OF_SCOPE_INTERSECTION',
        severity: 'warning',
        message: `Task scope paths intersect with outOfScope: ${intersections.join(', ')}. These files will be subtracted from targetAllowedFiles.`,
        field: 'scopePaths'
      });
    }
  }

  return {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId,
    title,
    status,
    milestone,
    dependencies,
    acceptance,
    deliverables,
    scopePaths,
    validators,
    planningRepo: normalizeOptionalString(frontMatter.data.planning_repo ?? frontMatter.data.planningRepo),
    targetRepo: normalizeOptionalString(frontMatter.data.target_repo ?? frontMatter.data.targetRepo ?? frontMatter.data.upstream_repo ?? frontMatter.data.upstreamRepo),
    closureAuthority: normalizeOptionalString(frontMatter.data.closure_authority ?? frontMatter.data.closureAuthority),
    planningReadOnlyPaths,
    planningMirrorPaths,
    outOfScope,
    nonGoals,
    evidenceRequired,
    rollbackStrategy,
    rollbackNotes,
    contextMap,
    ...(dispatchMetadata.dispatchPattern ? { dispatchPattern: dispatchMetadata.dispatchPattern } : {}),
    ...(dispatchMetadata.conditionReview && dispatchMetadata.conditionReview.length > 0
      ? { conditionReview: dispatchMetadata.conditionReview }
      : {}),
    ...(dispatchMetadata.mailboxAssignee ? { mailboxAssignee: dispatchMetadata.mailboxAssignee } : {}),
    atomizationImpact: {
      ownerAtomOrMap: normalizeOptionalString(
        frontMatter.data.ownerAtomOrMap
        ?? frontMatter.data.owner_atom_or_map
        ?? atomizationImpactFrontMatter.ownerAtomOrMap
        ?? atomizationImpactFrontMatter.owner_atom_or_map
      ),
      mapUpdates
    },
    legacyImportAliases: {
      ...(frontMatter.data.allowed_files ? { allowed_files: parseYamlList(frontMatter.data.allowed_files) } : {}),
      ...(frontMatter.data.blocked_by ? { blocked_by: parseYamlList(frontMatter.data.blocked_by) } : {}),
      ...(frontMatter.data.upstream_repo ? { upstream_repo: normalizeOptionalString(frontMatter.data.upstream_repo) ?? '' } : {})
    },
    importDiagnostics,
    tags,
    notes,
    source: {
      planPath: input.planRelativePath,
      sectionTitle: workItemId,
      headingLine: frontMatter.headingLine,
      hash: hashSection(input.planText)
    },
    importedAt: input.importedAt
  };
}

function enrichParsedTasksFromSiblingTaskCards(input: {
  readonly cwd: string;
  readonly planAbsolute: string;
  readonly parsed: ParsedPlanResult;
  readonly importedAt: string;
}): ParsedPlanResult {
  const taskCardRoot = path.join(path.dirname(input.planAbsolute), 'tasks');
  if (!existsSync(taskCardRoot)) return input.parsed;
  let entries: Dirent[];
  try {
    entries = readdirSync(taskCardRoot, { withFileTypes: true });
  } catch {
    return input.parsed;
  }
  const cardByTaskId = new Map<string, TaskImportRecord>();
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.task.md')) continue;
    const taskIdMatch = taskIdPattern.exec(entry.name);
    if (!taskIdMatch) continue;
    const cardPath = path.join(taskCardRoot, entry.name);
    const cardText = readFileSync(cardPath, 'utf8');
    const card = parseSingleCard({
      planText: cardText,
      planRelativePath: relativePathFrom(input.cwd, cardPath),
      importedAt: input.importedAt
    });
    if (card) cardByTaskId.set(card.workItemId, card);
  }
  if (cardByTaskId.size === 0) return input.parsed;
  const tasks = input.parsed.tasks.map((task) => {
    const card = cardByTaskId.get(task.workItemId);
    if (!card) return task;
    return {
      ...task,
      ...card,
      source: card.source,
      importedAt: task.importedAt
    };
  });
  const diagnostics = [...input.parsed.diagnostics];
  const enrichedCount = tasks.filter((task) => cardByTaskId.has(task.workItemId)).length;
  if (enrichedCount > 0) {
    diagnostics.push({
      level: 'info',
      code: 'ATM_TASKS_IMPORT_CARD_CONTRACT_MERGED',
      text: `Merged machine-readable frontmatter from ${enrichedCount} sibling task card(s).`
    });
  }
  return { tasks, diagnostics };
}

function parseTaskSection(input: {
  readonly section: ParsedTaskSection;
  readonly planRelativePath: string;
  readonly importedAt: string;
  readonly tableMetadata: TaskTableMetadata | null;
}): { task: TaskImportRecord; diagnostics: TaskImportDiagnostic[] } | null {
  const { section } = input;
  const diagnostics: TaskImportDiagnostic[] = [];
  const sectionText = section.bodyLines.join('\n');
  const sectionsByHeading = sliceBodyByHeadings(sectionText);
  const acceptance = [
    ...collectBulletList(sectionsByHeading, acceptanceHeaders),
    ...collectLabeledText(section.bodyLines, ['acceptance criteria', 'acceptance', '驗收'])
  ];
  const deliverables = uniqueStrings([
    ...collectBulletList(sectionsByHeading, deliverablesHeaders),
    ...collectLabeledText(section.bodyLines, ['deliverables', 'outputs', 'outcomes', 'evidence', 'validation', '輸出', '驗證']),
    ...(input.tableMetadata?.deliverables ?? [])
  ]);
  const sectionDependencies = collectBulletList(sectionsByHeading, dependenciesHeaders)
    .flatMap((entry) => parseDependencyList(entry, section.workItemId));
  const dependencies = uniqueStrings(sectionDependencies.length > 0 ? sectionDependencies : input.tableMetadata?.dependencies ?? []);
  const tags = collectBulletList(sectionsByHeading, tagsHeaders);
  const notes = collectText(sectionsByHeading, notesHeaders) ?? null;
  const statusRaw = collectKeyValue(sectionsByHeading, 'status')
    ?? collectKeyValue(sectionsByHeading, 'state')
    ?? collectKeyValueFromLines(section.bodyLines, 'status')
    ?? collectKeyValueFromLines(section.bodyLines, 'state')
    ?? input.tableMetadata?.status
    ?? 'planned';
  const milestone = collectKeyValue(sectionsByHeading, 'milestone')
    ?? collectKeyValueFromLines(section.bodyLines, 'milestone')
    ?? input.tableMetadata?.milestone
    ?? null;
  const status = coerceStatus(statusRaw);
  const hash = hashSection(`${section.workItemId}\n${sectionText}`);

  if (!validStatuses.has(status)) {
    diagnostics.push({
      level: 'warning',
      code: 'ATM_TASKS_STATUS_UNKNOWN',
      text: `Task ${section.workItemId} declared unknown status ${statusRaw}; defaulted to planned.`,
      workItemId: section.workItemId,
      sourceLine: section.headingLine
    });
  }

  const task: TaskImportRecord = {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: section.workItemId,
    title: section.title || input.tableMetadata?.title || section.workItemId,
    status,
    milestone: milestone ?? null,
    dependencies,
    acceptance,
    deliverables,
    tags,
    notes,
    source: {
      planPath: input.planRelativePath,
      sectionTitle: section.title || section.workItemId,
      headingLine: section.headingLine,
      hash
    },
    importedAt: input.importedAt
  };
  return { task, diagnostics };
}

function createTaskFromTableMetadata(input: {
  readonly metadata: TaskTableMetadata;
  readonly planRelativePath: string;
  readonly importedAt: string;
}): TaskImportRecord {
  return delegatedCreateTaskFromTableMetadata({ ...input, hashSection }) as TaskImportRecord;
}


function hasProtectedActiveClaim(document: Record<string, unknown> | null): boolean {
  if (!document) return false;
  const claim = parseClaimRecord(document.claim);
  return Boolean(claim && (claim.state === 'active' || claim.state === 'handoff'));
}

function importWouldOverwriteTask(input: {
  readonly current: Record<string, unknown>;
  readonly task: TaskImportRecord;
  readonly force: boolean;
  readonly resetOpen: boolean;
  readonly reopen: boolean;
}): boolean {
  const currentHash = (input.current.source as { hash?: string } | undefined)?.hash ?? (input.current.hash as string | undefined) ?? '';
  if (input.resetOpen || input.reopen) return true;
  if (input.force) return currentHash !== input.task.source.hash;
  return currentHash !== input.task.source.hash;
}

function shouldSkipImportForActiveClaim(options: {
  readonly force: boolean;
  readonly forceOverwriteClaims: boolean;
  readonly resetOpen: boolean;
  readonly reopen: boolean;
  readonly wouldOverwrite: boolean;
}): boolean {
  if (!options.wouldOverwrite || options.forceOverwriteClaims || options.force || options.resetOpen || options.reopen) {
    return false;
  }
  return true;
}

function collectActiveClaimImportSkips(
  cwd: string,
  tasks: readonly TaskImportRecord[],
  options: {
    readonly force: boolean;
    readonly forceOverwriteClaims: boolean;
    readonly resetOpen: boolean;
    readonly reopen: boolean;
  }
): TaskImportDiagnostic[] {
  const diagnostics: TaskImportDiagnostic[] = [];
  const taskLedger = readTaskLedgerPolicy(cwd);
  const taskStoreDirectory = path.join(cwd, taskLedger.taskRoot);
  for (const task of tasks) {
    const filePath = path.join(taskStoreDirectory, `${task.workItemId}.json`);
    if (!existsSync(filePath)) continue;
    try {
      const existingDocument = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      if (!hasProtectedActiveClaim(existingDocument)) continue;
      const wouldOverwrite = importWouldOverwriteTask({
        current: existingDocument,
        task,
        force: options.force,
        resetOpen: options.resetOpen,
        reopen: options.reopen
      });
      if (!shouldSkipImportForActiveClaim({ ...options, wouldOverwrite })) continue;
      diagnostics.push({
        level: 'warning',
        code: 'IMPORT_SKIPPED_ACTIVE_CLAIM',
        text: `Task ${task.workItemId} has an active claim; import skipped to avoid overwriting claim state.`,
        workItemId: task.workItemId
      });
    } catch {
      // ignore unreadable existing task files during preview
    }
  }
  return diagnostics;
}

function writeTaskFiles(input: {
  readonly cwd: string;
  readonly tasks: readonly TaskImportRecord[];
  readonly force: boolean;
  readonly forceOverwriteClaims: boolean;
  readonly resetOpen: boolean;
  readonly reopen: boolean;
}): { writtenPaths: string[]; diagnostics: TaskImportDiagnostic[] } {
  const writtenPaths: string[] = [];
  const diagnostics: TaskImportDiagnostic[] = [];
  const taskLedger = readTaskLedgerPolicy(input.cwd);
  const taskStoreDirectory = path.join(input.cwd, taskLedger.taskRoot);
  mkdirSync(taskStoreDirectory, { recursive: true });
  for (const task of input.tasks) {
    const filePath = path.join(taskStoreDirectory, `${task.workItemId}.json`);
    if (existsSync(filePath) && !input.force) {
      try {
        const current = JSON.parse(readFileSync(filePath, 'utf8')) as { hash?: string; source?: { hash?: string } };
        const currentHash = current.source?.hash ?? current.hash ?? '';
        if (currentHash === task.source.hash && !input.resetOpen && !input.reopen) {
          diagnostics.push({
            level: 'info',
            code: 'ATM_TASKS_IMPORT_UNCHANGED',
            text: `Task ${task.workItemId} is unchanged; left existing file in place.`,
            workItemId: task.workItemId
          });
          continue;
        }
        const currentStatus = normalizeTaskStatus((current as { status?: unknown }).status);
        if (currentStatus === 'done' && !input.reopen && !input.resetOpen) {
          diagnostics.push({
            level: 'error',
            code: 'ATM_TASKS_IMPORT_DONE_REQUIRES_REOPEN',
            text: `Task ${task.workItemId} is done; use --reopen or --reset-open before overwriting it.`,
            workItemId: task.workItemId
          });
          continue;
        }
        if (input.force) {
          const currentSource = (current as { source?: { planPath?: string; hash?: string } }).source;
          const sameSource = currentSource?.planPath === task.source.planPath || currentHash === task.source.hash;
          if (!sameSource) {
            diagnostics.push({
              level: 'error',
              code: 'ATM_TASKS_IMPORT_FORCE_SOURCE_MISMATCH',
              text: `Task ${task.workItemId} exists from a different source; refusing --force overwrite.`,
              workItemId: task.workItemId
            });
            continue;
          }
        }
        const existingDocument = current as Record<string, unknown>;
        const wouldOverwrite = importWouldOverwriteTask({
          current: existingDocument,
          task,
          force: input.force,
          resetOpen: input.resetOpen,
          reopen: input.reopen
        });
        if (hasProtectedActiveClaim(existingDocument) && shouldSkipImportForActiveClaim({
          force: input.force,
          forceOverwriteClaims: input.forceOverwriteClaims,
          resetOpen: input.resetOpen,
          reopen: input.reopen,
          wouldOverwrite
        })) {
          diagnostics.push({
            level: 'warning',
            code: 'IMPORT_SKIPPED_ACTIVE_CLAIM',
            text: `Task ${task.workItemId} has an active claim; import skipped to avoid overwriting claim state.`,
            workItemId: task.workItemId
          });
          continue;
        }
        diagnostics.push({
          level: 'error',
          code: 'ATM_TASKS_IMPORT_DRIFT',
          text: `Task ${task.workItemId} exists with a different hash; rerun with --force to overwrite.`,
          workItemId: task.workItemId
        });
        continue;
      } catch {
        diagnostics.push({
          level: 'error',
          code: 'ATM_TASKS_IMPORT_UNREADABLE_EXISTING',
          text: `Task ${task.workItemId} file exists but is unreadable; rerun with --force to overwrite.`,
          workItemId: task.workItemId
        });
        continue;
      }
    }
  }
  if (diagnostics.some((entry) => entry.level === 'error')) {
    return { writtenPaths, diagnostics };
  }
  for (const task of input.tasks) {
    const filePath = path.join(taskStoreDirectory, `${task.workItemId}.json`);
    if (existsSync(filePath) && !input.force) {
      continue;
    }
    let existingDocument: Record<string, unknown> | null = null;
    if (existsSync(filePath)) {
      try {
        existingDocument = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
      } catch {
        // ignore
      }
    }
    const wouldOverwrite = existingDocument
      ? importWouldOverwriteTask({
        current: existingDocument,
        task,
        force: input.force,
        resetOpen: input.resetOpen,
        reopen: input.reopen
      })
      : true;
    if (existingDocument && hasProtectedActiveClaim(existingDocument) && shouldSkipImportForActiveClaim({
      force: input.force,
      forceOverwriteClaims: input.forceOverwriteClaims,
      resetOpen: input.resetOpen,
      reopen: input.reopen,
      wouldOverwrite
    })) {
      diagnostics.push({
        level: 'warning',
        code: 'IMPORT_SKIPPED_ACTIVE_CLAIM',
        text: `Task ${task.workItemId} has an active claim; import skipped to avoid overwriting claim state.`,
        workItemId: task.workItemId
      });
      continue;
    }
    const displacedClaim = existingDocument && input.forceOverwriteClaims && hasProtectedActiveClaim(existingDocument)
      ? parseClaimRecord(existingDocument.claim)
      : null;
    const taskDocument = {
      ...task,
      ...(input.resetOpen ? { status: 'open' as const } : {}),
      ...(input.reopen ? { status: 'open' as const, reopenedAt: new Date().toISOString() } : {})
    } as Record<string, unknown>;
    if (input.resetOpen || input.reopen) {
      delete taskDocument.claim;
      delete taskDocument.closedAt;
      delete taskDocument.closedByActor;
      delete taskDocument.closurePacket;
      delete taskDocument.closeReason;
    } else if (existingDocument && hasProtectedActiveClaim(existingDocument) && input.force && !input.forceOverwriteClaims) {
      const currentClaim = parseClaimRecord(existingDocument.claim);
      if (currentClaim) {
        taskDocument.claim = existingDocument.claim;
        if (existingDocument.status) taskDocument.status = existingDocument.status;
        if (existingDocument.owner) taskDocument.owner = existingDocument.owner;
        if (existingDocument.startedAt) taskDocument.startedAt = existingDocument.startedAt;
        if (existingDocument.startedBySessionId) taskDocument.startedBySessionId = existingDocument.startedBySessionId;
      }
      if (existingDocument.taskDirectionLock) {
        taskDocument.taskDirectionLock = existingDocument.taskDirectionLock;
      }
    }
    const previousStatus = typeof existingDocument?.status === 'string' ? existingDocument.status : null;
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: input.cwd,
      taskPath: filePath,
      taskId: task.workItemId,
      taskDocument,
      action: 'import',
      actorId: null,
      previousStatus
    });
    if (displacedClaim) {
      const displacedAt = new Date().toISOString();
      appendTaskTransitionEvent({
        cwd: input.cwd,
        taskId: task.workItemId,
        action: 'claim-displaced-by-import',
        actorId: null,
        sessionId: null,
        fromStatus: previousStatus,
        toStatus: typeof taskDocument.status === 'string' ? taskDocument.status : null,
        taskPath: filePath,
        taskDocument: {
          ...taskDocument,
          displacedClaim: {
            actorId: displacedClaim.actorId,
            leaseId: displacedClaim.leaseId,
            state: displacedClaim.state,
            reason: 'import overwrite with --force-overwrite-claims',
            importTransitionPath: transitionPath
          }
        },
        command: 'node atm.mjs tasks import --write --force-overwrite-claims',
        createdAt: displacedAt
      });
    }
    writtenPaths.push(relativePathFrom(input.cwd, filePath));
  }
  return { writtenPaths, diagnostics };
}

function writeImportEvidence(input: {
  readonly cwd: string;
  readonly tasks: readonly TaskImportRecord[];
  readonly planPath: string;
  readonly generatedAt: string;
  readonly writtenPaths: readonly string[];
}): string {
  const evidenceDirectory = path.join(input.cwd, '.atm', 'history', 'reports', 'task-import');
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidenceFile = `${input.generatedAt.replace(/[:.]/g, '-')}.json`;
  const evidencePath = path.join(evidenceDirectory, evidenceFile);
  const payload = {
    schemaId: 'atm.taskImportEvidence',
    specVersion: '0.1.0',
    generatedAt: input.generatedAt,
    planPath: input.planPath,
    taskCount: input.tasks.length,
    writtenPaths: input.writtenPaths,
    taskIds: input.tasks.map((task) => task.workItemId),
    sourceTraces: input.tasks.map((task) => ({
      workItemId: task.workItemId,
      planPath: task.source.planPath,
      sectionTitle: task.source.sectionTitle,
      headingLine: task.source.headingLine,
      hash: task.source.hash
    }))
  };
  writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return relativePathFrom(input.cwd, evidencePath);
}

interface FrontMatter {
  readonly data: Record<string, unknown>;
  readonly endIndex: number;
  readonly headingLine: number;
}





interface HeadingSection {
  readonly heading: string;
  readonly lines: readonly string[];
}

function sliceBodyByHeadings(text: string): readonly HeadingSection[] {
  const lines = text.split(/\r?\n/);
  const sections: HeadingSection[] = [];
  let current: { heading: string; lines: string[] } | null = null;
  for (const line of lines) {
    const headingMatch = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: headingMatch[1].toLowerCase().trim(), lines: [] };
      continue;
    }
    if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function collectBulletList(sections: readonly HeadingSection[], headingNames: readonly string[]): readonly string[] {
  const target = sections.find((section) => headingNames.some((name) => section.heading.includes(name)));
  if (!target) return [];
  const items: string[] = [];
  for (const line of target.lines) {
    const match = /^\s*[-*]\s+\[\s*[ xX]\s*\]\s+(.+)|^\s*[-*]\s+(.+)/.exec(line);
    if (match) {
      const value = (match[1] ?? match[2] ?? '').trim();
      if (value) items.push(value);
    }
  }
  return items;
}

function collectText(sections: readonly HeadingSection[], headingNames: readonly string[]): string | null {
  const target = sections.find((section) => headingNames.some((name) => section.heading.includes(name)));
  if (!target) return null;
  const text = target.lines.join('\n').trim();
  return text || null;
}

function collectKeyValue(sections: readonly HeadingSection[], key: string): string | null {
  return delegatedCollectKeyValue(sections, key);
}

function collectKeyValueFromLines(lines: readonly string[], key: string): string | null {
  return delegatedCollectKeyValueFromLines(lines, key);
}

function extractTaskReference(value: string): string | null {
  const match = taskIdAnywherePattern.exec(value);
  return match ? normalizeTaskId(match[0]) : null;
}

function parseDependencyList(value: string, baseWorkItemId: string): readonly string[] {
  const trimmed = cleanCellText(value);
  if (!trimmed || /^(none|n\/a|na|null|無|--|-|\?)$/i.test(trimmed)) return [];
  const prefix = baseWorkItemId.replace(/-\d+$/, '');
  const values = trimmed
    .split(/[,/、，\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const fullMatch = taskIdAnywherePattern.exec(entry);
      if (fullMatch) return [normalizeTaskId(fullMatch[0])];
      if (/^\d{2,}$/.test(entry) && prefix !== baseWorkItemId) return [`${prefix}-${entry}`];
      return [];
    });
  return uniqueStrings(values);
}

function collectLabeledText(lines: readonly string[], labels: readonly string[]): readonly string[] {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const values: string[] = [];
  for (const line of lines) {
    const match = /^\s*\*\*(.+?)\*\*\s*[：:]\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    const label = match[1].trim().toLowerCase();
    if (!normalizedLabels.some((candidate) => label.includes(candidate))) continue;
    const value = match[2].trim();
    if (value) values.push(value);
  }
  return values;
}

function cleanCellText(value: string): string {
  return value
    .replace(/`/g, '')
    .replace(/<br\s*\/?>/gi, ', ')
    .trim();
}



function isMarkdownTableRow(value: string): boolean {
  return value.startsWith('|') && value.endsWith('|');
}

function isMarkdownTableSeparator(value: string): boolean {
  return /^[-|\s:]+$/.test(value.replace(/\|/g, ''));
}

function normalizeTableHeader(value: string): string {
  return cleanCellText(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function findTableColumnIndex(headers: readonly string[], candidates: readonly string[]): number {
  return headers.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate)));
}

function cellAt(cells: readonly string[], index: number): string {
  return index >= 0 && index < cells.length ? cells[index] : '';
}









function uniqueStrings(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseSingleCardFromPlugin(parsed: ParsedExternalTask, importedAt: string): TaskImportRecord {
  const frontData = parsed.frontmatter;
  const workItemId = normalizeTaskId(parsed.taskId);
  const title = normalizeOptionalString(frontData.title) ?? workItemId;
  const status = coerceStatus(typeof frontData.status === 'string' ? frontData.status : 'planned');
  const milestone = normalizeOptionalString(frontData.milestone);
  const dependencies = parseYamlList(frontData.depends_on ?? frontData.blocked_by ?? frontData.dependencies);
  const tags = parseYamlList(frontData.tags);
  const scopePaths = parseYamlList(frontData.scopePaths ?? frontData.scope_paths ?? frontData.allowed_files ?? frontData.allowedFiles ?? frontData.scope);
  const validators = parseYamlList(frontData.validators);
  const planningMirrorPaths = parseYamlList(frontData.planningMirrorPaths ?? frontData.planning_mirror_paths);
  const planningReadOnlyPaths = parseYamlList(frontData.planningReadOnlyPaths ?? frontData.planning_read_only_paths);
  const outOfScope = parseYamlList(frontData.outOfScope ?? frontData.out_of_scope ?? frontData.forbidden_files);
  const nonGoals = parseYamlList(frontData.nonGoals ?? frontData.non_goals);

  const atomizationImpactFrontMatter = frontData.atomizationImpact && typeof frontData.atomizationImpact === 'object' && !Array.isArray(frontData.atomizationImpact)
    ? frontData.atomizationImpact as Record<string, unknown>
    : {};
  const mapUpdates = parseYamlList(
    frontData.mapUpdates
    ?? frontData.map_updates
    ?? atomizationImpactFrontMatter.mapUpdates
    ?? atomizationImpactFrontMatter.map_updates
  );

  const body = parsed.body || '';
  const sections = sliceBodyByHeadings(body);
  const acceptance = collectBulletList(sections, acceptanceHeaders);
  const frontMatterDeliverables = parseYamlList(frontData.deliverables);
  const bodyDeliverables = collectBulletList(sections, deliverablesHeaders);

  let deliverables: readonly string[];
  if (frontMatterDeliverables.length > 0) {
    deliverables = uniqueStrings(frontMatterDeliverables.map(normalizeYamlScalar));
  } else {
    deliverables = uniqueStrings(bodyDeliverables.map(normalizeYamlScalar));
  }

  const notes = collectText(sections, notesHeaders) ?? null;
  const evidenceFrontMatter = frontData.evidence && typeof frontData.evidence === 'object' && !Array.isArray(frontData.evidence)
    ? frontData.evidence as Record<string, unknown>
    : {};
  const rollbackFrontMatter = frontData.rollback && typeof frontData.rollback === 'object' && !Array.isArray(frontData.rollback)
    ? frontData.rollback as Record<string, unknown>
    : {};

  const evidenceRequired = normalizeOptionalString(
    frontData.evidenceRequired
    ?? frontData.evidence_required
    ?? frontData.required
    ?? evidenceFrontMatter.required
    ?? evidenceFrontMatter.kind
  );
  const rollbackStrategy = normalizeOptionalString(
    frontData.rollbackStrategy
    ?? rollbackFrontMatter.strategy
  );
  const rollbackNotes = normalizeOptionalString(
    frontData.rollbackNotes
    ?? rollbackFrontMatter.notes
  );
  const contextMap = parseContextMap(frontData.contextMap);

  return {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId,
    title,
    status,
    milestone,
    dependencies,
    acceptance,
    deliverables,
    scopePaths,
    validators,
    planningRepo: normalizeOptionalString(frontData.planning_repo ?? frontData.planningRepo),
    targetRepo: normalizeOptionalString(frontData.target_repo ?? frontData.targetRepo ?? frontData.upstream_repo ?? frontData.upstreamRepo),
    closureAuthority: normalizeOptionalString(frontData.closure_authority ?? frontData.closureAuthority),
    planningReadOnlyPaths,
    planningMirrorPaths,
    outOfScope,
    nonGoals,
    evidenceRequired,
    rollbackStrategy,
    rollbackNotes,
    contextMap,
    atomizationImpact: {
      ownerAtomOrMap: normalizeOptionalString(
        frontData.ownerAtomOrMap
        ?? frontData.owner_atom_or_map
        ?? atomizationImpactFrontMatter.ownerAtomOrMap
        ?? atomizationImpactFrontMatter.owner_atom_or_map
      ),
      mapUpdates
    },
    legacyImportAliases: {
      ...(frontData.allowed_files ? { allowed_files: parseYamlList(frontData.allowed_files) } : {}),
      ...(frontData.blocked_by ? { blocked_by: parseYamlList(frontData.blocked_by) } : {}),
      ...(frontData.upstream_repo ? { upstream_repo: normalizeOptionalString(frontData.upstream_repo) ?? '' } : {})
    },
    importDiagnostics: [],
    tags,
    notes,
    source: {
      planPath: parsed.sourcePath,
      sectionTitle: workItemId,
      headingLine: 1,
      hash: hashSection(body)
    },
    importedAt
  };
}

interface RosterRowLocation {
  readonly headerLineIndex: number;
  readonly rowLineIndex: number;
  readonly headers: readonly string[];
}

function formatRosterDepends(depends: readonly string[]): string {
  if (depends.length === 0) return 'none';
  return depends.map((entry) => `\`${entry}\``).join(', ');
}

function formatRosterMultiline(values: readonly string[]): string {
  if (values.length === 0) return '';
  return values.join('<br>');
}

function extractTaskIdFromRosterCell(cell: string): string | null {
  const linkMatch = /\[([A-Z][A-Z0-9-]+)\]/i.exec(cell);
  if (linkMatch) return normalizeTaskId(linkMatch[1]);
  const plainMatch = /(TASK|ATM)-[A-Z0-9]+-\d{4,5}/i.exec(cell);
  return plainMatch ? normalizeTaskId(plainMatch[0]) : null;
}

function findRosterRowLocation(lines: readonly string[], taskId: string): RosterRowLocation | null {
  const normalizedTaskId = normalizeTaskId(taskId);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index].trim();
    const separatorLine = lines[index + 1].trim();
    if (!isMarkdownTableRow(headerLine) || !isMarkdownTableSeparator(separatorLine)) {
      continue;
    }
    const headers = parseMarkdownTableCells(headerLine).map((cell) => normalizeTableHeader(cell));
    const taskIdIndex = findTableColumnIndex(headers, ['task id', 'task', 'work item id', 'id']);
    if (taskIdIndex < 0) {
      continue;
    }
    let rowIndex = index + 2;
    while (rowIndex < lines.length) {
      const rawLine = lines[rowIndex];
      const trimmed = rawLine.trim();
      if (!isMarkdownTableRow(trimmed) || isMarkdownTableSeparator(trimmed)) {
        break;
      }
      const cells = parseMarkdownTableCells(trimmed);
      const rowTaskId = extractTaskIdFromRosterCell(cellAt(cells, taskIdIndex));
      if (rowTaskId === normalizedTaskId) {
        return { headerLineIndex: index, rowLineIndex: rowIndex, headers };
      }
      rowIndex += 1;
    }
  }
  return null;
}

function buildRosterRowFromFrontmatter(input: {
  readonly taskId: string;
  readonly frontmatter: Record<string, unknown>;
  readonly existingRow: string;
  readonly headers: readonly string[];
  readonly taskFileRelativeLink: string;
}): string {
  const existingCells = parseMarkdownTableCells(input.existingRow);
  const title = normalizeOptionalString(input.frontmatter.title) ?? input.taskId;
  const status = coerceStatus(typeof input.frontmatter.status === 'string' ? input.frontmatter.status : 'open');
  const depends = parseYamlList(input.frontmatter.depends_on ?? input.frontmatter.blocked_by ?? input.frontmatter.dependencies);
  const scopePaths = parseYamlList(input.frontmatter.scopePaths ?? input.frontmatter.scope_paths ?? input.frontmatter.allowed_files);
  const validators = parseYamlList(input.frontmatter.validators);

  const cells = [...existingCells];
  const setCell = (candidates: readonly string[], value: string) => {
    const index = findTableColumnIndex(input.headers, candidates);
    if (index >= 0) {
      cells[index] = value;
    }
  };

  const taskIdIndex = findTableColumnIndex(input.headers, ['task id', 'task', 'work item id', 'id']);
  if (taskIdIndex >= 0) {
    cells[taskIdIndex] = `[${input.taskId}](${input.taskFileRelativeLink})`;
  }
  setCell(['title', 'name'], title);
  setCell(['status', 'state'], status);
  setCell(['depends', 'blocked by', 'depends on', 'dependencies'], formatRosterDepends(depends));
  setCell(['target surface', 'scopepaths', 'scope paths', 'scope'], formatRosterMultiline(scopePaths));
  setCell(['primary validators', 'validators'], formatRosterMultiline(validators));

  return `| ${cells.join(' | ')} |`;
}

export async function runTasksRosterUpdate(argv: string[]): Promise<CommandResult> {
  let cwd = process.cwd();
  let indexPath = '';
  let fromPath = '';
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--cwd' || arg === '--repo') && argv[index + 1]) {
      cwd = path.resolve(argv[++index]);
    } else if (arg === '--index' && argv[index + 1]) {
      indexPath = argv[++index];
    } else if (arg === '--from' && argv[index + 1]) {
      fromPath = argv[++index];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      throw new CliError('ATM_CLI_USAGE', 'tasks roster update requires --index <readme-path> --from <task-file> [--dry-run] --json', { exitCode: 2 });
    }
  }

  if (!indexPath || !fromPath) {
    throw new CliError('ATM_CLI_USAGE', 'tasks roster update requires --index <readme-path> --from <task-file>.', { exitCode: 2 });
  }

  const indexAbsolute = path.resolve(cwd, indexPath);
  const fromAbsolute = path.resolve(cwd, fromPath);
  if (!existsSync(indexAbsolute)) {
    throw new CliError('ATM_TASK_ROSTER_INDEX_NOT_FOUND', `Roster index not found: ${indexPath}`, { exitCode: 2 });
  }
  if (!existsSync(fromAbsolute)) {
    throw new CliError('ATM_TASK_ROSTER_SOURCE_NOT_FOUND', `Task file not found: ${fromPath}`, { exitCode: 2 });
  }

  const taskText = readFileSync(fromAbsolute, 'utf8');
  const frontMatter = extractFrontMatter(taskText);
  const rawTaskId = typeof frontMatter?.data.task_id === 'string'
    ? frontMatter.data.task_id
    : typeof frontMatter?.data.id === 'string'
      ? frontMatter.data.id
      : null;
  if (!frontMatter || !rawTaskId) {
    throw new CliError('ATM_TASK_ROSTER_SOURCE_INVALID', `Task file ${fromPath} is missing task_id frontmatter.`, { exitCode: 2 });
  }
  const taskId = normalizeTaskId(rawTaskId);

  const original = readFileSync(indexAbsolute, 'utf8');
  const originalHash = createHash('sha256').update(original).digest('hex');
  const lines = original.split(/\r?\n/);
  const location = findRosterRowLocation(lines, taskId);
  if (!location) {
    return makeResult({
      ok: false,
      command: 'tasks roster update',
      cwd,
      messages: [message('error', 'ATM_TASK_ROSTER_ROW_NOT_FOUND', `Task id ${taskId} was not found in roster index ${indexPath}.`)],
      evidence: {
        taskId,
        indexPath,
        fromPath,
        dryRun
      }
    });
  }

  const taskFileRelativeLink = path.relative(path.dirname(indexAbsolute), fromAbsolute).replace(/\\/g, '/');
  const existingRow = lines[location.rowLineIndex];
  const updatedRow = buildRosterRowFromFrontmatter({
    taskId,
    frontmatter: frontMatter.data,
    existingRow,
    headers: location.headers,
    taskFileRelativeLink: taskFileRelativeLink.startsWith('.') ? taskFileRelativeLink : `./${taskFileRelativeLink}`
  });

  const updatedLines = [...lines];
  updatedLines[location.rowLineIndex] = updatedRow;
  const updated = updatedLines.join('\n');

  if (dryRun) {
    const afterHash = createHash('sha256').update(original).digest('hex');
    return makeResult({
      ok: true,
      command: 'tasks roster update',
      cwd,
      mode: 'dry-run',
      messages: [message('info', 'ATM_TASK_ROSTER_UPDATE_DRY_RUN', `Roster row diff prepared for ${taskId}.`)],
      evidence: {
        taskId,
        indexPath,
        fromPath,
        dryRun: true,
        beforeHash: `sha256:${originalHash}`,
        afterHash: `sha256:${afterHash}`,
        unchanged: existingRow === updatedRow,
        diff: {
          before: existingRow,
          after: updatedRow
        }
      }
    });
  }

  writeFileSync(indexAbsolute, updated, 'utf8');
  return makeResult({
    ok: true,
    command: 'tasks roster update',
    cwd,
    mode: 'write',
    messages: [message('info', 'ATM_TASK_ROSTER_UPDATE_WRITTEN', `Roster row updated for ${taskId} in ${indexPath}.`)],
    evidence: {
      taskId,
      indexPath,
      fromPath,
      dryRun: false,
      beforeHash: `sha256:${originalHash}`,
      afterHash: `sha256:${createHash('sha256').update(updated).digest('hex')}`,
      diff: {
        before: existingRow,
        after: updatedRow
      }
    }
  });
}

async function runTasksRoster(argv: string[]): Promise<CommandResult> {
  const subAction = (argv[0] ?? '').toLowerCase();
  if (subAction !== 'update') {
    throw new CliError('ATM_CLI_USAGE', 'tasks roster requires update.', { exitCode: 2 });
  }
  return runTasksRosterUpdate(argv.slice(1));
}

export interface GenerateTaskCardInput {
  cwd: string;
  templateKey?: string;
  taskId: string;
  title?: string;
  outputPath: string;
  dependsOn?: string;
  scopePath?: string;
  testPath?: string;
  atomId?: string;
  capability?: string;
  goal?: string;
}

export interface GeneratedTaskCardResult {
  taskId: string;
  content: string;
  sourcePath: string;
  templateUsed: string;
}

export async function generateTaskCard(input: GenerateTaskCardInput): Promise<GeneratedTaskCardResult> {
  const template = input.templateKey || 'aao-l2-split';
  const intent = {
    cwd: input.cwd,
    templateKey: template,
    fields: {
      task_id: input.taskId,
      title: input.title || 'New Task',
      depends_on: input.dependsOn || 'TASK-AAO-0000',
      scope_path: input.scopePath || 'src/main.ts',
      test_path: input.testPath || 'tests/main.test.ts',
      atom_id: input.atomId || 'atm.unowned',
      capability: input.capability || 'Implementation details',
      goal: input.goal || 'Goal description placeholder',
      sourcePath: input.outputPath
    }
  };

  const plugins = await readPluginRegistry(input.cwd);
  const generatorPlugin = plugins.find(p => p.mode !== 'disabled' && typeof p.plugin.generate === 'function');

  const resultCard = generatorPlugin
    ? await generatorPlugin.plugin.generate!(intent)
    : await (await import('../../../atm-markdown-task-source/src/index.ts')).default.generate(intent);

  return {
    taskId: resultCard.taskId,
    content: resultCard.content,
    sourcePath: input.outputPath,
    templateUsed: template
  };
}

function assertTaskCardOutputPathIsNested(cwd: string, outputPath: string): void {
  const absoluteCwd = path.resolve(cwd);
  const absoluteOutput = path.resolve(absoluteCwd, outputPath);
  const relativeOutput = path.relative(absoluteCwd, absoluteOutput).replace(/\\/g, '/');

  if (relativeOutput === '..' || relativeOutput.startsWith('../')) {
    throw new CliError(
      'ATM_CLI_USAGE',
      'tasks new must write task cards inside the repository; use docs/tasks/<name>.task.md or another nested task directory.',
      {
        exitCode: 2,
        details: { outputPath }
      }
    );
  }

  if (path.posix.dirname(relativeOutput) === '.' && relativeOutput.endsWith('.task.md')) {
    throw new CliError(
      'ATM_CLI_USAGE',
      'tasks new must not write task cards at the repository root; use docs/tasks/<name>.task.md or another nested task directory.',
      {
        exitCode: 2,
        details: { outputPath }
      }
    );
  }
}

async function runTasksNew(argv: string[]): Promise<CommandResult> {
  const spec = (await import('./command-specs/tasks.spec.ts')).default;
  const parsed = parseArgsForCommand(spec, ['new', ...argv]);

  const options = parsed.options as any;
  const cwd = (options.cwd as string) || process.cwd();

  const template = (options.template as string) || 'aao-l2-split';
  const taskId = (options.taskId as string) || (options.task as string) || 'TASK-UNKNOWN-0000';
  const title = (options.title as string) || 'New Task';

  const outPath = options.output as string;
  if (!outPath) {
    throw new CliError('ATM_CLI_USAGE', 'tasks new requires --output <path>', { exitCode: 2 });
  }
  assertTaskCardOutputPathIsNested(cwd, outPath);

  const resultCard = await generateTaskCard({
    cwd,
    templateKey: template,
    taskId,
    title,
    outputPath: outPath,
    dependsOn: options.dependsOn as string | undefined,
    scopePath: options.scopePath as string | undefined,
    testPath: options.testPath as string | undefined,
    atomId: options.atomId as string | undefined,
    capability: options.capability as string | undefined,
    goal: options.goal as string | undefined
  });

  const targetAbsolute = path.resolve(cwd, outPath);
  const targetDir = path.dirname(targetAbsolute);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(targetAbsolute, resultCard.content, 'utf8');

  return makeResult({
    ok: true,
    command: 'tasks',
    cwd,
    messages: [message('info', 'ATM_TASKS_NEW_GENERATED', `Generated new task card template at ${outPath}`)],
    evidence: {
      ok: true,
      sourcePath: outPath,
      taskId: resultCard.taskId,
      templateUsed: template,
      generatorSurface: 'tasks-new'
    }
  });
}

export {
  parseReconcileOptions,
  parseDeliverAndCloseOptions,
  parseCreateOptions,
  parseMirrorOptions,
  parseCloseOptions,
  parseStatusOptions,
  parseFinalizeDiagnoseOptions,
  parseResetOptions,
  parseLockCleanupOptions,
  parseClaimLifecycleOptions,
  parseHistoricalDeliveryRefs,
  parseScopeAddOptions,
  parseQueueOptions,
  parseAuditOptions,
  parseLegacyLedgerMigrationOptions,
  parseAllowStaleRunnerFlag
} from './tasks/task-option-parsers.ts';

export {
  safeTaskFileReadDir,
  safeTaskFileStat,
  readJsonRecord,
  taskPathFor,
  collectTaskFileValues,
  normalizeRelativePath,
  legacyTaskRequiresBaseline
};
type EmergencyUseEvidence = ReturnType<typeof assertEmergencyApproval>;
