import { allowedGuidanceBootstrapCommands } from './channel-strategy.js';
import { buildNextMessages } from './playbook-projection.js';
import { toTaskCandidateView } from './view-projections.js';
import { makeResult, message } from '../shared.js';
export function buildHistoricalReconcileNextResult(input) {
    const reconcileCommand = `node atm.mjs tasks reconcile --task ${input.selectedTask.workItemId} --actor ${input.actorSlot} --delivery-commit <historicalCommitSha> --json`;
    const nextAction = {
        status: 'task-reconcile-suggested',
        command: reconcileCommand,
        reason: `task ${input.selectedTask.workItemId} is marked as done in the planning card but the target ledger is not closed yet; reconcile it using the historical sync channel`,
        recommendedChannel: 'reconcile',
        riskLevel: 'low',
        selectedTask: input.selectedTask,
        requiredCommand: reconcileCommand,
        playbook: {
            schemaId: 'atm.playbook.v1',
            channel: 'reconcile',
            steps: [
                'Find the historical Git commit SHA that delivered this task\'s changes (e.g., e26f3a73)',
                `Run ${reconcileCommand}`,
                'This will automatically generate the closure packet, update the ledger status to done, write task-events, and synchronize the governance record without claiming the task or mutating source files.'
            ]
        },
        allowedCommands: [reconcileCommand, ...allowedGuidanceBootstrapCommands()],
        blockedCommands: [
            'mutating source files during historical reconcile',
            'manual ledger JSON edit'
        ]
    };
    return makeResult({
        ok: true,
        command: 'next',
        cwd: input.cwd,
        messages: buildNextMessages(nextAction, null, input.integrationBootstrap, input.runtimeAdapterReadiness, message('info', 'ATM_NEXT_TASK_RECONCILE_SUGGESTED', `Task ${input.selectedTask.workItemId} is done in planning but ledger is open. Reconcile with historical sync.`, {
            task: toTaskCandidateView(input.selectedTask),
            requiredCommand: nextAction.requiredCommand
        })),
        evidence: {
            nextAction,
            recommendedChannel: 'reconcile',
            taskIntent: input.taskIntent,
            importedTaskQueue: input.importedTaskQueue,
            integrationBootstrap: input.integrationBootstrap,
            runtimeAdapterReadiness: input.runtimeAdapterReadiness
        }
    });
}
