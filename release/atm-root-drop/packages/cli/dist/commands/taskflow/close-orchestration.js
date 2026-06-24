import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveTaskflowCloseBackend, resolveTaskflowCloseMode, taskflowCloseEvidenceValidators, taskflowCloseGovernanceEvidenceValidator } from '../tasks/surface-invariants.js';
import { extractFrontMatter, normalizeTaskId } from '../tasks/task-import-validators.js';
import { CliError, relativePathFrom } from '../shared.js';
import { releaseCloseWindowStagedIndexLock } from '../tasks/close-window-lock.js';
import { EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID, evidenceBundleManifestPathForTask, evidenceBundleManifestRelativePath, readEvidenceBundleManifest } from '../evidence.js';
import { DIRECTORY_DELIVERABLE_MANIFEST_SCHEMA_ID, expandDirectoryDeliverableDeclarations, isDirectoryStyleDeliverableDeclaration, listFilesUnderDeclaredDirectory } from '../tasks/historical-delivery.js';
function buildTasksCloseCommand(input) {
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
function buildTasksReconcileCommand(input) {
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
function buildTasksImportCommand(fromPath, force = false) {
    const parts = ['node atm.mjs tasks import', `--from ${fromPath}`, '--write', '--json'];
    if (force) {
        parts.push('--force');
    }
    return parts.join(' ');
}
function buildTasksRepairClosureCommand(taskId, actorId) {
    const parts = ['node atm.mjs tasks repair-closure', `--task ${taskId}`, '--json'];
    if (actorId) {
        parts.push(`--actor ${actorId}`);
    }
    return parts.join(' ');
}
function buildTasksStatusCommand(taskId) {
    return `node atm.mjs tasks status --task ${taskId} --json`;
}
function buildRosterClosebackCommand(input) {
    return `node atm.mjs tasks roster update --index ${input.indexPath} --from ${input.fromPath} --json`;
}
export function buildClosebackPlan(input) {
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
    const followUpSteps = ['diagnose-residue-via-finalize'];
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
    }
    else if (backendSurface === 'tasks-reconcile') {
        backendCommand = buildTasksReconcileCommand({
            taskId: input.taskId,
            actorId: input.actorId,
            deliveryCommit: input.historicalDeliveryRefs[0] ?? null,
            waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery === true,
            waiverReason: input.waiverReason ?? null
        });
        followUpSteps.push('reconcile-historical-delivery');
    }
    else if (backendSurface === 'tasks-import') {
        backendCommand = planningMirrorPath
            ? buildTasksImportCommand(planningMirrorPath, input.diagnosis.bucket === 'stale-import')
            : input.diagnosis.nextCommand;
        followUpSteps.push('refresh-planning-mirror');
    }
    else if (backendSurface === 'tasks-repair-closure') {
        backendCommand = buildTasksRepairClosureCommand(input.taskId, input.actorId);
        followUpSteps.push('repair-interrupted-close');
    }
    if (rosterClosebackCommand && closeMode !== 'ambiguous-manual-review') {
        if (input.delegationContract.policy.rosterSyncPolicy === 'inline') {
            followUpSteps.push('roster-closeback-inline');
        }
        else if (input.delegationContract.policy.rosterSyncPolicy === 'follow-up-command') {
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
        waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery === true,
        waiverReason: input.waiverReason ?? null,
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
export function buildTaskflowCloseDiagnostics(input) {
    const codes = [];
    const messages = [];
    const missingPrerequisites = [];
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
export function buildCloseBackendArgv(input) {
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
function readTaskDocumentSourcePlanPath(taskDocument) {
    const source = taskDocument.source;
    if (!source || typeof source !== 'object' || Array.isArray(source))
        return null;
    const planPath = source.planPath;
    return typeof planPath === 'string' && planPath.trim() ? planPath.trim() : null;
}
function readTaskDocumentRelatedPlanPath(taskDocument) {
    const relatedPlan = taskDocument.related_plan ?? taskDocument.relatedPlan;
    return typeof relatedPlan === 'string' && relatedPlan.trim() ? relatedPlan.trim() : null;
}
function slugifyPlanningTitle(title) {
    const slug = title
        .trim()
        .toLowerCase()
        .replace(/['"]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'task';
}
function resolveCanonicalPlanningRelativePath(taskId, title, policy) {
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
function readPlanningCardMetadata(absolutePath) {
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
function normalizeComparablePath(filePath) {
    return path.resolve(filePath).replace(/\\/g, '/');
}
export function resolveClosebackPlanningPath(input) {
    const normalizedTaskId = normalizeTaskId(input.taskId);
    const title = typeof input.taskDocument.title === 'string' ? input.taskDocument.title : null;
    const profileFallbackAvailable = Boolean(input.profile && input.profileRepoRoot);
    const directPlanPath = readTaskDocumentSourcePlanPath(input.taskDocument);
    if (directPlanPath) {
        const absolutePath = path.isAbsolute(directPlanPath)
            ? path.resolve(directPlanPath)
            : path.resolve(input.cwd, directPlanPath);
        if (!existsSync(absolutePath)) {
            if (!profileFallbackAvailable) {
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
        }
        else {
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
    }
    if (!profileFallbackAvailable) {
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
    const profileRepoRoot = input.profileRepoRoot;
    const relativeOutput = resolveCanonicalPlanningRelativePath(normalizedTaskId, title, input.delegationContract.policy);
    if (!relativeOutput) {
        return {
            route: 'missing',
            planningMirrorPath: null,
            profileRepoRoot,
            planningStatus: null,
            diagnostics: {
                codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_POLICY_MISSING'],
                messages: ['Profile canonical output-path policy cannot deterministically resolve a planning card path for closeback.']
            }
        };
    }
    const profileAbsolutePath = path.resolve(profileRepoRoot, relativeOutput);
    const relatedPlanPath = readTaskDocumentRelatedPlanPath(input.taskDocument);
    if (relatedPlanPath) {
        const relatedAbsolutePath = path.isAbsolute(relatedPlanPath)
            ? path.resolve(relatedPlanPath)
            : path.resolve(input.cwd, relatedPlanPath);
        if (existsSync(relatedAbsolutePath)
            && normalizeComparablePath(relatedAbsolutePath) !== normalizeComparablePath(profileAbsolutePath)) {
            return {
                route: 'ambiguous',
                planningMirrorPath: null,
                profileRepoRoot,
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
            profileRepoRoot,
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
            profileRepoRoot,
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
        profileRepoRoot,
        planningStatus: metadata.status,
        diagnostics: {
            codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_PROFILE_FALLBACK'],
            messages: [`Recovered planning path ${relativeOutput} from profile canonical output policy.`]
        }
    };
}
export function assertClosebackPlanningPathReady(resolution, input) {
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
export function resolveCloseWriteSupport(input) {
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
function resolveGitExecutableForRollback() {
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
export function buildCloseWriteRollbackSnapshot(input) {
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
        closeWindowStagedIndexLockActive: input.closeWindowStagedIndexLockActive === true,
        planningCard: input.planningCard,
        stagedArtifacts,
        preCloseStagedFiles: uniqueRelativePaths(input.preCloseStagedFiles ?? [])
    };
}
function uniqueRelativePaths(values) {
    return [...new Set(values.map((entry) => (typeof entry === 'string' ? entry.trim().replace(/\\/g, '/') : '')).filter(Boolean))];
}
function readRollbackStagedFiles(cwd) {
    try {
        const output = execFileSync(resolveGitExecutableForRollback(), ['diff', '--cached', '--name-only'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        return uniqueRelativePaths(output.split(/\r?\n/));
    }
    catch {
        return [];
    }
}
function restoreRollbackIndexBaseline(input) {
    const baseline = new Set(uniqueRelativePaths(input.preCloseStagedFiles));
    const unexpected = readRollbackStagedFiles(input.cwd).filter((entry) => !baseline.has(entry));
    if (unexpected.length === 0)
        return;
    try {
        execFileSync(resolveGitExecutableForRollback(), ['restore', '--staged', '--', ...unexpected], {
            cwd: input.cwd,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        input.rolledBackArtifacts.push(...unexpected.map((entry) => `${entry} (unstaged rollback-baseline)`));
    }
    catch {
        // preserve rollback report even if index cleanup fails
    }
}
export function rollbackCloseWriteTransaction(input) {
    const rolledBackArtifacts = [];
    const taskAbsolutePath = path.resolve(input.cwd, input.snapshot.taskPath);
    writeFileSync(taskAbsolutePath, input.snapshot.previousTaskContent, 'utf8');
    rolledBackArtifacts.push(relativePathFrom(input.cwd, taskAbsolutePath));
    for (const artifactPath of [input.snapshot.transitionPath, input.snapshot.closurePacketPath]) {
        if (!artifactPath)
            continue;
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
    const preCloseStaged = new Set(input.snapshot.preCloseStagedFiles);
    const staged = uniqueRelativePaths(input.snapshot.stagedArtifacts).filter((entry) => !preCloseStaged.has(entry));
    if (staged.length > 0) {
        try {
            execFileSync(resolveGitExecutableForRollback(), ['restore', '--staged', '--', ...staged], {
                cwd: input.cwd,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            rolledBackArtifacts.push(...staged.map((entry) => `${entry} (unstaged)`));
        }
        catch {
            // preserve rollback report even if index cleanup fails
        }
    }
    restoreRollbackIndexBaseline({
        cwd: input.cwd,
        preCloseStagedFiles: input.snapshot.preCloseStagedFiles,
        rolledBackArtifacts
    });
    if (input.snapshot.closeWindowStagedIndexLockActive) {
        const released = releaseCloseWindowStagedIndexLock({
            cwd: input.cwd,
            taskId: input.taskId,
            actorId: input.actorId ?? 'rollback',
            outcome: 'rolled_back'
        });
        if (released) {
            rolledBackArtifacts.push('.atm/runtime/locks/close-window-staged-index.lock.json (released)');
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
export async function executeCloseWriteCommitPhase(input) {
    try {
        const bundle = await input.commit();
        if (bundle.failClosed) {
            return {
                bundle,
                transaction: rollbackCloseWriteTransaction({
                    cwd: input.cwd,
                    taskId: input.taskId,
                    actorId: input.actorId,
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
    }
    catch (error) {
        const failureCode = error instanceof CliError ? error.code : 'ATM_TASKFLOW_CLOSE_WRITE_FAILED';
        const failureReason = error instanceof Error ? error.message : String(error);
        return {
            bundle: { failClosed: true },
            transaction: rollbackCloseWriteTransaction({
                cwd: input.cwd,
                taskId: input.taskId,
                actorId: input.actorId,
                snapshot: input.snapshot,
                failureStep: 'commit-bundle',
                failureCode,
                failureReason
            })
        };
    }
}
export const TASK_CLOSE_COMPLETION_CHECKLIST_SCHEMA_ID = 'atm.taskCloseCompletionChecklist.v1';
function normalizeLifecycleStatus(value) {
    const normalized = String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
    return normalized || null;
}
function readClosurePacketRecord(cwd, relativePath) {
    if (!relativePath)
        return null;
    const absolutePath = path.isAbsolute(relativePath) ? relativePath : path.join(cwd, relativePath);
    if (!existsSync(absolutePath))
        return null;
    try {
        return JSON.parse(readFileSync(absolutePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function readCloseTransitionCommand(cwd, taskId, transitionId) {
    if (!transitionId)
        return null;
    const eventPath = path.join(cwd, '.atm', 'history', 'task-events', taskId, `${transitionId}.json`);
    if (!existsSync(eventPath))
        return null;
    try {
        const event = JSON.parse(readFileSync(eventPath, 'utf8'));
        return typeof event.command === 'string' ? event.command : null;
    }
    catch {
        return null;
    }
}
function closeCommandUsedWaiver(command) {
    return Boolean(command && /--waiver-out-of-scope-delivery\b/.test(command));
}
export function buildCloseCompletionChecklist(input) {
    const ledgerStatus = normalizeLifecycleStatus(typeof input.taskDocument.status === 'string' ? input.taskDocument.status : null);
    const planningStatus = normalizeLifecycleStatus(input.triangulation.planningFrontmatter.status);
    const ledgerDone = ledgerStatus === 'done';
    const closurePacketPath = typeof input.taskDocument.closurePacket === 'string'
        ? input.taskDocument.closurePacket
        : null;
    const closurePacket = readClosurePacketRecord(input.cwd, closurePacketPath);
    const targetCommit = typeof closurePacket?.targetCommit === 'string'
        ? closurePacket.targetCommit
        : (typeof input.taskDocument.delivery_commit === 'string' ? input.taskDocument.delivery_commit : null);
    const closeReason = typeof input.taskDocument.closeReason === 'string' ? input.taskDocument.closeReason.trim() : '';
    const lastTransitionId = typeof input.taskDocument.lastTransitionId === 'string' ? input.taskDocument.lastTransitionId : null;
    const closeCommand = readCloseTransitionCommand(input.cwd, input.taskId, lastTransitionId);
    const waiverRequired = closeCommandUsedWaiver(closeCommand);
    const closeEventRecorded = input.triangulation.lastTransitionEvent?.action === 'close'
        && Boolean(lastTransitionId)
        && existsSync(path.join(input.cwd, '.atm', 'history', 'task-events', input.taskId, `${lastTransitionId}.json`));
    const targetGovernanceCommitted = Boolean(closurePacketPath && existsSync(path.isAbsolute(closurePacketPath) ? closurePacketPath : path.join(input.cwd, closurePacketPath)));
    const planningMirrorCommitted = !ledgerDone || planningStatus === 'done';
    const fields = [
        {
            id: 'ledger-done',
            ok: ledgerDone,
            value: ledgerStatus,
            detail: ledgerDone ? 'Live ledger records done.' : 'Live ledger is not done yet.'
        },
        {
            id: 'target-governance-committed',
            ok: targetGovernanceCommitted,
            value: closurePacketPath,
            detail: targetGovernanceCommitted
                ? 'Closure packet is present in the target repo.'
                : 'Closure packet is missing; target governance close may be incomplete.'
        },
        {
            id: 'planning-mirror-committed',
            ok: planningMirrorCommitted,
            value: input.triangulation.planningFrontmatter.status,
            detail: planningMirrorCommitted
                ? 'Planning mirror agrees with governed close state.'
                : 'Planning mirror is not done while the live ledger is done.'
        },
        {
            id: 'lifecycle-events-recorded',
            ok: closeEventRecorded,
            value: lastTransitionId,
            detail: closeEventRecorded
                ? 'Close transition event is recorded under .atm/history/task-events.'
                : 'No close transition event is recorded for this task.'
        },
        {
            id: 'delivery-sha',
            ok: Boolean(targetCommit),
            value: targetCommit,
            detail: targetCommit
                ? 'Delivery commit SHA is recorded in closure provenance.'
                : 'Delivery SHA is missing from closure provenance.'
        },
        {
            id: 'waiver-reason',
            ok: !waiverRequired || Boolean(closeReason),
            value: closeReason || null,
            detail: waiverRequired
                ? (closeReason ? 'Waiver reason is recorded for out-of-scope delivery.' : 'Waiver was used but no durable reason is recorded.')
                : 'No out-of-scope delivery waiver was required.'
        }
    ];
    const requiredFields = fields.filter((entry) => entry.id !== 'waiver-reason' || waiverRequired);
    const partialClose = ledgerDone && requiredFields.some((entry) => !entry.ok);
    const summary = partialClose
        ? 'Task ledger is done, but close completion checklist shows a partial close.'
        : ledgerDone
            ? 'Task close completion checklist is satisfied.'
            : 'Task is not done; close completion checklist is informational only.';
    return {
        schemaId: TASK_CLOSE_COMPLETION_CHECKLIST_SCHEMA_ID,
        taskId: input.taskId,
        partialClose,
        summary,
        fields
    };
}
// === TASK-MAO-0041 evidence-bundle-manifest (cursor-composer-2.5) START ===
// 0041 close-orchestration hooks live in this region only.
export { EVIDENCE_BUNDLE_MANIFEST_SCHEMA_ID, evidenceBundleManifestRelativePath, evidenceBundleManifestPathForTask, readEvidenceBundleManifest };
export { DIRECTORY_DELIVERABLE_MANIFEST_SCHEMA_ID, expandDirectoryDeliverableDeclarations, isDirectoryStyleDeliverableDeclaration, listFilesUnderDeclaredDirectory };
export function listOptionalEvidenceBundleGovernanceArtifacts(cwd, taskId) {
    const relativePath = evidenceBundleManifestRelativePath(taskId);
    return existsSync(path.join(cwd, relativePath)) ? [relativePath] : [];
}
// === TASK-MAO-0041 evidence-bundle-manifest END ===
// === TASK-MAO-0042 validator-scope-taxonomy (antigravity-gemini-3.5-flash) START ===
// 0042 close gating taxonomy hooks live in this region only.
export { getValidatorScope } from '../validate.js';
// === TASK-MAO-0042 validator-scope-taxonomy END ===
export { buildHistoricalClosePreflight, preflightBlockersToWriteReadinessBlockers } from './historical-close-preflight.js';
