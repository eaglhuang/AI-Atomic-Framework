import { CliError, makeResult, message } from '../shared.js';
import { authorizeRunnerPublicationTakeover } from '../framework-development/runner-publication-lifecycle.js';
export function assertPublicationTakeoverQueueAdmission(input) {
    const head = input.queue.groups[0];
    if (head) {
        if (head.sealedSourceSha !== input.sealedSourceSha || !head.waitingTasks.includes(input.taskId)) {
            throw new CliError('ATM_RUNNER_PUBLICATION_PENDING', 'Publication takeover requires the active queue-head task and its exact sealed source SHA.', { exitCode: 1 });
        }
        return;
    }
    if (input.sealedSourceSha !== input.currentHeadSha) {
        throw new CliError('ATM_RUNNER_PUBLICATION_PENDING', 'Publication takeover with an empty steward queue requires the sealed source SHA to match HEAD so generated-output authority can be bound before a new queue-head reservation.', { exitCode: 1 });
    }
}
export function runRunnerSyncTakeoverPublication(input) {
    assertPublicationTakeoverQueueAdmission({
        queue: input.queue,
        taskId: input.taskId,
        sealedSourceSha: input.sealedSourceSha,
        currentHeadSha: input.currentHeadSha
    });
    const plan = authorizeRunnerPublicationTakeover({
        cwd: input.cwd,
        taskId: input.taskId,
        sealedSourceSha: input.sealedSourceSha,
        buildTarget: input.surface,
        currentTaskAllowedFiles: input.currentTaskAllowedFiles
    });
    return makeResult({
        ok: true,
        command: 'broker',
        cwd: input.cwd,
        messages: [message('info', 'ATM_BROKER_RUNNER_PUBLICATION_TAKEOVER_AUTHORIZED', `Authorized ${plan.entries.length} exact generated publication member(s) for the queue-head sealed build.`, { planDigest: plan.digest })],
        evidence: { plan, receiptPath: `.atm/history/evidence/${input.taskId}.runner-publication-takeover.json` }
    });
}
