import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createLocalGovernanceAdapter } from '../../../../../plugin-governance-local/dist/index.js';
import { resolveActorId } from '../../actor-registry.js';
import { auditTasks, assertRunnerFreshForWriteAction, isRunnerSyncRequired, runnerStaleWarningMessage } from '../../framework-development.js';
import { CliError, makeResult, message, parseOptions, parseArgsForCommand, relativePathFrom, resolveValue } from '../../shared.js';
import { toStoredPlanningPath, resolvePlanAbsoluteFromStored } from '../../planning-repo-root.js';
import { appendTaskTransitionEvent, createTaskTransitionId, defaultMirrorTaskId, readTaskLedgerPolicy } from '../../task-ledger.js';
import { readPluginRegistry } from '../../../plugin-registry.js';
import { abandonTaskQueue, findActiveTaskQueue, sanitizeTaskDirectionAllowedFiles } from '../../task-direction.js';
import { isPathAllowedByScope } from '../../work-channels.js';
import { evaluateTaskResetAdmission } from '../lifecycle-state.js';
import { buildResidueDiagnosisEvidenceFromTriangulation } from '../residue-diagnostics.js';
import { runTasksClose } from '../close-orchestrator.js';
import { runTasksImport } from '../import-orchestrator.js';
import { runTasksVerify } from '../verify-orchestrator.js';
import { runTasksClaimLifecycle as delegatedRunTasksClaimLifecycle } from '../claim-orchestrator.js';
import { runTasksRepairClaim } from '../repair-claim-orchestrator.js';
import { prepareTaskForClaim as delegatedPrepareTaskForClaim } from '../claim-preparation.js';
import { runTasksRepairClosure } from '../repairclose-orchestrator.js';
import { runTasksReconcile } from '../reconcile-orchestrator.js';
import { runTasksDeliverAndClose as delegatedRunTasksDeliverAndClose } from '../deliver-close-orchestrator.js';
export { runTasksClose, runTasksImport, runTasksVerify };
export { runTasksClaimLifecycle } from '../claim-orchestrator.js';
import { classifyResetOpenImport } from '../import-verify.js';
import { assertEmergencyApproval } from '../../emergency/gate.js';
import { parseClaimRecord, isClaimExpired, listRuntimeLockTaskIds } from '../task-ledger-readers.js';
import { isFrontmatterScalar as delegatedIsFrontmatterScalar } from '../is-frontmatter-scalar-helper.js';
import { normalizeStringValue as delegatedNormalizeStringValue } from '../normalize-string-value-helper.js';
import { normalizeTaskDocumentId as delegatedNormalizeTaskDocumentId } from '../normalize-task-document-id-helper.js';
import { sha256 as delegatedSha256 } from '../sha256-helper.js';
import { assertLocalTaskLedgerEnabled as delegatedAssertLocalTaskLedgerEnabled, buildTaskTransitionCommand as delegatedBuildTaskTransitionCommand, buildScopeAmendmentCommand as delegatedBuildScopeAmendmentCommand, createClosureTransitionMetadata as delegatedCreateClosureTransitionMetadata, normalizeWorkItemStatus as delegatedNormalizeWorkItemStatus, inspectTaskVerifyStatus as delegatedInspectTaskVerifyStatus } from '../task-transition-helpers.js';
import { readGitScalar as delegatedReadGitScalar, listCommittedFilesSinceClaim as delegatedListCommittedFilesSinceClaim } from '../task-git-helpers.js';
import { readDeferredForeignStagedFilesForActiveCloseWindow as delegatedReadDeferredForeignStagedFilesForActiveCloseWindow, evaluateFrameworkDeliveryWindow as delegatedEvaluateFrameworkDeliveryWindow, loadHistoricalBatchCloseSlice as delegatedLoadHistoricalBatchCloseSlice } from '../close-helpers/close-window-diagnostics.js';
import { buildBrokerAdmissionExplanation as delegatedBuildBrokerAdmissionExplanation, explainBrokerAdapterForPath as delegatedExplainBrokerAdapterForPath, hasUnexplainedSharedProjection as delegatedHasUnexplainedSharedProjection } from '../close-helpers/broker-admission-explanation.js';
import { extractTaskCloseDeclaredFiles as delegatedExtractTaskCloseDeclaredFiles, extractTaskDeliverableFiles as delegatedExtractTaskDeliverableFiles, taskDeliveryPrincipleText as delegatedTaskDeliveryPrincipleText, evaluateTaskDeliverableGate as delegatedEvaluateTaskDeliverableGate, stageTaskCloseArtifacts as delegatedStageTaskCloseArtifacts, existingTaskCloseArtifacts as delegatedExistingTaskCloseArtifacts } from '../close-helpers/close-artifact-staging.js';
import { writeTaskDocumentWithTransition as delegatedWriteTaskDocumentWithTransition } from '../close-helpers/task-transition-writer.js';
import { collectKeyValue as delegatedCollectKeyValue, collectKeyValueFromLines as delegatedCollectKeyValueFromLines, createTaskFromTableMetadata as delegatedCreateTaskFromTableMetadata, parseDispatchMetadataFromPlanText } from '../task-markdown-helpers.js';
import { safeTaskFileReadDir, safeTaskFileStat, readJsonRecord, taskPathFor, collectTaskFileValues, normalizeRelativePath, legacyTaskRequiresBaseline } from '../task-file-io-helpers.js';
import { coerceStatus, extractFrontMatter, hashSection, normalizeOptionalString, normalizeYamlScalar, normalizeTaskId, parseMarkdownTableCells, parseYamlList, validateDeliverablesList, parseContextMap } from '../task-import-validators.js';
import { parseCreateOptions, parseMirrorOptions, parseStatusOptions, parseFinalizeDiagnoseOptions, parseResetOptions, parseLockCleanupOptions, parseMetadataRepairDeliverablesOptions, parseScopeAddOptions, parseScopeRepairOptions, parseQueueOptions, parseAuditOptions, parseLegacyLedgerMigrationOptions, parseAllowStaleRunnerFlag } from '../task-option-parsers.js';
import { buildTaskStatusTriangulation as buildTaskStatusTriangulationDelegated, readScopeAmendmentEvents as readScopeAmendmentEventsDelegated, readLastTransitionEventRecord as readLastTransitionEventRecordDelegated, resolvePlanningCardPath as resolvePlanningCardPathDelegated } from '../status-triangulation.js';
import { recordStaleRunnerOverride as recordStaleRunnerOverrideDelegated, recordFailedEmergencyUseAttempt as recordFailedEmergencyUseAttemptDelegated, isCliErrorWithCode as isCliErrorWithCodeDelegated } from '../close-governance.js';
import { runTasksCompatCommandMap } from '../legacy/compat-command-map.js';
import { runTasksRealignPlanSource } from '../realign-plan-source.js';
import { createRepairReconcileLane } from '../legacy/repair-reconcile-lane.js';
import { createTransitionCompatLane } from '../legacy/transition-compat.js';
export const validStatuses = new Set(['planned', 'open', 'in_progress', 'reserved', 'ready', 'running', 'review', 'blocked', 'abandoned', 'done']);
const acceptanceHeaders = ['acceptance criteria', 'acceptance', 'acceptance tests', 'criteria', '驗收', '驗收條件'];
const deliverablesHeaders = ['deliverables', 'outputs', 'outcomes', '交付物', '產物', '輸出'];
const dependenciesHeaders = ['dependencies', 'depends on', 'blocked by', '依賴', '相依', '前置'];
const notesHeaders = ['notes', 'implementation notes', 'background', '備註', '說明'];
const tagsHeaders = ['tags', 'labels', '標籤'];
const taskIdPattern = /^(?:TASK-)?[A-Z][A-Z0-9-]*-\d{2,}/;
const taskIdAnywherePattern = /(?:TASK-)?[A-Z][A-Z0-9-]*-\d{2,}/;
function isCanonicalDeliverableCandidate(value) { const normalized = normalizeRelativePath(value); if (!normalized)
    return false; if (normalized.startsWith('.atm/'))
    return false; if (/[\\/]$/.test(normalized))
    return false; return true; }
function inferLegacyDeliverablesFromScope(scopePaths) { if (scopePaths.length === 0)
    return []; const normalized = uniqueStrings(scopePaths.map(normalizeRelativePath).filter(Boolean)); if (normalized.length === 0)
    return []; const inferred = normalized.filter(isCanonicalDeliverableCandidate); return inferred; }
export async function runTasks(argv) { const repairReconcileLane = createRepairReconcileLane({ reconcile: runTasksReconcile, repairClosure: runTasksRepairClosure, repairClaim: runTasksRepairClaim }); const transitionCompatLane = createTransitionCompatLane({ claimLifecycle: runTasksClaimLifecycle, deliverAndClose: runTasksDeliverAndClose }); return runTasksCompatCommandMap(argv, { close: runTasksClose, reset: runTasksReset, create: runTasksCreate, mirror: runTasksMirror, audit: runTasksAudit, queue: runTasksQueue, parallel: runTasksParallel, lock: runTasksLock, migrateLegacyLedger: runTasksMigrateLegacyLedger, claimLifecycle: transitionCompatLane.claimLifecycle, reconcile: repairReconcileLane.reconcile, repairClosure: repairReconcileLane.repairClosure, repairClaim: repairReconcileLane.repairClaim, show: runTasksShow, status: runTasksStatus, finalize: runTasksFinalize, deliverAndClose: transitionCompatLane.deliverAndClose, roster: runTasksRoster, newTask: runTasksNew, importTask: runTasksImport, verify: runTasksVerify, scope: runTasksScope, realignPlanSource: runTasksRealignPlanSource }); }
async function runTasksShow(argv) { const { options } = parseOptions(argv, 'tasks'); const taskId = options.task; if (!taskId) {
    throw new CliError('ATM_CLI_USAGE', 'tasks show requires --task <id>', { exitCode: 2 });
} const taskPath = taskPathFor(options.cwd, taskId); if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${taskId}.`, { exitCode: 2, details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId } });
} const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')); const messages = [message('info', 'ATM_TASK_SHOW_SUCCESS', `Task details for ${taskId}`)]; if (isRunnerSyncRequired(options.cwd)) {
    messages.push(message('warn', 'ATM_RUNNER_SYNC_REQUIRED', runnerStaleWarningMessage()));
} return makeResult({ ok: true, command: 'tasks show', cwd: options.cwd, messages, evidence: { taskId, ...taskDocument } }); }
const resolvePlanningCardPath = resolvePlanningCardPathDelegated;
const readLastTransitionEventRecord = readLastTransitionEventRecordDelegated;
const readScopeAmendmentEvents = readScopeAmendmentEventsDelegated;
const buildTaskStatusTriangulation = buildTaskStatusTriangulationDelegated;
export const recordStaleRunnerOverride = recordStaleRunnerOverrideDelegated;
export const isCliErrorWithCode = isCliErrorWithCodeDelegated;
export const recordFailedEmergencyUseAttempt = recordFailedEmergencyUseAttemptDelegated;
export function loadTaskDocumentOrThrow(cwd, taskId) { const taskPath = taskPathFor(cwd, taskId); if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${taskId}.`, { exitCode: 2, details: { taskPath: relativePathFrom(cwd, taskPath), taskId } });
} return { taskPath, taskDocument: JSON.parse(readFileSync(taskPath, 'utf8')) }; }
export function buildResidueDiagnosisEvidence(cwd, taskId, taskDocument) { const triangulation = buildTaskStatusTriangulation(cwd, taskId, taskDocument); return buildResidueDiagnosisEvidenceFromTriangulation({ taskId, triangulation }); }
async function runTasksStatus(argv) { const options = parseStatusOptions(argv); const { taskDocument } = loadTaskDocumentOrThrow(options.cwd, options.taskId); const triangulation = buildTaskStatusTriangulation(options.cwd, options.taskId, taskDocument); const messages = [message(options.residueOnly ? 'info' : 'info', options.residueOnly ? 'ATM_TASK_RESIDUE_DIAGNOSED' : 'ATM_TASK_STATUS_TRIANGULATED', options.residueOnly ? `Residue diagnosis for ${options.taskId}: ${triangulation.residueClassification.bucket}.` : `Task status triangulation for ${options.taskId}.`, triangulation)]; if (isRunnerSyncRequired(options.cwd)) {
    messages.push(message('warn', 'ATM_RUNNER_SYNC_REQUIRED', runnerStaleWarningMessage()));
} return makeResult({ ok: true, command: 'tasks status', cwd: options.cwd, messages, evidence: options.residueOnly ? buildResidueDiagnosisEvidence(options.cwd, options.taskId, taskDocument) : { taskId: options.taskId, ...triangulation } }); }
async function runTasksFinalize(argv) { const subAction = (argv[0] ?? '').toLowerCase(); if (subAction !== 'diagnose') {
    throw new CliError('ATM_CLI_USAGE', 'tasks finalize requires diagnose.', { exitCode: 2 });
} return runTasksFinalizeDiagnose(argv.slice(1)); }
async function runTasksFinalizeDiagnose(argv) { const options = parseFinalizeDiagnoseOptions(argv); const { taskDocument } = loadTaskDocumentOrThrow(options.cwd, options.taskId); const evidence = buildResidueDiagnosisEvidence(options.cwd, options.taskId, taskDocument); const messages = [message(evidence.bucket === 'ambiguous-manual-review' ? 'warn' : 'info', 'ATM_TASK_FINALIZE_DIAGNOSED', `Residue bucket ${evidence.bucket} for ${options.taskId}.`, { truth: evidence.truth, residue: evidence.residue, nextCommand: evidence.nextCommand })]; if (isRunnerSyncRequired(options.cwd)) {
    messages.push(message('warn', 'ATM_RUNNER_SYNC_REQUIRED', runnerStaleWarningMessage()));
} return makeResult({ ok: true, command: 'tasks finalize diagnose', cwd: options.cwd, messages, evidence }); }
async function runTasksDeliverAndClose(argv) { return delegatedRunTasksDeliverAndClose(argv, { runTasks }); }
async function runTasksCreate(argv) { const options = parseCreateOptions(argv); assertRunnerFreshForWriteAction({ cwd: options.cwd, action: 'tasks-create', allowStaleRunner: false }); assertLocalTaskLedgerEnabled(options.cwd, 'create'); const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd); if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks create requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
} const actorId = resolvedActor.actorId; const taskPath = taskPathFor(options.cwd, options.taskId); if (existsSync(taskPath) && !options.force) {
    throw new CliError('ATM_TASK_EXISTS', `Task ${options.taskId} already exists.`, { exitCode: 1, details: { taskId: options.taskId, taskPath: relativePathFrom(options.cwd, taskPath) } });
} const createdAt = new Date().toISOString(); const taskDocument = { schemaVersion: 'atm.workItem.v0.2', workItemId: options.taskId, title: options.title ?? options.taskId, status: 'planned', owner: actorId, dependencies: [], acceptance: [], deliverables: [], tags: [], createdAt, createdByActor: actorId }; const transitionPath = writeTaskDocumentWithTransition({ cwd: options.cwd, taskPath, taskId: options.taskId, taskDocument, action: 'create', actorId, previousStatus: null }); return makeResult({ ok: true, command: 'tasks', cwd: options.cwd, messages: [message('info', 'ATM_TASKS_CREATED', `Task ${options.taskId} created.`, { taskId: options.taskId, actorId, status: taskDocument.status })], evidence: { action: 'create', taskId: options.taskId, actorId, status: taskDocument.status, taskPath: relativePathFrom(options.cwd, taskPath), transitionPath } }); }
async function runTasksMirror(argv) { const options = parseMirrorOptions(argv); assertRunnerFreshForWriteAction({ cwd: options.cwd, action: 'tasks-mirror', allowStaleRunner: false }); assertLocalTaskLedgerEnabled(options.cwd, 'mirror'); const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd); if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks mirror requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
} const actorId = resolvedActor.actorId; const taskId = options.taskId ?? defaultMirrorTaskId(options.provider, options.originTaskId); const taskPath = taskPathFor(options.cwd, taskId); const existing = existsSync(taskPath) ? JSON.parse(readFileSync(taskPath, 'utf8')) : null; const previousStatus = existing ? normalizeWorkItemStatus(existing.status) : null; const mirroredAt = typeof existing?.mirroredAt === 'string' ? existing.mirroredAt : new Date().toISOString(); const taskDocument = { ...(existing ?? {}), schemaVersion: 'atm.workItem.v0.2', workItemId: taskId, title: options.title ?? String(existing?.title ?? `${options.provider} ${options.originTaskId}`), status: options.status, owner: actorId, originProvider: options.provider, originTaskId: options.originTaskId, originUrl: options.originUrl, syncStatus: options.syncStatus, taskLedgerMode: 'external-provider', mirroredAt, mirrorUpdatedAt: new Date().toISOString() }; const transitionPath = writeTaskDocumentWithTransition({ cwd: options.cwd, taskPath, taskId, taskDocument, action: 'mirror', actorId, previousStatus }); return makeResult({ ok: true, command: 'tasks', cwd: options.cwd, messages: [message('info', 'ATM_TASKS_MIRRORED', `External task ${options.provider}:${options.originTaskId} mirrored as ${taskId}.`, { taskId, provider: options.provider, originTaskId: options.originTaskId })], evidence: { action: 'mirror', taskId, actorId, taskPath: relativePathFrom(options.cwd, taskPath), originProvider: options.provider, originTaskId: options.originTaskId, transitionPath } }); }
export function prepareTaskForClaim(input) { return delegatedPrepareTaskForClaim({ ...input, parseSingleCard, writeTaskFiles, writeImportEvidence }); }
export { verifyCloseoutProvenance } from '../closeout-provenance.js';
export { findTaskClaimDependencyBlockers } from '../dependency-gates.js';
async function runTasksReset(argv) { const options = parseResetOptions(argv); const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd); if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks reset requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
} const actorId = resolvedActor.actorId; assertEmergencyApproval({ cwd: options.cwd, surface: 'tasks reset', permission: 'backend.tasks.reset', taskId: options.taskId, actorId, emergencyApproval: options.emergencyApproval, flags: [], reason: options.reason ?? 'Direct lifecycle reset backend mutation.', command: `node atm.mjs tasks reset --task ${options.taskId} --actor ${actorId} --to ${options.to} --json` }); const taskPath = taskPathFor(options.cwd, options.taskId); if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, { exitCode: 2, details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId } });
} const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')); const previousStatus = normalizeTaskStatus(taskDocument.status); const resetAdmission = evaluateTaskResetAdmission({ taskId: options.taskId, fromStatus: previousStatus, toStatus: options.to }); if (!resetAdmission.ok) {
    throw new CliError(resetAdmission.code, resetAdmission.message, { exitCode: resetAdmission.code === 'ATM_CLI_USAGE' ? 2 : 1, details: resetAdmission.details });
} const currentClaim = parseClaimRecord(taskDocument.claim); if (currentClaim && currentClaim.state === 'active' && currentClaim.actorId !== actorId) {
    throw new CliError('ATM_TASK_CLAIM_OWNER_MISMATCH', `Task ${options.taskId} is claimed by ${currentClaim.actorId}, not ${actorId}.`, { exitCode: 1, details: { taskId: options.taskId, currentActor: currentClaim.actorId, actorId } });
} if (currentClaim && currentClaim.actorId === actorId) {
    const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
    await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, actorId));
    taskDocument.claim = { ...currentClaim, heartbeatAt: new Date().toISOString(), state: 'released', reason: options.reason ?? 'reset' };
} taskDocument.status = 'open'; taskDocument.owner = actorId; if (options.reason)
    taskDocument.resetReason = options.reason; delete taskDocument.closedAt; delete taskDocument.closedByActor; delete taskDocument.closurePacket; const transitionPath = writeTaskDocumentWithTransition({ cwd: options.cwd, taskPath, taskId: options.taskId, taskDocument, action: 'reset', actorId, previousStatus }); return makeResult({ ok: true, command: 'tasks', cwd: options.cwd, messages: [message('info', 'ATM_TASKS_RESET', `Task ${options.taskId} reset to open.`, { taskId: options.taskId, actorId, previousStatus, status: 'open' })], evidence: { action: 'reset', taskId: options.taskId, actorId, previousStatus, status: 'open', transitionPath } }); }
export function readDeferredForeignStagedFilesForActiveCloseWindow(cwd, taskId) { return delegatedReadDeferredForeignStagedFilesForActiveCloseWindow(cwd, taskId); }
function runTasksAudit(argv) { const options = parseAuditOptions(argv); const report = auditTasks(options.cwd); const activeFindings = report.findings.filter((finding) => !finding.acknowledged); const activeWarnings = activeFindings.filter((finding) => finding.level === 'warning'); const errorFindings = report.findings.filter((finding) => finding.level === 'error'); return makeResult({ ok: report.ok, command: 'tasks', cwd: options.cwd, messages: [!report.ok ? message('error', 'ATM_TASKS_AUDIT_FAILED', 'Task audit found invalid task closure evidence.', { findingCount: report.findings.length, errorCount: errorFindings.length, activeFindingCount: activeFindings.length, acknowledgedFindingCount: report.acknowledgedFindingCount ?? 0 }) : activeWarnings.length > 0 ? message('warn', 'ATM_TASKS_AUDIT_WARNINGS', `Task audit passed with ${activeWarnings.length} active warning(s); ${report.acknowledgedFindingCount ?? 0} baseline warning(s) were acknowledged.`, { inspectedTaskCount: report.inspectedTaskCount, inspectedEvidenceCount: report.inspectedEvidenceCount, warningCount: activeWarnings.length, acknowledgedWarningCount: report.acknowledgedFindingCount ?? 0, warningCodes: Array.from(new Set(activeWarnings.map((finding) => finding.code))), activeFindings: activeWarnings, findings: report.findings }) : message('info', 'ATM_TASKS_AUDIT_OK', 'Task audit passed.', { inspectedTaskCount: report.inspectedTaskCount, inspectedEvidenceCount: report.inspectedEvidenceCount, acknowledgedWarningCount: report.acknowledgedFindingCount ?? 0 })], evidence: { action: 'audit', staged: options.staged, report } }); }
async function runTasksLock(argv) { const action = (argv[0] ?? '').toLowerCase(); if (action !== 'cleanup') {
    throw new CliError('ATM_CLI_USAGE', 'tasks lock supports only: cleanup', { exitCode: 2 });
} return await runTasksLockCleanup(argv.slice(1)); }
async function runTasksScope(argv) { const subAction = (argv[0] ?? '').toLowerCase(); if (subAction === 'add') {
    return runTasksScopeAdd(argv.slice(1));
} if (subAction === 'repair') {
    return runTasksScopeRepair(argv.slice(1));
} if (subAction === 'repair-deliverables') {
    return runTasksMetadataRepairDeliverables(argv.slice(1));
} if (subAction === 'remove') {
    return runTasksScopeRemove(argv.slice(1));
} if (!subAction) {
    throw new CliError('ATM_CLI_USAGE', 'tasks scope requires a sub-action: add | remove | repair | repair-deliverables', { exitCode: 2 });
} throw new CliError('ATM_CLI_USAGE', `tasks scope does not support sub-action ${subAction}. Supported: add, remove, repair, repair-deliverables`, { exitCode: 2 }); }
function buildMetadataRepairNoClaimMessage(precondition) { return [`tasks scope repair-deliverables requires an active claim held by ${precondition.actorId}.`, `Current claimState=${precondition.claimState}; claimActorId=${precondition.claimActorId ?? '<none>'}; leaseState=${precondition.leaseState}.`, `Claim the task first, then rerun: node atm.mjs tasks scope repair-deliverables --task ${precondition.taskId} --actor ${precondition.actorId} --set <paths> --reason "<why the card metadata changed>" --json`].join('\n'); }
async function runTasksMetadataRepairDeliverables(argv) { const options = parseMetadataRepairDeliverablesOptions(argv); assertRunnerFreshForWriteAction({ cwd: options.cwd, action: 'tasks-scope-repair-deliverables', allowStaleRunner: false }); const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd); if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks metadata repair-deliverables requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
} const actorId = resolvedActor.actorId; const precondition = inspectScopeAmendmentPreconditions(options.cwd, options.taskId, actorId); if (precondition.claimState !== 'active' || precondition.claimActorId !== actorId || precondition.leaseState !== 'active') {
    throw new CliError('ATM_TASK_METADATA_REPAIR_ACTIVE_CLAIM_REQUIRED', buildMetadataRepairNoClaimMessage(precondition), { exitCode: 1, details: precondition });
} const rawDeliverables = options.setPaths.map((entry) => entry.trim()).filter(Boolean); const rawDeliverableViolations = validateDeliverablesList(rawDeliverables, true); const candidateDeliverables = sanitizeTaskDirectionAllowedFiles(rawDeliverables); if (rawDeliverableViolations.length > 0 || candidateDeliverables.length !== rawDeliverables.length) {
    const droppedEntries = rawDeliverables.filter((entry) => !candidateDeliverables.includes(normalizeRelativePath(entry)));
    const violations = rawDeliverableViolations.length > 0 ? rawDeliverableViolations : droppedEntries.map((entry) => ({ entry, reason: 'not-path-shaped', severity: 'error' }));
    throw new CliError('ATM_TASK_METADATA_REPAIR_DELIVERABLE_PATH_INVALID', `tasks scope repair-deliverables rejected non-path deliverables for ${options.taskId}: ${violations.map((entry) => entry.entry).join(', ')}`, { exitCode: 1, details: { taskId: options.taskId, violations } });
} const taskPath = taskPathFor(options.cwd, options.taskId); const taskDocument = readJsonRecord(taskPath); const previousDeliverables = sanitizeTaskDirectionAllowedFiles(Array.isArray(taskDocument.deliverables) ? taskDocument.deliverables : []); taskDocument.deliverables = [...candidateDeliverables]; const lockPath = path.join(options.cwd, '.atm', 'runtime', 'locks', `${options.taskId}.lock.json`); let allowedFiles = []; if (existsSync(lockPath)) {
    const outerLock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const embeddedLock = outerLock.taskDirectionLock;
    if (embeddedLock && typeof embeddedLock === 'object' && !Array.isArray(embeddedLock)) {
        const embeddedLockRecord = embeddedLock;
        const existingAllowed = sanitizeTaskDirectionAllowedFiles(Array.isArray(embeddedLockRecord.allowedFiles) ? embeddedLockRecord.allowedFiles : []);
        const mergedAllowed = sanitizeTaskDirectionAllowedFiles([...existingAllowed, ...candidateDeliverables]);
        syncScopeAmendmentRuntimeLock({ outerLock, embeddedLockRecord, mergedAllowed });
        writeFileSync(lockPath, `${JSON.stringify(outerLock, null, 2)}\n`, 'utf8');
        allowedFiles = mergedAllowed;
    }
} const createdAt = new Date().toISOString(); const transitionSeedDocument = { ...taskDocument, lastTransitionId: 'pending-metadata-repair', lastTransitionAt: createdAt }; const transitionId = createTaskTransitionId({ createdAt, taskId: options.taskId, action: 'metadata-repair', taskDocument: transitionSeedDocument }); taskDocument.lastTransitionId = transitionId; taskDocument.lastTransitionAt = createdAt; taskDocument.ledgerContractVersion = 'task-ledger/v1'; appendTaskTransitionEvent({ cwd: options.cwd, taskId: options.taskId, action: 'metadata-repair', actorId, fromStatus: String(taskDocument.status ?? 'running'), toStatus: String(taskDocument.status ?? 'running'), taskPath, taskDocument, command: `node atm.mjs tasks scope repair-deliverables --task ${options.taskId} --actor ${actorId} --set ${candidateDeliverables.join(',')} --reason "${options.reason}" --json`, createdAt, transitionId, amendmentMetadata: { amendmentClass: 'task-metadata', amendmentPhase: 'during-implementation', amendmentMode: 'normal', reason: options.reason } }); writeTaskDocument(taskPath, taskDocument); return makeResult({ ok: true, command: 'tasks metadata repair-deliverables', cwd: options.cwd, messages: [message('info', 'ATM_TASK_METADATA_REPAIR_DELIVERABLES_APPLIED', `Deliverable metadata repaired for ${options.taskId}: ${candidateDeliverables.length} path(s).`, { taskId: options.taskId, actorId, previousDeliverables, deliverables: candidateDeliverables, allowedFiles, transitionId })], evidence: { action: 'metadata-repair', metadataField: 'deliverables', taskId: options.taskId, actorId, previousDeliverables, deliverables: candidateDeliverables, allowedFiles, transitionId } }); }
function inspectScopeAmendmentPreconditions(cwd, taskId, actorId) { const taskPath = taskPathFor(cwd, taskId); const taskDocument = existsSync(taskPath) ? readJsonRecord(taskPath) : {}; const claim = parseClaimRecord(taskDocument.claim); const nowIso = new Date().toISOString(); const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`); let lockState = 'missing'; if (existsSync(lockPath)) {
    try {
        const outerLock = JSON.parse(readFileSync(lockPath, 'utf8'));
        lockState = outerLock.released === true || outerLock.status === 'released' ? 'released' : 'active';
    }
    catch {
        lockState = 'unreadable';
    }
} return { taskId, actorId, lockState, claimState: claim?.state ?? 'none', leaseState: claim?.leaseId ? (isClaimExpired(claim, nowIso) ? 'expired' : 'active') : 'none', claimActorId: claim?.actorId ?? null, leaseId: claim?.leaseId ?? null, resolvedBy: 'none', claimCommand: `node atm.mjs next --claim --task ${taskId} --actor ${actorId} --auto-intent --json`, claimFirstScopeAddCommand: `node atm.mjs tasks scope add --task ${taskId} --actor ${actorId} --claim-first --add <paths> --json` }; }
function buildScopeAmendmentNoClaimMessage(input) { return [`Scope amendment for ${input.taskId} requires an active claim, not a bare lock or renewed lease.`, `Current state: lock=${input.lockState}, claim=${input.claimState}, lease=${input.leaseState}.`, 'Run one of:', ` - ${input.claimFirstScopeAddCommand} (recommended when claim and scope expansion are blocking each other)`, ` - ${input.claimCommand} (claim first when no scope expansion is needed)`, ` - node atm.mjs tasks renew --task ${input.taskId} --actor ${input.actorId} --json (if lease only)`, 'Then retry the scope amendment.'].join('\n'); }
async function resolveScopeAmendmentClaimFirst(input) { const precondition = inspectScopeAmendmentPreconditions(input.cwd, input.taskId, input.actorId); if (precondition.claimState === 'active' && precondition.claimActorId === input.actorId) {
    return precondition;
} const taskDocument = readJsonRecord(taskPathFor(input.cwd, input.taskId)); prepareTaskForClaim({ cwd: input.cwd, taskId: input.taskId, actorId: input.actorId, status: taskDocument.status, title: typeof taskDocument.title === 'string' ? taskDocument.title : input.taskId, transitionCommand: `node atm.mjs next --claim --task ${input.taskId} --actor ${input.actorId} --auto-intent --json` }); const files = extractTaskCloseDeclaredFiles(taskDocument, input.cwd, input.taskId); await runTasksClaimLifecycle('claim', ['--cwd', input.cwd, '--task', input.taskId, '--actor', input.actorId, '--auto-intent', '--files', files.join(','), '--json']); return { ...inspectScopeAmendmentPreconditions(input.cwd, input.taskId, input.actorId), resolvedBy: 'claim-first' }; }
async function runTasksScopeAdd(argv) { const options = parseScopeAddOptions(argv); assertRunnerFreshForWriteAction({ cwd: options.cwd, action: 'tasks-scope-add', allowStaleRunner: false }); const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd); if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks scope add requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
} const actorId = resolvedActor.actorId; let preconditionResolution = inspectScopeAmendmentPreconditions(options.cwd, options.taskId, actorId); if (options.claimFirst) {
    preconditionResolution = await resolveScopeAmendmentClaimFirst({ cwd: options.cwd, taskId: options.taskId, actorId });
} const lockPath = path.join(options.cwd, '.atm', 'runtime', 'locks', `${options.taskId}.lock.json`); if (!existsSync(lockPath)) {
    throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', buildScopeAmendmentNoClaimMessage(preconditionResolution), { exitCode: 1, details: { ...preconditionResolution, taskId: options.taskId, requiredCommand: preconditionResolution.claimFirstScopeAddCommand, claimCommand: preconditionResolution.claimCommand } });
} let outerLock; try {
    outerLock = JSON.parse(readFileSync(lockPath, 'utf8'));
}
catch {
    throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `Could not read direction lock for task ${options.taskId}.`, { exitCode: 1, details: { ...preconditionResolution, taskId: options.taskId, requiredCommand: preconditionResolution.claimFirstScopeAddCommand, claimCommand: preconditionResolution.claimCommand } });
} if (outerLock.released === true || outerLock.status === 'released') {
    throw new CliError('ATM_SCOPE_AMENDMENT_LOCK_RELEASED', `Task ${options.taskId} direction lock is released; use tasks scope add --claim-first when claim and scope expansion are blocking each other.`, { exitCode: 1, details: { ...preconditionResolution, taskId: options.taskId, requiredCommand: preconditionResolution.claimFirstScopeAddCommand, claimCommand: preconditionResolution.claimCommand } });
} const embeddedLock = outerLock.taskDirectionLock; if (!embeddedLock || typeof embeddedLock !== 'object' || Array.isArray(embeddedLock)) {
    throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `Lock file for ${options.taskId} does not contain an embedded taskDirectionLock.`, { exitCode: 1, details: { ...preconditionResolution, taskId: options.taskId, requiredCommand: preconditionResolution.claimFirstScopeAddCommand, claimCommand: preconditionResolution.claimCommand } });
} const embeddedLockRecord = embeddedLock; const existingAllowed = sanitizeTaskDirectionAllowedFiles(Array.isArray(embeddedLockRecord.allowedFiles) ? embeddedLockRecord.allowedFiles : []); const requestedPaths = sanitizeTaskDirectionAllowedFiles(options.addPaths); const addedPaths = requestedPaths.filter((p) => !existingAllowed.includes(p)); const alreadyPresent = requestedPaths.filter((p) => existingAllowed.includes(p)); const mergedAllowed = sanitizeTaskDirectionAllowedFiles([...existingAllowed, ...requestedPaths]); const taskPath = taskPathFor(options.cwd, options.taskId); const amendmentMetadata = { amendmentClass: options.amendmentClass ?? 'linked-surface', amendmentPhase: options.amendmentPhase ?? 'during-implementation', amendmentMode: 'normal', ...(options.reason ? { reason: options.reason } : {}) }; if (existsSync(taskPath)) {
    const taskDocument = readJsonRecord(taskPath);
    syncScopeAmendmentState({ taskDocument, outerLock, embeddedLockRecord, mergedAllowed });
    writeFileSync(lockPath, `${JSON.stringify(outerLock, null, 2)}\n`, 'utf8');
    if (preconditionResolution.resolvedBy === 'claim-first') {
        appendTaskTransitionEvent({ cwd: options.cwd, taskId: options.taskId, action: 'scope-amendment.claim-first-resolved', actorId, fromStatus: String(taskDocument.status ?? 'running'), toStatus: String(taskDocument.status ?? 'running'), taskPath, taskDocument, command: preconditionResolution.claimCommand });
    }
    const commandLine = buildScopeAmendmentCommand({ mode: 'normal', taskId: options.taskId, actorId, addPaths: options.addPaths, amendmentClass: options.amendmentClass, amendmentPhase: options.amendmentPhase, reason: options.reason });
    persistScopeAmendmentTransition({ cwd: options.cwd, taskId: options.taskId, actorId, taskPath, taskDocument, command: commandLine, amendmentMetadata });
}
else {
    syncScopeAmendmentRuntimeLock({ outerLock, embeddedLockRecord, mergedAllowed });
    writeFileSync(lockPath, `${JSON.stringify(outerLock, null, 2)}\n`, 'utf8');
} return makeResult({ ok: true, command: 'tasks', cwd: options.cwd, messages: [message('info', 'ATM_SCOPE_AMENDMENT_APPLIED', addedPaths.length > 0 ? `Scope amendment applied for ${options.taskId}: ${addedPaths.length} path(s) added to allowedFiles.` : `Scope amendment for ${options.taskId}: all requested paths were already in allowedFiles.`, { taskId: options.taskId, actorId, addedPaths, alreadyPresent, allowedFiles: mergedAllowed, preconditionResolution, amendmentMetadata, requiredCommand: `node atm.mjs tasks scope add --task ${options.taskId} --actor ${actorId} --add <paths> --json` })], evidence: { action: 'scope-amendment', amendmentMode: 'normal', taskId: options.taskId, actorId, addedPaths, alreadyPresent, allowedFiles: mergedAllowed, preconditionResolution, amendmentMetadata } }); }
async function runTasksScopeRemove(argv) { const options = parseScopeAddOptions(argv.map((value) => value === '--remove' ? '--add' : value)); const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd); if (!resolvedActor)
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks scope remove requires --actor or ATM_ACTOR_ID.', { exitCode: 2 }); const actorId = resolvedActor.actorId; const precondition = inspectScopeAmendmentPreconditions(options.cwd, options.taskId, actorId); if (precondition.claimState !== 'active' || precondition.claimActorId !== actorId) {
    throw new CliError('ATM_SCOPE_SHRINK_ACTIVE_CLAIM_REQUIRED', buildScopeAmendmentNoClaimMessage(precondition), { exitCode: 1, details: precondition });
} const taskPath = taskPathFor(options.cwd, options.taskId); const taskDocument = readJsonRecord(taskPath); const requested = sanitizeTaskDirectionAllowedFiles(options.addPaths); const deliverables = sanitizeTaskDirectionAllowedFiles(Array.isArray(taskDocument.deliverables) ? taskDocument.deliverables : []); const protectedPaths = requested.filter((file) => deliverables.includes(file)); if (protectedPaths.length > 0) {
    throw new CliError('ATM_SCOPE_SHRINK_DELIVERABLE_FORBIDDEN', `tasks scope remove cannot remove declared deliverables: ${protectedPaths.join(', ')}`, { exitCode: 1, details: { taskId: options.taskId, protectedPaths } });
} const lockPath = path.join(options.cwd, '.atm', 'runtime', 'locks', `${options.taskId}.lock.json`); if (!existsSync(lockPath))
    throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', buildScopeAmendmentNoClaimMessage(precondition), { exitCode: 1, details: precondition }); const outerLock = JSON.parse(readFileSync(lockPath, 'utf8')); const embeddedLockRecord = outerLock.taskDirectionLock; if (!embeddedLockRecord || Array.isArray(embeddedLockRecord))
    throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `Lock file for ${options.taskId} does not contain an embedded taskDirectionLock.`, { exitCode: 1 }); const existingAllowed = sanitizeTaskDirectionAllowedFiles(Array.isArray(embeddedLockRecord.allowedFiles) ? embeddedLockRecord.allowedFiles : []); const removedPaths = requested.filter((file) => existingAllowed.includes(file)); const mergedAllowed = existingAllowed.filter((file) => !removedPaths.includes(file)); syncScopeAmendmentState({ taskDocument, outerLock, embeddedLockRecord, mergedAllowed }); writeFileSync(lockPath, `${JSON.stringify(outerLock, null, 2)}\n`, 'utf8'); persistScopeAmendmentTransition({ cwd: options.cwd, taskId: options.taskId, actorId, taskPath, taskDocument, command: `node atm.mjs tasks scope remove --task ${options.taskId} --actor ${actorId} --remove ${requested.join(',')} --json`, amendmentMetadata: { amendmentClass: 'scope-shrink', amendmentPhase: 'during-implementation', amendmentMode: 'normal', reason: options.reason ?? 'Remove an incorrect non-deliverable shared scope path.' } }); return makeResult({ ok: true, command: 'tasks', cwd: options.cwd, messages: [message('info', 'ATM_SCOPE_SHRINK_APPLIED', `Scope shrink applied for ${options.taskId}: ${removedPaths.length} path(s) removed.`, { taskId: options.taskId, actorId, removedPaths, allowedFiles: mergedAllowed })], evidence: { action: 'scope-shrink', taskId: options.taskId, actorId, removedPaths, allowedFiles: mergedAllowed } }); }
function runTasksScopeRepair(argv) { const options = parseScopeRepairOptions(argv); const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd); if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks scope repair requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
} const actorId = resolvedActor.actorId; assertEmergencyApproval({ cwd: options.cwd, surface: 'tasks scope repair', permission: 'backend.tasks.scopeAmend', taskId: options.taskId, actorId, emergencyApproval: options.emergencyApproval, flags: ['--add', '--reason'], reason: options.reason, command: `node atm.mjs tasks scope repair --task ${options.taskId} --actor ${actorId} --add ${options.addPaths.join(',')} --reason "${options.reason}" --emergency-approval ${options.emergencyApproval} --json` }); const lockPath = path.join(options.cwd, '.atm', 'runtime', 'locks', `${options.taskId}.lock.json`); if (!existsSync(lockPath)) {
    throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `No active direction lock found for task ${options.taskId}. The task must be claimed before repairing its scope.`, { exitCode: 1, details: { taskId: options.taskId } });
} let outerLock; try {
    outerLock = JSON.parse(readFileSync(lockPath, 'utf8'));
}
catch {
    throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `Could not read direction lock for task ${options.taskId}.`, { exitCode: 1, details: { taskId: options.taskId } });
} if (outerLock.released === true || outerLock.status === 'released') {
    throw new CliError('ATM_SCOPE_AMENDMENT_LOCK_RELEASED', `Task ${options.taskId} direction lock is released; claim the task first.`, { exitCode: 1, details: { taskId: options.taskId } });
} const embeddedLock = outerLock.taskDirectionLock; if (!embeddedLock || typeof embeddedLock !== 'object' || Array.isArray(embeddedLock)) {
    throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `Lock file for ${options.taskId} does not contain an embedded taskDirectionLock.`, { exitCode: 1, details: { taskId: options.taskId } });
} const embeddedLockRecord = embeddedLock; const existingAllowed = sanitizeTaskDirectionAllowedFiles(Array.isArray(embeddedLockRecord.allowedFiles) ? embeddedLockRecord.allowedFiles : []); const requestedPaths = sanitizeTaskDirectionAllowedFiles(options.addPaths); const addedPaths = requestedPaths.filter((p) => !existingAllowed.includes(p)); const alreadyPresent = requestedPaths.filter((p) => existingAllowed.includes(p)); const mergedAllowed = sanitizeTaskDirectionAllowedFiles([...existingAllowed, ...requestedPaths]); const taskPath = taskPathFor(options.cwd, options.taskId); const amendmentMetadata = { amendmentClass: 'linked-surface', amendmentPhase: 'during-implementation', amendmentMode: 'repair', reason: options.reason }; if (existsSync(taskPath)) {
    const taskDocument = readJsonRecord(taskPath);
    syncScopeAmendmentState({ taskDocument, outerLock, embeddedLockRecord, mergedAllowed });
    writeFileSync(lockPath, `${JSON.stringify(outerLock, null, 2)}\n`, 'utf8');
    const commandLine = buildScopeAmendmentCommand({ mode: 'repair', taskId: options.taskId, actorId, addPaths: options.addPaths, reason: options.reason, emergencyApproval: options.emergencyApproval });
    persistScopeAmendmentTransition({ cwd: options.cwd, taskId: options.taskId, actorId, taskPath, taskDocument, command: commandLine, amendmentMetadata });
}
else {
    syncScopeAmendmentRuntimeLock({ outerLock, embeddedLockRecord, mergedAllowed });
    writeFileSync(lockPath, `${JSON.stringify(outerLock, null, 2)}\n`, 'utf8');
} return makeResult({ ok: true, command: 'tasks', cwd: options.cwd, messages: [message('info', 'ATM_SCOPE_REPAIR_APPLIED', addedPaths.length > 0 ? `Scope repair applied for ${options.taskId}: ${addedPaths.length} path(s) added to allowedFiles (maintenance lane).` : `Scope repair for ${options.taskId}: all requested paths were already in allowedFiles.`, { taskId: options.taskId, actorId, addedPaths, alreadyPresent, allowedFiles: mergedAllowed, amendmentMetadata, requiredCommand: `node atm.mjs tasks scope repair --task ${options.taskId} --actor ${actorId} --add <paths> --reason "<reason>" --emergency-approval <leaseId> --json` })], evidence: { action: 'scope-amendment', amendmentMode: 'repair', taskId: options.taskId, actorId, addedPaths, alreadyPresent, allowedFiles: mergedAllowed, amendmentMetadata } }); }
async function runTasksLockCleanup(argv) { const options = parseLockCleanupOptions(argv); const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd); if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks lock cleanup requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
} const actorId = resolvedActor.actorId; if (options.allStale) {
    assertEmergencyApproval({ cwd: options.cwd, surface: 'tasks lock cleanup --all-stale', permission: 'backend.tasks.lockCleanupGlobal', taskId: null, actorId, emergencyApproval: options.emergencyApproval, flags: ['--all-stale'], reason: options.reason ?? 'Global stale lock cleanup.', command: `node atm.mjs tasks lock cleanup --all-stale --actor ${actorId} --json` });
    const taskIds = listRuntimeLockTaskIds(options.cwd);
    const cleaned = [];
    const skipped = [];
    for (const taskId of taskIds) {
        try {
            cleaned.push(await cleanupTaskLock({ cwd: options.cwd, taskId, actorId, reason: options.reason }));
        }
        catch (error) {
            if (error.code === 'ATM_TASK_LOCK_CLEANUP_NOT_ALLOWED') {
                skipped.push({ taskId, reason: 'not-stale' });
                continue;
            }
            throw error;
        }
    }
    return makeResult({ ok: true, command: 'tasks', cwd: options.cwd, messages: [message('info', 'ATM_TASK_LOCK_CLEANUP_ALL_STALE_OK', `Cleaned ${cleaned.length} stale task lock(s).`, { cleanedCount: cleaned.length, skippedCount: skipped.length })], evidence: { action: 'lock-cleanup', allStale: true, actorId, cleaned, skipped } });
} const report = await cleanupTaskLock({ cwd: options.cwd, taskId: options.taskId, actorId, reason: options.reason }); return makeResult({ ok: true, command: 'tasks', cwd: options.cwd, messages: [message('info', 'ATM_TASK_LOCK_CLEANUP_OK', `Cleaned stale lock state for ${options.taskId}.`, { taskId: options.taskId, actorId, staleReasons: report.staleReasons, cleanupActions: report.cleanupActions })], evidence: report }); }
async function cleanupTaskLock(input) { const { cwd, taskId, actorId } = input; const nowIso = new Date().toISOString(); const taskPath = taskPathFor(cwd, taskId); let taskDocument = existsSync(taskPath) ? JSON.parse(readFileSync(taskPath, 'utf8')) : null; const currentStatus = normalizeTaskStatus(taskDocument?.status); const currentClaim = parseClaimRecord(taskDocument?.claim); const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`); const sidecarPath = path.join(cwd, '.atm', 'runtime', 'task-direction-locks', `${taskId}.json`); const governanceLock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null; const releasedLock = governanceLock?.released === true || governanceLock?.status === 'released'; const staleReasons = []; if (releasedLock)
    staleReasons.push('released-lock'); if (!taskDocument)
    staleReasons.push('missing-task'); if (currentStatus === 'done' || currentStatus === 'abandoned' || currentStatus === 'blocked') {
    staleReasons.push(`terminal-task:${currentStatus}`);
} if (currentClaim && isClaimExpired(currentClaim, nowIso))
    staleReasons.push('expired-claim'); if (!governanceLock && existsSync(sidecarPath))
    staleReasons.push('orphaned-sidecar'); if (governanceLock && !releasedLock && !currentClaim && existsSync(sidecarPath))
    staleReasons.push('lock-without-claim'); if (staleReasons.length === 0) {
    throw new CliError('ATM_TASK_LOCK_CLEANUP_NOT_ALLOWED', `Task ${taskId} does not have a stale cleanup candidate.`, { exitCode: 1, details: { taskId, lockPath: existsSync(lockPath) ? relativePathFrom(cwd, lockPath) : null, sidecarPath: existsSync(sidecarPath) ? relativePathFrom(cwd, sidecarPath) : null, status: currentStatus, claimState: currentClaim?.state ?? null } });
} const adapter = createLocalGovernanceAdapter({ repositoryRoot: cwd }); const cleanupActions = []; if (governanceLock && !releasedLock) {
    await resolveValue(adapter.stores.lockStore.releaseLock(taskId, actorId));
    cleanupActions.push('released-governance-lock');
} const lockRecordAfterRelease = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : governanceLock; if (lockRecordAfterRelease && releaseEmbeddedDirectionLock({ lockPath, lockRecord: lockRecordAfterRelease, actorId, nowIso })) {
    cleanupActions.push('released-embedded-direction-lock');
} let taskLedgerTransitionPath = null; if (taskDocument) {
    let taskLedgerMutated = false;
    if (currentClaim && currentClaim.state === 'active' && (currentStatus === 'done' || currentStatus === 'abandoned' || currentStatus === 'blocked')) {
        taskDocument.claim = { ...currentClaim, heartbeatAt: nowIso, state: 'released', reason: input.reason ?? 'lock-cleanup' };
        taskLedgerMutated = true;
        cleanupActions.push('released-terminal-active-claim');
    }
    if (applyCanonicalDirectionLockRelease({ taskDocument, actorId, nowIso })) {
        taskLedgerMutated = true;
        cleanupActions.push('released-canonical-direction-lock');
    }
    if (taskLedgerMutated) {
        const previousStatus = typeof taskDocument.status === 'string' ? taskDocument.status : null;
        taskLedgerTransitionPath = writeTaskDocumentWithTransition({ cwd, taskPath, taskId, taskDocument, action: 'lock-cleanup', actorId, previousStatus, command: `node atm.mjs tasks lock cleanup --task ${taskId} --actor ${actorId} --json` });
        cleanupActions.push(`transition:${relativePathFrom(cwd, taskLedgerTransitionPath)}`);
        try {
            execFileSync('git', ['add', '--', relativePathFrom(cwd, taskPath), taskLedgerTransitionPath], { cwd, stdio: 'ignore' });
        }
        catch { }
    }
} if (existsSync(sidecarPath)) {
    rmSync(sidecarPath, { force: true });
    cleanupActions.push('removed-direction-sidecar');
} let terminalBrokerCleanupResult = null; if (currentStatus === 'done' || currentStatus === 'abandoned' || currentStatus === 'blocked') {
    try {
        terminalBrokerCleanupResult = await cleanupTerminalBrokerIntents({ cwd, taskId, actorId });
        cleanupActions.push('released-terminal-broker-intents');
    }
    catch (error) {
        terminalBrokerCleanupResult = { ok: false, code: error?.code ?? null, message: error instanceof Error ? error.message : String(error) };
        cleanupActions.push('terminal-broker-intent-cleanup-failed');
    }
} const reportPath = writeLockCleanupReport({ cwd, taskId, actorId, staleReasons, cleanupActions, reason: input.reason }); return { action: 'lock-cleanup', taskId, actorId, staleReasons, cleanupActions, reportPath, transitionPath: taskLedgerTransitionPath, terminalBrokerCleanupResult }; }
async function cleanupTerminalBrokerIntents(input) { const { runBroker } = await import('../../broker/implementation.js'); return await runBroker(['release', '--cwd', input.cwd, '--task', input.taskId, '--actor', input.actorId]); }
function runTasksQueue(argv) { const action = (argv[0] ?? 'status').toLowerCase(); const options = parseQueueOptions(argv.slice(action === 'status' || action === 'abandon' ? 1 : 0)); if (action === 'status') {
    const activeQueue = findActiveTaskQueue(options.cwd);
    return makeResult({ ok: true, command: 'tasks', cwd: options.cwd, messages: [message('info', activeQueue ? 'ATM_TASK_QUEUE_ACTIVE' : 'ATM_TASK_QUEUE_EMPTY', activeQueue ? `Active task queue ${activeQueue.queueId} is at index ${activeQueue.currentIndex}.` : 'No active task queue is recorded.', { queueId: activeQueue?.queueId ?? null, queueHeadTaskId: activeQueue ? activeQueue.taskIds[activeQueue.currentIndex] ?? null : null })], evidence: { action: 'queue status', activeQueue } });
} if (action === 'abandon') {
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks queue abandon requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    if (!options.queueId) {
        throw new CliError('ATM_CLI_USAGE', 'tasks queue abandon requires --queue <queueId>.', { exitCode: 2 });
    }
    const queue = abandonTaskQueue({ cwd: options.cwd, queueId: options.queueId, actorId: resolvedActor.actorId, reason: options.reason });
    return makeResult({ ok: true, command: 'tasks', cwd: options.cwd, messages: [message('info', 'ATM_TASK_QUEUE_ABANDONED', `Task queue ${queue.queueId} was abandoned.`, { queueId: queue.queueId, actorId: resolvedActor.actorId })], evidence: { action: 'queue abandon', queue } });
} throw new CliError('ATM_CLI_USAGE', 'tasks queue supports only: status, abandon.', { exitCode: 2 }); }
function runTasksParallel(argv) { const parsed = parseTasksParallelArgs(argv); if (parsed.mode === 'pair') {
    const left = readParallelAdvisorTask(parsed.cwd, parsed.taskId);
    const right = readParallelAdvisorTask(parsed.cwd, parsed.withTaskId);
    const finding = analyzeParallelPair(left, right);
    return makeResult({ ok: true, command: 'tasks', cwd: parsed.cwd, messages: [message('info', 'ATM_TASKS_PARALLEL_ANALYZED', `Parallel advisor analyzed ${left.taskId} with ${right.taskId}.`, { verdict: finding.verdict, taskId: left.taskId, withTaskId: right.taskId })], evidence: { action: 'parallel pair', task: left, withTask: right, finding } });
} if (parsed.mode === 'queue-for-task') {
    const anchor = readParallelAdvisorTask(parsed.cwd, parsed.taskId);
    const candidates = listParallelAdvisorTasks(parsed.cwd).filter((task) => task.taskId !== anchor.taskId);
    const analyses = candidates.map((candidate) => ({ taskId: candidate.taskId, title: candidate.title, status: candidate.status, activeClaimActorId: candidate.activeClaimActorId, activeClaimIntent: candidate.activeClaimIntent, finding: analyzeParallelPair(anchor, candidate) }));
    return makeResult({ ok: true, command: 'tasks', cwd: parsed.cwd, messages: [message('info', 'ATM_TASKS_PARALLEL_QUEUE_ANALYZED', `Parallel advisor compared ${anchor.taskId} against ${analyses.length} queue candidate(s).`, { taskId: anchor.taskId, candidateCount: analyses.length })], evidence: { action: 'parallel queue', task: anchor, candidates: analyses } });
} const tasks = listParallelAdvisorTasks(parsed.cwd); const hotspot = buildParallelHotspotReport(tasks); return makeResult({ ok: true, command: 'tasks', cwd: parsed.cwd, messages: [message('info', 'ATM_TASKS_PARALLEL_REPORT_READY', `Parallel advisor generated a queue hotspot report for ${tasks.length} task(s).`, { taskCount: tasks.length })], evidence: { action: 'parallel queue report', taskCount: tasks.length, hotspot } }); }
function parseTasksParallelArgs(argv) { let cwd = process.cwd(); let taskId = null; let withTaskId = null; let queueFlag = false; let reportFlag = false; for (let index = 0; index < argv.length; index += 1) {
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
} if (taskId && withTaskId) {
    return { cwd, mode: 'pair', taskId: normalizeTaskId(taskId), withTaskId: normalizeTaskId(withTaskId) };
} if (taskId && queueFlag) {
    return { cwd, mode: 'queue-for-task', taskId: normalizeTaskId(taskId) };
} if (queueFlag && reportFlag) {
    return { cwd, mode: 'queue-report' };
} throw new CliError('ATM_CLI_USAGE', 'tasks parallel requires either --task <id> --with <id>, --task <id> --queue, or --queue --report.', { exitCode: 2, details: { invalidFlags: [], missingRequired: [], allowedFlags: ['--cwd', '--task', '--with', '--queue', '--report', '--json', '--pretty', '--output-json', '--summary', '--fields'] } }); }
function listParallelAdvisorTasks(cwd) { const taskLedger = readTaskLedgerPolicy(cwd); const taskRoot = path.join(cwd, taskLedger.taskRoot); const entries = readdirSync(taskRoot, { withFileTypes: true }); const tasks = []; for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json'))
        continue;
    const fullPath = path.join(taskRoot, entry.name);
    const doc = readJsonRecord(fullPath);
    const status = normalizeTaskStatus(doc.status);
    if (!['open', 'running', 'ready', 'in_progress', 'review', 'blocked', 'reserved'].includes(status))
        continue;
    tasks.push(taskDocumentToParallelAdvisorTask(cwd, doc));
} return tasks; }
function readParallelAdvisorTask(cwd, taskId) { const taskPath = taskPathFor(cwd, taskId); if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${taskId}.`, { exitCode: 2, details: { taskId, taskPath: relativePathFrom(cwd, taskPath) } });
} return taskDocumentToParallelAdvisorTask(cwd, readJsonRecord(taskPath)); }
function taskDocumentToParallelAdvisorTask(cwd, taskDocument) { const taskId = normalizeTaskDocumentId(taskDocument, 'TASK-UNKNOWN-0000'); const title = normalizeOptionalString(taskDocument.title) ?? taskId; const status = normalizeTaskStatus(taskDocument.status); const collectedFiles = collectParallelAdvisorTaskFiles(taskDocument); const allowedFiles = uniqueStrings(Array.from(collectedFiles).map((value) => normalizeParallelAdvisorPath(cwd, value)).filter((value) => Boolean(value))); const validators = uniqueStrings(parseYamlList(taskDocument.validators).map((entry) => entry.trim()).filter(Boolean)); const atomIds = uniqueStrings(allowedFiles.flatMap((entry) => findAtomIdsForPath(cwd, entry))); const claimRecord = taskDocument.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim) ? taskDocument.claim : null; const claimState = normalizeOptionalString(claimRecord?.state); const activeClaimActorId = claimState === 'active' ? normalizeOptionalString(claimRecord?.actorId) : null; const activeClaimIntent = claimState === 'active' ? (normalizeOptionalString(claimRecord?.intent) ?? 'write') : null; return { taskId, title, status, allowedFiles, validators, atomIds, activeClaimActorId, activeClaimIntent }; }
function collectParallelAdvisorTaskFiles(taskDocument) { const files = new Set(); const taskDirectionLock = taskDocument.taskDirectionLock; const claim = taskDocument.claim; const legacyImportAliases = taskDocument.legacyImportAliases; const targetWork = taskDocument.targetWork; collectTaskFileValues(taskDocument.scopePaths, files); collectTaskFileValues(taskDocument.deliverables, files); collectTaskFileValues(taskDocument.targetAllowedFiles, files); collectTaskFileValues(taskDocument.planningMirrorPaths, files); if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
    collectTaskFileValues(claim.files, files);
} if (taskDirectionLock && typeof taskDirectionLock === 'object' && !Array.isArray(taskDirectionLock)) {
    collectTaskFileValues(taskDirectionLock.allowedFiles, files);
} if (legacyImportAliases && typeof legacyImportAliases === 'object' && !Array.isArray(legacyImportAliases)) {
    collectTaskFileValues(legacyImportAliases.allowed_files, files);
} if (targetWork && typeof targetWork === 'object' && !Array.isArray(targetWork)) {
    collectTaskFileValues(targetWork.allowedFiles, files);
} return files; }
function normalizeParallelAdvisorPath(cwd, value) { const trimmed = value.trim(); if (!trimmed)
    return null; const normalized = trimmed.replace(/\\/g, '/'); if (/^[A-Za-z]:\//.test(normalized)) {
    return relativePathFrom(cwd, normalized).replace(/\\/g, '/');
} return normalized.replace(/^\.\/+/, ''); }
function loadPathToAtomMappings(cwd) { const mapPath = path.join(cwd, 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'); const payload = readJsonRecord(mapPath); return (payload.mappings ?? []).flatMap((entry) => { const pathPattern = normalizeOptionalString(entry.path_pattern); const atomId = normalizeOptionalString(entry.atom_id); const capability = normalizeOptionalString(entry.capability) ?? ''; if (!pathPattern || !atomId)
    return []; return [{ pathPattern, atomId, capability }]; }); }
function findAtomIdsForPath(cwd, relativePath) { const normalized = relativePath.replace(/\\/g, '/'); return loadPathToAtomMappings(cwd).filter((mapping) => globLikeMatch(normalized, mapping.pathPattern)).map((mapping) => mapping.atomId); }
function analyzeParallelPair(left, right) { const overlappingFiles = intersect(left.allowedFiles, right.allowedFiles); const overlappingAtomIds = intersect(left.atomIds, right.atomIds); const sharedValidators = intersect(left.validators, right.validators); const sharedGenerators = overlappingFiles.filter((entry) => /generator|build|manifest/i.test(entry)); const sharedProjections = overlappingFiles.filter((entry) => /projection|map|registry|index/i.test(entry)); const sharedArtifacts = overlappingFiles.filter((entry) => /artifact|report|jsonl/i.test(entry)); const activeLeaseConflicts = overlappingFiles.filter((entry) => /\.atm\/history\//i.test(entry)); const brokerAdmission = buildBrokerAdmissionExplanation({ overlappingFiles, overlappingAtomIds, sharedProjections }); let verdict = 'parallel-safe'; if (brokerAdmission.confirmedConflict) {
    verdict = 'blocked-cid-conflict';
}
else if (activeLeaseConflicts.length > 0) {
    verdict = 'blocked-active-lease';
}
else if (sharedGenerators.length > 0 || sharedArtifacts.length > 0 || hasUnexplainedSharedProjection(sharedProjections, brokerAdmission)) {
    verdict = 'blocked-shared-surface';
}
else if (overlappingAtomIds.length > 0 || brokerAdmission.mutationIntentStatus === 'missing') {
    verdict = 'insufficient-mutation-intent';
}
else if (overlappingFiles.length > 0) {
    verdict = 'needs-physical-split';
}
else if (left.allowedFiles.length === 0 || right.allowedFiles.length === 0) {
    verdict = 'insufficient-atom-map';
} return { verdict, overlappingFiles, overlappingAtomIds, sharedValidators, sharedGenerators, sharedProjections, sharedArtifacts, activeLeaseConflicts, brokerAdmission }; }
const buildBrokerAdmissionExplanation = delegatedBuildBrokerAdmissionExplanation;
const explainBrokerAdapterForPath = delegatedExplainBrokerAdapterForPath;
const hasUnexplainedSharedProjection = delegatedHasUnexplainedSharedProjection;
function buildParallelHotspotReport(tasks) { const fileCounts = new Map(); const atomCounts = new Map(); const validatorCounts = new Map(); for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
        const finding = analyzeParallelPair(tasks[leftIndex], tasks[rightIndex]);
        for (const file of finding.overlappingFiles)
            incrementMap(fileCounts, file);
        for (const atomId of finding.overlappingAtomIds)
            incrementMap(atomCounts, atomId);
        for (const validator of finding.sharedValidators)
            incrementMap(validatorCounts, validator);
    }
} return { topOverlappingFiles: sortMapEntries(fileCounts), topOverlappingAtomIds: sortMapEntries(atomCounts), topSharedValidators: sortMapEntries(validatorCounts) }; }
function intersect(left, right) { const rightSet = new Set(right); return left.filter((value) => rightSet.has(value)); }
function incrementMap(target, key) { target.set(key, (target.get(key) ?? 0) + 1); }
function sortMapEntries(target) { return Array.from(target.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([value, count]) => ({ value, count })); }
function globLikeMatch(value, pattern) { const normalizedPattern = pattern.replace(/\\/g, '/'); const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&'); const regexSource = `^${escaped.replace(/\*\*/g, '::DOUBLE_STAR::').replace(/\*/g, '[^/]*').replace(/::DOUBLE_STAR::/g, '.*')}$`; return new RegExp(regexSource).test(value); }
async function runTasksMigrateLegacyLedger(argv) { const options = parseLegacyLedgerMigrationOptions(argv); assertLocalTaskLedgerEnabled(options.cwd, 'migrate-legacy-ledger'); const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd); if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks migrate-legacy-ledger requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
} const actorId = resolvedActor.actorId; const taskLedger = readTaskLedgerPolicy(options.cwd); const tasks = readLegacyLedgerTaskFiles(options.cwd); const migratedTasks = []; const skippedTasks = []; for (const task of tasks) {
    if (!legacyTaskRequiresBaseline(options.cwd, task)) {
        skippedTasks.push({ taskId: task.taskId, taskPath: task.relativePath, taskFormat: task.format, reason: 'already-has-transition-evidence-or-not-required' });
        continue;
    }
    const migrationReason = normalizeStringValue(task.document.lastTransitionId ?? task.document.last_transition_id) ? 'missing-transition-event' : 'missing-transition-id';
    const reportEntry = { taskId: task.taskId, taskPath: task.relativePath, taskFormat: task.format, status: task.status, reason: migrationReason, transitionPath: null };
    if (options.apply) {
        const transitionPath = writeLegacyBaselineTransition({ cwd: options.cwd, task, actorId, reason: options.reason });
        migratedTasks.push({ ...reportEntry, transitionPath });
    }
    else {
        migratedTasks.push(reportEntry);
    }
} const report = { schemaId: 'atm.taskLegacyLedgerMigrationReport', specVersion: '0.1.0', generatedAt: new Date().toISOString(), mode: options.apply ? 'apply' : 'dry-run', taskRoot: taskLedger.taskRoot, eventRoot: taskLedger.eventRoot, inspectedTaskCount: tasks.length, migratableTaskCount: migratedTasks.length, migratedTaskCount: options.apply ? migratedTasks.length : 0, skippedTaskCount: skippedTasks.length, migratedTasks, skippedTasks }; return makeResult({ ok: true, command: 'tasks', cwd: options.cwd, messages: [message('info', 'ATM_TASKS_LEGACY_LEDGER_MIGRATION', options.apply ? `Backfilled baseline transition evidence for ${migratedTasks.length} legacy task(s).` : `Legacy ledger migration dry-run found ${migratedTasks.length} task(s) to backfill.`, { mode: report.mode, inspectedTaskCount: report.inspectedTaskCount, migratableTaskCount: report.migratableTaskCount, migratedTaskCount: report.migratedTaskCount })], evidence: { action: 'migrate-legacy-ledger', actorId, report } }); }
async function runTasksClaimLifecycle(action, argv) { return delegatedRunTasksClaimLifecycle(action, argv); }
export const evaluateFrameworkDeliveryWindow = delegatedEvaluateFrameworkDeliveryWindow;
export const evaluateTaskDeliverableGate = delegatedEvaluateTaskDeliverableGate;
export const taskDeliveryPrincipleText = delegatedTaskDeliveryPrincipleText;
export const loadHistoricalBatchCloseSlice = delegatedLoadHistoricalBatchCloseSlice;
export const extractTaskCloseDeclaredFiles = delegatedExtractTaskCloseDeclaredFiles;
function extractStringList(value) { return Array.isArray(value) ? value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean) : []; }
export const extractTaskDeliverableFiles = delegatedExtractTaskDeliverableFiles;
function normalizeTaskScopePaths(cwd, values) { return sanitizeTaskDirectionAllowedFiles(values.map((entry) => { const normalized = normalizeRelativePath(entry); if (!normalized)
    return ''; return path.isAbsolute(normalized) ? normalizeRelativePath(relativePathFrom(cwd, normalized)) : normalized; })); }
function listCommittedFilesSinceClaim(cwd, claim) { return delegatedListCommittedFilesSinceClaim(cwd, claim); }
function readGitScalar(cwd, args) { return delegatedReadGitScalar(cwd, args); }
function writeLockCleanupReport(input) { const directory = path.join(input.cwd, '.atm', 'history', 'reports', 'lock-cleanup'); mkdirSync(directory, { recursive: true }); const timestamp = new Date().toISOString(); const filePath = path.join(directory, `${timestamp.replace(/[:.]/g, '-')}-${input.taskId}.json`); writeFileSync(filePath, `${JSON.stringify({ schemaId: 'atm.lockCleanupReport.v1', generatedAt: timestamp, taskId: input.taskId, actorId: input.actorId, staleReasons: input.staleReasons, cleanupActions: input.cleanupActions, reason: input.reason }, null, 2)}\n`, 'utf8'); return relativePathFrom(input.cwd, filePath); }
function writeTaskDocument(taskPath, document) { mkdirSync(path.dirname(taskPath), { recursive: true }); writeFileSync(taskPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8'); }
function syncScopeAmendmentState(input) { syncScopeAmendmentRuntimeLock(input); input.taskDocument.taskDirectionLock = { ...input.embeddedLockRecord, allowedFiles: [...input.mergedAllowed] }; const claim = input.taskDocument.claim; if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
    const claimRecord = claim;
    claimRecord.files = [...input.mergedAllowed];
    input.taskDocument.claim = claimRecord;
} }
function syncScopeAmendmentRuntimeLock(input) { input.outerLock.taskDirectionLock = { ...input.embeddedLockRecord, allowedFiles: [...input.mergedAllowed] }; input.outerLock.files = [...input.mergedAllowed]; }
function persistScopeAmendmentTransition(input) { const createdAt = new Date().toISOString(); const transitionSeedDocument = { ...input.taskDocument, lastTransitionId: 'pending-scope-amendment', lastTransitionAt: createdAt }; const transitionId = createTaskTransitionId({ createdAt, taskId: input.taskId, action: 'scope-amendment', taskDocument: transitionSeedDocument }); input.taskDocument.lastTransitionId = transitionId; input.taskDocument.lastTransitionAt = createdAt; input.taskDocument.ledgerContractVersion = 'task-ledger/v1'; appendTaskTransitionEvent({ cwd: input.cwd, taskId: input.taskId, action: 'scope-amendment', actorId: input.actorId, fromStatus: String(input.taskDocument.status ?? 'running'), toStatus: String(input.taskDocument.status ?? 'running'), taskPath: input.taskPath, taskDocument: input.taskDocument, command: input.command, createdAt, transitionId, amendmentMetadata: input.amendmentMetadata }); writeTaskDocument(input.taskPath, input.taskDocument); }
function readLegacyLedgerTaskFiles(cwd) { const root = path.resolve(cwd); const taskLedger = readTaskLedgerPolicy(root); const jsonTasks = listTaskFiles(path.join(root, taskLedger.taskRoot), (filePath) => filePath.endsWith('.json')).map((absolutePath) => { const document = readJsonRecord(absolutePath); const taskId = normalizeTaskDocumentId(document, path.basename(absolutePath, '.json')); return { absolutePath, relativePath: relativePathFrom(root, absolutePath), taskId, status: normalizeTaskStatus(document.status), format: 'json', document }; }); const markdownTasks = listTaskFiles(root, (filePath) => filePath.endsWith('.task.md')).map((absolutePath) => { const rawText = readFileSync(absolutePath, 'utf8'); const document = parseTaskMarkdownFrontmatter(rawText); const taskId = normalizeTaskDocumentId(document, path.basename(absolutePath).replace(/\.task\.md$/, '')); return { absolutePath, relativePath: relativePathFrom(root, absolutePath), taskId, status: normalizeTaskStatus(document.status), format: 'markdown', document, rawText }; }); return [...jsonTasks, ...markdownTasks].sort((left, right) => left.relativePath.localeCompare(right.relativePath)); }
function writeLegacyBaselineTransition(input) { const createdAt = new Date().toISOString(); const updatedDocument = { ...input.task.document, ledgerContractVersion: 'task-ledger/v1', ledgerBaselineKind: 'legacy-transition-backfill', ledgerBaselineByActor: input.actorId, ledgerBaselineReason: input.reason, ledgerBaselineSourceSha256: sha256(input.task.rawText ?? `${JSON.stringify(input.task.document, null, 2)}\n`) }; const transitionId = createTaskTransitionId({ createdAt, taskId: input.task.taskId, action: 'migrate-legacy-ledger', taskDocument: updatedDocument }); updatedDocument.lastTransitionId = transitionId; updatedDocument.lastTransitionAt = createdAt; updatedDocument.ledgerBaselineAt = createdAt; if (input.task.format === 'json') {
    updatedDocument.legacyLedgerBaseline = { schemaId: 'atm.legacyTaskLedgerBaseline.v1', migratedAt: createdAt, migratedByActor: input.actorId, previousStatus: input.task.status || null, reason: input.reason, sourceTaskSha256: updatedDocument.ledgerBaselineSourceSha256, transitionId };
} const transition = appendTaskTransitionEvent({ cwd: input.cwd, taskId: input.task.taskId, action: 'migrate-legacy-ledger', actorId: input.actorId, fromStatus: input.task.status || null, toStatus: input.task.status || null, taskPath: input.task.absolutePath, taskDocument: updatedDocument, command: 'node atm.mjs tasks migrate-legacy-ledger', createdAt, transitionId }); if (input.task.format === 'json') {
    writeTaskDocument(input.task.absolutePath, updatedDocument);
}
else {
    writeTaskMarkdownFrontmatter(input.task.absolutePath, input.task.rawText ?? '', updatedDocument);
} return transition.eventPath; }
function listTaskFiles(directoryPath, predicate) { if (!existsSync(directoryPath))
    return []; const stats = safeTaskFileStat(directoryPath); if (!stats)
    return []; if (stats.isFile())
    return predicate(directoryPath) ? [directoryPath] : []; const output = []; for (const entry of safeTaskFileReadDir(directoryPath)) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory() && shouldSkipTaskFileDiscoveryDirectory(absolutePath))
        continue;
    if (entry.isDirectory()) {
        output.push(...listTaskFiles(absolutePath, predicate));
    }
    else if (entry.isFile() && predicate(absolutePath)) {
        output.push(absolutePath);
    }
} return output; }
function shouldSkipTaskFileDiscoveryDirectory(directoryPath) { const normalized = directoryPath.replace(/\\/g, '/'); const segments = normalized.split('/').filter(Boolean); const basename = segments[segments.length - 1] ?? ''; const ignoredSegmentNames = new Set(['.git', 'node_modules', 'dist', 'build', 'release', '.atm-temp', 'scratch', 'tmp', 'temp', 'library', 'coverage', '.next', '.turbo']); if (ignoredSegmentNames.has(basename))
    return true; return segments.some((segment, index) => segment === 'local' && (segments[index + 1] === 'tmp' || segments[index + 1] === 'temp')); }
function parseTaskMarkdownFrontmatter(text) { const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/); if (!match)
    return {}; const result = {}; for (const rawLine of match[1].split(/\r?\n/)) {
    const separatorIndex = rawLine.indexOf(':');
    if (separatorIndex === -1)
        continue;
    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/, '$1');
    if (key)
        result[key] = value;
} return result; }
function writeTaskMarkdownFrontmatter(filePath, text, document) { const upsertKeys = ['lastTransitionId', 'lastTransitionAt', 'ledgerContractVersion', 'ledgerBaselineKind', 'ledgerBaselineByActor', 'ledgerBaselineAt', 'ledgerBaselineReason', 'ledgerBaselineSourceSha256']; const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/); const frontmatterLines = match ? match[1].split(/\r?\n/) : []; const body = match ? text.slice(match[0].length) : text; const seenKeys = new Set(); const rewritten = frontmatterLines.map((line) => { const separatorIndex = line.indexOf(':'); if (separatorIndex === -1)
    return line; const key = line.slice(0, separatorIndex).trim(); if (!upsertKeys.includes(key))
    return line; seenKeys.add(key); return `${key}: ${formatFrontmatterValue(document[key])}`; }); for (const key of upsertKeys) {
    if (!seenKeys.has(key) && document[key] !== undefined && isFrontmatterScalar(document[key])) {
        rewritten.push(`${key}: ${formatFrontmatterValue(document[key])}`);
    }
} writeFileSync(filePath, `---\n${rewritten.join('\n')}\n---\n${body}`, 'utf8'); }
function isFrontmatterScalar(value) { return delegatedIsFrontmatterScalar(value); }
function formatFrontmatterValue(value) { if (typeof value === 'string')
    return value.replace(/\r?\n/g, ' ').trim(); if (typeof value === 'number' || typeof value === 'boolean')
    return String(value); return ''; }
function normalizeTaskDocumentId(document, fallback) { return delegatedNormalizeTaskDocumentId(document, fallback); }
function normalizeTaskStatus(value) { return String(value ?? '').trim().toLowerCase().replace(/-/g, '_'); }
function normalizeStringValue(value) { return delegatedNormalizeStringValue(value); }
function sha256(value) { return delegatedSha256(value); }
export function assertLocalTaskLedgerEnabled(cwd, action) { return delegatedAssertLocalTaskLedgerEnabled(cwd, action); }
export function buildTaskTransitionCommand(input) { return delegatedBuildTaskTransitionCommand(input); }
function buildScopeAmendmentCommand(input) { return delegatedBuildScopeAmendmentCommand(input); }
function quoteCommandValue(value) { return /^[A-Za-z0-9._:/\\-]+$/.test(value) ? value : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`; }
export const writeTaskDocumentWithTransition = delegatedWriteTaskDocumentWithTransition;
export const stageTaskCloseArtifacts = delegatedStageTaskCloseArtifacts;
export const existingTaskCloseArtifacts = delegatedExistingTaskCloseArtifacts;
export function createClosureTransitionMetadata(closurePacketPath, closurePacket, batchId = null, sessionId = null) { return delegatedCreateClosureTransitionMetadata(closurePacketPath, closurePacket, batchId, sessionId); }
function normalizeWorkItemStatus(value) { return delegatedNormalizeWorkItemStatus(value); }
export function inspectTaskVerifyStatus(value) { return delegatedInspectTaskVerifyStatus(value); }
export function inspectTaskSourceTrace(document, statusInspection) { const source = document.source; const planPath = source && typeof source.planPath === 'string' ? source.planPath.trim() : ''; const sectionTitle = source && typeof source.sectionTitle === 'string' ? source.sectionTitle.trim() : ''; const hash = source && typeof source.hash === 'string' ? source.hash.trim() : ''; if (planPath && sectionTitle && hash) {
    return null;
} const legacyHistoricalTask = isLegacyHistoricalTaskDocument(document, statusInspection); if (legacyHistoricalTask && planPath && sectionTitle) {
    return { level: 'warning', code: 'ATM_TASKS_VERIFY_LEGACY_SOURCE_TRACE', text: 'declared a legacy source trace without hash metadata; ATM will keep it as historical reference only.' };
} return { level: 'error', code: 'ATM_TASKS_VERIFY_BAD_SOURCE_TRACE', text: 'declared a malformed source trace (planPath, sectionTitle, and hash are required).' }; }
function isLegacyHistoricalTaskDocument(document, statusInspection) { if (statusInspection.warningCode === 'ATM_TASKS_VERIFY_LEGACY_STATUS_ALIAS') {
    return true;
} const importedAt = normalizeStringValue(document.importedAt ?? document.imported_at); const evidencePath = normalizeStringValue(document.evidencePath ?? document.evidence_path); const lastTransitionId = normalizeStringValue(document.lastTransitionId ?? document.last_transition_id); return !importedAt && Boolean(evidencePath) && !lastTransitionId; }
export function classifyResetOpenImportForOptions(options) { try {
    const planAbsolute = resolvePlanAbsoluteFromStored(options.cwd, options.from);
    let planningStatus = null;
    if (existsSync(planAbsolute) && statSync(planAbsolute).isFile()) {
        const planText = readFileSync(planAbsolute, 'utf8');
        const match = planText.match(/^status\s*:\s*([A-Za-z0-9_\-]+)/m);
        if (match)
            planningStatus = match[1].trim();
    }
    const taskId = options.from.match(/TASK-[A-Z]+-\d+/i)?.[0] ?? null;
    let runtimeLedgerStatus = null;
    let runtimeActiveClaimActorId = null;
    if (taskId) {
        const ledgerPath = path.join(options.cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
        if (existsSync(ledgerPath)) {
            try {
                const raw = JSON.parse(readFileSync(ledgerPath, 'utf8'));
                if (raw && typeof raw === 'object') {
                    const record = raw;
                    if (typeof record.status === 'string')
                        runtimeLedgerStatus = record.status;
                    const claim = record.claim;
                    if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
                        const actor = claim.actorId;
                        const claimState = claim.state;
                        if (typeof actor === 'string' && actor.trim().length > 0 && claimState !== 'released') {
                            runtimeActiveClaimActorId = actor;
                        }
                    }
                }
            }
            catch {
                return { state: 'drift-with-active-claim', resetOpenEmergencyRequired: true, reason: 'Runtime ledger JSON is unreadable; emergency lease required to override safely.' };
            }
        }
    }
    return classifyResetOpenImport({ planningStatus, runtimeLedgerStatus, runtimeActiveClaimActorId });
}
catch {
    return { state: 'drift-with-active-claim', resetOpenEmergencyRequired: true, reason: 'Reset-open classification peek failed; falling back to emergency-gated behavior.' };
} }
export function parseImportOptions(argv) { const options = { cwd: process.cwd(), from: '', dryRun: false, write: false, force: false, forceOverwriteClaims: false, resetOpen: false, reopen: false, reconcileMirror: false, strictPaths: false, emergencyApproval: null, allowStaleRunner: parseAllowStaleRunnerFlag(argv), waivePlanningRoot: false, reason: null }; for (let index = 0; index < argv.length; index += 1) {
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
    if (arg === '--reconcile-mirror') {
        options.reconcileMirror = true;
        continue;
    }
    if (arg === '--strict-paths') {
        options.strictPaths = true;
        continue;
    }
    if (arg === '--waive-planning-root') {
        options.waivePlanningRoot = true;
        continue;
    }
    if (arg === '--reason') {
        options.reason = requireValue(argv, index, '--reason');
        index += 1;
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
} if (options.waivePlanningRoot && !options.reason?.trim()) {
    throw new CliError('ATM_CLI_USAGE', 'tasks import --waive-planning-root requires --reason "<why target-only .atm/task-plans import is allowed>".', { exitCode: 2 });
} return { ...options, cwd: path.resolve(options.cwd) }; }
export function parseVerifyOptions(argv) { const options = { cwd: process.cwd() }; for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
        options.cwd = requireValue(argv, index, '--cwd');
        index += 1;
        continue;
    }
    if (arg === '--json' || arg === '--pretty')
        continue;
    throw new CliError('ATM_CLI_USAGE', `tasks verify does not support option ${arg}`, { exitCode: 2 });
} return { ...options, cwd: path.resolve(options.cwd) }; }
function requireValue(argv, index, flag) { const value = argv[index + 1]; if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `tasks requires a value for ${flag}`, { exitCode: 2 });
} return value; }
export function parsePlanMarkdown(input) { const { planText, planRelativePath, importedAt } = input; const lines = planText.split(/\r?\n/); const tasks = []; const diagnostics = []; const seenIds = new Set(); const tableMetadata = parseTaskTableMetadata(lines); const singleCard = parseSingleCard({ planText, planRelativePath, importedAt }); if (singleCard) {
    if (seenIds.has(singleCard.workItemId)) {
        diagnostics.push({ level: 'error', code: 'ATM_TASKS_DUPLICATE_ID', text: `Duplicate task id ${singleCard.workItemId} in plan.`, workItemId: singleCard.workItemId });
    }
    else {
        tasks.push(singleCard);
        seenIds.add(singleCard.workItemId);
    }
    return { tasks, diagnostics };
} const sections = splitPlanIntoTaskSections(lines); for (const section of sections) {
    const record = parseTaskSection({ section, planRelativePath, importedAt, tableMetadata: tableMetadata.get(section.workItemId) ?? null });
    if (!record)
        continue;
    if (seenIds.has(record.task.workItemId)) {
        diagnostics.push({ level: 'error', code: 'ATM_TASKS_DUPLICATE_ID', text: `Duplicate task id ${record.task.workItemId} at line ${section.headingLine}.`, workItemId: record.task.workItemId, sourceLine: section.headingLine });
        continue;
    }
    seenIds.add(record.task.workItemId);
    tasks.push(record.task);
    diagnostics.push(...record.diagnostics);
} for (const record of parseChineseLabeledTaskBlocks({ lines, planRelativePath, importedAt })) {
    if (seenIds.has(record.workItemId))
        continue;
    seenIds.add(record.workItemId);
    tasks.push(record);
} for (const [workItemId, metadata] of tableMetadata.entries()) {
    if (seenIds.has(workItemId))
        continue;
    seenIds.add(workItemId);
    tasks.push(createTaskFromTableMetadata({ metadata, planRelativePath, importedAt }));
} return { tasks, diagnostics }; }
function parseChineseLabeledTaskBlocks(input) { const records = []; for (let index = 0; index < input.lines.length; index += 1) {
    const idMatch = /^\s*(?:[-*]\s*)?(?:任務\s*ID|任務ID|任務|Task\s*ID)\s*[：:]\s*(`?[^`\s]+`?)/i.exec(input.lines[index]);
    if (!idMatch)
        continue;
    const taskIdMatch = taskIdAnywherePattern.exec(idMatch[1]);
    if (!taskIdMatch)
        continue;
    const workItemId = normalizeTaskId(taskIdMatch[0]);
    const bodyLines = [];
    let cursor = index + 1;
    while (cursor < input.lines.length) {
        const line = input.lines[cursor];
        if (/^\s*(?:[-*]\s*)?(?:任務\s*ID|任務ID|Task\s*ID)\s*[：:]/i.test(line))
            break;
        if (/^#{1,3}\s+/.test(line) && taskIdAnywherePattern.test(line))
            break;
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
    records.push({ schemaVersion: 'atm.workItem.v0.2', workItemId, title, status, milestone, dependencies, acceptance, deliverables, tags: [], notes, source: { planPath: input.planRelativePath, sectionTitle: title, headingLine: index + 1, hash: hashSection(`${workItemId}\n${bodyLines.join('\n')}`) }, importedAt: input.importedAt });
    index = cursor - 1;
} return records; }
function collectChineseLabeledValue(lines, labels) { const labelPattern = labels.map(escapeRegExp).join('|'); const regex = new RegExp(`^\\s*(?:[-*]\\s*)?(?:${labelPattern})\\s*[：:]\\s*(.+?)\\s*$`, 'i'); for (const line of lines) {
    const match = regex.exec(line);
    if (match?.[1]?.trim())
        return match[1].trim();
} return null; }
function collectChineseLabeledList(lines, labels) { const first = collectChineseLabeledValue(lines, labels); if (!first)
    return []; return first.split(/[、,，;]/).map((entry) => entry.trim()).filter(Boolean); }
export function detectPlanHeadings(planText) { return planText.split(/\r?\n/).flatMap((line, index) => { const match = /^#{1,6}\s+(.+?)\s*$/.exec(line); return match ? [{ line: index + 1, text: match[1] }] : []; }); }
function parseTaskTableMetadata(lines) { const entries = new Map(); for (let index = 0; index < lines.length - 1; index += 1) {
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
            entries.set(workItemId, { workItemId, title: cellAt(cells, titleIndex) || workItemId, milestone: cellAt(cells, milestoneIndex) || null, status: coerceStatus(cellAt(cells, statusIndex) || 'planned'), dependencies: parseDependencyList(cellAt(cells, dependenciesIndex), workItemId), deliverables: deliverableCell ? [deliverableCell] : [], headingLine: rowIndex + 1, rowText: rawLine });
        }
        rowIndex += 1;
    }
    index = rowIndex - 1;
} return entries; }
function splitPlanIntoTaskSections(lines) { const sections = []; let current = null; for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
        const candidate = headingMatch[1];
        const idMatch = taskIdPattern.exec(candidate);
        if (idMatch) {
            if (current)
                sections.push(current);
            const workItemId = normalizeTaskId(idMatch[0]);
            current = { headingLine: index + 1, title: candidate.replace(taskIdPattern, '').replace(/^[\s:：.\-—–]+/u, '').trim() || workItemId, workItemId, bodyLines: [] };
            continue;
        }
    }
    if (current) {
        current.bodyLines.push(line);
    }
} if (current)
    sections.push(current); return sections; }
function parseSingleCard(input) { const frontMatter = extractFrontMatter(input.planText); if (!frontMatter || typeof frontMatter.data.task_id !== 'string')
    return null; const workItemId = normalizeTaskId(frontMatter.data.task_id); const title = normalizeOptionalString(frontMatter.data.title) ?? workItemId; const status = coerceStatus(typeof frontMatter.data.status === 'string' ? frontMatter.data.status : 'planned'); const milestone = normalizeOptionalString(frontMatter.data.milestone); const dependencies = parseYamlList(frontMatter.data.depends_on ?? frontMatter.data.blocked_by ?? frontMatter.data.dependencies); const tags = parseYamlList(frontMatter.data.tags); const scopePaths = parseYamlList(frontMatter.data.scopePaths ?? frontMatter.data.scope_paths ?? frontMatter.data.allowed_files ?? frontMatter.data.allowedFiles ?? frontMatter.data.scope); const validators = parseYamlList(frontMatter.data.validators); const testPlan = normalizeTaskTestPlan(frontMatter.data.testPlan ?? frontMatter.data.test_plan); const planningMirrorPaths = parseYamlList(frontMatter.data.planningMirrorPaths ?? frontMatter.data.planning_mirror_paths); const planningReadOnlyPaths = parseYamlList(frontMatter.data.planningReadOnlyPaths ?? frontMatter.data.planning_read_only_paths); const planningArtifacts = parseYamlList(frontMatter.data.planningArtifacts ?? frontMatter.data.planning_artifacts); const outOfScope = parseYamlList(frontMatter.data.outOfScope ?? frontMatter.data.out_of_scope ?? frontMatter.data.forbidden_files); const nonGoals = parseYamlList(frontMatter.data.nonGoals ?? frontMatter.data.non_goals); const rawAtomizationImpact = frontMatter.data.atomizationImpact ?? frontMatter.data.atomization_impact; const atomizationImpactFrontMatter = rawAtomizationImpact && typeof rawAtomizationImpact === 'object' && !Array.isArray(rawAtomizationImpact) ? rawAtomizationImpact : {}; const mapUpdates = parseYamlList(frontMatter.data.mapUpdates ?? frontMatter.data.map_updates ?? atomizationImpactFrontMatter.mapUpdates ?? atomizationImpactFrontMatter.map_updates); const proposalAdmission = parseTaskProposalAdmission(frontMatter.data.proposalAdmission ?? frontMatter.data.brokerProposalAdmission); const body = input.planText.slice(frontMatter.endIndex); const sections = sliceBodyByHeadings(body); const acceptance = collectBulletList(sections, acceptanceHeaders); const frontMatterScopePaths = parseYamlList(frontMatter.data.scopePaths ?? frontMatter.data.scope_paths ?? frontMatter.data.allowed_files ?? frontMatter.data.allowedFiles ?? frontMatter.data.scope); const frontMatterDeliverables = parseYamlList(frontMatter.data.deliverables); const bodyDeliverables = collectBulletList(sections, deliverablesHeaders); let deliverables; const cardImportDiagnostics = []; if (frontMatterDeliverables.length > 0 && bodyDeliverables.length > 0) {
    deliverables = uniqueStrings(frontMatterDeliverables.map(normalizeYamlScalar));
    cardImportDiagnostics.push({ code: 'IMPORT_BODY_SECTION_IGNORED', severity: 'warning', message: 'Front-matter `deliverables` key is present; body section deliverables were ignored in favour of front-matter values.', field: 'deliverables' });
}
else if (frontMatterDeliverables.length > 0) {
    deliverables = uniqueStrings(frontMatterDeliverables.map(normalizeYamlScalar));
}
else {
    deliverables = uniqueStrings(bodyDeliverables.map(normalizeYamlScalar));
} const inferredLegacyDeliverables = deliverables.length === 0 ? inferLegacyDeliverablesFromScope(frontMatterScopePaths.map(normalizeYamlScalar)) : []; if (deliverables.length === 0 && inferredLegacyDeliverables.length > 0) {
    deliverables = inferredLegacyDeliverables;
    cardImportDiagnostics.push({ code: 'ATM_TASK_IMPORT_LEGACY_SCOPE_DELIVERABLES_INFERRED', severity: 'warning', message: 'No explicit deliverables were declared; ATM inferred deliverables from legacy scopePaths/allowed_files because every entry was file-shaped.', field: 'deliverables' });
} const notes = collectText(sections, notesHeaders) ?? null; const evidenceFrontMatter = frontMatter.data.evidence && typeof frontMatter.data.evidence === 'object' && !Array.isArray(frontMatter.data.evidence) ? frontMatter.data.evidence : {}; const rollbackFrontMatter = frontMatter.data.rollback && typeof frontMatter.data.rollback === 'object' && !Array.isArray(frontMatter.data.rollback) ? frontMatter.data.rollback : {}; const evidenceRequired = normalizeOptionalString(frontMatter.data.evidenceRequired ?? frontMatter.data.evidence_required ?? frontMatter.data.required ?? evidenceFrontMatter.required ?? evidenceFrontMatter.kind); const rollbackStrategy = normalizeOptionalString(frontMatter.data.rollbackStrategy ?? frontMatter.data.rollback_strategy ?? frontMatter.data.strategy ?? rollbackFrontMatter.strategy); const rollbackNotes = normalizeOptionalString(frontMatter.data.rollbackNotes ?? frontMatter.data.rollback_notes ?? rollbackFrontMatter.notes); const contextMap = parseContextMap(frontMatter.data.contextMap); let dispatchMetadata = {}; try {
    dispatchMetadata = parseDispatchMetadataFromPlanText(input.planText);
}
catch (error) {
    cardImportDiagnostics.push({ code: 'ATM_TASK_IMPORT_DISPATCH_METADATA_TOO_LARGE', severity: 'error', message: error instanceof Error ? error.message : String(error), field: 'dispatchPattern' });
} const importDiagnostics = [...cardImportDiagnostics]; if (frontMatter.data.allowed_files !== undefined && frontMatter.data.scopePaths === undefined && frontMatter.data.scope_paths === undefined) {
    importDiagnostics.push({ code: 'ATM_TASK_IMPORT_LEGACY_ALIAS', severity: 'warning', message: 'Front-matter uses legacy alias `allowed_files`; ATM imports the value as `scopePaths` to preserve target-repo scope. Prefer `scopePaths` in new task cards.', field: 'scopePaths', alias: 'allowed_files', canonical: 'scopePaths' });
    if (deliverables.length === 0) {
        importDiagnostics.push({ code: 'ATM_TASK_IMPORT_LEGACY_SCOPE_DELIVERABLES_REQUIRED', severity: 'warning', message: 'Legacy allowed_files card did not expose a file-only deliverable boundary; add explicit deliverables for future historical closeback.', field: 'deliverables' });
    }
} if (frontMatter.data.blocked_by !== undefined && frontMatter.data.depends_on === undefined && frontMatter.data.dependencies === undefined) {
    importDiagnostics.push({ code: 'ATM_TASK_IMPORT_LEGACY_ALIAS', severity: 'warning', message: 'Front-matter uses legacy alias `blocked_by`; ATM imports the value as `dependencies`. Prefer `depends_on` or `dependencies`.', field: 'dependencies', alias: 'blocked_by', canonical: 'depends_on' });
} if (frontMatter.data.upstream_repo !== undefined && frontMatter.data.target_repo === undefined && frontMatter.data.targetRepo === undefined) {
    importDiagnostics.push({ code: 'ATM_TASK_IMPORT_LEGACY_ALIAS', severity: 'warning', message: 'Front-matter uses legacy alias `upstream_repo`; ATM imports the value as `targetRepo`. Prefer `target_repo`.', field: 'targetRepo', alias: 'upstream_repo', canonical: 'target_repo' });
} if (scopePaths.length > 0 && outOfScope.length > 0) {
    const intersections = scopePaths.filter((p) => isPathAllowedByScope(p, outOfScope));
    if (intersections.length > 0) {
        importDiagnostics.push({ code: 'ATM_TASK_SCOPE_OUT_OF_SCOPE_INTERSECTION', severity: 'warning', message: `Task scope paths intersect with outOfScope: ${intersections.join(', ')}. These files will be subtracted from targetAllowedFiles.`, field: 'scopePaths' });
    }
} importDiagnostics.push(...buildMechanicalSplitScopeDiagnostics({ title, body, scopePaths, deliverables, mapUpdates, ownerAtomOrMap: normalizeOptionalString(frontMatter.data.ownerAtomOrMap ?? frontMatter.data.owner_atom_or_map ?? atomizationImpactFrontMatter.ownerAtomOrMap ?? atomizationImpactFrontMatter.owner_atom_or_map) })); const ownerAtomOrMap = normalizeOptionalString(frontMatter.data.ownerAtomOrMap ?? frontMatter.data.owner_atom_or_map ?? atomizationImpactFrontMatter.ownerAtomOrMap ?? atomizationImpactFrontMatter.owner_atom_or_map); return { schemaVersion: 'atm.workItem.v0.2', workItemId, title, status, milestone, dependencies, acceptance, deliverables, scopePaths, validators, ...(testPlan ? { testPlan } : {}), planningRepo: normalizeOptionalString(frontMatter.data.planning_repo ?? frontMatter.data.planningRepo), targetRepo: normalizeOptionalString(frontMatter.data.target_repo ?? frontMatter.data.targetRepo ?? frontMatter.data.upstream_repo ?? frontMatter.data.upstreamRepo), closureAuthority: normalizeOptionalString(frontMatter.data.closure_authority ?? frontMatter.data.closureAuthority), planningReadOnlyPaths, planningMirrorPaths, planningArtifacts, outOfScope, nonGoals, evidenceRequired, rollbackStrategy, rollbackNotes, contextMap, ...(dispatchMetadata.dispatchPattern ? { dispatchPattern: dispatchMetadata.dispatchPattern } : {}), ...(dispatchMetadata.conditionReview && dispatchMetadata.conditionReview.length > 0 ? { conditionReview: dispatchMetadata.conditionReview } : {}), ...(dispatchMetadata.mailboxAssignee ? { mailboxAssignee: dispatchMetadata.mailboxAssignee } : {}), atomizationImpact: { ownerAtomOrMap, atomCid: normalizeOptionalString(frontMatter.data.atomCid ?? frontMatter.data.atom_cid ?? atomizationImpactFrontMatter.atomCid ?? atomizationImpactFrontMatter.atom_cid), mapUpdates, ...(parseExtractionCandidates(atomizationImpactFrontMatter.extractionCandidates ?? atomizationImpactFrontMatter.extraction_candidates) ?? {}) }, ...(proposalAdmission ? { proposalAdmission } : {}), legacyImportAliases: { ...(frontMatter.data.allowed_files ? { allowed_files: parseYamlList(frontMatter.data.allowed_files) } : {}), ...(frontMatter.data.blocked_by ? { blocked_by: parseYamlList(frontMatter.data.blocked_by) } : {}), ...(frontMatter.data.upstream_repo ? { upstream_repo: normalizeOptionalString(frontMatter.data.upstream_repo) ?? '' } : {}) }, importDiagnostics, tags, notes, source: { planPath: input.planRelativePath, sectionTitle: workItemId, headingLine: frontMatter.headingLine, hash: hashSection(input.planText) }, importedAt: input.importedAt }; }
function parseExtractionCandidates(value) { if (!Array.isArray(value))
    return null; const entries = value.filter((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)).map((entry) => ({ ...(typeof entry.atom === 'string' ? { atom: entry.atom.trim() } : {}), ...(typeof entry.pattern === 'string' ? { pattern: entry.pattern.trim() } : {}), ...(typeof entry.source === 'string' ? { source: entry.source.trim() } : {}), ...(typeof entry.disposition === 'string' ? { disposition: entry.disposition.trim() } : {}), inlineReason: typeof entry.inlineReason === 'string' ? entry.inlineReason : null })); return entries.length > 0 ? { extractionCandidates: entries } : null; }
function buildMechanicalSplitScopeDiagnostics(input) { const haystack = [input.title, input.body, input.ownerAtomOrMap ?? '', ...input.mapUpdates].join('\n').toLowerCase(); if (!/(split|mechanical|extract|facade|module|atom[-_\s]?map|atomization|拆分|切分|抽出|門面|模組)/i.test(haystack)) {
    return [];
} const declared = uniqueStrings([...input.scopePaths, ...input.deliverables].map(normalizeYamlScalar).filter(Boolean)); const fileLike = declared.filter((entry) => /\.[A-Za-z0-9]+$/.test(entry) && !/[*/{}]/.test(entry)); const broadPatterns = declared.filter((entry) => /[*]|\*\*|\/$/.test(entry)); if (fileLike.length > 1 || broadPatterns.length > 0)
    return []; const candidates = uniqueStrings([...declared, ...input.mapUpdates.map(normalizeYamlScalar).filter(Boolean)]); return [{ code: 'ATM_TASK_IMPORT_MECHANICAL_SPLIT_SCOPE_CHECKLIST', severity: 'warning', field: 'scopePaths', message: 'Mechanical split/facade/module task appears to declare a narrow file boundary. Before the first delivery commit, review sibling files such as types.ts, shared.ts, constants.ts, registry files, and lane modules; add all expected paths once with `node atm.mjs tasks scope add --task <id> --paths <paths> --json`.', candidates }]; }
function normalizeTaskTestPlan(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
} const record = value; return { schemaId: typeof record.schemaId === 'string' ? record.schemaId : 'atm.taskTestPlan.v1', selectionMode: typeof record.selectionMode === 'string' ? record.selectionMode : 'task-scoped', ...record }; }
export function enrichParsedTasksFromSiblingTaskCards(input) { const taskCardRoot = path.join(path.dirname(input.planAbsolute), 'tasks'); if (!existsSync(taskCardRoot))
    return input.parsed; let entries; try {
    entries = readdirSync(taskCardRoot, { withFileTypes: true });
}
catch {
    return input.parsed;
} const cardByTaskId = new Map(); for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.task.md'))
        continue;
    const taskIdMatch = taskIdPattern.exec(entry.name);
    if (!taskIdMatch)
        continue;
    const cardPath = path.join(taskCardRoot, entry.name);
    const cardText = readFileSync(cardPath, 'utf8');
    const card = parseSingleCard({ planText: cardText, planRelativePath: toStoredPlanningPath(input.cwd, cardPath), importedAt: input.importedAt });
    if (card)
        cardByTaskId.set(card.workItemId, card);
} if (cardByTaskId.size === 0)
    return input.parsed; const tasks = input.parsed.tasks.map((task) => { const card = cardByTaskId.get(task.workItemId); if (!card)
    return task; return { ...task, ...card, source: card.source, importedAt: task.importedAt }; }); const diagnostics = [...input.parsed.diagnostics]; const enrichedCount = tasks.filter((task) => cardByTaskId.has(task.workItemId)).length; if (enrichedCount > 0) {
    diagnostics.push({ level: 'info', code: 'ATM_TASKS_IMPORT_CARD_CONTRACT_MERGED', text: `Merged machine-readable frontmatter from ${enrichedCount} sibling task card(s).` });
} return { tasks, diagnostics }; }
function parseTaskSection(input) { const { section } = input; const diagnostics = []; const sectionText = section.bodyLines.join('\n'); const sectionsByHeading = sliceBodyByHeadings(sectionText); const acceptance = [...collectBulletList(sectionsByHeading, acceptanceHeaders), ...collectLabeledText(section.bodyLines, ['acceptance criteria', 'acceptance', '驗收'])]; const deliverables = uniqueStrings([...collectBulletList(sectionsByHeading, deliverablesHeaders), ...collectLabeledText(section.bodyLines, ['deliverables', 'outputs', 'outcomes', 'evidence', 'validation', '輸出', '驗證']), ...(input.tableMetadata?.deliverables ?? [])]); const sectionDependencies = collectBulletList(sectionsByHeading, dependenciesHeaders).flatMap((entry) => parseDependencyList(entry, section.workItemId)); const dependencies = uniqueStrings(sectionDependencies.length > 0 ? sectionDependencies : input.tableMetadata?.dependencies ?? []); const tags = collectBulletList(sectionsByHeading, tagsHeaders); const notes = collectText(sectionsByHeading, notesHeaders) ?? null; const statusRaw = collectKeyValue(sectionsByHeading, 'status') ?? collectKeyValue(sectionsByHeading, 'state') ?? collectKeyValueFromLines(section.bodyLines, 'status') ?? collectKeyValueFromLines(section.bodyLines, 'state') ?? input.tableMetadata?.status ?? 'planned'; const milestone = collectKeyValue(sectionsByHeading, 'milestone') ?? collectKeyValueFromLines(section.bodyLines, 'milestone') ?? input.tableMetadata?.milestone ?? null; const status = coerceStatus(statusRaw); const hash = hashSection(`${section.workItemId}\n${sectionText}`); if (!validStatuses.has(status)) {
    diagnostics.push({ level: 'warning', code: 'ATM_TASKS_STATUS_UNKNOWN', text: `Task ${section.workItemId} declared unknown status ${statusRaw}; defaulted to planned.`, workItemId: section.workItemId, sourceLine: section.headingLine });
} const task = { schemaVersion: 'atm.workItem.v0.2', workItemId: section.workItemId, title: section.title || input.tableMetadata?.title || section.workItemId, status, milestone: milestone ?? null, dependencies, acceptance, deliverables, tags, notes, source: { planPath: input.planRelativePath, sectionTitle: section.title || section.workItemId, headingLine: section.headingLine, hash }, importedAt: input.importedAt }; return { task, diagnostics }; }
function createTaskFromTableMetadata(input) { return delegatedCreateTaskFromTableMetadata({ ...input, hashSection }); }
function hasProtectedActiveClaim(document) { if (!document)
    return false; const claim = parseClaimRecord(document.claim); return Boolean(claim && (claim.state === 'active' || claim.state === 'handoff')); }
function isCreatePlaceholderLedger(document) { if (normalizeTaskStatus(document.status) !== 'planned')
    return false; const source = document.source; const sourceHash = source && typeof source === 'object' && !Array.isArray(source) ? String(source.hash ?? '').trim() : ''; const legacyHash = typeof document.hash === 'string' ? document.hash.trim() : ''; if (sourceHash.length > 0 || legacyHash.length > 0)
    return false; if (typeof document.importedAt === 'string' && document.importedAt.trim().length > 0)
    return false; return true; }
function releaseEmbeddedDirectionLock(input) { const embeddedLock = input.lockRecord.taskDirectionLock; if (!embeddedLock || typeof embeddedLock !== 'object' || Array.isArray(embeddedLock))
    return false; const embedded = embeddedLock; if (embedded.status === 'released')
    return false; writeFileSync(input.lockPath, `${JSON.stringify({ ...input.lockRecord, taskDirectionLock: { ...embedded, status: 'released', released: true, releasedAt: input.nowIso, releasedBy: input.actorId } }, null, 2)}\n`, 'utf8'); return true; }
function applyCanonicalDirectionLockRelease(input) { const canonicalDirectionLock = input.taskDocument.taskDirectionLock; if (!canonicalDirectionLock || typeof canonicalDirectionLock !== 'object' || Array.isArray(canonicalDirectionLock)) {
    return false;
} const directionLock = canonicalDirectionLock; if (directionLock.status === 'released')
    return false; input.taskDocument.taskDirectionLock = { ...directionLock, status: 'released', released: true, releasedAt: input.nowIso, releasedBy: input.actorId }; return true; }
function importWouldOverwriteTask(input) { const currentHash = input.current.source?.hash ?? input.current.hash ?? ''; if (input.resetOpen || input.reopen)
    return true; if (input.force)
    return currentHash !== input.task.source.hash; return currentHash !== input.task.source.hash; }
function shouldSkipImportForActiveClaim(options) { if (!options.wouldOverwrite || options.forceOverwriteClaims || options.force || options.resetOpen || options.reopen || options.reconcileMirror) {
    return false;
} return true; }
export function collectActiveClaimImportSkips(cwd, tasks, options) { const diagnostics = []; const taskLedger = readTaskLedgerPolicy(cwd); const taskStoreDirectory = path.join(cwd, taskLedger.taskRoot); for (const task of tasks) {
    const filePath = path.join(taskStoreDirectory, `${task.workItemId}.json`);
    if (!existsSync(filePath))
        continue;
    try {
        const existingDocument = JSON.parse(readFileSync(filePath, 'utf8'));
        if (!hasProtectedActiveClaim(existingDocument))
            continue;
        const wouldOverwrite = importWouldOverwriteTask({ current: existingDocument, task, force: options.force, resetOpen: options.resetOpen, reopen: options.reopen });
        if (!shouldSkipImportForActiveClaim({ ...options, wouldOverwrite }))
            continue;
        diagnostics.push({ level: 'warning', code: 'IMPORT_SKIPPED_ACTIVE_CLAIM', text: `Task ${task.workItemId} has an active claim; import skipped to avoid overwriting claim state.`, workItemId: task.workItemId });
    }
    catch { }
} return diagnostics; }
export function writeTaskFiles(input) { const writtenPaths = []; const diagnostics = []; const reconcileMirror = input.reconcileMirror === true; const taskLedger = readTaskLedgerPolicy(input.cwd); const taskStoreDirectory = path.join(input.cwd, taskLedger.taskRoot); mkdirSync(taskStoreDirectory, { recursive: true }); for (const task of input.tasks) {
    const filePath = path.join(taskStoreDirectory, `${task.workItemId}.json`);
    if (existsSync(filePath) && !input.force) {
        try {
            const current = JSON.parse(readFileSync(filePath, 'utf8'));
            const currentHash = current.source?.hash ?? current.hash ?? '';
            const currentStatus = normalizeTaskStatus(current.status);
            if (currentStatus === 'done' && reconcileMirror) {
                diagnostics.push({ level: 'info', code: 'ATM_TASKS_IMPORT_RECONCILE_MIRROR_READY', text: `Task ${task.workItemId} is done; planning mirror metadata will be reconciled without reopening delivery state.`, workItemId: task.workItemId });
                continue;
            }
            if (currentHash === task.source.hash && !input.resetOpen && !input.reopen) {
                diagnostics.push({ level: 'info', code: 'ATM_TASKS_IMPORT_UNCHANGED', text: `Task ${task.workItemId} is unchanged; left existing file in place.`, workItemId: task.workItemId });
                continue;
            }
            if (currentStatus === 'done' && !input.reopen && !input.resetOpen) {
                diagnostics.push({ level: 'error', code: 'ATM_TASKS_IMPORT_DONE_REQUIRES_REOPEN', text: `Task ${task.workItemId} is done; use --reopen or --reset-open before overwriting it.`, workItemId: task.workItemId });
                continue;
            }
            if (input.force) {
                const currentSource = current.source;
                const sameSource = currentSource?.planPath === task.source.planPath || currentHash === task.source.hash;
                if (!sameSource) {
                    diagnostics.push({ level: 'error', code: 'ATM_TASKS_IMPORT_FORCE_SOURCE_MISMATCH', text: `Task ${task.workItemId} exists from a different source; refusing --force overwrite.`, workItemId: task.workItemId });
                    continue;
                }
            }
            const existingDocument = current;
            const wouldOverwrite = importWouldOverwriteTask({ current: existingDocument, task, force: input.force, resetOpen: input.resetOpen, reopen: input.reopen });
            if (hasProtectedActiveClaim(existingDocument) && shouldSkipImportForActiveClaim({ force: input.force, forceOverwriteClaims: input.forceOverwriteClaims, resetOpen: input.resetOpen, reopen: input.reopen, reconcileMirror, wouldOverwrite })) {
                diagnostics.push({ level: 'warning', code: 'IMPORT_SKIPPED_ACTIVE_CLAIM', text: `Task ${task.workItemId} has an active claim; import skipped to avoid overwriting claim state.`, workItemId: task.workItemId });
                continue;
            }
            if (input.resetOpen || input.reopen) {
                continue;
            }
            if (isCreatePlaceholderLedger(existingDocument) && !hasProtectedActiveClaim(existingDocument)) {
                continue;
            }
            diagnostics.push({ level: 'error', code: 'ATM_TASKS_IMPORT_DRIFT', text: `Task ${task.workItemId} exists with a different hash; rerun with --force to overwrite.`, workItemId: task.workItemId });
            continue;
        }
        catch {
            diagnostics.push({ level: 'error', code: 'ATM_TASKS_IMPORT_UNREADABLE_EXISTING', text: `Task ${task.workItemId} file exists but is unreadable; rerun with --force to overwrite.`, workItemId: task.workItemId });
            continue;
        }
    }
} if (diagnostics.some((entry) => entry.level === 'error')) {
    return { writtenPaths, diagnostics };
} for (const task of input.tasks) {
    const filePath = path.join(taskStoreDirectory, `${task.workItemId}.json`);
    let existingDocument = null;
    if (existsSync(filePath)) {
        try {
            existingDocument = JSON.parse(readFileSync(filePath, 'utf8'));
        }
        catch { }
    }
    const placeholderOverwrite = existingDocument ? isCreatePlaceholderLedger(existingDocument) && !hasProtectedActiveClaim(existingDocument) : false;
    if (existsSync(filePath) && !input.force && !reconcileMirror && !input.resetOpen && !input.reopen && !placeholderOverwrite) {
        continue;
    }
    const wouldOverwrite = existingDocument ? importWouldOverwriteTask({ current: existingDocument, task, force: input.force, resetOpen: input.resetOpen, reopen: input.reopen }) : true;
    if (existingDocument && hasProtectedActiveClaim(existingDocument) && shouldSkipImportForActiveClaim({ force: input.force, forceOverwriteClaims: input.forceOverwriteClaims, resetOpen: input.resetOpen, reopen: input.reopen, reconcileMirror, wouldOverwrite })) {
        diagnostics.push({ level: 'warning', code: 'IMPORT_SKIPPED_ACTIVE_CLAIM', text: `Task ${task.workItemId} has an active claim; import skipped to avoid overwriting claim state.`, workItemId: task.workItemId });
        continue;
    }
    const displacedClaim = existingDocument && input.forceOverwriteClaims && hasProtectedActiveClaim(existingDocument) ? parseClaimRecord(existingDocument.claim) : null;
    const taskDocument = { ...task, ...(input.resetOpen ? { status: 'open' } : {}), ...(input.reopen ? { status: 'open', reopenedAt: new Date().toISOString() } : {}) };
    if (existingDocument && reconcileMirror && normalizeTaskStatus(existingDocument.status) === 'done') {
        Object.assign(taskDocument, reconcileMirrorOnlyTaskDocument(existingDocument, task));
    }
    else if (input.resetOpen || input.reopen) {
        delete taskDocument.claim;
        delete taskDocument.closedAt;
        delete taskDocument.closedByActor;
        delete taskDocument.closurePacket;
        delete taskDocument.closeReason;
    }
    else if (existingDocument && hasProtectedActiveClaim(existingDocument) && input.force && !input.forceOverwriteClaims) {
        const currentClaim = parseClaimRecord(existingDocument.claim);
        if (currentClaim) {
            taskDocument.claim = existingDocument.claim;
            if (existingDocument.status)
                taskDocument.status = existingDocument.status;
            if (existingDocument.owner)
                taskDocument.owner = existingDocument.owner;
            if (existingDocument.startedAt)
                taskDocument.startedAt = existingDocument.startedAt;
            if (existingDocument.startedBySessionId)
                taskDocument.startedBySessionId = existingDocument.startedBySessionId;
        }
        if (existingDocument.taskDirectionLock) {
            taskDocument.taskDirectionLock = existingDocument.taskDirectionLock;
        }
    }
    const previousStatus = typeof existingDocument?.status === 'string' ? existingDocument.status : null;
    const transitionPath = writeTaskDocumentWithTransition({ cwd: input.cwd, taskPath: filePath, taskId: task.workItemId, taskDocument, action: existingDocument && reconcileMirror && normalizeTaskStatus(existingDocument.status) === 'done' ? 'planning-mirror-reconcile' : 'import', actorId: null, previousStatus });
    if (displacedClaim) {
        const displacedAt = new Date().toISOString();
        appendTaskTransitionEvent({ cwd: input.cwd, taskId: task.workItemId, action: 'claim-displaced-by-import', actorId: null, sessionId: null, fromStatus: previousStatus, toStatus: typeof taskDocument.status === 'string' ? taskDocument.status : null, taskPath: filePath, taskDocument: { ...taskDocument, displacedClaim: { actorId: displacedClaim.actorId, leaseId: displacedClaim.leaseId, state: displacedClaim.state, reason: 'import overwrite with --force-overwrite-claims', importTransitionPath: transitionPath } }, command: 'node atm.mjs tasks import --write --force-overwrite-claims', createdAt: displacedAt });
    }
    writtenPaths.push(relativePathFrom(input.cwd, filePath));
} return { writtenPaths, diagnostics }; }
function reconcileMirrorOnlyTaskDocument(existingDocument, task) { const merged = { ...existingDocument, source: task.source, importedAt: task.importedAt, planningRepo: task.planningRepo ?? existingDocument.planningRepo ?? null, targetRepo: task.targetRepo ?? existingDocument.targetRepo ?? null, closureAuthority: task.closureAuthority ?? existingDocument.closureAuthority ?? null, planningReadOnlyPaths: task.planningReadOnlyPaths ?? existingDocument.planningReadOnlyPaths, planningMirrorPaths: task.planningMirrorPaths ?? existingDocument.planningMirrorPaths, importDiagnostics: task.importDiagnostics ?? existingDocument.importDiagnostics, legacyImportAliases: task.legacyImportAliases ?? existingDocument.legacyImportAliases }; if (typeof existingDocument.status === 'string')
    merged.status = existingDocument.status; if ('claim' in existingDocument)
    merged.claim = existingDocument.claim; if ('closedAt' in existingDocument)
    merged.closedAt = existingDocument.closedAt; if ('closedByActor' in existingDocument)
    merged.closedByActor = existingDocument.closedByActor; if ('closurePacket' in existingDocument)
    merged.closurePacket = existingDocument.closurePacket; if ('closeReason' in existingDocument)
    merged.closeReason = existingDocument.closeReason; if ('lastTransitionId' in existingDocument)
    merged.lastTransitionId = existingDocument.lastTransitionId; return merged; }
export function writeImportEvidence(input) { const evidenceDirectory = path.join(input.cwd, '.atm', 'history', 'reports', 'task-import'); mkdirSync(evidenceDirectory, { recursive: true }); const evidenceFile = `${input.generatedAt.replace(/[:.]/g, '-')}.json`; const evidencePath = path.join(evidenceDirectory, evidenceFile); const payload = { schemaId: 'atm.taskImportEvidence', specVersion: '0.1.0', generatedAt: input.generatedAt, planPath: input.planPath, taskCount: input.tasks.length, writtenPaths: input.writtenPaths, taskIds: input.tasks.map((task) => task.workItemId), sourceTraces: input.tasks.map((task) => ({ workItemId: task.workItemId, planPath: task.source.planPath, sectionTitle: task.source.sectionTitle, headingLine: task.source.headingLine, hash: task.source.hash })) }; writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8'); return relativePathFrom(input.cwd, evidencePath); }
function sliceBodyByHeadings(text) { const lines = text.split(/\r?\n/); const sections = []; let current = null; for (const line of lines) {
    const headingMatch = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
        if (current)
            sections.push(current);
        current = { heading: headingMatch[1].toLowerCase().trim(), lines: [] };
        continue;
    }
    if (current) {
        current.lines.push(line);
    }
} if (current)
    sections.push(current); return sections; }
function collectBulletList(sections, headingNames) { const target = sections.find((section) => headingNames.some((name) => section.heading.includes(name))); if (!target)
    return []; const items = []; for (const line of target.lines) {
    const match = /^\s*[-*]\s+\[\s*[ xX]\s*\]\s+(.+)|^\s*[-*]\s+(.+)/.exec(line);
    if (match) {
        const value = (match[1] ?? match[2] ?? '').trim();
        if (value)
            items.push(value);
        continue;
    }
    const continuation = /^\s{2,}(\S.*)$/.exec(line);
    if (continuation && items.length > 0) {
        items[items.length - 1] = `${items[items.length - 1]} ${continuation[1].trim()}`;
    }
} return items; }
function collectText(sections, headingNames) { const target = sections.find((section) => headingNames.some((name) => section.heading.includes(name))); if (!target)
    return null; const text = target.lines.join('\n').trim(); return text || null; }
function collectKeyValue(sections, key) { return delegatedCollectKeyValue(sections, key); }
function collectKeyValueFromLines(lines, key) { return delegatedCollectKeyValueFromLines(lines, key); }
function extractTaskReference(value) { const match = taskIdAnywherePattern.exec(value); return match ? normalizeTaskId(match[0]) : null; }
function parseDependencyList(value, baseWorkItemId) { const trimmed = cleanCellText(value); if (!trimmed || /^(none|n\/a|na|null|無|--|-|\?)$/i.test(trimmed))
    return []; const prefix = baseWorkItemId.replace(/-\d+$/, ''); const values = trimmed.split(/[,/、，\s]+/).map((entry) => entry.trim()).filter(Boolean).flatMap((entry) => { const fullMatch = taskIdAnywherePattern.exec(entry); if (fullMatch)
    return [normalizeTaskId(fullMatch[0])]; if (/^\d{2,}$/.test(entry) && prefix !== baseWorkItemId)
    return [`${prefix}-${entry}`]; return []; }); return uniqueStrings(values); }
function collectLabeledText(lines, labels) { const normalizedLabels = labels.map((label) => label.toLowerCase()); const values = []; for (const line of lines) {
    const match = /^\s*\*\*(.+?)\*\*\s*[：:]\s*(.+?)\s*$/.exec(line);
    if (!match)
        continue;
    const label = match[1].trim().toLowerCase();
    if (!normalizedLabels.some((candidate) => label.includes(candidate)))
        continue;
    const value = match[2].trim();
    if (value)
        values.push(value);
} return values; }
function cleanCellText(value) { return value.replace(/`/g, '').replace(/<br\s*\/?>/gi, ', ').trim(); }
function isMarkdownTableRow(value) { return value.startsWith('|') && value.endsWith('|'); }
function isMarkdownTableSeparator(value) { return /^[-|\s:]+$/.test(value.replace(/\|/g, '')); }
function normalizeTableHeader(value) { return cleanCellText(value).toLowerCase().replace(/\s+/g, ' ').trim(); }
function findTableColumnIndex(headers, candidates) { return headers.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate))); }
function cellAt(cells, index) { return index >= 0 && index < cells.length ? cells[index] : ''; }
export function uniqueStrings(values) { return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function parseSingleCardFromPlugin(parsed, importedAt) { const frontData = parsed.frontmatter; const workItemId = normalizeTaskId(parsed.taskId); const title = normalizeOptionalString(frontData.title) ?? workItemId; const status = coerceStatus(typeof frontData.status === 'string' ? frontData.status : 'planned'); const milestone = normalizeOptionalString(frontData.milestone); const dependencies = parseYamlList(frontData.depends_on ?? frontData.blocked_by ?? frontData.dependencies); const tags = parseYamlList(frontData.tags); const scopePaths = parseYamlList(frontData.scopePaths ?? frontData.scope_paths ?? frontData.allowed_files ?? frontData.allowedFiles ?? frontData.scope); const validators = parseYamlList(frontData.validators); const testPlan = normalizeTaskTestPlan(frontData.testPlan ?? frontData.test_plan); const planningMirrorPaths = parseYamlList(frontData.planningMirrorPaths ?? frontData.planning_mirror_paths); const planningReadOnlyPaths = parseYamlList(frontData.planningReadOnlyPaths ?? frontData.planning_read_only_paths); const planningArtifacts = parseYamlList(frontData.planningArtifacts ?? frontData.planning_artifacts); const outOfScope = parseYamlList(frontData.outOfScope ?? frontData.out_of_scope ?? frontData.forbidden_files); const nonGoals = parseYamlList(frontData.nonGoals ?? frontData.non_goals); const rawAtomizationImpact = frontData.atomizationImpact ?? frontData.atomization_impact; const atomizationImpactFrontMatter = rawAtomizationImpact && typeof rawAtomizationImpact === 'object' && !Array.isArray(rawAtomizationImpact) ? rawAtomizationImpact : {}; const mapUpdates = parseYamlList(frontData.mapUpdates ?? frontData.map_updates ?? atomizationImpactFrontMatter.mapUpdates ?? atomizationImpactFrontMatter.map_updates); const proposalAdmission = parseTaskProposalAdmission(frontData.proposalAdmission ?? frontData.brokerProposalAdmission); const body = parsed.body || ''; const sections = sliceBodyByHeadings(body); const acceptance = collectBulletList(sections, acceptanceHeaders); const frontMatterDeliverables = parseYamlList(frontData.deliverables); const bodyDeliverables = collectBulletList(sections, deliverablesHeaders); let deliverables; if (frontMatterDeliverables.length > 0) {
    deliverables = uniqueStrings(frontMatterDeliverables.map(normalizeYamlScalar));
}
else {
    deliverables = uniqueStrings(bodyDeliverables.map(normalizeYamlScalar));
} if (deliverables.length === 0) {
    deliverables = inferLegacyDeliverablesFromScope(scopePaths.map(normalizeYamlScalar));
} const notes = collectText(sections, notesHeaders) ?? null; const evidenceFrontMatter = frontData.evidence && typeof frontData.evidence === 'object' && !Array.isArray(frontData.evidence) ? frontData.evidence : {}; const rollbackFrontMatter = frontData.rollback && typeof frontData.rollback === 'object' && !Array.isArray(frontData.rollback) ? frontData.rollback : {}; const evidenceRequired = normalizeOptionalString(frontData.evidenceRequired ?? frontData.evidence_required ?? frontData.required ?? evidenceFrontMatter.required ?? evidenceFrontMatter.kind); const rollbackStrategy = normalizeOptionalString(frontData.rollbackStrategy ?? rollbackFrontMatter.strategy); const rollbackNotes = normalizeOptionalString(frontData.rollbackNotes ?? rollbackFrontMatter.notes); const contextMap = parseContextMap(frontData.contextMap); return { schemaVersion: 'atm.workItem.v0.2', workItemId, title, status, milestone, dependencies, acceptance, deliverables, scopePaths, validators, ...(testPlan ? { testPlan } : {}), planningRepo: normalizeOptionalString(frontData.planning_repo ?? frontData.planningRepo), targetRepo: normalizeOptionalString(frontData.target_repo ?? frontData.targetRepo ?? frontData.upstream_repo ?? frontData.upstreamRepo), closureAuthority: normalizeOptionalString(frontData.closure_authority ?? frontData.closureAuthority), planningReadOnlyPaths, planningMirrorPaths, planningArtifacts, outOfScope, nonGoals, evidenceRequired, rollbackStrategy, rollbackNotes, contextMap, atomizationImpact: { ownerAtomOrMap: normalizeOptionalString(frontData.ownerAtomOrMap ?? frontData.owner_atom_or_map ?? atomizationImpactFrontMatter.ownerAtomOrMap ?? atomizationImpactFrontMatter.owner_atom_or_map), atomCid: normalizeOptionalString(frontData.atomCid ?? frontData.atom_cid ?? atomizationImpactFrontMatter.atomCid ?? atomizationImpactFrontMatter.atom_cid), mapUpdates, ...(parseExtractionCandidates(atomizationImpactFrontMatter.extractionCandidates ?? atomizationImpactFrontMatter.extraction_candidates) ?? {}) }, ...(proposalAdmission ? { proposalAdmission } : {}), legacyImportAliases: { ...(frontData.allowed_files ? { allowed_files: parseYamlList(frontData.allowed_files) } : {}), ...(frontData.blocked_by ? { blocked_by: parseYamlList(frontData.blocked_by) } : {}), ...(frontData.upstream_repo ? { upstream_repo: normalizeOptionalString(frontData.upstream_repo) ?? '' } : {}) }, importDiagnostics: [], tags, notes, source: { planPath: parsed.sourcePath, sectionTitle: workItemId, headingLine: 1, hash: hashSection(body) }, importedAt }; }
function parseTaskProposalAdmission(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
} const record = value; const trigger = normalizeOptionalString(record.trigger); const normalizedTrigger = trigger === 'not-required' || trigger === 'hot-file' || trigger === 'same-file-overlap-risk' || trigger === 'shared-surface-risk' || trigger === 'manual-review-surface' ? trigger : null; if (!normalizedTrigger) {
    return undefined;
} const boundedRegions = parseProposalAdmissionBoundedRegions(record.boundedRegions); const hotFiles = parseYamlList(record.hotFiles ?? record.hot_files); const summarySubmitted = record.summarySubmitted === true || record.summary_submitted === true || String(record.summarySubmitted ?? record.summary_submitted ?? '').trim().toLowerCase() === 'true'; return { trigger: normalizedTrigger, summarySubmitted, ...(boundedRegions.length > 0 ? { boundedRegions } : {}), ...(hotFiles.length > 0 ? { hotFiles } : {}), ...(normalizeOptionalString(record.notes) ? { notes: normalizeOptionalString(record.notes) } : {}) }; }
function parseProposalAdmissionBoundedRegions(value) { const source = Array.isArray(value) ? value : Array.isArray(value?.boundedRegions) ? value.boundedRegions : Array.isArray(value?.bounded_regions) ? value.bounded_regions : null; if (!source) {
    return [];
} const output = []; for (const entry of source) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
    }
    const record = entry;
    const filePath = normalizeOptionalString(record.filePath)?.replace(/\\/g, '/');
    const lineStart = typeof record.lineStart === 'number' ? record.lineStart : Number.parseInt(String(record.lineStart ?? ''), 10);
    const lineEnd = typeof record.lineEnd === 'number' ? record.lineEnd : Number.parseInt(String(record.lineEnd ?? ''), 10);
    if (!filePath || !Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart <= 0 || lineEnd < lineStart) {
        continue;
    }
    output.push({ filePath, lineStart, lineEnd });
} return output; }
function formatRosterDepends(depends) { if (depends.length === 0)
    return 'none'; return depends.map((entry) => `\`${entry}\``).join(', '); }
function formatRosterMultiline(values) { if (values.length === 0)
    return ''; return values.join('<br>'); }
function extractTaskIdFromRosterCell(cell) { const linkMatch = /\[([A-Z][A-Z0-9-]+)\]/i.exec(cell); if (linkMatch)
    return normalizeTaskId(linkMatch[1]); const plainMatch = /(TASK|ATM)-[A-Z0-9]+-\d{4,5}/i.exec(cell); return plainMatch ? normalizeTaskId(plainMatch[0]) : null; }
function findRosterRowLocation(lines, taskId) { const normalizedTaskId = normalizeTaskId(taskId); for (let index = 0; index < lines.length - 1; index += 1) {
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
} return null; }
function buildRosterRowFromFrontmatter(input) { const existingCells = parseMarkdownTableCells(input.existingRow); const title = normalizeOptionalString(input.frontmatter.title) ?? input.taskId; const status = coerceStatus(typeof input.frontmatter.status === 'string' ? input.frontmatter.status : 'open'); const depends = parseYamlList(input.frontmatter.depends_on ?? input.frontmatter.blocked_by ?? input.frontmatter.dependencies); const scopePaths = parseYamlList(input.frontmatter.scopePaths ?? input.frontmatter.scope_paths ?? input.frontmatter.allowed_files); const validators = parseYamlList(input.frontmatter.validators); const cells = [...existingCells]; const setCell = (candidates, value) => { const index = findTableColumnIndex(input.headers, candidates); if (index >= 0) {
    cells[index] = value;
} }; const taskIdIndex = findTableColumnIndex(input.headers, ['task id', 'task', 'work item id', 'id']); if (taskIdIndex >= 0) {
    cells[taskIdIndex] = `[${input.taskId}](${input.taskFileRelativeLink})`;
} setCell(['title', 'name'], title); setCell(['status', 'state'], status); setCell(['depends', 'blocked by', 'depends on', 'dependencies'], formatRosterDepends(depends)); setCell(['target surface', 'scopepaths', 'scope paths', 'scope'], formatRosterMultiline(scopePaths)); setCell(['primary validators', 'validators'], formatRosterMultiline(validators)); return `| ${cells.join(' | ')} |`; }
export async function runTasksRosterUpdate(argv) { let cwd = process.cwd(); let indexPath = ''; let fromPath = ''; let dryRun = false; for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--cwd' || arg === '--repo') && argv[index + 1]) {
        cwd = path.resolve(argv[++index]);
    }
    else if (arg === '--index' && argv[index + 1]) {
        indexPath = argv[++index];
    }
    else if (arg === '--from' && argv[index + 1]) {
        fromPath = argv[++index];
    }
    else if (arg === '--dry-run') {
        dryRun = true;
    }
    else if (arg === '--help' || arg === '-h') {
        throw new CliError('ATM_CLI_USAGE', 'tasks roster update requires --index <readme-path> --from <task-file> [--dry-run] --json', { exitCode: 2 });
    }
} if (!indexPath || !fromPath) {
    throw new CliError('ATM_CLI_USAGE', 'tasks roster update requires --index <readme-path> --from <task-file>.', { exitCode: 2 });
} const indexAbsolute = path.resolve(cwd, indexPath); const fromAbsolute = path.resolve(cwd, fromPath); if (!existsSync(indexAbsolute)) {
    throw new CliError('ATM_TASK_ROSTER_INDEX_NOT_FOUND', `Roster index not found: ${indexPath}`, { exitCode: 2 });
} if (!existsSync(fromAbsolute)) {
    throw new CliError('ATM_TASK_ROSTER_SOURCE_NOT_FOUND', `Task file not found: ${fromPath}`, { exitCode: 2 });
} const taskText = readFileSync(fromAbsolute, 'utf8'); const frontMatter = extractFrontMatter(taskText); const rawTaskId = typeof frontMatter?.data.task_id === 'string' ? frontMatter.data.task_id : typeof frontMatter?.data.id === 'string' ? frontMatter.data.id : null; if (!frontMatter || !rawTaskId) {
    throw new CliError('ATM_TASK_ROSTER_SOURCE_INVALID', `Task file ${fromPath} is missing task_id frontmatter.`, { exitCode: 2 });
} const taskId = normalizeTaskId(rawTaskId); const original = readFileSync(indexAbsolute, 'utf8'); const originalHash = createHash('sha256').update(original).digest('hex'); const lines = original.split(/\r?\n/); const location = findRosterRowLocation(lines, taskId); if (!location) {
    return makeResult({ ok: false, command: 'tasks roster update', cwd, messages: [message('error', 'ATM_TASK_ROSTER_ROW_NOT_FOUND', `Task id ${taskId} was not found in roster index ${indexPath}.`)], evidence: { taskId, indexPath, fromPath, dryRun } });
} const taskFileRelativeLink = path.relative(path.dirname(indexAbsolute), fromAbsolute).replace(/\\/g, '/'); const existingRow = lines[location.rowLineIndex]; const updatedRow = buildRosterRowFromFrontmatter({ taskId, frontmatter: frontMatter.data, existingRow, headers: location.headers, taskFileRelativeLink: taskFileRelativeLink.startsWith('.') ? taskFileRelativeLink : `./${taskFileRelativeLink}` }); const updatedLines = [...lines]; updatedLines[location.rowLineIndex] = updatedRow; const updated = updatedLines.join('\n'); if (dryRun) {
    const afterHash = createHash('sha256').update(updated).digest('hex');
    return makeResult({ ok: true, command: 'tasks roster update', cwd, mode: 'dry-run', messages: [message('info', 'ATM_TASK_ROSTER_UPDATE_DRY_RUN', `Roster row diff prepared for ${taskId}.`)], evidence: { taskId, indexPath, fromPath, dryRun: true, beforeHash: `sha256:${originalHash}`, afterHash: `sha256:${afterHash}`, unchanged: existingRow === updatedRow, diff: { before: existingRow, after: updatedRow } } });
} writeFileSync(indexAbsolute, updated, 'utf8'); return makeResult({ ok: true, command: 'tasks roster update', cwd, mode: 'write', messages: [message('info', 'ATM_TASK_ROSTER_UPDATE_WRITTEN', `Roster row updated for ${taskId} in ${indexPath}.`)], evidence: { taskId, indexPath, fromPath, dryRun: false, beforeHash: `sha256:${originalHash}`, afterHash: `sha256:${createHash('sha256').update(updated).digest('hex')}`, diff: { before: existingRow, after: updatedRow } } }); }
async function runTasksRoster(argv) { const subAction = (argv[0] ?? '').toLowerCase(); if (subAction !== 'update') {
    throw new CliError('ATM_CLI_USAGE', 'tasks roster requires update.', { exitCode: 2 });
} return runTasksRosterUpdate(argv.slice(1)); }
export async function generateTaskCard(input) { const template = input.templateKey || 'aao-l2-split'; const intent = { cwd: input.cwd, templateKey: template, fields: { task_id: input.taskId, title: input.title || 'New Task', depends_on_yaml: input.dependsOn?.trim() ? ` - ${input.dependsOn.trim()}` : '[]', scope_path: input.scopePath || 'src/main.ts', test_path: input.testPath || 'tests/main.test.ts', atom_id: input.atomId || 'atm.unowned', capability: input.capability || 'Implementation details', goal: input.goal || 'Goal description placeholder', sourcePath: input.outputPath } }; const plugins = await readPluginRegistry(input.cwd); const generatorPlugin = plugins.find(p => p.mode !== 'disabled' && typeof p.plugin.generate === 'function'); const resultCard = generatorPlugin ? await generatorPlugin.plugin.generate(intent) : await (await import('../../../../../atm-markdown-task-source/dist/index.js')).default.generate(intent); return { taskId: resultCard.taskId, content: resultCard.content, sourcePath: input.outputPath, templateUsed: template }; }
function assertTaskCardOutputPathIsNested(cwd, outputPath) { const absoluteCwd = path.resolve(cwd); const absoluteOutput = path.resolve(absoluteCwd, outputPath); const relativeOutput = path.relative(absoluteCwd, absoluteOutput).replace(/\\/g, '/'); if (relativeOutput === '..' || relativeOutput.startsWith('../')) {
    throw new CliError('ATM_CLI_USAGE', 'tasks new must write task cards inside the repository; use docs/tasks/<name>.task.md or another nested task directory.', { exitCode: 2, details: { outputPath } });
} if (path.posix.dirname(relativeOutput) === '.' && relativeOutput.endsWith('.task.md')) {
    throw new CliError('ATM_CLI_USAGE', 'tasks new must not write task cards at the repository root; use docs/tasks/<name>.task.md or another nested task directory.', { exitCode: 2, details: { outputPath } });
} }
async function runTasksNew(argv) { const spec = (await import('../../command-specs/tasks.spec.js')).default; const parsed = parseArgsForCommand(spec, ['new', ...argv]); const options = parsed.options; const cwd = options.cwd || process.cwd(); const template = options.template || 'aao-l2-split'; const taskId = options.taskId || options.task || 'TASK-UNKNOWN-0000'; const title = options.title || 'New Task'; const outPath = options.output; if (!outPath) {
    throw new CliError('ATM_CLI_USAGE', 'tasks new requires --output <path>', { exitCode: 2 });
} assertTaskCardOutputPathIsNested(cwd, outPath); const resultCard = await generateTaskCard({ cwd, templateKey: template, taskId, title, outputPath: outPath, dependsOn: options.dependsOn, scopePath: options.scopePath, testPath: options.testPath, atomId: options.atomId, capability: options.capability, goal: options.goal }); const targetAbsolute = path.resolve(cwd, outPath); const targetDir = path.dirname(targetAbsolute); mkdirSync(targetDir, { recursive: true }); writeFileSync(targetAbsolute, resultCard.content, 'utf8'); return makeResult({ ok: true, command: 'tasks', cwd, messages: [message('info', 'ATM_TASKS_NEW_GENERATED', `Generated new task card template at ${outPath}`)], evidence: { ok: true, sourcePath: outPath, taskId: resultCard.taskId, templateUsed: template, generatorSurface: 'tasks-new' } }); }
export { parseReconcileOptions, parseDeliverAndCloseOptions, parseCreateOptions, parseMirrorOptions, parseCloseOptions, parseStatusOptions, parseFinalizeDiagnoseOptions, parseResetOptions, parseLockCleanupOptions, parseClaimLifecycleOptions, parseHistoricalDeliveryRefs, parseScopeAddOptions, parseScopeRepairOptions, parseQueueOptions, parseAuditOptions, parseLegacyLedgerMigrationOptions, parseAllowStaleRunnerFlag } from '../task-option-parsers.js';
export { safeTaskFileReadDir, safeTaskFileStat, readJsonRecord, taskPathFor, collectTaskFileValues, normalizeRelativePath, legacyTaskRequiresBaseline };
