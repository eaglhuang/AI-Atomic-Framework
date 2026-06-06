import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveActorId } from './actor-registry.js';
import { CliError, makeResult, message } from './shared.js';
import { runTasks } from './tasks.js';
function parseDoArgs(argv) {
    const cwd = process.cwd();
    let taskId;
    let evidencePath;
    let dryRun = false;
    let actor;
    let action = 'start';
    const positionals = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if ((arg === '--task' || arg === '-t') && argv[i + 1]) {
            taskId = argv[++i];
        }
        else if (arg === '--evidence' && argv[i + 1]) {
            evidencePath = argv[++i];
        }
        else if (arg === '--dry-run') {
            dryRun = true;
        }
        else if (arg === '--actor' && argv[i + 1]) {
            actor = argv[++i];
        }
        else if (arg === '--status') {
            action = 'status';
        }
        else if (!arg.startsWith('-')) {
            positionals.push(arg);
        }
    }
    if (positionals[0] === 'complete') {
        action = 'complete';
    }
    return { cwd, taskId, action, evidencePath, dryRun, actor };
}
export async function runDo(argv) {
    const options = parseDoArgs(argv);
    if (options.action === 'status') {
        return runDoStatus(options);
    }
    if (options.action === 'complete') {
        return runDoComplete(options);
    }
    return runDoStart(options);
}
function getTaskDocument(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath))
        return null;
    try {
        return JSON.parse(readFileSync(taskPath, 'utf-8'));
    }
    catch {
        return null;
    }
}
function getTaskStatus(doc) {
    return doc ? String(doc.status ?? 'unknown') : 'not-found';
}
async function runDoStart(options) {
    const { cwd, taskId, dryRun, actor } = options;
    if (!taskId) {
        throw new CliError('ATM_CLI_USAGE', 'do requires --task <taskId>', { exitCode: 2 });
    }
    const resolvedActor = resolveActorId(actor);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'do requires --actor or ATM_ACTOR_ID env variable.', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    // Check task state
    const doc = getTaskDocument(cwd, taskId);
    const currentStatus = getTaskStatus(doc);
    // Idempotent: if already running/claimed, return current state
    if (currentStatus === 'running') {
        return makeResult({
            ok: true,
            command: 'do',
            cwd,
            messages: [
                message('info', 'ATM_DO_ALREADY_CLAIMED', `Task ${taskId} is already in running state. Continuing.`, {
                    taskId,
                    phase: 'claimed',
                    previousClaimAt: doc?.startedAt ?? null,
                    hint: `Call \`atm do --task ${taskId} complete --evidence ./evidence.json\` when done.`
                })
            ],
            evidence: { taskId, phase: 'claimed', idempotent: true }
        });
    }
    // Check for locked tasks
    if (currentStatus === 'reserved' || currentStatus === 'ready') {
        const owner = doc ? String(doc.owner ?? '') : '';
        if (owner && owner !== actorId) {
            return makeResult({
                ok: false,
                command: 'do',
                cwd,
                messages: [
                    message('error', 'ATM_DO_TASK_LOCKED', `Task ${taskId} is locked by ${owner}.`, {
                        taskId,
                        lockOwner: owner,
                        routeHint: `Contact ${owner} or wait for the task to be released.`
                    })
                ],
                evidence: { taskId, phase: currentStatus, lockOwner: owner }
            });
        }
    }
    // Check blocked_by dependencies
    const blockedBy = Array.isArray(doc?.blockedBy)
        ? doc.blockedBy
        : Array.isArray(doc?.dependencies)
            ? doc.dependencies
            : [];
    const blockingTasks = [];
    for (const depId of blockedBy) {
        const depDoc = getTaskDocument(cwd, depId);
        const depStatus = getTaskStatus(depDoc);
        if (depStatus !== 'done' && depStatus !== 'closed') {
            blockingTasks.push(depId);
        }
    }
    if (blockingTasks.length > 0) {
        return makeResult({
            ok: false,
            command: 'do',
            cwd,
            messages: [
                message('error', 'ATM_DO_TASK_BLOCKED', `Task ${taskId} is blocked by ${blockingTasks.length} incomplete dependency task(s).`, { taskId, blockingTasks })
            ],
            evidence: { taskId, phase: 'blocked', blockingTasks }
        });
    }
    if (dryRun) {
        return makeResult({
            ok: true,
            command: 'do',
            cwd,
            messages: [
                message('info', 'ATM_DO_DRY_RUN', `Dry-run: would execute reserve → promote → claim for task ${taskId}.`, {
                    taskId,
                    actorId,
                    steps: ['reserve', 'promote', 'claim']
                })
            ],
            evidence: { taskId, phase: 'dry-run', steps: ['reserve', 'promote', 'claim'] }
        });
    }
    // Step 1: reserve (skip if already in a further state)
    const stepsCompleted = [];
    let failedStep = null;
    let failureReason = '';
    if (currentStatus === 'planned' || currentStatus === 'open' || currentStatus === 'not-found') {
        try {
            await runTasks(['reserve', `--task`, taskId, `--actor`, actorId]);
            stepsCompleted.push('reserve');
        }
        catch (err) {
            failedStep = 'reserve';
            failureReason = err instanceof Error ? err.message : String(err);
        }
    }
    else {
        stepsCompleted.push('reserve (skipped — already past this state)');
    }
    // Step 2: promote
    if (!failedStep && currentStatus !== 'ready') {
        try {
            await runTasks(['promote', `--task`, taskId, `--actor`, actorId]);
            stepsCompleted.push('promote');
        }
        catch (err) {
            failedStep = 'promote';
            failureReason = err instanceof Error ? err.message : String(err);
            // Rollback reserve
            try {
                await runTasks(['release', `--task`, taskId, `--actor`, actorId]);
                stepsCompleted.push('rollback: release');
            }
            catch {
                // best effort
            }
        }
    }
    else if (!failedStep) {
        stepsCompleted.push('promote (skipped — already ready)');
    }
    // Step 3: claim
    if (!failedStep) {
        try {
            await runTasks(['claim', `--task`, taskId, `--actor`, actorId]);
            stepsCompleted.push('claim');
        }
        catch (err) {
            failedStep = 'claim';
            failureReason = err instanceof Error ? err.message : String(err);
            // Rollback: release
            try {
                await runTasks(['release', `--task`, taskId, `--actor`, actorId]);
                stepsCompleted.push('rollback: release');
            }
            catch {
                // best effort
            }
        }
    }
    if (failedStep) {
        return makeResult({
            ok: false,
            command: 'do',
            cwd,
            messages: [
                message('error', 'ATM_DO_STEP_FAILED', `Task ${taskId} do-start failed at step "${failedStep}". State rolled back.`, { taskId, failedStep, failureReason, stepsCompleted, phase: 'rolled-back-to-pristine' })
            ],
            evidence: { taskId, phase: 'rolled-back-to-pristine', failedStep, stepsCompleted }
        });
    }
    return makeResult({
        ok: true,
        command: 'do',
        cwd,
        messages: [
            message('info', 'ATM_DO_STARTED', `Task ${taskId} is now claimed and ready to work on.`, {
                taskId,
                actorId,
                phase: 'claimed',
                stepsCompleted,
                hint: `Call \`atm do --task ${taskId} complete --evidence ./evidence.json\` when done.`
            })
        ],
        evidence: { taskId, phase: 'claimed', actorId, stepsCompleted }
    });
}
async function runDoComplete(options) {
    const { cwd, taskId, evidencePath, dryRun, actor } = options;
    if (!taskId) {
        throw new CliError('ATM_CLI_USAGE', 'do complete requires --task <taskId>', { exitCode: 2 });
    }
    if (!evidencePath) {
        throw new CliError('ATM_CLI_USAGE', 'do complete requires --evidence <path>', { exitCode: 2 });
    }
    const resolvedActor = resolveActorId(actor);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'do complete requires --actor or ATM_ACTOR_ID env variable.', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const resolvedEvidence = path.resolve(cwd, evidencePath);
    if (!existsSync(resolvedEvidence)) {
        throw new CliError('ATM_DO_EVIDENCE_NOT_FOUND', `Evidence file not found: ${evidencePath}`, { exitCode: 2, details: { evidencePath } });
    }
    // Validate evidence _isValid
    let evidenceContent;
    try {
        evidenceContent = JSON.parse(readFileSync(resolvedEvidence, 'utf-8'));
    }
    catch {
        throw new CliError('ATM_DO_EVIDENCE_INVALID', `Evidence file is not valid JSON: ${evidencePath}`, { exitCode: 2 });
    }
    if (evidenceContent.evidenceType === 'diff-as-evidence' && evidenceContent._isValid !== true) {
        throw new CliError('ATM_DO_EVIDENCE_NOT_VALID', `Evidence _isValid is false. Fill in intent, impact, and testCoverage before completing.`, {
            exitCode: 1,
            details: { evidencePath, evidenceType: evidenceContent.evidenceType }
        });
    }
    if (dryRun) {
        return makeResult({
            ok: true,
            command: 'do',
            cwd,
            messages: [
                message('info', 'ATM_DO_COMPLETE_DRY_RUN', `Dry-run: would close task ${taskId} as done with evidence from ${evidencePath}.`, { taskId, actorId, evidencePath })
            ],
            evidence: { taskId, phase: 'dry-run-complete' }
        });
    }
    await runTasks(['close', `--task`, taskId, `--actor`, actorId, `--evidence`, resolvedEvidence]);
    return makeResult({
        ok: true,
        command: 'do',
        cwd,
        messages: [
            message('info', 'ATM_DO_COMPLETED', `Task ${taskId} closed as done.`, { taskId, actorId, evidencePath, phase: 'closed', closedAt: new Date().toISOString() })
        ],
        evidence: { taskId, phase: 'closed', actorId }
    });
}
function runDoStatus(options) {
    const { cwd } = options;
    const tasksDir = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(tasksDir)) {
        return makeResult({
            ok: true,
            command: 'do',
            cwd,
            messages: [message('info', 'ATM_DO_STATUS_EMPTY', 'No tasks found.', {})],
            evidence: { activeTasks: [] }
        });
    }
    const activeTasks = [];
    for (const filename of readdirSync(tasksDir)) {
        if (!filename.endsWith('.json'))
            continue;
        try {
            const doc = JSON.parse(readFileSync(path.join(tasksDir, filename), 'utf-8'));
            const status = String(doc.status ?? '');
            if (status === 'running' || status === 'reserved' || status === 'ready') {
                activeTasks.push({
                    taskId: String(doc.workItemId ?? filename.replace('.json', '')),
                    phase: status,
                    claimedAt: doc.startedAt ? String(doc.startedAt) : undefined,
                    owner: doc.owner ? String(doc.owner) : undefined
                });
            }
        }
        catch {
            // skip
        }
    }
    return makeResult({
        ok: true,
        command: 'do',
        cwd,
        messages: [
            message('info', 'ATM_DO_STATUS', `${activeTasks.length} active task(s) in progress.`, { activeTasks })
        ],
        evidence: { activeTasks }
    });
}
