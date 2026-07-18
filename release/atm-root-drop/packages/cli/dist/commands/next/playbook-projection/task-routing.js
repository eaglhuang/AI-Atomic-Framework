// @ts-nocheck
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { allowedGuidanceBootstrapCommands, blockedMutationCommands } from '../channel-strategy.js';
import { normalizeTaskRouteStatus, readStringArray } from '../intent-normalizers.js';
import { quoteCliValue, toTaskCandidateView, uniqueSorted } from '../view-projections.js';
import { extractPathLikeStringsFromPrompt, isPathAllowedByScope } from '../../work-channels.js';
import { makeResult, message, parseJsonText } from '../../shared.js';
import { allowsPlanningMirror } from '../match-and-sort.js';
import { finalizeImportedTaskSummary, normalizeOptionalString } from '../route-resolution.js';
import { buildNextMessages } from './message-assembly.js';
import { mentionsNotCurrentTask } from './active-work-summary.js';
function mapStatusToSlashCommandId(status) {
    if (status === 'needs-bootstrap' || status === 'needs-onboarding-refresh') {
        return 'atm-next';
    }
    if (status === 'needs-guidance-start') {
        return 'atm-orient';
    }
    if (status === 'needs-evidence' || status === 'needs-validation' || status === 'blocked') {
        return 'atm-evidence';
    }
    if (status === 'needs-handoff') {
        return 'atm-handoff';
    }
    return 'atm-next';
}
export function buildAgentPackHint(status, command, reason) {
    return {
        slashCommandId: mapStatusToSlashCommandId(status),
        route: status,
        command: command ?? '',
        reason: reason ?? ''
    };
}
export function buildMirrorSyncNextAction(input) {
    const sourcePath = input.task.sourcePlanPath ?? '<source-task-card-path>';
    const hasActiveClaim = typeof input.task.activeClaimActorId === 'string' && input.task.activeClaimActorId.length > 0;
    const importCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --write --force --json`;
    const dryRunCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --dry-run --json`;
    if (hasActiveClaim) {
        return {
            status: 'task-mirror-sync-blocked',
            command: dryRunCommand,
            reason: `Task ${input.task.workItemId} has an active claim by actor ${input.task.activeClaimActorId}. Mirror-sync write is blocked to prevent claim/lock overwrite.`,
            recommendedChannel: 'mirror-sync',
            riskLevel: 'high',
            requiredCommand: null,
            deliveryClassification: input.classification,
            mirrorSync: {
                schemaId: 'atm.taskMirrorSync.v1',
                taskId: input.task.workItemId,
                targetRepo: input.classification.targetRepo,
                closureAuthority: input.classification.closureAuthority,
                planningRepo: input.classification.planningRepo,
                ledgerStatus: input.classification.ledgerStatus,
                sourceStatus: input.classification.sourceStatus,
                statusDivergence: input.classification.statusDivergence,
                sourcePlanPath: input.task.sourcePlanPath,
                ledgerMirrorPath: input.task.taskPath,
                recommendedCommandSequence: [
                    `# WARNING: Active claim exists for ${input.task.activeClaimActorId}`,
                    `# Release or handoff the task before performing a forced mirror write.`,
                    dryRunCommand
                ],
                doNotDeliverHere: true
            },
            allowedCommands: [
                dryRunCommand,
                'node atm.mjs tasks audit --task <task-id> --json',
                'node atm.mjs framework-mode status --json'
            ],
            blockedCommands: [
                importCommand,
                'editing or staging this task\'s deliverables in the current repo',
                'node atm.mjs next --claim for this task in the current repo',
                'node atm.mjs tasks close for this task in the current repo'
            ]
        };
    }
    return {
        status: 'task-mirror-sync-required',
        command: input.classification.statusDivergence ? importCommand : dryRunCommand,
        reason: input.classification.reason,
        recommendedChannel: 'mirror-sync',
        riskLevel: 'low',
        requiredCommand: input.classification.statusDivergence ? importCommand : dryRunCommand,
        deliveryClassification: input.classification,
        mirrorSync: {
            schemaId: 'atm.taskMirrorSync.v1',
            taskId: input.task.workItemId,
            targetRepo: input.classification.targetRepo,
            closureAuthority: input.classification.closureAuthority,
            planningRepo: input.classification.planningRepo,
            ledgerStatus: input.classification.ledgerStatus,
            sourceStatus: input.classification.sourceStatus,
            statusDivergence: input.classification.statusDivergence,
            sourcePlanPath: input.task.sourcePlanPath,
            ledgerMirrorPath: input.task.taskPath,
            recommendedCommandSequence: input.classification.statusDivergence
                ? [
                    importCommand,
                    `git add ${quoteCliValue(input.task.taskPath)}`,
                    `git commit -m "atm: sync ${input.task.workItemId} ledger mirror from planning source"`
                ]
                : [dryRunCommand],
            doNotDeliverHere: true
        },
        allowedCommands: [
            importCommand,
            dryRunCommand,
            'node atm.mjs tasks audit --task <task-id> --json',
            'node atm.mjs framework-mode status --json'
        ],
        blockedCommands: [
            'editing or staging this task\'s deliverables in the current repo',
            'node atm.mjs next --claim for this task in the current repo',
            'node atm.mjs tasks close for this task in the current repo',
            'creating evidence for non-existent deliverable files'
        ]
    };
}
export function buildActiveTaskDivergenceResult(input) {
    const divergence = detectActiveTaskDivergence(input.cwd, input.taskIntent, input.importedTaskQueue);
    if (!divergence)
        return null;
    const activeTaskId = divergence.activeTask.workItemId;
    const nextAction = {
        status: 'active-task-divergence-blocked',
        command: 'node atm.mjs next --prompt "<specific task id or imported task card>" --json',
        reason: `the prompt appears to diverge from active task ${activeTaskId}; ATM will not attach new work to the active task silently`,
        activeTask: toTaskCandidateView(divergence.activeTask),
        divergence,
        decisionOptions: [
            'Open or import a new task card for the new work.',
            `Repair ${activeTaskId} metadata if the prompt really belongs to the active task.`,
            `Continue intentionally by naming ${activeTaskId} in the prompt.`
        ],
        allowedCommands: allowedGuidanceBootstrapCommands(),
        blockedCommands: blockedMutationCommands(),
        decisionTrail: [
            {
                check: 'route-status',
                result: 'blocked',
                reason: `ATM detected prompt divergence from active task ${activeTaskId}.`
            },
            {
                check: 'active-task-divergence',
                result: 'blocked',
                reason: divergence.reasons.join('; ')
            }
        ]
    };
    return makeResult({
        ok: false,
        command: 'next',
        cwd: input.cwd,
        messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('error', 'ATM_NEXT_ACTIVE_TASK_DIVERGENCE_BLOCKED', `Prompt diverges from active task ${activeTaskId}; ATM refused to auto-attach it.`, {
            activeTaskId,
            reasons: divergence.reasons,
            promptPaths: divergence.promptPaths,
            mentionedOtherTaskIds: divergence.mentionedOtherTaskIds,
            remediation: nextAction.decisionOptions
        })),
        evidence: {
            nextAction,
            taskIntent: input.taskIntent,
            importedTaskQueue: input.importedTaskQueue,
            activeTaskDivergence: divergence,
            integrationBootstrap: input.integrationBootstrap,
            runtimeAdapterReadiness: input.runtimeAdapterReadiness
        }
    });
}
function detectActiveTaskDivergence(cwd, taskIntent, importedTaskQueue) {
    const prompt = taskIntent?.userPrompt?.trim() ?? '';
    if (!prompt)
        return null;
    if (importedTaskQueue.promptScope && importedTaskQueue.promptScope.status !== 'not-found')
        return null;
    const activeTasks = readActiveClaimedTasks(cwd);
    if (activeTasks.length === 0)
        return null;
    const activeTaskIds = activeTasks.map((task) => task.workItemId.toUpperCase());
    const mentionedTaskIds = uniqueSorted([
        ...(taskIntent?.mentionedTaskIds ?? []),
        ...(taskIntent?.explicitTaskIds ?? [])
    ].map((taskId) => taskId.toUpperCase()));
    if (mentionedTaskIds.some((taskId) => activeTaskIds.includes(taskId)))
        return null;
    const reasons = [];
    const mentionedOtherTaskIds = mentionedTaskIds.filter((taskId) => !activeTaskIds.includes(taskId));
    if (mentionedOtherTaskIds.length > 0) {
        reasons.push(`prompt names other task id(s): ${mentionedOtherTaskIds.join(', ')}`);
    }
    if (mentionsNotCurrentTask(prompt)) {
        reasons.push('prompt explicitly says it is not the current active task');
    }
    const promptPaths = extractPathLikeStringsFromPrompt(prompt)
        .map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '').trim())
        .filter((entry) => entry.length > 0);
    const activeScope = uniqueSorted(activeTasks.flatMap((task) => [
        ...task.scopePaths,
        ...task.targetAllowedFiles
    ]));
    const outsidePromptPaths = promptPaths.filter((entry) => !isPathAllowedByScope(entry, activeScope));
    if (outsidePromptPaths.length > 0) {
        reasons.push(`prompt path(s) are outside active task scope(s): ${outsidePromptPaths.join(', ')}`);
    }
    return reasons.length > 0
        ? { activeTask: activeTasks[0], reasons, promptPaths, mentionedOtherTaskIds }
        : null;
}
function readActiveClaimedTasks(cwd) {
    const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
    if (!existsSync(taskStorePath))
        return [];
    return readdirSync(taskStorePath)
        .filter((entry) => entry.endsWith('.json'))
        .flatMap((entry) => {
        const filePath = path.join(taskStorePath, entry);
        try {
            const parsed = parseJsonText(readFileSync(filePath, 'utf8'));
            const workItemId = normalizeOptionalString(parsed.workItemId ?? parsed.id);
            if (!workItemId || normalizeTaskRouteStatus(normalizeOptionalString(parsed.status) ?? '') !== 'running')
                return [];
            const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
                ? parsed.claim
                : {};
            if (claimRecord.state !== 'active')
                return [];
            const source = parsed.source && typeof parsed.source === 'object' && !Array.isArray(parsed.source)
                ? parsed.source
                : {};
            return [finalizeImportedTaskSummary({
                    workItemId,
                    title: normalizeOptionalString(parsed.title) ?? workItemId,
                    status: normalizeOptionalString(parsed.status) ?? 'running',
                    closedAt: normalizeOptionalString(parsed.closedAt ?? parsed.closed_at),
                    closedByActor: normalizeOptionalString(parsed.closedByActor ?? parsed.closed_by_actor),
                    closurePacket: normalizeOptionalString(parsed.closurePacket ?? parsed.closure_packet),
                    lastTransitionId: normalizeOptionalString(parsed.lastTransitionId ?? parsed.last_transition_id),
                    lastTransitionAt: normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at),
                    milestone: normalizeOptionalString(parsed.milestone),
                    dependencies: readStringArray(parsed.dependencies),
                    taskPath: path.relative(cwd, filePath).replace(/\\/g, '/'),
                    format: 'json',
                    sourcePlanPath: normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path),
                    nearbyPlanPaths: [],
                    scopePaths: uniqueSorted([
                        ...readStringArray(parsed.scope),
                        ...readStringArray(parsed.scopePaths),
                        ...readStringArray(parsed.files),
                        ...readStringArray(claimRecord.files)
                    ]),
                    outOfScope: readStringArray(parsed.outOfScope ?? parsed.out_of_scope),
                    targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo),
                    planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
                    allowPlanningMirror: allowsPlanningMirror(parsed),
                    closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
                    activeClaimActorId: normalizeOptionalString(claimRecord.actorId),
                    activeClaimIntent: normalizeOptionalString(claimRecord.intent) ?? 'write'
                }, cwd)];
        }
        catch {
            return [];
        }
    });
}
