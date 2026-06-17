import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getCommandSpec } from './command-specs.js';
import { buildResidueDiagnosisEvidence, generateTaskCard, loadTaskDocumentOrThrow, runTasks, runTasksRosterUpdate } from './tasks/public-surface.js';
import { evaluateTaskDoneCloseAdmission } from './tasks/lifecycle-state.js';
import { detectHistoricalDeliveryCommit, expandDirectoryDeliverableDeclarations, inspectHistoricalDelivery } from './tasks/historical-delivery.js';
import { assertClosebackPlanningPathReady, buildCloseBackendArgv, buildClosebackPlan, buildCloseWriteRollbackSnapshot, buildTaskflowCloseDiagnostics, executeCloseWriteCommitPhase, listOptionalEvidenceBundleGovernanceArtifacts, resolveClosebackPlanningPath, resolveCloseWriteSupport } from './taskflow/close-orchestration.js';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.js';
import { buildDelegationContract, buildTaskflowOpenDiagnostics, loadProfile, resolveOpenerMode, resolveWriteSupport } from './taskflow/profile-loader.js';
import { canResolveHostOpenerPolicy, resolveHostOpenerPolicyDecision } from './taskflow/host-opener-policy.js';
import { buildTaskflowCommitMessage } from './taskflow/commit-messages.js';
import { buildHistoricalClosePreflight, preflightBlockersToWriteReadinessBlockers } from './taskflow/historical-close-preflight.js';
import { resolveActorWorkSession } from './actor-session.js';
import { withTaskflowOperatorLane } from './emergency/context.js';
import { runAtmGit } from './git-governance.js';
import { quoteCliValue, relativePathFrom } from './shared.js';
import { acquireCloseWindowStagedIndexLock, assertCloseWindowStagingAllowed, releaseCloseWindowStagedIndexLock } from './tasks/close-window-lock.js';
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
    const result = await runTasksRosterUpdate([
        '--cwd', input.cwd,
        '--index', input.indexPath,
        '--from', input.fromPath
    ]);
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
function normalizeTaskflowLifecycleStatus(value) {
    return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}
function readTaskflowClaimContext(taskDocument) {
    const claim = taskDocument.claim;
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
        return { state: null, actorId: null, leaseId: null };
    }
    const record = claim;
    return {
        state: typeof record.state === 'string' ? record.state : null,
        actorId: typeof record.actorId === 'string' ? record.actorId : null,
        leaseId: typeof record.leaseId === 'string' ? record.leaseId : null
    };
}
function buildTaskflowCloseWriteReadinessHint(input) {
    const blockers = [];
    const taskStatus = normalizeTaskflowLifecycleStatus(input.taskDocument.status);
    const claim = readTaskflowClaimContext(input.taskDocument);
    const activeSession = input.actorId
        ? resolveActorWorkSession(input.cwd, {
            actorId: input.actorId,
            taskId: input.taskId,
            claimLeaseId: claim.leaseId,
            includeNonActive: true
        })
        : null;
    if (!input.actorId) {
        blockers.push({
            code: 'ATM_TASKFLOW_CLOSE_ACTOR_REQUIRED',
            summary: 'taskflow close --write requires --actor before ATM can verify claim ownership and active session context.',
            requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor <actor> --write --json`
        });
    }
    else {
        const admission = evaluateTaskDoneCloseAdmission({
            taskId: input.taskId,
            actorId: input.actorId,
            status: taskStatus,
            claimState: claim.state,
            claimActorId: claim.actorId,
            hasActiveSession: Boolean(activeSession?.sessionId),
            allowHistoricalCloseback: input.historicalDeliveryRefs.length > 0
        });
        if (!admission.ok) {
            blockers.push({
                code: admission.code,
                summary: admission.message,
                requiredCommand: typeof admission.details.requiredCommand === 'string'
                    ? admission.details.requiredCommand
                    : null
            });
        }
    }
    const declaredFiles = extractTaskflowDeclaredFiles(input.taskDocument);
    const planningMirrorPath = input.closebackPlan.writerBoundary.planningMirrorPath
        ?? input.closebackPlan.closebackPathResolution?.planningMirrorPath
        ?? null;
    const planningResolved = planningMirrorPath ? resolvePlanningPath(input.cwd, planningMirrorPath) : { repoRoot: null, relativePath: null };
    const hasUncommittedDeliverables = input.previewCommitBundle.targetDeliveryFiles.length > 0;
    if (input.closebackPlan.historicalDeliveryGate.required
        && !hasUncommittedDeliverables
        && input.historicalDeliveryRefs.length === 0) {
        const detectedDelivery = detectHistoricalDeliveryCommit({
            cwd: input.cwd,
            taskId: input.taskId,
            declaredFiles,
            planningRepoRoot: planningResolved.repoRoot,
            planningRelativePath: planningResolved.relativePath
        });
        const historicalRefHint = detectedDelivery.ref ?? '<commit>';
        const detectedSummary = detectedDelivery.ref
            ? `Framework delivery already landed at ${detectedDelivery.ref}; taskflow close --write requires --historical-delivery before backend close can proceed.`
            : 'Framework delivery already landed; taskflow close --write will require --historical-delivery before backend close can proceed.';
        blockers.push({
            code: 'ATM_TASKFLOW_CLOSE_HISTORICAL_DELIVERY_REQUIRED',
            summary: detectedSummary,
            requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId || '<actor>')} --historical-delivery ${historicalRefHint} --write --json`
        });
    }
    if (input.planningAuthorityDeliveryGate.required && !input.planningAuthorityDeliveryGate.ok) {
        const detectedPlanningDelivery = input.planningAuthorityDeliveryGate.repoRoot
            ? detectHistoricalDeliveryCommit({
                cwd: input.planningAuthorityDeliveryGate.repoRoot,
                taskId: input.taskId,
                declaredFiles,
                planningRepoRoot: planningResolved.repoRoot,
                planningRelativePath: planningResolved.relativePath
            })
            : { ref: null, commitSha: null, source: null };
        const planningRefHint = detectedPlanningDelivery.ref ?? '<planning-repo-commit>';
        blockers.push({
            code: 'ATM_TASKFLOW_CLOSE_PLANNING_DELIVERY_REQUIRED',
            summary: input.planningAuthorityDeliveryGate.reason ?? 'Planning-authority close requires a verifiable planning-repo historical delivery commit.',
            requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId || '<actor>')} --historical-delivery ${planningRefHint} --write --json`
        });
    }
    const historicalRef = input.historicalDeliveryRefs[0] ?? null;
    if (historicalRef && declaredFiles.length > 0) {
        const historicalReport = inspectHistoricalDelivery({
            cwd: input.cwd,
            taskId: input.taskId,
            requestedRef: historicalRef,
            declaredFiles,
            enforceDeclaredScope: true,
            waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery,
            waiverReason: input.waiverReason
        });
        if (historicalReport.reason === 'out-of-scope-source-files-present') {
            blockers.push({
                code: 'ATM_TASKFLOW_CLOSE_OUT_OF_SCOPE_WAIVER_REQUIRED',
                summary: `Historical delivery ${historicalRef} includes out-of-scope source files. taskflow close requires an explicit waiver reason to continue through the operator lane.`,
                requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId || '<actor>')} --historical-delivery ${historicalRef} --waiver-out-of-scope-delivery --reason \"<reason>\" --write --json`
            });
        }
    }
    const status = blockers.length === 0 ? 'ready' : 'blocked';
    return {
        schemaId: 'atm.taskflowCloseWriteReadinessHint.v1',
        status,
        summary: status === 'ready'
            ? 'taskflow close --write has no known preflight blockers beyond the dry-run bundle.'
            : `taskflow close --write has ${blockers.length} known blocker(s) that dry-run can already disclose.`,
        blockers,
        nextCommand: blockers[0]?.requiredCommand ?? null,
        operatorLane: 'taskflow close'
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
    const waiverOutOfScopeDelivery = parsed.options.waiverOutOfScopeDelivery === true;
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
function readStagedFiles(repoRoot) {
    const output = tryGitScalar(repoRoot, ['diff', '--cached', '--name-only']) ?? '';
    return uniqueSorted(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}
function existingBundleFiles(repo) {
    if (!repo.repoRoot)
        return [];
    return uniqueSorted(repo.stageFiles.filter((file) => existsSync(path.resolve(repo.repoRoot ?? '', file))));
}
function buildIndexIsolation(repo, stagedFiles) {
    const expectedStageFiles = existingBundleFiles(repo);
    const expected = new Set(expectedStageFiles);
    const preStagedFiles = uniqueSorted(stagedFiles);
    const unexpectedStagedFiles = preStagedFiles.filter((file) => !expected.has(file));
    return {
        verified: unexpectedStagedFiles.length === 0,
        expectedStageFiles,
        preStagedFiles,
        unexpectedStagedFiles
    };
}
function verifyRepoIndexIsolation(repo, phase) {
    if (!repo.repoRoot)
        return repo;
    const isolation = buildIndexIsolation(repo, readStagedFiles(repo.repoRoot));
    const nextRepo = { ...repo, indexIsolation: isolation };
    if (!isolation.verified) {
        const restoreCommand = isolation.unexpectedStagedFiles.length > 0
            ? `git restore --staged -- ${isolation.unexpectedStagedFiles.map((entry) => JSON.stringify(entry)).join(' ')}`
            : null;
        throw new CliError('ATM_TASKFLOW_CLOSE_INDEX_NOT_ISOLATED', `taskflow close ${phase} index isolation failed; unexpected staged files would be included in the governed commit.`, {
            exitCode: 1,
            details: {
                repoRoot: repo.repoRoot,
                phase,
                indexIsolation: isolation,
                restoreCommand,
                remediation: restoreCommand
                    ? `Unstage unrelated files, then rerun taskflow close: ${restoreCommand}`
                    : 'Unstage unrelated files or commit them separately, then rerun taskflow close.'
            }
        });
    }
    return nextRepo;
}
function commitCommandFor(input) {
    if (!input.repoRoot)
        return '';
    if (input.repoKind === 'target') {
        return `node atm.mjs git commit --cwd ${quoteCliValue(input.repoRoot)} --actor ${quoteCliValue(input.actorId ?? '<actor>')} --task ${input.taskId} --message ${quoteCliValue(input.commitMessage)} --json`;
    }
    const messageParts = [
        input.commitMessage,
        '',
        `ATM-Actor: ${input.actorId ?? '<actor>'}`,
        `ATM-Task: ${input.taskId}`,
        'ATM-Surface: taskflow-close-planning-bundle'
    ];
    return `git -C ${quoteCliValue(input.repoRoot)} commit -m ${quoteCliValue(messageParts.join('\n'))}`;
}
function extractBackendStageFiles(backendResult) {
    const evidence = backendResult?.evidence;
    if (!evidence)
        return [];
    const files = [];
    for (const key of ['taskPath', 'closurePacketPath', 'transitionPath']) {
        const value = evidence[key];
        if (typeof value === 'string' && value.trim()) {
            files.push(value);
        }
    }
    const allowedFiles = evidence.closeCommitWindowAllowedFiles;
    if (Array.isArray(allowedFiles)) {
        files.push(...allowedFiles.filter((value) => typeof value === 'string'));
    }
    return files;
}
function extractTaskStringList(taskDocument, key) {
    const value = taskDocument[key];
    return Array.isArray(value)
        ? value.map((entry) => typeof entry === 'string' ? entry.trim().replace(/\\/g, '/') : '').filter(Boolean)
        : [];
}
function isCanonicalTaskflowDeliverableCandidate(value) {
    const normalized = value.trim().replace(/\\/g, '/');
    if (!normalized)
        return false;
    if (normalized.startsWith('.atm/'))
        return false;
    if (/[\\/]$/.test(normalized))
        return false;
    return true;
}
function extractTaskflowDeliverables(taskDocument) {
    const explicit = extractTaskStringList(taskDocument, 'deliverables');
    if (explicit.length > 0)
        return explicit;
    const scopePaths = extractTaskStringList(taskDocument, 'scopePaths');
    return uniqueSorted(scopePaths.filter(isCanonicalTaskflowDeliverableCandidate));
}
function extractTaskflowDeclaredFiles(taskDocument) {
    return uniqueSorted([
        ...extractTaskStringList(taskDocument, 'scopePaths'),
        ...extractTaskflowDeliverables(taskDocument),
        ...extractTaskStringList(taskDocument, 'targetAllowedFiles')
    ].filter((file) => !file.startsWith('.atm/')));
}
function normalizeTaskflowAuthority(taskDocument) {
    return String(taskDocument.closureAuthority ?? taskDocument.closure_authority ?? '')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_');
}
function sourcePlanPathOf(taskDocument) {
    const source = taskDocument.source;
    if (!source || typeof source !== 'object' || Array.isArray(source))
        return null;
    const planPath = source.planPath;
    return typeof planPath === 'string' && planPath.trim() ? planPath.trim() : null;
}
function taskflowPathMatches(filePath, declaredPath) {
    const file = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const declared = declaredPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!file || !declared)
        return false;
    return file === declared || file.startsWith(`${declared}/`);
}
function buildScopeAmendmentProposal(input) {
    const candidateFiles = uniqueSorted(input.candidateFiles);
    if (candidateFiles.length === 0) {
        return {
            required: false,
            candidateFiles,
            reason: null,
            remediationCommand: null,
            humanReviewRequired: false,
            notes: []
        };
    }
    const planPath = sourcePlanPathOf(input.taskDocument);
    const remediationCommand = planPath
        ? `node atm.mjs tasks import --from ${quoteCliValue(planPath)} --write --force --json`
        : `node atm.mjs tasks scope add --task ${input.taskId} --actor ${input.actorId ?? '<actor>'} --add ${candidateFiles.join(',')} --json`;
    return {
        required: true,
        candidateFiles,
        reason: input.reason ?? 'Dirty files overlap the task scope but are not justified by deliverables and targetAllowedFiles.',
        remediationCommand,
        humanReviewRequired: true,
        notes: [
            'Do not restore, checkout, clean, or delete another agent active work to satisfy closeout.',
            'Repair the governed task metadata or direction lock, rerun taskflow close --dry-run, then close through taskflow close --write.',
            'The CLI-computed bundle remains authoritative; LLM review may flag omissions but must not append files ad hoc.'
        ]
    };
}
function inspectPlanningAuthorityDelivery(input) {
    if (normalizeTaskflowAuthority(input.taskDocument) !== 'planning_repo') {
        return { required: false, ok: false, repoRoot: null, matchedFiles: [], reason: null };
    }
    const planPath = input.resolvedPlanningMirrorPath ?? sourcePlanPathOf(input.taskDocument);
    const planning = resolvePlanningPath(input.cwd, planPath);
    if (!planning.repoRoot) {
        return { required: true, ok: false, repoRoot: null, matchedFiles: [], reason: planning.reason ?? 'planning repo could not be resolved' };
    }
    if (input.historicalDeliveryRefs.length === 0) {
        return { required: true, ok: false, repoRoot: planning.repoRoot, matchedFiles: [], reason: 'planning authority close requires --historical-delivery <planning-repo-commit>' };
    }
    const declaredFiles = extractTaskflowDeclaredFiles(input.taskDocument);
    const matchedFiles = [];
    for (const ref of input.historicalDeliveryRefs) {
        const commitSha = tryGitScalar(planning.repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
        if (!commitSha)
            continue;
        const changedFiles = tryGitScalar(planning.repoRoot, ['show', '--pretty=format:', '--name-only', commitSha, '--']);
        for (const file of (changedFiles ?? '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
            if (declaredFiles.some((declared) => taskflowPathMatches(file, declared))) {
                matchedFiles.push(file.replace(/\\/g, '/'));
            }
        }
    }
    const uniqueMatched = uniqueSorted(matchedFiles);
    return {
        required: true,
        ok: uniqueMatched.length > 0,
        repoRoot: planning.repoRoot,
        matchedFiles: uniqueMatched,
        reason: uniqueMatched.length > 0 ? null : 'planning delivery commit does not contain declared deliverable files'
    };
}
function buildTargetStageFiles(cwd, taskId, backendResult) {
    return uniqueSorted([
        `.atm/history/tasks/${taskId}.json`,
        `.atm/history/evidence/${taskId}.json`,
        `.atm/history/evidence/${taskId}.closure-packet.json`,
        ...listExistingFilesRecursively(cwd, `.atm/history/task-events/${taskId}`),
        ...extractBackendStageFiles(backendResult)
    ]);
}
function resolvePlanningPath(cwd, planningMirrorPath) {
    if (!planningMirrorPath) {
        return { repoRoot: null, relativePath: null, reason: 'planning mirror path is unavailable' };
    }
    const absolutePath = path.isAbsolute(planningMirrorPath)
        ? path.resolve(planningMirrorPath)
        : path.resolve(cwd, planningMirrorPath);
    const repoRoot = readGitRoot(absolutePath);
    if (!repoRoot) {
        return { repoRoot: null, relativePath: null, reason: `no git repository found for planning path ${planningMirrorPath}` };
    }
    return {
        repoRoot,
        relativePath: normalizeRepoRelativePath(repoRoot, absolutePath),
        reason: null
    };
}
function quoteYamlString(value) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
function capturePlanningCardSnapshot(input) {
    const planning = resolvePlanningPath(input.cwd, input.planningMirrorPath);
    if (!planning.repoRoot || !planning.relativePath) {
        return null;
    }
    const absolutePath = path.resolve(planning.repoRoot, planning.relativePath);
    if (!existsSync(absolutePath)) {
        return null;
    }
    return {
        absolutePath,
        previousContent: readFileSync(absolutePath, 'utf8')
    };
}
function upsertFrontmatterField(frontmatter, key, value) {
    const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:.*$`, 'm');
    if (pattern.test(frontmatter)) {
        return frontmatter.replace(pattern, `${key}: ${value}`);
    }
    const trimmed = frontmatter.replace(/\s+$/, '');
    return `${trimmed}\n${key}: ${value}`;
}
function applyPlanningCardCloseback(input) {
    const planning = resolvePlanningPath(input.cwd, input.planningMirrorPath);
    if (!planning.repoRoot || !planning.relativePath) {
        return null;
    }
    const absolutePath = path.resolve(planning.repoRoot, planning.relativePath);
    if (!existsSync(absolutePath)) {
        throw new CliError('ATM_TASKFLOW_CLOSE_PLANNING_CARD_MISSING', 'taskflow close could not find the planning card for closeback.', {
            exitCode: 1,
            details: { planningMirrorPath: input.planningMirrorPath, planning }
        });
    }
    const content = readFileSync(absolutePath, 'utf8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?/);
    if (!match) {
        throw new CliError('ATM_TASKFLOW_CLOSE_PLANNING_FRONTMATTER_MISSING', 'taskflow close requires planning card frontmatter for governed closeback.', {
            exitCode: 1,
            details: { planningMirrorPath: input.planningMirrorPath, planning }
        });
    }
    const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
    const updatedFields = ['status', 'completed_at', 'completed_by_agent'];
    let frontmatter = match[1].replace(/\r\n/g, '\n');
    frontmatter = upsertFrontmatterField(frontmatter, 'status', 'done');
    frontmatter = upsertFrontmatterField(frontmatter, 'completed_at', quoteYamlString(new Date().toISOString()));
    frontmatter = upsertFrontmatterField(frontmatter, 'completed_by_agent', quoteYamlString(input.actorId));
    if (input.historicalDeliveryRefs[0]) {
        frontmatter = upsertFrontmatterField(frontmatter, 'delivery_commit', quoteYamlString(input.historicalDeliveryRefs[0]));
        updatedFields.push('delivery_commit');
    }
    const rest = content.slice(match[0].length);
    const normalizedFrontmatter = frontmatter.split('\n').join(lineEnding);
    writeFileSync(absolutePath, `---${lineEnding}${normalizedFrontmatter}${lineEnding}---${lineEnding}${rest}`, 'utf8');
    return {
        mode: 'frontmatter-closeback',
        repoRoot: planning.repoRoot,
        relativePath: planning.relativePath,
        updatedFields
    };
}
function resolvePlanningRosterPaths(input) {
    const planning = resolvePlanningPath(input.cwd, input.planningMirrorPath);
    if (!planning.repoRoot || !planning.relativePath) {
        return {
            repoRoot: null,
            fromPath: null,
            indexPath: null,
            reason: planning.reason
        };
    }
    return {
        repoRoot: planning.repoRoot,
        fromPath: planning.relativePath,
        indexPath: input.rosterIndexPath
            ? normalizeRepoRelativePath(planning.repoRoot, path.isAbsolute(input.rosterIndexPath)
                ? input.rosterIndexPath
                : path.resolve(planning.repoRoot, input.rosterIndexPath))
            : null,
        reason: null
    };
}
function getDirtyFiles(cwd) {
    const output = tryGitScalar(cwd, ['status', '--porcelain', '-uall']) ?? '';
    const files = [];
    for (const line of output.split(/\r?\n/)) {
        if (!line.trim())
            continue;
        let filePart = line.slice(2).trim();
        if (filePart.startsWith('"') && filePart.endsWith('"')) {
            try {
                filePart = JSON.parse(filePart);
            }
            catch {
                filePart = filePart.slice(1, -1);
            }
        }
        if (line.startsWith('R ')) {
            const parts = filePart.split(' -> ');
            if (parts[1]) {
                filePart = parts[1].trim();
            }
        }
        files.push(filePart.replace(/\\/g, '/'));
    }
    return [...new Set(files.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function getHistoricalCommittedFiles(cwd, refs) {
    const files = [];
    for (const ref of refs) {
        if (!ref)
            continue;
        const commitSha = tryGitScalar(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]);
        if (!commitSha)
            continue;
        const output = tryGitScalar(cwd, ['show', '--pretty=format:', '--name-only', commitSha, '--']) ?? '';
        for (const line of output.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (trimmed) {
                files.push(trimmed.replace(/\\/g, '/'));
            }
        }
    }
    return [...new Set(files)];
}
function buildTaskflowCommitBundle(input) {
    const targetRepoRoot = path.resolve(input.cwd);
    let taskDocument = {};
    try {
        const loaded = loadTaskDocumentOrThrow(targetRepoRoot, input.taskId);
        taskDocument = loaded.taskDocument;
    }
    catch (err) {
        // If it cannot load, we'll mark as failClosed later
    }
    const deliverables = extractTaskflowDeliverables(taskDocument);
    const scopePaths = extractTaskStringList(taskDocument, 'scopePaths');
    const targetAllowedFiles = extractTaskStringList(taskDocument, 'targetAllowedFiles');
    const dirtyFiles = getDirtyFiles(targetRepoRoot);
    const historicalCommitted = getHistoricalCommittedFiles(targetRepoRoot, input.historicalDeliveryRefs ?? []);
    const historicalCloseback = historicalCommitted.length > 0;
    let allowed = targetAllowedFiles;
    if (allowed.length === 0) {
        allowed = scopePaths;
    }
    const targetDeliveryFiles = [];
    const historicalBatchStageFile = resolveExistingHistoricalBatchStageFile(targetRepoRoot, input.historicalBatchRef);
    const targetGovernanceFiles = [
        `.atm/history/tasks/${input.taskId}.json`,
        `.atm/history/evidence/${input.taskId}.json`,
        `.atm/history/evidence/${input.taskId}.closure-packet.json`,
        ...listOptionalEvidenceBundleGovernanceArtifacts(targetRepoRoot, input.taskId),
        ...(historicalBatchStageFile ? [historicalBatchStageFile] : []),
        ...listExistingFilesRecursively(targetRepoRoot, `.atm/history/task-events/${input.taskId}`),
        ...extractBackendStageFiles(input.backendResult ?? null)
    ];
    const excludedDirtyFiles = [];
    const excludedReasons = {};
    const scopeAmendmentCandidateFiles = [];
    let metadataFailClosed = false;
    let failClosedReason = null;
    // 1. Metadata sufficiency & consistency validation
    if (deliverables.length === 0) {
        metadataFailClosed = true;
        failClosedReason = 'Task metadata error: "deliverables" list is empty or missing.';
    }
    const directoryExpansion = expandDirectoryDeliverableDeclarations(targetRepoRoot, deliverables);
    if (!directoryExpansion.ok) {
        metadataFailClosed = true;
        failClosedReason = directoryExpansion.failClosedReason;
    }
    const effectiveDeliverables = directoryExpansion.ok ? directoryExpansion.effectiveDeliverables : deliverables;
    for (const del of effectiveDeliverables) {
        const isAllowed = allowed.some((all) => taskflowPathMatches(del, all));
        if (!isAllowed) {
            metadataFailClosed = true;
            failClosedReason = `Task metadata error: declared deliverable "${del}" falls outside active direction lock / targetAllowedFiles.`;
        }
    }
    const hasPlanningFile = effectiveDeliverables.some(del => del.startsWith('docs/tasks/') || del.endsWith('.task.md'));
    const hasTargetFile = effectiveDeliverables.some(del => !del.startsWith('docs/tasks/') && !del.endsWith('.task.md'));
    if (hasPlanningFile && hasTargetFile) {
        metadataFailClosed = true;
        failClosedReason = 'Task metadata error: deliverables contain mixed planning-path and target-path declarations.';
    }
    // 2. Classify dirty files
    for (const file of dirtyFiles) {
        if (file.startsWith('.atm/')) {
            continue;
        }
        const inScope = scopePaths.some((sp) => taskflowPathMatches(file, sp));
        const isDeclared = effectiveDeliverables.some((del) => taskflowPathMatches(file, del));
        const isAllowed = allowed.some((all) => taskflowPathMatches(file, all));
        if (isDeclared && isAllowed) {
            targetDeliveryFiles.push(file);
        }
        else {
            excludedDirtyFiles.push(file);
            if (inScope) {
                if (historicalCloseback) {
                    excludedReasons[file] = 'inside scope but outside declared deliverables; excluded as advisory residue during historical closeback';
                }
                else {
                    scopeAmendmentCandidateFiles.push(file);
                    metadataFailClosed = true;
                    failClosedReason = `Scope amendment required: dirty file "${file}" is inside task scope but is not declared in deliverables and targetAllowedFiles.`;
                    excludedReasons[file] = 'inside scope but not declared/allowed (fail-closed trigger)';
                }
            }
            else {
                excludedReasons[file] = 'outside task scope; excluded from governed bundle and must be left untouched';
            }
        }
    }
    const scopeAmendment = buildScopeAmendmentProposal({
        taskId: input.taskId,
        actorId: input.actorId,
        taskDocument,
        candidateFiles: scopeAmendmentCandidateFiles,
        reason: failClosedReason
    });
    // 3. Historical delivery subtraction
    const finalDeliveryFiles = targetDeliveryFiles.filter((file) => !historicalCommitted.some((h) => taskflowPathMatches(file, h)));
    // 4. Build target stage files
    const targetStageFiles = uniqueSorted([
        ...finalDeliveryFiles,
        ...targetGovernanceFiles
    ]);
    const planning = resolvePlanningPath(targetRepoRoot, input.planningMirrorPath);
    const planningStageFiles = planning.repoRoot && planning.relativePath
        ? uniqueSorted([
            planning.relativePath,
            ...(input.rosterIndexPath
                ? [normalizeRepoRelativePath(planning.repoRoot, path.isAbsolute(input.rosterIndexPath)
                        ? input.rosterIndexPath
                        : path.resolve(planning.repoRoot, input.rosterIndexPath))]
                : [])
        ])
        : [];
    const targetMessage = buildTaskflowCommitMessage('target', { taskId: input.taskId });
    const planningMessage = buildTaskflowCommitMessage('planning', { taskId: input.taskId });
    const failClosed = metadataFailClosed || targetStageFiles.length === 0 || !planning.repoRoot || planningStageFiles.length === 0;
    return {
        schemaId: 'atm.taskflowGovernedCommitBundle.v1',
        taskId: input.taskId,
        actorId: input.actorId,
        targetRepo: {
            repoRoot: targetRepoRoot,
            stageFiles: targetStageFiles,
            commitMessage: targetMessage,
            commitCommand: commitCommandFor({
                repoRoot: targetRepoRoot,
                taskId: input.taskId,
                actorId: input.actorId,
                commitMessage: targetMessage,
                repoKind: 'target'
            }),
            commitSha: null,
            status: input.commitMode === 'dry-run' ? 'preview' : 'uncomputed',
            reason: failClosedReason || (targetStageFiles.length > 0 ? null : 'target close artifact paths could not be computed')
        },
        planningRepo: {
            repoRoot: planning.repoRoot,
            stageFiles: planningStageFiles,
            commitMessage: planningMessage,
            commitCommand: commitCommandFor({
                repoRoot: planning.repoRoot,
                taskId: input.taskId,
                actorId: input.actorId,
                commitMessage: planningMessage,
                repoKind: 'planning'
            }),
            commitSha: null,
            status: input.commitMode === 'dry-run' ? 'preview' : 'uncomputed',
            reason: planning.reason
        },
        commitMode: input.commitMode,
        failClosed,
        recoveryCommand: null,
        targetDeliveryFiles: finalDeliveryFiles,
        targetGovernanceFiles,
        planningFiles: planningStageFiles,
        excludedDirtyFiles,
        excludedReasons,
        scopeAmendment
    };
}
function assertCommitBundleReady(bundle) {
    if (bundle.failClosed || !bundle.targetRepo.repoRoot || !bundle.planningRepo.repoRoot) {
        throw new CliError('ATM_TASKFLOW_CLOSE_COMMIT_BUNDLE_INCOMPLETE', 'taskflow close cannot compute the dual-repo governed commit bundle.', {
            exitCode: 1,
            details: { governedCommitBundle: bundle }
        });
    }
}
function stageRepoBundle(repo, taskId) {
    if (repo.repoRoot && taskId) {
        assertCloseWindowStagingAllowed({
            cwd: repo.repoRoot,
            taskId,
            operation: 'taskflow close bundle staging'
        });
    }
    if (!repo.repoRoot || repo.stageFiles.length === 0) {
        return { ...repo, status: 'uncomputed' };
    }
    const existingFiles = existingBundleFiles(repo);
    if (existingFiles.length === 0) {
        return {
            ...repo,
            stageFiles: existingFiles,
            status: 'skipped',
            reason: 'no existing bundle files to stage',
            indexIsolation: buildIndexIsolation(repo, readStagedFiles(repo.repoRoot))
        };
    }
    runGitOrThrow(repo.repoRoot, ['add', '--', ...existingFiles]);
    return { ...repo, stageFiles: existingFiles, status: 'staged' };
}
async function commitTaskflowBundle(input) {
    const targetResult = await runAtmGit([
        'commit',
        '--cwd', input.bundle.targetRepo.repoRoot ?? '',
        '--actor', input.actorId,
        '--task', input.taskId,
        '--message', input.bundle.targetRepo.commitMessage,
        '--json'
    ]);
    const targetCommitSha = String(targetResult.evidence?.commitSha ?? '') || null;
    let targetRepo = {
        ...input.bundle.targetRepo,
        commitSha: targetCommitSha,
        status: 'committed'
    };
    let planningRepo = input.bundle.planningRepo;
    try {
        if (!planningRepo.repoRoot) {
            throw new Error('planning repo root missing');
        }
        const planningMessage = [
            planningRepo.commitMessage,
            '',
            `ATM-Actor: ${input.actorId}`,
            `ATM-Task: ${input.taskId}`,
            'ATM-Surface: taskflow-close-planning-bundle'
        ].join('\n');
        runGitOrThrow(planningRepo.repoRoot, ['commit', '-m', planningMessage]);
        planningRepo = {
            ...planningRepo,
            commitSha: tryGitScalar(planningRepo.repoRoot, ['rev-parse', '--verify', 'HEAD']),
            status: 'committed'
        };
    }
    catch (error) {
        planningRepo = {
            ...planningRepo,
            status: 'failed',
            reason: error instanceof Error ? error.message : String(error)
        };
        targetRepo = { ...targetRepo, status: 'committed' };
        return {
            ...input.bundle,
            targetRepo,
            planningRepo,
            failClosed: true,
            recoveryCommand: planningRepo.commitCommand || null
        };
    }
    return {
        ...input.bundle,
        targetRepo,
        planningRepo,
        failClosed: false,
        recoveryCommand: null
    };
}
async function commitTaskflowDeliveryFiles(input) {
    const repoRoot = input.bundle.targetRepo.repoRoot;
    const stageFiles = uniqueSorted(input.bundle.targetDeliveryFiles);
    if (!repoRoot || stageFiles.length === 0) {
        return null;
    }
    const deliveryBundle = {
        repoRoot,
        stageFiles,
        commitMessage: `chore(taskflow): deliver ${input.taskId} source bundle`,
        commitCommand: commitCommandFor({
            repoRoot,
            actorId: input.actorId,
            taskId: input.taskId,
            commitMessage: `chore(taskflow): deliver ${input.taskId} source bundle`,
            repoKind: 'target'
        }),
        commitSha: null,
        status: 'uncomputed'
    };
    const preflight = verifyRepoIndexIsolation(deliveryBundle, 'pre-stage');
    const staged = verifyRepoIndexIsolation(stageRepoBundle(preflight, input.taskId), 'post-stage');
    if (staged.status !== 'staged') {
        return null;
    }
    const targetResult = await runAtmGit([
        'commit',
        '--cwd', repoRoot,
        '--actor', input.actorId,
        '--task', input.taskId,
        '--message', deliveryBundle.commitMessage,
        '--json'
    ]);
    const commitSha = String(targetResult.evidence?.commitSha ?? '') || null;
    return {
        repoRoot,
        stageFiles: staged.stageFiles,
        commitMessage: deliveryBundle.commitMessage,
        commitSha,
        status: 'committed'
    };
}
async function finalizeTaskflowCommitBundle(input) {
    assertCommitBundleReady(input.bundle);
    const preflightTarget = verifyRepoIndexIsolation(input.bundle.targetRepo, 'pre-stage');
    const preflightPlanning = verifyRepoIndexIsolation(input.bundle.planningRepo, 'pre-stage');
    const stagedTarget = verifyRepoIndexIsolation(stageRepoBundle(preflightTarget, input.taskId), 'post-stage');
    const stagedPlanning = verifyRepoIndexIsolation(stageRepoBundle(preflightPlanning, input.taskId), 'post-stage');
    const stagedBundle = {
        ...input.bundle,
        targetRepo: stagedTarget,
        planningRepo: stagedPlanning
    };
    if (input.bundle.commitMode === 'stage-only') {
        return stagedBundle;
    }
    return commitTaskflowBundle({
        bundle: stagedBundle,
        actorId: input.actorId,
        taskId: input.taskId
    });
}
async function runTaskflowClose(parsed, cwd, surface = 'close') {
    const taskId = parsed.options.task ? String(parsed.options.task) : '';
    const actorId = parsed.options.actor ? String(parsed.options.actor) : '';
    const writeRequested = !!parsed.options.write;
    const noCommitRequested = !!parsed.options.noCommit;
    const deferForeignStaged = parsed.options.deferForeignStaged === true;
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
        historicalBatchRef
    });
    const hasUncommittedDeliverables = previewCommitBundle.targetDeliveryFiles.length > 0;
    const historicalClosePreflight = buildHistoricalClosePreflight({
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
                closeWindowStagedIndexLockActive: closeWindowLock?.ok === true
            });
            const planningCardCloseback = closebackPlan.backendSurface === 'tasks-close' && backendResult.ok
                ? applyPlanningCardCloseback({
                    cwd,
                    planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath,
                    actorId,
                    historicalDeliveryRefs: effectiveHistoricalDeliveryRefs
                })
                : null;
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
                backendResult: backendResult,
                historicalDeliveryRefs: effectiveHistoricalDeliveryRefs,
                historicalBatchRef
            });
            const { bundle: governedCommitBundle, transaction: closeWriteTransaction } = backendResult.ok
                ? await executeCloseWriteCommitPhase({
                    cwd,
                    taskId,
                    actorId,
                    snapshot: rollbackSnapshot,
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
                        residueDiagnosis: enrichedDiagnosis,
                        closebackPathResolution,
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
