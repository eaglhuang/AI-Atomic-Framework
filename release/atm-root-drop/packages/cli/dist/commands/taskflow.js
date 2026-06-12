import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getCommandSpec } from './command-specs.js';
import { buildResidueDiagnosisEvidence, generateTaskCard, loadTaskDocumentOrThrow, runTasks, runTasksRosterUpdate } from './tasks.js';
import { buildCloseBackendArgv, buildClosebackPlan, buildTaskflowCloseDiagnostics, resolveCloseWriteSupport } from './taskflow/close-orchestration.js';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.js';
import { buildDelegationContract, buildTaskflowOpenDiagnostics, loadProfile, resolveOpenerMode, resolveWriteSupport } from './taskflow/profile-loader.js';
import { canResolveHostOpenerPolicy, resolveHostOpenerPolicyDecision } from './taskflow/host-opener-policy.js';
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
function buildTasksImportCommand(input) {
    return `node atm.mjs tasks import --from ${input.fromPath} --write --json`;
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
            ? buildTasksImportCommand({ fromPath: resolvedOutputPath })
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
async function runTaskflowClose(parsed, cwd) {
    const taskId = parsed.options.task ? String(parsed.options.task) : '';
    const actorId = parsed.options.actor ? String(parsed.options.actor) : '';
    const writeRequested = !!parsed.options.write;
    const profilePath = parsed.options.profile ? String(parsed.options.profile) : null;
    const historicalDeliveryRefs = collectHistoricalDeliveryRefs(parsed);
    if (!taskId) {
        throw new CliError('ATM_CLI_USAGE', 'taskflow close requires --task <work-item-id>.', { exitCode: 2 });
    }
    let profileData = null;
    if (profilePath) {
        profileData = loadProfile(profilePath);
    }
    const delegationContract = buildDelegationContract(profileData);
    const { taskDocument } = loadTaskDocumentOrThrow(cwd, taskId);
    const diagnosis = buildResidueDiagnosisEvidence(cwd, taskId, taskDocument);
    const closebackPlan = buildClosebackPlan({
        taskId,
        actorId: actorId || '<actor>',
        historicalDeliveryRefs,
        delegationContract,
        diagnosis: {
            bucket: diagnosis.bucket,
            truth: diagnosis.truth,
            residue: diagnosis.residue,
            reason: diagnosis.reason,
            nextCommand: diagnosis.nextCommand,
            triangulation: diagnosis.triangulation
        }
    });
    const diagnostics = buildTaskflowCloseDiagnostics({
        closeMode: closebackPlan.closeMode,
        writeRequested,
        actorSupplied: actorId.length > 0,
        taskIdSupplied: taskId.length > 0
    });
    const writeSupport = resolveCloseWriteSupport({
        writeRequested,
        closeMode: closebackPlan.closeMode,
        actorSupplied: actorId.length > 0,
        taskIdSupplied: taskId.length > 0,
        historicalDeliveryGateRequired: closebackPlan.historicalDeliveryGate.required,
        historicalDeliverySupplied: historicalDeliveryRefs.length > 0
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
    if (writeRequested && writeSupport.allowed) {
        const backendArgv = buildCloseBackendArgv({
            cwd,
            taskId,
            actorId,
            backendSurface: closebackPlan.backendSurface,
            historicalDeliveryRefs,
            planningMirrorPath: closebackPlan.writerBoundary.planningMirrorPath,
            forceImport: diagnosis.bucket === 'stale-import'
        });
        const backendResult = await runTasks(backendArgv);
        let rosterCloseback = null;
        if (closebackPlan.writerBoundary.rosterClosebackCommand
            && closebackPlan.writerBoundary.rosterSyncPolicy === 'inline'
            && closebackPlan.writerBoundary.rosterIndexPath
            && closebackPlan.writerBoundary.planningMirrorPath) {
            rosterCloseback = {
                mode: 'inline',
                command: closebackPlan.writerBoundary.rosterClosebackCommand,
                result: await runTasksRosterUpdate([
                    '--cwd', cwd,
                    '--index', closebackPlan.writerBoundary.rosterIndexPath,
                    '--from', closebackPlan.writerBoundary.planningMirrorPath
                ])
            };
        }
        else if (closebackPlan.writerBoundary.rosterClosebackCommand
            && closebackPlan.writerBoundary.rosterSyncPolicy === 'follow-up-command') {
            rosterCloseback = {
                mode: 'follow-up-command',
                command: closebackPlan.writerBoundary.rosterClosebackCommand
            };
        }
        return {
            ...makeResult({
                ok: backendResult.ok,
                command: 'taskflow close',
                cwd,
                mode: 'write',
                messages: [
                    message(backendResult.ok ? 'info' : 'error', backendResult.ok ? 'ATM_TASKFLOW_CLOSE_WRITE_ORCHESTRATED' : 'ATM_TASKFLOW_CLOSE_WRITE_FAILED', backendResult.ok
                        ? `taskflow close orchestrated ${closebackPlan.backendSurface} for ${taskId}.`
                        : `taskflow close write failed for ${taskId}.`, { closeMode: closebackPlan.closeMode, backendSurface: closebackPlan.backendSurface })
                ],
                evidence: {
                    closeMode: closebackPlan.closeMode,
                    writeSupport,
                    delegationContract,
                    diagnostics,
                    closebackPlan,
                    backendResult,
                    rosterCloseback,
                    residueDiagnosis: diagnosis,
                    ...(profileData ? { profile: profileData } : {})
                }
            }),
            schemaId: 'atm.taskflowCloseResult.v1',
            writeEnabled: true
        };
    }
    return {
        ...makeResult({
            ok: true,
            command: 'taskflow close',
            cwd,
            mode: 'dry-run',
            messages: [
                message(closebackPlan.closeMode === 'ambiguous-manual-review' ? 'warn' : 'info', closebackPlan.closeMode === 'ambiguous-manual-review'
                    ? 'ATM_TASKFLOW_CLOSE_AMBIGUOUS_RESIDUE'
                    : 'ATM_TASKFLOW_CLOSE_ORCHESTRATION_READY', closebackPlan.closeMode === 'ambiguous-manual-review'
                    ? 'taskflow close dry-run blocked on ambiguous residue; operator review required.'
                    : `taskflow close dry-run plan is ready (${closebackPlan.closeMode}).`, { taskId, closeMode: closebackPlan.closeMode })
            ],
            evidence: {
                closeMode: closebackPlan.closeMode,
                writeSupport,
                delegationContract,
                diagnostics,
                closebackPlan,
                residueDiagnosis: diagnosis,
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
        return runTaskflowClose(parsed, cwd);
    }
    if (action !== 'open') {
        throw new CliError('ATM_CLI_USAGE', `Unknown taskflow action: ${action}. Supported actions: open, close.`, { exitCode: 2 });
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
        cwd,
        profile: profileData,
        delegationContract,
        taskId,
        outputPath
    })) {
        try {
            hostPolicyDecision = resolveHostOpenerPolicyDecision({
                cwd,
                profile: profileData,
                delegationContract,
                taskId,
                outputPath
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
        taskId: hostPolicyDecision?.taskId ?? taskId,
        outputPath: hostPolicyDecision?.outputPath ?? outputPath,
        template,
        title,
        rosterIndexPath,
        hostPolicyDecision
    });
    if (writeRequested && !writeSupport.allowed) {
        throw new CliError('ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK', openerMode === 'template-only-fallback'
            ? 'taskflow open --write is not available in template-only-fallback mode. Load an invocable host opener profile or use tasks new for explicit template generation.'
            : 'taskflow open --write prerequisites are incomplete. Supply --task-id/--output or configure host-opener numbering and output-path policy.', {
            exitCode: 1,
            details: {
                openerMode,
                writeSupport,
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
            cwd,
            profile: profileData,
            delegationContract,
            taskId,
            outputPath
        });
        const generated = await generateTaskCard({
            cwd,
            templateKey: template,
            taskId: resolved.taskId,
            title,
            outputPath: resolved.outputPath
        });
        const targetAbsolute = path.resolve(cwd, resolved.outputPath);
        const hadExistingTarget = existsSync(targetAbsolute);
        const previousTargetContent = hadExistingTarget ? readFileSync(targetAbsolute, 'utf8') : null;
        mkdirSync(path.dirname(targetAbsolute), { recursive: true });
        writeFileSync(targetAbsolute, generated.content, 'utf8');
        let runtimeImport = null;
        try {
            const runtimeImportResult = await runTasks([
                'import',
                '--cwd', cwd,
                '--from', resolved.outputPath,
                '--write'
            ]);
            runtimeImport = {
                command: buildTasksImportCommand({ fromPath: resolved.outputPath }),
                result: runtimeImportResult
            };
        }
        catch (error) {
            if (hadExistingTarget && previousTargetContent !== null) {
                writeFileSync(targetAbsolute, previousTargetContent, 'utf8');
            }
            else if (existsSync(targetAbsolute)) {
                rmSync(targetAbsolute, { force: true });
            }
            throw error;
        }
        const effectiveRosterIndex = rosterIndexPath ?? delegationContract.policy.rosterSync.indexPath;
        let rosterSync = null;
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
            rosterSync = {
                mode: 'follow-up-command',
                command: buildRosterSyncCommand({ indexPath: effectiveRosterIndex, fromPath: resolved.outputPath })
            };
        }
        return {
            ...makeResult({
                ok: true,
                command: 'taskflow open',
                cwd,
                mode: 'write',
                messages: [
                    message('info', 'ATM_TASKFLOW_OPEN_WRITE_ORCHESTRATED', `taskflow open orchestrated tasks new generation at ${resolved.outputPath}.`, { openerMode, generationSurface: 'tasks-new', runtimeImported: true })
                ],
                evidence: {
                    openerMode,
                    writeSupport,
                    delegationContract,
                    diagnostics,
                    orchestrationPlan,
                    hostPolicyDecision: resolved,
                    generation: {
                        surface: 'tasks-new',
                        taskId: generated.taskId,
                        sourcePath: generated.sourcePath,
                        templateUsed: generated.templateUsed
                    },
                    runtimeImport,
                    rosterSync,
                    ...(profileData ? { profile: profileData } : {})
                }
            }),
            schemaId: 'atm.taskflowOpenResult.v1',
            writeEnabled: true
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
                : 'taskflow open is in template-only-fallback mode. tasks new remains the explicit low-level generator.', { cwd, openerMode })
        ],
        evidence: {
            openerMode,
            writeSupport,
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
        writeEnabled: false
    };
}
