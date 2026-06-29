import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getCommandSpec } from './command-specs.js';
import { buildResidueDiagnosisEvidence, generateTaskCard, loadTaskDocumentOrThrow, runTasks, runTasksRosterUpdate } from './tasks/public-surface.js';
import { assertClosebackPlanningPathReady, buildCloseBackendArgv, buildClosebackPlan, buildCloseWriteRollbackSnapshot, buildTaskflowCloseDiagnostics, executeCloseWriteCommitPhase, resolveClosebackPlanningPath, resolveCloseWriteSupport, capturePlanningCardSnapshot, applyPlanningCardCloseback, resolvePlanningRosterPaths } from './taskflow/closeback-orchestration.js';
import { buildAutoEvidencePlan, executeAutoEvidencePlan } from './evidence.js';
import { CliError, makeResult, message, parseArgsForCommand, quoteCliValue, relativePathFrom } from './shared.js';
import { buildDelegationContract, buildTaskflowOpenDiagnostics, loadProfile, resolveOpenerMode, resolveWriteSupport } from './taskflow/profile-loader.js';
import { canResolveHostOpenerPolicy, resolveHostOpenerPolicyDecision } from './taskflow/host-opener-policy.js';
import { buildTaskflowClosePreflight, inspectPlanningAuthorityDelivery, preflightBlockersToWriteReadinessBlockers } from './taskflow/close-preflight.js';
import { withTaskflowOperatorLane } from './emergency/context.js';
import { buildTaskflowCloseWriteReadinessHint } from './taskflow/write-readiness.js';
import { resolveTaskflowDeclaredFiles } from './taskflow/task-scope.js';
import { assertCommitBundleReady, buildTaskflowCommitBundle, commitTaskflowDeliveryFiles, deferGovernanceDirtyFiles, finalizeTaskflowCommitBundle, readStagedFiles, restoreDeferredGovernanceDirtyFiles } from './taskflow/commit-bundle-assembly.js';
import { acquireCloseWindowStagedIndexLock, releaseCloseWindowStagedIndexLock } from './tasks/close-window-lock.js';
function buildTasksNewCommand(input) {
    const parts = ['node atm.mjs tasks new'];
    if (input.template) {
        parts.push(`--template ${input.template}`);
    }
    if (input.taskId) {
        parts.push(`--task-id ${input.taskId}`);
    }
    if (input.title) {
        parts.push(`--title ${JSON.stringify(input.title)}`);
    }
    if (input.outputPath) {
        parts.push(`--output ${input.outputPath}`);
    }
    return parts.join(' ');
}
function buildRosterSyncCommand(input) {
    const parts = ['node atm.mjs tasks roster update', `--index ${input.indexPath}`, `--from ${input.fromPath}`];
    if (input.dryRun) {
        parts.push('--dry-run');
    }
    parts.push('--json');
    return parts.join(' ');
}
async function runRosterSyncFollowUp(input) {
    let result = null;
    try {
        result = await runTasksRosterUpdate([
            '--cwd', input.cwd,
            '--index', input.indexPath,
            '--from', input.fromPath
        ]);
    }
    catch (error) {
        const caught = error instanceof Error
            ? { message: error.message, name: error.name }
            : { message: String(error), name: 'UnknownError' };
        result = makeResult({
            ok: false,
            command: 'tasks roster update',
            cwd: input.cwd,
            mode: 'standalone',
            messages: [
                message('error', 'ATM_TASK_ROSTER_SYNC_FOLLOWUP_EXCEPTION', `Roster follow-up command failed before writing: ${caught.message}`, caught)
            ],
            evidence: {
                indexPath: input.indexPath,
                fromPath: input.fromPath,
                followUpCommand: input.command,
                syncMode: 'follow-up-command',
                failure: caught
            }
        });
    }
    if (!result.ok) {
        input.messages.push(message('warn', 'ATM_TASKFLOW_ROSTER_SYNC_FOLLOWUP_FAILED', `${input.command} returned non-ok result; please rerun this follow-up command manually.`, { command: input.command, indexPath: input.indexPath, fromPath: input.fromPath }));
    }
    return {
        mode: 'follow-up-command',
        command: input.command,
        result
    };
}
function buildTasksImportCommand(input) {
    return `node atm.mjs tasks import --from ${quoteCliValue(input.fromPath)} --write --json`;
}
function buildOrchestrationPlan(input) {
    const resolvedTaskId = input.hostPolicyDecision?.taskId ?? input.taskId ?? null;
    const resolvedOutputPath = input.hostPolicyDecision?.outputPath ?? input.outputPath ?? null;
    const followUpSteps = ['generate-via-tasks-new'];
    if (input.delegationContract.hostOpenerAvailable) {
        followUpSteps.unshift('resolve-delegation');
    }
    if (input.hostPolicyDecision?.sources.taskId === 'host-policy') {
        followUpSteps.push('allocate-task-id-via-host-policy');
    }
    if (input.hostPolicyDecision?.sources.outputPath === 'host-policy') {
        followUpSteps.push('resolve-output-path-via-host-policy');
    }
    if (input.openerMode === 'template-only-fallback') {
        followUpSteps.push('operator-supply-task-id-and-output');
    }
    if (resolvedOutputPath) {
        followUpSteps.push('import-into-runtime');
    }
    const rosterSyncPolicy = input.delegationContract.policy.rosterSyncPolicy;
    const rosterIndexPath = input.rosterIndexPath ?? input.delegationContract.policy.rosterSync.indexPath;
    let rosterFollowUpCommand = null;
    if (rosterSyncPolicy === 'follow-up-command' && rosterIndexPath && resolvedOutputPath) {
        rosterFollowUpCommand = buildRosterSyncCommand({
            indexPath: rosterIndexPath,
            fromPath: resolvedOutputPath
        });
        followUpSteps.push('roster-sync-follow-up-command');
    }
    else if (rosterSyncPolicy === 'inline' && rosterIndexPath && resolvedOutputPath) {
        followUpSteps.push('roster-sync-inline');
    }
    return {
        generationSurface: 'tasks-new',
        wouldInvokeTasksNew: true,
        wouldInvokeTasksImport: Boolean(resolvedOutputPath),
        tasksNewCommand: buildTasksNewCommand({
            taskId: resolvedTaskId,
            outputPath: resolvedOutputPath,
            template: input.template,
            title: input.title
        }),
        tasksImportCommand: resolvedOutputPath
            ? buildTasksImportCommand({
                fromPath: input.outputRoot ? resolveOutputAbsolute(input.outputRoot, resolvedOutputPath) : resolvedOutputPath
            })
            : null,
        hostOpenerInvocation: input.delegationContract.displayHint,
        rosterSyncPolicy,
        rosterIndexPath,
        rosterFollowUpCommand,
        followUpRequired: input.openerMode === 'template-only-fallback'
            || !resolvedTaskId
            || !resolvedOutputPath
            || (rosterSyncPolicy === 'follow-up-command' && Boolean(rosterFollowUpCommand)),
        followUpSteps,
        targetRepo: input.profile?.ownerRepo ?? 'adopter-repo',
        outputRepoRoot: input.outputRoot ?? null,
        profileRepoLabel: input.profile?.repoLabel ?? 'adopter-repo',
        policyDecision: {
            allocateTaskId: input.delegationContract.policy.allocateTaskId,
            resolveCanonicalOutputPath: input.delegationContract.policy.resolveCanonicalOutputPath,
            rosterSyncPolicy,
            rosterSyncIndexPath: rosterIndexPath,
            fallbackBehavior: input.delegationContract.policy.fallbackBehavior
        },
        hostPolicyDecision: input.hostPolicyDecision ?? null
    };
}
function uniqueTaskIds(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function buildWriteReadinessHint(input) {
    if (input.openerMode === 'delegated-governed') {
        return {
            schemaId: 'atm.taskflowOpenWriteReadinessHint.v1',
            status: 'ready',
            summary: 'taskflow open --write is ready to orchestrate the governed opener lane.',
            missingPrerequisites: [],
            nextCommand: 'node atm.mjs taskflow open --write --json',
            operatorLane: 'taskflow open',
            fallbackSurface: null
        };
    }
    const policy = input.delegationContract.policy;
    const missing = [];
    if (!input.profileLoaded) {
        missing.push('Load a planning/adopter profile via --profile <adopter-repo>/taskflow.profile.json');
    }
    else if (!input.delegationContract.invocable) {
        missing.push('Profile delegation must declare an invocable host opener (delegation.openerPath set and delegation.writerInvocation.describeOnly = false)');
    }
    const resolvedTaskId = input.hostPolicyDecision?.taskId ?? input.taskId;
    if (policy.allocateTaskId.mode !== 'host-opener' && !resolvedTaskId) {
        missing.push('Either set delegation.policy.allocateTaskId.mode = "host-opener" in the profile, or pass --task-id TASK-XXX-NNNN explicitly');
    }
    const resolvedOutputPath = input.hostPolicyDecision?.outputPath ?? input.outputPath;
    if (policy.resolveCanonicalOutputPath.mode !== 'host-opener' && !resolvedOutputPath) {
        missing.push('Either set delegation.policy.resolveCanonicalOutputPath.mode = "host-opener" in the profile, or pass --output <planning-relative-path> explicitly');
    }
    const status = input.openerMode === 'template-only-fallback' ? 'fallback' : 'incomplete';
    const summary = status === 'fallback'
        ? 'taskflow open --write will fail closed in template-only-fallback mode. Configure the listed prerequisites, or use tasks new as the explicit low-level generator surface.'
        : 'taskflow open --write prerequisites are incomplete. Resolve the listed items before retrying --write.';
    return {
        schemaId: 'atm.taskflowOpenWriteReadinessHint.v1',
        status,
        summary,
        missingPrerequisites: missing,
        nextCommand: null,
        operatorLane: 'taskflow open',
        fallbackSurface: 'tasks new (low-level generator)'
    };
}
function collectHistoricalDeliveryRefs(parsed) {
    const refs = [];
    const historicalDelivery = parsed.options.historicalDelivery;
    if (Array.isArray(historicalDelivery)) {
        refs.push(...historicalDelivery.map(String));
    }
    else if (typeof historicalDelivery === 'string' && historicalDelivery.trim()) {
        refs.push(historicalDelivery);
    }
    const deliveryCommit = parsed.options.deliveryCommit ? String(parsed.options.deliveryCommit) : null;
    if (deliveryCommit) {
        refs.push(deliveryCommit);
    }
    return [...new Set(refs)];
}
function collectHistoricalBatchRef(parsed) {
    const value = parsed.options.historicalBatch;
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function collectWaiverOutOfScopeDelivery(parsed) {
    const waiverOutOfScopeDelivery = parsed.options.waiverOutOfScopeDelivery === true || parsed.options.waiveOutOfScope === true;
    const reason = typeof parsed.options.reason === 'string' && parsed.options.reason.trim()
        ? parsed.options.reason.trim()
        : null;
    if (waiverOutOfScopeDelivery && !reason) {
        throw new CliError('ATM_TASKFLOW_CLOSE_WAIVER_REASON_REQUIRED', 'taskflow close --waiver-out-of-scope-delivery requires --reason <text>.', {
            exitCode: 2
        });
    }
    return {
        waiverOutOfScopeDelivery,
        waiverReason: reason
    };
}
function resolveHistoricalBatchPath(cwd, batchRef) {
    const trimmed = batchRef.trim();
    if (!trimmed)
        return null;
    if (path.isAbsolute(trimmed))
        return trimmed;
    if (trimmed.includes('/') || trimmed.includes('\\'))
        return path.resolve(cwd, trimmed);
    return path.join(cwd, '.atm', 'history', 'evidence', 'historical-batches', trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`);
}
function loadHistoricalBatchMatchedCommits(cwd, taskId, batchRef) {
    const batchPath = resolveHistoricalBatchPath(cwd, batchRef);
    if (!batchPath || !existsSync(batchPath)) {
        throw new CliError('ATM_TASKFLOW_CLOSE_HISTORICAL_BATCH_NOT_FOUND', `Historical batch evidence not found for ${batchRef}.`, {
            exitCode: 1,
            details: { taskId, batchRef, batchPath: batchPath ? relativePathFrom(cwd, batchPath) : null }
        });
    }
    const envelope = JSON.parse(readFileSync(batchPath, 'utf8'));
    const tasks = Array.isArray(envelope.tasks) ? envelope.tasks : [];
    const rawSlice = tasks.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) && String(entry.taskId ?? '') === taskId);
    if (!rawSlice) {
        throw new CliError('ATM_TASKFLOW_CLOSE_HISTORICAL_BATCH_TASK_NOT_FOUND', `Historical batch ${batchRef} does not contain task ${taskId}.`, {
            exitCode: 1,
            details: { taskId, batchRef, batchPath: relativePathFrom(cwd, batchPath) }
        });
    }
    if (rawSlice.okToCloseTask !== true) {
        throw new CliError('ATM_TASKFLOW_CLOSE_HISTORICAL_BATCH_NOT_CLOSE_READY', `Historical batch ${batchRef} task slice for ${taskId} is not close-ready.`, {
            exitCode: 1,
            details: {
                taskId,
                batchRef,
                batchPath: relativePathFrom(cwd, batchPath),
                coverageStatus: rawSlice.coverageStatus ?? null,
                okToRecordEvidence: rawSlice.okToRecordEvidence === true,
                okToCloseTask: rawSlice.okToCloseTask === true,
                diagnosticOnly: rawSlice.diagnosticOnly === true,
                missingCoverage: Array.isArray(rawSlice.missingCoverage) ? rawSlice.missingCoverage : []
            }
        });
    }
    return Array.isArray(rawSlice.matchedCommits)
        ? rawSlice.matchedCommits.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
        : [];
}
function resolveExistingHistoricalBatchStageFile(cwd, batchRef) {
    if (!batchRef)
        return null;
    const batchPath = resolveHistoricalBatchPath(cwd, batchRef);
    if (!batchPath || !existsSync(batchPath))
        return null;
    return normalizeRepoRelativePath(cwd, batchPath);
}
function normalizeRepoRelativePath(repoRoot, filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(repoRoot, filePath);
    return relativePathFrom(repoRoot, resolved).replace(/\\/g, '/');
}
function uniqueSorted(values) {
    return [...new Set(values.map((value) => value.replace(/\\/g, '/')).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function listExistingFilesRecursively(root, relativeDirectory) {
    const directory = path.join(root, relativeDirectory);
    if (!existsSync(directory))
        return [];
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relativePath = path.posix.join(relativeDirectory.replace(/\\/g, '/'), entry.name);
        const absolutePath = path.join(root, relativePath);
        if (entry.isDirectory()) {
            files.push(...listExistingFilesRecursively(root, relativePath));
        }
        else if (entry.isFile()) {
            files.push(normalizeRepoRelativePath(root, absolutePath));
        }
    }
    return files;
}
function tryGitScalar(cwd, args) {
    try {
        return execFileSync('git', [...args], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        }).trim() || null;
    }
    catch {
        return null;
    }
}
function readGitRoot(startPath) {
    const probe = existsSync(startPath) && statSync(startPath).isDirectory() ? startPath : path.dirname(startPath);
    const root = tryGitScalar(probe, ['rev-parse', '--show-toplevel']);
    return root ? path.resolve(root) : null;
}
function resolveProfileRepoRoot(profilePath, fallbackCwd) {
    if (!profilePath)
        return fallbackCwd;
    const resolvedProfilePath = path.resolve(profilePath);
    return readGitRoot(resolvedProfilePath) ?? path.dirname(resolvedProfilePath);
}
function resolveTaskflowOpenOutputRoot(input) {
    if (!input.profile)
        return input.cwd;
    return resolveProfileRepoRoot(input.profilePath, input.cwd);
}
function resolveOutputAbsolute(root, outputPath) {
    return path.isAbsolute(outputPath) ? path.resolve(outputPath) : path.resolve(root, outputPath);
}
function runGitOrThrow(cwd, args) {
    execFileSync('git', [...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}
async function runTaskflowClose(parsed, cwd, surface = 'close') {
    const taskId = parsed.options.task ? String(parsed.options.task) : '';
    const actorId = parsed.options.actor ? String(parsed.options.actor) : '';
    const writeRequested = !!parsed.options.write;
    const noCommitRequested = !!parsed.options.noCommit;
    const autoEvidenceRequested = parsed.options.autoEvidence === true;
    const deferForeignState = parsed.options.deferForeignState === true;
    const deferForeignStaged = parsed.options.deferForeignStaged === true || deferForeignState;
    const deferGovernanceDirty = parsed.options.deferGovernanceDirty === true || deferForeignState;
    const commitMode = writeRequested
        ? noCommitRequested ? 'stage-only' : 'auto-commit'
        : 'dry-run';
    const profilePath = parsed.options.profile ? String(parsed.options.profile) : null;
    const historicalBatchRef = collectHistoricalBatchRef(parsed);
    const waiver = collectWaiverOutOfScopeDelivery(parsed);
    const explicitHistoricalDeliveryRefs = collectHistoricalDeliveryRefs(parsed);
    const historicalBatchMatchedCommits = historicalBatchRef
        ? loadHistoricalBatchMatchedCommits(cwd, taskId, historicalBatchRef)
        : [];
    const historicalDeliveryRefs = uniqueSorted([
        ...explicitHistoricalDeliveryRefs,
        ...historicalBatchMatchedCommits
    ]);
    if (!taskId) {
        throw new CliError('ATM_CLI_USAGE', `taskflow ${surface} requires --task <work-item-id>.`, { exitCode: 2 });
    }
    if (surface === 'pre-close' && !actorId) {
        throw new CliError('ATM_CLI_USAGE', 'taskflow pre-close requires --actor <id>.', { exitCode: 2 });
    }
    let profileData = null;
    if (profilePath) {
        profileData = loadProfile(profilePath);
    }
    const delegationContract = buildDelegationContract(profileData);
    const { taskDocument } = loadTaskDocumentOrThrow(cwd, taskId);
    const profileRepoRoot = profilePath && profileData
        ? resolveProfileRepoRoot(profilePath, cwd)
        : null;
    const closebackPathResolution = resolveClosebackPlanningPath({
        cwd,
        taskId,
        taskDocument,
        profile: profileData,
        profileRepoRoot,
        delegationContract
    });
    if (profileData || writeRequested) {
        assertClosebackPlanningPathReady(closebackPathResolution, {
            profileSupplied: Boolean(profileData),
            requirePlanningPath: true
        });
    }
    const diagnosis = buildResidueDiagnosisEvidence(cwd, taskId, taskDocument);
    const enrichedDiagnosis = closebackPathResolution.planningMirrorPath
        ? {
            ...diagnosis,
            triangulation: {
                ...diagnosis.triangulation,
                planningFrontmatter: {
                    status: closebackPathResolution.planningStatus ?? diagnosis.triangulation.planningFrontmatter.status,
                    source: closebackPathResolution.planningMirrorPath
                }
            }
        }
        : diagnosis;
    const planningAuthorityDeliveryGate = inspectPlanningAuthorityDelivery({
        cwd,
        taskDocument,
        historicalDeliveryRefs,
        resolvedPlanningMirrorPath: closebackPathResolution.planningMirrorPath
    });
    if (planningAuthorityDeliveryGate.required
        && historicalDeliveryRefs.length > 0
        && !planningAuthorityDeliveryGate.ok) {
        throw new CliError('ATM_TASKFLOW_CLOSE_PLANNING_DELIVERY_INVALID', 'taskflow close could not verify the supplied planning-repo delivery commit against the task deliverables.', {
            exitCode: 1,
            details: {
                taskId,
                planningAuthorityDeliveryGate,
                historicalDeliveryRefs
            }
        });
    }
    const closebackPlan = buildClosebackPlan({
        taskId,
        actorId: actorId || '<actor>',
        historicalDeliveryRefs,
        historicalBatchRef,
        waiverOutOfScopeDelivery: waiver.waiverOutOfScopeDelivery,
        waiverReason: waiver.waiverReason,
        planningAuthorityDeliveryGate,
        delegationContract,
        diagnosis: {
            bucket: enrichedDiagnosis.bucket,
            truth: enrichedDiagnosis.truth,
            residue: enrichedDiagnosis.residue,
            reason: enrichedDiagnosis.reason,
            nextCommand: enrichedDiagnosis.nextCommand,
            triangulation: enrichedDiagnosis.triangulation
        },
        closebackPathResolution
    });
    const diagnostics = buildTaskflowCloseDiagnostics({
        closeMode: closebackPlan.closeMode,
        writeRequested,
        actorSupplied: actorId.length > 0,
        taskIdSupplied: taskId.length > 0
    });
    const previewCommitBundle = buildTaskflowCommitBundle({
        cwd,
        taskId,
        actorId: actorId || null,
        commitMode,
        planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath,
        rosterIndexPath: closebackPlan.writerBoundary.rosterSyncPolicy === 'inline'
            ? closebackPlan.writerBoundary.rosterIndexPath
            : null,
        historicalDeliveryRefs,
        historicalBatchRef,
        planningAuthorityDeliveryOk: planningAuthorityDeliveryGate.ok
    });
    const hasUncommittedDeliverables = previewCommitBundle.targetDeliveryFiles.length > 0;
    const declaredFiles = [...resolveTaskflowDeclaredFiles(cwd, taskId, taskDocument)];
    const historicalClosePreflight = buildTaskflowClosePreflight({
        cwd,
        taskId,
        actorId: actorId || '<actor>',
        taskDocument,
        previewCommitBundle,
        historicalDeliveryRefs,
        waiverOutOfScopeDelivery: waiver.waiverOutOfScopeDelivery,
        waiverReason: waiver.waiverReason
    });
    let writeReadinessHint = buildTaskflowCloseWriteReadinessHint({
        cwd,
        taskId,
        actorId,
        taskDocument,
        declaredFiles,
        closebackPlan,
        previewCommitBundle,
        historicalDeliveryRefs,
        waiverOutOfScopeDelivery: waiver.waiverOutOfScopeDelivery,
        waiverReason: waiver.waiverReason,
        planningAuthorityDeliveryGate
    });
    if (historicalClosePreflight.blockers.length > 0) {
        const mergedBlockers = [
            ...writeReadinessHint.blockers,
            ...preflightBlockersToWriteReadinessBlockers(historicalClosePreflight)
        ];
        writeReadinessHint = {
            ...writeReadinessHint,
            status: 'blocked',
            summary: `taskflow close --write has ${mergedBlockers.length} known blocker(s) that dry-run can already disclose.`,
            blockers: mergedBlockers,
            nextCommand: mergedBlockers[0]?.requiredCommand ?? writeReadinessHint.nextCommand
        };
    }
    const autoEvidencePlan = actorId
        ? buildAutoEvidencePlan({
            cwd,
            taskId,
            actorId,
            mode: writeRequested && autoEvidenceRequested ? 'execute' : 'dry-run'
        })
        : null;
    if (surface === 'pre-close') {
        return {
            ...makeResult({
                ok: historicalClosePreflight.ok,
                command: 'taskflow pre-close',
                cwd,
                mode: 'pre-close',
                messages: [
                    message(historicalClosePreflight.ok ? 'info' : 'warn', historicalClosePreflight.ok ? 'ATM_TASKFLOW_PRECLOSE_READY' : 'ATM_TASKFLOW_PRECLOSE_BLOCKED', historicalClosePreflight.ok
                        ? `taskflow pre-close found no blockers for ${taskId}; inspect writeRollbackSummary before --write.`
                        : `taskflow pre-close found ${historicalClosePreflight.blockers.length} blocker(s) for ${taskId}; resolve them before taskflow close --write.`, { taskId, blockerCount: historicalClosePreflight.blockers.length })
                ],
                evidence: {
                    historicalClosePreflight,
                    writeReadinessHint,
                    closebackPlan,
                    governedCommitBundle: previewCommitBundle,
                    residueDiagnosis: enrichedDiagnosis,
                    closebackPathResolution,
                    ...(autoEvidencePlan ? { autoEvidencePlan } : {}),
                    ...(profileData ? { profile: profileData } : {})
                }
            }),
            schemaId: 'atm.taskflowPreCloseResult.v1',
            writeEnabled: false,
            historicalClosePreflight
        };
    }
    const writeSupport = resolveCloseWriteSupport({
        writeRequested,
        closeMode: closebackPlan.closeMode,
        actorSupplied: actorId.length > 0,
        taskIdSupplied: taskId.length > 0,
        historicalDeliveryGateRequired: closebackPlan.historicalDeliveryGate.required && !hasUncommittedDeliverables,
        historicalDeliverySupplied: historicalDeliveryRefs.length > 0 || historicalBatchRef !== null
    });
    if (writeRequested && !writeSupport.allowed) {
        throw new CliError(closebackPlan.closeMode === 'ambiguous-manual-review'
            ? 'ATM_TASKFLOW_CLOSE_AMBIGUOUS_RESIDUE'
            : 'ATM_TASKFLOW_CLOSE_WRITE_BLOCKED', writeSupport.reason, {
            exitCode: 1,
            details: {
                closeMode: closebackPlan.closeMode,
                writeSupport,
                diagnostics,
                closebackPlan,
                recommendedCommand: diagnosis.nextCommand
            }
        });
    }
    if (writeRequested) {
        assertCommitBundleReady(previewCommitBundle);
    }
    if (writeRequested && writeSupport.allowed) {
        let autoEvidenceExecution = null;
        if (autoEvidenceRequested) {
            if (!actorId) {
                throw new CliError('ATM_CLI_USAGE', 'taskflow close --auto-evidence requires --actor <id>.', { exitCode: 2 });
            }
            autoEvidenceExecution = executeAutoEvidencePlan({ cwd, taskId, actorId });
            if (!autoEvidenceExecution.ok) {
                throw new CliError('ATM_TASKFLOW_AUTO_EVIDENCE_FAILED', `Auto-evidence could not satisfy declared validators for ${taskId}.`, {
                    exitCode: 1,
                    details: {
                        taskId,
                        failedValidator: autoEvidenceExecution.failedValidator,
                        remediationCommand: autoEvidenceExecution.remediationCommand,
                        autoEvidenceExecution
                    }
                });
            }
        }
        if (previewCommitBundle.targetDeliveryFiles.length > 0 && commitMode !== 'auto-commit') {
            throw new CliError('ATM_TASKFLOW_CLOSE_DELIVERY_COMMIT_REQUIRED', 'taskflow close --write --no-commit cannot close dirty source deliverables because backend close requires a delivery commit first. Rerun without --no-commit or commit through the governed taskflow close operator lane.', {
                exitCode: 1,
                details: {
                    taskId,
                    governedCommitBundle: previewCommitBundle,
                    remediation: `node atm.mjs taskflow close --task ${taskId} --actor ${actorId || '<actor>'} --write --json`
                }
            });
        }
        const taskLedgerPath = path.join(cwd, '.atm/history/tasks', `${taskId}.json`);
        const previousTaskContent = existsSync(taskLedgerPath) ? readFileSync(taskLedgerPath, 'utf8') : '';
        const planningCardSnapshot = capturePlanningCardSnapshot({
            cwd,
            planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath
        });
        const expectedCloseWindowStageFiles = uniqueSorted([
            ...previewCommitBundle.targetRepo.stageFiles,
            ...previewCommitBundle.targetDeliveryFiles,
            ...previewCommitBundle.targetGovernanceFiles
        ]);
        let closeWindowLock = null;
        let closeWindowLockReleased = false;
        let deferredGovernanceDirty = deferGovernanceDirtyFiles(cwd, deferGovernanceDirty);
        let deferredGovernanceDirtyRestored = false;
        try {
            closeWindowLock = acquireCloseWindowStagedIndexLock({
                cwd,
                taskId,
                actorId,
                expectedStageFiles: expectedCloseWindowStageFiles,
                deferForeignStaged
            });
            if (!closeWindowLock.ok) {
                throw new CliError(closeWindowLock.blockedCode ?? 'ATM_CLOSE_WINDOW_STAGED_INDEX_BLOCKED', closeWindowLock.blockedSummary ?? 'Close window staged-index lock could not be acquired.', {
                    exitCode: 1,
                    details: {
                        taskId,
                        actorId,
                        closeWindowLock,
                        deferForeignStagedCommand: `node atm.mjs taskflow close --task ${taskId} --actor ${quoteCliValue(actorId)} --defer-foreign-staged --write --json`
                    }
                });
            }
            const preCloseStagedFiles = readStagedFiles(cwd);
            const preCloseDeliveryCommit = await commitTaskflowDeliveryFiles({
                bundle: previewCommitBundle,
                actorId,
                taskId
            });
            const effectiveHistoricalDeliveryRefs = preCloseDeliveryCommit?.commitSha
                ? uniqueSorted([...historicalDeliveryRefs, preCloseDeliveryCommit.commitSha])
                : historicalDeliveryRefs;
            const backendArgv = buildCloseBackendArgv({
                cwd,
                taskId,
                actorId,
                backendSurface: closebackPlan.backendSurface,
                historicalDeliveryRefs: effectiveHistoricalDeliveryRefs,
                historicalBatchRef,
                historicalDeliveryRepo: closebackPlan.planningAuthorityDeliveryGate.ok
                    ? closebackPlan.planningAuthorityDeliveryGate.repoRoot
                    : null,
                waiverOutOfScopeDelivery: waiver.waiverOutOfScopeDelivery,
                waiverReason: waiver.waiverReason,
                planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath,
                forceImport: diagnosis.bucket === 'stale-import'
            });
            const backendResult = await withTaskflowOperatorLane(() => runTasks(backendArgv));
            const rollbackSnapshot = buildCloseWriteRollbackSnapshot({
                cwd,
                taskId,
                previousTaskContent,
                backendEvidence: backendResult.evidence,
                planningCard: planningCardSnapshot,
                closeWindowStagedIndexLockActive: closeWindowLock?.ok === true,
                preCloseStagedFiles
            });
            const planningCardCloseback = closebackPlan.backendSurface === 'tasks-close' && backendResult.ok
                ? applyPlanningCardCloseback({
                    cwd,
                    planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath,
                    actorId,
                    historicalDeliveryRefs: effectiveHistoricalDeliveryRefs
                })
                : null;
            const rollbackSnapshotWithPlanning = planningCardCloseback?.transitionPath && rollbackSnapshot.planningCard
                ? {
                    ...rollbackSnapshot,
                    planningCard: {
                        ...rollbackSnapshot.planningCard,
                        transitionPath: planningCardCloseback.transitionPath
                    },
                    stagedArtifacts: [...rollbackSnapshot.stagedArtifacts, planningCardCloseback.transitionPath]
                }
                : rollbackSnapshot;
            let rosterCloseback = null;
            const closeMessages = [];
            const planningRosterPaths = closebackPlan.writerBoundary.rosterClosebackCommand && closebackPlan.writerBoundary.rosterIndexPath && closebackPlan.writerBoundary.planningMirrorPath
                ? resolvePlanningRosterPaths({
                    cwd,
                    planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath,
                    rosterIndexPath: closebackPlan.writerBoundary.rosterIndexPath
                })
                : null;
            if (closebackPlan.writerBoundary.rosterClosebackCommand
                && closebackPlan.writerBoundary.rosterSyncPolicy === 'inline'
                && closebackPlan.writerBoundary.rosterIndexPath
                && closebackPlan.writerBoundary.planningMirrorPath) {
                if (!planningRosterPaths?.repoRoot || !planningRosterPaths?.indexPath || !planningRosterPaths?.fromPath) {
                    throw new CliError('ATM_TASKFLOW_CLOSE_PLANNING_ROSTER_UNRESOLVED', planningRosterPaths?.reason ?? 'taskflow close could not resolve planning roster paths.', {
                        exitCode: 1,
                        details: { closebackPlan }
                    });
                }
                rosterCloseback = {
                    mode: 'inline',
                    command: closebackPlan.writerBoundary.rosterClosebackCommand,
                    result: await runTasksRosterUpdate([
                        '--cwd', planningRosterPaths.repoRoot,
                        '--index', planningRosterPaths.indexPath,
                        '--from', planningRosterPaths.fromPath
                    ])
                };
            }
            else if (closebackPlan.writerBoundary.rosterClosebackCommand
                && closebackPlan.writerBoundary.rosterSyncPolicy === 'follow-up-command') {
                if (!planningRosterPaths?.repoRoot || !planningRosterPaths.indexPath || !planningRosterPaths.fromPath) {
                    closeMessages.push(message('warn', 'ATM_TASKFLOW_CLOSE_ROSTER_SYNC_FOLLOWUP_UNRESOLVED', 'taskflow close --write could not resolve planning roster paths for the follow-up sync; please rerun the roster update command manually.', { command: closebackPlan.writerBoundary.rosterClosebackCommand }));
                    rosterCloseback = {
                        mode: 'follow-up-command',
                        command: closebackPlan.writerBoundary.rosterClosebackCommand
                    };
                }
                else {
                    const command = buildRosterSyncCommand({
                        indexPath: planningRosterPaths.indexPath,
                        fromPath: planningRosterPaths.fromPath
                    });
                    rosterCloseback = await runRosterSyncFollowUp({
                        command,
                        cwd: planningRosterPaths.repoRoot,
                        indexPath: planningRosterPaths.indexPath,
                        fromPath: planningRosterPaths.fromPath,
                        messages: closeMessages
                    });
                }
            }
            const commitBundleInput = buildTaskflowCommitBundle({
                cwd,
                taskId,
                actorId,
                commitMode,
                planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath,
                rosterIndexPath: closebackPlan.writerBoundary.rosterSyncPolicy === 'inline'
                    ? closebackPlan.writerBoundary.rosterIndexPath
                    : null,
                extraPlanningStageFiles: planningCardCloseback?.transitionPath ? [planningCardCloseback.transitionPath] : [],
                backendResult: backendResult,
                historicalDeliveryRefs: effectiveHistoricalDeliveryRefs,
                historicalBatchRef,
                planningAuthorityDeliveryOk: planningAuthorityDeliveryGate.ok
            });
            const { bundle: governedCommitBundle, transaction: closeWriteTransaction } = backendResult.ok
                ? await executeCloseWriteCommitPhase({
                    cwd,
                    taskId,
                    actorId,
                    snapshot: rollbackSnapshotWithPlanning,
                    commit: () => finalizeTaskflowCommitBundle({
                        bundle: commitBundleInput,
                        actorId,
                        taskId
                    })
                })
                : {
                    bundle: commitBundleInput,
                    transaction: {
                        schemaId: 'atm.closeWriteTransaction.v1',
                        taskId,
                        phase: 'pending',
                        ok: false,
                        failureStep: 'backend-close',
                        failureCode: 'ATM_TASKFLOW_CLOSE_WRITE_FAILED',
                        failureReason: 'backend close did not complete',
                        rolledBackArtifacts: [],
                        recoveryCommand: diagnosis.nextCommand,
                        backendCloseApplied: false,
                        commitBundleApplied: false
                    }
                };
            const writeOk = backendResult.ok && closeWriteTransaction.ok && !governedCommitBundle.failClosed;
            closeMessages.push(message(writeOk ? 'info' : 'error', writeOk
                ? 'ATM_TASKFLOW_CLOSE_WRITE_ORCHESTRATED'
                : closeWriteTransaction.phase === 'rolled_back'
                    ? 'ATM_TASKFLOW_CLOSE_WRITE_ROLLED_BACK'
                    : 'ATM_TASKFLOW_CLOSE_WRITE_FAILED', writeOk
                ? `taskflow close orchestrated ${closebackPlan.backendSurface} for ${taskId}.`
                : closeWriteTransaction.phase === 'rolled_back'
                    ? `taskflow close --write rolled back ${taskId} after a commit-bundle failure; ledger close state was restored.`
                    : `taskflow close write failed for ${taskId}.`, { closeMode: closebackPlan.closeMode, backendSurface: closebackPlan.backendSurface }));
            const releasedCloseWindowLock = releaseCloseWindowStagedIndexLock({
                cwd,
                taskId,
                actorId,
                outcome: writeOk ? 'committed' : closeWriteTransaction.phase === 'rolled_back' ? 'rolled_back' : 'aborted'
            });
            closeWindowLockReleased = true;
            deferredGovernanceDirty = restoreDeferredGovernanceDirtyFiles(cwd, deferredGovernanceDirty);
            deferredGovernanceDirtyRestored = true;
            return {
                ...makeResult({
                    ok: writeOk,
                    command: 'taskflow close',
                    cwd,
                    mode: 'write',
                    messages: closeMessages,
                    evidence: {
                        closeMode: closebackPlan.closeMode,
                        writeSupport,
                        commitMode,
                        delegationContract,
                        diagnostics,
                        closebackPlan,
                        backendResult,
                        preCloseDeliveryCommit,
                        planningCardCloseback,
                        rosterCloseback,
                        governedCommitBundle,
                        closeWriteTransaction,
                        closeWindowLock,
                        releasedCloseWindowLock,
                        deferredGovernanceDirty,
                        residueDiagnosis: enrichedDiagnosis,
                        closebackPathResolution,
                        ...(autoEvidenceExecution ? { autoEvidenceExecution, autoEvidencePlan: autoEvidenceExecution.plan } : {}),
                        ...(profileData ? { profile: profileData } : {})
                    }
                }),
                schemaId: 'atm.taskflowCloseResult.v1',
                writeEnabled: true
            };
        }
        finally {
            if (closeWindowLock?.ok && !closeWindowLockReleased) {
                releaseCloseWindowStagedIndexLock({
                    cwd,
                    taskId,
                    actorId,
                    outcome: 'aborted'
                });
            }
            if (!deferredGovernanceDirtyRestored) {
                restoreDeferredGovernanceDirtyFiles(cwd, deferredGovernanceDirty);
            }
        }
    }
    return {
        ...makeResult({
            ok: true,
            command: 'taskflow close',
            cwd,
            mode: 'dry-run',
            messages: [
                message(closebackPlan.closeMode === 'ambiguous-manual-review' || writeReadinessHint.status === 'blocked' ? 'warn' : 'info', closebackPlan.closeMode === 'ambiguous-manual-review'
                    ? 'ATM_TASKFLOW_CLOSE_AMBIGUOUS_RESIDUE'
                    : writeReadinessHint.status === 'blocked'
                        ? 'ATM_TASKFLOW_CLOSE_WRITE_NOT_READY'
                        : 'ATM_TASKFLOW_CLOSE_ORCHESTRATION_READY', closebackPlan.closeMode === 'ambiguous-manual-review'
                    ? 'taskflow close dry-run blocked on ambiguous residue; operator review required.'
                    : writeReadinessHint.status === 'blocked'
                        ? `taskflow close dry-run found known write blockers (${closebackPlan.closeMode}); inspect writeReadinessHint before --write.`
                        : `taskflow close dry-run plan is ready (${closebackPlan.closeMode}).`, { taskId, closeMode: closebackPlan.closeMode })
            ],
            evidence: {
                closeMode: closebackPlan.closeMode,
                commitMode,
                writeSupport,
                writeReadinessHint,
                delegationContract,
                diagnostics,
                closebackPlan,
                governedCommitBundle: previewCommitBundle,
                historicalClosePreflight,
                residueDiagnosis: enrichedDiagnosis,
                closebackPathResolution,
                ...(autoEvidencePlan ? { autoEvidencePlan } : {}),
                ...(profileData ? { profile: profileData } : {})
            }
        }),
        schemaId: 'atm.taskflowCloseResult.v1',
        writeEnabled: false
    };
}
export async function runTaskflow(argv = []) {
    const spec = getCommandSpec('taskflow');
    if (!spec) {
        throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for taskflow.', { exitCode: 2 });
    }
    const parsed = parseArgsForCommand(spec, argv);
    const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
    const action = parsed.positional[0];
    if (action === 'close') {
        return runTaskflowClose(parsed, cwd, 'close');
    }
    if (action === 'pre-close') {
        return runTaskflowClose(parsed, cwd, 'pre-close');
    }
    if (action !== 'open') {
        throw new CliError('ATM_CLI_USAGE', `Unknown taskflow action: ${action}. Supported actions: open, close, pre-close.`, { exitCode: 2 });
    }
    const writeRequested = !!parsed.options.write;
    const profilePath = parsed.options.profile ? String(parsed.options.profile) : null;
    const taskId = parsed.options.taskId ? String(parsed.options.taskId) : null;
    const outputPath = parsed.options.output ? String(parsed.options.output) : null;
    const rosterIndexPath = parsed.options.rosterIndex ? String(parsed.options.rosterIndex) : null;
    const template = parsed.options.template ? String(parsed.options.template) : 'aao-l2-split';
    const title = parsed.options.title ? String(parsed.options.title) : 'New Task';
    let profileData = null;
    if (profilePath) {
        profileData = loadProfile(profilePath);
    }
    const openOutputRoot = resolveTaskflowOpenOutputRoot({
        profilePath,
        profile: profileData,
        cwd
    });
    const prerequisiteInput = {
        profile: profileData,
        taskIdSupplied: taskId !== null,
        outputPathSupplied: outputPath !== null,
        writeRequested
    };
    const delegationContract = buildDelegationContract(profileData);
    const openerMode = resolveOpenerMode(prerequisiteInput);
    const writeSupport = resolveWriteSupport(prerequisiteInput);
    const diagnostics = buildTaskflowOpenDiagnostics(prerequisiteInput);
    let hostPolicyDecision = null;
    if (profileData && canResolveHostOpenerPolicy({
        cwd: openOutputRoot,
        profile: profileData,
        delegationContract,
        taskId,
        outputPath,
        title
    })) {
        try {
            hostPolicyDecision = resolveHostOpenerPolicyDecision({
                cwd: openOutputRoot,
                profile: profileData,
                delegationContract,
                taskId,
                outputPath,
                title
            });
            diagnostics.messages.push(...hostPolicyDecision.diagnostics);
        }
        catch (error) {
            if (writeRequested || taskId || outputPath) {
                throw error;
            }
        }
    }
    const orchestrationPlan = buildOrchestrationPlan({
        profile: profileData,
        openerMode,
        delegationContract,
        outputRoot: openOutputRoot,
        taskId: hostPolicyDecision?.taskId ?? taskId,
        outputPath: hostPolicyDecision?.outputPath ?? outputPath,
        template,
        title,
        rosterIndexPath,
        hostPolicyDecision
    });
    const writeReadinessHint = buildWriteReadinessHint({
        openerMode,
        delegationContract,
        hostPolicyDecision,
        taskId,
        outputPath,
        profileLoaded: profileData != null
    });
    if (writeRequested && !writeSupport.allowed) {
        throw new CliError('ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK', openerMode === 'template-only-fallback'
            ? 'taskflow open --write is not available in template-only-fallback mode. Load an invocable host opener profile or use tasks new (low-level generator surface) for explicit template generation.'
            : 'taskflow open --write prerequisites are incomplete. Supply --task-id/--output or configure host-opener numbering and output-path policy.', {
            exitCode: 1,
            details: {
                openerMode,
                writeSupport,
                writeReadinessHint,
                delegationContract,
                diagnostics,
                orchestrationPlan,
                recommendedCommand: buildTasksNewCommand({
                    taskId: hostPolicyDecision?.taskId ?? taskId,
                    outputPath: hostPolicyDecision?.outputPath ?? outputPath,
                    template,
                    title
                })
            }
        });
    }
    if (writeRequested && writeSupport.allowed) {
        if (!profileData) {
            throw new CliError('ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK', 'taskflow open --write requires a governed profile.', { exitCode: 1 });
        }
        const resolved = hostPolicyDecision ?? resolveHostOpenerPolicyDecision({
            cwd: openOutputRoot,
            profile: profileData,
            delegationContract,
            taskId,
            outputPath,
            title
        });
        const targetAbsolute = resolveOutputAbsolute(openOutputRoot, resolved.outputPath);
        const hadExistingTarget = existsSync(targetAbsolute);
        let generated = null;
        if (!hadExistingTarget) {
            generated = await generateTaskCard({
                cwd: openOutputRoot,
                templateKey: template,
                taskId: resolved.taskId,
                title,
                outputPath: resolved.outputPath
            });
            mkdirSync(path.dirname(targetAbsolute), { recursive: true });
            writeFileSync(targetAbsolute, generated.content, 'utf8');
        }
        let runtimeImport = null;
        try {
            const runtimeImportResult = await withTaskflowOperatorLane(() => runTasks([
                'import',
                '--cwd', cwd,
                '--from', targetAbsolute,
                '--write'
            ]));
            runtimeImport = {
                command: buildTasksImportCommand({ fromPath: targetAbsolute }),
                result: runtimeImportResult
            };
        }
        catch (error) {
            if (!hadExistingTarget && existsSync(targetAbsolute)) {
                rmSync(targetAbsolute, { force: true });
            }
            throw error;
        }
        const effectiveRosterIndex = rosterIndexPath ?? delegationContract.policy.rosterSync.indexPath;
        let rosterSync = null;
        const writeMessages = [
            message('info', 'ATM_TASKFLOW_OPEN_WRITE_ORCHESTRATED', `taskflow open orchestrated tasks new generation at ${resolved.outputPath}.`, { openerMode, generationSurface: 'tasks-new', runtimeImported: true })
        ];
        if (delegationContract.policy.rosterSyncPolicy === 'inline' && effectiveRosterIndex) {
            const rosterResult = await runTasksRosterUpdate([
                '--cwd', cwd,
                '--index', effectiveRosterIndex,
                '--from', resolved.outputPath
            ]);
            rosterSync = {
                mode: 'inline',
                command: buildRosterSyncCommand({ indexPath: effectiveRosterIndex, fromPath: resolved.outputPath }),
                result: rosterResult
            };
        }
        else if (delegationContract.policy.rosterSyncPolicy === 'follow-up-command' && effectiveRosterIndex) {
            const command = buildRosterSyncCommand({ indexPath: effectiveRosterIndex, fromPath: resolved.outputPath });
            rosterSync = await runRosterSyncFollowUp({
                command,
                cwd,
                indexPath: effectiveRosterIndex,
                fromPath: resolved.outputPath,
                messages: writeMessages
            });
        }
        return {
            ...makeResult({
                ok: true,
                command: 'taskflow open',
                cwd,
                mode: 'write',
                messages: writeMessages,
                evidence: {
                    openerMode,
                    writeSupport,
                    writeReadinessHint,
                    delegationContract,
                    diagnostics,
                    orchestrationPlan,
                    hostPolicyDecision: resolved,
                    generation: {
                        surface: 'tasks-new',
                        taskId: generated?.taskId ?? resolved.taskId,
                        sourcePath: generated?.sourcePath ?? resolved.outputPath,
                        templateUsed: generated?.templateUsed ?? template,
                        reusedExistingCard: hadExistingTarget,
                        outputRepoRoot: openOutputRoot
                    },
                    runtimeImport,
                    rosterSync,
                    ...(profileData ? { profile: profileData } : {})
                }
            }),
            schemaId: 'atm.taskflowOpenResult.v1',
            writeEnabled: true,
            writeReadinessHint
        };
    }
    const result = makeResult({
        ok: true,
        command: 'taskflow open',
        cwd,
        mode: 'dry-run',
        messages: [
            message(openerMode === 'delegated-governed' ? 'info' : 'warn', openerMode === 'delegated-governed'
                ? 'ATM_TASKFLOW_OPEN_ORCHESTRATION_READY'
                : 'ATM_TASKFLOW_OPEN_TEMPLATE_ONLY_FALLBACK', openerMode === 'delegated-governed'
                ? 'taskflow open dry-run orchestration plan is ready for delegated governed entry.'
                : 'taskflow open is in template-only-fallback mode. --write will fail closed; see writeReadinessHint for the exact missing prerequisites. tasks new (low-level generator surface) remains the explicit non-governed escape hatch.', { cwd, openerMode, writeReadinessHintStatus: writeReadinessHint.status })
        ],
        evidence: {
            openerMode,
            writeSupport,
            writeReadinessHint,
            delegationContract,
            diagnostics,
            orchestrationPlan,
            hostPolicyDecision,
            fallbackBehavior: delegationContract.policy.fallbackBehavior,
            ...(profileData ? { profile: profileData } : {})
        }
    });
    return {
        ...result,
        schemaId: 'atm.taskflowOpenResult.v1',
        writeEnabled: false,
        writeReadinessHint
    };
}
