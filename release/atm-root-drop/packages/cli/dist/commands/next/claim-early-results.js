import { resolveActorId } from '../actor-registry.js';
import { CliError, makeResult, message } from '../shared.js';
import { isQuickfixPrompt, writeQuickfixLock } from '../work-channels.js';
import { selectQuickfixChannel } from './channel-strategy.js';
import { buildChannelPlaybook, buildNextMessages } from './playbook-projection.js';
import { diagnoseClaimReadinessForTasks } from './claim-readiness.js';
import { normalizeTaskRouteStatus } from './intent-normalizers.js';
import { quoteCliValue } from './view-projections.js';
export function tryBuildQuickfixClaimResult(input) {
    if (!input.importedTaskQueue.claimableTask
        && !input.importedTaskQueue.promptScope
        && isQuickfixPrompt(input.promptText)
        && input.quickfixScope.length > 0) {
        const resolvedActor = resolveActorId(input.actor ?? undefined, input.cwd);
        if (!resolvedActor) {
            throw new CliError('ATM_ACTOR_ID_MISSING', 'next --claim requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
        }
        const quickfixLock = writeQuickfixLock({
            cwd: input.cwd,
            actorId: resolvedActor.actorId,
            prompt: input.promptText,
            reason: input.promptText,
            allowedFiles: input.quickfixScope
        });
        const quickfixChannel = selectQuickfixChannel();
        const nextAction = {
            status: 'ready',
            command: 'Apply the quickfix within the allowed files and commit normally.',
            reason: `claimed ATM quickfix lock for ${resolvedActor.actorId}`,
            recommendedChannel: quickfixChannel.recommendedChannel,
            riskLevel: quickfixChannel.riskLevel,
            playbook: buildChannelPlaybook({
                channel: 'fast',
                originalPrompt: input.promptText,
                actorPlaceholder: resolvedActor.actorId
            }),
            quickfixLock
        };
        return makeResult({
            ok: true,
            command: 'next',
            cwd: input.cwd,
            messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_QUICKFIX_CLAIMED', 'Acquired a quickfix lock from next --claim.', {
                actorId: resolvedActor.actorId,
                allowedFiles: quickfixLock.allowedFiles
            })),
            evidence: {
                nextAction,
                recommendedChannel: 'fast',
                quickfixLock,
                taskIntent: input.taskIntent,
                importedTaskQueue: input.importedTaskQueue,
                integrationBootstrap: input.integrationBootstrap,
                runtimeAdapterReadiness: input.runtimeAdapterReadiness
            }
        });
    }
    return null;
}
export function buildNoClaimableTaskResult(input) {
    const claimReadiness = diagnoseClaimReadinessForTasks(input.cwd, input.importedTaskQueue.promptScope?.selectedTasks ?? input.importedTaskQueue.tasks, input.claimIntent, { dependencyMode: input.importedTaskQueue.claimableTask ? 'claim-files' : 'hard' });
    const primaryBlocker = claimReadiness.primaryBlocker;
    const selectedReviewTask = input.importedTaskQueue.selectedTask
        && normalizeTaskRouteStatus(input.importedTaskQueue.selectedTask.status) === 'review'
        ? input.importedTaskQueue.selectedTask
        : null;
    if (selectedReviewTask && input.claimIntent !== 'closeout-only') {
        const requiredCommand = `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(selectedReviewTask.workItemId)} --claim-intent closeout-only --json`;
        return makeResult({
            ok: false,
            command: 'next',
            cwd: input.cwd,
            messages: [message('error', 'ATM_NEXT_CLAIM_REVIEW_CLOSEOUT_ONLY_REQUIRED', `Task ${selectedReviewTask.workItemId} is in review; reclaim it only through the closeout-only lane when no more source mutation is needed.`, {
                    taskId: selectedReviewTask.workItemId,
                    status: normalizeTaskRouteStatus(selectedReviewTask.status),
                    requiredCommand,
                    remediation: 'Use closeout-only with command-backed historical delivery evidence, or leave the task in review until a real deliverable exists.'
                })],
            evidence: {
                taskIntent: input.taskIntent,
                importedTaskQueue: input.importedTaskQueue
            }
        });
    }
    const claimCode = primaryBlocker?.blockerCode === 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED'
        ? 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED'
        : input.importedTaskQueue.promptScope?.selectedTasks.some((task) => task.format === 'markdown')
            ? 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED'
            : 'ATM_NEXT_CLAIM_NO_TASK';
    const singleVisibleTask = input.importedTaskQueue.tasks.length === 1 ? input.importedTaskQueue.tasks[0] : null;
    const promptScopeMiss = !input.importedTaskQueue.promptScope && !primaryBlocker && singleVisibleTask;
    const claimText = primaryBlocker?.blockerSummary
        ?? (promptScopeMiss
            ? `Prompt did not resolve to a scoped imported task. ATM found ${singleVisibleTask.workItemId}, but it will not auto-claim unrelated open work from an unscoped prompt.`
            : null)
        ?? (claimCode === 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED'
            ? 'The prompt-scoped task is a Markdown task card; import or mirror it into the ATM task ledger before claim.'
            : 'No claimable imported task is ready at the moment.');
    return makeResult({
        ok: false,
        command: 'next',
        cwd: input.cwd,
        messages: [message('error', claimCode, claimText, {
                requiredCommand: primaryBlocker?.requiredCommand
                    ?? (promptScopeMiss
                        ? `node atm.mjs next --claim --actor <id> --task ${singleVisibleTask.workItemId} --auto-intent --json`
                        : null)
                    ?? (input.importedTaskQueue.promptScope?.selectedTasks[0]?.sourcePlanPath
                        ? `node atm.mjs tasks import --from ${quoteCliValue(input.importedTaskQueue.promptScope.selectedTasks[0].sourcePlanPath ?? '')} --dry-run --cwd . --json`
                        : 'node atm.mjs tasks import --from <plan.md> --dry-run --cwd . --json'),
                primaryBlocker,
                claimReadiness
            })],
        evidence: {
            taskIntent: input.taskIntent,
            importedTaskQueue: input.importedTaskQueue,
            claimReadiness
        }
    });
}
