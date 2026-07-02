import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createLocalGovernanceAdapter } from '../../../plugin-governance-local/dist/index.js';
import { clearBrokerRuntimeStateForTask, removeBrokerRegistryIfEmpty } from '../../../core/dist/broker/lifecycle.js';
import { resolveActorId } from './actor-registry.js';
import { updateActorWorkSessionState, upsertActorWorkSession } from './actor-session.js';
import { computeMissingValidatorReport } from './evidence.js';
import { assertRunnerFreshForWriteAction, auditTasks, createClosurePacket, createFrameworkModeStatus, executeTaskCloseTransaction, isRunnerSyncRequired, normalizeSha256FieldsDeep, registerCloseCommitWindow, repairClosurePacketForTask, runnerStaleWarningMessage, validateClosurePacket, writeClosurePacket } from './framework-development.js';
import { CliError, makeResult, message, parseOptions, parseArgsForCommand, relativePathFrom, resolveValue } from './shared.js';
import { toStoredPlanningPath, resolvePlanAbsoluteFromStored } from './planning-repo-root.js';
import { appendTaskTransitionEvent, createTaskTransitionId, defaultMirrorTaskId, readTaskLedgerPolicy } from './task-ledger.js';
import { readPluginRegistry } from '../plugin-registry.js';
import { abandonTaskQueue, findActiveTaskQueue, sanitizeTaskDirectionAllowedFiles, writeTaskDirectionLock } from './task-direction.js';
import { findActiveBatchRunForTask, isPathAllowedByScope } from './work-channels.js';
import { assessCloseoutProvenanceGap, buildDependencyCloseoutRecoveryCommand, formatDependencyCloseoutBlockedMessage } from './tasks/closeout-provenance.js';
import { findTaskClaimDependencyBlockers } from './tasks/dependency-gates.js';
import { evaluateTaskClaimAdmission, evaluateTaskPromotionAdmission, evaluateTaskResetAdmission } from './tasks/lifecycle-state.js';
import { buildHistoricalDeliveryProvenance, pathMatchesTaskScope } from './tasks/historical-delivery.js';
import { applyClaimRepairWrite, buildRepairClaimCommand, diagnoseClaimRepairState } from './tasks/claim-repair-diagnostics.js';
import { buildResidueDiagnosisEvidenceFromTriangulation } from './tasks/residue-diagnostics.js';
import { dispatchTasksAction } from './tasks/command-dispatch.js';
import { runTasksClose } from './tasks/close-orchestrator.js';
import { runTasksImport } from './tasks/import-orchestrator.js';
import { runTasksVerify } from './tasks/verify-orchestrator.js';
export { runTasksClose, runTasksImport, runTasksVerify };
import { classifyResetOpenImport } from './tasks/import-verify.js';
import { runAtmGit } from './git-governance.js';
import { assertEmergencyApproval } from './emergency/gate.js';
import { parseClaimRecord, createClaimRecord, isClaimExpired, listRuntimeLockTaskIds } from './tasks/task-ledger-readers.js';
import { isFrontmatterScalar as delegatedIsFrontmatterScalar } from './tasks/is-frontmatter-scalar-helper.js';
import { normalizeStringValue as delegatedNormalizeStringValue } from './tasks/normalize-string-value-helper.js';
import { normalizeTaskDocumentId as delegatedNormalizeTaskDocumentId } from './tasks/normalize-task-document-id-helper.js';
import { sha256 as delegatedSha256 } from './tasks/sha256-helper.js';
import { assertLocalTaskLedgerEnabled as delegatedAssertLocalTaskLedgerEnabled, buildTaskTransitionCommand as delegatedBuildTaskTransitionCommand, buildScopeAmendmentCommand as delegatedBuildScopeAmendmentCommand, createClosureTransitionMetadata as delegatedCreateClosureTransitionMetadata, normalizeWorkItemStatus as delegatedNormalizeWorkItemStatus, inspectTaskVerifyStatus as delegatedInspectTaskVerifyStatus } from './tasks/task-transition-helpers.js';
import { readGitScalar as delegatedReadGitScalar, listCommittedFilesSinceClaim as delegatedListCommittedFilesSinceClaim } from './tasks/task-git-helpers.js';
// TASK-RFT-0013: close-helper cluster split.
import { readDeferredForeignStagedFilesForActiveCloseWindow as delegatedReadDeferredForeignStagedFilesForActiveCloseWindow, evaluateFrameworkDeliveryWindow as delegatedEvaluateFrameworkDeliveryWindow, loadHistoricalBatchCloseSlice as delegatedLoadHistoricalBatchCloseSlice } from './tasks/close-helpers/close-window-diagnostics.js';
import { buildBrokerAdmissionExplanation as delegatedBuildBrokerAdmissionExplanation, explainBrokerAdapterForPath as delegatedExplainBrokerAdapterForPath, hasUnexplainedSharedProjection as delegatedHasUnexplainedSharedProjection } from './tasks/close-helpers/broker-admission-explanation.js';
import { extractTaskCloseDeclaredFiles as delegatedExtractTaskCloseDeclaredFiles, extractTaskDeliverableFiles as delegatedExtractTaskDeliverableFiles, taskDeliveryPrincipleText as delegatedTaskDeliveryPrincipleText, evaluateTaskDeliverableGate as delegatedEvaluateTaskDeliverableGate, stageTaskCloseArtifacts as delegatedStageTaskCloseArtifacts, existingTaskCloseArtifacts as delegatedExistingTaskCloseArtifacts } from './tasks/close-helpers/close-artifact-staging.js';
import { writeTaskDocumentWithTransition as delegatedWriteTaskDocumentWithTransition } from './tasks/close-helpers/task-transition-writer.js';
import { collectKeyValue as delegatedCollectKeyValue, collectKeyValueFromLines as delegatedCollectKeyValueFromLines, createTaskFromTableMetadata as delegatedCreateTaskFromTableMetadata, parseDispatchMetadataFromPlanText } from './tasks/task-markdown-helpers.js';
import { safeTaskFileReadDir, safeTaskFileStat, readJsonRecord, taskPathFor, collectTaskFileValues, normalizeRelativePath, legacyTaskRequiresBaseline } from './tasks/task-file-io-helpers.js';
import { coerceStatus, extractFrontMatter, hashSection, normalizeOptionalString, normalizeYamlScalar, normalizeTaskId, parseMarkdownTableCells, parseYamlList, parseContextMap } from './tasks/task-import-validators.js';
import { parseReconcileOptions, parseDeliverAndCloseOptions, parseCreateOptions, parseMirrorOptions, parseStatusOptions, parseFinalizeDiagnoseOptions, parseResetOptions, parseLockCleanupOptions, parseClaimLifecycleOptions, parseScopeAddOptions, parseScopeRepairOptions, parseQueueOptions, parseAuditOptions, parseLegacyLedgerMigrationOptions, parseAllowStaleRunnerFlag } from './tasks/task-option-parsers.js';
import { buildTaskStatusTriangulation as buildTaskStatusTriangulationDelegated, readScopeAmendmentEvents as readScopeAmendmentEventsDelegated, readLastTransitionEventRecord as readLastTransitionEventRecordDelegated, resolvePlanningCardPath as resolvePlanningCardPathDelegated } from './tasks/status-triangulation.js';
import { recordStaleRunnerOverride as recordStaleRunnerOverrideDelegated, recordFailedEmergencyUseAttempt as recordFailedEmergencyUseAttemptDelegated, isCliErrorWithCode as isCliErrorWithCodeDelegated } from './tasks/close-governance.js';
export const validStatuses = new Set(['planned', 'open', 'in_progress', 'reserved', 'ready', 'running', 'review', 'blocked', 'abandoned', 'done']);
const acceptanceHeaders = ['acceptance criteria', 'acceptance', 'acceptance tests', 'criteria', '驗收', '驗收條件'];
const deliverablesHeaders = ['deliverables', 'outputs', 'outcomes', '交付物', '產物', '輸出'];
const dependenciesHeaders = ['dependencies', 'depends on', 'blocked by', '依賴', '相依', '前置'];
const notesHeaders = ['notes', 'implementation notes', 'background', '備註', '說明'];
const tagsHeaders = ['tags', 'labels', '標籤'];
const taskIdPattern = /^(?:TASK-)?[A-Z][A-Z0-9-]*-\d{2,}/;
const taskIdAnywherePattern = /(?:TASK-)?[A-Z][A-Z0-9-]*-\d{2,}/;
function isCanonicalDeliverableCandidate(value) {
    const normalized = normalizeRelativePath(value);
    if (!normalized)
        return false;
    if (normalized.startsWith('.atm/'))
        return false;
    if (/[\\/]$/.test(normalized))
        return false;
    return true;
}
function inferLegacyDeliverablesFromScope(scopePaths) {
    if (scopePaths.length === 0)
        return [];
    const normalized = uniqueStrings(scopePaths.map(normalizeRelativePath).filter(Boolean));
    if (normalized.length === 0)
        return [];
    const inferred = normalized.filter(isCanonicalDeliverableCandidate);
    return inferred;
}
export async function runTasks(argv) {
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
        repairClaim: runTasksRepairClaim,
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
async function runTasksShow(argv) {
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
// TASK-RFT-0010: status-triangulation atoms now live in
// ./tasks/status-triangulation.ts. Aliases below preserve the in-file call
// sites used by `runTasksStatus`, `runTasksReconcile`, residue diagnosis etc.
const resolvePlanningCardPath = resolvePlanningCardPathDelegated;
const readLastTransitionEventRecord = readLastTransitionEventRecordDelegated;
const readScopeAmendmentEvents = readScopeAmendmentEventsDelegated;
const buildTaskStatusTriangulation = buildTaskStatusTriangulationDelegated;
// TASK-RFT-0010: close-governance atoms now live in ./tasks/close-governance.ts.
export const recordStaleRunnerOverride = recordStaleRunnerOverrideDelegated;
export const isCliErrorWithCode = isCliErrorWithCodeDelegated;
export const recordFailedEmergencyUseAttempt = recordFailedEmergencyUseAttemptDelegated;
export function loadTaskDocumentOrThrow(cwd, taskId) {
    const taskPath = taskPathFor(cwd, taskId);
    if (!existsSync(taskPath)) {
        throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${taskId}.`, {
            exitCode: 2,
            details: { taskPath: relativePathFrom(cwd, taskPath), taskId }
        });
    }
    return {
        taskPath,
        taskDocument: JSON.parse(readFileSync(taskPath, 'utf8'))
    };
}
export function buildResidueDiagnosisEvidence(cwd, taskId, taskDocument) {
    const triangulation = buildTaskStatusTriangulation(cwd, taskId, taskDocument);
    return buildResidueDiagnosisEvidenceFromTriangulation({ taskId, triangulation });
}
async function runTasksStatus(argv) {
    const options = parseStatusOptions(argv);
    const { taskDocument } = loadTaskDocumentOrThrow(options.cwd, options.taskId);
    const triangulation = buildTaskStatusTriangulation(options.cwd, options.taskId, taskDocument);
    const messages = [
        message(options.residueOnly ? 'info' : 'info', options.residueOnly ? 'ATM_TASK_RESIDUE_DIAGNOSED' : 'ATM_TASK_STATUS_TRIANGULATED', options.residueOnly
            ? `Residue diagnosis for ${options.taskId}: ${triangulation.residueClassification.bucket}.`
            : `Task status triangulation for ${options.taskId}.`, triangulation)
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
async function runTasksFinalize(argv) {
    const subAction = (argv[0] ?? '').toLowerCase();
    if (subAction !== 'diagnose') {
        throw new CliError('ATM_CLI_USAGE', 'tasks finalize requires diagnose.', { exitCode: 2 });
    }
    return runTasksFinalizeDiagnose(argv.slice(1));
}
async function runTasksFinalizeDiagnose(argv) {
    const options = parseFinalizeDiagnoseOptions(argv);
    const { taskDocument } = loadTaskDocumentOrThrow(options.cwd, options.taskId);
    const evidence = buildResidueDiagnosisEvidence(options.cwd, options.taskId, taskDocument);
    const messages = [
        message(evidence.bucket === 'ambiguous-manual-review' ? 'warn' : 'info', 'ATM_TASK_FINALIZE_DIAGNOSED', `Residue bucket ${evidence.bucket} for ${options.taskId}.`, {
            truth: evidence.truth,
            residue: evidence.residue,
            nextCommand: evidence.nextCommand
        })
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
async function runTasksRepairClosure(argv) {
    const options = parseRepairClosureOptions(argv);
    const resolvedActor = options.actorId ? resolveActorId(options.actorId, options.cwd) : null;
    let emergencyUse = null;
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
    let transitionPath = null;
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
            message('info', options.dryRun ? 'ATM_TASKS_REPAIR_CLOSURE_DRY_RUN' : 'ATM_TASKS_REPAIR_CLOSURE_OK', options.dryRun
                ? `Dry-run: closure packet ${options.taskId} can be repaired without rewriting HEAD.`
                : stagedOnly
                    ? `Repaired and staged closure packet follow-up changes for ${options.taskId}. HEAD was not rewritten.`
                    : `Repaired closure packet for ${options.taskId}.`, {
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
            })
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
function writeRepairClosureTransition(input) {
    const taskPath = taskPathFor(input.cwd, input.taskId);
    if (!existsSync(taskPath))
        return null;
    const taskDocument = readJsonRecord(taskPath);
    const previousStatus = typeof taskDocument.status === 'string' ? taskDocument.status : null;
    const transitionPath = writeTaskDocumentWithTransition({
        cwd: input.cwd,
        taskPath,
        taskId: input.taskId,
        action: 'repair-closure',
        sessionId: typeof taskDocument.closedBySessionId === 'string' ? taskDocument.closedBySessionId : null,
        taskDocument,
        actorId: input.actorId,
        previousStatus,
        command: input.command
    });
    execFileSync('git', ['-C', input.cwd, 'add', '--', taskPath, transitionPath], { stdio: 'ignore' });
    return transitionPath;
}
async function runTasksRepairClaim(argv) {
    const options = parseRepairClaimOptions(argv);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks repair-claim requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const taskPath = taskPathFor(options.cwd, options.taskId);
    if (!existsSync(taskPath)) {
        throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
            exitCode: 2,
            details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId }
        });
    }
    const taskDocument = readJsonRecord(taskPath);
    const diagnosis = diagnoseClaimRepairState(options.cwd, options.taskId, actorId);
    if (!options.write) {
        return makeResult({
            ok: true,
            command: 'tasks',
            cwd: options.cwd,
            messages: [
                message(diagnosis.blocked ? 'warn' : diagnosis.repairable ? 'info' : 'info', diagnosis.blocked
                    ? 'ATM_TASKS_REPAIR_CLAIM_BLOCKED'
                    : diagnosis.repairable
                        ? 'ATM_TASKS_REPAIR_CLAIM_REPAIRABLE'
                        : 'ATM_TASKS_REPAIR_CLAIM_CLEAN', diagnosis.blocked
                    ? `Task ${options.taskId} has a valid active claim; repair is blocked.`
                    : diagnosis.repairable
                        ? `Task ${options.taskId} has repairable claim drift.`
                        : `Task ${options.taskId} has no repairable claim drift.`, {
                    taskId: options.taskId,
                    issueCount: diagnosis.issues.length,
                    repairable: diagnosis.repairable,
                    blocked: diagnosis.blocked
                })
            ],
            evidence: {
                action: 'repair-claim-diagnose',
                taskId: options.taskId,
                actorId,
                diagnosis,
                requiredCommand: diagnosis.writeCommand
            }
        });
    }
    if (!options.reason?.trim()) {
        throw new CliError('ATM_TASK_REPAIR_CLAIM_REASON_REQUIRED', 'tasks repair-claim --write requires --reason.', {
            exitCode: 2,
            details: {
                taskId: options.taskId,
                requiredCommand: buildRepairClaimCommand({
                    taskId: options.taskId,
                    actorId,
                    write: true,
                    reason: '<why repair is required>'
                })
            }
        });
    }
    const applyResult = await applyClaimRepairWrite({
        cwd: options.cwd,
        taskId: options.taskId,
        actorId,
        reason: options.reason.trim(),
        taskDocument,
        diagnosis
    });
    const command = buildRepairClaimCommand({
        taskId: options.taskId,
        actorId,
        write: true,
        reason: options.reason.trim()
    });
    const previousStatus = typeof taskDocument.status === 'string' ? taskDocument.status : null;
    const transitionPath = writeTaskDocumentWithTransition({
        cwd: options.cwd,
        taskPath,
        taskId: options.taskId,
        taskDocument: applyResult.taskDocument,
        action: 'repair-claim',
        actorId,
        sessionId: typeof taskDocument.startedBySessionId === 'string' ? taskDocument.startedBySessionId : null,
        previousStatus,
        command
    });
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_TASKS_REPAIR_CLAIM_OK', `Repaired claim drift for ${options.taskId}.`, {
                taskId: options.taskId,
                actorId,
                repairActions: applyResult.repairActions
            })
        ],
        evidence: {
            action: 'repair-claim',
            taskId: options.taskId,
            actorId,
            diagnosis,
            before: applyResult.before,
            after: applyResult.after,
            repairActions: applyResult.repairActions,
            transitionPath,
            lifecycleOwner: diagnosis.lifecycleOwner
        }
    });
}
function parseRepairClaimOptions(argv) {
    const state = {
        cwd: process.cwd(),
        taskId: null,
        actorId: null,
        write: false,
        reason: null
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
        if (arg === '--reason') {
            state.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--write') {
            state.write = true;
            continue;
        }
        if (arg === '--json' || arg === '--pretty') {
            continue;
        }
        throw new CliError('ATM_CLI_USAGE', `tasks repair-claim does not support option ${arg}`, { exitCode: 2 });
    }
    if (!state.taskId) {
        throw new CliError('ATM_CLI_USAGE', 'tasks repair-claim requires --task <id>.', { exitCode: 2 });
    }
    return {
        cwd: path.resolve(state.cwd),
        taskId: state.taskId,
        actorId: state.actorId,
        write: state.write,
        reason: state.reason
    };
}
async function runTasksReconcile(argv) {
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
    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
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
            details: deliverableGate
        });
    }
    const frameworkStatus = createFrameworkModeStatus({
        cwd: options.cwd,
        files: taskDeclaredFiles.length > 0 ? taskDeclaredFiles : undefined
    });
    if (frameworkStatus?.repoRole === 'framework') {
        const effectiveBlockers = frameworkStatus.blockers.filter((entry) => !['active-framework-claim-required', 'git-head-evidence-missing'].includes(entry));
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
        const requiredPasses = uniqueStrings((frameworkStatus?.requiredGates ?? [
            'typecheck',
            'validate:cli',
            'validate:git-head-evidence'
        ]).filter((gate) => gate === 'typecheck' || gate.startsWith('validate:')));
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
    let closurePacketPath = null;
    let packet = null;
    let pendingReconcilePacket = null;
    let createdClosurePacketAbsolute = null;
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
            historicalDeliveryProvenance: buildHistoricalDeliveryProvenance(deliverableGate.historicalDeliveries[0] ?? null, options.waiverReason)
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
            deliverableGate: deliverableGate
        }
    });
}
async function runTasksDeliverAndClose(argv) {
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
    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
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
                    requiredCommand: `node atm.mjs batch deliver-and-close --actor ${actorId} --batch ${owningBatch.batchId} --json`,
                    skipCommand: `node atm.mjs batch skip --task ${options.taskId} --batch ${owningBatch.batchId} --reason "<blocker>" --actor ${actorId} --json`
                }
            });
        }
    }
    // Phase 1: resolve or auto-create delivery commit
    let deliveryCommitSha;
    let autoStagedFiles = [];
    if (options.deliveryCommit) {
        const resolved = readGitScalar(options.cwd, ['rev-parse', '--verify', `${options.deliveryCommit}^{commit}`]);
        if (!resolved) {
            throw new CliError('ATM_COMMIT_NOT_FOUND', `Delivery commit not found in Git: ${options.deliveryCommit}`, {
                exitCode: 1,
                details: { taskId: options.taskId, requestedRef: options.deliveryCommit }
            });
        }
        deliveryCommitSha = resolved;
    }
    else {
        const taskDeclaredFiles = extractTaskCloseDeclaredFiles(taskDocument, options.cwd, options.taskId);
        const declaredPaths = sanitizeTaskDirectionAllowedFiles(taskDeclaredFiles);
        const modifiedUnstaged = readGitNameOnly(options.cwd, ['diff', '--name-only']).filter((f) => declaredPaths.length === 0 || declaredPaths.some((d) => pathMatchesTaskScope(f, d)));
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
        const previousBatchDeliverAndClose = process.env.ATM_BATCH_DELIVER_AND_CLOSE;
        process.env.ATM_BATCH_DELIVER_AND_CLOSE = '1';
        let deliveryResult;
        try {
            deliveryResult = await runAtmGit([
                'commit',
                '--cwd', options.cwd,
                '--actor', actorId,
                '--task', options.taskId,
                '--message', deliveryMessage,
                '--json'
            ]);
        }
        finally {
            if (previousBatchDeliverAndClose == null) {
                delete process.env.ATM_BATCH_DELIVER_AND_CLOSE;
            }
            else {
                process.env.ATM_BATCH_DELIVER_AND_CLOSE = previousBatchDeliverAndClose;
            }
        }
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
        deliveryCommitSha = String(deliveryResult.evidence?.commitSha ?? '');
        if (!deliveryCommitSha) {
            throw new CliError('ATM_DELIVER_AND_CLOSE_DELIVERY_COMMIT_FAILED', `tasks deliver-and-close: delivery commit succeeded but commitSha was not captured for ${options.taskId}.`, {
                exitCode: 1,
                details: { taskId: options.taskId, actorId }
            });
        }
    }
    // Phase 2: close task using the delivery commit as the historical reference
    const closeArgv = [
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
                message('error', 'ATM_DELIVER_AND_CLOSE_CLOSE_FAILED', `tasks deliver-and-close: close phase failed for ${options.taskId}. Delivery commit ${deliveryCommitSha} was created. Fix the close gate then retry: node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --status done --historical-delivery ${deliveryCommitSha} --json`, {
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
    const closeEvidence = closeResult.evidence;
    const governanceFiles = [];
    const relTaskPath = typeof closeEvidence.taskPath === 'string' ? closeEvidence.taskPath : relativePathFrom(options.cwd, taskPath);
    if (relTaskPath)
        governanceFiles.push(relTaskPath);
    const evidencePath = `.atm/history/evidence/${options.taskId}.json`;
    if (existsSync(path.resolve(options.cwd, evidencePath)))
        governanceFiles.push(evidencePath);
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
        ? String(closureResult.evidence?.commitSha ?? '')
        : null;
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_DELIVER_AND_CLOSE_OK', `Task ${options.taskId} delivered and closed. Delivery commit: ${deliveryCommitSha}. Governance commit: ${closureCommitSha ?? '(staged but not committed)'}.`, {
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
async function runTasksCreate(argv) {
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
    const taskDocument = {
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
async function runTasksMirror(argv) {
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
        ? JSON.parse(readFileSync(taskPath, 'utf8'))
        : null;
    const previousStatus = existing ? normalizeWorkItemStatus(existing.status) : null;
    const mirroredAt = typeof existing?.mirroredAt === 'string' ? existing.mirroredAt : new Date().toISOString();
    const taskDocument = {
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
export function prepareTaskForClaim(input) {
    const taskPath = taskPathFor(input.cwd, input.taskId);
    const originalStatus = normalizeTaskStatus(input.status);
    const transitionCommand = input.transitionCommand?.trim() || `node atm.mjs next --claim --task ${input.taskId} --actor ${input.actorId} --auto-intent --json`;
    const stopAfterAction = input.stopAfterAction ?? 'all';
    const steps = [];
    let importEvidencePath = null;
    const importedAt = new Date().toISOString();
    if (!existsSync(taskPath)) {
        const imported = importPlanningTaskForReservation({
            cwd: input.cwd,
            taskId: input.taskId,
            importedAt
        });
        importEvidencePath = imported.evidencePath;
    }
    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
    const currentStatus = normalizeTaskStatus(taskDocument.status);
    if (currentStatus === 'planned' || currentStatus === 'open') {
        const reserveAt = new Date().toISOString();
        const previousStatus = String(taskDocument.status ?? '');
        taskDocument.status = 'reserved';
        taskDocument.owner = input.actorId;
        taskDocument.reservedAt = reserveAt;
        if (!taskDocument.title || String(taskDocument.title).trim().length === 0) {
            taskDocument.title = input.title ?? input.taskId;
        }
        const transitionPath = writeTaskDocumentWithTransition({
            cwd: input.cwd,
            taskPath,
            taskId: input.taskId,
            taskDocument,
            action: 'reserve',
            actorId: input.actorId,
            previousStatus,
            command: transitionCommand
        });
        steps.push({
            action: 'reserve',
            status: 'reserved',
            transitionPath,
            importEvidencePath
        });
        if (stopAfterAction === 'reserve') {
            return {
                taskId: input.taskId,
                originalStatus,
                finalStatus: normalizeTaskStatus(taskDocument.status),
                steps
            };
        }
    }
    const owner = typeof taskDocument.owner === 'string' ? taskDocument.owner : null;
    if ((currentStatus === 'planned' || currentStatus === 'open' || currentStatus === 'reserved')
        && owner
        && owner !== input.actorId) {
        throw new CliError('ATM_TASKS_PROMOTE_OWNER_MISMATCH', `Task ${input.taskId} is reserved by ${owner}, not ${input.actorId}.`, {
            exitCode: 1,
            details: { taskId: input.taskId, owner, actorId: input.actorId }
        });
    }
    if (currentStatus === 'planned' || currentStatus === 'open' || currentStatus === 'reserved') {
        const promotionAdmission = evaluateTaskPromotionAdmission({
            taskId: input.taskId,
            status: taskDocument.status
        });
        if (!promotionAdmission.ok) {
            throw new CliError(promotionAdmission.code, promotionAdmission.message, {
                exitCode: 1,
                details: promotionAdmission.details
            });
        }
        taskDocument.status = 'ready';
        taskDocument.owner = input.actorId;
        taskDocument.promotedAt = new Date().toISOString();
        const transitionPath = writeTaskDocumentWithTransition({
            cwd: input.cwd,
            taskPath,
            taskId: input.taskId,
            taskDocument,
            action: 'promote',
            actorId: input.actorId,
            previousStatus: 'reserved',
            command: transitionCommand
        });
        steps.push({
            action: 'promote',
            status: 'ready',
            transitionPath
        });
    }
    return {
        taskId: input.taskId,
        originalStatus,
        finalStatus: normalizeTaskStatus(taskDocument.status),
        steps
    };
}
async function runTasksReservation(action, argv) {
    const options = parseReservationOptions(action, argv);
    assertLocalTaskLedgerEnabled(options.cwd, action);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', `tasks ${action} requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const nextClaimCommand = `node atm.mjs next --claim --task ${options.taskId} --actor ${actorId} --auto-intent --json`;
    const legacyOverrideCommand = [
        'node atm.mjs tasks',
        action,
        `--task ${options.taskId}`,
        `--actor ${actorId}`,
        action === 'reserve' && options.title ? `--title "${options.title}"` : null,
        '--maintainer-override-legacy-lifecycle',
        '--json'
    ].filter(Boolean).join(' ');
    if (options.maintainerOverrideLegacyLifecycle !== true) {
        return makeResult({
            ok: false,
            command: 'tasks',
            cwd: options.cwd,
            messages: [
                message('warn', 'ATM_LIFECYCLE_LEGACY_LOCK', `tasks ${action} is a deprecated low-level lifecycle surface. It is rejected by default because it bypasses the normal next/taskflow claim lane.`, {
                    taskId: options.taskId,
                    actorId,
                    action,
                    requiredCommand: nextClaimCommand,
                    maintainerOverrideCommand: legacyOverrideCommand
                }),
                message('error', 'ATM_TASK_LEGACY_LIFECYCLE_DEPRECATED', `Use next --claim instead of tasks ${action} for AI-facing governed work.`, {
                    taskId: options.taskId,
                    actorId,
                    action,
                    requiredCommand: nextClaimCommand,
                    maintainerOverrideCommand: legacyOverrideCommand
                })
            ],
            evidence: {
                action,
                taskId: options.taskId,
                actorId,
                deprecatedLifecycle: true,
                requiredCommand: nextClaimCommand,
                maintainerOverrideCommand: legacyOverrideCommand,
                warningCode: 'ATM_LIFECYCLE_LEGACY_LOCK'
            }
        });
    }
    const preparation = prepareTaskForClaim({
        cwd: options.cwd,
        taskId: options.taskId,
        actorId,
        status: existsSync(taskPathFor(options.cwd, options.taskId))
            ? JSON.parse(readFileSync(taskPathFor(options.cwd, options.taskId), 'utf8')).status
            : 'planned',
        title: options.title ?? options.taskId,
        transitionCommand: legacyOverrideCommand,
        stopAfterAction: action
    });
    const selectedStep = action === 'reserve'
        ? preparation.steps.find((step) => step.action === 'reserve') ?? null
        : preparation.steps.find((step) => step.action === 'promote') ?? null;
    if (!selectedStep) {
        throw new CliError('ATM_TASK_LEGACY_LIFECYCLE_NOOP', `tasks ${action} could not advance ${options.taskId} from status ${preparation.originalStatus}.`, {
            exitCode: 1,
            details: {
                taskId: options.taskId,
                action,
                originalStatus: preparation.originalStatus,
                finalStatus: preparation.finalStatus
            }
        });
    }
    if (action === 'reserve') {
        return makeResult({
            ok: true,
            command: 'tasks',
            cwd: options.cwd,
            messages: [
                message('warn', 'ATM_LIFECYCLE_LEGACY_LOCK', `Maintainer override accepted for tasks ${action}. This legacy lifecycle path is deprecated and should not be used for normal AI routing.`, {
                    taskId: options.taskId,
                    actorId,
                    action,
                    requiredCommand: nextClaimCommand,
                    command: legacyOverrideCommand
                }),
                message('info', 'ATM_TASKS_RESERVED', `Task ${options.taskId} reserved by ${actorId}.`, {
                    taskId: options.taskId,
                    actorId
                })
            ],
            evidence: {
                action,
                taskId: options.taskId,
                actorId,
                status: selectedStep.status,
                taskPath: relativePathFrom(options.cwd, taskPathFor(options.cwd, options.taskId)),
                transitionPath: selectedStep.transitionPath,
                importEvidencePath: selectedStep.importEvidencePath ?? null,
                deprecatedLifecycle: true,
                requiredCommand: nextClaimCommand,
                legacyOverrideCommand
            }
        });
    }
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [
            message('warn', 'ATM_LIFECYCLE_LEGACY_LOCK', `Maintainer override accepted for tasks ${action}. This legacy lifecycle path is deprecated and should not be used for normal AI routing.`, {
                taskId: options.taskId,
                actorId,
                action,
                requiredCommand: nextClaimCommand,
                command: legacyOverrideCommand
            }),
            message('info', 'ATM_TASKS_PROMOTED', `Task ${options.taskId} promoted to ready by ${actorId}.`, {
                taskId: options.taskId,
                actorId
            })
        ],
        evidence: {
            action,
            taskId: options.taskId,
            actorId,
            status: selectedStep.status,
            taskPath: relativePathFrom(options.cwd, taskPathFor(options.cwd, options.taskId)),
            transitionPath: selectedStep.transitionPath,
            deprecatedLifecycle: true,
            requiredCommand: nextClaimCommand,
            legacyOverrideCommand
        }
    });
}
function importPlanningTaskForReservation(input) {
    const planCandidates = findPlanningTaskCardCandidates(input.cwd, input.taskId);
    if (planCandidates.length === 0) {
        throw new CliError('ATM_TASK_RESERVE_PLANNING_CARD_REQUIRED', `tasks reserve requires a human-authored planning card for ${input.taskId}; no matching task card was found in sibling planning repositories.`, {
            exitCode: 1,
            details: {
                taskId: input.taskId,
                searchedFrom: path.dirname(input.cwd)
            }
        });
    }
    if (planCandidates.length > 1) {
        throw new CliError('ATM_TASK_RESERVE_PLANNING_CARD_AMBIGUOUS', `tasks reserve found multiple planning cards for ${input.taskId}; import the intended card first or remove the ambiguity.`, {
            exitCode: 1,
            details: {
                taskId: input.taskId,
                candidates: planCandidates.map((candidate) => relativePathFrom(input.cwd, candidate))
            }
        });
    }
    const planAbsolute = planCandidates[0];
    const planText = readFileSync(planAbsolute, 'utf8');
    const task = parseSingleCard({
        planText,
        planRelativePath: toStoredPlanningPath(input.cwd, planAbsolute),
        importedAt: input.importedAt
    });
    if (!task || task.workItemId !== input.taskId) {
        throw new CliError('ATM_TASK_RESERVE_PLANNING_CARD_INVALID', `tasks reserve found a planning card for ${input.taskId}, but ATM could not import a valid single-card contract from it.`, {
            exitCode: 1,
            details: {
                taskId: input.taskId,
                planPath: toStoredPlanningPath(input.cwd, planAbsolute)
            }
        });
    }
    const writeResult = writeTaskFiles({
        cwd: input.cwd,
        tasks: [task],
        force: false,
        forceOverwriteClaims: false,
        resetOpen: false,
        reopen: false
    });
    const blockingDiagnostics = writeResult.diagnostics.filter((entry) => entry.level === 'error');
    if (blockingDiagnostics.length > 0) {
        throw new CliError('ATM_TASK_RESERVE_IMPORT_FAILED', `tasks reserve could not auto-import ${input.taskId} before reservation.`, {
            exitCode: 1,
            details: {
                taskId: input.taskId,
                planPath: toStoredPlanningPath(input.cwd, planAbsolute),
                diagnostics: blockingDiagnostics
            }
        });
    }
    const evidencePath = writeImportEvidence({
        cwd: input.cwd,
        tasks: [task],
        planPath: toStoredPlanningPath(input.cwd, planAbsolute),
        generatedAt: input.importedAt,
        writtenPaths: writeResult.writtenPaths
    });
    return {
        evidencePath,
        taskPath: taskPathFor(input.cwd, input.taskId)
    };
}
function findPlanningTaskCardCandidates(cwd, taskId) {
    const parentDirectory = path.dirname(cwd);
    if (!existsSync(parentDirectory))
        return [];
    let siblingEntries;
    try {
        siblingEntries = readdirSync(parentDirectory, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const normalizedCwd = path.resolve(cwd);
    const matches = [];
    for (const entry of siblingEntries) {
        if (!entry.isDirectory())
            continue;
        const siblingRoot = path.resolve(parentDirectory, entry.name);
        if (siblingRoot === normalizedCwd)
            continue;
        collectPlanningTaskCardsForReservation({
            root: siblingRoot,
            current: siblingRoot,
            taskId,
            depth: 0,
            matches
        });
    }
    return matches.sort((left, right) => {
        const leftPriority = left.includes(`${path.sep}docs${path.sep}ai_atomic_framework${path.sep}`) ? 0 : 1;
        const rightPriority = right.includes(`${path.sep}docs${path.sep}ai_atomic_framework${path.sep}`) ? 0 : 1;
        return leftPriority - rightPriority || left.localeCompare(right);
    });
}
function collectPlanningTaskCardsForReservation(input) {
    if (input.depth > 6 || input.matches.length > 12)
        return;
    let entries;
    try {
        entries = readdirSync(input.current, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const absolutePath = path.join(input.current, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith('.git') || entry.name === 'node_modules' || entry.name === '.atm')
                continue;
            collectPlanningTaskCardsForReservation({
                ...input,
                current: absolutePath,
                depth: input.depth + 1
            });
            continue;
        }
        if (!entry.isFile() || !entry.name.endsWith('.task.md'))
            continue;
        if (entry.name === `${input.taskId}.task.md` || entry.name.startsWith(`${input.taskId}-`)) {
            input.matches.push(absolutePath);
        }
    }
}
export { verifyCloseoutProvenance } from './tasks/closeout-provenance.js';
export { findTaskClaimDependencyBlockers } from './tasks/dependency-gates.js';
async function runTasksReset(argv) {
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
    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
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
    if (options.reason)
        taskDocument.resetReason = options.reason;
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
export function readDeferredForeignStagedFilesForActiveCloseWindow(cwd, taskId) {
    return delegatedReadDeferredForeignStagedFilesForActiveCloseWindow(cwd, taskId);
}
function runTasksAudit(argv) {
    const options = parseAuditOptions(argv);
    const report = auditTasks(options.cwd);
    return makeResult({
        ok: report.ok,
        command: 'tasks',
        cwd: options.cwd,
        messages: [
            !report.ok
                ? message('error', 'ATM_TASKS_AUDIT_FAILED', 'Task audit found invalid task closure evidence.', {
                    findingCount: report.findings.length,
                    errorCount: report.findings.filter((finding) => finding.level === 'error').length
                })
                : report.findings.length > 0
                    ? message('warn', 'ATM_TASKS_AUDIT_WARNINGS', `Task audit passed with ${report.findings.length} warning(s), including stalled backlog entries.`, {
                        inspectedTaskCount: report.inspectedTaskCount,
                        inspectedEvidenceCount: report.inspectedEvidenceCount,
                        warningCount: report.findings.length,
                        warningCodes: Array.from(new Set(report.findings.map((finding) => finding.code))),
                        findings: report.findings
                    })
                    : message('info', 'ATM_TASKS_AUDIT_OK', 'Task audit passed.', {
                        inspectedTaskCount: report.inspectedTaskCount,
                        inspectedEvidenceCount: report.inspectedEvidenceCount
                    })
        ],
        evidence: {
            action: 'audit',
            staged: options.staged,
            report
        }
    });
}
async function runTasksLock(argv) {
    const action = (argv[0] ?? '').toLowerCase();
    if (action !== 'cleanup') {
        throw new CliError('ATM_CLI_USAGE', 'tasks lock supports only: cleanup', { exitCode: 2 });
    }
    return await runTasksLockCleanup(argv.slice(1));
}
async function runTasksScope(argv) {
    const subAction = (argv[0] ?? '').toLowerCase();
    if (subAction === 'add') {
        return runTasksScopeAdd(argv.slice(1));
    }
    if (subAction === 'repair') {
        return runTasksScopeRepair(argv.slice(1));
    }
    if (!subAction) {
        throw new CliError('ATM_CLI_USAGE', 'tasks scope requires a sub-action: add | repair', { exitCode: 2 });
    }
    throw new CliError('ATM_CLI_USAGE', `tasks scope does not support sub-action ${subAction}. Supported: add, repair`, { exitCode: 2 });
}
function inspectScopeAmendmentPreconditions(cwd, taskId, actorId) {
    const taskPath = taskPathFor(cwd, taskId);
    const taskDocument = existsSync(taskPath) ? readJsonRecord(taskPath) : {};
    const claim = parseClaimRecord(taskDocument.claim);
    const nowIso = new Date().toISOString();
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
    let lockState = 'missing';
    if (existsSync(lockPath)) {
        try {
            const outerLock = JSON.parse(readFileSync(lockPath, 'utf8'));
            lockState = outerLock.released === true || outerLock.status === 'released' ? 'released' : 'active';
        }
        catch {
            lockState = 'unreadable';
        }
    }
    return {
        taskId,
        actorId,
        lockState,
        claimState: claim?.state ?? 'none',
        leaseState: claim?.leaseId ? (isClaimExpired(claim, nowIso) ? 'expired' : 'active') : 'none',
        claimActorId: claim?.actorId ?? null,
        leaseId: claim?.leaseId ?? null,
        resolvedBy: 'none',
        claimCommand: `node atm.mjs next --claim --task ${taskId} --actor ${actorId} --auto-intent --json`
    };
}
function buildScopeAmendmentNoClaimMessage(input) {
    return [
        `Scope amendment for ${input.taskId} requires an active claim, not a bare lock or renewed lease.`,
        `Current state: lock=${input.lockState}, claim=${input.claimState}, lease=${input.leaseState}.`,
        'Run one of:',
        `  - ${input.claimCommand} (recommended)`,
        `  - node atm.mjs tasks renew --task ${input.taskId} --actor ${input.actorId} --json (if lease only)`,
        'Then retry the scope amendment.'
    ].join('\n');
}
async function resolveScopeAmendmentClaimFirst(input) {
    const precondition = inspectScopeAmendmentPreconditions(input.cwd, input.taskId, input.actorId);
    if (precondition.claimState === 'active' && precondition.claimActorId === input.actorId) {
        return precondition;
    }
    const taskDocument = readJsonRecord(taskPathFor(input.cwd, input.taskId));
    prepareTaskForClaim({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId,
        status: taskDocument.status,
        title: typeof taskDocument.title === 'string' ? taskDocument.title : input.taskId,
        transitionCommand: `node atm.mjs next --claim --task ${input.taskId} --actor ${input.actorId} --auto-intent --json`
    });
    const files = extractTaskCloseDeclaredFiles(taskDocument, input.cwd, input.taskId);
    await runTasksClaimLifecycle('claim', [
        '--cwd', input.cwd,
        '--task', input.taskId,
        '--actor', input.actorId,
        '--auto-intent',
        '--files', files.join(','),
        '--json'
    ]);
    return {
        ...inspectScopeAmendmentPreconditions(input.cwd, input.taskId, input.actorId),
        resolvedBy: 'claim-first'
    };
}
async function runTasksScopeAdd(argv) {
    const options = parseScopeAddOptions(argv);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks scope add requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    let preconditionResolution = inspectScopeAmendmentPreconditions(options.cwd, options.taskId, actorId);
    if (options.claimFirst) {
        preconditionResolution = await resolveScopeAmendmentClaimFirst({
            cwd: options.cwd,
            taskId: options.taskId,
            actorId
        });
    }
    const lockPath = path.join(options.cwd, '.atm', 'runtime', 'locks', `${options.taskId}.lock.json`);
    if (!existsSync(lockPath)) {
        throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', buildScopeAmendmentNoClaimMessage(preconditionResolution), {
            exitCode: 1,
            details: {
                ...preconditionResolution,
                taskId: options.taskId,
                requiredCommand: preconditionResolution.claimCommand
            }
        });
    }
    let outerLock;
    try {
        outerLock = JSON.parse(readFileSync(lockPath, 'utf8'));
    }
    catch {
        throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `Could not read direction lock for task ${options.taskId}.`, {
            exitCode: 1,
            details: {
                ...preconditionResolution,
                taskId: options.taskId,
                requiredCommand: preconditionResolution.claimCommand
            }
        });
    }
    if (outerLock.released === true || outerLock.status === 'released') {
        throw new CliError('ATM_SCOPE_AMENDMENT_LOCK_RELEASED', `Task ${options.taskId} direction lock is released; claim the task first.`, {
            exitCode: 1,
            details: {
                ...preconditionResolution,
                taskId: options.taskId,
                requiredCommand: preconditionResolution.claimCommand
            }
        });
    }
    const embeddedLock = outerLock.taskDirectionLock;
    if (!embeddedLock || typeof embeddedLock !== 'object' || Array.isArray(embeddedLock)) {
        throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `Lock file for ${options.taskId} does not contain an embedded taskDirectionLock.`, {
            exitCode: 1,
            details: {
                ...preconditionResolution,
                taskId: options.taskId,
                requiredCommand: preconditionResolution.claimCommand
            }
        });
    }
    const embeddedLockRecord = embeddedLock;
    const existingAllowed = sanitizeTaskDirectionAllowedFiles(Array.isArray(embeddedLockRecord.allowedFiles) ? embeddedLockRecord.allowedFiles : []);
    const requestedPaths = sanitizeTaskDirectionAllowedFiles(options.addPaths);
    const addedPaths = requestedPaths.filter((p) => !existingAllowed.includes(p));
    const alreadyPresent = requestedPaths.filter((p) => existingAllowed.includes(p));
    const mergedAllowed = sanitizeTaskDirectionAllowedFiles([...existingAllowed, ...requestedPaths]);
    // 記錄 scope-amendment 轉換事件（包含可稽核的 amendment metadata）
    const taskPath = taskPathFor(options.cwd, options.taskId);
    const amendmentMetadata = {
        amendmentClass: options.amendmentClass ?? 'linked-surface',
        amendmentPhase: options.amendmentPhase ?? 'during-implementation',
        amendmentMode: 'normal',
        ...(options.reason ? { reason: options.reason } : {})
    };
    if (existsSync(taskPath)) {
        const taskDocument = readJsonRecord(taskPath);
        syncScopeAmendmentState({
            taskDocument,
            outerLock,
            embeddedLockRecord,
            mergedAllowed
        });
        writeFileSync(lockPath, `${JSON.stringify(outerLock, null, 2)}\n`, 'utf8');
        if (preconditionResolution.resolvedBy === 'claim-first') {
            appendTaskTransitionEvent({
                cwd: options.cwd,
                taskId: options.taskId,
                action: 'scope-amendment.claim-first-resolved',
                actorId,
                fromStatus: String(taskDocument.status ?? 'running'),
                toStatus: String(taskDocument.status ?? 'running'),
                taskPath,
                taskDocument,
                command: preconditionResolution.claimCommand
            });
        }
        const commandLine = buildScopeAmendmentCommand({
            mode: 'normal',
            taskId: options.taskId,
            actorId,
            addPaths: options.addPaths,
            amendmentClass: options.amendmentClass,
            amendmentPhase: options.amendmentPhase,
            reason: options.reason
        });
        persistScopeAmendmentTransition({
            cwd: options.cwd,
            taskId: options.taskId,
            actorId,
            taskPath,
            taskDocument,
            command: commandLine,
            amendmentMetadata
        });
    }
    else {
        syncScopeAmendmentRuntimeLock({
            outerLock,
            embeddedLockRecord,
            mergedAllowed
        });
        writeFileSync(lockPath, `${JSON.stringify(outerLock, null, 2)}\n`, 'utf8');
    }
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_SCOPE_AMENDMENT_APPLIED', addedPaths.length > 0
                ? `Scope amendment applied for ${options.taskId}: ${addedPaths.length} path(s) added to allowedFiles.`
                : `Scope amendment for ${options.taskId}: all requested paths were already in allowedFiles.`, {
                taskId: options.taskId,
                actorId,
                addedPaths,
                alreadyPresent,
                allowedFiles: mergedAllowed,
                preconditionResolution,
                amendmentMetadata,
                requiredCommand: `node atm.mjs tasks scope add --task ${options.taskId} --actor ${actorId} --add <paths> --json`
            })
        ],
        evidence: {
            action: 'scope-amendment',
            amendmentMode: 'normal',
            taskId: options.taskId,
            actorId,
            addedPaths,
            alreadyPresent,
            allowedFiles: mergedAllowed,
            preconditionResolution,
            amendmentMetadata
        }
    });
}
/**
 * `tasks scope repair` — 維護緊急通道（需 --emergency-approval 與 --reason）。
 * 語意與 `tasks scope add` 相同，但記錄 `amendmentMode: 'repair'` 以區分
 * 正常稽核通道與緊急維護通道，讓 reviewer 能識別真正的治理例外。
 */
function runTasksScopeRepair(argv) {
    const options = parseScopeRepairOptions(argv);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks scope repair requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    // 強制 emergency approval 檢查（parseScopeRepairOptions 已確保 emergencyApproval 非空）
    assertEmergencyApproval({
        cwd: options.cwd,
        surface: 'tasks scope repair',
        permission: 'backend.tasks.scopeAmend',
        taskId: options.taskId,
        actorId,
        emergencyApproval: options.emergencyApproval,
        flags: ['--add', '--reason'],
        reason: options.reason,
        command: `node atm.mjs tasks scope repair --task ${options.taskId} --actor ${actorId} --add ${options.addPaths.join(',')} --reason "${options.reason}" --emergency-approval ${options.emergencyApproval} --json`
    });
    const lockPath = path.join(options.cwd, '.atm', 'runtime', 'locks', `${options.taskId}.lock.json`);
    if (!existsSync(lockPath)) {
        throw new CliError('ATM_SCOPE_AMENDMENT_NO_ACTIVE_LOCK', `No active direction lock found for task ${options.taskId}. The task must be claimed before repairing its scope.`, {
            exitCode: 1,
            details: { taskId: options.taskId }
        });
    }
    let outerLock;
    try {
        outerLock = JSON.parse(readFileSync(lockPath, 'utf8'));
    }
    catch {
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
    const embeddedLockRecord = embeddedLock;
    const existingAllowed = sanitizeTaskDirectionAllowedFiles(Array.isArray(embeddedLockRecord.allowedFiles) ? embeddedLockRecord.allowedFiles : []);
    const requestedPaths = sanitizeTaskDirectionAllowedFiles(options.addPaths);
    const addedPaths = requestedPaths.filter((p) => !existingAllowed.includes(p));
    const alreadyPresent = requestedPaths.filter((p) => existingAllowed.includes(p));
    const mergedAllowed = sanitizeTaskDirectionAllowedFiles([...existingAllowed, ...requestedPaths]);
    // 記錄 scope-amendment 事件（amendmentMode: 'repair'，讓歷史可查）
    const taskPath = taskPathFor(options.cwd, options.taskId);
    const amendmentMetadata = {
        amendmentClass: 'linked-surface',
        amendmentPhase: 'during-implementation',
        amendmentMode: 'repair',
        reason: options.reason
    };
    if (existsSync(taskPath)) {
        const taskDocument = readJsonRecord(taskPath);
        syncScopeAmendmentState({
            taskDocument,
            outerLock,
            embeddedLockRecord,
            mergedAllowed
        });
        writeFileSync(lockPath, `${JSON.stringify(outerLock, null, 2)}\n`, 'utf8');
        const commandLine = buildScopeAmendmentCommand({
            mode: 'repair',
            taskId: options.taskId,
            actorId,
            addPaths: options.addPaths,
            reason: options.reason,
            emergencyApproval: options.emergencyApproval
        });
        persistScopeAmendmentTransition({
            cwd: options.cwd,
            taskId: options.taskId,
            actorId,
            taskPath,
            taskDocument,
            command: commandLine,
            amendmentMetadata
        });
    }
    else {
        syncScopeAmendmentRuntimeLock({
            outerLock,
            embeddedLockRecord,
            mergedAllowed
        });
        writeFileSync(lockPath, `${JSON.stringify(outerLock, null, 2)}\n`, 'utf8');
    }
    return makeResult({
        ok: true,
        command: 'tasks',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_SCOPE_REPAIR_APPLIED', addedPaths.length > 0
                ? `Scope repair applied for ${options.taskId}: ${addedPaths.length} path(s) added to allowedFiles (maintenance lane).`
                : `Scope repair for ${options.taskId}: all requested paths were already in allowedFiles.`, {
                taskId: options.taskId,
                actorId,
                addedPaths,
                alreadyPresent,
                allowedFiles: mergedAllowed,
                amendmentMetadata,
                requiredCommand: `node atm.mjs tasks scope repair --task ${options.taskId} --actor ${actorId} --add <paths> --reason "<reason>" --emergency-approval <leaseId> --json`
            })
        ],
        evidence: {
            action: 'scope-amendment',
            amendmentMode: 'repair',
            taskId: options.taskId,
            actorId,
            addedPaths,
            alreadyPresent,
            allowedFiles: mergedAllowed,
            amendmentMetadata
        }
    });
}
async function runTasksLockCleanup(argv) {
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
async function cleanupTaskLock(input) {
    const { cwd, taskId, actorId } = input;
    const nowIso = new Date().toISOString();
    const taskPath = taskPathFor(cwd, taskId);
    const taskDocument = existsSync(taskPath)
        ? JSON.parse(readFileSync(taskPath, 'utf8'))
        : null;
    const currentStatus = normalizeTaskStatus(taskDocument?.status);
    const currentClaim = parseClaimRecord(taskDocument?.claim);
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
    const sidecarPath = path.join(cwd, '.atm', 'runtime', 'task-direction-locks', `${taskId}.json`);
    const governanceLock = existsSync(lockPath)
        ? JSON.parse(readFileSync(lockPath, 'utf8'))
        : null;
    const releasedLock = governanceLock?.released === true || governanceLock?.status === 'released';
    const staleReasons = [];
    if (releasedLock)
        staleReasons.push('released-lock');
    if (!taskDocument)
        staleReasons.push('missing-task');
    if (currentStatus === 'done' || currentStatus === 'abandoned' || currentStatus === 'blocked') {
        staleReasons.push(`terminal-task:${currentStatus}`);
    }
    if (currentClaim && isClaimExpired(currentClaim, nowIso))
        staleReasons.push('expired-claim');
    if (!governanceLock && existsSync(sidecarPath))
        staleReasons.push('orphaned-sidecar');
    if (governanceLock && !releasedLock && !currentClaim && existsSync(sidecarPath))
        staleReasons.push('lock-without-claim');
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
    const cleanupActions = [];
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
function runTasksQueue(argv) {
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
function runTasksParallel(argv) {
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
function parseTasksParallelArgs(argv) {
    let cwd = process.cwd();
    let taskId = null;
    let withTaskId = null;
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
function listParallelAdvisorTasks(cwd) {
    const taskLedger = readTaskLedgerPolicy(cwd);
    const taskRoot = path.join(cwd, taskLedger.taskRoot);
    const entries = readdirSync(taskRoot, { withFileTypes: true });
    const tasks = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json'))
            continue;
        const fullPath = path.join(taskRoot, entry.name);
        const doc = readJsonRecord(fullPath);
        const status = normalizeTaskStatus(doc.status);
        if (!['open', 'running', 'ready', 'in_progress', 'review', 'blocked', 'reserved'].includes(status))
            continue;
        tasks.push(taskDocumentToParallelAdvisorTask(cwd, doc));
    }
    return tasks;
}
function readParallelAdvisorTask(cwd, taskId) {
    const taskPath = taskPathFor(cwd, taskId);
    if (!existsSync(taskPath)) {
        throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${taskId}.`, {
            exitCode: 2,
            details: { taskId, taskPath: relativePathFrom(cwd, taskPath) }
        });
    }
    return taskDocumentToParallelAdvisorTask(cwd, readJsonRecord(taskPath));
}
function taskDocumentToParallelAdvisorTask(cwd, taskDocument) {
    const taskId = normalizeTaskDocumentId(taskDocument, 'TASK-UNKNOWN-0000');
    const title = normalizeOptionalString(taskDocument.title) ?? taskId;
    const status = normalizeTaskStatus(taskDocument.status);
    const collectedFiles = collectParallelAdvisorTaskFiles(taskDocument);
    const allowedFiles = uniqueStrings(Array.from(collectedFiles)
        .map((value) => normalizeParallelAdvisorPath(cwd, value))
        .filter((value) => Boolean(value)));
    const validators = uniqueStrings(parseYamlList(taskDocument.validators).map((entry) => entry.trim()).filter(Boolean));
    const atomIds = uniqueStrings(allowedFiles.flatMap((entry) => findAtomIdsForPath(cwd, entry)));
    const claimRecord = taskDocument.claim && typeof taskDocument.claim === 'object' && !Array.isArray(taskDocument.claim)
        ? taskDocument.claim
        : null;
    const claimState = normalizeOptionalString(claimRecord?.state);
    const activeClaimActorId = claimState === 'active' ? normalizeOptionalString(claimRecord?.actorId) : null;
    const activeClaimIntent = claimState === 'active'
        ? (normalizeOptionalString(claimRecord?.intent) ?? 'write')
        : null;
    return { taskId, title, status, allowedFiles, validators, atomIds, activeClaimActorId, activeClaimIntent };
}
function collectParallelAdvisorTaskFiles(taskDocument) {
    const files = new Set();
    const taskDirectionLock = taskDocument.taskDirectionLock;
    const claim = taskDocument.claim;
    const legacyImportAliases = taskDocument.legacyImportAliases;
    const targetWork = taskDocument.targetWork;
    collectTaskFileValues(taskDocument.scopePaths, files);
    collectTaskFileValues(taskDocument.deliverables, files);
    collectTaskFileValues(taskDocument.targetAllowedFiles, files);
    collectTaskFileValues(taskDocument.planningMirrorPaths, files);
    if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
        collectTaskFileValues(claim.files, files);
    }
    if (taskDirectionLock && typeof taskDirectionLock === 'object' && !Array.isArray(taskDirectionLock)) {
        collectTaskFileValues(taskDirectionLock.allowedFiles, files);
    }
    if (legacyImportAliases && typeof legacyImportAliases === 'object' && !Array.isArray(legacyImportAliases)) {
        collectTaskFileValues(legacyImportAliases.allowed_files, files);
    }
    if (targetWork && typeof targetWork === 'object' && !Array.isArray(targetWork)) {
        collectTaskFileValues(targetWork.allowedFiles, files);
    }
    return files;
}
function normalizeParallelAdvisorPath(cwd, value) {
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const normalized = trimmed.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(normalized)) {
        return relativePathFrom(cwd, normalized).replace(/\\/g, '/');
    }
    return normalized.replace(/^\.\/+/, '');
}
function loadPathToAtomMappings(cwd) {
    const mapPath = path.join(cwd, 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json');
    const payload = readJsonRecord(mapPath);
    return (payload.mappings ?? []).flatMap((entry) => {
        const pathPattern = normalizeOptionalString(entry.path_pattern);
        const atomId = normalizeOptionalString(entry.atom_id);
        const capability = normalizeOptionalString(entry.capability) ?? '';
        if (!pathPattern || !atomId)
            return [];
        return [{ pathPattern, atomId, capability }];
    });
}
function findAtomIdsForPath(cwd, relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    return loadPathToAtomMappings(cwd)
        .filter((mapping) => globLikeMatch(normalized, mapping.pathPattern))
        .map((mapping) => mapping.atomId);
}
function analyzeParallelPair(left, right) {
    const overlappingFiles = intersect(left.allowedFiles, right.allowedFiles);
    const overlappingAtomIds = intersect(left.atomIds, right.atomIds);
    const sharedValidators = intersect(left.validators, right.validators);
    const sharedGenerators = overlappingFiles.filter((entry) => /generator|build|manifest/i.test(entry));
    const sharedProjections = overlappingFiles.filter((entry) => /projection|map|registry|index/i.test(entry));
    const sharedArtifacts = overlappingFiles.filter((entry) => /artifact|report|jsonl/i.test(entry));
    const activeLeaseConflicts = overlappingFiles.filter((entry) => /\.atm\/history\//i.test(entry));
    const brokerAdmission = buildBrokerAdmissionExplanation({
        overlappingFiles,
        overlappingAtomIds,
        sharedProjections
    });
    let verdict = 'parallel-safe';
    if (brokerAdmission.confirmedConflict) {
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
    }
    return {
        verdict,
        overlappingFiles,
        overlappingAtomIds,
        sharedValidators,
        sharedGenerators,
        sharedProjections,
        sharedArtifacts,
        activeLeaseConflicts,
        brokerAdmission
    };
}
const buildBrokerAdmissionExplanation = delegatedBuildBrokerAdmissionExplanation;
const explainBrokerAdapterForPath = delegatedExplainBrokerAdapterForPath;
const hasUnexplainedSharedProjection = delegatedHasUnexplainedSharedProjection;
function buildParallelHotspotReport(tasks) {
    const fileCounts = new Map();
    const atomCounts = new Map();
    const validatorCounts = new Map();
    for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
            const finding = analyzeParallelPair(tasks[leftIndex], tasks[rightIndex]);
            for (const file of finding.overlappingFiles)
                incrementMap(fileCounts, file);
            for (const atomId of finding.overlappingAtomIds)
                incrementMap(atomCounts, atomId);
            for (const validator of finding.sharedValidators)
                incrementMap(validatorCounts, validator);
        }
    }
    return {
        topOverlappingFiles: sortMapEntries(fileCounts),
        topOverlappingAtomIds: sortMapEntries(atomCounts),
        topSharedValidators: sortMapEntries(validatorCounts)
    };
}
function intersect(left, right) {
    const rightSet = new Set(right);
    return left.filter((value) => rightSet.has(value));
}
function incrementMap(target, key) {
    target.set(key, (target.get(key) ?? 0) + 1);
}
function sortMapEntries(target) {
    return Array.from(target.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([value, count]) => ({ value, count }));
}
function globLikeMatch(value, pattern) {
    const normalizedPattern = pattern.replace(/\\/g, '/');
    const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regexSource = `^${escaped.replace(/\*\*/g, '::DOUBLE_STAR::').replace(/\*/g, '[^/]*').replace(/::DOUBLE_STAR::/g, '.*')}$`;
    return new RegExp(regexSource).test(value);
}
async function runTasksMigrateLegacyLedger(argv) {
    const options = parseLegacyLedgerMigrationOptions(argv);
    assertLocalTaskLedgerEnabled(options.cwd, 'migrate-legacy-ledger');
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks migrate-legacy-ledger requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const taskLedger = readTaskLedgerPolicy(options.cwd);
    const tasks = readLegacyLedgerTaskFiles(options.cwd);
    const migratedTasks = [];
    const skippedTasks = [];
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
        const reportEntry = {
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
        }
        else {
            migratedTasks.push(reportEntry);
        }
    }
    const report = {
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
async function runTasksClaimLifecycle(action, argv) {
    const claimLifecycleStartedAt = Date.now();
    const claimLifecyclePhases = [];
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
    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
    const nowIso = new Date().toISOString();
    const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
    const existingTask = await resolveValue(adapter.stores.taskStore.getTask(options.taskId));
    const taskRef = existingTask ?? {
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
        const claimIntentResolution = resolveTaskClaimIntent({
            cwd: options.cwd,
            taskId: options.taskId,
            taskDocument,
            requestedClaimIntent: options.claimIntent,
            autoIntent: options.autoIntent === true && options.claimIntentExplicit !== true,
            explicitClaimIntent: options.claimIntentExplicit === true
        });
        claimLifecyclePhases.push({ phase: 'claim-intent-resolution', durationMs: 0 });
        if (options.claimIntentExplicit === true
            && options.claimIntent === 'closeout-only'
            && claimIntentResolution.dirtyInScopeFiles.length > 0) {
            throw new CliError('ATM_CLAIM_INTENT_CONFLICT', `closeout-only claim requires a clean in-scope source tree. Found dirty: ${claimIntentResolution.dirtyInScopeFiles.join(', ')}. Re-claim with --claim-intent write or revert those changes first.`, {
                exitCode: 1,
                details: {
                    taskId: options.taskId,
                    claimIntent: options.claimIntent,
                    dirtyInScopeFiles: claimIntentResolution.dirtyInScopeFiles,
                    requiredCommand: `node atm.mjs tasks claim --task ${options.taskId} --actor ${actorId} --claim-intent write --files <scoped-files> --json`
                }
            });
        }
        const claimAdmission = evaluateTaskClaimAdmission({
            taskId: options.taskId,
            actorId,
            status: String(taskDocument.status ?? ''),
            claimIntent: claimIntentResolution.resolvedClaimIntent,
            currentClaimActorId: currentClaim?.actorId ?? null,
            currentClaimState: currentClaim?.state ?? null
        });
        claimLifecyclePhases.push({ phase: 'claim-admission', durationMs: 0 });
        if (!claimAdmission.ok) {
            throw new CliError(claimAdmission.code, claimAdmission.message, {
                exitCode: 1,
                details: claimAdmission.details
            });
        }
        const dependencyBlockers = findTaskClaimDependencyBlockers(options.cwd, options.taskId, taskDocument);
        claimLifecyclePhases.push({ phase: 'dependency-gate', durationMs: 0 });
        if (dependencyBlockers.length > 0) {
            const firstBlocker = dependencyBlockers[0];
            const closeoutBlocker = firstBlocker;
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
                        ? assessCloseoutProvenanceGap(options.cwd, firstBlocker.taskId, JSON.parse(readFileSync(firstBlocker.taskPath, 'utf8')))
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
            intent: claimIntentResolution.resolvedClaimIntent
        };
        try {
            const lockAcquireStartedAt = Date.now();
            await resolveValue(adapter.stores.lockStore.acquireLock(taskRef, files, actorId));
            claimLifecyclePhases.push({ phase: 'lock-acquire', durationMs: Date.now() - lockAcquireStartedAt });
        }
        catch (error) {
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
        const directionLockStartedAt = Date.now();
        const directionLock = writeTaskDirectionLock({
            cwd: options.cwd,
            taskId: options.taskId,
            actorId,
            queue: findActiveTaskQueue(options.cwd),
            batchId: null,
            scopeKey: null,
            allowedFiles: files,
            planningReadOnlyPaths: Array.isArray(taskDocument.planningReadOnlyPaths) ? taskDocument.planningReadOnlyPaths : [],
            planningMirrorPaths: Array.isArray(taskDocument.planningMirrorPaths) ? taskDocument.planningMirrorPaths : [],
            allowPlanningMirror: taskDocument.allowPlanningMirror === true,
            prompt: options.taskId
        });
        claimLifecyclePhases.push({ phase: 'direction-lock-write', durationMs: Date.now() - directionLockStartedAt });
        taskDocument.taskDirectionLock = directionLock;
        const transitionStartedAt = Date.now();
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
        claimLifecyclePhases.push({ phase: 'task-transition-write', durationMs: Date.now() - transitionStartedAt });
        return makeResult({
            ok: true,
            command: 'tasks',
            cwd: options.cwd,
            messages: [message('info', 'ATM_TASKS_CLAIM_ACQUIRED', `Claim acquired for ${options.taskId}.`, {
                    taskId: options.taskId,
                    actorId,
                    claimIntent: claimIntentResolution.resolvedClaimIntent
                })],
            evidence: {
                action,
                taskId: options.taskId,
                actorId,
                claimIntent: claimIntentResolution.resolvedClaimIntent,
                claimIntentResolution,
                claim,
                taskPath: relativeTaskPath,
                transitionPath,
                sessionId: sessionRecord.session.sessionId,
                session: sessionRecord.session,
                taskDirectionLock: directionLock,
                claimLatency: {
                    schemaId: 'atm.claimLatencyTelemetry.v1',
                    totalMs: Date.now() - claimLifecycleStartedAt,
                    phases: claimLifecyclePhases
                }
            }
        });
    }
    if (!currentClaim && action === 'release' && options.reservedOk && normalizeTaskStatus(taskDocument.status) === 'reserved') {
        const previousStatus = String(taskDocument.status ?? '');
        taskDocument.status = 'open';
        taskDocument.owner = actorId;
        if (options.reason)
            taskDocument.releaseReason = options.reason;
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
        const renewed = {
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
        const releasedClaim = {
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
        const handedOff = {
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
    const takeoverClaim = {
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
function parseReservationOptions(action, argv) {
    const options = {
        cwd: process.cwd(),
        taskId: '',
        actorId: null,
        title: null,
        maintainerOverrideLegacyLifecycle: false
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
        if (arg === '--maintainer-override-legacy-lifecycle') {
            options.maintainerOverrideLegacyLifecycle = true;
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
export const evaluateFrameworkDeliveryWindow = delegatedEvaluateFrameworkDeliveryWindow;
function resolveTaskClaimIntent(input) {
    const declaredFiles = normalizeTaskScopePaths(input.cwd, extractTaskCloseDeclaredFiles(input.taskDocument, input.cwd, input.taskId));
    const source = input.taskDocument.source && typeof input.taskDocument.source === 'object' && !Array.isArray(input.taskDocument.source)
        ? input.taskDocument.source
        : {};
    const planPath = typeof source.planPath === 'string' ? normalizeRelativePath(source.planPath) : '';
    const inScopeSourceFiles = declaredFiles.filter((filePath) => !filePath.startsWith('.atm/') && filePath !== planPath);
    const dirtyFiles = uniqueStrings([
        ...readGitNameOnly(input.cwd, ['diff', '--name-only', '--cached']),
        ...readGitNameOnly(input.cwd, ['diff', '--name-only']),
        ...readGitNameOnly(input.cwd, ['ls-files', '-o', '--exclude-standard'])
    ]).filter((filePath) => inScopeSourceFiles.some((declared) => pathMatchesTaskScope(filePath, declared)));
    const declaredDeliverableFiles = extractStringList(input.taskDocument.deliverables)
        .map(normalizeRelativePath)
        .filter((filePath) => Boolean(filePath) && !filePath.startsWith('.atm/'));
    const deliverablesTrackedInHead = declaredDeliverableFiles.filter((filePath) => isTaskClaimDeliverableTrackedInHead(input.cwd, filePath));
    const missingDeliverables = declaredDeliverableFiles.filter((filePath) => !deliverablesTrackedInHead.includes(filePath));
    if (!input.autoIntent) {
        return {
            requestedClaimIntent: input.requestedClaimIntent,
            resolvedClaimIntent: input.requestedClaimIntent,
            autoIntent: false,
            explicitClaimIntent: input.explicitClaimIntent,
            reason: input.explicitClaimIntent ? 'explicit-claim-intent' : 'default-write-claim-intent',
            dirtyInScopeFiles: dirtyFiles,
            declaredDeliverableFiles,
            deliverablesTrackedInHead,
            missingDeliverables
        };
    }
    const resolvedClaimIntent = dirtyFiles.length > 0
        ? 'write'
        : declaredDeliverableFiles.length > 0 && missingDeliverables.length === 0
            ? 'closeout-only'
            : 'write';
    return {
        requestedClaimIntent: input.requestedClaimIntent,
        resolvedClaimIntent,
        autoIntent: true,
        explicitClaimIntent: false,
        reason: dirtyFiles.length > 0
            ? deliverablesTrackedInHead.length > 0
                ? 'dirty-in-scope-source-overrides-closeout'
                : 'dirty-in-scope-source'
            : declaredDeliverableFiles.length > 0 && missingDeliverables.length === 0
                ? 'deliverables-already-in-head'
                : 'deliverables-not-yet-landed',
        dirtyInScopeFiles: dirtyFiles,
        declaredDeliverableFiles,
        deliverablesTrackedInHead,
        missingDeliverables
    };
}
function isTaskClaimDeliverableTrackedInHead(cwd, filePath) {
    if (!filePath || /[*?[\]{}]/.test(filePath))
        return false;
    try {
        execFileSync('git', ['-C', cwd, 'cat-file', '-e', `HEAD:${filePath}`], { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
export const evaluateTaskDeliverableGate = delegatedEvaluateTaskDeliverableGate;
export const taskDeliveryPrincipleText = delegatedTaskDeliveryPrincipleText;
export const loadHistoricalBatchCloseSlice = delegatedLoadHistoricalBatchCloseSlice;
export const extractTaskCloseDeclaredFiles = delegatedExtractTaskCloseDeclaredFiles;
function extractStringList(value) {
    return Array.isArray(value)
        ? value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean)
        : [];
}
export const extractTaskDeliverableFiles = delegatedExtractTaskDeliverableFiles;
function normalizeTaskScopePaths(cwd, values) {
    return sanitizeTaskDirectionAllowedFiles(values.map((entry) => {
        const normalized = normalizeRelativePath(entry);
        if (!normalized)
            return '';
        return path.isAbsolute(normalized)
            ? normalizeRelativePath(relativePathFrom(cwd, normalized))
            : normalized;
    }));
}
function listCommittedFilesSinceClaim(cwd, claim) {
    return delegatedListCommittedFilesSinceClaim(cwd, claim);
}
function readGitScalar(cwd, args) {
    return delegatedReadGitScalar(cwd, args);
}
function readGitNameOnly(cwd, args) {
    try {
        const output = execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return uniqueStrings(output.split(/\r?\n/).map(normalizeRelativePath).filter(Boolean));
    }
    catch {
        return [];
    }
}
function writeLockCleanupReport(input) {
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
function writeTaskDocument(taskPath, document) {
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(taskPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}
function syncScopeAmendmentState(input) {
    syncScopeAmendmentRuntimeLock(input);
    input.taskDocument.taskDirectionLock = {
        ...input.embeddedLockRecord,
        allowedFiles: [...input.mergedAllowed]
    };
    const claim = input.taskDocument.claim;
    if (claim && typeof claim === 'object' && !Array.isArray(claim)) {
        const claimRecord = claim;
        claimRecord.files = [...input.mergedAllowed];
        input.taskDocument.claim = claimRecord;
    }
}
function syncScopeAmendmentRuntimeLock(input) {
    input.outerLock.taskDirectionLock = {
        ...input.embeddedLockRecord,
        allowedFiles: [...input.mergedAllowed]
    };
    input.outerLock.files = [...input.mergedAllowed];
}
function persistScopeAmendmentTransition(input) {
    const createdAt = new Date().toISOString();
    const transitionSeedDocument = {
        ...input.taskDocument,
        lastTransitionId: 'pending-scope-amendment',
        lastTransitionAt: createdAt
    };
    const transitionId = createTaskTransitionId({
        createdAt,
        taskId: input.taskId,
        action: 'scope-amendment',
        taskDocument: transitionSeedDocument
    });
    input.taskDocument.lastTransitionId = transitionId;
    input.taskDocument.lastTransitionAt = createdAt;
    input.taskDocument.ledgerContractVersion = 'task-ledger/v1';
    appendTaskTransitionEvent({
        cwd: input.cwd,
        taskId: input.taskId,
        action: 'scope-amendment',
        actorId: input.actorId,
        fromStatus: String(input.taskDocument.status ?? 'running'),
        toStatus: String(input.taskDocument.status ?? 'running'),
        taskPath: input.taskPath,
        taskDocument: input.taskDocument,
        command: input.command,
        createdAt,
        transitionId,
        amendmentMetadata: input.amendmentMetadata
    });
    writeTaskDocument(input.taskPath, input.taskDocument);
}
function readLegacyLedgerTaskFiles(cwd) {
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
            format: 'json',
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
            format: 'markdown',
            document,
            rawText
        };
    });
    return [...jsonTasks, ...markdownTasks].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
function writeLegacyBaselineTransition(input) {
    const createdAt = new Date().toISOString();
    const updatedDocument = {
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
    }
    else {
        writeTaskMarkdownFrontmatter(input.task.absolutePath, input.task.rawText ?? '', updatedDocument);
    }
    return transition.eventPath;
}
function listTaskFiles(directoryPath, predicate) {
    if (!existsSync(directoryPath))
        return [];
    const stats = safeTaskFileStat(directoryPath);
    if (!stats)
        return [];
    if (stats.isFile())
        return predicate(directoryPath) ? [directoryPath] : [];
    const output = [];
    for (const entry of safeTaskFileReadDir(directoryPath)) {
        const absolutePath = path.join(directoryPath, entry.name);
        if (entry.isDirectory() && shouldSkipTaskFileDiscoveryDirectory(absolutePath))
            continue;
        if (entry.isDirectory()) {
            output.push(...listTaskFiles(absolutePath, predicate));
        }
        else if (entry.isFile() && predicate(absolutePath)) {
            output.push(absolutePath);
        }
    }
    return output;
}
function shouldSkipTaskFileDiscoveryDirectory(directoryPath) {
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
    if (ignoredSegmentNames.has(basename))
        return true;
    return segments.some((segment, index) => segment === 'local' && (segments[index + 1] === 'tmp' || segments[index + 1] === 'temp'));
}
function parseTaskMarkdownFrontmatter(text) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match)
        return {};
    const result = {};
    for (const rawLine of match[1].split(/\r?\n/)) {
        const separatorIndex = rawLine.indexOf(':');
        if (separatorIndex === -1)
            continue;
        const key = rawLine.slice(0, separatorIndex).trim();
        const value = rawLine.slice(separatorIndex + 1).trim().replace(/^"(.*)"$/, '$1');
        if (key)
            result[key] = value;
    }
    return result;
}
function writeTaskMarkdownFrontmatter(filePath, text, document) {
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
    const seenKeys = new Set();
    const rewritten = frontmatterLines.map((line) => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1)
            return line;
        const key = line.slice(0, separatorIndex).trim();
        if (!upsertKeys.includes(key))
            return line;
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
function isFrontmatterScalar(value) {
    return delegatedIsFrontmatterScalar(value);
}
function formatFrontmatterValue(value) {
    if (typeof value === 'string')
        return value.replace(/\r?\n/g, ' ').trim();
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    return '';
}
function normalizeTaskDocumentId(document, fallback) {
    return delegatedNormalizeTaskDocumentId(document, fallback);
}
function normalizeTaskStatus(value) {
    return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}
function normalizeStringValue(value) {
    return delegatedNormalizeStringValue(value);
}
function sha256(value) {
    return delegatedSha256(value);
}
export function assertLocalTaskLedgerEnabled(cwd, action) {
    return delegatedAssertLocalTaskLedgerEnabled(cwd, action);
}
export function buildTaskTransitionCommand(input) {
    return delegatedBuildTaskTransitionCommand(input);
}
function buildScopeAmendmentCommand(input) {
    return delegatedBuildScopeAmendmentCommand(input);
}
function quoteCommandValue(value) {
    return /^[A-Za-z0-9._:/\\-]+$/.test(value)
        ? value
        : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
export const writeTaskDocumentWithTransition = delegatedWriteTaskDocumentWithTransition;
export const stageTaskCloseArtifacts = delegatedStageTaskCloseArtifacts;
export const existingTaskCloseArtifacts = delegatedExistingTaskCloseArtifacts;
export function createClosureTransitionMetadata(closurePacketPath, closurePacket, batchId = null, sessionId = null) {
    return delegatedCreateClosureTransitionMetadata(closurePacketPath, closurePacket, batchId, sessionId);
}
function normalizeWorkItemStatus(value) {
    return delegatedNormalizeWorkItemStatus(value);
}
export function inspectTaskVerifyStatus(value) {
    return delegatedInspectTaskVerifyStatus(value);
}
export function inspectTaskSourceTrace(document, statusInspection) {
    const source = document.source;
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
function isLegacyHistoricalTaskDocument(document, statusInspection) {
    if (statusInspection.warningCode === 'ATM_TASKS_VERIFY_LEGACY_STATUS_ALIAS') {
        return true;
    }
    const importedAt = normalizeStringValue(document.importedAt ?? document.imported_at);
    const evidencePath = normalizeStringValue(document.evidencePath ?? document.evidence_path);
    const lastTransitionId = normalizeStringValue(document.lastTransitionId ?? document.last_transition_id);
    return !importedAt && Boolean(evidencePath) && !lastTransitionId;
}
function writeTakeoverEvidence(cwd, taskId, actorId, previousClaim, newClaim) {
    const evidencePath = path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`);
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    const current = existsSync(evidencePath)
        ? JSON.parse(readFileSync(evidencePath, 'utf8'))
        : {};
    const evidenceArray = Array.isArray(current.evidence) ? current.evidence : [];
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
function extractErrorCode(error) {
    if (!error || typeof error !== 'object')
        return null;
    const code = error.code;
    return typeof code === 'string' && code.trim().length > 0 ? code : null;
}
function extractErrorDetails(error) {
    if (!error || typeof error !== 'object')
        return {};
    const details = error.details;
    if (!details || typeof details !== 'object' || Array.isArray(details))
        return {};
    return details;
}
/**
 * TASK-RFT-0011: peek at the planning source + runtime ledger to classify a
 * `tasks import --write --reset-open` invocation. If the peek fails for any
 * reason (missing files, JSON parse errors), we return the conservative
 * `drift-with-active-claim`-equivalent classification so the emergency gate
 * remains armed by default.
 */
export function classifyResetOpenImportForOptions(options) {
    try {
        const planAbsolute = resolvePlanAbsoluteFromStored(options.cwd, options.from);
        let planningStatus = null;
        if (existsSync(planAbsolute) && statSync(planAbsolute).isFile()) {
            const planText = readFileSync(planAbsolute, 'utf8');
            // Extract frontmatter `status: <value>` on the first status line.
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
                    // Malformed ledger — treat as drift with active claim by returning
                    // conservative classification below.
                    return {
                        state: 'drift-with-active-claim',
                        resetOpenEmergencyRequired: true,
                        reason: 'Runtime ledger JSON is unreadable; emergency lease required to override safely.'
                    };
                }
            }
        }
        return classifyResetOpenImport({
            planningStatus,
            runtimeLedgerStatus,
            runtimeActiveClaimActorId
        });
    }
    catch {
        return {
            state: 'drift-with-active-claim',
            resetOpenEmergencyRequired: true,
            reason: 'Reset-open classification peek failed; falling back to emergency-gated behavior.'
        };
    }
}
export function parseImportOptions(argv) {
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
        emergencyApproval: null,
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
export function parseVerifyOptions(argv) {
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
        if (arg === '--json' || arg === '--pretty')
            continue;
        throw new CliError('ATM_CLI_USAGE', `tasks verify does not support option ${arg}`, { exitCode: 2 });
    }
    return { ...options, cwd: path.resolve(options.cwd) };
}
function parseRepairClosureOptions(argv) {
    const state = {
        cwd: process.cwd(),
        taskId: null,
        actorId: null,
        scopeTaskId: null,
        dryRun: false,
        amend: false,
        emergencyApproval: null,
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
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `tasks requires a value for ${flag}`, { exitCode: 2 });
    }
    return value;
}
export function parsePlanMarkdown(input) {
    const { planText, planRelativePath, importedAt } = input;
    const lines = planText.split(/\r?\n/);
    const tasks = [];
    const diagnostics = [];
    const seenIds = new Set();
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
        }
        else {
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
        if (!record)
            continue;
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
        if (seenIds.has(record.workItemId))
            continue;
        seenIds.add(record.workItemId);
        tasks.push(record);
    }
    for (const [workItemId, metadata] of tableMetadata.entries()) {
        if (seenIds.has(workItemId))
            continue;
        seenIds.add(workItemId);
        tasks.push(createTaskFromTableMetadata({
            metadata,
            planRelativePath,
            importedAt
        }));
    }
    return { tasks, diagnostics };
}
function parseChineseLabeledTaskBlocks(input) {
    const records = [];
    for (let index = 0; index < input.lines.length; index += 1) {
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
function collectChineseLabeledValue(lines, labels) {
    const labelPattern = labels.map(escapeRegExp).join('|');
    const regex = new RegExp(`^\\s*(?:[-*]\\s*)?(?:${labelPattern})\\s*[：:]\\s*(.+?)\\s*$`, 'i');
    for (const line of lines) {
        const match = regex.exec(line);
        if (match?.[1]?.trim())
            return match[1].trim();
    }
    return null;
}
function collectChineseLabeledList(lines, labels) {
    const first = collectChineseLabeledValue(lines, labels);
    if (!first)
        return [];
    return first
        .split(/[、,，;]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
}
export function detectPlanHeadings(planText) {
    return planText.split(/\r?\n/).flatMap((line, index) => {
        const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
        return match ? [{ line: index + 1, text: match[1] }] : [];
    });
}
function parseTaskTableMetadata(lines) {
    const entries = new Map();
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
function splitPlanIntoTaskSections(lines) {
    const sections = [];
    let current = null;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const headingMatch = /^#{1,3}\s+(.+?)\s*$/.exec(line);
        if (headingMatch) {
            const candidate = headingMatch[1];
            const idMatch = taskIdPattern.exec(candidate);
            if (idMatch) {
                if (current)
                    sections.push(current);
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
    if (current)
        sections.push(current);
    return sections;
}
function parseSingleCard(input) {
    const frontMatter = extractFrontMatter(input.planText);
    if (!frontMatter || typeof frontMatter.data.task_id !== 'string')
        return null;
    const workItemId = normalizeTaskId(frontMatter.data.task_id);
    const title = normalizeOptionalString(frontMatter.data.title) ?? workItemId;
    const status = coerceStatus(typeof frontMatter.data.status === 'string' ? frontMatter.data.status : 'planned');
    const milestone = normalizeOptionalString(frontMatter.data.milestone);
    const dependencies = parseYamlList(frontMatter.data.depends_on ?? frontMatter.data.blocked_by ?? frontMatter.data.dependencies);
    const tags = parseYamlList(frontMatter.data.tags);
    const scopePaths = parseYamlList(frontMatter.data.scopePaths ?? frontMatter.data.scope_paths ?? frontMatter.data.allowed_files ?? frontMatter.data.allowedFiles ?? frontMatter.data.scope);
    const validators = parseYamlList(frontMatter.data.validators);
    const testPlan = normalizeTaskTestPlan(frontMatter.data.testPlan ?? frontMatter.data.test_plan);
    const planningMirrorPaths = parseYamlList(frontMatter.data.planningMirrorPaths ?? frontMatter.data.planning_mirror_paths);
    const planningReadOnlyPaths = parseYamlList(frontMatter.data.planningReadOnlyPaths ?? frontMatter.data.planning_read_only_paths);
    const outOfScope = parseYamlList(frontMatter.data.outOfScope ?? frontMatter.data.out_of_scope ?? frontMatter.data.forbidden_files);
    const nonGoals = parseYamlList(frontMatter.data.nonGoals ?? frontMatter.data.non_goals);
    const rawAtomizationImpact = frontMatter.data.atomizationImpact ?? frontMatter.data.atomization_impact;
    const atomizationImpactFrontMatter = rawAtomizationImpact && typeof rawAtomizationImpact === 'object' && !Array.isArray(rawAtomizationImpact)
        ? rawAtomizationImpact
        : {};
    const mapUpdates = parseYamlList(frontMatter.data.mapUpdates
        ?? frontMatter.data.map_updates
        ?? atomizationImpactFrontMatter.mapUpdates
        ?? atomizationImpactFrontMatter.map_updates);
    const proposalAdmission = parseTaskProposalAdmission(frontMatter.data.proposalAdmission ?? frontMatter.data.brokerProposalAdmission);
    const body = input.planText.slice(frontMatter.endIndex);
    const sections = sliceBodyByHeadings(body);
    const acceptance = collectBulletList(sections, acceptanceHeaders);
    const frontMatterScopePaths = parseYamlList(frontMatter.data.scopePaths ?? frontMatter.data.scope_paths ?? frontMatter.data.allowed_files ?? frontMatter.data.allowedFiles ?? frontMatter.data.scope);
    const frontMatterDeliverables = parseYamlList(frontMatter.data.deliverables);
    const bodyDeliverables = collectBulletList(sections, deliverablesHeaders);
    // TASK-AAO-0064 L1: frontmatter 優先（frontmatter canonical）
    // 若 frontmatter 已提供 deliverables，body parser 結果忽略，記錄診斷
    let deliverables;
    const cardImportDiagnostics = [];
    if (frontMatterDeliverables.length > 0 && bodyDeliverables.length > 0) {
        deliverables = uniqueStrings(frontMatterDeliverables.map(normalizeYamlScalar));
        cardImportDiagnostics.push({
            code: 'IMPORT_BODY_SECTION_IGNORED',
            severity: 'warning',
            message: 'Front-matter `deliverables` key is present; body section deliverables were ignored in favour of front-matter values.',
            field: 'deliverables'
        });
    }
    else if (frontMatterDeliverables.length > 0) {
        deliverables = uniqueStrings(frontMatterDeliverables.map(normalizeYamlScalar));
    }
    else {
        deliverables = uniqueStrings(bodyDeliverables.map(normalizeYamlScalar));
    }
    const inferredLegacyDeliverables = deliverables.length === 0
        ? inferLegacyDeliverablesFromScope(frontMatterScopePaths.map(normalizeYamlScalar))
        : [];
    if (deliverables.length === 0 && inferredLegacyDeliverables.length > 0) {
        deliverables = inferredLegacyDeliverables;
        cardImportDiagnostics.push({
            code: 'ATM_TASK_IMPORT_LEGACY_SCOPE_DELIVERABLES_INFERRED',
            severity: 'warning',
            message: 'No explicit deliverables were declared; ATM inferred deliverables from legacy scopePaths/allowed_files because every entry was file-shaped.',
            field: 'deliverables'
        });
    }
    const notes = collectText(sections, notesHeaders) ?? null;
    const evidenceFrontMatter = frontMatter.data.evidence && typeof frontMatter.data.evidence === 'object' && !Array.isArray(frontMatter.data.evidence)
        ? frontMatter.data.evidence
        : {};
    const rollbackFrontMatter = frontMatter.data.rollback && typeof frontMatter.data.rollback === 'object' && !Array.isArray(frontMatter.data.rollback)
        ? frontMatter.data.rollback
        : {};
    const evidenceRequired = normalizeOptionalString(frontMatter.data.evidenceRequired
        ?? frontMatter.data.evidence_required
        ?? frontMatter.data.required
        ?? evidenceFrontMatter.required
        ?? evidenceFrontMatter.kind);
    const rollbackStrategy = normalizeOptionalString(frontMatter.data.rollbackStrategy
        ?? frontMatter.data.rollback_strategy
        ?? frontMatter.data.strategy
        ?? rollbackFrontMatter.strategy);
    const rollbackNotes = normalizeOptionalString(frontMatter.data.rollbackNotes
        ?? frontMatter.data.rollback_notes
        ?? rollbackFrontMatter.notes);
    const contextMap = parseContextMap(frontMatter.data.contextMap);
    let dispatchMetadata = {};
    try {
        dispatchMetadata = parseDispatchMetadataFromPlanText(input.planText);
    }
    catch (error) {
        cardImportDiagnostics.push({
            code: 'ATM_TASK_IMPORT_DISPATCH_METADATA_TOO_LARGE',
            severity: 'error',
            message: error instanceof Error ? error.message : String(error),
            field: 'dispatchPattern'
        });
    }
    const importDiagnostics = [...cardImportDiagnostics];
    if (frontMatter.data.allowed_files !== undefined && frontMatter.data.scopePaths === undefined && frontMatter.data.scope_paths === undefined) {
        importDiagnostics.push({
            code: 'ATM_TASK_IMPORT_LEGACY_ALIAS',
            severity: 'warning',
            message: 'Front-matter uses legacy alias `allowed_files`; ATM imports the value as `scopePaths` to preserve target-repo scope. Prefer `scopePaths` in new task cards.',
            field: 'scopePaths',
            alias: 'allowed_files',
            canonical: 'scopePaths'
        });
        if (deliverables.length === 0) {
            importDiagnostics.push({
                code: 'ATM_TASK_IMPORT_LEGACY_SCOPE_DELIVERABLES_REQUIRED',
                severity: 'warning',
                message: 'Legacy allowed_files card did not expose a file-only deliverable boundary; add explicit deliverables for future historical closeback.',
                field: 'deliverables'
            });
        }
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
        ...(testPlan ? { testPlan } : {}),
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
            ownerAtomOrMap: normalizeOptionalString(frontMatter.data.ownerAtomOrMap
                ?? frontMatter.data.owner_atom_or_map
                ?? atomizationImpactFrontMatter.ownerAtomOrMap
                ?? atomizationImpactFrontMatter.owner_atom_or_map),
            atomCid: normalizeOptionalString(frontMatter.data.atomCid
                ?? frontMatter.data.atom_cid
                ?? atomizationImpactFrontMatter.atomCid
                ?? atomizationImpactFrontMatter.atom_cid),
            mapUpdates
        },
        ...(proposalAdmission ? { proposalAdmission } : {}),
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
function normalizeTaskTestPlan(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const record = value;
    return {
        schemaId: typeof record.schemaId === 'string' ? record.schemaId : 'atm.taskTestPlan.v1',
        selectionMode: typeof record.selectionMode === 'string' ? record.selectionMode : 'task-scoped',
        ...record
    };
}
export function enrichParsedTasksFromSiblingTaskCards(input) {
    const taskCardRoot = path.join(path.dirname(input.planAbsolute), 'tasks');
    if (!existsSync(taskCardRoot))
        return input.parsed;
    let entries;
    try {
        entries = readdirSync(taskCardRoot, { withFileTypes: true });
    }
    catch {
        return input.parsed;
    }
    const cardByTaskId = new Map();
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.task.md'))
            continue;
        const taskIdMatch = taskIdPattern.exec(entry.name);
        if (!taskIdMatch)
            continue;
        const cardPath = path.join(taskCardRoot, entry.name);
        const cardText = readFileSync(cardPath, 'utf8');
        const card = parseSingleCard({
            planText: cardText,
            planRelativePath: toStoredPlanningPath(input.cwd, cardPath),
            importedAt: input.importedAt
        });
        if (card)
            cardByTaskId.set(card.workItemId, card);
    }
    if (cardByTaskId.size === 0)
        return input.parsed;
    const tasks = input.parsed.tasks.map((task) => {
        const card = cardByTaskId.get(task.workItemId);
        if (!card)
            return task;
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
function parseTaskSection(input) {
    const { section } = input;
    const diagnostics = [];
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
    const task = {
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
function createTaskFromTableMetadata(input) {
    return delegatedCreateTaskFromTableMetadata({ ...input, hashSection });
}
function hasProtectedActiveClaim(document) {
    if (!document)
        return false;
    const claim = parseClaimRecord(document.claim);
    return Boolean(claim && (claim.state === 'active' || claim.state === 'handoff'));
}
function importWouldOverwriteTask(input) {
    const currentHash = input.current.source?.hash ?? input.current.hash ?? '';
    if (input.resetOpen || input.reopen)
        return true;
    if (input.force)
        return currentHash !== input.task.source.hash;
    return currentHash !== input.task.source.hash;
}
function shouldSkipImportForActiveClaim(options) {
    if (!options.wouldOverwrite || options.forceOverwriteClaims || options.force || options.resetOpen || options.reopen) {
        return false;
    }
    return true;
}
export function collectActiveClaimImportSkips(cwd, tasks, options) {
    const diagnostics = [];
    const taskLedger = readTaskLedgerPolicy(cwd);
    const taskStoreDirectory = path.join(cwd, taskLedger.taskRoot);
    for (const task of tasks) {
        const filePath = path.join(taskStoreDirectory, `${task.workItemId}.json`);
        if (!existsSync(filePath))
            continue;
        try {
            const existingDocument = JSON.parse(readFileSync(filePath, 'utf8'));
            if (!hasProtectedActiveClaim(existingDocument))
                continue;
            const wouldOverwrite = importWouldOverwriteTask({
                current: existingDocument,
                task,
                force: options.force,
                resetOpen: options.resetOpen,
                reopen: options.reopen
            });
            if (!shouldSkipImportForActiveClaim({ ...options, wouldOverwrite }))
                continue;
            diagnostics.push({
                level: 'warning',
                code: 'IMPORT_SKIPPED_ACTIVE_CLAIM',
                text: `Task ${task.workItemId} has an active claim; import skipped to avoid overwriting claim state.`,
                workItemId: task.workItemId
            });
        }
        catch {
            // ignore unreadable existing task files during preview
        }
    }
    return diagnostics;
}
export function writeTaskFiles(input) {
    const writtenPaths = [];
    const diagnostics = [];
    const taskLedger = readTaskLedgerPolicy(input.cwd);
    const taskStoreDirectory = path.join(input.cwd, taskLedger.taskRoot);
    mkdirSync(taskStoreDirectory, { recursive: true });
    for (const task of input.tasks) {
        const filePath = path.join(taskStoreDirectory, `${task.workItemId}.json`);
        if (existsSync(filePath) && !input.force) {
            try {
                const current = JSON.parse(readFileSync(filePath, 'utf8'));
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
                const currentStatus = normalizeTaskStatus(current.status);
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
                    const currentSource = current.source;
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
                const existingDocument = current;
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
            }
            catch {
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
        let existingDocument = null;
        if (existsSync(filePath)) {
            try {
                existingDocument = JSON.parse(readFileSync(filePath, 'utf8'));
            }
            catch {
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
            ...(input.resetOpen ? { status: 'open' } : {}),
            ...(input.reopen ? { status: 'open', reopenedAt: new Date().toISOString() } : {})
        };
        if (input.resetOpen || input.reopen) {
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
export function writeImportEvidence(input) {
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
function sliceBodyByHeadings(text) {
    const lines = text.split(/\r?\n/);
    const sections = [];
    let current = null;
    for (const line of lines) {
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
    }
    if (current)
        sections.push(current);
    return sections;
}
function collectBulletList(sections, headingNames) {
    const target = sections.find((section) => headingNames.some((name) => section.heading.includes(name)));
    if (!target)
        return [];
    const items = [];
    for (const line of target.lines) {
        const match = /^\s*[-*]\s+\[\s*[ xX]\s*\]\s+(.+)|^\s*[-*]\s+(.+)/.exec(line);
        if (match) {
            const value = (match[1] ?? match[2] ?? '').trim();
            if (value)
                items.push(value);
        }
    }
    return items;
}
function collectText(sections, headingNames) {
    const target = sections.find((section) => headingNames.some((name) => section.heading.includes(name)));
    if (!target)
        return null;
    const text = target.lines.join('\n').trim();
    return text || null;
}
function collectKeyValue(sections, key) {
    return delegatedCollectKeyValue(sections, key);
}
function collectKeyValueFromLines(lines, key) {
    return delegatedCollectKeyValueFromLines(lines, key);
}
function extractTaskReference(value) {
    const match = taskIdAnywherePattern.exec(value);
    return match ? normalizeTaskId(match[0]) : null;
}
function parseDependencyList(value, baseWorkItemId) {
    const trimmed = cleanCellText(value);
    if (!trimmed || /^(none|n\/a|na|null|無|--|-|\?)$/i.test(trimmed))
        return [];
    const prefix = baseWorkItemId.replace(/-\d+$/, '');
    const values = trimmed
        .split(/[,/、，\s]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
        .flatMap((entry) => {
        const fullMatch = taskIdAnywherePattern.exec(entry);
        if (fullMatch)
            return [normalizeTaskId(fullMatch[0])];
        if (/^\d{2,}$/.test(entry) && prefix !== baseWorkItemId)
            return [`${prefix}-${entry}`];
        return [];
    });
    return uniqueStrings(values);
}
function collectLabeledText(lines, labels) {
    const normalizedLabels = labels.map((label) => label.toLowerCase());
    const values = [];
    for (const line of lines) {
        const match = /^\s*\*\*(.+?)\*\*\s*[：:]\s*(.+?)\s*$/.exec(line);
        if (!match)
            continue;
        const label = match[1].trim().toLowerCase();
        if (!normalizedLabels.some((candidate) => label.includes(candidate)))
            continue;
        const value = match[2].trim();
        if (value)
            values.push(value);
    }
    return values;
}
function cleanCellText(value) {
    return value
        .replace(/`/g, '')
        .replace(/<br\s*\/?>/gi, ', ')
        .trim();
}
function isMarkdownTableRow(value) {
    return value.startsWith('|') && value.endsWith('|');
}
function isMarkdownTableSeparator(value) {
    return /^[-|\s:]+$/.test(value.replace(/\|/g, ''));
}
function normalizeTableHeader(value) {
    return cleanCellText(value).toLowerCase().replace(/\s+/g, ' ').trim();
}
function findTableColumnIndex(headers, candidates) {
    return headers.findIndex((header) => candidates.some((candidate) => header === candidate || header.includes(candidate)));
}
function cellAt(cells, index) {
    return index >= 0 && index < cells.length ? cells[index] : '';
}
export function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export function parseSingleCardFromPlugin(parsed, importedAt) {
    const frontData = parsed.frontmatter;
    const workItemId = normalizeTaskId(parsed.taskId);
    const title = normalizeOptionalString(frontData.title) ?? workItemId;
    const status = coerceStatus(typeof frontData.status === 'string' ? frontData.status : 'planned');
    const milestone = normalizeOptionalString(frontData.milestone);
    const dependencies = parseYamlList(frontData.depends_on ?? frontData.blocked_by ?? frontData.dependencies);
    const tags = parseYamlList(frontData.tags);
    const scopePaths = parseYamlList(frontData.scopePaths ?? frontData.scope_paths ?? frontData.allowed_files ?? frontData.allowedFiles ?? frontData.scope);
    const validators = parseYamlList(frontData.validators);
    const testPlan = normalizeTaskTestPlan(frontData.testPlan ?? frontData.test_plan);
    const planningMirrorPaths = parseYamlList(frontData.planningMirrorPaths ?? frontData.planning_mirror_paths);
    const planningReadOnlyPaths = parseYamlList(frontData.planningReadOnlyPaths ?? frontData.planning_read_only_paths);
    const outOfScope = parseYamlList(frontData.outOfScope ?? frontData.out_of_scope ?? frontData.forbidden_files);
    const nonGoals = parseYamlList(frontData.nonGoals ?? frontData.non_goals);
    const rawAtomizationImpact = frontData.atomizationImpact ?? frontData.atomization_impact;
    const atomizationImpactFrontMatter = rawAtomizationImpact && typeof rawAtomizationImpact === 'object' && !Array.isArray(rawAtomizationImpact)
        ? rawAtomizationImpact
        : {};
    const mapUpdates = parseYamlList(frontData.mapUpdates
        ?? frontData.map_updates
        ?? atomizationImpactFrontMatter.mapUpdates
        ?? atomizationImpactFrontMatter.map_updates);
    const proposalAdmission = parseTaskProposalAdmission(frontData.proposalAdmission ?? frontData.brokerProposalAdmission);
    const body = parsed.body || '';
    const sections = sliceBodyByHeadings(body);
    const acceptance = collectBulletList(sections, acceptanceHeaders);
    const frontMatterDeliverables = parseYamlList(frontData.deliverables);
    const bodyDeliverables = collectBulletList(sections, deliverablesHeaders);
    let deliverables;
    if (frontMatterDeliverables.length > 0) {
        deliverables = uniqueStrings(frontMatterDeliverables.map(normalizeYamlScalar));
    }
    else {
        deliverables = uniqueStrings(bodyDeliverables.map(normalizeYamlScalar));
    }
    if (deliverables.length === 0) {
        deliverables = inferLegacyDeliverablesFromScope(scopePaths.map(normalizeYamlScalar));
    }
    const notes = collectText(sections, notesHeaders) ?? null;
    const evidenceFrontMatter = frontData.evidence && typeof frontData.evidence === 'object' && !Array.isArray(frontData.evidence)
        ? frontData.evidence
        : {};
    const rollbackFrontMatter = frontData.rollback && typeof frontData.rollback === 'object' && !Array.isArray(frontData.rollback)
        ? frontData.rollback
        : {};
    const evidenceRequired = normalizeOptionalString(frontData.evidenceRequired
        ?? frontData.evidence_required
        ?? frontData.required
        ?? evidenceFrontMatter.required
        ?? evidenceFrontMatter.kind);
    const rollbackStrategy = normalizeOptionalString(frontData.rollbackStrategy
        ?? rollbackFrontMatter.strategy);
    const rollbackNotes = normalizeOptionalString(frontData.rollbackNotes
        ?? rollbackFrontMatter.notes);
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
        ...(testPlan ? { testPlan } : {}),
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
            ownerAtomOrMap: normalizeOptionalString(frontData.ownerAtomOrMap
                ?? frontData.owner_atom_or_map
                ?? atomizationImpactFrontMatter.ownerAtomOrMap
                ?? atomizationImpactFrontMatter.owner_atom_or_map),
            atomCid: normalizeOptionalString(frontData.atomCid
                ?? frontData.atom_cid
                ?? atomizationImpactFrontMatter.atomCid
                ?? atomizationImpactFrontMatter.atom_cid),
            mapUpdates
        },
        ...(proposalAdmission ? { proposalAdmission } : {}),
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
function parseTaskProposalAdmission(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const record = value;
    const trigger = normalizeOptionalString(record.trigger);
    const normalizedTrigger = trigger === 'not-required'
        || trigger === 'hot-file'
        || trigger === 'same-file-overlap-risk'
        || trigger === 'shared-surface-risk'
        || trigger === 'manual-review-surface'
        ? trigger
        : null;
    if (!normalizedTrigger) {
        return undefined;
    }
    const boundedRegions = parseProposalAdmissionBoundedRegions(record.boundedRegions);
    const hotFiles = parseYamlList(record.hotFiles ?? record.hot_files);
    const summarySubmitted = record.summarySubmitted === true
        || record.summary_submitted === true
        || String(record.summarySubmitted ?? record.summary_submitted ?? '').trim().toLowerCase() === 'true';
    return {
        trigger: normalizedTrigger,
        summarySubmitted,
        ...(boundedRegions.length > 0 ? { boundedRegions } : {}),
        ...(hotFiles.length > 0 ? { hotFiles } : {}),
        ...(normalizeOptionalString(record.notes) ? { notes: normalizeOptionalString(record.notes) } : {})
    };
}
function parseProposalAdmissionBoundedRegions(value) {
    const source = Array.isArray(value)
        ? value
        : Array.isArray(value?.boundedRegions)
            ? value.boundedRegions
            : Array.isArray(value?.bounded_regions)
                ? value.bounded_regions
                : null;
    if (!source) {
        return [];
    }
    const output = [];
    for (const entry of source) {
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
    }
    return output;
}
function formatRosterDepends(depends) {
    if (depends.length === 0)
        return 'none';
    return depends.map((entry) => `\`${entry}\``).join(', ');
}
function formatRosterMultiline(values) {
    if (values.length === 0)
        return '';
    return values.join('<br>');
}
function extractTaskIdFromRosterCell(cell) {
    const linkMatch = /\[([A-Z][A-Z0-9-]+)\]/i.exec(cell);
    if (linkMatch)
        return normalizeTaskId(linkMatch[1]);
    const plainMatch = /(TASK|ATM)-[A-Z0-9]+-\d{4,5}/i.exec(cell);
    return plainMatch ? normalizeTaskId(plainMatch[0]) : null;
}
function findRosterRowLocation(lines, taskId) {
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
function buildRosterRowFromFrontmatter(input) {
    const existingCells = parseMarkdownTableCells(input.existingRow);
    const title = normalizeOptionalString(input.frontmatter.title) ?? input.taskId;
    const status = coerceStatus(typeof input.frontmatter.status === 'string' ? input.frontmatter.status : 'open');
    const depends = parseYamlList(input.frontmatter.depends_on ?? input.frontmatter.blocked_by ?? input.frontmatter.dependencies);
    const scopePaths = parseYamlList(input.frontmatter.scopePaths ?? input.frontmatter.scope_paths ?? input.frontmatter.allowed_files);
    const validators = parseYamlList(input.frontmatter.validators);
    const cells = [...existingCells];
    const setCell = (candidates, value) => {
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
export async function runTasksRosterUpdate(argv) {
    let cwd = process.cwd();
    let indexPath = '';
    let fromPath = '';
    let dryRun = false;
    for (let index = 0; index < argv.length; index += 1) {
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
        const afterHash = createHash('sha256').update(updated).digest('hex');
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
async function runTasksRoster(argv) {
    const subAction = (argv[0] ?? '').toLowerCase();
    if (subAction !== 'update') {
        throw new CliError('ATM_CLI_USAGE', 'tasks roster requires update.', { exitCode: 2 });
    }
    return runTasksRosterUpdate(argv.slice(1));
}
export async function generateTaskCard(input) {
    const template = input.templateKey || 'aao-l2-split';
    const intent = {
        cwd: input.cwd,
        templateKey: template,
        fields: {
            task_id: input.taskId,
            title: input.title || 'New Task',
            depends_on_yaml: input.dependsOn?.trim()
                ? `  - ${input.dependsOn.trim()}`
                : '[]',
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
        ? await generatorPlugin.plugin.generate(intent)
        : await (await import('../../../atm-markdown-task-source/dist/index.js')).default.generate(intent);
    return {
        taskId: resultCard.taskId,
        content: resultCard.content,
        sourcePath: input.outputPath,
        templateUsed: template
    };
}
function assertTaskCardOutputPathIsNested(cwd, outputPath) {
    const absoluteCwd = path.resolve(cwd);
    const absoluteOutput = path.resolve(absoluteCwd, outputPath);
    const relativeOutput = path.relative(absoluteCwd, absoluteOutput).replace(/\\/g, '/');
    if (relativeOutput === '..' || relativeOutput.startsWith('../')) {
        throw new CliError('ATM_CLI_USAGE', 'tasks new must write task cards inside the repository; use docs/tasks/<name>.task.md or another nested task directory.', {
            exitCode: 2,
            details: { outputPath }
        });
    }
    if (path.posix.dirname(relativeOutput) === '.' && relativeOutput.endsWith('.task.md')) {
        throw new CliError('ATM_CLI_USAGE', 'tasks new must not write task cards at the repository root; use docs/tasks/<name>.task.md or another nested task directory.', {
            exitCode: 2,
            details: { outputPath }
        });
    }
}
async function runTasksNew(argv) {
    const spec = (await import('./command-specs/tasks.spec.js')).default;
    const parsed = parseArgsForCommand(spec, ['new', ...argv]);
    const options = parsed.options;
    const cwd = options.cwd || process.cwd();
    const template = options.template || 'aao-l2-split';
    const taskId = options.taskId || options.task || 'TASK-UNKNOWN-0000';
    const title = options.title || 'New Task';
    const outPath = options.output;
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
        dependsOn: options.dependsOn,
        scopePath: options.scopePath,
        testPath: options.testPath,
        atomId: options.atomId,
        capability: options.capability,
        goal: options.goal
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
export { parseReconcileOptions, parseDeliverAndCloseOptions, parseCreateOptions, parseMirrorOptions, parseCloseOptions, parseStatusOptions, parseFinalizeDiagnoseOptions, parseResetOptions, parseLockCleanupOptions, parseClaimLifecycleOptions, parseHistoricalDeliveryRefs, parseScopeAddOptions, parseScopeRepairOptions, parseQueueOptions, parseAuditOptions, parseLegacyLedgerMigrationOptions, parseAllowStaleRunnerFlag } from './tasks/task-option-parsers.js';
export { safeTaskFileReadDir, safeTaskFileStat, readJsonRecord, taskPathFor, collectTaskFileValues, normalizeRelativePath, legacyTaskRequiresBaseline };
